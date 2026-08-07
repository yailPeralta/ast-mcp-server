# Specification: productive symbol-index persistence integration

## Authority and policy

### IDX-INTEGRATION-101 Compiler authority

The active TypeScript compiler project plus the verified filesystem/config snapshot remain authoritative for declarations, selectors, references, relationships, diagnostics, freshness and mutation eligibility. A persistent index may rank or narrow read candidates only. It MUST NOT authorize, approve or weaken a mutation.

### IDX-INTEGRATION-102 Disabled default

`AST_SYMBOL_INDEX_PERSISTENCE=disabled` MUST be the default and MUST use `InMemorySymbolIndex` without creating or opening a cache file. `createFreshProject` MUST remain side-effect free. Unknown policy values, missing cache roots and unsupported runtimes MUST fail closed to memory-only.

### IDX-INTEGRATION-103 Opt-in/canary

`canary` MUST require an explicit cache root and use only the SQLite adapter for the process that opts in. The active policy/backend MUST be visible through bounded project status. Switching to `disabled` MUST immediately select memory-only on the next session operation and MUST not require source or mutation-data migration.

## Incremental refresh

### IDX-INTEGRATION-201 Changed-only extraction

After a verified source/config snapshot, symbol extraction MUST run only for added or changed files, plus every current file when the config digest changes or no valid index entry exists. Unchanged files MUST be represented by path/hash metadata only and their prior validated symbol records MUST be reused.

### IDX-INTEGRATION-202 Membership and deletion

A refresh MUST remove entries for deleted current source files, preserve valid unchanged entries, and report rebuilt/reused/removed paths in deterministic order. A missing or invalid prior entry is a rebuild miss, not a reuse.

### IDX-INTEGRATION-203 Compiler-before-persist

No load, refresh, migration adoption or write may be treated as fresh until compiler synchronization and the source/config verification snapshot complete successfully.

## SQLite adapter and lifecycle

### IDX-INTEGRATION-301 Store parity

`SQLiteSymbolIndexStore` MUST implement the backend-neutral `SymbolIndexStore` contract with deterministic ordering, ranking, positive limits, schema filtering, project/config isolation, validated body-free rows, upsert, remove, clear, refresh and flush.

### IDX-INTEGRATION-302 Safe storage boundary

The adapter MUST use only an operator-selected cache root, derive project/config-specific filenames from opaque identities, reject traversal/absolute escapes, use a bounded busy timeout and never expose raw database handles, source bodies, compiler objects, credentials or mutation plans.

### IDX-INTEGRATION-303 Lifecycle and migration

Open MUST capability-check `node:sqlite`, validate the database header, create the schema transactionally and run a versioned row migration. Migration MUST be atomic or quarantine/rebuild; mixed-schema rows MUST never be returned as current. Close and eviction MUST release handles.

### IDX-INTEGRATION-304 Corruption and interruption

Malformed, truncated, unreadable or checksum-invalid storage MUST be classified, quarantined/deleted only within the derived cache boundary, and rebuilt through memory/compiler fallback. An interrupted flush MUST leave the previous valid state or force rebuild; it MUST never be silently presented as fresh.

### IDX-INTEGRATION-305 Bounded contention

Reader/writer contention MUST have a finite wait and typed/classifiable failure. A timeout or transaction error MUST activate fallback and bounded degraded evidence rather than waiting indefinitely or returning stale success.

## Fallback, state and observability

### IDX-INTEGRATION-401 Fallback

Any optional persistence failure during open/load/migration/query/refresh/flush MUST preserve a usable in-memory/compiler path, mark the index degraded/fallback, and prevent persistence data from being used as fresh authority. Recovery MUST be explicit and re-verified by a complete synchronization.

### IDX-INTEGRATION-402 Component state

Status MUST distinguish `disabled`, `ready`, `rebuilding` and `failed` for the index while retaining existing compiler/watcher freshness semantics. Memory-only remains a valid disabled state, not a failure.

### IDX-INTEGRATION-403 Bounded observability

Project status MUST expose bounded, JSON-safe index policy/backend/last operation, loaded/accepted/rejected entries, rebuild/migration/corruption/write-failure/fallback counters and last successful persistence time. It MUST redact host paths/secrets and preserve existing truncation contracts.

### IDX-INTEGRATION-404 Freshness

A successful persistence load or write MUST NOT alone produce `fresh`. Freshness requires the existing complete source/config snapshot evidence and compiler synchronization. Counts, timestamps or cache hits alone are evidence-negative.

## Mutation and rollout safety

### IDX-INTEGRATION-501 Mutation isolation

Persistence failure, stale rows, cache quarantine, policy changes and fallback MUST NOT change operation plan hashes, affected files, diagnostics policy, `blocked` status or apply eligibility.

### IDX-INTEGRATION-502 Failure injection and benchmark

The integration benchmark MUST exercise disabled mode, unsupported capability, invalid root, malformed header, migration failure, query/read failure, write/flush failure, bounded contention, restart and rollback. It MUST run the same deterministic fixture on Node 22.5.0 and Node 24, report explicit runtime identity and label timings as local observations.

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
