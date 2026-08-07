# Design: disabled-first SQLite integration

## Boundary

The compiler/project session remains the semantic authority. The index is a derived read service and is never consulted by prepare/apply logic for eligibility. The existing per-tsconfig queue serializes compiler synchronization and index lifecycle operations.

```text
withProject queue
  -> compiler refresh + verified workspace snapshot
  -> policy resolution
  -> store open/load (optional)
  -> incremental refresh (changed symbol extraction only)
  -> store flush (optional)
  -> index/compiler read path

failure at any optional store step
  -> classify + status/metrics
  -> close/quarantine derived store
  -> InMemorySymbolIndex fallback
```

## Modules

- `src/services/symbol-index.ts`: backend-neutral validated contracts, refresh metadata/current-file projection, query parity and in-memory implementation.
- `src/services/symbol-index-sqlite.ts`: lazy native capability loading, safe cache-path derivation, schema/open/close, row migration, transactional refresh, validation, bounded busy timeout and typed failure classification. No public database handle.
- `src/services/symbol-index-policy.ts`: parse `disabled|canary|enabled`, require an explicit cache root for durable modes, derive an opaque project/config path and expose a safe policy/backend decision. Unknown or unsafe input returns memory-only.
- `src/services/symbol-index-observability.ts`: bounded counters and last-operation metadata used by the session/status projection; no logs containing raw paths or rows.
- `src/services/project.ts`: session-owned store lifecycle, compiler-before-store ordering, changed-only extraction, fallback swap and close on invalidate/eviction/cleanup.
- `src/services/project-status.ts` and `src/tools/get_project_status.ts`: preserve disabled index semantics for memory-only, allow ready/rebuilding/failed for explicit durable policy, and add the bounded index observability projection.
- `src/services/symbols.ts`: existing compiler projection; the synchronization path calls it only for the selected changed/rebuild set.

## Refresh contract

Replace the current all-symbol `files` input with two projections:

- `current_files`: `{ file_path, content_hash }` for every current compiler source file;
- `changed_files`: `{ file_path, content_hash, symbols }` only for files that must be rebuilt.

The store loads validated current entries for the exact project/schema. It computes:

- `rebuild = no prior entry || content hash mismatch || config digest mismatch || explicitly changed`;
- `reuse = current path with matching hash/config and valid symbols`;
- `remove = prior path absent from current_files`.

When the config digest changes or there is no valid entry set, the project layer supplies all current files in `changed_files`. Otherwise it supplies only fingerprint `added|changed` paths. The store never calls the compiler or extracts symbols; it only applies validated projections atomically.

## SQLite schema and lifecycle

Use a database per project/config identity under the explicit cache root, with a safe filename derived from opaque IDs. The schema contains:

- `metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
- `symbol_index(project_id, config_id, file_path, content_hash, config_digest, symbols_json, last_indexed_at, schema_version, PRIMARY KEY(project_id, config_id, file_path))`.

Open sequence:

1. resolve policy and cache path;
2. dynamically load `node:sqlite` and verify `DatabaseSync` capability;
3. reject invalid existing headers before opening;
4. open with `busy_timeout=1000`, WAL and the schema;
5. inspect metadata/row schema; migrate in `BEGIN IMMEDIATE` or quarantine/rebuild;
6. expose the store only after current-schema validation succeeds.

Writes use a transaction around changed upserts/deletions and commit through `flush`. Read/parse/validation failures are classified. Quarantine renames only files within the derived cache path and includes `-wal`/`-shm` cleanup; if quarantine fails, the process still falls back and never claims persistence success. Close is idempotent and called on invalidation, eviction and global cleanup.

## Session lifecycle and fallback

`createFreshProject` constructs an in-memory context with no filesystem side effects. Cached sessions start with memory and a disabled/uninitialized optional store. On synchronization:

1. complete the existing compiler refresh → snapshot → refresh → verification sequence;
2. resolve policy; if disabled, keep memory and record disabled;
3. for canary/enabled, open/load the SQLite store after verified fingerprints;
4. validate loaded rows against current content/config hashes; stale rows are ignored and counted;
5. refresh memory and SQLite from the changed-only projections;
6. if any SQLite operation fails, close it, transition `index_failed`, increment fallback, rebuild/continue with memory and preserve compiler freshness;
7. only a complete verified sync may transition the session back to a non-degraded state.

The fallback index remains queryable only after exact compiler selector validation already required by the existing read path. Persistence status is diagnostic and cannot alter mutation operations.

## Status and observability

Add a bounded `index_observability` object to the project status projection:

- `policy`: `disabled|canary|enabled`;
- `backend`: `memory|sqlite`;
- `last_operation`: `disabled|hit|miss|rebuild|migration|corruption|write_failure|fallback`;
- `loaded_entries`, `accepted_entries`, `rejected_entries`, `rebuilt_files`, `reused_files`, `removed_files`;
- `fallback_count`, `migration_count`, `corruption_count`, `write_failure_count`;
- `last_successful_persistence_at`.

All values are bounded finite integers, canonical timestamps or closed literals. Raw cache paths and exception text are excluded from the public object; existing degraded error redaction remains the only error detail path.

## Verification design

- Pure contract tests: refresh set calculation, validation, metadata-only reuse, config invalidation and deterministic results.
- SQLite unit/lifecycle tests: capability refusal, header corruption, migration, reopen, body exclusion, close, invalid root, bounded busy timeout and quarantine.
- Project integration tests: disabled no-file, changed-only extraction spy, load hit/miss, fallback on each injected operation, status transitions, session cleanup and exact read continuation.
- Mutation regression: persistence failures around prepare/apply leave operation outputs and plan hashes unchanged.
- Real benchmark: a temporary fixture with a repository-shaped source set, one source change, one config change, restart, corruption, failure injections and rollback; output goes to `/tmp` and is run under both declared runtimes.

No benchmark timing becomes an SLA. ADR 0009 is edited only after the final frozen tree's all-gates result is green.
