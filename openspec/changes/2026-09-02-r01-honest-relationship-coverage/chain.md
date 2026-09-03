# R-01 Feature Branch Chain

Issue: #161 (`status:approved`, `type:bug`).

```text
main ← tracker fix/r01-honest-relationship-coverage
     ← exploration ← proposal ← specification ← design ← tasks
     ← U1 MCP RED ← U2 coverage ledger/budget ← U3 scoped calls
     ← U4 direct containment ← U5 public/candidates ← U6 matrix
     ← U7 evidence/gates ← U8 Judgment/verify/archive
```

## Delivery rules

- The human selected `feature-branch-chain` after a High-risk 2,015–2,570-line forecast.
- The tracker remains draft and cannot merge until all children accumulate deepest-first and final CI passes.
- Child PR #1 targets the tracker branch; every later child targets its immediate predecessor.
- Each authored review unit remains at or below 400 changed lines and approximately 60 review minutes.
- Every PR links approved issue #161 and has exactly one `type:*` label.
- U1 preserves the intended RED until U3 supplies exact scoped calls; no intermediate claim may mask it.
- Runtime units use distinct acquire/settle receipts and valid `apply-progress.json` evidence.
- DeepSeek Harness keeps exactly 15 guarded tools; apply remains absent and direct invocation denied.

## Scope boundary

Only honest bounded compiler relationship coverage and its affected-test completeness gate belong to R-01. T-01 path reconstruction, F-01 output encoding, heuristic/index authority, new relationship kinds, runtime ownership, and Harness apply authorization remain out of scope.
