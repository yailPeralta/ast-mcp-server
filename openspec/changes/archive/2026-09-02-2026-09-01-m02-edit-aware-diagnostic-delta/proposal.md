# Proposal: Edit-aware prepared-operation diagnostic deltas

## Intent

Prevent preparation from authorizing a harmful edit when a new in-edit TypeScript error has the same code, category, file, and message as an error removed by that edit. Their textual identities currently cancel, so `allow_new_errors=false` can return `blocked=false`; harmless position-only shifts must nevertheless remain continuous.

## Acceptance boundary

The dual-purpose RED replaces an in-body TS2322 with a distinct in-edit TS2322 of the same identity while an unrelated TS2322 shifts only because lines are added. It must prove the replacement error is added and blocks preparation/apply while the unrelated position-only shift remains continuous and is not added.

## Scope and capabilities

### New capability

- `edit-aware-diagnostic-delta` covers:
  - internal compiler-span observations that never enter public diagnostic payloads;
  - edit-aware, conservative continuity: provably unchanged mapped spans may match, while touched or uncertain affected-file spans cannot cancel;
  - deterministic bounded work, stable duplicate handling, cancellation preservation, and a fail-closed coarse fallback;
  - integration into operation preparation before blocking, hash binding, and retention;
  - a legacy cutover that rejects unsafe previously prepared plans rather than grandfathering old authorization, while preserving verified applied-receipt recovery;
  - focused regression, full quality/package, and exact Harness-denial gates.

### Modified capabilities

None.

## Compatibility and failure semantics

Public diagnostic/delta shapes, prepared-operation fields, and `allow_new_errors` semantics remain compatible. Corrected deltas, blocking, and plan hashes may change. Missing positions, ambiguity, or budget exhaustion must increase conservatism, never authorize an uncertain new error. Cancellation remains a typed terminal outcome, not fallback.

## Non-goals

No M-01, R-01, F-01, general source maps, semantic diagnostic deduplication, compiler-parity changes, publication/rollback redesign, or Harness apply authorization/continuation.

## Success criteria and evidence

- [ ] The dual-purpose compiler-backed RED passes at the preparation and mutation-block boundary; disk source remains unchanged.
- [ ] Focused cases cover multi-edit/boundary behavior, duplicates, created files, missing spans, CRLF/BOM coordinates, and deterministic fallback.
- [ ] Legacy prepared-plan rejection and applied-receipt recovery are proven.
- [ ] Format, lint, typecheck, focused/full tests, build/package gates pass; Harness still exposes 15 guarded tools, omits apply, and rejects direct invocation.

## Affected areas and delivery

| Area                                                                                      | Contract impact                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/services/diagnostics.ts`                                                             | Internal observations and conservative comparison |
| `src/services/operations.ts`                                                              | Preparation policy integration                    |
| `src/services/operation-plan-file.ts`                                                     | Legacy prepared-plan cutover                      |
| `test/diagnostics.test.ts`, `test/operations.test.ts`, `test/operation-plan-file.test.ts` | RED and regression evidence                       |
| `test/dsh-adapter.test.ts`, `scripts/dsh-adapter-smoke.mjs`                               | Unchanged Harness gates                           |

Auto-chain delivery separates RED, comparison, operation policy, persistence cutover, and evidence into children of at most 400 authored changed lines.

## Residual risks and rollback

Repeated text or coarse fallback may over-block safe edits; missing spans remain conservative. Roll back the comparison/integration and persisted-version cutover together, without changing public schemas or enabling legacy prepared authorizations.
