# Exploration: Angular template references

Change: `2026-11-03-angular-template-references`
Phase: sdd-explore (2026-11-03)
Engram topic: `sdd/2026-11-03-angular-template-references/explore` (observation 3844)

## Problem

Angular component logic is already covered by ast-mcp-server because `.ts` files flow through the user's `tsconfig.json`. Angular templates are not: a `find_references`, `rename_symbol`, or `get_impact` call on a component member does not see `{{ member }}`, `(click)="member()"`, `[prop]="member"`, `@if (member)` and similar usages in external `.html` templates or inline `template:` literals. A rename can therefore silently break a template.

## Current State

- Usage discovery is 100% ts-morph. `references.ts` (`collectSymbolReferences`), `operations.ts` (`prepareRename` via `node.rename()` inside `createPlan`), and `relationships.ts` (`addReferenceEdges`, `scopedReferenceCandidates`) all call `findReferencesAsNodes()`.
- Mutation safety: `createPlan` builds `originals` only from `project.getSourceFiles()`. `workspace_hash` and `post_workspace_hash` come from `createWorkspaceSnapshot` (`workspace.ts`), which hashes TS sources plus the tsconfig chain only. `applyOperation` re-hashes the workspace under the write lock and the workspace file lock, checks each file's original hash, publishes, rolls back on failure, and writes an idempotent receipt.
- `importOperationRecord` and `operation-plan-file.ts` are extension-agnostic, so an `.html` planned file persists and replays without format changes.
- An `.html` file is currently invisible to the workspace hash. It would be protected only by its per-file hash if it appears in `operation.files`.
- Symbol index (`symbol-index-sqlite.ts`, `symbol-index-cache.ts`) caches declared symbols only. Template usages are not symbols, so no index change is needed.
- Impact edges: `isExactImpactEdge` (`impact.ts`) and `assertCompleteExactImpactEvidence` (`find_test_candidates`) require provenance `compiler`, confidence `exact`, resolution `resolved`, and `compiler_authoritative`. Any syntax-provenance edge makes `find_test_candidates` throw. Edge endpoints are `file + symbol_path + selector`, which a template does not fit.
- Tool contracts: `find_references` and `get_impact` have closed zod output schemas with TOON formatting. `test/fixtures/tool-inventory.json` hashes the tool inventory, so schema changes must be additive and deliberately re-baselined.
- Dependencies: the repo depends on ts-morph 28.0.0 only; `engines` is `>=22.13.0`. npm latest `@angular/compiler` 22.2.4 is ESM-only, depends on `tslib`, is about 5 MB unpacked, and declares `engines` `^22.22.3 || ^24.15.0 || >=26`, above this repo's floor. It cannot be a hard dependency. No `@angular/*` package is installed.
- Fixtures: `test/helpers/project-fixture.ts` `createProjectFixture(files)` writes a temp dir, a NodeNext tsconfig with `include: src/**/*`, and arbitrary files, so `.html` fixtures work. No Angular fixture exists. The TypeChecker needs either local `@Component` stub declarations or a fixture-installed `@angular/core`.

## Affected Areas

- `src/services/references.ts` — seam 1: append template usages after `findReferencesAsNodes`.
- `src/services/operations.ts` — seam 2: `createPlan`/`prepareRename` need an auxiliary-files channel. `mutate` returns auxiliary text edits (file, spans, new text) that are applied to the `.html` text and folded into `files[]` with original and updated hash, mode and diff. `currentWorkspaceHash` must mirror the new snapshot input.
- `src/services/workspace.ts` — `createWorkspaceSnapshot` accepts an optional auxiliary-files set. When empty (non-Angular projects) the hash stays byte-identical.
- NEW `src/services/angular-templates.ts` — Angular detection, compiler loader, template locator, member-usage extractor.
- `src/tools/find_references.ts`, `src/tools/rename_symbol.ts`, `src/tools/operation-schema.ts`, `test/fixtures/tool-inventory.json` — additive output fields.
- `skills/structural-code-editing/SKILL.md` and `references/operations.md` — document the new behavior.
- `package.json` — optional peer dependency (`peerDependencies` plus `peerDependenciesMeta.optional`) and dev dependencies for tests. Check `test/dependency-policy.test.ts` and the package and release smoke scripts.
- `src/services/project-watcher.ts` / `project.ts` — verify `.html` changes invalidate freshness. Watched directories derive from source-file directories and templates normally sit next to components.
- `relationships.ts` / `impact.ts` — later slice only.

## Approaches

1. **`@angular/compiler` loaded from the user's project (recommended).** Detect Angular by resolving `@angular/core` and `@angular/compiler` from the project root with `createRequire(tsconfigDir)`, then dynamically `import()` the resolved ESM file. If either is absent the feature is off and non-Angular projects are unaffected. `parseTemplate()` gives the R3 AST with source spans. A `RecursiveAstVisitor` matches `PropertyRead`, `SafePropertyRead`, `PropertyWrite` and `Call` with an `ImplicitReceiver`, using `nameSpan` for exact rename offsets. Covers interpolation, property/event/two-way bindings, `@if/@for/@switch/@let/@defer`, structural directives and pipe arguments. Names introduced by `#ref`, `let-x`, `@for` aliases and `@let` shadow component members and are excluded; ambiguity blocks rename. Pros: exact spans, same parser as the user's Angular version, deterministic, offline, no TS-program coupling. Cons: compiler API is not semver-stable across majors (feature detection plus tested version range, fail closed outside it); resolution is syntactic with no template type-checking. Effort: medium.
2. **Custom expression scanner.** No dependency, but reimplements control-flow blocks, pipes, `@let`, `ng-template` scoping. Mistakes become silent rename corruption, contradicting the fail-closed model. Rejected.
3. **Angular language service / ngtsc type-check blocks.** Most authoritative (child-component inputs/outputs, pipes, diagnostics), but needs `compiler-cli` and `language-service`, a full Angular program, TS-version coupling with ts-morph, and heavy memory/time that breaks the bounded-time scheduler. Effort: high. Future slice.
4. **Hybrid.** Approach 1 now, approach 3 later for cross-component bindings.

## Recommendation

Approach 1 as slice 1.

Seams:

- (a) `references.ts` returns template usages as an additive field or as items flagged `source: "template"`; they count toward total and pagination and stay bounded.
- (b) `createPlan` takes auxiliary edits and an `auxiliaryFiles` set that feeds the workspace hash. `applyOperation` needs no logic change beyond mirroring that hash input.

In scope:

- External templates (`templateUrl` string literal inside the project root).
- Inline `template:` literals for read-only `find_references`.
- Rename that writes into `.html`, with full hash binding.
- Members of the owning component class: properties, methods, accessors and signal fields.
- Control-flow blocks, `@let`, structural directives and pipe arguments.

Out of scope:

- Rename into inline templates (conflicts with ts-morph in-memory edits; reported as unsupported and blocks the rename).
- Pipe names; template reference variables as rename targets; child-component `@Input`/`@Output` renames and selector matching; host-binding strings; computed or non-literal `templateUrl`; `styleUrls`; template type diagnostics.
- `get_impact` edges (separate slice, separate additive channel, never entering the compiler-authoritative edge set; `find_test_candidates` stays unaffected or returns explicit incomplete evidence).
- Vue, Svelte, tree-sitter.

Completeness model: when Angular is detected and a template cannot be resolved or parsed (missing file, non-literal `templateUrl`, parse error, compiler outside the supported range), the template channel's coverage is `unfinished` and rename is blocked (INCOMPLETE_EVIDENCE style). The tool never claims proven absence. If the `.html` changes after prepare, apply hits the same workspace-hash conflict as TS.

Suggested slices (likely exceeds 800 review lines; 5 is a separate change):

1. Loader, locator and extractor as a read-only service with tests.
2. `find_references` integration and output contract.
3. Hash-bound `.html` rename and workspace hash.
4. Docs, skill and inventory.
5. Impact.

## Risks

- Angular compiler API drift across majors. Mitigate with feature detection, a tested version range and a fixture matrix.
- Rename correctness around shadowing (`@for` aliases, `let-`, `#ref`, `@let`, `$event`). Ambiguity must block.
- Including `.html` in the workspace hash changes hash material for Angular projects only; non-Angular projects must stay byte-identical (regression test).
- Diagnostics delta is TS-only, so template errors introduced by a rename are not detected. State explicitly.
- `tools/list` inventory hash churn and TOON parity for new fields. Dependency-policy and package smoke scripts may flag the optional peer dependency.
- Security: `templateUrl` path must stay inside the project root with no symlink or hardlink (reuse `assertSafeOperationFile`).
- Compiler parsing is not cooperatively interruptible, so input size and work need explicit bounds.

## Ready for Proposal

Yes. Decisions carried into the proposal under the explorer's recommendation: slice 1 includes rename writes to `.html` behind full hash binding; inline templates are read-only in `find_references`.
