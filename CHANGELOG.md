# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ast_find_references` lists the binding usages of a selector-public member (`@Input`, `@Output`, `input()`, `output()` without aliases) in the templates of consuming components whose literal `imports` include the declaring standalone component, and reports `completed` only when every component template in the Project was read and every match resolved; otherwise `unfinished` with `cross_component`, `work_exhausted` or the template's own reason. (#408).
- Consumer template usages are also resolved through NgModules: a consumer declared in exactly one module with literal `declarations` sees that module's declarations plus the `exports` of its `imports`, followed through re-exported modules, and a standalone consumer importing a module sees its `exports`. When the `standalone` flag is absent, `@angular/core` 18 treats the consumer as module-declared and 19 or later as standalone. Spreads, variables, project calls such as `forRoot()`, a consumer declared in several modules or in none, and chains deeper than 32 modules stay `unfinished` with `cross_component` (#408).
- Consumer template usages follow literal aliases (`@Input('a')`, `@Input({ alias: 'a' })`, `input(x, { alias: 'a' })`, `output({ alias: 'a' })`), `model()` and `model.required()` (a two-way `[(x)]`, `[x]` and `(xChange)`, or the alias and `aliasChange`), and members listed in literal `inputs` / `outputs` metadata (`'x'`, `'x: alias'`, `{ name, alias }`). A non-literal alias or metadata entry stays `unfinished` with `cross_component` (#408).
- `ast_find_references` lists `| name` usages (kind `TemplatePipeName`) of a `@Pipe` class with a literal `name` and of its `transform` member, in the templates of components whose resolved scope (standalone or NgModule) contains the pipe class. A pipe with the same name outside that scope is ignored; a non-literal `name`, an opaque consumer scope that could see the pipe, or an unreadable template stays `unfinished`. `ast_rename_symbol` now renames a `@Pipe` class with TypeScript edits only (the `name` literal and every `| name` usage stay), while renaming `transform` stays refused with `INCOMPLETE_EVIDENCE` (#408).
- `ast_rename_symbol` now renames a selector-public member (`@Input`, `@Output`, `input()`, `output()`, `model()`) together with its consumer bindings when coverage is `completed`: each external consumer template gets a per-usage rewrite that keeps `[` `(` `[(` `bind-` `on-` `bindon-` and the values, a `model()` event key becomes `<name>Change`, and alias-keyed bindings stay. Consumer `.html` files are listed in `affected_files`, bound by hash and rolled back like the member's own template. It returns `MUTATION_BLOCKED` before any write for an inline consumer template, `[(x)]` on a non-`model()` pair, a new name that duplicates another input, output or alias of the directive (or its derived `Change` name) or is bound by another directive matched on the same element, `$any`, or a name in the directive's own selector. Opaque scopes, `hostDirectives`, `@Directive` members, non-literal aliases, members listed in `inputs` / `outputs` metadata and pipe `transform` stay `INCOMPLETE_EVIDENCE`. Diagnostics remain TypeScript-only, so run the project's build or tests afterwards (#408).

### Fixed

- Selector-public component members (`@Input`, `@Output`, `input()`, `output()`, `model()`) and `@Pipe` classes reported `template_coverage: completed` (pipes reported nothing), and a rename of an `@Input` was planned without blocking although the consuming templates were never read. They now report `unfinished` with the new reason `cross_component` (own-template usages are still listed for inputs and outputs), and `ast_rename_symbol` refuses them with `INCOMPLETE_EVIDENCE` (#407).
- `@Directive` members declared with `@Input`, `@Output`, `input()`, `output()` or `model()` reported no `template_coverage`, and members listed in the `inputs` / `outputs` metadata arrays of a `@Component` or `@Directive` were treated as plain members, so `ast_rename_symbol` planned their rename without blocking. They now report `unfinished` with reason `cross_component` (directives with `templates: 0`; a non-literal metadata array marks every member of the class), and `ast_rename_symbol` refuses them with `INCOMPLETE_EVIDENCE` (#410).

## [0.15.1] — published to `next`, verification failed, not promoted (2026-11-05)

### Changed

- `@angular/compiler` 18 and 19 are now supported (`>=18.0.0 <23.0.0`); an Angular 18 project previously reported `compiler_unsupported` and missed every template usage (#399).

### Fixed

- `publish-next` waits up to five minutes (was two) for the registry to expose an accepted publish before giving up, and when that bound is exhausted after a publish that did not throw, it now points the maintainer at `verify-next` instead of asking for a new dispatch that would try to republish immutable bytes. `0.15.0` was reported as failed 46 seconds before the registry served it (#395).

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit (`20548017b7c9266160963a0272ce8757b8f42a77`, integrity `sha512-+DkpmFAHMnvfKmZhEN8Rrk1baryumHcAkXgcw5YABhC6vzaAmD1WiPLP25YzoFNzSPFgz+L11yW/Nd4Ukq2Ixw==`, publish run `41970126401`, the first `publish-next` to confirm the registry readback under the widened bound). Public-registry verification (run `41970518670`) then failed for the same reason as `0.14.3` and `0.15.0`: the consumer install resolves `minimatch@10.2.6` through `ts-morph@28.0.0`, flagged by `npm audit` for GHSA-g3hv-75wg-m249 (#361). `0.15.1` supersedes `0.15.0` on `next` and was never promoted to `latest`, tagged in Git, or released on GitHub.

## [0.15.0] — published to `next`, verification failed, not promoted (2026-11-04)

### Added

- Angular template references (#370). In projects where `@angular/core` resolves, `ast_find_references` reports usages of a component member in its external (`templateUrl`) and inline templates. Items carry `origin` (`compiler`, `template_external`, `template_inline`), and the response adds `template_coverage` and `template_reference_count`; `reference_count` stays TypeScript-only and `total` counts both. Only `template_coverage.status: "completed"` supports an absence claim.
- `ast_rename_symbol` rewrites external Angular templates in the same reviewed, hash-bound plan, with rollback covering the templates. It returns `INCOMPLETE_EVIDENCE` when coverage is `unfinished` or `unsupported`, and `MUTATION_BLOCKED` for inline-template usages, a new name that collides with a template local, or `$any`. Apply remains sequential, not globally atomic.
- `@angular/compiler` (`>=20.0.0 <23.0.0`) is an optional peer dependency resolved from the target project; it is never bundled. `yarn test:package` now asserts it is absent from the packed `dependencies` and from a consumer install. Yarn PnP projects without `node_modules` report `unfinished` coverage.
- Workspace snapshots and the file watcher include Angular template files when Angular is detected; workspaces without `@angular/core` hash identically to before.

### Changed

- Documented limits: `ast_explore` references stay TypeScript-only (template evidence is tracked as a follow-up issue) and diagnostics, including the post-apply delta, stay TypeScript-only, so template-only errors are not detected.
- The `ast_find_references` and `ast_rename_symbol` descriptions now state the Angular template behavior: `ast_find_references` reports template usages tagged by origin with a `template_coverage` verdict and does not diagnose template errors, and `ast_rename_symbol` also rewrites external templates hash-bound to the workspace snapshot while diagnostics stay TypeScript-only. Input and output schemas are unchanged. The dsh-adapter smoke now declares both descriptions in `test/fixtures/declared-tool-contracts.json` (every other tool must still equal the public 0.13.0 contract), and the tool-inventory, registry-consumer and canary digests were re-baselined (#383).

- The issue #103 `node:test` suites now run once per CI run in a dedicated `fixture` job on pinned Node 24.16.0, in parallel with `quality`, instead of once per `quality` matrix entry; the workflow policy check pins both job chains (#368).
- The CI `quality` job now runs every committed `node:test` suite from the issue #103 chain: `npm-pack-json`, `acquisition`, `setup`, `test-lock`, `prepared-runner` and `prepared-install-build` join the exact-Node fixture command after the four suites it already ran, and the workflow policy check pins the extended command (#364).

### Fixed

- A `project_root` directory whose `tsconfig.json` is solution-style (`"files": []` or no `files`/`include`, plus a non-empty `references` array, as Angular CLI and other `tsc -b` layouts ship) no longer loads as a silent empty project with `source_count: 0`. Resolution now fails closed with a `PROJECT_NOT_FOUND` error that names the referenced configs and asks for one of them as `project_root`; passing a referenced `tsconfig.*.json` file directly is unchanged, and references are never followed automatically (#389).
- `ast_find_references` and `ast_rename_symbol` no longer count the declaration identifier as a reference. When a member was used before its declaration in source order, ts-morph returned the declaration identifier among the references, so the declaration appeared twice and `reference_count` was inflated by one. The declaration is now reported once and `reference_count` counts only real references (#390).
- The dsh-adapter smoke no longer reports a surviving Harness process tree when descendants are still exiting after a clean shutdown on a loaded runner. The lifecycle assertion now polls the owned process tree with a bounded ten-second deadline, and when survivors remain it keeps failing but lists each PID with its command line and parent chain (#363).

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit (`5b2d483001d21ef29a760a9c0ae538dc719f11ea`, integrity `sha512-4dUo7lyTyIGMPhWfVHHZ0BnUMXNAiSIapItorm3VTGiJXm8JyL6jW5lrNlj1LGyONAGtA6S6cHoFtiZxakGy1A==`, publish run `41905976154`). Public-registry verification (run `41906680048`) then failed for the same reason as `0.14.3`: the consumer install resolves `minimatch@10.2.6` through `ts-morph@28.0.0`, flagged by `npm audit` for GHSA-g3hv-75wg-m249 (#361). `0.15.0` was never promoted to `latest`, tagged in Git, or released on GitHub; the version that ships the ts-morph fix will supersede it.

## [0.14.3] — published to `next`, verification failed, not promoted (2026-11-01)

### Security

- Updated `@hono/node-server` to the patched `2.1.5` (GHSA-rmxm-3fg6-px4f, `serveStatic` decoded the request path a second time and could bypass middleware on static paths). It reaches the server only through `@modelcontextprotocol/sdk`, and the pinned resolution moved from `2.0.12`.
- Updated `minimatch` to the patched `11.0.3` (GHSA-g3hv-75wg-m249, potential denial of service through globparts amplification). The pin sits above the `^10.x` ranges still declared by `eslint`, `@eslint/config-array`, `@typescript-eslint/typescript-estree` and `@ts-morph/common`, a documented exception: those packages only call `minimatch()` and `Minimatch#match()`, none of the API removed in `11`, and the dependency-policy test records the exception so it can be dropped once the parents admit `11`.

### Fixed

- `ast_get_impact` with `direction: "incoming"` no longer returns an empty, incomplete result on larger projects. The compiler resolver now finds incoming references through the language service instead of walking every AST node, so its work scales with the number of references rather than the project size, and the project-wide computed-call scan runs on its own budget so it can no longer starve the reference lookup (#353).

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. Public-registry verification then failed because the consumer install resolves `ts-morph@28.0.0 → @ts-morph/common@0.29.0 → minimatch@10.2.6`, vulnerable to GHSA-g3hv-75wg-m249, and the root `minimatch` resolution does not reach consumers (#361, upstream dsherret/ts-morph#1697); `0.14.3` was never promoted to `latest`, tagged in Git, or released on GitHub.

## [0.14.2] — published to `latest` and `next`, registry verified (2026-10-28)

### Security

- Updated `qs` to the patched `6.16.1` (GHSA-6pq8-jhm2-2vcw, `qs.stringify` with `arrayFormat: 'comma'` could throw an uncaught `TypeError`). `qs` reaches the server through `express` and `body-parser`, and the pinned resolution moved from `6.16.0`.

### Changed

- Updated runtime dependencies: `ts-morph` from `24.0.0` to `28.0.0`, `@toon-format/toon` from `4.1.0` to `4.4.0`, and `@modelcontextprotocol/sdk` from `1.32.1` to `1.32.2` in the lockfile.
- Updated development tooling: Vitest 5 (now with an explicit `vite` development dependency), `@types/node` 26, `gpt-tokenizer` 4, and patch updates to ESLint, Prettier, `typescript-eslint` and `yaml`. `process.disconnect` is now called optionally in the compiler worker entry to match the stricter Node 26 typings.
- Updated reviewed GitHub Actions pins (`actions/setup-node` 7.1.0, `actions/upload-artifact` 7.0.2, `actions/download-artifact` 8.0.2, `github/codeql-action` 4.39.1), including the release workflow.

### Release status

- npm published immutable `0.14.2` bytes with integrity `sha512-fUKylMtamBEIBdLcGz27udjRLLl1+OTRir+0vRegN8x7JzM13uIZZ5lGFNEc7/rkUiFqmEE9HrrxvTRw2cgnYg==`. Public-registry verification passed; `latest` and `next` both resolve to `0.14.2`; and npm `gitHead`, the annotated `v0.14.2` tag, and the GitHub Release target exact commit `425a967002178dde685cae1dcf0ec5fad533ff54`.
- Publish run `40753973275` succeeded on its first attempt, with no ambiguous readback; verification `40755636111` and promotion `40756782907` are green and authoritative.

## [0.14.1] — published to `latest` and `next`, registry verified (2026-10-26)

### Security

- Deduplicated `zod` in the lockfile to the patched `4.6.7` (GHSA-mrhx-c7xc-m3w5). The `@modelcontextprotocol/sdk` range `^3.25 || ^4.0` had kept a second, vulnerable `4.4.3` copy beside the direct dependency; `yarn audit` did not report it. No runtime code or advertised tool contract changes.

### Release status

- npm published immutable `0.14.1` bytes with integrity `sha512-Z9a0rXsYYf+Eef8XCoA6qrId1puqiq3nFjsb5FP165OsvRr666MdL9N66/RmHXb/Uu7ynoVZ9X2ZqGSHED4H5A==`. Public-registry verification passed; `latest` and `next` both resolve to `0.14.1`; and npm `gitHead`, the annotated `v0.14.1` tag, and the GitHub Release target exact commit `f37f398b083135f0f65a265c8aca26d9edc5c74d`.
- Publish run `40377206195` reported its readback as ambiguous because of registry lag although npm accepted the version (it appeared about 40 seconds later); verification `40387042272` and promotion `40387852805` are green and authoritative.

## [0.14.0] — published to `latest` and `next`, registry verified (2026-10-25)

### Changed

- Migrated schema validation to Zod 4 (`^4.6.7`). The published `tools/list` contract changes shape and Zod's validation error messages differ: tool input schemas no longer all declare `additionalProperties: false` (16 of 16 before, 1 of 16 now), shared `$ref` definitions are inlined (27 before, 0 now), the serialized `tools/list` grows from 100,923 to 126,562 bytes, integer fields declare a maximum of 9007199254740991, and UUID fields gain a `pattern`. Clients that cache or diff the advertised schemas should refresh them.

### Security

- Upgraded `@modelcontextprotocol/sdk` to `^1.32.1` (GHSA-6qxp-vccf-f47h), `body-parser` to 2.4.0, and `zod` to 4.6.7 for the memory-exhaustion advisory, and raised the `hono` and `fast-uri` resolutions to 4.13.13 and 3.1.9. `yarn audit` reports no suggestions.

### Release status

- npm published immutable `0.14.0` bytes with integrity `sha512-+g1GpmB9ZMd4tB/z7o75AZ4LdnqEn+MQDiRh0LDBV2j4xb9iKB8XMoiME47tW0u2HgfxWsKtQBChGxfnrz3dVw==`. Public-registry verification passed; `latest` and `next` both resolve to `0.14.0`; and npm `gitHead`, the annotated `v0.14.0` tag, and the GitHub Release target exact commit `f6e64751398f69eb3f0f1abc808f4221f7d2bc52`.
- Publish run `40232707904` reported its readback as ambiguous because of registry lag although npm had accepted the version; verification `40249874010` and promotion `40255528749` are green and authoritative.

## [0.13.1] — published to `latest` and `next`, registry verified (2026-09-01)

### Fixed

- The DeepSeek Harness adapter now opts into a bounded canonical-JSON text projection when a successful MCP result has structured data but no ordinary text, preserving lossless `structuredContent` while making native Agent/Session results useful and durable. The mandatory pinned-host smoke freezes the public 0.13.0 RED baseline and verifies the released correction across the next model request, persisted `tool/result`, cold replay, guarded catalog, and cleanup readback.
- `ast_explore` now publishes its complete object input schema while retaining all cross-field runtime rejection, and `ast_get_impact` no longer advertises one false output shape across JSON and TOON. The pinned Harness gate binds the public empty-schema RED to released registry/native parity and unchanged hashes for the other 14 model schemas.
- Timeout ownership is now explicit across the Harness, queue, and AST worker: the shipped outer timeout exceeds the complete queue/execution/margin budget, deterministic slow work returns bounded AST-owned operational errors, queued work never starts after its deadline, cancellation remains correlated across worker generations, and cleanup proves zero active work, held requests, listeners, or owned processes.
- Harness lifecycle handling now converges deterministically through MCP removal and reconnect, rejects retired-generation effects, preserves AST `REQUEST_CANCELLED` authority separately from bridge transport observations, and completes correlated shutdown without residual state. The pinned native and rendered-GUI gates verify the `15→0→15` catalog sequence, request/header identity, secret-safe diagnostics, and ordered cleanup that still runs every owner check after an earlier cleanup failure.

### Release status

- npm published immutable `0.13.1` bytes with integrity `sha512-jqgGoYs8fe7J+E25lZusLK4wV6sjM5n5qiWnfe1RJIxOFo1r5nbtcBr1a/fdSWTYf/37bUNkshQp86UrdBHOsA==`. Public-registry verification passed; `latest` and `next` both resolve to `0.13.1`; and npm `gitHead`, the annotated `v0.13.1` tag, and the GitHub Release target exact commit `27b80a3da169b473a3b5c5dfea69ed52903ed4c7`.
- Main CI `33460585683`, Security `33460585625`, publish `33461292810`, verification `33461385440`, and promotion retry `33461651288` are green. Initial promotion run `33461571363` changed `latest` successfully but its bounded readback timed out; the verified idempotent retry is authoritative.

## [0.13.0] — published to `latest` and `next`, registry verified (2026-08-29)

### Added

- DeepSeek Harness Developer Preview adapter (roadmap initiative 4, first slice): `cordis.patch.yml` mounts the packaged `ast-mcp-server` stdio command through `@deepseek-ai/dsh-mcp-client`, declared via the exact `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` contract with the pinned identity recorded separately in `deepseekHarness` (revision `cd5ef814…`, `dsh-v0.1.2-alpha.1`). The first surface is reads + prepare + preview with a fail-closed apply guard (`ast_apply_operation` registers only under an explicit `AST_MCP_APPLY_GUARD=allow`; unset, `deny`, or invalid denies it). `yarn test:dsh-adapter` is a mandatory, never-skipping gate: tarball fixture and hashes, guard matrix, and — against the clean source-built pinned Harness — native-mode profile composition plus Harness-mediated read, dry-run rename, preview, apply absence, and rejected direct apply invocation.

## [0.12.0] — published to `latest` and `next`, registry verified (2026-08-27)

### Added

- Diagnostic pagination can now include opt-in bounded aggregates computed from the complete normalized snapshot, with code and file dimensions capped at 20 entries and explicit coverage metadata.
- Added an immutable tool capability catalog with MCP, batch, and agent projections derived from one source of truth, plus independent inventory, integration, canary, package, and documentation oracles.

### Fixed

- Canary validation continues to enforce the established public runtime gate payload while capability metadata is checked independently, preventing an internal catalog change from widening the public canary schema.

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. Public-registry consumer and release-preflight verification passed, `latest` and `next` both resolve to `0.12.0`, and the annotated `v0.12.0` tag plus GitHub Release resolve to the same release commit.

## [0.11.2] — published to `latest` and `next`, registry verified (2026-08-25)

### Added

- Added an explicit per-connection supervised compiler-worker mode that can recycle an idle compiler child while the local stdio parent remains connected; `in_process` remains the default and rollback, and TTL `0` disables recycling.
- Added scoped Linux evidence on exact Node.js 22.13.0 and Node.js 24 for PSS reclamation, stable compiler fingerprints, SQLite reuse, bounded redaction, and parent-death cleanup without orphans.

### Fixed

- Compiler-worker startup now waits for `ready` before replaying initialization, preventing cross-channel settlement ordering from rejecting the first forwarded request as stale.
- CLI project-discovery fixtures now create the external project directory before concurrent configuration writes, eliminating a nondeterministic `ENOENT` setup race.
- Public-registry verification now copies the isolated runner's complete local runtime dependency closure, including the shared managed-skill validator, before launching it outside the source tree.
- A deterministic copied-runner regression executes the isolated entry point and rejects any local import omitted by its production bootstrap.

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. Public-registry consumer and release-preflight verification passed, `latest` and `next` both resolve to `0.11.2`, and the annotated `v0.11.2` tag plus GitHub Release resolve to the same release commit. This release supersedes immutable versions `0.11.0` and `0.11.1`, whose separate public-registry verification defects prevented promotion.

## [0.11.1] — published to `next`, verification failed, not promoted (2026-08-23)

### Fixed

- Public- and local-registry consumer verification now share one dependency-free managed-skill validator that derives the expected release version from the bundled skill metadata, compares installed copies byte-for-byte, and rejects embedded managed guidance.
- The exact-tree release matrix now runs `test:local-registry` under both supported Node.js lanes, preventing managed-asset verifier drift from reaching publication again.

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. Public-registry verification then failed because the isolated registry runner omitted its newly imported managed-skill validator module; `0.11.1` was never promoted to `latest`, tagged in Git, or released on GitHub.

## [0.11.0] — published to `next`, verification failed, not promoted (2026-08-23)

### Added

- Managed setup and `install-skill` now install manifested multi-file skill bundles atomically, verify every bundled digest, and admit exact npm-proven predecessor bytes without treating version text as ownership.
- `ast-tool upgrade --check` inspects supported direct npm and Volta installations without mutation; `ast-tool upgrade` performs the safe direct update with isolated package-manager state and then reconciles managed assets.
- CLI batch and doctor project selection now discovers the nearest `tsconfig.json` or `jsconfig.json` up to the Git or filesystem boundary, while rejecting same-level ambiguity and symlinked config identities.
- `ast-tool doctor` reports bounded, privacy-safe compiler, session, index, and queue state with executable continuations; unavailable registered-session evidence is reported as `not_run` instead of being fabricated.

### Fixed

- Project watchers now ignore events owned by exact symbol-index cache artifacts while preserving legitimate source invalidations, including POSIX filenames containing a literal backslash.

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. Public-registry verification then failed because two consumer validators still required skill bundle `4.4.0` while the package correctly contained `4.5.0`; `0.11.0` was never promoted to `latest`, tagged in Git, or released on GitHub.

## [0.10.0] — published to `latest` and `next`, registry verified (2026-08-22)

### Added

- Added deterministic atomic `ast_explore` clusters, categorized omission metadata, opt-in compiler-authoritative call spines, and registered-handler parity across MCP and the batch CLI.
- Added read-only `ast_find_test_candidates` across MCP and `ast-tool run`, with incoming compiler authority, fail-closed incomplete evidence, whole-candidate pagination, and lossless final JSON/TOON parity.

### Fixed

- Oversized `ast_explore` call-spine aggregates are omitted atomically instead of failing valid requests.
- SQLite capability fallback now preserves fresh compiler-backed reads while retaining failed memory-backed index observability. Stable capability and invalid-root fallbacks retry only after restart or policy change; transient storage failures continue to recover automatically.

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. Public-registry consumer and release-preflight verification passed, `latest` and `next` both resolve to `0.10.0`, and the annotated `v0.10.0` tag plus GitHub Release resolve to the same release commit.

## [0.9.2] — local release candidate, pending release (2026-08-16)

### Fixed

- Public-registry verification now derives both the consumer report and the release-preflight exact-key validator from one canonical SQLite-default gate contract, preventing duplicated fixtures from masking producer/validator drift while preserving fail-closed rejection of missing or unexpected gates.

### Release status

- This local recovery candidate is pending exact-tree CI and the repository's separately authorized delivery sequence. It has not been published to npm, assigned to `next` or `latest`, tagged in Git, or released on GitHub; registry and GitHub readbacks remain authoritative.

## [0.9.1] — published to `next`, verification failed, not promoted (2026-08-16)

### Fixed

- Public-registry verification now creates and normalizes its harness-owned explicit canary cache root to owner-private `0700`, independent of the runner umask, before exercising the package's fail-closed SQLite storage boundary.

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. The public registry consumer passed every package, provenance, SQLite, mutation, and setup gate, including the corrected owner-private canary root; final release preflight then rejected the report because its duplicated exact-key schema still described the earlier memory-default gate set. Version `0.9.1` was never promoted to `latest`, tagged in Git, or released on GitHub.

## [0.9.0] — published to `next`, verification failed, not promoted (2026-08-16)

### Added

- Added bounded `ast-tool cache inspect` and confirmation-gated `ast-tool cache clear --yes`; both avoid host paths, reject unsafe trees, preserve unknown files, and perform no automatic garbage collection.

### Changed

- Native SQLite is now the requested symbol-index backend when `AST_SYMBOL_INDEX_PERSISTENCE` is absent or `enabled`; explicit `disabled` remains the immediate memory-only rollback, and `canary` still requires an explicit safe root.
- The current development-line engine floor and lower evidence lane are Node.js `>=22.13.0` and exact `v22.13.0` respectively; Node.js 24 remains governed by major, and active harnesses no longer use `--experimental-sqlite`.
- Default persistence resolves through an explicit override, XDG cache home, then HOME, while invalid explicit overrides fail closed instead of being hidden by another root.
- Integration, package, CLI and consumer harnesses now exercise default SQLite, restart reuse, explicit rollback, mutation-only cache isolation and private artifacts.

### Fixed

- Promotion now tolerates bounded npm dist-tag propagation lag while revalidating package version, `gitHead`, integrity, provenance, and the complete `next`/`latest` state on every readback.

### Security

- Package-created cache directories use `0700`; SQLite main, WAL, SHM and quarantine artifacts use `0600` on supported Linux, with no-follow, ownership, link-count and device/inode validation around database open, quarantine and cleanup.

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. Public-consumer verification stopped because its harness created the explicit canary cache root without guaranteeing owner-private permissions; the package correctly failed closed. Version `0.9.0` was never promoted to `latest`, tagged in Git, or released on GitHub.

## [0.8.1] — published to `latest` and `next`, registry verified (2026-08-14)

### Fixed

- Public-registry verification now prepares the pinned GNU coreutils 9.7 `mv` primitive before running the managed-setup consumer smoke, and workflow policy rejects removal or reordering of that prerequisite.

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. Public-consumer verification passed, `latest` and `next` both resolve to `0.8.1`, and the annotated `v0.8.1` tag plus GitHub Release resolve to the same release commit.

## [0.8.0] — published to `next`, verification failed, not promoted (2026-08-14)

### Fixed

- OpenCode effective-config discovery and verification now run against disposable routed copies because the client normalizes both configured files even for diagnostic commands; the real planned destination remains snapshot-protected.

### Added

- Added managed `structural-code-editing` activation guidance for the verified Claude, OpenCode, Codex, and Gemini global instruction surfaces; Hermes and Copilot remain explicitly skill-only.
- Added an exact SHA-256 release manifest for safe upgrades from registry-proven skill bytes and packaged the canonical marker-free guidance payload.

### Changed

- Setup now preflights MCP, skill, and guidance across every selected client before mutation, preserves user-owned instruction bytes, applies snapshot-checked descriptor-bound file writes, and reports schema v2 with logical outcomes plus completed, possibly committed, rolled-back, rollback-failed, pending, and successful physical asset states.
- `install-skill` uses the same official-byte manifest but remains skill-only; explicit force never bypasses guidance ownership, route, or race checks.
- Managed file writes hold staged and preimage inodes through publication, use no-clobber descriptor links for creation and atomic exchange with exact-pair rollback for replacement, reject same-inode content or mode races before cleanup, then reauthenticate unchanged/completed postimages before later asset or MCP writes.

### Release status

- npm published these immutable bytes under `next` with provenance and the expected Git commit. Public-consumer verification stopped during managed setup because the verification workflow had not prepared its required GNU coreutils 9.7 `mv`; the package was never promoted to `latest`, tagged, or released on GitHub. Version `0.8.1` superseded it after verified publication.

## [0.7.2] — published to `latest`, registry verified (2026-08-13)

### Fixed

- Promotion preflight now validates raw npm registry metadata exactly once, compares live integrity with the verified artifact before and after mutation, and classifies the normalized readback without reinterpreting its field schema.
- Added a composed regression covering eligible, already-promoted, and integrity-drift promotion readbacks.

### Added

- Expanded convergent setup to Claude Code, Hermes, OpenCode, Codex CLI, Gemini CLI, and GitHub Copilot CLI with fail-closed versioned contracts.
- Added native checkbox selection, shared `.agents/skills` planning, routed JSONC-safe OpenCode configuration, bounded correlated diagnostics, and fixture admission gates.

### Release status

- npm promoted the immutable `0.7.2` bytes to `latest`. Later `next` assignments do not alter those bytes, and the `0.8.x` sections above describe distinct package versions that cannot be attributed to `0.7.2`.

## [0.7.1] — published to `next`, verified, not promoted (2026-08-12)

### Fixed

- Public-registry verification now creates physical fake Claude Code and Hermes executables, preserving each agent identity after executable canonicalization.
- Added a regression through the real agent detector so future consumer smokes cannot reintroduce identity-collapsing symlinks.

### Release status

- The package was published under the `next` dist-tag with valid npm provenance and passed its exact-SHA public-consumer verification. Promotion was rejected before mutation because the preflight passed a normalized registry record back into the raw-record validator. It was never promoted to `latest`, tagged, or released on GitHub; `0.7.2` supersedes it.

## [0.7.0] — published to `next`, not promoted (2026-08-12)

### Added

- Compiler-backed, freshness-aware impact traversal with bounded direct/transitive relationships and fail-closed test-candidate evidence.
- Opt-in SQLite symbol-index canary with corruption/write-failure fallback, restart reuse, explicit recovery, and bounded project-status observability; default and reserved `enabled` policies remain memory-only.
- Bounded per-project scheduling, cancellation/deadline semantics, idempotent graceful shutdown, and a closed public-error envelope with correlation IDs.
- Deterministic Linux x64 production-readiness evidence across Node.js 22.5.0 and Node.js 24 for this repository and `x-scraper`.
- Exact-SHA staged release workflows for `next` publication, public-registry verification, and separately authorized `latest` promotion.

### Changed

- Symbol search and impact discovery now remain compiler-authoritative while applying deterministic limits before globally materializing expensive relationships.
- The supported release target is explicitly Linux x64 with the required GNU coreutils publication primitive; other platforms and architectures remain unverified.
- The package now ships its support and security policies alongside the README, changelog, binaries, and bundled structural-editing skill.

### Security

- Release preparation, GitHub authorization, OIDC publication, and npm-token promotion use physically separated least-authority phases with lifecycle scripts disabled.
- Workflow actions, permissions, inputs, conditions, commands, environments, and credential placement are checked against a closed immutable policy.
- Package publication binds exact tarball bytes and packed `gitHead` to the authorized SHA; consumer verification independently proves preview/apply/replay postimages and no-write failure paths.
- Public MCP and stderr errors are bounded and sanitized against source, path, stack, environment, and credential disclosure.

### Release status

- The package was published under the `next` dist-tag with valid npm provenance, but its deterministic public-consumer verification failed because the verifier canonicalized both fake agent symlinks to one fixture identity. The package was never promoted to `latest`, tagged, or released on GitHub; `0.7.1` supersedes it.

## [0.6.0] - 2026-08-05

### Added

- Read-only `ast_get_file` with bounded exact source lines, SHA-256 byte hashes, compiler snapshot state, and `symbols_only` body-free output.
- `ast_get_file` now also returns bounded project freshness metadata, distinguishing fresh, pending, stale, rebuilding, and degraded session state from the file-level snapshot state.
- Project-scoped file snapshot validation with UTF-8 checks, traversal rejection, symlink containment checks, and ambiguous-path failures.
- Read-only `ast_explore` with query/file/symbol routing, progressive source and compiler-reference evidence, freshness/completeness metadata, unresolved selectors, and serialized byte budgets.
- Public trust guidance for compiler, syntax, heuristic and derived-index evidence, including the fail-closed rules for stale/degraded reads and compiler-backed test candidates.
- A deterministic context workflow benchmark comparing full-file, primitive, and composed exploration workflows.

## [0.5.1] - 2026-08-05

### Added

- Bounded JSON-safe project status contracts and the read-only `ast_get_project_status` tool.
- Session freshness metadata with separate source, config, and canonical fingerprints.
- Serialized operation-queue accounting and status integration without changing reviewed mutation semantics.

### Changed

- Source synchronization verifies stability across refresh, snapshot, refresh, and verification before reporting fresh state.
- Phase 1 keeps the symbol index disabled while exposing explicit stale/degraded recovery state.
- Documentation now distinguishes file snapshot freshness from project freshness, reports bounded read budgets/truncation, and defines the prepare-review-apply mutation boundary.

### Security

- Status projections redact identities, absolute paths, credentials, and multi-token `Authorization` values at both transition and projection boundaries.
- Noncanonical external fingerprints are converted to bounded opaque SHA-256 digests before projection.

## [0.5.0] - 2026-08-03

### Added

- Relevance-ranked symbol search with `selectors`, `summary`, and backward-compatible `full` detail profiles.
- Progressive semantic references with location-only defaults and opt-in bounded source context.
- `ast_scaffold_class`, a strict prepare-only class scaffold that generates explicit throwing method placeholders and uses the existing preview/apply protocol.
- Hash-bound absent-file plans with atomic no-clobber creation, conservative rollback, persisted replay, and idempotent receipt recovery.
- A checked result-shaping workflow benchmark covering ranking, selector chaining, multi-file references, JSON/TOON payloads, call counts, evidence preservation, and complete tool metadata.

### Changed

- Symbol search now defaults to ranked `summary` records with a 20-result page. Use `detail: "full", limit: 100` for the v0.4.0 result profile.
- Reference search now defaults to `locations` without source lines. Use `detail: "context"` for the v0.4.0 record profile.
- MCP and batch client identity now derives from the shipped package version instead of a separately maintained literal.

### Security

- Scaffold inputs are strict and bounded; identifiers, duplicates, raw TypeScript fragments, paths, parent directories, and target absence are validated before plan creation.
- File creation uses same-directory exclusive staging plus an atomic hard-link commit and never falls back to overwrite-capable rename.
- Existing rename/body-replacement plan hashes and persisted modification plans remain compatible.

## [0.4.0] - 2026-08-03

### Added

- Opt-in TOON envelopes for symbol search, semantic references, and diagnostics through `output_format: "toon"`.
- Plain TOON output for final read-only batch results through `ast-tool run --output-format toon`.
- Reproducible JSON/TOON benchmark with lossless round trips, UTF-8 bytes, `o200k_base` token estimates, encoding latency, static tool-metadata accounting, and negative controls.

### Changed

- Collection-heavy tools validate their canonical Zod outputs explicitly before returning JSON or TOON. They no longer advertise one MCP `outputSchema` because their structured result can be either the canonical object or a TOON envelope.
- The bundled structural-code-editing skill now selects TOON only for measured collection shapes and keeps JSON for source, outline, file-list, and mutation workflows.

### Security

- Batch steps reject statically declared and dynamically resolved TOON intermediates before the affected invocation.
- TOON output is capped at 10 MiB after UTF-8 encoding, and mutation preparation remains JSON-only so review coordinates are never compacted.
- Successful MCP TOON output is decode-checked against the validated value, and MCP error text is capped at 64 KiB of UTF-8.
- The transitive Hono runtime is resolved to `4.12.34`, closing GHSA-8j4g-w8fx-2239 from the MCP SDK dependency tree.

## [0.3.0] - 2026-08-03

Initial public release.

### Added

- Bounded structural reads for project files, symbols, outlines, references, exact declaration source, and TypeScript diagnostics.
- Hash-bound `prepare → review → apply` operations for project-wide symbol renames and body replacements.
- Persistent CLI plans with workspace/config fingerprints, cooperative locks, exact postimages, conservative rollback, and idempotent receipts.
- Declarative batch CLI with bounded fan-out, deterministic aggregation, compact `emit`, and persisted prepare plans.
- Bundled `structural-code-editing` skill for Claude Code and Hermes.
- Interactive and non-interactive agent setup that detects clients, installs the skill, registers the MCP server, verifies its tools, and replays safely.
- Yarn 4 package workflow with dependency lifecycle scripts disabled and isolated installed-tarball smokes.

### Security

- New TypeScript diagnostics fail a prepared mutation closed unless explicitly reviewed with `allow_new_errors`.
- Apply rejects stale workspaces, changed configs/sources, mismatched plan hashes, unsafe plan files, conflicting MCP registrations, and conflicting skill content.
- Inputs, outputs, operation stores, subprocesses, batch fan-out, plan lifetime, and filesystem access are bounded.

[0.6.0]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.6.0
[0.5.1]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.5.1
[0.5.0]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.5.0
[0.4.0]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.4.0
[0.3.0]: https://github.com/yailPeralta/ast-mcp-server/releases/tag/v0.3.0
