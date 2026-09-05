# Tasks: Exact Request-Wide Work Accounting

## Review Workload Forecast

| Slice | Scope                                                         | Forecast | Immediate base                                       |
| ----- | ------------------------------------------------------------- | -------: | ---------------------------------------------------- |
| #187A | relationship producer/merge/finalization/legacy accounting    |  330–390 | PR #225 / `8fe8553097c169b7bba769c7e7f8fc8e90c97678` |
| #187B | neighbors/BFS/transaction plus candidate/MCP/JSON-TOON parity |  350–400 | exact accepted #187A head                            |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
Delivery strategy: auto-chain

Hard gate: reforecast each slice before edits; if forecast or actual authored additions+deletions exceeds 400, split before continuing. `chain.md` owns bases, attempts, matrices, gates, and rollback; `apply-progress.json` is the one mutable tracker.

## Phase 0 — Issue-first authority

- [x] 0.1 Revalidate issue, base, exclusions, and RDD. **Trace:** process gate for RWA-001..008 + ATC-FAIL. **Files:** read-only Git/GitHub; update only this change’s trackers. **Evidence:** at `2026-09-05T18:20:28Z`, #187 was OPEN with exactly `status:approved` + `type:bug`; PR #225 was OPEN at `8fe8553097c169b7bba769c7e7f8fc8e90c97678`, based on `docs/issue-187-design`; U7 PR #206 was OPEN/unmerged at `5d839bb1ee2550e5d0a6404784baa21121e188fa`; #186 and PRs #207–#218 were closed/unmerged; #219/#220 were open and unapproved; #188 was open/unmerged; no #187 implementation PR existed; RDD effective mode was off (`disabled/unmanaged`). **GREEN:** exact authority passed and #186/#219/#220/Harness/apply/new schemas/#188 merge/archive remain excluded. **Rollback:** Phase-0 metadata only.
- [x] 0.2 Admit A/B boundaries and frozen vectors. **Trace:** RWA-001-S01, RWA-002-S01/S02. **Files:** `tasks.md`, `chain.md`, `apply-progress.json`, `state.yaml`. **Evidence:** clean PR #225 base tree `ddd126df77f481add273aa841aa6fc60efd7c898`, empty-status SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, zero base diff, exact A branch/allowlist/candidate identity fields, and virgin attempt ledger (`revision=""`, ordinal 1, `next_action=begin`). **GREEN:** A=330–390 and B=350–400 remain ≤400; exact parents, vectors, acquire fields, and rollback are frozen; no reset is needed before A. **Rollback:** invalid Phase-0 slice metadata only.

## Phase A — Relationship accounting

- [x] A.1 Write producer/source/contains stage-vector REDs. **Trace:** RWA-001-S01, RWA-002-S01/S02, RWA-003-S01. **Files:** `test/impact.test.ts`. **Command/RED:** `yarn vitest run test/impact.test.ts -t "request-wide relationship stage vector"` twice; omitted sort/lookup/dispatch/retention/emission or pre-charge observation fails. **GREEN:** stable `{stage,count,before,after}` vector, untouched failed reserve, no reset/double charge. **Rollback:** A vector tests.
- [x] A.2 Write merge/finalization exact/generous/one-below REDs. **Trace:** RWA-003-S01, RWA-004-S01, RWA-007-S01. **Files:** `test/impact.test.ts`. **Command/RED:** targeted `"relationship finalization exact bound"` twice; old undercount or N-1 retained edges fails. **GREEN:** N succeeds, N-1 saturates `work_limit`, generous=N output/vector. **Rollback:** A finalization tests.
- [x] A.3 Write legacy collector/spine REDs. **Trace:** RWA-008-S01. **Files:** `test/relationships.test.ts`, `test/context-builder.test.ts`. **Command/RED:** targeted `"legacy work|spine exhaustion"`; partial edges/spine or complete claim fails. **GREEN:** all legacy final stages charged; exhaustion emits no authority and is incomplete. **Rollback:** legacy tests.
- [x] A.4 GREEN/REFACTOR relationship stages. **Trace:** RWA-001..004, RWA-007, RWA-008. **Files:** `src/services/relationships.ts` plus A tests. **Command/RED:** A suites remain red until helpers cover every frozen stage. **GREEN:** one tracker, charge-before-effect, stable IDs/order, all A suites pass with zero RED. **Rollback:** relationship source and paired A tests.
- [ ] A.5 Freeze ≤400 and settle A. **Trace:** all A scenarios. **Files:** A allowlist plus change trackers. **Command/RED:** numstat/diff-check/focused rerun; reject >400, foreign hunk, unstable rerun, or dirty cleanup. **GREEN:** exact tree/evidence hash and independent settlement; zero active RED. **Rollback:** abandon/revert A; do not start B.

## Phase B — Impact transaction and parity

- [ ] B.0 Obtain maintainer-authorized reset only if B changes the settled objective. **Trace:** RWA-001-S01 authority. **Files:** native attempt ledger; change trackers evidence only. **Command/RED:** revision-bound `sdd-attempt reset`; reject missing explicit authorization, wrong revision, or unsettled A. **GREEN:** authorized unique reset then separate B acquire; unchanged objective uses native continuation without fabricated reset. **Rollback:** stop before B; never auto-reset.
- [ ] B.1 Write collectNeighbors/BFS/probe vector REDs. **Trace:** RWA-001-S01, RWA-002-S01, RWA-003-S01. **Files:** `test/impact.test.ts`. **Command/RED:** targeted `"neighbor and BFS stage vector"` twice; absent/duplicate sort, scan, retention, dequeue, dispatch/probe, classify, retain, or enqueue fails. **GREEN:** one pre-stage charge per item; every probe shares request tracker. **Rollback:** B vector tests.
- [ ] B.2 Write transaction/cancellation/14-cell REDs. **Trace:** RWA-004-S01/S02, RWA-005-S01, RWA-006-S01. **Files:** `test/impact.test.ts`. **Command/RED:** targeted `"late exhaustion|cancellation collision|fourteen-cell"`; N-1 leaks authority, cancellation mutates count, or coverage misorders/duplicates. **GREEN:** exact=generous; one-below root-only/no authority; cancellation wins unchanged; canonical 7×2 cells. **Rollback:** B transaction tests.
- [ ] B.3 Write consumer/transport REDs. **Trace:** RWA-005-S01, RWA-007-S01, RWA-008-S01, ATC-FAIL-001..003. **Files:** `test/test-candidates.test.ts`, `test/mcp.integration.test.ts`, `test/batch.test.ts`, `test/context-builder.test.ts`. **Command/RED:** targeted `"work_limit|exact work parity|spine"`; page/spine leak, projector invocation, or JSON/TOON/MCP/batch divergence fails. **GREEN:** existing `INCOMPLETE_EVIDENCE(work_limit)` before projection, valid proven-empty, stable parity. **Rollback:** B public tests.
- [ ] B.4 GREEN/REFACTOR impact transaction. **Trace:** RWA-001..007. **Files:** `src/services/impact.ts` plus B tests. **Command/RED:** `yarn vitest run test/impact.test.ts`; remains red until tracker spans neighbors/BFS/coverage/final emission. **GREEN:** scratch commits only unexhausted with unchanged schemas/order and zero RED. **Rollback:** impact source and paired B tests.
- [ ] B.5 GREEN public fail-closed parity without schema expansion. **Trace:** RWA-007-S01, RWA-008-S01, ATC-FAIL-001..003. **Files:** prefer no production edit; only if proven: `src/tools/find_test_candidates.ts`, `src/services/context-builder.ts`; B tests. **Command/RED:** B.3 command; any partial surface remains red. **GREEN:** existing errors/shapes, no post-exhaustion projection, incomplete spine, stable parity. **Rollback:** optional source hunk and paired tests.
- [ ] B.6 Freeze ≤400 and settle B. **Trace:** all 9 requirements/13 scenarios. **Files:** B allowlist plus change trackers. **Command/RED:** numstat/diff-check/focused+cumulative; reject >400, foreign scope, unstable bytes, dirty cleanup, or missing A/reset authority. **GREEN:** exact tree/evidence hash settled; clean chain and zero RED. **Rollback:** revert B first; A stays reviewable.

## Phase 3 — Frozen review and verification

- [ ] 3.1 Run independent read-only adversarial review. **Trace:** RWA-001..008, ATC-FAIL. **Files:** frozen A+B Git trees, no edits. **Command/RED:** inspect exact diff/vectors/N/N-1/cancellation/14 cells/discard/parity; severe candidate-caused omission, double charge, pre-work, leak, or drift rejects. **GREEN:** complete path evidence and no unresolved severe finding; RDD remains disabled/unmanaged with no receipt claim. **Rollback:** fixes create and re-review a new candidate.
- [ ] 3.2 Run strict verify and delivery gate. **Trace:** 9 requirements/13 scenarios. **Files:** future `verify-report.md`; all scoped source/tests. **Command/RED:** format/lint/typecheck/test/build plus `sdd-verify-validate --requirements 9 --scenarios 13`; reject nonzero exit, count/hash mismatch, active RED, >400 child, or unstable output. **GREEN:** all zero, strict 9/13 admitted, exact trees/hashes/rollback recorded; route verify/authority, never #188 merge/archive. **Rollback:** smallest failing slice; no archive/merge.
