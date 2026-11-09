# Design: Template type checking for rename plans (#421)

## Technical Approach

This is proposal approach 2. The accepted decisions are:

- The check is on by default for renames that edit templates.
- `block_on_template_errors` defaults to `false` and blocks only on a `completed` delta.
- The spike ceiling is p95 ≤ 10 s and ≤ 1 GiB RSS.

`createPlan` calls one deep module, `checkTemplateTypes`. The call comes after the TS delta and before the `workspaceAfter` digest check (`operations.ts:573`). That digest check already covers the child's disk reads, so it closes the TOCTOU window.

The module checks the project's packages in-process first. Then it forks a **one-shot child** that runs ngtsc twice:

- **Before**: the files on disk.
- **After**: disk plus an in-memory overlay of the changed files, with `oldProgram` reuse. The after host MUST return the identical `SourceFile` objects of the before run for unchanged files (one shared SourceFile cache); only overlay files are parsed again. With `oldProgram` reuse the after host MUST also set `getModifiedResourceFiles` to the overlay's non-TypeScript paths, otherwise ngtsc keeps stale analysis for template-only edits (found in PR 2b validation; covered by per-major tests). Without the shared cache the reuse does not pay off (spike Finding 5: the after run is 2.3x to 3.3x cheaper than a cold one).

The spike verdict is **proceed** (`docs/spikes/0421-template-type-check.md`, PR #431). Its findings are folded into this design.

The child returns raw observations. The parent diffs them with the existing `compareObservedDiagnostics`.

Grounding facts:

- **Inline usages never reach the check.** They are refused before any edit by `assertTemplateRenameAllowed` (`operations.ts:668-672`, MUTATION_BLOCKED). The spec scenario "Unmappable inline consumer template" is therefore satisfied by that refusal and needs no check-level test.
- **The diff needs no TS objects.** `compareObservedDiagnostics` consumes `DiagnosticObservation {public, start, length, ordinal}` (`diagnostics.ts:135-140`) and `DiagnosticTextChange {file, beforeText, afterText}` (`diagnostics.ts:442-446`). It is ts-morph-free.
- **The existing worker cannot carry the payload.** The compiler worker (ADR 0014) is an MCP relay with 256 KiB frames, which is too small for overlay payloads.

## Architecture Decisions

| Decision                  | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Rejected (why)                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module boundary           | `angular-template-typecheck.ts`, with one entry `checkTemplateTypes(input, ctx)` that returns `TemplateDiagnostics`. It hides the preflight, budget, spawn, kill, validation and diff. As built in PR 2b the signature is `checkTemplateTypes(input, ctx, deps)`: `input` carries a required `changes: DiagnosticTextChange[]` (the diff needs `beforeText`), `ctx` is a `RequestContext` plus `remainingMs()`, and `deps` is a test seam (`spawn`, `entry`). `changes[].file` and the wire `file` are both relative to `dirname(tsconfig)`; PR 3 must pass changes relative to that base.                                                                                                                                                                                                                                                                                                                                  | Logic in `operations.ts`: the file is already 1.5k lines, and the check could not be tested alone.                                                                                                            |
| Package resolution        | Extract `resolveFrom`, `isWithin`, `isUnderAncestorNodeModules` and `isSupportedVersion` into `angular-package-resolution.ts`. `loadCompiler` and the preflight share them. The child imports only the pre-validated absolute entry.                                                                                                                                                                                                                                                                                    | Re-resolving in the child: two guards would drift.                                                                                                                                                            |
| Version match             | compiler-cli has the same version as `@angular/compiler`, and `@angular/core` has the same major, within majors 18–22. Otherwise the reason is `compiler_unsupported`. TS is resolved **from the compiler-cli package dir**, because that is the TS ngtsc actually loads. If that TS is outside the cli's `peerDependencies.typescript`, or no TS resolves from that directory, the reason is `typescript_incompatible`. The child also maps ngtsc's version-check throw to `typescript_incompatible`.                  | The tsconfig-dir TS, which may differ from the one ngtsc loads. Adding `semver` (a new runtime dep, ADR 0001). Bundling the CLI (the proposal forbids it).                                                    |
| Range parsing             | A bounded parser that accepts only space-joined `>=x.y[.z]` and `<x.y[.z]` comparators. Anything else is `compiler_unsupported` (fail closed).                                                                                                                                                                                                                                                                                                                                                                          | The full semver grammar.                                                                                                                                                                                      |
| Public API probe          | After its `import()` and before building any program, the child checks that the `.` entry exports `NgtscProgram` and `readConfiguration`, and that `NgtscProgram.prototype.getNgSemanticDiagnostics` is a function. After constructing the program it checks that `program.compiler.getComponentsWithTemplateFile` is a function. If any check fails it replies `{ok:false, reason:"compiler_unsupported"}`, which maps to `unavailable`. It never imports `private/*`. The probe also requires `createCompilerHost` (a public export the driver uses). `OptimizeFor` is not used, so it is not probed. | Treating a missing export as `check_failed`. Probing `getTemplateTypeChecker`: it is not an export of `.` (spike Finding 1).                                                                                  |
| Diagnostics path          | The fully public `program.getNgSemanticDiagnostics()` (the `api.Program` interface) on an `NgtscProgram`, after `await program.loadNgStructureAsync()`. It is called once per side with no argument and filtered to the scope files. TS diagnostics are not part of `template_diagnostics`; the existing `diagnostics` field already carries them. Cost: +90 to 290 ms p50 over the checker path, same RSS, inside the ceiling.                                                                                         | `program.compiler.getTemplateTypeChecker()`: it throws unless the underscore-prefixed `_enableTemplateTypeChecker` option is set, which depends on ngtsc internals (spike Finding 2).                         |
| Process model             | `child_process.fork(<dist entry>)` with `execPath: process.execPath` (`fork` has no `shell` option, so no shell is ever used) with `execArgv: ["--max-old-space-size=1024"]` (kept after spike calibration: measured peak RSS is under 440 MiB, and the ceiling is the contract), `env: {}`, `serialization: "advanced"` and `stdio: ["ignore","ignore","ignore","ipc"]`. One request per process, then exit.                                                                                                                                                                                                  | `worker_threads`: they share the server's RSS, so a check cannot be measured alone, and a native crash kills the server. A warm pool: stale programs, and ADR 0014 rejected pools.                            |
| Writes no files           | ngtsc `emit()` is never called. `noEmit: true`, `incremental: false`, `composite: false` and `tsBuildInfoFile: undefined` are forced over `readConfiguration` output. The compiler host `writeFile` is a throwing stub, and a throw becomes `check_failed`. The overlay exists only in memory.                                                                                                                                                                                                                          | Trusting tsconfig emit settings.                                                                                                                                                                              |
| Payload                   | The overlay holds **only the changed files**: TS `afterText` plus the edited `.html`. The before state is disk, which the digest checks prove unchanged. More than 32 MiB of overlay, more than 10000 overlay files (`MAX_OVERLAY_FILES`), or more than 2000 templates, gives `work_exhausted` without spawning. Each wire message is capped at `MAX_MESSAGE_CHARS = 8192`; the child truncates each message to the cap before replying.                                                                                | Shipping the full before and after workspace (about 100× the payload).                                                                                                                                        |
| Scope B                   | The request carries the edited template paths, taken from `auxiliaryEdits`. The child maps them to components with `program.compiler.getComponentsWithTemplateFile(path)`. `compiler` is a public readonly property of `NgtscProgram`, and the spike confirmed the method on majors 18 to 22 (Finding 3). It keeps only diagnostics whose file is a scoped component `.ts` or an edited template. There is no parent-side fallback.                                                                                     | Parent-side template-to-class mapping, which duplicates ngtsc's resource resolution and is no longer needed.                                                                                                  |
| Diff                      | The parent calls `compareObservedDiagnostics(before, after, changes)`, with the mapping in Interfaces. The match key is code + category + file + message + mapped span. Each side is capped at 5000 diagnostics, above which the status is `work_exhausted`.                                                                                                                                                                                                                                                            | A new matcher, or a count-based diff.                                                                                                                                                                         |
| Budget                    | `budget = min(30 s, ctx.remainingMs() − 10 s reserve)`. Under 2 s, the check reports `unfinished` with reason `deadline` without spawning. On expiry the parent sends SIGKILL, and the status is `deadline`. A client abort also sends SIGKILL, then `checkpoint()` rethrows `REQUEST_CANCELLED`.                                                                                                                                                                                                                       | Relying on the scheduler deadline: it aborts the whole prepare and never yields `deadline`.                                                                                                                   |
| Concurrency               | The check runs inside `withProjectOperation`. Later operations on the **same project** queue behind it, which is the existing per-project serialization. Other projects and the server event loop stay free, because ngtsc runs in the child.                                                                                                                                                                                                                                                                           | Running outside the project lock, which would break snapshot consistency.                                                                                                                                     |
| Exit mapping              | A valid response maps as reported. V8 out of memory maps to `work_exhausted` when the exit has `signal === "SIGABRT"` (with `code: null`, the form the spike observed, Finding 4) or `code === 134`. ngtsc's thrown TypeScript version check ("The Angular Compiler requires TypeScript ...", Finding 6) maps to `typescript_incompatible`. Any other exit, a schema-invalid reply, or any other ngtsc throw maps to `check_failed`.                                                                                    | Reporting `completed` with empty arrays. Matching only exit code 134, which misses the observed signal form.                                                                                                  |
| Status and field presence | The field is **present only when the check ran or tried to**. Its status is `completed`, `unavailable` (`compiler_cli_missing`, `compiler_unsupported`, `typescript_incompatible`) or `unfinished` (`work_exhausted`, `deadline`, `check_failed`). The field is **absent** for non-Angular projects, for renames that edit no template, and for the other operation kinds. Non-completed statuses always carry empty arrays.                                                                                            | Always emitting `not_applicable`: it needs persistence without a hash, and it is noise.                                                                                                                       |
| Blocking                  | `blocked = !allow && (tsErrors > 0 \|\| (blockOnTemplate && status==="completed" && added_errors > 0))`. `block_reason` names each source that applies.                                                                                                                                                                                                                                                                                                                                                                 | Redefining `allow_new_errors`.                                                                                                                                                                                |
| Plan hash                 | `planHashFor` keeps `version: 2` and today's exact field set when `template_diagnostics` is absent. So every plan without a check hashes exactly as before. **Version 3**, which adds `template_diagnostics` and `block_on_template_errors` to the hashed JSON, is used only when the field is present. The persisted envelope follows the same rule: `schema_version: 3` only for those plans. v1 and v2 still verify.                                                                                                 | One global bump, which would change the hash of plans without a check (violates the spec).                                                                                                                    |
| Persisted record          | `PersistedOperationSchema` (`operation-plan-file.ts:54-77`) gets a v3 variant. It adds the required `template_diagnostics` (`{status, reason?, added, removed, addedErrors}`, `.strict()`) and `block_on_template_errors: boolean`. `PlanEnvelopeSchema` gains `z.literal(3)` with that variant. `importOperationRecord` passes both values to `planHashFor(record, 3)`. The v1 and v2 schemas stay strict and unchanged.                                                                                               | Optional fields on the v2 schema, which would make v2 ambiguous.                                                                                                                                              |
| Output schema             | `RenameOperationOutputSchema = PreparedOperationOutputSchema.extend({ template_diagnostics: TemplateDiagnosticsSchema.optional() })`, following the precedent of `ScaffoldClassOutputSchema` (`scaffold_class.ts:80`). Only `ast_rename_symbol` uses it, so the scaffold and replace contracts are unchanged.                                                                                                                                                                                                           | Editing the shared schema, which would drift three contracts.                                                                                                                                                 |
| Test deps                 | Five private Yarn workspaces `test/angular-matrix/v18..v22/package.json`. Each pins exact `@angular/{core,compiler,compiler-cli}`, an in-range `typescript`, `rxjs` and `tslib`, with `installConfig.hoistingLimits: "workspaces"`.                                                                                                                                                                                                                                                                                     | Root `npm:` aliases: the cli resolves `@angular/compiler` and `typescript` from its realpath at the repo root, which gives wrong versions or none. Hoisting would also break the `compiler_missing` fixtures. |

## Data Flow

    createPlan ─ TS delta ─→ checkTemplateTypes(files, editedTemplates, ctx)   [inside project lock]
                               │ preflight (guard, versions, TS range) ───────→ unavailable
                               │ budget/limits ───────────────────────────────→ unfinished
                               └ fork child ─IPC req─→ entry: API probe → core(ngtsc before; after+overlay)
                                     ↑ SIGKILL on budget/abort        │
                                     └──────── IPC wire diagnostics ──┘
                             map → compareObservedDiagnostics → TemplateDiagnostics
    → blocked rule → planHashFor (v2 if absent, v3 if present) → workspaceAfter digest → serialize

## Interfaces / Contracts

```ts
export type TemplateTypeCheckReason =
  | "compiler_cli_missing"
  | "compiler_unsupported"
  | "typescript_incompatible"
  | "work_exhausted"
  | "deadline"
  | "check_failed";
export type TemplateDiagnostics =
  | ({ status: "completed" } & DiagnosticDelta)
  | ({ status: "unavailable" | "unfinished"; reason: TemplateTypeCheckReason } & DiagnosticDelta);
// ProjectOperationContext gains: remainingMs(): number   (scheduler-owned)

// IPC v1, zod-validated on both sides
type Request = {
  v: 1;
  tsconfig: string;
  cliEntry: string;
  templates: string[];
  overlay: { absolutePath: string; text: string }[];
  maxDiagnostics: number;
};
type WireDiagnostic = {
  code: number;
  category: string;
  file: string /* project-relative */;
  line: number | null;
  column: number | null;
  message: string;
  start: number | null;
  length: number | null;
};
type Response =
  | { v: 1; ok: true; before: WireDiagnostic[]; after: WireDiagnostic[] }
  | {
      v: 1;
      ok: false;
      reason:
        "compiler_unsupported" | "typescript_incompatible" | "work_exhausted" | "check_failed";
    };
```

How the wire types map to the existing types:

- **Observations.** Each `WireDiagnostic` at index `i` becomes `DiagnosticObservation { public: {code, category, file, line, column, message}, start, length, ordinal: i }`.
- **Changes.** Each `PlannedFileInternal` becomes `DiagnosticTextChange { file, beforeText: isCreatedFile ? null : originalText, afterText: updatedText }`.
- **Overlay.** Each overlay entry is `{absolutePath, text: updatedText}`.

The child produces `category` from the project TS `DiagnosticCategory` name and `message` from `flattenDiagnosticMessageText`.

Output is the optional `template_diagnostics {status, reason?, added, removed, added_errors}` on `RenameOperationOutputSchema`. The new input is `block_on_template_errors: z.boolean().default(false).describe("Block the plan when a completed template check adds template errors. allow_new_errors still waives it.")`.

### Exact descriptions (PR 4)

`ast_rename_symbol`:

> Prepares an exact hash-bound rename plan without writing. Review the preview and apply its operation_id with ast_apply_operation. The plan also rewrites external Angular templates, including consumer templates when coverage is completed, hash-bound to the workspace snapshot. The diagnostics field stays TypeScript-only; when templates are edited, template_diagnostics reports the template type-check delta separately with a typed status, and blocks only with block_on_template_errors=true.

`ast_find_references`:

> Finds type-resolved references and returns bounded project-relative locations, including declaration impact by default. When @angular/compiler resolves, it also reports Angular template usages, including consumer templates, tagged by origin with a template_coverage verdict; completed covers templates inside the Project only, and incomplete coverage does not prove absence. It reports usages only; template type errors are reported by ast_rename_symbol plans in template_diagnostics.

## File Changes

| File                                                                                                                                                     | Action        | Description                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/angular-package-resolution.ts`                                                                                                             | Create        | Shared resolution guard and range parser                                                                                                                                                                                                                            |
| `src/services/angular-templates.ts`                                                                                                                      | Modify        | `loadCompiler` uses the extracted guard, with no behavior change                                                                                                                                                                                                    |
| `src/services/angular-template-typecheck.ts`                                                                                                             | Create        | Deep module: preflight, budget, supervisor, mapping, diff                                                                                                                                                                                                           |
| `src/services/angular-template-typecheck-protocol.ts`                                                                                                    | Create        | IPC zod schemas and limits                                                                                                                                                                                                                                          |
| `src/services/angular-template-typecheck-core.ts`                                                                                                        | Create        | ngtsc driver: API probe, overlay host with a shared SourceFile cache (identical objects for unchanged files, `oldProgram` reuse), no-emit options, `getComponentsWithTemplateFile` scoping, public `getNgSemanticDiagnostics()`, normalization. Testable in-process |
| `src/angular-template-typecheck-entry.ts`                                                                                                                | Create        | Thin one-shot IPC child; exits on `disconnect`                                                                                                                                                                                                                      |
| `src/services/project-operation-scheduler.ts`                                                                                                            | Modify        | `remainingMs()` on the context                                                                                                                                                                                                                                      |
| `src/services/operations.ts`                                                                                                                             | Modify        | Wiring, blocked rule, conditional v2/v3 hash                                                                                                                                                                                                                        |
| `src/services/operation-plan-file.ts`                                                                                                                    | Modify        | v3 persisted variant and envelope                                                                                                                                                                                                                                   |
| `src/tools/operation-schema.ts`, `src/tools/rename_symbol.ts`                                                                                            | Modify        | `RenameOperationOutputSchema`, new input                                                                                                                                                                                                                            |
| `test/fixtures/declared-tool-contracts.json`, `test/fixtures/tool-inventory.json`, `scripts/registry-consumer-smoke.mjs`, `scripts/canary-local-mcp.mjs` | Modify        | PR 3: `block_on_template_errors` declaration and three digest pins (the canary pin comes from its own guard=allow run). PR 4: pins again for descriptions                                                                                                           |
| `src/tools/find_references.ts`                                                                                                                           | Modify        | PR 4 description                                                                                                                                                                                                                                                    |
| `test/angular-matrix/v18..v22/package.json`, root `package.json` (`workspaces`, `test` script), `.yarnrc.yml`, `test/dependency-policy.test.ts`          | Create/Modify | Real per-major matrix and the audit policy for core and compiler-cli                                                                                                                                                                                                |
| `scripts/spike/angular-typecheck-spike.mjs`, `test/helpers/angular-matrix-fixture.ts`                                                                    | Create        | Spike harness and a generated fixture of 100 components / 300 templates                                                                                                                                                                                             |
| `docs/spikes/0421-template-type-check.md`, `docs/adr/0017-template-type-check-worker.md`                                                                 | Create        | Findings (PR 1), ADR (PR 4)                                                                                                                                                                                                                                         |
| Specs, README, CHANGELOG, skill, `test/angular-docs.test.ts`                                                                                             | Modify        | PR 4 re-baseline                                                                                                                                                                                                                                                    |

## Testing Strategy (strict TDD, RED first)

| Layer                    | What                                                                                                                                                                                                                                                                  | Approach                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Unit                     | Range parser, preflight reasons, budget math, exit mapping (both `signal: SIGABRT, code: null` and `code: 134`), wire mapping, blocked rule, v2 hash unchanged when the field is absent (golden from current code), v3 hash sensitivity, v3 persist/import round-trip | Injected `spawn` seam with `.mjs` fake children: hang, OOM-abort, crash, malformed reply, oversized reply, missing-export reply |
| Integration (in-process) | Core on each major: a seeded broken consumer binding appears in `added_errors`; a pre-existing shifted error is not reported as added; positions are mapped; missing exports give `compiler_unsupported`; `writeFile` is never invoked                                | One test file per major against the matrix workspaces                                                                           |
| Integration (built)      | Real child end to end (PR 2b); killed at the deadline and returns within budget + 1 s with no orphans (deferred to PR 3, task 3.21a; PR 2b covers kill with fake children and fake timers); workspace hash unchanged                                                                                                                                                   | Post-build phase next to `supervised-worker.integration.test.ts`                                                                |
| Contract                 | Rename-only output and input drift; scaffold and replace contracts unchanged; the three pins                                                                                                                                                                          | Existing declared-contract, inventory, registry and canary tests                                                                |

Inline consumer templates get no check test. The existing MUTATION_BLOCKED tests already cover them.

CI: the spike measured 286 MiB of matrix `node_modules` and 24 s for all five majors (35 child runs), below the 60 s threshold (G9, a proxy). No separate `test:angular-matrix` job is planned yet. Task 3.22 re-checks with the real per-major test files, and the job moves out only if the matrix adds more than 60 s.

## Threat Matrix

| Boundary                                      | Applicability                     | Design response                                                                                                          | Planned RED tests                                                                             |
| --------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Documentation-like paths                      | N/A: no executable classification | —                                                                                                                        | —                                                                                             |
| Git repository selection / commit / push / PR | N/A: no VCS automation            | —                                                                                                                        | —                                                                                             |
| Subprocess spawn                              | Applicable                        | `fork` of our own dist entry, `shell:false`, `env:{}`, fixed `execArgv` (no inherited `--inspect` or `NODE_OPTIONS`)     | The child sees no parent env; the spawn args are fixed                                        |
| Module path execution                         | Applicable                        | The child imports only a cli entry whose realpath passed the ancestor-`node_modules` guard; it never imports `private/*` | A symlink outside the project gives `compiler_unsupported` with no spawn                      |
| File writes                                   | Applicable                        | No emit, forced no-emit options, throwing `writeFile`                                                                    | The workspace hash and file list are unchanged after any status                               |
| Kill / orphan                                 | Applicable                        | SIGKILL on budget, abort or an `error` event; the child exits on `disconnect`; it is reaped before return                | A hang gives `deadline` within the budget; an abort gives `REQUEST_CANCELLED`; zero live PIDs |
| IPC trust                                     | Applicable                        | zod-validated response, caps on size and count                                                                           | Malformed gives `check_failed`; oversized gives `work_exhausted`                              |

## Spike (PR 1) deliverable: satisfied

Delivered by `docs/spikes/0421-template-type-check.md` (PR #431), verdict **proceed**, every gate PASS on majors 18 to 22. Worst p95 1522 ms and worst peak RSS 403 MiB (v19), against the 10 s / 1 GiB ceiling. The decisions above (Diagnostics path, Public API probe, Scope B, Exit mapping, after-run SourceFile cache) absorb its findings 1 to 6.

`scripts/spike/angular-typecheck-spike.mjs` runs on each major and checks:

- the public API: `NgtscProgram` and `readConfiguration` from `.`, `getComponentsWithTemplateFile` on `program.compiler`, and diagnostics via `getNgSemanticDiagnostics()` (the checker path `program.compiler.getTemplateTypeChecker()` was measured for comparison only);
- that the overlay detects a seeded error;
- the TS matrix;
- the offsets of external-template diagnostics;
- the OOM exit signature;
- `oldProgram` reuse;
- that no-emit holds (no `writeFile` calls).

Timing uses 10 runs on the generated fixture. It records p50/p95 latency and peak RSS from the child's `process.resourceUsage().maxRSS`. The results go to `docs/spikes/0421-template-type-check.md` (one table per major, with machine, Node version and commit) and to Engram `sdd/2026-11-07-template-type-check-rename-plans/spike`. If any gate fails, PRs 2a, 2b and 3 are dropped; PR 4 shrinks to the limitation doc.

## Slices (stacked to main)

| PR  | Content                                                                                                                                                                                                                     | Est. lines                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Matrix workspaces, policy test, spike script, fixture generator, findings (the generated lockfile is excluded)                                                                                                              | ~700                                                                                              |
| 2a  | Resolution extract, range parser, preflight, limits, protocol and tests, not wired. No contract change                                                                                                                      | ~330                                                                                              |
| 2b  | Core (API probe, SourceFile cache, no-emit, public diagnostics path), entry, supervisor (SIGABRT/134 mapping), budget/kill and tests, not wired. No contract change                                                         | ~490 (the re-forecast after the spike puts one PR 2 at ~820, over 800, so the split is mandatory) |
| 3   | `remainingMs`, wiring, mapping and diff, `RenameOperationOutputSchema`, the input, the blocked rule, conditional v2/v3 hash, persisted v3, the `declared-tool-contracts.json` declaration, the three digest pins, and tests | ~750                                                                                              |
| 4   | Exact descriptions, pin re-baseline, specs, README, skill, CHANGELOG, ADR 0017, `angular-docs` test. Closes #421                                                                                                            | ~450                                                                                              |

## Migration / Rollout

Everything is additive. Plans without a check are byte-identical in hash and in persisted shape (v2). Only plans with a check persist as v3. Rollback is a revert in reverse order. Any v3 plans persisted before a rollback are rejected on import after it (schema_version unknown); these are short-lived prepared plans.

## Spec alignment

Applied to the delta specs; nothing pending.

## Known limitations (PR 2b)

- The core uses `request.tsconfig` as given while the preflight validated realpaths; a tsconfig reached through a symlink may produce wire `file` values relative to the unresolved directory. Normalizing needs the overlay and template paths realpathed consistently, so it is left to PR 3, where the caller owns path normalization.

## Open Questions

- [x] Does the spike confirm `getComponentsWithTemplateFile` and the external-template offsets on all majors? Closed: yes on 18 to 22 (spike G1, G4, Finding 3). No parent-side fallback is built.
- [ ] Is an operator kill switch needed? No env knob is planned.
