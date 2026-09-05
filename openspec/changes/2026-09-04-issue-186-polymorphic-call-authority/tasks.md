# Tasks: Prove Polymorphic Call Authority

## Review Workload Forecast

| Field                    | Value                                                 |
| ------------------------ | ----------------------------------------------------- |
| Estimated authored lines | 300–480                                               |
| Suggested split          | #186A classifier/producer → #186B MCP/spine/candidate |
| Delivery strategy        | auto-chain                                            |
| Chain strategy           | feature-branch-chain                                  |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal                                           | Base                                                       |  Budget | Focused test                                                            | Runtime harness                 | Rollback           |
| ---- | ---------------------------------------------- | ---------------------------------------------------------- | ------: | ----------------------------------------------------------------------- | ------------------------------- | ------------------ |
| A    | Descriptor/classifier and scoped producers     | PR #211 / `1fa8a6b` (runtime ancestor PR #206 / `5d839bb`) | 220–320 | `yarn vitest run test/impact.test.ts test/relationships.test.ts`        | service-level compiler fixtures | revert A allowlist |
| B    | MCP, call-spine, candidate parity and evidence | #186A                                                      |  80–160 | `yarn vitest run test/mcp.integration.test.ts test/call-spines.test.ts` | `yarn test:mcp`                 | revert B allowlist |

## Phase 0 — Authority and attempts

- [x] 0.1 Rechecked approved and exactly typed issues [#186](https://github.com/yailPeralta/ast-mcp-server/issues/186) (`type:bug`) and [#188](https://github.com/yailPeralta/ast-mcp-server/issues/188) (`type:chore`); [#187](https://github.com/yailPeralta/ast-mcp-server/issues/187) remains a separate approved `type:bug` authority. RDD is `disabled/unmanaged`; no conflicting callable-authority implementation PR is open. Recovery U7 PR #206 (`5d839bb`) and planning PRs #207–#210 form a clean immediate-parent chain, each ≤400 changed lines. A's actual immediate base is PR #210 (`docs/issue-186-state`, `8ba1050`), with runtime ancestor PR #206 (`5d839bb`); `main` and closed #161 authority remain forbidden.
- [x] 0.2 Inspected the #186 attempt ledger: revision and binding revision are empty, objective generation is `0`, no attempts or active objective exist, `next_ordinal` is `1`, and `next_action` is `begin`. No reset is needed or authorized; root must acquire A using the frozen fields in `chain.md` and `apply-progress.json`.
- [x] 0.3 Authenticated the delegated #186A actor with the supplied active token; froze PR #211 / `1fa8a6b` base tree plus clean status/process baselines without acquire.

## Phase 1 — #186A RED

- [x] 1.1 RED `test/impact.test.ts`: convergence, uncertain getter/property/method/union dispatch, and zero guessed edges.
- [x] 1.2 RED `test/impact.test.ts`: private/`#private` parameter exactness, exact controls, and polymorphic-static negatives.
- [x] 1.3 RED `test/{impact,relationships}.test.ts`: endpoint disjointness, direction isolation, stable dedupe, and unchanged work/cancellation.

## Phase 2 — #186A GREEN/REFACTOR

- [x] 2.1 GREEN `src/services/relationships.ts`: normalize callable owners and canonical implementations from compiler evidence.
- [x] 2.2 GREEN scoped producers: apply static binding first, then closed receiver convergence or endpoint-aware unfinished/disjoint.
- [x] 2.3 REFACTOR; ran A gates, froze the ≤400-line candidate, and verified cleanup. Root settlement remains intentionally pending.

## Phase 3 — #186B RED/GREEN

- [x] 3.1 Authenticate #186B from accepted A using the supplied active token and fresh baselines; acquire remains parent-owned by instruction.
- [x] 3.2 RED registered MCP parity for accessor ambiguity and private exactness in incoming, outgoing, and both directions.
- [x] 3.3 RED spine/candidate tests: ambiguity grants no spine, candidate, or proven emptiness; exact private evidence remains eligible.
- [x] 3.4 GREEN/REFACTOR global collection and consumers through shared authority; do not edit #187 accounting.

## Phase 4 — Evidence, review, handoff

- [ ] 4.1 Run focused/full/package gates; freeze B hashes/cleanup and settle uniquely with `Fixes #186`/`Refs #188`.
- [ ] 4.2 Obtain fresh independent read-only adversarial review limited to the frozen #186 diff; invalidate on any candidate change.
- [ ] 4.3 Validate 6 requirements/14 scenarios, zero active RED, and hand accepted B to #187 without implementing, archiving, merging, or closing #188.
