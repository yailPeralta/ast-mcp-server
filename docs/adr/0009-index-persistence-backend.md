# ADR 0009: Select native SQLite for explicit symbol-index canary

- Status: Accepted historically; default-policy clause superseded by ADR 0011
- Date: 2026-08-07
- Decision type: evidence gate
- Scope: symbol-index persistence candidates

## Decision

> Historical decision point: ADR 0011 preserves the three-state policy and compiler-authority boundary but supersedes the memory-default and reserved-`enabled` clauses below for the current `Unreleased` line.

Select native `node:sqlite` as an explicit canary backend for the derived symbol index. The default remains `AST_SYMBOL_INDEX_PERSISTENCE=disabled`, which uses `InMemorySymbolIndex` and does not open or create a SQLite cache. Canary requires both:

- `AST_SYMBOL_INDEX_PERSISTENCE=canary`;
- `AST_SYMBOL_INDEX_CACHE_ROOT=<absolute-normalized-cache-root>`.

The reserved value `enabled` remains unreleased and fails closed to memory with public reason `enabled_not_released`. This ADR authorizes opt-in evaluation only; it does not enable canary globally or change the production default.

The compiler/project remains the sole semantic authority. SQLite is a body-free, replaceable read projection. Exact reads, references, relationships, diagnostics, operation preparation and apply checks remain compiler/workspace-derived.

## Evidence considered

The integration SDD under `openspec/archive/2026-08-07-symbol-index-persistence-integration/` closes the missing production evidence from the earlier disposable-candidate study:

- focused authority/lifecycle/consumer suite: 73 tests;
- SQLite plus common-store conformance: 33 tests;
- full repository suite: 271 tests across 32 files;
- format, lint, typecheck, build, MCP 15-tool smoke, CLI, package, audit and 57-file pack checks;
- Node `v24.16.0` and Node `v22.5.0` with `NODE_OPTIONS=--experimental-sqlite`: 15/15 integration gates on each runtime;
- schema-v2 constraints and byte digest, atomic v0/v1 migration, corruption quarantine, sidecar cleanup, bounded paging/payloads, contention, non-contention COMMIT rollback, compiler fallback, status observability and mutation isolation;
- definitive read-only review `PASS` for candidate digest `c3d2d8ed11200562066eeb295e0426fa8e221d0ada5a2577771ee627fd7fd9d1`.

The digest on persisted rows proves byte integrity only. Every indexed query still compares the complete ranked projection against canonical compiler search; omissions or forged metadata trigger canonical fallback and quarantine.

## Consequences

- No new package dependency is introduced; the canary uses runtime-provided `node:sqlite`.
- Memory remains the default backend and immediate rollback path.
- A canary cache is per project/config identity, derived under the operator-selected root, and may be deleted or quarantined without semantic data loss.
- Any capability, path, open, migration, integrity, read, query, write or flush failure abandons SQLite and continues from compiler/memory with bounded degraded evidence.
- Node `22.5.0` still exposes SQLite as experimental and requires `NODE_OPTIONS=--experimental-sqlite`; absence of capability fails closed.
- Portable/WASM SQLite and a globally enabled native backend remain deferred.

## Rollback

Set `AST_SYMBOL_INDEX_PERSISTENCE=disabled` or remove the variable, then invalidate/reopen the project session or restart the process. The reopened session uses memory only and does not open existing SQLite files. Cache files may remain on disk for later inspection; they are not semantic authority.

Under ADR 0011, only explicit `disabled` is rollback; removing the variable now selects default `enabled`.

## Promotion criteria

Promoting reserved `enabled` requires a separate decision with operational canary evidence. It must preserve compiler authority, disabled/memory rollback, bounded failure behavior and the complete conformance/runtime/package matrix. Benchmark speed alone is not a promotion criterion.
