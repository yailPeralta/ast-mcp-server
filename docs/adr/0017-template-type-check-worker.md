# ADR 0017: Check template types of rename plans in a one-shot child process

## Status

Accepted. Spike verdict: proceed (`docs/spikes/0421-template-type-check.md`).

## Context

`ast_rename_symbol` rewrites external Angular templates, but its `diagnostics` delta only sees TypeScript, so a rename that breaks a template binding produced no signal (#421). Angular's own compiler (ngtsc) is the only authority on template types. It is large, loads the project's TypeScript, can use hundreds of MiB, and can abort the process on out-of-memory. The plan must also stay hash-bound and the workspace must never be written during preparation.

## Decision

`createPlan` calls one deep module, `checkTemplateTypes`, after the TypeScript delta and before the `workspaceAfter` digest check, inside the project lock. The module resolves and validates the project's packages in-process, then forks a **one-shot child** that runs ngtsc twice (disk, then disk plus an in-memory overlay of the changed files) and returns raw diagnostics. The parent diffs them with the existing `compareObservedDiagnostics` and reports `template_diagnostics`.

### Process model

- `child_process.fork` of our own `dist` entry with `execPath: process.execPath`, `env: {}`, fixed `execArgv: ["--max-old-space-size=1024"]`, `serialization: "advanced"` and `stdio: ["ignore", "ignore", "ignore", "ipc"]`. `fork` has no `shell` option, so no shell is used. One request per process, then exit; the child also exits on `disconnect`.
- The parent budget is `min(30 s, remaining - 10 s)`. Under 2 s the check reports `unfinished/deadline` without spawning. Expiry and client abort send SIGKILL and reap the child before returning.
- V8 out-of-memory maps to `work_exhausted` for both the `SIGABRT` signal form the spike observed and exit code 134. Any other exit, an invalid reply or any other throw maps to `check_failed`.

### Why not worker threads or a warm pool

- Worker threads share the server's RSS, so a check cannot be measured or bounded alone, and a native crash kills the server.
- A warm pool keeps stale programs between plans, and ADR 0014 already rejected pools for cross-client ownership and mutation-recovery reasons. A one-shot child costs one cold start per template-editing plan, which the spike measured well inside the ceiling (worst p95 1522 ms against 10 s, worst peak RSS 403 MiB against 1 GiB).
- The ADR 0014 compiler worker is an MCP relay with 256 KiB frames. It cannot carry overlay payloads, and it serves compiler reads, not a per-plan check, so it is not reused.

### Public API only

The child imports only an entry whose realpath passed the ancestor-`node_modules` guard shared with `loadCompiler`, and only public exports (`NgtscProgram`, `readConfiguration`, `createCompilerHost`). Diagnostics come from the public `program.getNgSemanticDiagnostics()`. It never imports `private/*` and never uses the underscore-prefixed `_enableTemplateTypeChecker` option. Scope uses `program.compiler.getComponentsWithTemplateFile`, confirmed on majors 18 to 22. A missing export gives `unavailable/compiler_unsupported` before any program is built. `@angular/compiler-cli` must have the same version as `@angular/compiler`, `@angular/core` the same major, and the TypeScript resolved from the compiler-cli directory must sit inside its `peerDependencies.typescript` (`typescript_incompatible` otherwise). It is not a declared peer: it must resolve from the project, otherwise the status is `unavailable/compiler_cli_missing`.

### No-write mechanism

ngtsc `emit()` is never called. `noEmit: true`, `incremental: false`, `composite: false` and `tsBuildInfoFile: undefined` are forced over the tsconfig, and the compiler host `writeFile` is a throwing stub whose throw becomes `check_failed`. The overlay exists only in memory and holds only the changed files. The workspace digest check that already follows closes the time-of-check window for the child's disk reads.

### Plan hash and persistence: v2 and v3

`planHashFor` keeps version 2 and today's exact field set when `template_diagnostics` is absent, so plans without a check hash and persist exactly as before. Version 3 adds `template_diagnostics` and `block_on_template_errors` to the hashed JSON, and the persisted envelope uses `schema_version: 3`, only for plans that carry the field. v1 and v2 still verify. A template-editing rename always carries the field, so it persists as version 3 even when the status is `unavailable` or `unfinished`.

### Output contract

- `template_diagnostics` is present only when the check ran or tried to; it is absent for non-Angular projects, for renames that edit no template and for other operation kinds. Non-completed statuses always carry empty arrays.
- `template_diagnostics[].file` is relative to the directory of the tsconfig, while `diagnostics[].file` is relative to `project_root`. They differ when the tsconfig is not at the project root.
- `block_on_template_errors` defaults to `false`. `blocked = !allow_new_errors && (tsErrors > 0 || (blockOnTemplate && status === "completed" && added_errors > 0))`. A non-completed status never blocks.

## Consequences

- Positive: template breaks from a rename are visible in the same reviewed plan, with a typed status that never reads as clean when unknown; the server survives ngtsc crashes, OOM and hangs.
- Cost: template-editing renames pay one child start and two ngtsc runs. Measured integration timings: about 52 s for the post-build operations integration file, 21 s for the parallel core file and 5 s for the built child file, so no separate CI job was added.
- Limits: best effort. Inline templates are refused before any edit, `unavailable` and `unfinished` mean unknown (run the project's build or tests), and a tsconfig reached through a symlink may produce `file` values relative to the unresolved directory.

## Rollback

Revert the wiring commits in reverse order. Plans persisted as version 3 before a revert or downgrade are rejected on import (`schema_version` unknown). They are short-lived prepared plans, and re-preparing them produces valid plans for the older release. There is no operator kill switch.
