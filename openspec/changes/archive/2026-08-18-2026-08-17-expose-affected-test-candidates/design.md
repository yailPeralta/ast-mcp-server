# Design: Expose Compiler-Backed Affected Test Candidates

## Technical Approach

Add one read-only MCP adapter that resolves an exact symbol inside `withProject()`, forces `traverseCompilerImpact(..., { direction: "incoming" })`, rejects any non-fresh or incomplete traversal, projects it through the existing pure `findTestCandidates()`, and paginates complete candidate objects. `ast-tool run` reaches the same registered handler through its existing in-memory MCP client; it gains only allowlist admission, not another analysis path.

## Architecture Decisions

| Decision question                               | Options and tradeoff                                                                                                                              | Decision and rationale                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where should the public operation live?         | Extend `ast_get_impact` (couples generic graph output to test policy); accept a caller graph (forgeable); dedicated adapter (one extra contract). | Create `src/tools/find_test_candidates.ts`. It owns transport orchestration only; compiler traversal remains in `impact.ts` and candidate rules remain in `test-candidates.ts`.                                                                                                                                                 |
| How should evidence schemas stay aligned?       | Duplicate Zod shapes (drift) or share transport schemas.                                                                                          | Move source-range, freshness, relationship-endpoint, and relationship-edge Zod objects from `get_impact.ts` to `src/tools/relationship-schema.ts`; both tools import them. Domain types remain service-owned.                                                                                                                   |
| How should absence and partial evidence differ? | Return an empty page (unsafe) or fail closed.                                                                                                     | Only a fresh, complete, untruncated, exact/resolved/compiler-authoritative traversal may reach pagination. Add `INCOMPLETE_EVIDENCE`; use `STALE_WORKSPACE` for non-fresh state, existing `NOT_FOUND`/`AMBIGUOUS_TARGET` for root resolution, and `INVALID_INPUT` for conventions. Unexpected invariants stay `INTERNAL_ERROR`. |
| How should payload size be bounded?             | Paginate edges (splits proof) or candidates (repeats but preserves proof).                                                                        | Reuse `paginate()` and `PaginationOutputSchema`; slice the deterministic candidate array, never each candidate's relationship path.                                                                                                                                                                                             |

## Data Flow

```text
MCP client ───────────────┐
                         ├─> ast_find_test_candidates
ast-tool run ─> allowlist┘      │ project_root injected by batch runner
                                v
withProject -> resolveImpactRoot -> traverseCompilerImpact(incoming)
                                -> trust gate -> findTestCandidates -> paginate -> JSON
```

## File Changes

| Files                                                                                                                                                                        | Action        | Responsibility                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/find_test_candidates.ts`, `src/tools/relationship-schema.ts`                                                                                                      | Create        | Public contract/orchestration and shared Zod evidence schemas.                                                                                                         |
| `src/tools/get_impact.ts`, `src/services/test-candidates.ts`, `src/services/public-errors.ts`, `src/server.ts`                                                               | Modify        | Reuse schemas, export convention bounds, add bounded error, register the read-only tool after impact.                                                                  |
| `src/batch/schema.ts`, `src/services/agent-targets.ts`                                                                                                                       | Modify        | Add the tool to the read allowlist and agent capability check. `runner.ts` stays unchanged: its generic conflict check and authoritative root injection already apply. |
| `test/test-candidates.test.ts`, `test/mcp.integration.test.ts`, `test/batch.test.ts`, `test/public-errors.test.ts`, `test/agent-targets.test.ts`, `test/agent-setup.test.ts` | Modify        | RED-first resolver, public contract, fail-closed, pagination, batch-root, error, and inventory coverage.                                                               |
| `scripts/mcp-smoke.mjs`, `scripts/cli-smoke.mjs`, `scripts/registry-consumer-smoke.mjs`, `scripts/fixtures/fake-agent.mjs`                                                   | Modify        | Prove the exact 16-tool inventory plus JSON/CLI-TOON batch parity.                                                                                                     |
| `README.md`, `CHANGELOG.md`, `docs/adr/0012-public-affected-test-candidates.md`                                                                                              | Modify/Create | Usage, release note, and lasting compiler-authority decision.                                                                                                          |
| `skills/structural-code-editing/SKILL.md`, `skills/structural-code-editing/releases.json`                                                                                    | Modify        | Document the operation, bump skill to 4.4.0, move the verified 4.3.0/0.9.2 digest to predecessors, and recompute the current SHA-256.                                  |

## Interfaces / Contracts

Input: `project_root`, `file_path`, `symbol_path`; impact bounds default to `3/100/200` and retain maxima `32/1000/5000`; optional bounded `test_file_patterns`/`test_directories`; `offset`/`limit` use shared `0/100` defaults and maximum 500. Direction, relationship kinds, caller impact, and MCP `output_format` are intentionally absent.

Success contains `backend: "typescript_compiler"`, `compiler_authoritative: true`, resolved `root`, `candidates`, pagination fields, effective traversal counts/budgets, `freshness`, `completeness.complete: true`, and non-truncated metadata. Each candidate preserves reason, confidence, relationship IDs, and its full relationship-edge path. MCP returns canonical structured JSON; only `ast-tool run --output-format toon` encodes the final batch result.

Registration annotations are `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false`.

## Testing Strategy

Strict TDD writes failures first. Unit tests cover convention bounds and every rejected evidence class. MCP integration covers direct, transitive, custom-convention, proven-empty, low-budget incomplete, root errors, candidate-atomic pagination, schema, annotations, and no mutation coordinates. Batch tests prove allowlisting, pipeline-root injection/conflict rejection, JSON parity, and final TOON. Smoke tests prove the 16-tool inventories and installed-agent compatibility.

## Threat Matrix

| Boundary                 | Applicability                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Documentation-like paths | N/A — batch consumes declarative JSON and does not classify or execute source-like files. |
| Git repository selection | N/A — no Git command or repository selector changes.                                      |
| Commit state             | N/A — read analysis does not inspect index/worktree semantics.                            |
| Push state               | N/A — no push behavior.                                                                   |
| PR commands              | N/A — no PR command composition.                                                          |

## Migration / Rollout

No data migration or flag is required. Roll back by removing registration, read allowlisting, inventories, and guidance; the internal resolver remains intact.

## Open Questions

None.
