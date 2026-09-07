# Tasks: Restore Required Quality Gates

## Review Workload Forecast

| Field                   | Value                                            |
| ----------------------- | ------------------------------------------------ |
| Estimated changed lines | U1 260–390; U2 30–90; each hard-max 400          |
| 400-line budget risk    | High                                             |
| Chained PRs recommended | Yes                                              |
| Suggested split         | U1 → U2, each based on its immediate predecessor |
| Delivery strategy       | auto-chain                                       |
| Chain strategy          | feature-branch-chain                             |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

See `chain.md` for exact execution and delivery contracts.

## Suggested Work Units

| Unit | Goal / branch / base                                       | Focused proof                                                                       | Runtime harness                          | Rollback               |
| ---- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------- |
| U1   | Private pnpm; `fix/265-u1-private-pnpm`; PR #270/`5e9d303` | `yarn vitest run test/private-pnpm.test.ts test/dsh-adapter.test.ts --reporter=dot` | Two smokes per Node cell                 | U1 helper/wiring/tests |
| U2   | Safe lock; `fix/265-u2-audit-resolutions`; frozen U1       | `yarn vitest run test/dependency-policy.test.ts --reporter=dot`                     | `yarn install --immutable && yarn audit` | U2 manifest/lock/test  |

## Phase 0: Authority and Baseline

- [x] 0.1 Confirm approved issue #265, RDD `disabled/unmanaged`, PR #270 at `5e9d303`, and no superseding authority.
- [x] 0.2 Freeze CI, Harness, relationship, dependency/audit, and Node-matrix baselines; preserve every exclusion.

## Unit 1: Deterministic Adapter pnpm Authority

- [x] 1.1 From PR #270/`5e9d303`, acquire `issue265-u1-apply-v1`; proceed only with its token and a clean dedicated branch/worktree.
- [x] 1.2 Make only U1 test edits; run the exact focused command twice unchanged and require identical behavior-failure fingerprints before production edits.
- [x] 1.3 Add `scripts/private-pnpm.mjs`; wire its exact private environment/provisioning into `scripts/dsh-adapter-smoke.mjs`; keep tests beside behavior.
- [x] 1.4 GREEN/refactor; prove exact integrity/version, bounded fail-closed fallback, hostile ambient isolation, cleanup, and two successful smokes per Node matrix cell.
- [x] 1.5 Run focused/full/supply-chain gates, measure ≤400 authored lines, record rollback/candidate identity, then settle `issue265-u1-settle-v1`.

## Unit 2: Audit-Safe Resolutions and Lock

- [x] 2.1 Base only on frozen U1; acquire `issue265-u2-apply-v1`; stop if predecessor identity or child diff is wrong.
- [x] 2.2 Add only dependency-policy tests; run the exact focused command twice unchanged and require identical old-version failures; record audit baseline separately.
- [x] 2.3 Add exact `fast-uri@3.1.6` and `qs@6.16.0` resolutions; regenerate `yarn.lock` only with Yarn 4.15.0, never hand-edit integrity data.
- [x] 2.4 GREEN/refactor; prove selectors/parent ranges, immutable no-mutation install, clean audit, policy negatives, exclusions, and Node 22.13.0/24 chain.
- [ ] 2.5 Run all gates, measure ≤400 authored lines, record rollback/candidate identity, then settle `issue265-u2-settle-v1` and freeze the complete candidate.

## Final Candidate and Delivery

- [ ] 3.1 Run two blind read-only Judgment judges on the same immutable U1+U2 candidate; require complete agreement handling and `JUDGMENT: APPROVED`.
- [ ] 3.2 Independently verify strict 11/11 traceability, full gates, immutable install/audit, exclusions, and required exact-SHA CI in both Node cells.
- [ ] 3.3 With separate delivery authority, merge issue #265 independently to `main`; Judgment grants none.
- [ ] 3.4 Rebase #247 root-to-child onto final `main`, regenerate lock conflicts, and reverify locally plus exact-SHA CI.
