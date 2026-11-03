# Tasks: Angular template references

Strict TDD: every task names its RED test first (file + test name), then GREEN, then refactor. Gates per task: `yarn test` (targeted), then per unit `yarn typecheck && yarn lint && yarn format:check && yarn build`; U2-U3 also `yarn test:mcp`, `yarn test:cli`, `yarn test:errors`, `yarn test:lifecycle`.

## Review Workload Forecast

| Unit      | Scope                                                                                                       | Est. changed lines |
| --------- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
| U1        | Service, `safe-file.ts` move, fixtures helper, alias devDeps, ignore entries, dependency-policy             | ~600               |
| U2        | `collectSymbolReferencesWithTemplates`, find_references schema/TOON, inventory, explore-unchanged test      | ~350               |
| U3        | Async `mutate`, auxiliary `.html` edits, snapshot template set, `currentWorkspaceHash`, watcher dirs, tests | ~550               |
| U4        | Docs, skill, tool descriptions, package metadata, package-smoke                                             | ~200               |
| **Total** |                                                                                                             | **~1700**          |

- Chained PRs recommended: Yes
- 800-line budget risk: High as a single PR (~1700); Low per unit (each <= 800, max ~600)
- Decision needed before apply: No (strategy resolved: `auto-chain`, `feature-branch-chain`)
- Chain strategy: feature-branch-chain. Tracker branch `feat/angular-template-references` (draft, no-merge). U1 targets tracker; U2 targets U1 branch; U3 targets U2 branch; U4 targets U3 branch. Only the tracker merges to main.
- Branch naming: `feat/angular-template-references-u1-service`, `-u2-find-references`, `-u3-rename`, `-u4-docs`.
- Details: `chain.md`.

## Spec ID key (for verify traceability)

- ATR = angular-template-references: R1 Detection+compiler gate (S: absent, out-of-range, majors, core-absent); R2 Owning component+resolution (S: literal, same-name, escape, symlink/hardlink, computed, inherited); R3 Usage extraction (S: kinds, control-flow/pipes, inline); R4 Shadowing (S: local, event, outside-scope); R5 Completeness (S: unparseable, fully-covered); R6 Bounded work (S: many, size, node-bound); R7 Additive schema+TOON (S: parity, counts); R8 Diagnostics TS-only (S: not-diagnosed).
- ATN = angular-template-rename: R1 Hash-bound edits (S: updates, stale-html); R2 Rollback; R3 Inline blocks; R4 Incomplete/unsupported blocks (S: unresolvable, inherited, compiler-missing); R5 Collisions (S: local, $any); R6 Non-Angular unchanged; R7 Out-of-scope (pipe); R8 Description states TS-only diagnostics.
- TWF = template-workspace-freshness: R1 Hash includes templates (S: edit changes hash, compiler-independent); R2 Byte-identity (S: regression); R3 Watcher (S: edit between requests, dir without TS); R4 Unreadable fail closed (S: removed); R5 Pre-upgrade plans conflict.
- EWS = external-writer-safe-apply: R1 Sequential not atomic (S: later conflict, rollback proof lost, template earlier); R2 Invariants (S: receipt fails, replay/cancel, template in receipts, diagnostics TS-only).

## Pre-apply checklist

- [x] 0.1 Open the GitHub issue for this change (repo uses GitHub Issues, `docs/agents/issue-tracker.md`) and record its number in `state.yaml` (`proposal.issueNumber`) and `proposal.md` ("Issue: #___"). The executor must NOT create it; the human/orchestrator does.
- [ ] 0.2 Open the follow-up issue "Template evidence in ast_explore" (design Risks) and note its number in the U4 docs.
- [ ] 0.3 Create tracker branch `feat/angular-template-references` from main and open the draft tracker PR.
- [ ] 0.4 Record the non-Angular workspace-hash golden hex from `main` BEFORE any U3 code lands (needed as the U3 RED fixture; capture in U3 task 3.1 against unmodified `workspace.ts`).

---

## Unit 1: Angular template service (branch `feat/angular-template-references-u1-service`, ~600 lines)

- [ ] 1.1 Move `assertSafeOperationFile` to `src/services/safe-file.ts` (pure move, re-export-free; update importers).
  - RED: `test/safe-file.test.ts` > "rejects symlink, multi-link, foreign owner and out-of-root files" (same cases as the existing operations coverage); existing operations tests must stay green.
  - GREEN: create module, import from `operations.ts`. REFACTOR: none.
  - Spec: ATR-R2 (symlink/hardlink, escape). Parallel: no (1.2+ depend on it).
- [ ] 1.2 Repo hygiene and dev tooling: add `.tmp/` to `.gitignore`, `.prettierignore`, `eslint.config.js` ignores; add devDeps aliases `angular-compiler-v20/-v21/-v22` (`npm:@angular/compiler@...`) and optional peer `@angular/compiler >=20.0.0 <23.0.0` with `peerDependenciesMeta.optional`; refresh `yarn.lock`. Confirm Yarn 4 does not enforce dep `engines` (design assumption).
  - RED: `test/dependency-policy.test.ts` > "declares @angular/compiler as an optional peer and not a dependency".
  - GREEN: package.json/lock edits. Spec: ATR-R1.
  - Parallel with 1.1 (disjoint files).
- [ ] 1.3 Fixture helper `createAngularFixture(files, { compiler })` under `test/helpers/` writing into `.tmp/angular-fixtures/` (stub `@angular/core`, symlink to alias).
  - RED: `test/angular-fixture.test.ts` > "resolves the aliased compiler through createRequire from the fixture dir" and > "fixture with compiler:null has no compiler".
  - Spec: ATR-R1 (S: majors). Depends on 1.2.
- [ ] 1.4 Detection and compiler gate (`loadCompiler`, `listTemplateFiles`, coverage types).
  - RED: `test/angular-templates.test.ts` > "core absent returns not_applicable and lists no templates", "compiler missing yields unfinished/compiler_missing", "out-of-range version yields compiler_unsupported", "missing required export yields compiler_unsupported", "realpath outside ancestor node_modules is rejected (os.tmpdir fixture)", and `describe.each(v20,v21,v22)` "loads supported major" (v22 skipped below its Node floor).
  - GREEN: implement per design (createRequire + import(pathToFileURL), cache by path+version, package.json check before import).
  - Spec: ATR-R1 (all four S), ATR-R5 (compiler-related unfinished). Depends on 1.1, 1.3.
- [ ] 1.5 Template location (`locateTemplates`): literal `templateUrl`, no-substitution template literal, inline `template`, declaring-class-only ownership, safety rules, computed URL, inherited-member.
  - RED: `test/angular-templates.test.ts` > "resolves literal templateUrl", "same member name in another component is not a usage", "templateUrl escaping root is template_unsafe", "symlink/hardlink template is template_unsafe", "computed templateUrl is template_unresolved", "derived component yields unsupported/inherited_member".
  - Spec: ATR-R2 (all six S). Depends on 1.4.
- [ ] 1.6 Usage extraction (`extract` visitor with scope stack): read/write/call kinds, `@if/@for/@switch`, pipes args, microsyntax, `@let`, `#ref`, `let-x`, `$event`, `localsInScope`, inline container.
  - RED (describe.each over aliases): "extracts TemplatePropertyRead/Write/Call", "extracts through control flow and pipe arguments", "marks inline template usages container=inline", "@for item shadows member", "$event shadows member", "member read outside shadowing scope is still a usage", "records localsInScope", "write via PropertyWrite or assignment Binary (v20 AST)".
  - Spec: ATR-R3 (3 S), ATR-R4 (3 S). Depends on 1.5.
- [ ] 1.7 Completeness and bounds: parse errors -> `template_parse_error`; 512 KiB cap; 100k node cap; `rc.checkpoint()` cadence; coverage `completed` with template count.
  - RED: "unparseable template yields unfinished/template_parse_error", "fully covered returns completed with template count", "template over 512 KiB yields size_exceeded without parsing", "node bound exhaustion yields work_exhausted", "cancelled request stops between templates".
  - Spec: ATR-R5 (2 S), ATR-R6 (size, node-bound; "many" covered in U2). Depends on 1.6.
- [ ] 1.8 U1 gate: run all gates; verify `listTemplateFiles` is sync and compiler-free (test "listTemplateFiles does not load the compiler").
  - Spec: TWF-R1 (S: compiler-independent hash, enabling U3).

Dependency order: 1.1 || 1.2 -> 1.3 -> 1.4 -> 1.5 -> 1.6 -> 1.7 -> 1.8.

## Unit 2: find_references integration (branch `feat/angular-template-references-u2-find-references`, base U1, ~350 lines)

- [ ] 2.1 Extract the shared private TS-location helper in `references.ts`; sync `collectSymbolReferences` signature and output unchanged.
  - RED: `test/references.test.ts` > "collectSymbolReferences output unchanged after helper extraction" (golden against current output) and "non-Angular find_references output deep-equals pre-change golden".
  - Spec: ATR-R1 (S: core absent), ATR-R7 (non-Angular identical). Sequential first.
- [ ] 2.2 Implement async `collectSymbolReferencesWithTemplates`: merge, sort, paginate with `origin`, `kind`, `context`, `template_coverage`, `template_reference_count`; `reference_count` TS-only; `total` counts both.
  - RED: `test/references-templates.test.ts` > "merges template items with TS items and sorts deterministically", "paginates over mixed items with truthful total/has_more", "reference_count stays TS-only while total counts both", "origin is uniform per response", "fields absent when not_applicable", "many usages paginate" (ATR-R6 S: many).
  - Spec: ATR-R6, ATR-R7 (counts), ATR-R3. Depends on 2.1.
- [ ] 2.3 Wire `src/tools/find_references.ts` (full `ProjectContext` from `withProject`, `operationContext` as rc), additive output schema, description, `affected_files` includes `.html`; TOON parity.
  - RED: `test/tools/find_references.test.ts` > "JSON and TOON parity for Angular responses", "TOON stays tabular with uniform origin", "unfinished coverage is reported not silently dropped"; tool-inventory golden fails until re-baselined.
  - GREEN: handler + `test/fixtures/tool-inventory.json` re-baseline (find_references only).
  - Spec: ATR-R7 (parity, counts), ATR-R5 (unfinished reported). Depends on 2.2.
- [ ] 2.4 Diagnostics-unchanged and explore-unchanged guards.
  - RED: `test/explore-unchanged.test.ts` > "ast_explore output for an Angular member equals pre-change output"; `test/diagnostics.test.ts` > "template breakage is not diagnosed".
  - GREEN: no source change expected (`context-builder.ts`, `explore.ts` untouched; assert via test).
  - Spec: ATR-R8. Parallel with 2.3 (disjoint files).
- [ ] 2.5 U2 gate: all gates + `yarn test:mcp`, `yarn test:cli`. Confirm `find_test_candidates`/`get_impact` suites green.

Dependency order: 2.1 -> 2.2 -> 2.3; 2.4 parallel with 2.3; 2.5 last.

## Unit 3: Hash-bound `.html` rename (branch `feat/angular-template-references-u3-rename`, base U2, ~550 lines)

- [ ] 3.1 Golden first: record non-Angular workspace-digest golden hex from unmodified `main` code; include a project with `.html` and a fake `@Component` but no `@angular/core`.
  - RED: `test/workspace-hash.test.ts` > "non-Angular workspace digest is byte-identical (golden)" and > "html plus fake @Component without core is byte-identical". They pass at record time; they are the regression guard for 3.2.
  - Spec: TWF-R2. Must precede 3.2.
- [ ] 3.2 `createWorkspaceSnapshot` derives the template set via `listTemplateFiles`; `currentWorkspaceHash` uses the same function.
  - RED: `test/workspace-hash.test.ts` > "html edit changes the hash in an Angular project", "hash does not depend on compiler availability", "removed template fails closed".
  - GREEN: `workspace.ts` edit; 3.1 goldens stay green.
  - Spec: TWF-R1 (2 S), TWF-R4. Depends on 3.1.
- [ ] 3.3 Watcher directories: both `selectProjectWatchDirectories` calls in `project.ts` pass `[...sourcePaths, ...listTemplateFiles(context)]`.
  - RED: `test/project-watch.test.ts` > "template edited between requests invalidates the session", "template in a directory without TypeScript is watched".
  - Spec: TWF-R3 (2 S). Parallel with 3.4 after 3.2 (disjoint files: `project.ts` vs `operations.ts`).
- [ ] 3.4 Mechanical `mutate(context, rc)` async refactor of `createPlan` and its three callers (`prepareRename`, `prepareReplaceBody`, `prepareScaffoldClass`) with no behavior change.
  - RED: existing `test/operations*.test.ts` suites run first against a new test `test/operations.test.ts` > "createPlan mutate receives ProjectContext and RequestContext" (fails until signature changes); all existing suites stay green.
  - Spec: EWS-R2 (invariants preserved). Depends on 3.2.
- [ ] 3.5 `auxiliaryEdits` channel in `createPlan`: safe-file check, `expectedHash` vs snapshot, overlap rejection, descending application, `PlannedFileInternal` with BOM and mode, sorted merge, missing-from-snapshot containment guard, `.html` kept out of diagnostics `textChanges`.
  - RED: `test/operations-templates.test.ts` > "overlapping auxiliary edits are rejected", "auxiliary edit with stale hash raises workspace-changed", "html PlannedFile preserves BOM and mode", "html edit absent from diagnostics textChanges".
  - Spec: ATN-R1, EWS-R2. Depends on 3.4.
- [ ] 3.6 `prepareRename` integration: call `collectTemplateUsages` before `node.rename`; block on coverage not completed/n.a. (`INCOMPLETE_EVIDENCE`), inline usage or `newName` in `localsInScope` or `$any` (`MUTATION_BLOCKED`); count template edits in `reference_count`; pipe names not renamed.
  - RED: "rename updates TS and external template (apply writes both)", "inline usage blocks rename", "unresolvable template blocks rename", "inherited member blocks rename", "compiler missing blocks rename", "new name colliding with a local blocks the whole plan", "new name $any blocks", "plain TS project rename unchanged", "pipe name not renamed".
  - Spec: ATN-R1 (updates), ATN-R3, ATN-R4 (3 S), ATN-R5 (2 S), ATN-R6, ATN-R7. Depends on 3.5.
- [ ] 3.7 Apply-path guarantees (no new production code expected; adjust only if red): stale html after prepare, rollback of html, sequential-not-atomic, replay.
  - RED (using `setOperationTestHooksForTests`): "html edited after prepare yields CONFLICT", "TS commit failure after html restores html", "later target conflict leaves earlier html applied and reports AMBIGUOUS_APPLY/CONFLICT per contract", "rollback proof lost reports honestly", "template file earlier in sequence", "receipt persistence failure after commit", "replay and cancellation with html", "html in receipts and import/export replay", "plan prepared before upgrade conflicts (pre-upgrade plan)".
  - Spec: ATN-R1 (stale-html), ATN-R2, EWS-R1 (3 S), EWS-R2 (3 S), TWF-R5. Depends on 3.6.
- [ ] 3.8 `rename_symbol.ts` description (template writes; TS-only diagnostics) + inventory re-baseline.
  - RED: `test/tools/rename_symbol.test.ts` > "description states template edits and TS-only diagnostics"; inventory golden.
  - Spec: ATN-R8. Parallel with 3.7.
- [ ] 3.9 Snapshot cost benchmark smoke (design Risks): `test/workspace-snapshot-bench.test.ts` > "listTemplateFiles adds bounded overhead on a large non-Angular project".
- [ ] 3.10 U3 gate: all gates + all four smokes (`yarn test:mcp`, `test:lifecycle`, `test:cli`, `test:errors`).

Dependency order: 3.1 -> 3.2 -> (3.3 || 3.4) -> 3.5 -> 3.6 -> (3.7 || 3.8) -> 3.9 -> 3.10.

## Unit 4: Docs, skill, descriptions, package metadata (branch `feat/angular-template-references-u4-docs`, base U3, ~200 lines)

- [ ] 4.1 `scripts/package-smoke.mjs`: assert the optional peer is not installed in the consumer and the packed `dependencies` exclude `@angular/compiler`.
  - RED: extend smoke assertion first (fails if metadata wrong); `yarn test:package` equivalent script (check `package.json` scripts) green after.
  - Spec: ATR-R1 (optional, not bundled).
- [ ] 4.2 Skill and README docs: `skills/structural-code-editing/**` (template usage in find_references, rename blocks, ast_explore TS-only limit referencing follow-up issue from 0.2, compiler install guidance, PnP caveat), README section.
  - RED: `test/docs.test.ts` (or existing skill-lint test) > "skill documents ast_explore TS-only limit and compiler optional peer"; run any existing skill/doc lint.
  - Spec: ATR-R8, ATN-R8, ATR-R1.
- [ ] 4.3 CHANGELOG entry and final description polish; confirm inventory golden matches final descriptions.
  - RED: inventory golden test.
- [ ] 4.4 Final chain verification: gates on the U4 head, confirm each PR diff contains only its unit, update tracker PR body. Then hand to `sdd-verify`.

Dependency order: (4.1 || 4.2) -> 4.3 -> 4.4.

## Coverage matrix (every spec requirement has at least one task)

ATR-R1: 1.2, 1.3, 1.4, 4.1 | ATR-R2: 1.1, 1.5 | ATR-R3: 1.6, 2.2 | ATR-R4: 1.6 | ATR-R5: 1.4, 1.7, 2.3 | ATR-R6: 1.7, 2.2 | ATR-R7: 2.1-2.3 | ATR-R8: 2.4, 4.2
ATN-R1: 3.5-3.7 | R2: 3.7 | R3-R7: 3.6 | R8: 3.8
TWF-R1: 1.8, 3.2 | R2: 3.1 | R3: 3.3 | R4: 3.2 | R5: 3.7
EWS-R1: 3.7 | R2: 3.4, 3.5, 3.7
