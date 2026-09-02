# Design: Edit-aware prepared-operation diagnostic deltas

## Technical approach

Preparation compares compiler observations through deterministic edit maps from exact UTF-16 `originalText`/`updatedText`. Only diagnostics wholly inside proven unchanged runs may cancel; touched or uncertain diagnostics remain removed/added. Public projections stay unchanged.

```text
before observations + original text ─┐
                                     ├─ changed pairs → bounded maps → delta → policy/hash/retain
 after observations + updated text ──┘                                  │
                                                        persist v2 → apply/receipt
```

## Architecture decisions

| Decision    | Choice and rationale                                                                                                                                                                                                                                                                 | Rejected alternative                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Coordinates | Zero-based UTF-16 code units, matching TypeScript `start`/`length`.                                                                                                                                                                                                                  | Lines/columns mis-handle same-line edits, CRLF, and surrogate pairs.                                            |
| Alignment   | Bounded Myers shortest-edit script after maximal equal prefix/suffix trimming; visit diagonals in increasing order and choose deletion before insertion on equal reach. Coalesce adjacent non-equal operations into ordered half-open hunks. This makes repeated text deterministic. | Position identity causes harmless-shift false positives; semantic/bipartite matching can recreate cancellation. |
| Uncertainty | Fail closed with one coarse middle hunk.                                                                                                                                                                                                                                             | Accepting partial alignment can authorize an in-edit twin.                                                      |
| Persistence | New plans and receipts use envelope/hash domain v2; v1 prepared plans are denied, verified v1 applied receipts remain replayable.                                                                                                                                                    | Recompiling v1 plans is complex and compiler-version dependent.                                                 |

## Internal contracts

`observeDiagnostic()` returns `{ public: NormalizedDiagnostic, start: number | null, length: number | null, ordinal: number }`; only `public` enters `DiagnosticDelta`. `normalizeDiagnostic()` remains the public projection wrapper.

`buildEditContext(oldText, newText, budget, requestContext)` returns maximal unchanged runs and changed hunks. Operation-global caps are 1,000,000 frontier/snake steps, 250,000 trace cells per file, and 10,000 hunks. Checkpoint initially, every 4,096 comparisons, each frontier/hunk/file/partition, and before sorting/retention. A cap discards partial work and emits one hunk between proven non-overlapping equal prefix/suffix; an unproven side is empty. Cancellation/deadline propagates unchanged, never as fallback.

For boundary classification, diagnostic `[start,start+length]` and hunk endpoints are closed: intersection, either abutment, and zero-width insertion/deletion points are touched. Untouched observations map affinely within one unchanged run and cancel only equal code/category/file/message, mapped start, and length. Sort by file, identity, start, length, then ordinal; match FIFO.

Normative cases: created-file after diagnostics are added; deleted-file before diagnostics are removed. Affected-file missing spans never cancel. Unchanged files require equal textual identity and identical available span (including both spans absent). Unfiled diagnostics use deterministic multisets including nullable line/column. CRLF counts as two units; surrogate pairs count as two; BOM bytes add no compiler offset. Internal spans/maps are neither serialized nor exposed.

## Preparation, hash, and receipt flow

`createPlan()` will: capture before observations/text and authenticate disk text; mutate; capture after observations; enumerate and sort provisional changed text pairs (including creations); recheck the workspace snapshot; build maps and corrected delta; materialize authenticated bytes/hashes/modes/previews; perform the existing final workspace check; derive `blocked`; compute v2 hash; checkpoint; retain. No source write occurs, and the existing catch removes a post-retention record on cancellation/failure.

`planHashFor(record, 2)` changes its canonical domain field to `version: 2`, binding corrected delta, policy, files, and existing metadata. `operation-plan-file.ts` parses strict v1/v2 envelopes. Persist emits only v2. Apply rejects v1 `prepared` before import. A v1 `applied` record is imported with v1 hash verification and may replay only through the existing per-file exact updated-hash check; its receipt remains v1. V2 apply/receipt remains atomic and idempotent. Inspection reports the parsed `1 | 2` version.

## File changes

| File                                  | Change                                                       |
| ------------------------------------- | ------------------------------------------------------------ |
| `src/services/diagnostics.ts`         | Observation, mapper, fallback, matcher.                      |
| `src/services/operations.ts`          | Reordered preparation, v2 hash domain, cancellation cleanup. |
| `src/services/operation-plan-file.ts` | Strict dual reader, v2 writer, state cutover.                |
| Three focused test files              | RED, edge matrix, persistence/receipt cutover.               |

## Exact test plan

- `test/operations.test.ts`: “blocks a same-identity replacement while preserving an unrelated shifted diagnostic”; assert one replacement TS2322 added, unrelated TS2322 absent, blocked apply, unchanged disk. Retain scaffold/rename and `allow_new_errors=true` coverage.
- `test/diagnostics.test.ts`: deterministic repeated text; two disjoint edits; insertion/deletion/replacement; duplicate FIFO; both abutments; intersection; zero-width insertion/deletion; created/deleted/unchanged/unfiled; missing span; CRLF, surrogate, BOM-excluded offset; each of three caps; cancellation at mapping and matching checkpoints.
- `test/operation-plan-file.test.ts`: new envelope/hash is v2; v1 prepared rejected without writes; v1 applied exact postimage replays; mismatched postimage fails; v2 receipt failure recovery/replay stays idempotent.
- Run focused Vitest files, then `yarn format:check`, `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, package smokes, `test/dsh-adapter.test.ts`, and `scripts/dsh-adapter-smoke.mjs`; Harness must remain guarded-15, apply absent, direct call `UNKNOWN_TOOL`.

## Delivery, rollback, and threats

Keep RED, mapper, operation integration, persistence cutover, and evidence as autonomous chain units of at most 400 authored changed lines, each with focused verification and rollback. Rollback mapper/integration/v2 writing together; continue reading verified applied v1 receipts, never re-enable v1 prepared plans.

Threat matrix: N/A — no new routing, shell, subprocess, VCS, executable classification, or process-integration boundary. No Harness checkout changes are permitted.

## Open questions

None.
