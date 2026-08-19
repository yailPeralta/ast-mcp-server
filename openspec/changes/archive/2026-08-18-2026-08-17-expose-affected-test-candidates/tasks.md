# Tasks: Expose Compiler-Backed Affected Test Candidates

No staging, commit, push, or PR authorization.

## Review Workload Forecast

| Field                         | Value                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| Estimated total changed lines | 650–850 lines; each slice below 400                                |
| 400-line budget risk          | High overall; Low per slice                                        |
| Chained PRs recommended       | Yes                                                                |
| Suggested split               | PR1 foundation → PR2 MCP surface → PR3 batch/docs/release metadata |
| Delivery strategy             | ask-on-risk (approved chain)                                       |
| Chain strategy                | feature-branch-chain                                               |

Decision needed before apply: No
Chain approval: user-approved feature-branch chain.
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit (task IDs) | Base / boundary                                                  | Estimate; focused gate                                                                                                 | Runtime harness; rollback                                                             |
| --------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| PR1: 1.1–1.4    | feature/tracker branch; internal only, no registration/inventory | 180–260; `yarn test test/test-candidates.test.ts test/public-errors.test.ts test/mcp.integration.test.ts`              | N/A: no public runtime; revert foundation and tests                                   |
| PR2: 2.1–2.4    | PR1 branch; complete MCP surface and exact 16-tool consumers     | 220–320; `yarn test test/mcp.integration.test.ts test/agent-targets.test.ts test/agent-setup.test.ts && yarn test:mcp` | MCP/registry fixtures; revert adapter, registration, inventory, and MCP smoke changes |
| PR3: 3.1–3.4    | PR2 branch; batch, docs, metadata, verification                  | 220–340; `yarn test test/batch.test.ts && yarn test:cli && yarn format:check && yarn lint`                             | `yarn build`, full smoke; revert batch/docs/skill metadata                            |

## PR1 — Internal foundation (RED → GREEN → REFACTOR)

- [x] 1.1 **RED**: Extend `test/test-candidates.test.ts` with convention bounds, direct/transitive/convention reasons, whole-candidate pagination, proven-empty, and every stale/rebuilding/degraded/truncated/incomplete/unresolved/heuristic/non-authoritative rejection.
- [x] 1.2 **RED**: Extend `test/public-errors.test.ts` for `INCOMPLETE_EVIDENCE`, `STALE_WORKSPACE`, invalid conventions/root errors, and bounded messages without paths, stacks, arguments, or secrets.
- [x] 1.3 **GREEN**: Create `src/tools/relationship-schema.ts`; refactor `src/tools/get_impact.ts` to import it; export convention bounds from `src/services/test-candidates.ts`; add bounded errors in `src/services/public-errors.ts`. Do not register the new tool.
- [x] 1.4 **REFACTOR**: Run the PR1 gate, preserve impact behavior and persist cumulative `apply-progress`.

## PR2 — Complete MCP public surface (RED → GREEN → REFACTOR)

- [x] 2.1 **RED**: Add `test/mcp.integration.test.ts` failures for exact root, incoming traversal, defaults/maxima `3/100/200` and `32/1000/5000`, trust/budget metadata, success/failure scenarios, atomic pages, schema/annotations, and no mutation coordinates.
- [x] 2.2 **RED**: Add inventory/compatibility failures in `test/agent-targets.test.ts`, `test/agent-setup.test.ts`, `scripts/mcp-smoke.mjs`, `scripts/registry-consumer-smoke.mjs`, and `scripts/fixtures/fake-agent.mjs` for exactly 16 tools.
- [x] 2.3 **GREEN**: Create `src/tools/find_test_candidates.ts`; register it in `src/server.ts`; update agent compatibility and coupled MCP/registry smoke fixtures so all 15→16 consumers stay synchronized.
- [x] 2.4 **REFACTOR**: Run the PR2 gate and persist cumulative `apply-progress`.

## PR3 — Batch, documentation, metadata, and verification (RED → GREEN → REFACTOR)

- [x] 3.1 **RED**: Extend `test/batch.test.ts` for read allowlisting, injected/conflicting `project_root`, JSON parity, pagination, and final TOON semantics.
- [x] 3.2 **GREEN**: Update `src/batch/schema.ts`, `scripts/cli-smoke.mjs`, `README.md`, `CHANGELOG.md`, and create `docs/adr/0012-public-affected-test-candidates.md` covering compiler authority, fail-closed behavior, pagination, parity, and rollback.
- [x] 3.3 **GREEN**: Update `skills/structural-code-editing/SKILL.md` and `releases.json` to 4.4.0, preserve the verified predecessor digest, recompute SHA-256, and run managed-file normalization.
- [x] 3.4 **REFACTOR**: Persist cumulative `apply-progress`; run focused gates, then `yarn format:check`, `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, `yarn test:mcp`, `yarn test:lifecycle`, `yarn test:cli`, `yarn test:errors`, and `yarn test:package`.
