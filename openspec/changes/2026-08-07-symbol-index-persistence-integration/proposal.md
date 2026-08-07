# Proposal: integrate SQLite persistence behind a disabled policy

## Intent

Turn the disposable SQLite evidence into a production-shaped adapter and lifecycle while preserving `InMemorySymbolIndex` as the safe default. The implementation must be useful for a controlled canary, but the phase must not silently select or enable persistence.

## Observable outcome

For a synchronized project session:

- the first build extracts symbols for every current file because no valid derived entry exists;
- a source-only change extracts symbols only for added/changed files and removes deleted rows;
- a config change invalidates all symbol rows and rebuilds them;
- a valid SQLite cache may provide body-free candidates after validation;
- any capability, open, migration, corruption, lock, read or write failure switches the session to memory/compiler fallback and records the cause;
- exact reads, diagnostics, references, relationships and mutation plan checks continue to use the active compiler/project state.

## Policy and rollout

Introduce a non-secret environment policy with safe defaults:

- `AST_SYMBOL_INDEX_PERSISTENCE=disabled` (default): use memory only and create no cache files.
- `AST_SYMBOL_INDEX_PERSISTENCE=canary`: use SQLite only in an explicitly configured canary process and only when `AST_SYMBOL_INDEX_CACHE_ROOT` is present.
- `AST_SYMBOL_INDEX_PERSISTENCE=enabled`: reserved for a later gate; it is not the default of this phase.

The cache root is operator-selected, canonicalized and used only to derive project/config-scoped filenames from opaque identities. No source or host path is used as a public identifier. Changing the policy to `disabled` is the immediate rollback and must not require code rollback or source-data repair.

`canary` is a process/deployment opt-in, not an automatic percentage rollout. The operator controls which process receives it; the status projection exposes the active policy and backend so the cohort is auditable.

## Goals

- Make incremental extraction a tested contract rather than an incidental optimization.
- Implement one real SQLite adapter against the existing store boundary, with no new production dependency.
- Make lifecycle failures bounded, classified and recoverable.
- Preserve compiler authority and mutation safety under every failure path.
- Produce evidence strong enough to decide whether ADR 0009 can change.

## Non-goals

- No persistence by default.
- No source-body or compiler snapshot persistence.
- No new MCP mutation/read authority.
- No automatic runtime or dependency installation.
- No ADR 0009 selection before all gates pass.

## Acceptance gates

1. Focused RED/GREEN tests prove changed-only extraction, config invalidation and deletion.
2. SQLite store conformance matches the in-memory semantics, including project/config isolation and body exclusion.
3. Lifecycle tests prove close/reopen, row migration, malformed/truncated storage, interrupted writes, bounded contention and quarantine/rebuild.
4. Integration tests prove disabled mode creates no cache, canary mode loads/writes only after compiler synchronization, and every injected failure falls back to memory.
5. Status/MCP output exposes bounded policy/backend/state/metrics without host paths or secrets.
6. Mutation tests prove persistence failure cannot alter plan blocking, hashes, diagnostics or apply behavior.
7. The real failure-injection benchmark passes on Node 22.5.0 with the required SQLite flag and Node 24, with explicit runtime identities and no tracked timing noise.
8. Full format, lint, typecheck, test, build, MCP/CLI/package, audit and pack gates pass on the frozen tree.
9. Only if all gates pass: update ADR 0009 to select SQLite for canary/opt-in and record the exact rollback. Otherwise leave ADR 0009 unchanged and document the blocker.
