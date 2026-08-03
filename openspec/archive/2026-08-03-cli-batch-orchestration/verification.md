# Verification: CLI batch orchestration

Date: 2026-08-03
Status: PASS

## Environment

- Node.js: v24.16.0 for canonical gates and benchmark.
- Minimum supported runtime: Node.js v20.19.0, exercised directly with the complete 43-test suite and both transport smokes.
- Package version: 0.3.0.
- Repository: `ast-mcp-server`.
- The supplied checkout has no `.git` directory, so branch status and a clean-tree assertion were not available.

## Canonical gates

- `npm ci`: PASS, 230 packages installed / 231 audited, 0 vulnerabilities.
- `npm run format:check`: PASS.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS for source and test configs.
- `npm test`: PASS, 10 files / 43 tests.
- `npm run build`: PASS.
- `npm run test:mcp`: PASS; stdio handshake, 10 tools discovered, one fixture source listed.
- `npm run test:cli`: PASS; Bash CLI read batch, top-level review coordinates, persisted prepare/apply, cross-process lock rejection and idempotent replay.
- `ast_get_diagnostics` on this repository: 0 errors, 0 warnings.
- `hermes mcp test ast`: PASS; connected in 285 ms and discovered 10 tools through the configured consumer.
- `npm audit --json`: PASS; 0 vulnerabilities at every severity.
- `npm pack --dry-run --json`: PASS; 29 entries, both binaries, runtime modules, README and bundled skill included.
- Fresh tarball install smoke: PASS; installed package returned `status: ok` from `ast-tool`, exposed 10 MCP tools and contained `skills/structural-code-editing/SKILL.md`.

## Requirement traceability

| Requirement | Evidence |
| --- | --- |
| AST-BATCH-001 | Schema and runner tests cover declaration-order refs, `foreach`, compact `emit`, rejected forward refs and static `project_root` overrides. The CLI smoke proves review coordinates remain top-level even when `emit` omits them. |
| AST-BATCH-002 | Validation and execution reject unknown/apply tools, excessive steps/invocations/fan-out/concurrency/input, oversized retained results, >50 MiB cumulative retained context and oversized final output. |
| AST-BATCH-003 | Root `project_root` is injected into every invocation; static per-step overrides are rejected and runtime conflicts fail closed. |
| AST-BATCH-004 | Runner errors include step and item identity; invocation counts reflect started calls and `BatchExecutionError` preserves the original cause. |
| AST-BATCH-005 | Unit tests prove ordered aggregation and bounded parallel execution. |
| AST-CLI-001 | Installed-package and repository CLI smokes exercise JSON stdout, non-zero failures and stdin/file command paths. |
| AST-PLAN-001 | The batch runner persists a single successful prepare, exposes `operation_id`, `plan_hash` and `plan_file` above `emit`, and refuses apply inside a pipeline. |
| AST-PLAN-002 | Plan files use a versioned Zod envelope, restrictive ownership/mode/link checks, exact reviewed hash, TTL and integrity verification before import/apply. |
| AST-PLAN-003 | CLI apply reuses the same operation service as MCP and validates full workspace/config/source fingerprints plus exact postimages. |
| AST-PLAN-004 | Apply serializes in-process and acquires one fail-closed filesystem lock per canonical config/workspace across MCP and CLI. The critical section covers validation, staging, replacement, verification and receipt persistence. |
| AST-PLAN-005 | Unit tests cover stale plans, rollback, concurrent retries, receipt-persistence failure recovery from exact postimages, symlink-swapped targets, hard-linked plans and symlinked plan directories. Partial/divergent state remains rejected. |
| AST-PKG-001 | Package metadata declares Node >=20.19, MCP and CLI binaries; the tarball install smoke executes both and verifies the bundled skill. |
| AST-CI-001 | CI defines Node 20.x and 22.x jobs running install, format, lint, typecheck, tests, build, MCP smoke, CLI smoke, audit and pack. |
| AST-DOC-001 | README and bundled skill document MCP/CLI selection, declarative batch limits, review/apply flow, plan sensitivity, lock scope, recovery and residual filesystem limits. |

## Behavioral and security evidence

- Unknown or malformed pipelines fail validation before project loading.
- Only read tools and one terminal prepare tool are available in batch; `ast_apply_operation` is forbidden.
- Each retained step result and final output are capped at 10 MiB; cumulative retained context is capped at 50 MiB.
- Plan and state directories reject wrong ownership, symbolic links and POSIX group/world permissions; plan files additionally reject hard links and paths traversing symbolic directories.
- Operation targets are confined to the reviewed workspace, checked for ownership/link attacks and revalidated before replacement.
- Workspace/config/source preimages and the complete post-workspace fingerprint are hash-bound into the reviewed plan.
- A retry after replacements but before receipt durability succeeds only when the complete current workspace equals the reviewed post-workspace fingerprint; otherwise apply fails closed.
- External editors, hostile writers, NFS semantics, stale-lock cleanup and power-loss durability remain outside the lock guarantee and are documented explicitly.

## Performance evidence

`npm run benchmark:batch` ran five fresh-process samples of the same two-tool broad-search-to-exact-source workflow:

- model round-trips: 2 -> 1, 50% reduction;
- serialized context: 11,514 -> 552 characters, 95.21% reduction;
- median local wall time: 536.19 ms -> 535.24 ms, 0.18% decrease;
- median maximum RSS: 377.54 MB -> 378.35 MB, 0.21% increase.

The latency/RSS differences are treated as noise. The supported claim is fewer client/model round-trips and less context, not faster TypeScript analysis.

## Portability

- Canonical gates ran on Linux with Node 24.16.0.
- The full suite and both transport smokes also passed on Node 20.19.0.
- CI is configured for Node 20.x and 22.x on Ubuntu.
- Windows-specific path comparisons and POSIX-only checks are guarded, but no native Windows runner was available locally.

## Residual risks

- Multi-file apply is conservative but not globally transactional; rollback cannot overwrite a file changed by another writer.
- Filesystem locks coordinate only cooperating MCP/CLI apply processes using the same state directory.
- Hard crashes can leave stale lock files that require operator inspection.
- Renames across files depend on platform filesystem semantics; network/distributed filesystems are not claimed safe.
- Git status and branch cleanliness could not be verified because this checkout contains no `.git` metadata.
