# Tasks: Honest Scoped Call Coverage

## Review Workload Forecast

| Field                   | Value                                          |
| ----------------------- | ---------------------------------------------- |
| Estimated changed lines | 1,450–1,875; each unit ≤400 including metadata |
| 400-line budget risk    | High                                           |
| Chained PRs recommended | Yes                                            |
| Suggested split         | U1 → U2 → U3 → U4 → U5                         |
| Delivery strategy       | auto-chain                                     |
| Chain strategy          | feature-branch-chain                           |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

See `chain.md` for exact branches, symbols, commands, trace, IDs, rollback, and stop/split rules.

## Phase 0: Authority and Baseline

- [ ] 0.1 Confirm approved issue #247 and RDD `disabled/unmanaged`; planning base is PR #254/`c5309ec`.
- [x] 0.2 Confirm `feat/247-u1-coverage-contract` at `c5309ec`; exclude #219, #220, Harness, and unrelated changes.
- [x] 0.3 Re-run focused baseline, typecheck, false-empty reproduction, and audit; preserve unchanged failures.
- [x] 0.4 Freeze immediate-predecessor branches and ≤400 authored-line budgets.

## Unit 1: Coverage Contract

- [ ] 1.1 Acquire `issue247-u1-apply-v1`; run the exact U1 RED twice unchanged and retain matching failure fingerprints.
- [x] 1.2 Implement canonical coverage/applicability in `src/services/relationships.ts` with paired tests.
- [x] 1.3 Refactor, run gates, verify SCI-R1–R2, budget, finish, and rollback.
- [ ] 1.4 Settle `issue247-u1-settle-v1`; freeze U1 without authority claims.

## Unit 2: Impact Projection

- [ ] 2.1 Base only on U1; acquire `issue247-u2-apply-v1`; repeat the exact U2 RED twice unchanged.
- [x] 2.2 Implement coverage/work/proven-empty propagation and public JSON/TOON schemas with tests.
- [x] 2.3 Refactor and gate SCI-R3/R6–R8, registered MCP parity, budget, finish, and rollback.
- [ ] 2.4 Settle `issue247-u2-settle-v1`; freeze U2 without authority claims.

## Unit 3: Scoped Direct Calls

- [ ] 3.1 Base only on U2; acquire `issue247-u3-apply-v1`; repeat the exact U3 RED twice unchanged.
- [x] 3.2 Implement bounded direct identifier call/new/tag producers and conservative unfinished fallback.
- [x] 3.3 Refactor and gate SCI-R4/R5/R9, MCP regression, budget, finish, and rollback.
- [ ] 3.4 Settle `issue247-u3-settle-v1`; freeze U3 without authority claims.

## Unit 4: Candidate Gate

- [ ] 4.1 Base only on U3; acquire `issue247-u4-apply-v1`; repeat the exact U4 RED twice unchanged.
- [ ] 4.2 Implement six-kind incoming admission, complete-evidence failure, metadata, and whole-proof pagination.
- [ ] 4.3 Refactor and gate ATC-R1–R4, MCP/batch parity, budget, finish, and rollback.
- [ ] 4.4 Settle `issue247-u4-settle-v1`; freeze U4 without authority claims.

## Unit 5: Documentation and Audit

- [ ] 5.1 Base only on U4; acquire `issue247-u5-apply-v1`; repeat the exact U5 RED twice unchanged.
- [ ] 5.2 Converge README, ADRs, managed skill, benchmark corpus/runner, and CLI smoke assertions.
- [ ] 5.3 Refactor and gate ATC-R5, benchmark/smoke, full checks, budget, finish, and rollback.
- [ ] 5.4 Settle `issue247-u5-settle-v1`; freeze immutable candidate.

## Final Candidate Gate

- [ ] 6.1 Run blind dual read-only Judgment on one immutable U5 candidate; merge only complete results.
- [ ] 6.2 Allow at most two confirmed-severe correction/re-judgment rounds; contradiction or exhaustion escalates.
- [ ] 6.3 After approval, run strict 14/25 verification and required CI on that candidate.
- [ ] 6.4 Archive/deliver only after candidate-bound gates under ordinary policy; Judgment grants no receipt.
