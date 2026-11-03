# Design: Angular template references

## Technical Approach

One deep module, `src/services/angular-templates.ts`, owns Angular detection, compiler loading, template location, usage extraction and coverage. It has three consumers, all additive: `references.ts` (read), `operations.ts` (rename edits), and `workspace.ts`/`project.ts` (hash and watcher). Template text is always read from disk at query time and never cached, so freshness for templates comes from the workspace hash, not from compiler state. Diagnostics stay TypeScript-only.

## Architecture Decisions

| Question                           | Options                                                                                  | Decision and rationale                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module boundary                    | (a) a loader module plus an extractor module; (b) one module with two exported functions | **(b)**. Callers never see compiler AST, resolution or version logic. The module owns Angular semantics. It does not own TS references, file writes or hashing.                                                                                                                                                                                                     |
| When is Angular "present"?         | compiler resolvable; `@angular/core` resolvable                                          | **`@angular/core/package.json` resolvable from the tsconfig dir.** If core is absent, the feature is off and output is byte-identical to today. If core is present but the compiler is absent, out of range, or missing a required export, coverage is `unfinished`: fail closed, never silently off.                                                               |
| Supported compiler                 | open range; tested majors                                                                | **`>=20.0.0 <23.0.0`**, the range used for the optional peer, gated by feature detection (`parseTemplate`, the template and expression recursive visitors, `ImplicitReceiver`, `ThisReceiver`, `PropertyRead`, `Call`; write as either `PropertyWrite` or assignment `Binary`, since v20 changed assignment nodes). Every major in the range is exercised by tests. |
| Usage placement in find_references | separate array; flagged items in `references`                                            | **Flagged items**, merged, sorted and paginated with TS items so `total`/`has_more` stay truthful.                                                                                                                                                                                                                                                                  |
| Owning components                  | name match project-wide; declaring class only                                            | **The declaring class, if it carries a resolved `@Component`.** A derived class that is a component gets coverage `unsupported` (reason `inherited_member`), so rename blocks.                                                                                                                                                                                      |
| Shadowing                          | treat as ambiguity; scope-aware                                                          | **Scope-aware.** Names in scope from `@for` (item and `$index` etc.), `@let`, `#ref`, `let-x`, `@if ... as` and `$event` shadow members, so those reads are not usages. Each usage carries `localsInScope`. A rename blocks the **whole plan** if `newName` is in scope at any usage, or is `$any`.                                                                 |
| Auxiliary hash set                 | callers pass the set; snapshot derives it                                                | **Snapshot derives it** with `listTemplateFiles(context)` inside `createWorkspaceSnapshot`. Prepare, the prepare re-checks, `currentWorkspaceHash` and `synchronizeSession` then cannot diverge.                                                                                                                                                                    |
| `.html` edits in plans             | new plan file kind; reuse `PlannedFileInternal`                                          | **Reuse.** Apply, staging, publication, rollback, receipts and import/export are already extension-agnostic.                                                                                                                                                                                                                                                        |
| Error codes                        | new code; reuse                                                                          | **Reuse.** `INCOMPLETE_EVIDENCE` for unfinished/unsupported coverage, `MUTATION_BLOCKED` for inline-usage or shadow-collision, existing `CONFLICT` path for stale `.html`.                                                                                                                                                                                          |
| Prepared-operation schema          | add fields; unchanged                                                                    | **Unchanged.** `.html` appears in `affected_files`/`preview`, and `reference_count` includes template edits. The TS-only diagnostics limit goes into the rename tool description.                                                                                                                                                                                   |

## Interfaces / Contracts

```ts
// src/services/angular-templates.ts
export type TemplateCoverageReason =
  | "compiler_missing"
  | "compiler_unsupported"
  | "template_unresolved" // non-literal / missing
  | "template_unsafe"
  | "template_parse_error"
  | "size_exceeded"
  | "work_exhausted"
  | "inherited_member";
export type TemplateCoverage =
  | { readonly status: "not_applicable" }
  | { readonly status: "completed"; readonly templates: number }
  | {
      readonly status: "unfinished" | "unsupported";
      readonly reason: TemplateCoverageReason;
      readonly templates: number;
    };
export interface TemplateUsage {
  readonly absolutePath: string;
  readonly file: string; // project-relative
  readonly container: "external" | "inline";
  readonly start: number;
  readonly end: number; // nameSpan offsets in file text
  readonly line: number;
  readonly column: number;
  readonly kind: "TemplatePropertyRead" | "TemplatePropertyWrite" | "TemplateCall";
  readonly localsInScope: readonly string[];
  readonly fileHash: string; // hash of bytes parsed
}
export function collectTemplateUsages(
  node: Node,
  context: ProjectContext,
  rc: RequestContext,
): Promise<{ coverage: TemplateCoverage; usages: readonly TemplateUsage[] }>;
export function listTemplateFiles(context: ProjectContext): readonly string[]; // sync, TS-only, no compiler
```

Internal seams (tested only through the exports): `loadCompiler(tsConfigDir)` uses `createRequire` plus `import(pathToFileURL(...))` and caches by resolved path and version. It applies the containment rule in Risks. `locateTemplates(classDecl)` handles a string-literal `templateUrl` (or no-substitution template literal) and an inline `template`. `extract(ast, name)` uses a visitor with a scope stack.

Bounds: 512 KiB per template, 100k visited nodes per template, `rc.checkpoint()` between templates and every 1k nodes. Parsing cannot be interrupted, so the size cap bounds its time. Containment: `templateUrl` resolves relative to the component file and must pass the same rules as `assertSafeOperationFile` (no symlink, one hard link, owner, inside the root). That function moves to a shared `src/services/safe-file.ts`. `listTemplateFiles` returns only existing, contained files, plus `[]` when core is absent.

**references.ts signatures.** The existing `collectSymbolReferences(node, projectRoot, symbolPath, includeDeclaration, detail, offset, limit, rc)` keeps its signature and stays synchronous and TS-only. Both functions share one private helper that collects the TS locations.

The new function is:

```ts
export function collectSymbolReferencesWithTemplates(
  node: Node,
  context: ProjectContext,
  query: {
    symbolPath: string;
    includeDeclaration: boolean;
    detail: ReferenceDetail;
    offset: number;
    limit: number;
  },
  rc: RequestContext,
): Promise<
  SymbolReferences & { template_coverage?: TemplateCoverage; template_reference_count?: number }
>;
```

Callers:

- `src/tools/find_references.ts:96` switches to `collectSymbolReferencesWithTemplates`. It takes the whole `context: ProjectContext` from the `withProject` callback (today it destructures only `{ project, projectRoot }`) and passes `operationContext` (a `ProjectOperationContext`, which is a `RequestContext`).
- `src/services/context-builder.ts:378` (`buildExploreContext`, which backs `ast_explore`) is **unchanged and deliberately TS-only**. It opts out by continuing to call the sync `collectSymbolReferences`. As a result, `context-builder.ts`, `src/tools/explore.ts`, the explore inventory entry and explore TOON output are all unchanged. This keeps unit 2 near 350 lines, under the 800-line budget. Template evidence in `ast_explore` is a follow-up issue, and unit 4 documents the TS-only limit.

**find_references additive output.** These fields appear only when coverage is not `not_applicable`:

- top level: `template_coverage` (the coverage object above) and `template_reference_count`;
- every item in that response: `origin: "compiler" | "template_external" | "template_inline"`, uniform per response so TOON stays tabular;
- template items: `kind`, with `context` set to the template line;
- `affected_files` gains `.html` files.

`reference_count` stays TS-only. `total` counts both kinds.

**Async.** `collectTemplateUsages` is async because the compiler is loaded with `import()`. Only the new references function and `createPlan`'s `mutate` become async; `withProject` already accepts promises.

**createPlan channel.** `mutate` changes from `(project, projectRoot)` to `(context: ProjectContext, rc)`, so `prepareRename` can call `collectTemplateUsages(node, context, rc)`. It returns `Promise<{ referenceCount; auxiliaryEdits?: readonly { absolutePath; start; end; newText; expectedHash }[] }>`. The three existing `mutate` callers are updated mechanically. `createPlan` handles each edited file as follows:

1. `assertSafeOperationFile` and `decodeSource` on the file.
2. Require the bytes hash to equal `expectedHash` and `workspaceBefore.files` (otherwise the existing "workspace changed" error).
3. Reject overlapping edits, then apply edits in descending offset order.
4. Build a `PlannedFileInternal` (BOM preserved, mode from `stat`, diff), merge it into `files`, and sort by `file`.

`.html` edits stay out of the diagnostics `textChanges`. `postWorkspaceFiles` already contains these paths, so the "missing from snapshot" guard also checks containment.

## Data Flow

```
find_references
Tool ──▶ withProject(ctx, opCtx) ──▶ collectSymbolReferencesWithTemplates(node, ctx, query, opCtx)
                          ├─ shared TS helper: findReferencesAsNodes()   (TS items)
                          └─ collectTemplateUsages(node,ctx,rc)
                               ├─ detect core ─✗─▶ not_applicable (no new fields)
                               ├─ loadCompiler ─✗─▶ unfinished
                               ├─ locate + safe-read + parseTemplate
                               └─ visit (scope stack, bounds)
                          merge ─▶ sort ─▶ paginate ─▶ JSON/TOON
```

```
rename prepare → apply
prepareRename ─▶ createPlan
  snapshot₀ (TS+config+listTemplateFiles)
  mutate: collectTemplateUsages BEFORE node.rename
          coverage≠completed/n.a. ─▶ INCOMPLETE_EVIDENCE
          inline usage | newName∈locals ─▶ MUTATION_BLOCKED
          node.rename(); return edits
  build .html PlannedFiles (hash = snapshot₀) ─▶ snapshot₁==snapshot₀ ─▶ retain
applyOperation (write lock + file lock)
  currentWorkspaceHash (same snapshot fn, includes .html)
    ≠ workspace_hash ─▶ CONFLICT ;  per-file originalHash ─▶ CONFLICT
  stage ─▶ publish all files ─▶ failure ⇒ rollback includes .html ─▶ receipt
```

**Watcher and freshness.** The watcher already reports every filename in watched directories regardless of extension (`project.ts` `onChange` → `source_changed`). The gap is a template in a directory with no TS source. Fix: both `selectProjectWatchDirectories` call sites in `project.ts` pass `[...sourcePaths, ...listTemplateFiles(context)]`. Synchronization fingerprints then cover templates through the snapshot.

## File Changes

| File                                                                                 | Action                                                                                                                                                               | Unit          |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `src/services/angular-templates.ts`                                                  | Create                                                                                                                                                               | 1             |
| `src/services/safe-file.ts`                                                          | Create (move `assertSafeOperationFile`)                                                                                                                              | 1             |
| `package.json`, `yarn.lock`                                                          | optional peer `@angular/compiler` `>=20.0.0 <23.0.0` + `peerDependenciesMeta.optional`; devDeps aliases `angular-compiler-v20/-v21/-v22` (`npm:@angular/compiler@…`) | 1             |
| `test/dependency-policy.test.ts`                                                     | assert peer optional, absent from `dependencies`                                                                                                                     | 1             |
| `src/services/references.ts`, `src/tools/find_references.ts`                         | new async `collectSymbolReferencesWithTemplates`, additive schema, description                                                                                       | 2             |
| `src/services/context-builder.ts`, `src/tools/explore.ts`                            | **Unchanged.** `ast_explore` stays TS-only. A unit 2 test asserts that explore output for an Angular member equals the pre-change output                             | 2 (test only) |
| `.gitignore`, `.prettierignore`, `eslint.config.js`                                  | ignore repo-local `.tmp/` for Angular fixtures                                                                                                                       | 1             |
| `test/fixtures/tool-inventory.json`                                                  | re-baseline (unit 2 and unit 3 descriptions)                                                                                                                         | 2, 3          |
| `src/services/operations.ts`, `src/services/workspace.ts`, `src/services/project.ts` | edit channel, snapshot set, watch dirs                                                                                                                               | 3             |
| `src/tools/rename_symbol.ts`                                                         | description: template writes, TS-only diagnostics                                                                                                                    | 3             |
| `scripts/package-smoke.mjs`                                                          | assert optional peer not installed in consumer                                                                                                                       | 4             |
| `skills/structural-code-editing/**`, README, CHANGELOG                               | docs                                                                                                                                                                 | 4             |

`src/tools/operation-schema.ts` is unchanged.

## Testing Strategy

| Layer           | What                                                                                                                                                             | Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture         | Angular project                                                                                                                                                  | New helper `createAngularFixture(files, { compiler: "v20"\|"v21"\|"v22"\|null })`. It writes a stub `node_modules/@angular/core` (`package.json` and `index.d.ts` declaring `Component`) and symlinks `node_modules/@angular/compiler` to the repo alias, so the real `createRequire` path is exercised. Fixtures are created under the repo-local `.tmp/angular-fixtures/` rather than `os.tmpdir()`, so the alias's realpath stays inside an ancestor `node_modules`, which the containment rule requires. A separate test places the fixture in `os.tmpdir()` to assert that a symlinked escape is rejected. No `@angular/core` devDependency. |
| Unit (1)        | detection, range, feature-detect failure, locator, every binding form, control flow, `@let`, structural microsyntax, pipe args, shadowing, bounds, unsafe paths  | `describe.each` over the compiler aliases. v22 is skipped below its engines floor and runs in the Node 24 job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Integration (2) | JSON and TOON parity, pagination over mixed items, non-Angular output deep-equal to the pre-change golden                                                        | Vitest through the tool handler                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Integration (3) | `.html` rename applies, `.html` edited after prepare yields `CONFLICT`, rollback restores `.html`, inline/collision/unfinished cases block, import/export replay | `operations` tests with `setOperationTestHooksForTests`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Regression (3)  | non-Angular workspace digest is byte-identical, including a project with `.html` and a fake `@Component` but no core                                             | Golden hex recorded from `main` before the change (RED-first)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Unchanged       | `find_test_candidates`, `get_impact`                                                                                                                             | existing suites stay green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Threat Matrix

All rows N/A. The change adds no routing, shell, subprocess, VCS or PR automation, and no executable-file classification. The in-process `import()` of the user's compiler is a trust note under Risks, not a matrix row.

## Risks

| Risk                                                                                                                                  | Mitigation and acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trust boundary**: the server runs the user project's `@angular/compiler` in-process via dynamic `import()`                          | The project root is already trusted: the server loads its tsconfig chain and TS program, and resolves type packages from its `node_modules`. Mitigations:<br>(1) Resolve only `@angular/compiler` (plus `@angular/core/package.json` for detection), with `createRequire(tsConfigDir)`. No other package is ever imported.<br>(2) Containment: the realpath of the resolved entry must be inside a `node_modules` directory whose parent is the tsconfig dir or one of its ancestors. This admits hoisted and pnpm layouts and rejects symlinks to arbitrary locations. Failure gives coverage `unfinished`, reason `compiler_unsupported`.<br>(3) Version and feature checks run on `package.json` before `import()`.<br>(4) Execution is limited to module evaluation plus `parseTemplate` and visitor calls on bounded input. Nothing else is invoked, no environment or arguments are passed, and no output is evaluated.<br>**Accepted:** module evaluation of a dependency the user installed is within the trust already granted to the project root. Yarn PnP projects without `node_modules` resolve nothing and report `unfinished`. |
| **Node floor vs compiler engines**: `@angular/compiler` 22 requires `^22.22.3 \|\| ^24.15.0 \|\| >=26`; the repo floor is `>=22.13.0` | It is an optional peer only, never a dependency, and `engines` stays unchanged. Tests for the v22 alias skip below its engines floor, so exact-Node 22.13 CI exercises v20 and v21 only. Assumption to confirm in unit 1: Yarn 4 does not enforce dependency `engines` at install time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Async refactor blast radius**                                                                                                       | The sync `collectSymbolReferences` is unchanged, so `context-builder.ts` and `ast_explore` are untouched. Only the three `mutate` callbacks in `operations.ts` (`prepareRename`, `prepareReplaceBody`, `prepareScaffoldClass`) change shape mechanically (unit 3), and existing operation tests cover them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ast_explore` references omit template usages                                                                                         | Deliberate. Documented in the skill (unit 4) and tracked as a follow-up issue. Rename still blocks independently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Snapshot cost: `listTemplateFiles` scans decorators on every snapshot                                                                 | O(source files) over ASTs that are already parsed, with no compiler load. A unit 3 benchmark smoke checks it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Migration / Rollout

No migration. Plans prepared before upgrade carry no `.html`. For Angular projects the hash set grows, so plans retained across an upgrade conflict (fail closed).

## Open Questions

None blocking.
