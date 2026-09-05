# Tasks: Recover Honest Relationship Coverage

## Review Workload Forecast

Forecast: **2,800–3,600 authored lines**, **16–18 review units**, each ≤400 lines/≈60 minutes.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
Delivery strategy: auto-chain

`chain.md` defines commands, allowlists, receipts, trace, rollback, and kill switches. `apply-progress.json` is authoritative.

## Phase 0 — Authority/tracker

- [x] 0.1 Recheck #186–#188 approval, RDD, conflicts, `origin/main`, and planning hashes.
- [x] 0.2 Create one draft tracker; bind U1 and record base/tree/`Refs #188`.
- [x] 0.3 Reject drift, foreign scope, stale R-01 state, receipt mismatch, or >400-line children.

## Phase 1 — U1 RED

- [x] 1.1 Use active U1 acquire; re-author `1a08635…` MCP test; reproduce RED twice.
- [x] 1.2 Freeze 51-line identity, settle expected failure independently, and split evidence if budget-bound.

## Phase 2 — U2 coverage/tracker

- [x] 2.1 Acquire; RED RCR-001..006: 14 cells, precedence, completeness, work, cancellation.
- [x] 2.2 GREEN/REFACTOR `13af89d…` allowlist; adapt every 28-row assertion to 14 cells.
- [x] 2.3 Run impact+U1; freeze ≤400, settle, and split evidence when required.

## Phase 3 — U3 calls

- [x] 3.1 Acquire; RED RCR-007..008 directional exactness and isolated ambiguity.
- [x] 3.2 GREEN/REFACTOR `92db7e2…` allowlist; preserve #186 ownership and generous work limits.
- [x] 3.3 Run call/impact/U1; freeze ≤400, settle, and split evidence when required.

## Phase 4 — U4 contains

- [x] 4.1 Acquire waived by direct scope; RED RCR-009..010 direct/inverse and exclusion cases.
- [x] 4.2 GREEN/REFACTOR `19a9621…` allowlist; exclude #187 accounting.
- [x] 4.3 Run impact/U1; freeze ≤400, settle, and split evidence when required.

## Phase 5 — U5 public candidates

- [x] 5.1 Acquire waived by direct scope; RED ATC-001..007: six kinds, no-contains, rejection, proven-empty.
- [x] 5.2 GREEN/REFACTOR `15e252e…` allowlist; expose 14 cells and fail closed.
- [ ] 5.3 Run candidate/schema/MCP; freeze ≤400, settle, and split evidence when required.

## Phase 6 — U6/U7

- [ ] 6.1 Acquire U6; re-author `3af4fe6…`; prove seven-kind/cancellation matrix.
- [ ] 6.2 Run six-file matrix+U1; freeze ≤400 and settle U6.
- [ ] 6.3 Acquire U7; rewrite `bac52a4…` docs without stale R-01 claims.
- [ ] 6.4 Run full/package/diff gates; freeze ≤400 and settle U7.

## Phase 7 — Independent issues

- [ ] 7.1 Re-enter #186; forecast 300–480; split classifier/parity when >400.
- [ ] 7.2 Give each #186 slice issue links, receipts, TDD, review, hashes, rollback; exclude accounting.
- [ ] 7.3 Re-enter #187; independently forecast/split exact-once sorting/finalization work.
- [ ] 7.4 Give each #187 slice issue links, receipts, bound TDD, review, hashes, rollback; exclude dispatch.

## Phase 8 — Gates/closure

- [ ] 8.1 Freeze final candidate; run clean/full/package/pinned read-only Harness gates with hashes.
- [ ] 8.2 Recheck RDD; run dual Judgment; use native blind review only if enabled; bound two correction rounds.
- [ ] 8.3 Strictly validate 14 requirements/31 scenarios, zero exits, hashes, empty RED, exact tree.
- [ ] 8.4 Archive/merge deltas; freeze post-archive bytes; rerun review, verify, CI, Harness.
- [ ] 8.5 Accumulate sequentially; close #186 then #187; finally authorize `Fixes #188` or roll back.
