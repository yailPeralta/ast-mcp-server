# Archive Report: Edit-aware diagnostic delta

## Outcome

- **Change**: `2026-09-01-m02-edit-aware-diagnostic-delta`
- **Archive date**: 2026-09-02
- **Source**: `openspec/changes/2026-09-01-m02-edit-aware-diagnostic-delta/`
- **Target**: `openspec/changes/archive/2026-09-02-2026-09-01-m02-edit-aware-diagnostic-delta/`
- **Canonical capability**: `openspec/specs/edit-aware-diagnostic-delta/spec.md`
- **Status**: archive done; delivery pending; task progress intentionally remains 20/21 with task 6.6 unchecked
- **Store**: hybrid, with OpenSpec authoritative; parent-owned memory mirroring is outside this executor

## Authority and chain

Issue #144 is the approved M-02 bug. Tracker #145 and children #146–158 form the feature-chain context; the admitted verify snapshot records #145–157 as open, #145 as draft, incomplete CI rollups, and some unstable checks. Child #158 is the verification PR. The archive/delivery PR has not yet been created or numbered. This archive does not claim any archive PR, CI, tracker merge, issue closure, roadmap edit, commit, or push.

Strict verification is `PASS` at evidence revision `sha256:fcc4bab113f3f0cb76d67bd21a43ba9333bf154c2b0ac7875301fe82da9349f1`: zero blockers, zero critical findings, 7/7 requirements, 8/8 scenarios, focused 74/74, full 965+2, and adapter/catalog 23/23. Judgment Day reached terminal `APPROVED`; J-M02-001 is resolved, remaining severe findings are zero, and both scoped re-judges approved receipt `sha256:d248369b2f4772f68078287d26df6c881ef27436a5ef98c46f13da33a0c23cc5`. J-M02-I01 remains informational.

## Capability and implementation

The first canonical specification is a standalone current-state specification with exactly seven normative requirements and eight scenarios. It preserves internal UTF-16 observations, bounded deterministic edit context, unchanged-run continuity, fail-closed touched spans, lifecycle/text edge cases, corrected preparation authority, and compatibility/cutover behavior.

Implementation authority remains in:

- `src/services/diagnostics.ts`
- `src/services/operations.ts`
- `src/services/operation-plan-file.ts`
- `test/diagnostics.test.ts`
- `test/operations.test.ts`
- `test/operation-plan-file.test.ts`

The persistence/hash envelope cutover is v2. New records emit v2; prepared v1 records are denied; applied v1 receipts may replay only after exact postimage verification. Public diagnostic and `allow_new_errors` shapes remain compatible.

## Harness denial

The exact preserved denial is: the guarded catalog contains 15 tools, `mcp__ast__ast_apply_operation` is absent, and direct invocation returns error code `UNKNOWN_TOOL` with no apply continuation. Evidence authenticated Harness revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`; no Harness checkout file was changed.

## Archive checks

- Canonical mechanical-copy readback: `diff -r` exit 0 with empty output before standalone heading conversion.
- Archive mechanical-move readback: recursive pre-move snapshot versus target, exit 0 with empty output.
- Active source path is absent; the archive preserves exploration, proposal, delta spec, design, tasks, chain, evidence, apply progress, Judgment ledger, strict verify report, and state.
- Canonical count: 7 requirements and 8 scenarios; no delta framing remains.
- Archived strict validator: `sdd-verify-validate` exit 0 with verdict `pass`, 7/7 and 8/8.
- JSON/YAML parse, OpenSpec heading checks, archive inventory, and `git diff --check` pass.
- Authored archive unit remains within the 400-line review budget; mechanical rename accounting is excluded.

### Verbatim mechanical readbacks

Canonical copy:

```text

```

Archive move:

```text

```

## Delivery pending

1. Keep task 6.6 unchecked until its complete delivery contract is satisfied.
2. Create the unnumbered archive/delivery PR after #158, then accumulate it and all predecessor children into tracker #145 with clean immediate-predecessor diffs.
3. Obtain final CI rollup and resolve any unstable checks.
4. Merge the tracker only after every child is accumulated and final CI passes.
5. Close issue #144 only after merge evidence exists; any roadmap update remains separately prohibited for this archive unit.

## Rollback and history policy

The archive is immutable audit history: do not rewrite or delete it. If canonical adoption must be rolled back before delivery, remove the new canonical capability in a new corrective change while retaining this archive. Runtime rollback must revert the mapper, operation integration, and v2 writer together, keep v1 prepared plans denied, and preserve exact-postimage-only v1 applied recovery. Delivery actions must add later evidence rather than revising this archived snapshot.

## Next feature-chain accumulation

Next recommended action is `delivery`: create the still-unnumbered archive/delivery PR after verification PR #158, accumulate it through the feature chain into tracker #145, verify the tracker diff and final CI, then perform merge/closure under separate authority.
