## Exploration: edit-aware prepared-operation diagnostic deltas

### Current State

#### Authority and evidence

GitHub issue #144 is open, labeled `status:approved` and `type:bug`, and explicitly limits this change to M-02. The roadmap and Harness evidence annex both require a deterministic RED in which a same-code/message error is replaced inside an edit while an unrelated diagnostic shifts harmlessly. OpenSpec is authoritative for this exploration; the parent orchestrator owns the Mnemon mirror.

The AST MCP tools were present, but the project-status and outline calls returned no model-visible payload, so they could not establish compiler-backed freshness. The source conclusions below therefore come from exact bounded filesystem reads of the current checkout plus the issue body/comments; they are not presented as fresh compiler-relationship evidence.

#### Existing prepare sequence

`src/services/operations.ts:createPlan()` currently performs these steps:

1. Enter the project scheduler, create a fresh ts-morph project, and snapshot the workspace.
2. Collect `beforeDiagnostics` from config-file parsing diagnostics plus pre-emit diagnostics.
3. Save every source file's `getFullText()` in `originals` and verify decoded disk text equals the compiler text.
4. Run the structural `mutate()` callback only against the in-memory project.
5. Collect `afterDiagnostics` from that mutated project.
6. Call `compareDiagnostics(before, after)` immediately.
7. Only afterward enumerate changed source files and build `PlannedFileInternal` records containing `originalText`, `updatedText`, exact bytes, hashes, mode, and unified diff.
8. Recheck the disk workspace snapshot, derive `blocked` from `diagnosticDelta.addedErrors`, bind the delta into `plan_hash`, retain the operation, and return the public plan.

The critical ordering defect is steps 6–7: the exact before/after text pairs exist conceptually but are not available to the comparator when it decides diagnostic continuity.

#### Exact false negative

`normalizeDiagnostic()` preserves `line` and `column`, but `identity()` deliberately keys only:

```text
[code, category, project-relative file, message]
```

`subtract()` is a multiset subtraction. For an identity `I`, one before occurrence cancels one after occurrence regardless of where either diagnostic is located.

For the required case:

- before: old error `I` is inside the body that will be replaced;
- mutation: the body is replaced and introduces a distinct new error with the same `I`;
- after: new error `I` is inside the replacement;
- subtraction: the before count for `I` is one, so the after occurrence consumes it;
- result: the new error is absent from `added` and `addedErrors`;
- policy: `allow_new_errors=false` still yields `blocked=false`.

This is not merely missing presentation metadata: the incorrect equivalence authorizes a reviewed plan that should be mutation-blocked. Adding line/column directly to `identity()` is also wrong because any insertion or deletion before an otherwise unchanged diagnostic would turn it into a removed-plus-added pair.

### Affected Areas

- `src/services/diagnostics.ts` — diagnostic capture needs an internal offset/span form, and comparison needs edit context while preserving the public normalized shape.
- `src/services/operations.ts` — changed text pairs/edit maps must be built before diagnostic comparison; blocking, hashing, retention, and cancellation ordering consume the result.
- `src/services/operation-plan-file.ts` — persisted prepared plans made by the old comparator need an explicit compatibility/cutover rule; plan schema is currently strict version 1.
- `src/tools/operation-schema.ts` — should remain unchanged unless a later phase proves correction metadata must be public; current diagnostic output compatibility is preferable.
- `test/diagnostics.test.ts` — current unit seam proves only legacy position-insensitive multiset behavior and duplicate counting; it is the seam for edit-map, boundary, duplicate, created-file, CRLF, and BOM cases.
- `test/operations.test.ts` — the existing `prepareReplaceBody()` block test near the current new-error test is the correct compiler-backed RED seam.
- `test/operation-plan-file.test.ts` — covers strict schema, import/export, receipt replay, and is the seam for legacy prepared-plan handling.
- `test/dsh-adapter.test.ts` and `scripts/dsh-adapter-smoke.mjs` — unchanged verification seams proving the guarded 15-tool Harness catalog still excludes apply and rejects direct invocation.

### Deterministic Text and Position Model

#### Canonical coordinate space

Use TypeScript/compiler offsets over JavaScript strings: zero-based UTF-16 code-unit offsets. Capture each file-backed diagnostic internally as:

```text
{ public: NormalizedDiagnostic, start: number, length: number, end: start + length }
```

`Diagnostic.getStart()` and `getLength()` are both available and may be undefined. This internal record must never be serialized through `NormalizedDiagnosticSchema`.

Build one ordered, non-overlapping edit map per changed file from the exact `originalText` and `updatedText` held by the plan. Represent every hunk as two half-open spans:

```text
old [oldStart, oldEnd)  <->  new [newStart, newEnd)
```

Unchanged runs between hunks provide exact affine mappings: an old offset maps to the corresponding new run offset plus its displacement. This naturally supports multiple disjoint edits, insertions (`oldStart == oldEnd`), deletions (`newStart == newEnd`), and replacements.

#### Conservative span rule

A diagnostic is eligible for continuity only when its complete compiler span lies in an unchanged run and does not touch an edit boundary. Any file-backed diagnostic that intersects a changed hunk or touches either side of a hunk boundary is `touched` and cannot match across snapshots.

Boundary conservatism is intentional:

- a zero-width diagnostic exactly at an insertion point is touched;
- a diagnostic ending where a replacement begins is touched;
- a diagnostic starting where a replacement ends is touched;
- an insertion/deletion point is treated as a boundary on both coordinate sides.

This may report a nearby diagnostic as added, but it cannot let a new boundary diagnostic cancel an old textual twin. Diagnostics strictly inside unchanged runs map exactly.

#### Matching rules

1. Partition by project-relative file.
2. For unchanged files, match exact textual identity plus exact start/length; there is no text displacement to explain.
3. For changed files, never match touched before/after diagnostics.
4. For untouched diagnostics, map the before start/end through the edit map and match only the same textual identity at the exact expected after start/length.
5. Match duplicates as deterministic multisets keyed by textual identity plus mapped span, preserving source order only as a tie-break.
6. Diagnostics in a created file have no before counterpart; every after diagnostic in that file is added. A future whole-file deletion is symmetric: every before diagnostic is removed.
7. A file-backed diagnostic in an affected file with missing start or length is conservatively unmatched.
8. Unfiled diagnostics have no edit coordinate. Keep a deterministic legacy multiset by code/category/null-file/message and nullable location, and state explicitly that edit-aware continuity is not claimed for them. Semantic deduplication of unfiled compiler errors is outside M-02.

The public delta remains arrays of `NormalizedDiagnostic`; internal offsets and edit maps are discarded after comparison.

#### CRLF and BOM

Mapping must use the compiler/source-file text, not normalized lines and not raw byte offsets.

- CRLF remains two UTF-16 code units in the text. Unchanged `\r\n` sequences therefore map exactly, including same-line column shifts.
- A UTF-8 BOM is byte-encoding state, not a TypeScript source offset in this pipeline. `decodeSource()`/compiler text equality already establishes the text view, while `encodeUpdatedSource()` restores the BOM in bytes. The edit map must not add a synthetic BOM offset.
- UTF-16 and invalid UTF-8 are already rejected before planning and remain non-goals.

### Approaches

1. **Exact position identity** — add line/column or start/length to the current identity.
   - Pros: Small change; expected `O(B + A)` multiset cost for `B` before and `A` after diagnostics.
   - Cons: Every harmless shift becomes removed plus added; multi-line insertions before existing errors cause false blocking; line/column still does not express span intersection.
   - Failure mode: Fixes the false negative by creating the exact false positive prohibited by issue #144.
   - Effort: Low, but unacceptable.

2. **Line/column translation** — compute line and column deltas around changed line ranges and translate before locations.
   - Pros: Easier to inspect than raw offsets; approximately `O(E + (B + A) log E)` after edits are known.
   - Cons: Multiple edits on one line, tabs, surrogate pairs, CRLF, insertions at line boundaries, and multi-line replacements require increasingly ad hoc rules. Diagnostic spans still need more than one point.
   - Failure mode: Two text edits can have the same line delta but different columns; boundary overlap becomes ambiguous.
   - Effort: Medium, with fragile correctness.

3. **Text-offset edit mapping** — diff exact before/after UTF-16 text into hunks, map diagnostics only through unchanged runs, and classify touched spans conservatively.
   - Pros: Directly matches compiler coordinates; handles disjoint insertion/deletion/replacement; CRLF is naturally preserved; exact outside shifts remain stable.
   - Cons: Edit-script construction has cost and repeated-text ambiguity; the algorithm needs deterministic tie-breaks, cancellation checkpoints, and a work budget.
   - Complexity: Mapping and matching are `O((B + A) log E)` after `E` hunks. A Myers-style diff is typically `O((N + M)D)` time for text lengths `N/M` and edit distance `D`, with implementation-dependent memory and quadratic worst cases.
   - Failure mode: An unbounded character diff can monopolize preparation; a nondeterministic repeated-text alignment can alter boundary classification.
   - Effort: Medium/High, but it provides the right coordinate semantics.

4. **Conservative bipartite/multiset matching** — create candidate edges between same-identity diagnostics, score inside/outside status and positional distance, then choose a matching.
   - Pros: Can express duplicates and uncertainty; a general model can prefer outside mapped matches.
   - Cons: A matcher that permits in-edit edges recreates the vulnerability. Maximum/weighted matching can cost `O(k^3)` per identity group and requires arbitrary tie-breaks; greedy matching is cheaper but can be order-sensitive.
   - Failure mode: Repeated same-message diagnostics can be paired across the wrong edit, especially when edits reorder or duplicate text.
   - Effort: High if general; unnecessary when touched edges are prohibited.

### Minimal Deterministic RED

Add one integration test beside `test/operations.test.ts`'s existing “blocks a replacement that introduces a new TypeScript error” test. Use `createProjectFixture()` and `prepareReplaceBody()` so the failure is observed at the real compiler/preparation policy boundary, not only in a synthetic comparator unit.

Before source:

```ts
export function value(): number {
  const previous: number = "wrong";
  return previous;
}

export const unrelated: boolean = 0;
```

Replacement body:

```ts
const replacement: number = "wrong";

return replacement;
```

Expected compiler facts:

- The old and replacement body errors are both TS2322, category Error, same file, with message `Type 'string' is not assignable to type 'number'.`; only position and local identifier differ.
- The unrelated TS2322 has message `Type 'number' is not assignable to type 'boolean'.` and shifts downward solely because the replacement body adds lines.

RED assertions:

- `prepared.blocked === true` under the default `allow_new_errors=false`.
- `addedErrors` contains exactly the replacement-body string-to-number error.
- `addedErrors` does not contain the unrelated number-to-boolean error.
- `applyOperation()` is mutation-blocked and disk source remains the original.

Current code returns no added errors for either identity and therefore `blocked=false`; the first assertion is deterministically RED. A naive exact-position fix makes the unrelated assertion RED, so the same fixture guards both sides of the contract.

Follow with focused unit cases in `test/diagnostics.test.ts` for two disjoint edits, insertion, deletion, replacement, duplicate identities, touched boundaries, zero-width spans, created files, CRLF, BOM-excluded text coordinates, missing locations, and deterministic fallback. Keep persisted-cutover tests in `test/operation-plan-file.test.ts`.

### Compatibility, Persistence, and Integration

#### Public compatibility

Keep `NormalizedDiagnostic`, `DiagnosticDelta`, `PreparedOperationOutputSchema`, serialized field names, and `allow_new_errors` semantics unchanged. Internal offset/span records and edit maps are implementation details. Corrected plans can contain different `added`/`removed` arrays and a different `plan_hash`; that behavioral change is the bug fix, not a schema break.

`compareDiagnostics()` is currently imported only by tests and operations within this repository. It may gain an operation-specific context or be wrapped by a new internal edit-aware comparator, while public MCP schemas remain untouched.

#### Persisted plans and receipts

`planHashFor()` already binds the diagnostic delta, and persisted plan schema version 1 stores that delta plus exact original/updated bytes. New plans therefore bind corrected results without persisting edit maps.

However, a prepared v1 plan produced by the old comparator can survive a process restart and pass current strict import/hash checks while retaining the unsafe `blocked=false` decision. The correction must not silently grandfather that authorization. Fail-closed options for the design phase are:

- introduce plan schema/comparison version 2; reject legacy **prepared** v1 plans, while permitting already-applied v1 receipts to be inspected/replayed only after exact postimage verification; or
- re-run before/after compiler diagnostics and edit-aware comparison from persisted original/updated bytes during legacy prepared-plan import, accepting only an identical safe result.

The first is smaller and easier to audit; the second preserves more prepared plans but adds compiler reconstruction complexity and may reject on compiler drift anyway. Recommendation: version the persisted comparison contract, deny legacy prepared plans, and retain applied-receipt recovery. Add explicit tests before changing `PLAN_SCHEMA_VERSION`.

#### Integration order in `operations.ts`

Recommended ordering inside `createPlan()`:

1. Capture internal before diagnostic observations and original source texts.
2. Verify disk/compiler text equality as today.
3. Mutate the in-memory project.
4. Capture internal after diagnostic observations.
5. Enumerate changed source files into provisional before/after text records, including created files.
6. Recheck the untouched disk workspace snapshot before spending authority on the result.
7. Build bounded per-file edit maps from those exact text pairs.
8. Compare diagnostics edit-aware and derive the public delta.
9. Materialize bytes, hashes, modes, and previews (or reuse already-read values), then derive `blocked`.
10. Bind the corrected delta and any persisted comparison version into the reviewed plan, checkpoint, retain, and preserve the existing post-retention cancellation cleanup.

No step should write source files. Preparation remains outside completion-critical apply publication.

#### Cancellation and performance

- Check cancellation before/after compiler diagnostic collection, per changed file, during diff iterations/chunks, per emitted hunk, per diagnostic partition/group, before sorting/matching, and before retention.
- A request cancellation/deadline must propagate as its existing typed terminal error; it must never be converted into a comparison fallback.
- Bound edit-map work. On an internal diff-work cap (distinct from cancellation), fall back deterministically to one coarse changed span formed by longest common prefix/suffix and mark the entire middle touched. This can over-block but cannot authorize the false negative.
- Use stable file ordering and stable numeric offset ordering; do not depend on locale or object iteration for matching decisions.
- The added normal-path cost is one diff per changed file plus `O((B + A) log E)` mapping. Do not diff unchanged files. Existing request deadlines remain the outer bound.

### Recommendation

Adopt **text-offset edit mapping with a conservative touched-span partition**. Capture compiler start/length internally, derive deterministic UTF-16 hunks from exact planned before/after text, prohibit all cross-snapshot matching for diagnostics that intersect or touch edits, and match only exact textual identities at exact mapped spans outside edits. Use deterministic multiset counts for duplicates and a coarse whole-middle fallback when a dedicated diff-work cap is exceeded.

This is fail-closed at the claimed boundary: uncertainty increases `addedErrors` and can block preparation; it never makes an uncertain new in-edit error disappear. It also preserves harmless shifted diagnostics whenever continuity is provable through unchanged text.

Bite-sized planning implications:

1. RED slice: add the operation integration fixture and focused comparator boundary cases without production changes.
2. Mapping slice: introduce internal diagnostic observations, deterministic edit hunks, cancellation/work bounds, and unit tests.
3. Policy slice: reorder `createPlan()`, consume edit-aware comparison, and prove `allow_new_errors` behavior for all operation kinds.
4. Persistence slice: version/reject unsafe legacy prepared plans while preserving applied-receipt verification.
5. Evidence slice: run format, lint, typecheck, focused/full tests, build/package gates, and exact Harness guard checks; make no Harness checkout changes.

The existing feature-branch chain already requires review units at or below 400 authored changed lines, so mapping and operation integration should remain separate reviewable children if their combined forecast approaches that budget.

### Risks

- Repeated text can yield multiple valid edit scripts; deterministic tie-breaking and conservative boundaries are mandatory.
- Coarse fallback may block safe operations in very large or adversarial files; this is an availability tradeoff, not a safety relaxation.
- Compiler diagnostic spans may be missing; affected-file missing spans must not fall back to textual cancellation.
- Legacy prepared persisted plans retain the old unsafe decision unless explicitly invalidated or revalidated.
- Public arrays may show more removed/added diagnostics near edit boundaries; this is expected conservative behavior and should be specified.
- The AST MCP status/outline calls supplied no model-visible freshness evidence in this session, so no compiler-backed relationship absence is claimed.

### Verified Threat and Semantic Boundary

This change protects the prepared-operation authorization decision when file-backed TypeScript diagnostics are compared across the exact in-memory text edits of one hash-bound plan. It distinguishes provably unchanged mapped spans from touched/ambiguous spans across all planned files.

It does not prove semantic identity between two diagnostics at the same mapped span, solve unfiled diagnostic causality, create a general source-map system, alter compiler parity, change workspace freshness/publication/rollback, or address R-01/F-01. External-writer publication remains M-01's separate boundary. No DeepSeek Harness checkout edit is required or allowed.

The shipped Harness patch still sets `AST_MCP_APPLY_GUARD=deny`; the guarded catalog must remain 15 tools, `mcp__ast__ast_apply_operation` must remain absent, and direct invocation must remain rejected. M-02 changes preparation diagnostics only and must not create any Harness apply continuation.

### Ready for Proposal

Yes. The proposal should commit to the offset-map plus conservative touched-span architecture, preserve public diagnostic shapes, explicitly handle legacy prepared persisted plans, and require the dual-purpose RED before implementation.
