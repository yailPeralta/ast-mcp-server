# Spike 0421: template type checking for rename plans

Issue #421. Question: can a one-shot child process run ngtsc over a project, before and after an
in-memory rename overlay, using only the public `@angular/compiler-cli` entry, within the accepted
ceiling (p95 added latency <= 10 s, <= 1 GiB RSS on 100 components / 300 templates)?

**Verdict: proceed.** Final verdict: proceed, shipped in PRs 2 to 4 (see [ADR 0017](../adr/0017-template-type-check-worker.md)). Every STOP gate passed on Angular 18, 19, 20, 21 and 22.

## How it was run

- Command: `node scripts/spike/angular-typecheck-spike.mjs --all` (10 timed runs per major).
- Machine: 12th Gen Intel Core i5-12450H, 12 logical cores, 15 GiB RAM, Linux 7.0.0-42-generic.
- Node: v24.16.0. Commit: `ff93aa676412f249269ab46c0742bbd3b381fcb8` (clean tree).
- Child shape, as in the design: `fork(process.execPath)`, `env: {}`, `serialization: "advanced"`,
  `stdio: ["ignore","ignore","ignore","ipc"]`, `--max-old-space-size=1024`.
- Fixture: 100 widgets plus 200 consuming hosts = 300 components and 300 external templates
  (`test/helpers/angular-matrix-fixture.ts`). The plan edits 4 files; scope B covers 3 components.
- Toolchains: `test/angular-matrix/v18..v22` (exact core, compiler, compiler-cli, one in-range
  TypeScript each: 5.5.4, 5.8.3, 5.9.3, 5.9.3, 6.0.3).

## Gates

| Gate                | Result                                          | Evidence                                                                                                                                                                   |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 public API       | PASS, with a design correction (see Findings 1) | `NgtscProgram`, `OptimizeFor`, `readConfiguration` are exports of `.` on every major                                                                                       |
| G2 seeded error     | PASS x5                                         | The mis-renamed `[headng]` binding is the only added diagnostic (NG8002, `.html`); the clean rename yields empty lists; the pre-existing error is present before and after |
| G3 TS matrix        | PASS x5                                         | 4 TypeScript versions x 5 majors = 20 pairs: every in-peer-range pair works; every out-of-range pair throws "requires TypeScript", mapping to `typescript_incompatible`    |
| G4 offsets          | PASS x5                                         | Diagnostics in `.html` files slice to `[headng]="title"` / `[nonexistent]="title"` in the html text; the pre-existing error shifts by +2 across the rename                 |
| G5 OOM signature    | PASS                                            | `--max-old-space-size=16` child ends with `signal: SIGABRT` and `code: null` (no numeric 134 on this Node)                                                                 |
| G6 oldProgram reuse | PASS                                            | The after run is 2.3x to 3.3x cheaper than a cold after run (table below)                                                                                                  |
| G7 no emit          | PASS x5                                         | 0 `writeFile` calls in every run; the workspace tree hash is unchanged after each child                                                                                    |
| G8 perf ceiling     | PASS x5                                         | Worst p95 1522 ms (v19), worst peak RSS 403 MiB (v19): see table                                                                                                           |
| G9 CI cost          | PASS (proxy)                                    | See below                                                                                                                                                                  |

## Per-major measurements (100 widgets / 300 templates, 10 runs, check path)

| Major | compiler-cli | TS    | p50 ms | p95 ms | before / after p50 ms | cold after p50 ms | peak RSS MiB | install MiB |
| ----- | ------------ | ----- | ------ | ------ | --------------------- | ----------------- | ------------ | ----------- |
| 18    | 18.2.14      | 5.5.4 | 979    | 1013   | 661 / 62              | 203               | 354          | 72          |
| 19    | 19.2.15      | 5.8.3 | 1492   | 1522   | 1005 / 224            | 508               | 403          | 56          |
| 20    | 20.3.34      | 5.9.3 | 1129   | 1141   | 772 / 92              | 265               | 367          | 55          |
| 21    | 21.2.25      | 5.9.3 | 1130   | 1140   | 769 / 90              | 263               | 361          | 53          |
| 22    | 22.2.4       | 6.0.3 | 1172   | 1209   | 791 / 101             | 270               | 381          | 50          |

`totalMs` is the wall time of the whole child (spawn, before, after, reply). With 10 samples the
nearest-rank p95 is the maximum sample. Sensitivity with 300 widgets (900 components and templates,
3 runs): v18 p95 1323 ms / 404 MiB, v22 p95 1533 ms / 438 MiB.

**Heap calibration.** A single run at each of 256, 384, 512, 768 and 1024 MiB passed on every major
at 300 templates, and on v18 and v22 at 900 templates. The measured peak RSS
is below 440 MiB. Keep `--max-old-space-size=1024` for the product: the ceiling is the contract,
the measured need is far below it, and real projects are heavier than this fixture.

**G9.** `node_modules` of the five workspaces totals 286 MiB. A cold `yarn install` that added them
fetched 168 MiB in about 5.6 s on this network (8.8 s overall). The harness exercises all five
majors (35 child runs) in 24 s in total, below the 60 s threshold, so no separate `test:angular-matrix`
job is planned yet. This is a proxy: re-check with the real per-major test files in PR 2 and 3
(task 3.22).

## Findings that change the design

1. **`getTemplateTypeChecker` is not an export of `.`.** It is a method of `program.compiler`
   (`NgtscProgram.compiler` is a public readonly property). It also throws unless the compiler
   option `_enableTemplateTypeChecker: true` is set; that option is underscore-prefixed in
   `NgCompilerOptions`. Use of it is the one non-obvious dependency on ngtsc internals.
   The spec and design text "exports `getTemplateTypeChecker` from `.`" should read "the checker is
   reachable through `NgtscProgram#compiler.getTemplateTypeChecker()`".
2. **A fully public alternative exists.** `program.getNgSemanticDiagnostics()` (the `api.Program`
   interface) filtered to the scope files found the same added error on all five majors (gate
   G2b), with no internal option. It costs 90 to 290 ms more at p50 and the same RSS (p50 1271,
   1582, 1389, 1368, 1417 ms for majors 18 to 22). PR 2 should pick one path; the public-only path
   is the lower-risk choice and fits inside the ceiling.
3. **`getComponentsWithTemplateFile` resolves.** It exists on `program.compiler` on every major and
   mapped each edited `.html` to its component. Open question 1 is closed: no parent-side
   template-to-class fallback is needed.
4. **Exit mapping.** The V8 out-of-memory exit was observed as `signal: SIGABRT` with `code: null`.
   The supervisor must test the signal as well as exit code 134.
5. **`oldProgram` reuse only pays off with a shared SourceFile cache.** The after host must return
   the same `SourceFile` objects for unchanged files; the overlay files are parsed fresh.
6. The TypeScript version check is a thrown error from ngtsc ("The Angular Compiler requires
   TypeScript ..."), as the design expected.

## Limits of this evidence

- One machine, one Node version, warm file cache. The fixture is synthetic: small templates, no
  `CommonModule`, no third-party libraries, no stylesheets. Real applications will be slower and
  larger; the 6x to 10x latency headroom and the 2.5x RSS headroom are the margin for that.
- Only the pinned and out-of-range TypeScript pairs were run (no minor-by-minor sweep per range).
- Node versions below 24.15 were not run (Angular 22 needs 24.15 or newer).
- Timing covers the child only. The wrapper (preflight, overlay build, diff) is added by PR 2.

## If the gate had failed (what would ship instead)

Any STOP gate failing on a whole major would stop PRs 2 to 4. Only a limitation document and a
CHANGELOG note would ship: rename plans keep reporting TypeScript diagnostics only, and users run
their Angular build or tests to catch template breaks (spec scenario "Spike fails"). Because the
verdict is "proceed", this path is not taken.

## Reproduce

```sh
yarn install --immutable
node scripts/spike/angular-typecheck-spike.mjs --all --json spike.json
```

Exit code 0 means proceed, 1 means stop, 2 means a harness error. Requires Node with native
TypeScript type stripping (>= 22.18).
