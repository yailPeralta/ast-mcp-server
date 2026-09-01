# Tasks: Edit-aware diagnostic delta

## Review Workload Forecast

Forecast: **1,690–2,335 lines**; children ≤400/≈60 minutes.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
Delivery strategy: auto-chain

| Unit; lines; predecessor   | Focused command                                              | Runtime/rollback            |
| -------------------------- | ------------------------------------------------------------ | --------------------------- |
| U1 RED; 110–170; #149      | `yarn vitest run test/operations.test.ts -t "same-identity"` | compiler/test               |
| U2 mapper; 300–390; U1     | `yarn vitest run test/diagnostics.test.ts`                   | internal/mapper+tests       |
| U3 edges; 320–395; U2      | `yarn vitest run test/diagnostics.test.ts`                   | internal/matcher+tests      |
| U4 operations; 300–390; U3 | `yarn vitest run test/operations.test.ts`                    | operation/integration+tests |
| U5 v2; 300–390; U4         | `yarn vitest run test/operation-plan-file.test.ts`           | replay/cutover+tests        |
| U6 evidence; 180–300; U5   | gates below                                                  | Harness/evidence            |
| U7 closure; 180–300; U6    | strict verify/Judgment/archive                               | N/A/closure                 |

Children: predecessor bases, `📍`, clean-diff tracker-#145 accumulation.

## Receipt boundary

Runtime tasks 1.1, 2.1–5.3, 6.1–6.5 MUST acquire, run only on `proceed`, settle, and journal `apply-progress`. Acquire: `~/.local/bin/gentle-ai sdd-attempt acquire --cwd "$PWD" --change 2026-09-01-m02-edit-aware-diagnostic-delta --request-id <id> --work-unit "<unit>" --evidence-goal "<goal>" --max-attempts 2 --max-changed-lines 400`. Settle: `~/.local/bin/gentle-ai sdd-attempt settle --cwd "$PWD" --change 2026-09-01-m02-edit-aware-diagnostic-delta --token "$TOKEN" --request-id <new-id> --outcome <passed|failed|interrupted> --evidence-revision sha256:<64hex> --diagnosis "<text>" --harness-disposition <reused|invalidated> --cleanup-evidence "<text>" --process-evidence "<text>"`; omit revision for interruption.

## Phase 0: Planning

- [x] 0.1 PRs #145–149 delivered tracker/exploration/proposal/7-requirement/8-scenario-spec/design.
- [x] 0.2 Deliver tasks atop #149; `git diff --check`; runtime N/A.

## Phase 1 — U1 RED

- [x] 1.1 Test replacement TS2322 added/blocked/apply-denied/disk-unchanged; shifted unrelated absent. RED: the current location-blind comparator yields `blocked=false`.

## Phase 2 — U2 mapper

- [x] 2.1 **RED:** UTF-16-observations/deterministic-Myers/three-cap-fallback/cancellation. Failure: APIs absent.
- [x] 2.2 **GREEN:** implement bounded maps/order/checkpoints in `diagnostics.ts`; run U2.
- [x] 2.3 **REFACTOR after GREEN:** simplify; preserve budgets/cancellation; rerun U2.

## Phase 3 — U3 edges

- [x] 3.1 **RED:** disjoint-edits/repeats/FIFO-duplicates/boundaries/zero-width/missing-spans/lifecycle/unfiled/CRLF/surrogate/BOM. Failure: `compareObservedDiagnostics` absent.
- [x] 3.2 **GREEN:** conservative matcher preserving public schemas/`allow_new_errors`; run U3.
- [x] 3.3 **REFACTOR after GREEN:** deduplicate; rerun U3.

## Phase 4 — U4 integration

- [x] 4.1 **RED:** all operations plus `allow_new_errors=true`. Failure: comparison precedes text-pairs.
- [x] 4.2 **GREEN:** reorder `operations.ts`; delta-before-policy/hash/retain; preserve freshness/cleanup/no-writes; run U1+U4.
- [x] 4.3 **REFACTOR after GREEN:** reduce plumbing; rerun U4.

## Phase 5 — U5 v2

- [ ] 5.1 **RED:** v2-hash/writer, prepared-v1-denial, exact-postimage-applied-v1-recovery, mismatch-denial, v2-idempotence. Failure: v1 acceptance.
- [ ] 5.2 **GREEN:** dual-read/v2-write `operation-plan-file.ts`; versioned hash-import; run U5.
- [ ] 5.3 **REFACTOR after GREEN:** centralize dispatch; rerun U5.

## Phase 6 — Gates/closure

- [ ] 6.1 Full/package: `yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build && yarn test:mcp && yarn test:lifecycle && yarn test:cli && yarn test:errors && yarn test:package`.
- [ ] 6.2 Harness: `yarn vitest run test/dsh-adapter.test.ts test/tool-catalog.test.ts && yarn test:dsh-adapter`; prove guarded-15/apply-absent/direct-`UNKNOWN_TOOL`; **no Harness checkout edits**.
- [ ] 6.3 Generate separate ≤400-line evidence/apply-progress proving exact 7-requirement/8-scenario coverage.
- [ ] 6.4 Freeze target; blind-dual Judgment Day; ≤2 receipt-bound RED-first remediation/re-judgments; require `APPROVED`.
- [ ] 6.5 Strict verify: `~/.local/bin/gentle-ai sdd-verify-validate --input openspec/changes/2026-09-01-m02-edit-aware-diagnostic-delta/verify-report.md --requirements 7 --scenarios 8`.
- [ ] 6.6 After GREEN/receipts/CI: merge spec, archive immutably, accumulate U7→#145, merge tracker.
