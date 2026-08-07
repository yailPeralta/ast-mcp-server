# Specification: productive symbol-index persistence integration

## Authority and policy

### IDX-INTEGRATION-101 Compiler authority

The active TypeScript compiler project plus the verified filesystem/config snapshot remain authoritative for declarations, selectors, references, relationships, diagnostics, freshness and mutation eligibility. A persistent index may rank or narrow read candidates only. It MUST NOT authorize, approve or weaken a mutation.

### IDX-INTEGRATION-102 Disabled default

`AST_SYMBOL_INDEX_PERSISTENCE=disabled` MUST be the default and MUST use `InMemorySymbolIndex` without creating or opening a cache file. `createFreshProject` MUST remain side-effect free. Unknown policy values, missing cache roots and unsupported runtimes MUST fail closed to memory-only.

### IDX-INTEGRATION-103 Opt-in/canary

`canary` MUST require an explicit cache root and use only the SQLite adapter for the process that opts in. The active policy/backend MUST be visible through bounded project status. Switching to `disabled` MUST immediately select memory-only on the next session operation and MUST not require source or mutation-data migration.

`enabled` is reserved until the conditional ADR gate is complete. Before that gate, parsing `enabled` MUST fail closed to `disabled`/memory-only with public bounded policy reason `enabled_not_released`; it MUST NOT open SQLite.

## Incremental refresh

### IDX-INTEGRATION-201 Changed-only extraction

After a verified source/config snapshot, symbol extraction MUST run only for added or changed files, plus every current file when the config digest changes or no valid index entry exists. Unchanged files MUST be represented by path/hash metadata only and their prior validated symbol records MUST be reused.

### IDX-INTEGRATION-202 Membership and deletion

A refresh MUST remove entries for deleted current source files, preserve valid unchanged entries, and report rebuilt/reused/removed paths in deterministic order. A missing or invalid prior entry is a rebuild miss, not a reuse.

### IDX-INTEGRATION-203 Compiler-before-persist

No load, refresh, migration adoption or write may be treated as fresh until compiler synchronization and the source/config verification snapshot complete successfully.

## SQLite adapter and lifecycle

### IDX-INTEGRATION-301 Store parity

`SQLiteSymbolIndexStore` MUST implement the backend-neutral `SymbolIndexStore` contract with deterministic ordering, ranking, positive output and scan limits, schema filtering, project/config isolation, validated body-free rows, upsert, remove, clear, refresh and flush. Queries MUST reject direct limits outside `1..10,000`, return at most 10,000 candidates, inspect at most 10,000 selected file entries and decode at most 50,000 symbols. Open/load/migration/query/write MUST reject any row payload above 4 MiB or aggregate projection payload above 64 MiB. Bounds MUST apply before prohibited work: collection length before map/copy, structural row-array count before `JSON.parse`, and exact projection byte accounting before complete serialization. Crossing an execution limit MUST abandon the index for compiler fallback instead of returning an incomplete ranking.

### IDX-INTEGRATION-302 Safe storage boundary

The adapter MUST use only an operator-selected cache root, derive project/config-specific filenames from opaque identities, reject traversal/absolute escapes and symlink/non-directory ancestors before creating missing path components, use a bounded busy timeout and never expose raw database handles, source bodies, compiler objects, credentials or mutation plans.

### IDX-INTEGRATION-303 Lifecycle and migration

Open MUST capability-check `node:sqlite` before cache-directory creation or target/header inspection, read only the bounded SQLite header required for validation, create schema v2 transactionally and run a versioned row migration. Table validation MUST verify ordered column names, declared types, `NOT NULL`, defaults and primary-key positions; same-name columns with incompatible constraints MUST be rejected. V2 MUST bind `symbols_json` to a SHA-256 digest for exact-byte integrity; that unkeyed digest MUST NOT be treated as proof of semantic completeness. Supported v0/v1 rows MUST be rebuilt into the constrained v2 table and receive that digest during migration. Migration MUST acquire `BEGIN IMMEDIATE` before reading metadata or source rows and retain the same transaction through validation, rebuild and commit, so no committed concurrent writer can be omitted. Mixed-schema rows MUST never be returned as current. Close and eviction MUST release handles.

### IDX-INTEGRATION-304 Corruption and interruption

Malformed, truncated, unreadable or checksum-invalid storage MUST be classified, quarantined/deleted only within the derived cache boundary, and rebuilt through memory/compiler fallback. Every indexed search MUST compare the complete ranked projection with canonical compiler search; an empty or partial persisted projection with a recomputed valid digest is `corrupt_storage`, triggers same-operation fallback/quarantine and returns canonical compiler results. An interrupted flush MUST leave the previous valid state or force rebuild; it MUST never be silently presented as fresh.

### IDX-INTEGRATION-305 Bounded contention

Reader/writer contention MUST have a finite wait and typed/classifiable failure. A timeout or transaction error MUST activate fallback and bounded degraded evidence rather than waiting indefinitely or returning stale success.

## Fallback, state and observability

### IDX-INTEGRATION-401 Fallback

Any optional persistence failure during open/load/migration/query/refresh/flush MUST install a usable in-memory/compiler context before best-effort close/quarantine cleanup, mark the index degraded/fallback, and prevent persistence data from being used as fresh authority. A write-path fallback MUST rebuild the complete memory projection from compiler symbols rather than replay a changed-only plan into an empty store. A rejected failure-report callback or throwing persistent-store close MUST NOT suppress already-computed canonical results. Recovery MUST be explicit and re-verified by a complete synchronization.

### IDX-INTEGRATION-402 Component state

Status MUST distinguish `disabled`, `ready`, `rebuilding` and `failed` for the index while retaining existing compiler/watcher freshness semantics. Memory-only remains a valid disabled state, not a failure.

### IDX-INTEGRATION-403 Bounded observability

Project status MUST expose bounded, JSON-safe index policy, closed policy reason, backend/last operation, loaded/accepted/rejected entries, rebuild/migration/corruption/write-failure/fallback counters and last successful persistence time. It MUST redact host paths/secrets and preserve existing truncation contracts.

### IDX-INTEGRATION-404 Freshness

A successful persistence load or write MUST NOT alone produce `fresh`. Freshness requires the existing complete source/config snapshot evidence and compiler synchronization. Counts, timestamps or cache hits alone are evidence-negative. If a query failure swaps the session to fallback, that same operation MUST compute its response and freshness from the effective fallback context.

## Mutation and rollout safety

### IDX-INTEGRATION-501 Mutation isolation

Persistence failure, stale rows, cache quarantine, policy changes and fallback MUST NOT change operation plan hashes, affected files, diagnostics policy, `blocked` status or apply eligibility.

### IDX-INTEGRATION-502 Failure injection and benchmark

The integration benchmark MUST exercise disabled mode, unsupported capability, invalid root, malformed header, migration failure, query/read failure, non-contention transaction-COMMIT write failure, flush failure, bounded contention, restart, rollback and a self-consistent forged omission whose projection digest is recomputed. The non-contention gate MUST prove rollback, preservation after reopen, same-operation memory/compiler fallback and write-failure observability. The command MUST exit non-zero if any gate is false. It MUST require quarantine plus canonical compiler results for the forged omission, run the same deterministic fixture on Node 22.5.0 and Node 24, report explicit runtime identity and label timings as local observations.

### IDX-INTEGRATION-503 ADR gate

ADR 0009 MAY change only when every required integration, fallback, observability, mutation-safety, runtime, package and benchmark gate is a reproducible PASS. Any missing or failed gate keeps memory-only and records the blocker.

## Scenarios

### Scenario: default remains memory-only

- Given no persistence policy or `disabled`
- When a project session synchronizes
- Then no SQLite handle or cache file is created
- And the project uses the in-memory/compiler path.

### Scenario: changed source reuses unchanged symbols

- Given a valid synchronized index for files A and B
- When only A changes
- Then symbols are extracted for A only, B is reused by hash, and deleted files are removed.

### Scenario: canary SQLite failure falls back

- Given `canary`, a valid cache root and an injected SQLite open/read/write failure
- When the next project operation runs
- Then the operation succeeds through memory/compiler fallback, status reports degraded/fallback and no failed row is labeled fresh.

### Scenario: corrupted cache recovers

- Given a truncated or malformed derived database
- When the canary session opens it
- Then the cache is quarantined or removed within the configured root, the compiler rebuilds memory state, and exact reads/mutations remain available.

### Scenario: rollback is immediate

- Given a canary process with a populated SQLite cache
- When policy changes to `disabled` and the session is invalidated/reopened
- Then no SQLite file is opened, memory-only status is reported, and source/mutation behavior is unchanged.
