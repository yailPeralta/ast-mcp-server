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

| Unit | Goal                                           | Base                |  Budget | Focused test                                                            | Runtime harness                 | Rollback           |
| ---- | ---------------------------------------------- | ------------------- | ------: | ----------------------------------------------------------------------- | ------------------------------- | ------------------ |
| A    | Descriptor/classifier and scoped producers     | PR #206 / `5d839bb` | 220–320 | `yarn vitest run test/impact.test.ts test/relationships.test.ts`        | service-level compiler fixtures | revert A allowlist |
| B    | MCP, call-spine, candidate parity and evidence | #186A               |  80–160 | `yarn vitest run test/mcp.integration.test.ts test/call-spines.test.ts` | `yarn test:mcp`                 | revert B allowlist |

## Phase 0 — Authority and attempts

- [ ] 0.1 Recheck approved issue [#186](https://github.com/yailPeralta/ast-mcp-server/issues/186), recovery [#188](https://github.com/yailPeralta/ast-mcp-server/issues/188), RDD mode, conflicts, and immediate base [PR #206](https://github.com/yailPeralta/ast-mcp-server/pull/206) at `5d839bb`.
- [ ] 0.2 Inspect attempt status; only explicitly authorized terminal recovery may use unique reset IDs; never reset automatically.
- [ ] 0.3 Acquire #186A with its unique ID/token and freeze base tree, allowlist, cleanup, and process baselines.

## Phase 1 — #186A RED

- [ ] 1.1 RED `test/impact.test.ts`: convergence, uncertain getter/property/method/union dispatch, and zero guessed edges.
- [ ] 1.2 RED `test/impact.test.ts`: private/`#private` parameter exactness, exact controls, and polymorphic-static negatives.
- [ ] 1.3 RED `test/{impact,relationships}.test.ts`: endpoint disjointness, direction isolation, stable dedupe, and unchanged work/cancellation.

## Phase 2 — #186A GREEN/REFACTOR

- [ ] 2.1 GREEN `src/services/relationships.ts`: normalize callable owners and canonical implementations from compiler evidence.
- [ ] 2.2 GREEN scoped producers: apply static binding first, then closed receiver convergence or endpoint-aware unfinished/disjoint.
- [ ] 2.3 REFACTOR; run A gates, freeze ≤400-line candidate hashes, verify cleanup, settle uniquely, and preserve `Refs #186`/`Refs #188`.

## Phase 3 — #186B RED/GREEN

- [ ] 3.1 Acquire #186B from accepted A with its unique ID/token and fresh baselines.
- [ ] 3.2 RED registered MCP parity for accessor ambiguity and private exactness in incoming, outgoing, and both directions.
- [ ] 3.3 RED spine/candidate tests: ambiguity grants no spine, candidate, or proven emptiness; exact private evidence remains eligible.
- [ ] 3.4 GREEN/REFACTOR global collection and consumers through shared authority; do not edit #187 accounting.

## Phase 4 — Evidence, review, handoff

- [ ] 4.1 Run focused/full/package gates; freeze B hashes/cleanup and settle uniquely with `Fixes #186`/`Refs #188`.
- [ ] 4.2 Obtain fresh independent read-only adversarial review limited to the frozen #186 diff; invalidate on any candidate change.
- [ ] 4.3 Validate 6 requirements/14 scenarios, zero active RED, and hand accepted B to #187 without implementing, archiving, merging, or closing #188.
