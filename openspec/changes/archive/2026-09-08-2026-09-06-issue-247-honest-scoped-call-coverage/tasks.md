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

- [x] 0.1 Confirm approved issue #247 and RDD `disabled/unmanaged`; planning base is PR #254/`c5309ec`.
- [x] 0.2 Confirm `feat/247-u1-coverage-contract` at `c5309ec`; exclude #219, #220, Harness, and unrelated changes.
- [x] 0.3 Re-run focused baseline, typecheck, false-empty reproduction, and audit; preserve unchanged failures.
- [x] 0.4 Freeze immediate-predecessor branches and ≤400 authored-line budgets.

## Unit 1: Coverage Contract

- [x] 1.1 Acquire `issue247-u1-apply-v1`; run the exact U1 RED twice unchanged and retain matching failure fingerprints.
- [x] 1.2 Implement canonical coverage/applicability in `src/services/relationships.ts` with paired tests.
- [x] 1.3 Refactor, run gates, verify SCI-R1–R2, budget, finish, and rollback.
- [x] 1.4 Settle `issue247-u1-settle-v1`; freeze U1 without authority claims.

## Unit 2: Impact Projection

- [x] 2.1 Base only on U1; acquire `issue247-u2-apply-v1`; repeat the exact U2 RED twice unchanged.
- [x] 2.2 Implement coverage/work/proven-empty propagation and public JSON/TOON schemas with tests.
- [x] 2.3 Refactor and gate SCI-R3/R6–R8, registered MCP parity, budget, finish, and rollback.
- [x] 2.4 Settle `issue247-u2-settle-v1`; freeze U2 without authority claims.

## Unit 3: Scoped Direct Calls

- [x] 3.1 Base only on U2; acquire `issue247-u3-apply-v1`; repeat the exact U3 RED twice unchanged.
- [x] 3.2 Implement bounded direct identifier call/new/tag producers and conservative unfinished fallback.
- [x] 3.3 Refactor and gate SCI-R4/R5/R9, MCP regression, budget, finish, and rollback.
- [x] 3.4 Settle `issue247-u3-settle-v1`; freeze U3 without authority claims.

## Unit 4: Candidate Gate

- [x] 4.1 Base only on U3; acquire `issue247-u4-apply-v1`; repeat the exact U4 RED twice unchanged.
- [x] 4.2 Implement six-kind incoming admission, complete-evidence failure, metadata, and whole-proof pagination.
- [x] 4.3 Refactor and gate ATC-R1–R4, MCP/batch parity, budget, finish, and rollback.
- [x] 4.4 Settle `issue247-u4-settle-v1`; freeze U4 without authority claims.

## Unit 5: Documentation and Audit

- [x] 5.1 Base only on U4; acquire `issue247-u5-apply-v1`; repeat the exact U5 RED twice unchanged.
- [x] 5.2 Converge README, ADRs, managed skill, benchmark corpus/runner, and CLI smoke assertions.
- [x] 5.3 Refactor and gate ATC-R5, benchmark/smoke, full checks, budget, finish, and rollback.
- [x] 5.4 Settle `issue247-u5-settle-v1`; freeze immutable candidate.

## Final Candidate Gate

- [x] 6.1 Freeze `ec235b0`; record both complete round-1 judges as ESCALATED and merge three corroborated SEVERE, two judge-local SUSPECT severe, zero contradictions, and preserved INFO/baselines in `reviews/ledger.json`.
- [x] 6.2 R1A–R1C corrected C1–C3 through PRs #261–#263; both scoped judges APPROVED the frozen ledger plus immutable correction deltas at `8666149` with no correction-caused findings or contradictions.
- [x] 6.3 **STRICT VERIFY PASS:** local 14/14 requirements, 25/25 scenarios, dual-Node adapter/audit, all package gates, and newest exact-head CI for #249–#264 and #280–#283 pass on `0e3955f`; evidence `sha256:d8278ab4fbdf4766efafab62548570058a353a3adf3c3966021d9afe0bd9f07d`.
- [x] 6.4 **DELIVERY HANDOFF RECORDED:** after parent commit/push, require PR #266 newest exact-head CI green before archive/delivery; the active attempt remains unsettled and no delivery authority is granted.

## Judgment Day Correction Round 1 Plan

| Unit | Immediate predecessor   | Confirmed root                                                                                                                                        | Forecast | Hard max | Status                      |
| ---- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | -------: | --------------------------- |
| R1A  | `f72d40b`               | Incoming uncertainty only: skipped deferred computed-key/external-alternative references cannot complete or prove empty; add no exact #219/#220 edges |  180–320 |      400 | Closed by scoped rejudgment |
| R1B  | `5b827b3` R1A candidate | Regenerate the eight-scenario benchmark report and bind report, corpus projection, and corrected candidate                                            |    20–80 |      400 | Closed by scoped rejudgment |
| R1C  | `41f124f` R1B candidate | Format the candidate-owned issue #247 OpenSpec artifacts reported by the gate                                                                         |   20–120 |      400 | Closed by scoped rejudgment |

Correction round 1 of 2 is complete. Both scoped judges APPROVED final HEAD `8666149`: C1–C3 are closed, neither judge found a correction-caused severe, suspect, INFO, or contradiction, and the two original judge-local suspects remain retained but unconfirmed and non-blocking. Strict verification is next; no receipt or delivery authority is granted.
