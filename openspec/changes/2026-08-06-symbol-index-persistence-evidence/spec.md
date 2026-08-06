# Specification: durable symbol-index evidence

## Contract principles

### IDX-PERSIST-001 Compiler authority

The active compiler project and exact filesystem snapshots remain authoritative for declarations, selectors, references, relationships, impact, diagnostics, freshness and mutation eligibility. A persisted index MAY rank or narrow candidates only. It MUST never authorize, approve or weaken a mutation.

### IDX-PERSIST-002 Derived-data boundary

Persisted records MUST contain only validated derived symbol metadata and provenance needed to reject stale records. They MUST NOT contain source bodies, compiler objects, credentials, provider payloads or mutation plans.

### IDX-PERSIST-003 Explicit policy

Persistence MUST be behind a versioned policy and the existing `SymbolIndexStore` boundary. The default policy remains memory-only until every acceptance gate in this specification passes. Disabled, unavailable and degraded modes MUST be observable.

## Runtime and packaging

### IDX-RUNTIME-001 Supported matrix

A candidate backend MUST run the same conformance suite on Node 20.19+, Node 22 and the current supported development runtime. Missing local binaries MUST be reported as unavailable, never silently substituted by a different runtime.

### IDX-RUNTIME-002 Package safety

The packed package MUST install in an isolated consumer project with Yarn lifecycle scripts disabled. The candidate MUST not require an implicit download, postinstall build, network service or undocumented native artifact.

### IDX-RUNTIME-003 Dependency boundary

Any new dependency MUST be justified by measured correctness/portability evidence, pinned through the existing Yarn policy and documented with package size, startup, licensing, build and rollback implications.

## Store contract and integrity

### IDX-STORE-001 Conformance parity

Every candidate store MUST pass the same contract suite for load, upsert, remove, query, clear and flush, including deterministic ordering, query limits, schema filtering, project/config isolation and the existing ranking semantics.

### IDX-STORE-002 Identity isolation

Records MUST be keyed by canonical project identity, config identity and project-relative file path. A query or load for one project/config MUST never return another project's records.

### IDX-STORE-003 Fingerprint validation

Every persisted file entry MUST retain schema version, content hash, config digest, canonical path, symbol metadata and canonical indexing timestamp. A record with a mismatched schema, source/config fingerprint or invalid shape MUST be ignored or quarantined, never presented as fresh.

### IDX-STORE-004 Body exclusion

The serialized store MUST prove that source bodies, implementation text and compiler-owned objects are absent from persisted records and recovery payloads.

## Lifecycle and failure behavior

### IDX-LIFECYCLE-001 Restart

After a clean process restart, a valid store MUST reload the expected derived entries without changing compiler resolution or freshness authority. A restart failure MUST fall back to bounded compiler rebuild.

### IDX-LIFECYCLE-002 Migration

A schema mismatch MUST trigger a versioned, bounded migration or a safe quarantine/rebuild. Partial migration MUST not expose mixed-schema entries.

### IDX-LIFECYCLE-003 Corruption

Malformed, truncated, unreadable or checksum-invalid storage MUST transition the index to disabled/degraded or rebuilding, quarantine/delete only the derived cache as appropriate, and preserve exact compiler reads and mutation checks.

### IDX-LIFECYCLE-004 Interrupted writes

A process interruption during flush MUST leave either the previous valid snapshot or a recoverable replacement. It MUST NOT leave a state that is silently treated as fresh.

### IDX-LIFECYCLE-005 Concurrency

Concurrent readers and writers for the same project MUST have a defined outcome, bounded waiting behavior and no lost valid entries. Cross-project operations MUST remain isolated. Locking/transaction failures MUST activate fallback rather than bypassing compiler validation.

## Integration and observability

### IDX-INTEGRATION-001 Compiler-before-persist

The index MUST be refreshed only after compiler synchronization and exact source/config fingerprint validation. Persisting an index MUST be a derived side effect, not a prerequisite for exact reads or mutation plan verification.

### IDX-INTEGRATION-002 Fallback

When persistence is disabled, unavailable, stale, corrupt, over budget or failed, reads MUST use the current bounded compiler path or report stale/degraded state. No caller may receive persisted data labeled fresh solely because it loaded successfully.

### IDX-INTEGRATION-003 Status

Project status and bounded metrics MUST distinguish memory-only, persistent-hit, persistent-miss, rebuild, migration, corruption, write failure, fallback and disabled states without exposing credentials or unnecessary host paths.

### IDX-INTEGRATION-004 Rollback

An operator MUST be able to disable persistence without code rollback, remove/quarantine derived cache files, and return to memory-only operation. The rollback path MUST be covered by a smoke test.

## Evidence gate

### IDX-EVIDENCE-001 Acceptance report

The candidate report MUST include runtime identity, package/install result, workload shape, semantic parity, restart, migration, corruption, interruption, concurrency, project isolation, source-body exclusion, fallback and observability results. Timings MUST be labeled local observations and MUST NOT be treated as SLAs.

### IDX-EVIDENCE-002 Selection decision

The maintainers MUST either record an ADR selecting one backend with the complete evidence, or record an ADR reaffirming memory-only because no candidate passed. No production default may change from this SDD alone.

## Scenarios

### Scenario: unsupported runtime fails closed

- Given the runtime does not expose the candidate backend
- When the project session starts or the cache is requested
- Then the index reports disabled/degraded and exact compiler reads continue
- And no package download or native build is attempted implicitly.

### Scenario: stale persisted file is rejected

- Given a persisted entry has a different source or config fingerprint
- When the project synchronizes
- Then the entry is ignored/rebuilt and never presented as fresh
- And mutation verification still uses current compiler/workspace state.

### Scenario: corrupted storage recovers

- Given the store is truncated or malformed during startup
- When the session loads the index
- Then the cache is quarantined or removed within bounds
- And compiler fallback rebuilds derived metadata without blocking exact reads.

### Scenario: interrupted flush preserves safety

- Given a process stops during a persistence flush
- When the next process starts
- Then it loads the previous valid snapshot or rebuilds from the compiler
- And it never treats a partial snapshot as current.

### Scenario: concurrent project sessions remain isolated

- Given two sessions read/write the same project and another session uses a different project
- When flush and query operations overlap
- Then the defined lock/transaction policy prevents cross-project data and lost committed entries
- And contention/failure is visible and bounded.

### Scenario: disable persistence

- Given an operator disables the persistence policy
- When the next project operation runs
- Then the session uses memory-only/compiler rebuild behavior
- And any existing derived cache can be quarantined without affecting source or mutation data.
