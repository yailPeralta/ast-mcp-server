# Exploration: template type checking for rename plans (#421)

## Current state (evidence)

### How a rename plan is built

`createPlan` (`src/services/operations.ts`, ~L440-620):

1. Snapshots the workspace with `createWorkspaceSnapshot` (`src/services/workspace.ts:104`). The snapshot already includes template files, through `listTemplateFiles`.
2. Collects `beforeObservations` with `observeProjectDiagnostics` (L214), which is ts-morph `getConfigFileParsingDiagnostics()` + `getPreEmitDiagnostics()`.
3. Runs `prepareRename` (L690-754). It:
   - collects the template usages;
   - calls `planTemplateEdits` (`src/services/angular-template-rename.ts:88`);
   - runs `node.rename`;
   - returns the template edits as `auxiliaryEdits` with `expectedHash`.
4. Collects `afterObservations`.
5. `compareObservedDiagnostics` (`src/services/diagnostics.ts:500`) maps the old diagnostic positions through the edit hunks.
6. Sets `blocked = !allowNewErrors && diagnosticDelta.addedErrors.length > 0` (L582).
7. `planHashFor` (L152) hashes the `DiagnosticDelta`.

`.html` files are never part of the TS program, so `getPreEmitDiagnostics` cannot see template errors. That is the gap #421 describes.

### Budgets

- `RequestContext` (`src/services/request-context.ts`) only provides an abort-signal `checkpoint()`. It has no work counter for diagnostics.
- `work_exhausted` is a template-scan coverage reason. The limits are in `angular-templates.ts:84`: 2000 templates, 32 MiB, 1M nodes, 512 KiB per template.
- The diagnostics diff has its own `EditBudget` (`diagnostics.ts:190-231`).
- `PreparedOperationOutputSchema` (`src/tools/operation-schema.ts:13-41`) carries only `diagnostics {added, removed, added_errors}`, `blocked` and `block_reason`.

### Compiler loading

`loadCompiler` (`angular-templates.ts:150`) resolves the project's own `@angular/compiler`:

- It resolves through `createRequire(tsConfigFilePath)`.
- It requires that the realpath is under an ancestor `node_modules`.
- It accepts majors 18-22 (`MIN/MAX_COMPILER_MAJOR`, L80-81).
- It reports `compiler_missing` or `compiler_unsupported`.

No compiler is ever bundled.

### Packaging

- `@angular/compiler` is an optional peer, `>=18 <23`.
- The dev dependencies are the aliased compilers `angular-compiler-v18` through `angular-compiler-v22`.
- There is no `@angular/compiler-cli` and no real `@angular/core` in the repo. `test/helpers/angular-fixture.ts` stubs `@angular/core`.

### Docs and contracts

These places pin that diagnostics are TypeScript-only:

- `src/tools/rename_symbol.ts:31` ("diagnostics stay TypeScript-only")
- `src/tools/find_references.ts:89` ("template errors are not diagnosed")
- the spec
- `test/angular-docs.test.ts`

Changing these descriptions requires re-baselining `test/fixtures/declared-tool-contracts.json`, the docs, the skill and the README.

## Q1 Feasibility

Source: npm registry metadata. Nothing was executed.

| Major   | ESM only | TS peer range | Notes                                     |
| ------- | -------- | ------------- | ----------------------------------------- |
| 18.2.14 | yes      | `>=5.4 <5.6`  | exports `.`, linker, `private/*` subpaths |
| 19.2.15 | yes      | `>=5.5 <5.9`  | same shape                                |
| 20.3.34 | yes      | `>=5.8 <6.0`  | engines: Node ^20.19 / ^22.12             |
| 21.2.25 | yes      | `>=5.9 <6.1`  | `private/*` wildcard                      |
| 22.2.4  | yes      | `>=6.0 <6.1`  | pins `@angular/compiler` 22.2.4 exactly   |

- **Entry point.** The public `.` entry should export `NgtscProgram`, `createCompilerHost`, `readConfiguration` and `OptimizeFor`. This is not confirmed, so a spike must check it per major. Do not use the `private/*` subpaths: they differ between majors.
- **Loading.** The package can be loaded in-process with dynamic `import()` from a path resolved against the project. ESM-only `exports` maps may break `createRequire.resolve`, so we may need a fallback through `package.json` plus `bundles/index.js`.
- **TypeScript coupling.**
  - ngtsc uses the project's `typescript`, and only accepts the TS range of its major.
  - ts-morph 28 bundles TS 6.0.2. This repo's dev TS is 5.9.3.
  - So ngtsc cannot reuse the ts-morph program. It needs a second program, with its own `CompilerHost`, that serves the post-rename TS and `.html` text from an in-memory overlay.
  - `createFreshProject` (`operations.ts:490, 573`) already reloads the post-rename text, so the overlay can reuse `afterText` and the auxiliary payloads.
- **Typed unavailable statuses.** A missing `compiler-cli`, a TS version outside its range, or a mismatch between Angular core and compiler-cli must each degrade to a typed unavailable status.
- **Still unknown.** The spike has to settle:
  - how `getNgSemanticDiagnostics` and `getTemplateTypeChecker().getDiagnosticsForFile(sf, OptimizeFor.SingleFile)` behave per major;
  - what analysis has to run first;
  - how `.html` resources are handled;
  - how `angularCompilerOptions` (`strictTemplates`) is read through `readConfiguration`.

## Q3 Cost

- **Analysis is always whole-program.** ngtsc analyses the whole program (decorators, NgModule scopes) even to check one component. Only the type-check-block generation and checking can be scoped. A prepare therefore costs one full ngtsc analysis for the before state and another for the after state, because the "worse" verdict needs a baseline.
- **The main saving.** `getDiagnosticsForFile(..., OptimizeFor.SingleFile)` or `getDiagnosticsForComponent` can be scoped to the files that own edited templates.
- **On top of today's work.** This adds to the existing ts-morph before and after diagnostics. Expect seconds to tens of seconds on real apps, plus another TS program in memory. Nothing here has been measured.
- **Deadlines.** ngtsc is synchronous and cannot honour `checkpoint()`. Only a worker or child process that is killed at the deadline keeps the deadlines honest. The repo already has a supervised worker (`test/supervised-worker.integration.test.ts`).

## Q4 Scope and verdict

| Option                                              | Pros                           | Cons                                                             |
| --------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| A. Own templates only                               | Smallest                       | Misses the #408 consumer rewrites, where breakage is most likely |
| B. Own + consumer templates, edited components only | Matches what the plan rewrites | Needs the consumer list (available via `auxiliaryEdits`)         |
| C. Every template in the project                    | Most complete                  | Cost, and noise from pre-existing errors                         |
| External library templates                          | n/a                            | The plan cannot rewrite them, so out of scope                    |

**Refuse or warn?** Reusing `blocked` for worsened template diagnostics matches the TS behaviour and gives the strongest guarantee. The risk is that ngtsc false positives would block valid renames. Those can come from version skew, partial analysis, or unresolved `.d.ts` files or standalone imports. Today the only escape would be `allow_new_errors`, which also waives TS errors.

**Recommendation:**

- Use scope B.
- Diff before and after, matched by code, message and mapped position.
- Warn by default. Block only on an explicit opt-in. The proposal settles the exact semantics.

## Q5 Output contract

- Add an optional prepared-operation field. The existing `diagnostics` shape stays as it is:

  `template_diagnostics: { status: "completed" | "unavailable" | "unfinished" | "not_applicable", reason?, added, removed, added_errors }`

  It reuses `NormalizedDiagnosticSchema` (`operation-schema.ts:4`).

- Possible reasons: `compiler_cli_missing`, `compiler_unsupported`, `typescript_incompatible`, `work_exhausted`, `deadline`, `check_failed`.
- Never report an empty `completed` when the check failed. This follows the honest `template_coverage` model.
- `planHashFor` must include the template delta. Rollback and `affected_files` hashes are unaffected, because no new files are written.
- **Re-baseline cost.** It has to be budgeted explicitly. It covers:
  - the `rename_symbol` and `find_references` descriptions;
  - `declared-tool-contracts.json`;
  - the README, CHANGELOG and skill;
  - the specs in `openspec/specs/angular-template-{references,rename}`;
  - `test/angular-docs.test.ts`.

## Approaches

| #   | Approach                                                  | Effort | Notes                                                          |
| --- | --------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| 1   | In-process ngtsc, whole program, before and after         | Medium | Deadline cannot be enforced; uses more memory. Not recommended |
| 2   | ngtsc in a worker or child process, scope B, typed result | High   | Honest deadlines and isolation. **Recommended**                |
| 3   | Keep TS-only diagnostics and improve the docs             | None   | Does not address #421                                          |
| 4   | API in the style of `@angular/language-service`           | High   | Extra dependency, no clear gain over ngtsc                     |

## Recommendation

Proceed, behind a gate:

1. **Spike first, as a gating task.** Run it on all 5 majors, with a real `@angular/core` and `@angular/compiler-cli`. It must confirm:
   - the public API;
   - the overlay host;
   - the TS peer matrix;
   - timings on a medium fixture.

   If the matrix or the timings are unacceptable, stop at documenting the limitation.

2. **If the spike passes,** implement approach 2 with scope B, the optional `template_diagnostics` field, and warn by default.
3. **Test infrastructure.** Tests need a real `@angular/core` and `@angular/compiler-cli` as dev dependencies, per major. This makes the fixture matrix heavier and CI slower.
4. **Delivery.** Expect 3–4 stacked PRs within the 800-line budget:
   1. the spike;
   2. the loader and the worker;
   3. the diff and the contract;
   4. the docs and the re-baseline.

## Risks

- The TS peer ranges conflict between majors and with ts-morph's TS 6.0.2. Expect frequent `typescript_incompatible`.
- ngtsc is synchronous and cannot be interrupted. Deadlines are only honest with a worker.
- Memory: one or two extra full programs per prepare.
- False positives and baseline drift. The "worse" delta must be matched by mapped position and message, not by count.
- Re-baselining the pinned descriptions and contracts is expensive.
- Not verified by execution: ESM resolution, the API per major, and every timing.

## Orchestrator verification

These claims were spot-checked against the code:

- `operations.ts:582` (blocked rule)
- `angular-templates.ts:80-81,150` (majors 18-22, `createRequire`)
- `rename_symbol.ts:31` and `find_references.ts:89` (pinned TS-only wording)
- `@ts-morph/common@0.29.0` depends on `typescript@6.0.2`; the repo's own TS is 5.9.3
- no `@angular/*` package is installed; only the `angular-compiler-v18..v22` aliases

## Ready for proposal

Yes, with the spike as the first and gating task.
