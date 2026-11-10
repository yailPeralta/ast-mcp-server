# Tasks: Template evidence in ast_explore (#380)

## Review Workload Forecast

| Field                    | Value                                                                  |
| ------------------------ | ---------------------------------------------------------------------- |
| Review budget            | 800 changed lines per PR (lockfile and generated fixture archives excluded) |
| PR 1 (core + schemas + tests + pins) | ~620 lines                                                 |
| PR 2 (benchmark, docs, skill bump, CHANGELOG) | ~300 lines (plus ~22 lines of generated `*-0.17.0.md.gz.base64` archives, excluded) |
| Total                    | ~920 authored lines across 2 PRs                                       |
| Delivery strategy        | auto-chain                                                             |
| Chain strategy           | stacked-to-main (PR 1 targets main; PR 2 targets PR 1's branch and is retargeted to main after PR 1 merges) |

Chained PRs recommended: Yes
800-line budget risk: High as a single PR (~920, over budget); Medium per slice (PR 1 ~620 has ~22% headroom, PR 2 ~300 has ample headroom). Both are under 800, but PR 1 is above 400 lines, so treat it as a high-attention review.
Decision needed before apply: No for the split (budget 800 and auto-chain were decided). One merge-ordering gate remains: PR 2 records the 4.8.0 skill bytes as predecessor for npm `0.17.0`. `0.17.0` is published to npm `next` (2026-11-10, gitHead e49987b, skill 4.8.0), so the gate is satisfied; the predecessor hashes come from the real `npm pack ast-mcp-server@0.17.0` tarball. The design's open question (publish ordering) is therefore closed.

### Conventions

- Branches: `feat/380-explore-template-evidence` (PR 1, base main), `docs/380-explore-template-evidence` (PR 2, base PR 1 branch; retarget to main after PR 1 merges).
- One `type:*` label per PR (`type:feature` for PR 1, `type:docs` for PR 2). PR 1 `Refs #380`; PR 2 `Closes #380`. Each PR links the approved issue. Chain Context section with a dependency diagram marking the current PR (📍) in both PR bodies.
- Conventional commits, one work unit per commit, no AI attribution. Tests live in the commit of the behaviour they verify. A RED commit-local state is made green by the paired GREEN task before push.
- Strict TDD: characterization goldens first (green on unmodified code), then RED, GREEN, REFACTOR inside each work unit.
- Every PR runs: `yarn typecheck`, `yarn lint`, `yarn format:check` (filtered to tracked files, for example `yarn prettier --check $(git ls-files '<globs>')`, because untracked `.claude/` and `openspec/changes/...` files fail the global check), the targeted vitest files listed per unit, and `yarn test:dsh-adapter` (descriptions and input schemas frozen). `yarn test:package` runs only from a clean worktree after commit. The full `yarn test` times out locally under load; CI covers it.
- Spec sync: tick the matching scenario in the delta specs when its task lands.
- No tool description or input schema changes anywhere in this change.

### Suggested Work Units

| Unit | Goal                                                    | PR (base) | Focused test                                                                                                                           | Runtime harness                               | Rollback boundary                         |
| ---- | ------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| 1    | Characterization goldens on unmodified behaviour        | 1 (main)  | `yarn vitest run test/template-evidence-schema.test.ts test/explore-unchanged.test.ts`                                                  | N/A: tests only                               | revert test files and the golden JSON; one `export` keyword |
| 2    | Verdict export in `references.ts`                       | 1 (main)  | `yarn vitest run test/references-template-verdict.test.ts test/references.test.ts`                                                      | N/A: export unused until unit 4               | revert `references.ts` and its test       |
| 3    | Shared template-evidence schema, find_references spread | 1 (main)  | `yarn vitest run test/template-evidence-schema.test.ts test/find-references*.test.ts`                                                   | N/A: schema bytes proven identical by golden  | revert `template-evidence-schema.ts` and `find_references.ts` |
| 4    | Builder switch, omission, explore schema, pins          | 1 (main)  | `yarn vitest run test/explore-template-evidence.test.ts test/explore-unchanged.test.ts test/tool-inventory.test.ts test/declared-tool-contracts.test.ts` | `yarn test:dsh-adapter`                       | revert unit 4 (pins revert with it)       |
| 5    | Batch parity, isolation                                 | 1 (main)  | `yarn vitest run test/mcp.integration.test.ts -t "explore"` and `test/explore-template-evidence.test.ts`                                | N/A: tests only                               | revert test additions                     |
| 6    | Benchmark script, recorded result                       | 2 (PR 1)  | `yarn vitest run test/benchmark-explore-templates.test.ts`                                                                              | `yarn benchmark:explore-templates`            | revert script, package.json entry, spike doc |
| 7    | Docs, skill 4.9.0, predecessor 4.8.0, CHANGELOG         | 2 (PR 1)  | `yarn vitest run test/angular-docs.test.ts test/skill-installer.test.ts`                                                                | `yarn test:package`                           | revert docs, skill, `releases.json`, archives |

## Spec scenario coverage map

| Spec / scenario                                                                              | Task                    |
| -------------------------------------------------------------------------------------------- | ----------------------- |
| references: Member used only in its template                                                 | 1.13, 1.14              |
| references: Verdict parity with find_references (`@Input`, `@Pipe`, inherited member)        | 1.13, 1.14              |
| references: Non-Angular output unchanged (non-Angular and `not_applicable`; direct and batch) | 1.2, 1.3, 1.14, 1.19    |
| references: Limit applies to the merged list (3 TS + 4 template, limit 5)                    | 1.13, 1.14              |
| references: Non-completed statuses (`compiler_missing`, `template_parse_error`, `size_exceeded`, `work_exhausted`, `inherited_member`) | 1.13, 1.14 |
| references: Template path failure (`unfinished` / `template_unresolved`)                     | 1.5, 1.6, 1.13, 1.14    |
| references: TypeScript reference collection failure (`references_unresolved`, no template fields) | 1.5, 1.6, 1.13, 1.14 |
| references: Cooperative errors propagate                                                     | 1.5, 1.6, 1.13, 1.14    |
| references: Isolation (impact, test candidates, call spines)                                 | 1.17, 1.18              |
| references: Batch parity (JSON and TOON)                                                     | 1.19, 1.20              |
| references: Thresholds measured (500 and 2000 components)                                    | 2.1 to 2.5              |
| references: Docs present                                                                     | 2.6 to 2.12             |
| omission: Incomplete coverage                                                                | 1.13, 1.14              |
| omission: Survives byte_limit trimming                                                       | 1.13, 1.14              |
| omission: Completed coverage (no omission for `completed` / `not_applicable`)                | 1.13, 1.14              |
| declared-contracts: Frozen inputs and descriptions (find_references schema byte-identical)   | 1.1, 1.8, 1.16          |
| declared-contracts: Pins consistent                                                          | 1.15, 1.16              |

## PR 1: feat/380-explore-template-evidence (~620, Refs #380)

Start: main at 727ca12. End: `ast_explore` reports template evidence with the find_references verdict, the three digest pins re-baselined, docs still say "TypeScript-only" (stale but passing; no release is cut between the PRs). Out of scope: benchmark, docs, skill bump, CHANGELOG (PR 2); a template read cache; any input or description change.

### Unit 1: characterization goldens (green on unmodified code)

- [x] 1.1 Export `ReferenceOutputSchemas` from `src/tools/find_references.ts` (visibility only; no tool contract change). Create `test/template-evidence-schema.test.ts` and `test/fixtures/find-references-output-schema.json`: golden of `JSON.stringify(z.toJSONSchema(ReferenceOutputSchemas[detail]))` for `locations` and `context`. The fixture is captured from unmodified code and the test passes immediately (characterization). Covers: find_references schema byte-identical.
- [x] 1.2 Characterization in `test/explore-unchanged.test.ts`: capture deep-equal goldens, before any switch, for (a) a non-Angular explore request and (b) an Angular symbol whose coverage is `not_applicable`, each run directly and in a batch. Passing on unmodified code. Covers: Non-Angular output unchanged.
- [x] 1.3 Keep a permanent non-Angular deep-equal guard in `explore-unchanged.test.ts` (the file is inverted in 1.13; this guard survives the inversion). Commit 1 `test(explore): characterize find_references schema and non-template explore output (#380)`.

### Unit 2: verdict export

- [x] 1.4 Verify the seam in the working tree: `collectSymbolReferencesWithTemplates` at `src/services/references.ts:202`, `collectTemplateUsages` at `angular-templates.ts:772`, and that only `find_references.ts`, `context-builder.ts` and `operations.ts` import `references.ts`.
- [x] 1.5 RED `test/references-template-verdict.test.ts` with `vi.mock` of `angular-templates.js`: (a) a template-half throw gives `{status:"unfinished", reason:"template_unresolved", templates:0}`, TS items tagged `compiler`, no template items, and `collectTemplateUsages` called exactly once; (b) a cooperative interruption (`REQUEST_CANCELLED`, deadline) from the template half is rethrown; (c) a throw from the TS half propagates unchanged and TS work runs once; (d) coverage `not_applicable` returns exactly what `collectSymbolReferences` returns (no `origin`, no coverage keys).
- [x] 1.6 GREEN `src/services/references.ts`: split `collectSymbolReferencesWithTemplates` into two private steps (template half = `collectTemplateUsages` plus usage-to-`SymbolReference` mapping; merge = TS locations, origin tags, sort, paginate) and add `collectSymbolReferencesWithTemplateVerdict(node, context, query, rc?)` with the same signature and return type. Only the verdict export wraps the template half (`isCooperativeInterruption` rethrown, any other error becomes the synthetic `unfinished/template_unresolved` verdict, merge runs once). The existing export keeps its behaviour.
- [x] 1.7 REFACTOR and verify: `yarn vitest run test/references-template-verdict.test.ts test/references.test.ts test/angular-templates.test.ts`; the find_references golden from 1.1 stays green. Commit 2 `feat(references): add template verdict collection with typed failure (#380)`.

### Unit 3: shared template-evidence schema

- [x] 1.8 RED extend `test/template-evidence-schema.test.ts`: `src/tools/template-evidence-schema.ts` exports `ReferenceOriginSchema` (`compiler`, `template_external`, `template_inline`), `TemplateCoverageSchema` (the 9-reason enum, moved verbatim) and `templateEvidenceFields` (`template_coverage`, `template_reference_count`, both optional); an assertion that `find_references.ts` imports them (no duplicated enum).
- [x] 1.9 GREEN create `src/tools/template-evidence-schema.ts`; `src/tools/find_references.ts` imports the leaf schemas (`:41-71`) and spreads `templateEvidenceFields` at the same key position (after `affected_files`, before the pagination fields). The golden from 1.1 must stay green unmodified (byte identity).
- [x] 1.10 REFACTOR and verify: `yarn vitest run test/template-evidence-schema.test.ts test/find-references*.test.ts test/tool-inventory.test.ts`. The inventory digest must not change in this unit (find_references registers no `outputSchema`). Commit 3 `refactor(tools): extract shared template-evidence schemas (#380)`.

### Unit 4: builder switch, omission, explore schema, pins

- [x] 1.11 RED `test/explore-unchanged.test.ts` inversion: the Angular member now shows template items; the source assertion requires `collectSymbolReferencesWithTemplateVerdict` in `context-builder.ts`. The non-Angular guard from 1.3 is kept.
- [x] 1.12 RED `test/explore-template-evidence.test.ts` skeleton against the fixtures used by `test/mcp.integration.test.ts` (Angular fixture near `:1558`); each scenario below is a failing test before 1.14.
- [x] 1.13 RED scenarios in `test/explore-template-evidence.test.ts`:
  - private member used only in its template: `completed`, `template_reference_count >= 1`, item `origin` `template_external` or `template_inline`;
  - parity with `ast_find_references` for a selector-public `@Input`, a `@Pipe` class and an inherited member (`template_coverage` and `template_reference_count` deep-equal);
  - fixture-reachable non-completed reasons `compiler_missing`, `template_parse_error`, `size_exceeded`; `work_exhausted` through a mocked collection; `inherited_member`; each yields the reason and `evidence_complete=false`;
  - shared limit: 3 TS + 4 template items with `reference_limit` 5 returns 5 items in `file:line:col` order, `template_reference_count` 4, `reference_count` counts TS items only, and the existing reference-limit omission is present;
  - one `template_coverage_incomplete` omission (category `incomplete`, component `references`) per non-completed selector; none for `completed` or `not_applicable`;
  - `byte_limit` survival: with a limit that drops the references block, the omission is counted in `omissions.total` and `omissions.counts` and `evidence_complete=false`; assert the reason in `omissions.details` only with a byte limit that leaves room for details;
  - template-half failure: TS references kept, coverage `unfinished/template_unresolved`, `template_coverage_incomplete` emitted, no `references_unresolved`;
  - TS-half failure: `references_unresolved` as today, no `template_coverage` and no `template_coverage_incomplete` for that selector, `evidence_complete=false`;
  - cooperative cancellation and deadline errors in either half propagate and are not turned into an omission or verdict;
  - `reference_detail=context` and the fallback path carry the same fields;
  - 2001-component fixture exhausts `SCAN_LIMITS.templates` (2000) by a margin of exactly one: assert a typed result that parses against `ExploreOutputSchema`, not a specific verdict unless the design fixes it (coverage status is one of the typed statuses).
- [x] 1.14 GREEN in one work unit:
  - `src/services/explore-presentation.ts`: append `"template_coverage_incomplete"` to `EXPLORE_OMISSION_REASONS` (`:6`);
  - `src/services/context-builder.ts`: `ExploreEvidence.references` becomes `SymbolReferencesWithTemplates`; the single call at `:378` becomes `collectSymbolReferencesWithTemplateVerdict(node, effectiveContext, {symbolPath: record.selector, includeDeclaration: true, detail: request.referenceDetail, offset: 0, limit: request.referenceLimit}, requestContext)`; the omission loop at `:422` pushes `{subject, category:"incomplete", component:"references", reason:"template_coverage_incomplete"}` when `template_coverage` is present and its status is neither `completed` nor `not_applicable`; builder omissions stay outside trimming; the existing catch at `:388-391` still reports `references_unresolved`;
  - `src/tools/explore.ts` (`:132-166`): `ExploreReferenceSchema` gains `origin: ReferenceOriginSchema.optional()`; the references object spreads `templateEvidenceFields` so the parse at `:324` no longer strips them. No input, description or `reference_limit` text change.
- [x] 1.15 (Archive note 2026-11-10: the canary pin was measured with the canary's own baseline `tools/list` request under `AST_MCP_APPLY_GUARD=allow`, as recorded in PR #451; the full `benchmark:production-readiness` canary run was not executed.) GREEN pins, same commit as 1.14 (the inventory test fails otherwise): recompute and update `tools_list_sha256` in `test/fixtures/tool-inventory.json`, the literal at `scripts/registry-consumer-smoke.mjs:61-62` and the literal at `scripts/canary-local-mcp.mjs:172-173`. The canary value comes from its own guard=allow run, never copied from the other two. Exactly these three locations hold `tools/list` digest literals.
- [x] 1.16 Verify unit 4: `yarn vitest run test/explore-template-evidence.test.ts test/explore-unchanged.test.ts test/tool-inventory.test.ts test/declared-tool-contracts.test.ts test/template-evidence-schema.test.ts`, then `yarn test:dsh-adapter` (descriptions and input schemas frozen). Confirm the find_references golden is still unmodified and green. Commit 4 `feat(explore): report template evidence and coverage omission (#380)`.

### Unit 5: isolation and batch parity

- [x] 1.17 RED isolation test in `test/explore-template-evidence.test.ts`: for a member with template usages, impact, test-candidate and call-spine evidence (and the corresponding `ast_explore` clusters) contain no `.html` path and no `template_*` origin. Note: three modules import `references.ts` (`find_references.ts`, `context-builder.ts`, `operations.ts`); `impact.ts`, `test-candidates.ts`, `call-spines.ts` and `relationships.ts` must not.
- [x] 1.18 GREEN: expected to pass by construction. If it fails, fix the leak in the spine builder; do not weaken the assertion. Include a static import assertion that `impact.ts`, `test-candidates.ts`, `call-spines.ts`, `relationships.ts` do not import `references.ts`.
- [x] 1.19 (Archive note 2026-11-10: the `not_applicable` and non-Angular batch assertion lives in `test/explore-unchanged.test.ts`, not in `test/mcp.integration.test.ts`.) RED `test/mcp.integration.test.ts` (next to `:1558`): direct and batch `ast_explore` for an Angular request return equal fields, omissions and completeness; the TOON-decoded batch result equals the JSON result. Also asserts the `not_applicable` and non-Angular batch output is unchanged from the 1.2 golden.
- [x] 1.20 GREEN: expected to pass after unit 4; fix batch plumbing only if it does not. Verify: `yarn vitest run test/mcp.integration.test.ts -t "explore" test/explore-template-evidence.test.ts`. Commit 5 `test(explore): prove template evidence isolation and batch parity (#380)`.

### PR 1 verification and PR body

- [x] 1.21 `yarn typecheck`, `yarn lint`, `yarn format:check` (tracked files), all vitest files listed above, `yarn test:dsh-adapter`; commit, then from a clean worktree `yarn test:package`. Record the exact result of each in the PR body.
- [x] 1.22 Open PR 1 against main with `type:feature`, `Refs #380`, Chain Context (PR 1 📍, PR 2 follows), the three pin locations and the golden as the proof of no contract drift, and the rollback note (revert PR 2 first, then PR 1).

## PR 2: docs/380-explore-template-evidence (~300, Closes #380; needs PR 1)

Start: PR 1 branch. End: benchmark recorded and within threshold, docs and skill describe explore template evidence, skill 4.9.0 shipped with the 4.8.0 predecessor, docs test no longer asserts the TypeScript-only limit. Out of scope: a template read cache (follow-up issue only if the benchmark fails); any contract change (no pin churn in this PR).

### Unit 6: benchmark

- [x] 2.1 RED `test/benchmark-explore-templates.test.ts`: the script's report shape at `components: 3, runs: 1` (fields: case name, components, p50, p95, cold first call, peak RSS, typed-result flag); no timing assertion, so it cannot flake.
- [x] 2.2 GREEN `scripts/benchmark-explore-templates.mjs` and the `benchmark:explore-templates` entry in `package.json`. It imports `generateMatrixProject` and `createAngularFixture` (as the #421 spike does). Cases: `components: 167` (501 components) and `components: 667` (2001 components). Query `label`, `detail: "full"`, `limit: 20`, 20 `@Input` members. Baseline is the same tree without `@angular/core`. Each case: 1 warm-up plus 10 measured runs; records p50/p95 wall time, cold first call, peak RSS; asserts that every 2000-component response parses against `ExploreOutputSchema`. It is a script run on demand, not part of `yarn test`, so CI cannot become flaky.
- [x] 2.3 Run `yarn benchmark:explore-templates` on the PR 1 build. Threshold: added p95 versus the non-Angular baseline at most 2 s for detail=full, limit=20, about 500 components; every 2000-component request finishes with a typed result.
- [x] 2.4 Record the result in `docs/spikes/0380-explore-template-latency.md` (machine, Node version, commit SHA, per-case table) and in Engram `sdd/2026-11-10-explore-template-evidence/benchmark` (type `discovery`).
- [ ] 2.5 (Archive note 2026-11-10: not triggered. Both thresholds passed, so no follow-up issue was opened and no stop applied.) FAILURE PATH: if either check fails, open a follow-up issue for a request-scoped template read cache, record its number in the spike doc, and STOP before PR 2 is merged (PR 1 is not blocked by this; the cache itself is out of scope). Do not proceed to unit 7 merge until the issue exists.

### Unit 7: docs, skill, predecessor, CHANGELOG

- [x] 2.6 RED `test/angular-docs.test.ts` (`:29-31`): invert `/ast_explore[^\n]*TypeScript-only/i` and `/issue #380/` so they no longer assert the TypeScript-only limit; assert the new statements: shared `reference_limit` rule, `origin`, `template_coverage`, `template_reference_count`, the `template_coverage_incomplete` omission, and that template items are paged through `ast_find_references`. Fails until 2.7 to 2.9.
- [x] 2.7 GREEN README Angular section: the shared limit rule, new fields, the omission, paging through `ast_find_references`; remove the "TypeScript-only" explore limitation.
- [x] 2.8 GREEN skill `SKILL.md` and `references/operations.md`: same statements; read `template_coverage` before trusting explore references; treat non-completed as unknown.
- [x] 2.9 GREEN `CHANGELOG.md` Unreleased entry: additive output fields, new omission reason, shared `reference_limit`, `tools/list` digest re-baseline (output schema only, descriptions and inputs unchanged), benchmark reference.
- [x] 2.10 RED+GREEN skill bump 4.8.0 to 4.9.0: take the 4.8.0 predecessor hashes from the real `npm pack ast-mcp-server@0.17.0` tarball (as PR #448 did for 0.16.0; see the `test/skill-installer.test.ts` fixture entries and `test/fixtures/structural-code-editing-*0.16.0*`). Add the predecessor entry with `npm_versions: ["0.17.0"]` to `releases.json`, the two generated `*-0.17.0.md.gz.base64` archives, and the matching `test/skill-installer.test.ts` expectations. RED first: the installer test names 4.9.0 and the 0.17.0 predecessor before the bump.
- [x] 2.11 Confirm no pin churn: `tool-inventory.json`, `registry-consumer-smoke.mjs` and `canary-local-mcp.mjs` are unchanged in PR 2 (they moved in PR 1).
- [x] 2.12 (Archive note 2026-11-10: PR #452 has four commits; `docs(spikes): record explore template latency results (#380)` and `test(explore): harden template evidence parity, isolation and cancellation (#380)` were added to the two listed here.) Verify: `yarn typecheck`, `yarn lint`, `yarn format:check` (tracked files), `yarn vitest run test/angular-docs.test.ts test/skill-installer.test.ts test/benchmark-explore-templates.test.ts test/tool-inventory.test.ts`, `yarn test:dsh-adapter`, and from a clean worktree after commit `yarn test:package`. Commits: 6 `feat(benchmark): measure explore template latency (#380)`, 7 `docs(explore): document template evidence and bump skill to 4.9.0 (#380)`.
- [x] 2.13 (Archive note 2026-11-10: the PR 2 branch is `docs/380-explore-template-evidence-docs`, PR #452, retargeted to main after PR #451 merged.) Open PR 2 against the PR 1 branch (retarget to main after PR 1 merges) with `type:docs`, `Closes #380`, Chain Context (PR 2 📍), the benchmark table and the threshold verdict.

## Order and parallelism

- Sequential across PRs (stacked): PR 1 then PR 2. PR 2 needs PR 1's build for the benchmark.
- Within PR 1: units 1 to 4 are sequential (each depends on the previous seam); 1.5 (unit 2 tests) and 1.8 (unit 3 tests) may be authored in parallel after unit 1; unit 5 needs unit 4. Pins (1.15) must be in the same commit as the explore schema change (1.14).
- Within PR 2: 2.1 to 2.5 (benchmark) and 2.6 to 2.9 (docs) are parallel; 2.10 (skill bump) is independent of both; PR 2 merge requires 2.5 to be settled.

## Risks

- PR 1 (~620) is over 400 lines and is one high-attention review; the largest file is `test/explore-template-evidence.test.ts` (~240). If it passes 800 at 1.20, split unit 5 (tests only) into a preceding or following PR with no contract change.
- The three digest pins must land in PR 1 with the schema change; any intervening change to `ast_explore` schema or tool descriptions conflicts with them. The canary pin must come from its own guard=allow run.
- Predecessor hashes must come from the real 0.17.0 tarball, not the working tree; a mismatch breaks installer upgrade detection. 0.17.0 is already published, so no publish-ordering risk remains.
- The 2001-component case depends on a margin of exactly one against `SCAN_LIMITS.templates`; tests assert a typed result, so a future limit change does not make them lie.
- The benchmark can fail the 2 s threshold on slow machines; the failure path is a follow-up issue plus a stop before PR 2 merges, not a CI failure.
- Docs stay stale ("TypeScript-only") between PR 1 and PR 2; no release may be cut in between.
