# Proposal: Expose Compiler-Backed Affected Test Candidates

## Intent

Give MCP and CLI clients a trustworthy way to select tests affected by an exact symbol. The resolver is internal today. The public operation must preserve compiler authority, distinguish proven emptiness from incomplete analysis, and bound evidence.

## Scope

### In Scope

- Publish read-only `ast_find_test_candidates` for exact project symbols.
- Build exact compiler-authoritative incoming impact internally; reject stale, incomplete, truncated, ambiguous, or non-authoritative evidence.
- Return deterministic whole-candidate pages with trust, freshness, completeness, budgets, reasons, and relationship paths.
- Admit the tool to `ast-tool run` and synchronize tests, inventories, guidance, and managed skill metadata.

### Out of Scope

- Executing tests or selecting files outside the compiler project.
- Accepting caller-supplied impact graphs, traversal direction, or relationship filters.
- Adding a standalone CLI command or MCP TOON representation.

## Capabilities

### New Capabilities

- `affected-test-candidates`: Compiler-backed discovery across MCP and batch CLI, with fail-closed trust rules and whole-candidate pagination.

### Modified Capabilities

- None.

## Approach

Add an adapter that resolves the root through the existing project/session boundary, forces bounded incoming traversal, and invokes `findTestCandidates()` only for complete authoritative evidence. Register it with MCP and the read-only batch allowlist so both surfaces share one implementation. Design will finalize error codes and shared schema placement.

## Affected Areas

| Area                                                             | Impact   | Description                                           |
| ---------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| `src/tools/`, `src/services/test-candidates.ts`, `src/server.ts` | Modified | Public adapter, trusted traversal reuse, registration |
| `src/batch/schema.ts`, `src/services/agent-targets.ts`           | Modified | CLI admission and compatibility inventory             |
| `test/`, `scripts/`                                              | Modified | Contract, integration, batch, and inventory proof     |
| Docs, ADR, managed skill                                         | Modified | Public contract and guidance                          |

## Risks

| Risk                                           | Likelihood | Mitigation                                                 |
| ---------------------------------------------- | ---------- | ---------------------------------------------------------- |
| Partial traversal appears as no affected tests | Medium     | Fail closed unless traversal is complete and authoritative |
| Evidence payload grows with full paths         | Medium     | Paginate candidates atomically; retain traversal budgets   |
| MCP, CLI, inventory, and guidance drift        | Medium     | Verify all surfaces in one contract-driven change          |

## Rollback Plan

Remove tool registration, batch admission, inventory, and guidance updates while retaining the internal resolver. Re-run existing MCP, CLI, and inventory gates.

## Dependencies

- Existing `findTestCandidates()`, compiler-backed incoming impact traversal, and completed SQLite-default prerequisite.

## Success Criteria

- [ ] MCP and `ast-tool run` return identical deterministic candidates and proof for direct, transitive, convention-driven, and proven-empty cases.
- [ ] Stale, incomplete, truncated, ambiguous, or non-authoritative analysis returns a bounded public error, never an empty candidate page.
- [ ] Pagination never splits or weakens a candidate's relationship proof.
- [ ] Inventories, compatibility checks, docs, ADR, and managed skill metadata stay synchronized.
