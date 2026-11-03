# Verification Report: Angular template references

- Change: `2026-11-03-angular-template-references` (issue #370, tracker #371, follow-up #380)
- Verified head: `feat/angular-template-references-u4-docs` (31 commits over `main`, clean tree)
- Mode: Strict TDD, hybrid artifact store
- Verdict: **PASS WITH WARNINGS** (0 CRITICAL, 4 WARNING, 3 SUGGESTION)

## Completeness

| Metric                           | Value                                          |
| -------------------------------- | ---------------------------------------------- |
| Tasks                            | 27 implementation tasks plus pre-apply 0.1-0.4 |
| Done                             | 26 (4.3 partial: description polish deferred)  |
| Blocked                          | 3.8 (ATN-R8), deferred by maintainer decision  |
| Specs / requirements / scenarios | 4 / 23 / 53                                    |
| Scenarios compliant              | 52 of 53; ATN-R8 open and deferred             |

## Runtime evidence (each command run once at the U4 head)

| Command                                   | Exit | Result                                                                                     |
| ----------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `yarn typecheck`                          | 0    | clean                                                                                      |
| `yarn lint`                               | 0    | clean                                                                                      |
| `yarn format:check`                       | 0    | All matched files use Prettier code style                                                  |
| `yarn build`                              | 0    | clean                                                                                      |
| `env -u GIT_EDITOR yarn test`             | 0    | 91 files passed; 1304 passed, 2 skipped (v22-only arrow cases); supervised-worker 2 passed |
| `yarn test:package`                       | 0    | passed                                                                                     |
| `yarn test:mcp`                           | 0    | passed                                                                                     |
| `yarn test:cli`                           | 0    | passed                                                                                     |
| `yarn test:errors`                        | 0    | passed                                                                                     |
| `yarn test:lifecycle`                     | 0    | passed                                                                                     |
| `env -u GIT_EDITOR yarn test:dsh-adapter` | 0    | passed against public 0.13.0                                                               |

- Compiler majors v20, v21 and v22 all executed under Node 24.
- Commit hygiene: no `Co-Authored-By` or "Generated with" lines in `main..HEAD`.
- Frozen files unchanged vs `main`: `src/tools/explore.ts`, `get_impact.ts`, `find_test_candidates.ts`, `src/services/relationships.ts`, `context-builder.ts`, `impact.ts`, `test-candidates.ts`.
- No new error codes in the `src` diff; only `INCOMPLETE_EVIDENCE`, `MUTATION_BLOCKED`, `CONFLICT`, `AMBIGUOUS_APPLY` are used.

## TDD compliance

| Check                 | Result    | Details                                                                                     |
| --------------------- | --------- | ------------------------------------------------------------------------------------------- |
| TDD evidence reported | OK        | `apply-progress.json` `tdd_evidence` has a row per task 1.1-4.3                             |
| All tasks have tests  | OK        | Every row names an existing test file or the package-smoke assertion                        |
| RED confirmed         | OK / WARN | Guard-style tasks (2.1, 2.4, 3.1, 3.7, 3.9) pass at once by design ("no production change") |
| GREEN confirmed       | OK        | All named files pass in the full run                                                        |
| Triangulation         | OK        | describe.each over v20/v21/v22, three out-of-range versions, several unresolved forms       |
| Safety net            | OK        | Present for modified files; N/A for the new bench                                           |

Assertion quality spot-checked in `angular-templates`, `references-templates`, `workspace-hash`, `operations-templates`, `project-watch`, `tools/find_references`: concrete values, real compiler runs, no tautologies.

## Spec traceability

| Requirement / scenario                                                       | Implementation                                                                                         | Test                                                                                                         | Status                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| ATR-R1 compiler absent / out of range / capability / realpath / majors       | `angular-templates.ts` `loadCompiler`, `isSupportedVersion`, `isUnderAncestorNodeModules`              | `angular-templates.test.ts:115,124,137,147,157`; `tools/find_references.test.ts:147`                         | COMPLIANT                                 |
| ATR-R1 core absent                                                           | `hasAngularCore`                                                                                       | `angular-templates.test.ts:98`; `tools/find_references.test.ts:50,81`; `workspace-hash.test.ts:64,72`        | COMPLIANT                                 |
| ATR-R1 optional peer, not bundled                                            | `package.json`, `scripts/package-smoke.mjs`                                                            | `dependency-policy.test.ts:118`; `yarn test:package`                                                         | COMPLIANT                                 |
| ATR-R2 literal, same-name, escape, symlink/hardlink, computed, inherited     | `locateTemplate`, `checkTemplatePath`, `memberOwner`, `hasDerivedComponent`, `assertSafeOperationFile` | `angular-templates.test.ts:186,212,232,239,254,271`; `safe-file.test.ts:33`                                  | COMPLIANT                                 |
| ATR-R3 kinds, control flow and pipes, inline                                 | `extractUsages`                                                                                        | `angular-templates.test.ts:299,320,334,391`; `references-templates.test.ts:126,144`                          | COMPLIANT                                 |
| ATR-R4 local, `$event`, outside scope, `localsInScope`                       | scope stack                                                                                            | `angular-templates.test.ts:347,353,360,371,382`                                                              | COMPLIANT                                 |
| ATR-R5 unparseable, fully covered                                            | `collectTemplateUsages`                                                                                | `angular-templates.test.ts:406,417`; `references-templates.test.ts:186`; `tools/find_references.test.ts:147` | COMPLIANT                                 |
| ATR-R6 size, node bound, cancel, many                                        | 512 KiB, 100k nodes, checkpoint; `paginate`                                                            | `angular-templates.test.ts:424,434,444,453`; `references-templates.test.ts:115,201`                          | COMPLIANT                                 |
| ATR-R7 parity and counts                                                     | `collectSymbolReferencesWithTemplates`; `find_references.ts` schema                                    | `tools/find_references.test.ts:116,131,141`; `references-templates.test.ts:100,155`                          | COMPLIANT                                 |
| ATR-R7 inventory re-baseline                                                 | none needed (descriptions and inputs frozen)                                                           | n/a                                                                                                          | PARTIAL (W3)                              |
| ATR-R8 not diagnosed                                                         | diagnostics untouched                                                                                  | `diagnostics.test.ts:466`; `explore-unchanged.test.ts:43,76`                                                 | COMPLIANT                                 |
| ATR-R8 descriptions and docs state the limit                                 | docs only                                                                                              | `angular-docs.test.ts:24,32,40,48`                                                                           | docs COMPLIANT; description DEFERRED (W2) |
| ATN-R1 updates, stale html, overlap, BOM, mode                               | `prepareRename`, `planAuxiliaryFiles`                                                                  | `operations-templates.test.ts:126,135,150,170,262,280,299,453`                                               | COMPLIANT                                 |
| ATN-R2 rollback                                                              | existing rollback with html `PlannedFile`                                                              | `operations-templates.test.ts:464,478`                                                                       | COMPLIANT                                 |
| ATN-R3 inline blocks                                                         | `assertTemplateRenameAllowed`                                                                          | `operations-templates.test.ts:308`                                                                           | COMPLIANT                                 |
| ATN-R4 unresolvable, inherited, compiler missing                             | same                                                                                                   | `operations-templates.test.ts:318,326,349`                                                                   | COMPLIANT                                 |
| ATN-R5 local collision, `$any`                                               | same                                                                                                   | `operations-templates.test.ts:355,362`                                                                       | COMPLIANT                                 |
| ATN-R6 non-Angular unchanged                                                 | `not_applicable` path                                                                                  | `operations-templates.test.ts:368,392`                                                                       | COMPLIANT                                 |
| ATN-R7 pipe not renamed                                                      | n/a                                                                                                    | `operations-templates.test.ts:290`                                                                           | COMPLIANT                                 |
| ATN-R8 description states template writes, TS-only diagnostics               | not implemented (task 3.8)                                                                             | none                                                                                                         | OPEN / DEFERRED (W1)                      |
| TWF-R1 edit changes hash; compiler-independent                               | `workspace.ts` template paths                                                                          | `workspace-hash.test.ts:107,117`                                                                             | COMPLIANT                                 |
| TWF-R2 byte identity                                                         | goldens                                                                                                | `workspace-hash.test.ts:64,72`                                                                               | COMPLIANT                                 |
| TWF-R3 watcher                                                               | `project.ts` `watchedFilePaths` (both call sites)                                                      | `project-watch.test.ts:50,60,74`                                                                             | COMPLIANT                                 |
| TWF-R4 removed template                                                      | unlisted, coverage `template_unresolved`                                                               | `workspace-hash.test.ts:126`                                                                                 | COMPLIANT                                 |
| TWF-R5 pre-upgrade plan                                                      | existing CONFLICT path                                                                                 | `operations-templates.test.ts:582`                                                                           | COMPLIANT                                 |
| EWS-R1 later conflict, proof lost, template earlier                          | sequential apply and rollback                                                                          | `operations-templates.test.ts:478,493`                                                                       | COMPLIANT                                 |
| EWS-R2 receipt failure, replay/cancel, html in receipts, diagnostics TS-only | invariants                                                                                             | `operations-templates.test.ts:196,520,540,563`                                                               | COMPLIANT                                 |

## Design conformance

| Decision                                                                 | Result                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler from user project via `createRequire` + `import(pathToFileURL)` | Followed; cache key is realEntry@version                                                                                                                      |
| Optional peer `>=20.0.0 <23.0.0`, not bundled                            | Followed; verified by `test:package`                                                                                                                          |
| Realpath containment under an ancestor `node_modules`                    | Followed                                                                                                                                                      |
| Statuses and reasons                                                     | Four statuses, eight reasons, match spec and Zod schema                                                                                                       |
| Usage kinds                                                              | Exactly `TemplatePropertyRead`, `TemplatePropertyWrite`, `TemplateCall`                                                                                       |
| Bounds                                                                   | 512 KiB (external and inline), 100,000 nodes, checkpoint every 1,000 nodes and between templates                                                              |
| `find_references` additive fields                                        | `origin`, `template_coverage`, `template_reference_count` optional; non-Angular output deep-equals the golden; `reference_count` TS-only; `total` counts both |
| Rename ordering                                                          | `collectTemplateUsages` -> `assertTemplateRenameAllowed` -> count -> `node.rename`                                                                            |
| Error codes                                                              | Reused only                                                                                                                                                   |
| `.html` out of diagnostics `textChanges`                                 | Tested                                                                                                                                                        |
| Hash includes templates, compiler-independent                            | `listTemplateFiles` is sync and compiler-free; `sourceDigest` stays TS-only                                                                                   |
| Watcher call sites                                                       | Both use `watchedFilePaths`                                                                                                                                   |
| Chain                                                                    | U1a/b/c, U2a/b, U3a/b/c, U4 as recorded in `chain.md`                                                                                                         |

## Issues

CRITICAL: none.

WARNING

- W1. ATN-R8 / task 3.8 open: the `rename_symbol` description does not state template writes or the TS-only diagnostics limit. Cause: the mandatory `yarn test:dsh-adapter` smoke freezes every tool description and input schema against the public 0.13.0 package. The limit is documented in README, skill, `operations.md` and CHANGELOG. Resolve when the public baseline moves past a release containing this feature.
- W2. ATR-R8 description clause unmet for the same reason; the docs clause is met (`angular-docs.test.ts`). The 4.3 description polish is deferred with 3.8.
- W3. ATR-R7 "inventory MUST be re-baselined": nothing was re-baselined because descriptions and inputs are frozen and output-schema additions are not hashed. Inventory golden, `registry-consumer-smoke.mjs` and `canary-local-mcp.mjs` are unchanged vs `main`. Satisfied in the sense that no re-baseline was needed.
- W4. Tracking: pre-apply 0.3 and 0.4 were unchecked although done (tracker #371 exists; goldens recorded in 3.1), and apply-progress still listed the 0.2 issue number as pending although #380 is in the docs. Fixed by the orchestrator in the same commit as this report.

SUGGESTION

- S1. `hasDerivedComponent` marks a component's own members `unsupported / inherited_member` whenever any component derives from it, even for members it declares itself. Fail-closed and spec-consistent, but it over-blocks rename. Consider narrowing to members actually inherited, or document it.
- S2. `ast_explore` template evidence is tracked in #380. Nothing further.
- S3. `apply-progress.json` is JSON rather than the markdown TDD cycle table the protocol names. Evidence is complete.

## Open items

- ATN-R8 / task 3.8 and the ATR-R8 description clause: deferred until the public dsh-adapter baseline moves. CHANGELOG Unreleased carries the exact deferred description text.

## Recommendation

Archive can proceed once the maintainer accepts ATN-R8 as a recorded, deferred spec gap. Otherwise open a follow-up task for 3.8 and the description polish.
