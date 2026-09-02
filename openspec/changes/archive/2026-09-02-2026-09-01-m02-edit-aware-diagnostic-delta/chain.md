# M-02 Feature Branch Chain

Issue: #144 (`status:approved`, `type:bug`).

```text
main ← tracker fix/m02-edit-aware-diagnostics
     ← exploration/proposal
     ← specification/design/tasks
     ← RED fixtures
     ← GREEN implementation
     ← evidence/docs
     ← verify/judgment/archive
```

## Delivery rules

- The tracker is draft and must not merge until every child is accumulated and final CI passes.
- Child PR #1 targets the tracker branch; every later child targets its immediate predecessor.
- Each authored review unit stays at or below 400 changed lines and about 60 minutes of review.
- Every PR links issue #144 and has exactly one `type:*` label.
- RED precedes GREEN; generated ledgers remain protocol-valid and receipt-bound.
- DeepSeek Harness keeps exactly its guarded catalog; apply remains absent and direct invocation denied.

## Scope boundary

Only edit-aware diagnostic delta matching and its operation-policy integration belong to M-02. M-01, R-01, F-01, UI specialization, Code Mode, general source maps, and Harness apply authorization remain out of scope.
