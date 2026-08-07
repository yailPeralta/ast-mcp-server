# Verification: symbol-index persistence evidence

Status: evidence phase complete for the current decision; production persistence remains disabled.

## Scope

This verification records the evidence collected without changing the production backend. `InMemorySymbolIndex` remains the only production implementation and the compiler remains authoritative for exact reads, freshness, references, diagnostics and mutation eligibility.

The durable adapters exercised by the benchmark are disposable evidence adapters only. They are not package dependencies and are not selected for production.

## Runtime and package evidence

| Requirement     | Evidence                                                                                                                  | Result                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| IDX-RUNTIME-001 | Full quality gates executed with Node `v22.5.0` and Node `v24.16.0`; both runs passed 30 test files and 218 tests         | PASS                                     |
| IDX-RUNTIME-001 | `node:sqlite` probe under Node `v22.5.0` with `NODE_OPTIONS=--experimental-sqlite`                                        | PASS; the flag is required on this floor |
| IDX-RUNTIME-002 | `yarn test:package`, isolated tarball install, lifecycle disabled, handshake `0.6.0`, engine `>=22.5.0`, idempotent setup | PASS                                     |
| IDX-RUNTIME-003 | No persistence dependency was added; portable WASM candidates were not installed                                          | DEFERRED                                 |

The benchmark never downloads or implicitly installs a runtime or dependency. Missing candidate runtimes are reported as `not_available`.

## Store conformance evidence

Commands:

```text
INDEX_STORAGE_NODE22_5_BIN=/home/yail/.nvm/versions/node/v22.5.0/bin/node \
INDEX_STORAGE_NODE24_BIN=/home/yail/.nvm/versions/node/v24.16.0/bin/node \
NODE_OPTIONS=--experimental-sqlite \
node scripts/benchmark-index-storage.mjs --skip-package-smoke \
  --output /tmp/ast-index-storage-node22.5-isolated.json
```

The same benchmark also passed on Node `v24.16.0` without `NODE_OPTIONS`, with report `/tmp/ast-index-storage-node24-isolated.json`. The runtime identity probes in both reports explicitly executed the configured Node 22.5.0 and Node 24 binaries and returned `status=pass`.

Runtime identity in the report:

```text
node v22.5.0
executable /home/yail/.nvm/versions/node/v22.5.0/bin/node
native_sqlite true
```

The memory, file-JSON and native-SQLite evidence adapters all reported `conformance.status=pass` for:

- load and deterministic path ordering;
- project/config isolation;
- schema filtering;
- query filtering, ranking semantics and positive limits;
- upsert, remove, clear and flush;
- body-free records.

The TypeScript contract suite is `test/symbol-index-store-conformance.test.ts` and currently runs five tests against `InMemorySymbolIndex`. The benchmark applies the same basic contract matrix to the disposable JSON and native-SQLite adapters.

## Lifecycle evidence

The benchmark report recorded the following for both durable evidence adapters:

- clean restart: `pass`;
- schema migration: `pass`;
- interrupted flush simulation: `pass`; the killed child left the previous valid snapshot usable;
- concurrent writers: native SQLite `pass` with 2/2 entries retained and bounded `busy_timeout=1000`; JSON `fail` with 1/2 entries retained;
- two readers plus one writer: native SQLite `pass`; this is the basic reader/writer probe, not the complete cross-project contention matrix;
- malformed JSON / invalid SQLite header recovery: `recovered=true`;
- source body exclusion: `false`.

The benchmark now validates SQLite header/sidecar cleanup, verifies the exact rebuilt entry count, and measures the main database plus WAL/SHM bytes. Durable evidence assertions fail the benchmark process if restart, migration, corruption recovery, body exclusion or the native reader/writer probe fails.

## Not yet proven

These gates remain intentionally open and prevent selecting a production backend:

- the complete cross-project multi-process reader/writer matrix, including typed contention failure and fallback behavior;
- typed failure classification and compiler fallback in the production project/session lifecycle;
- bounded status/metrics for disabled, hit, miss, stale, migration, corruption, write failure and fallback states;
- operator disable/quarantine/rebuild rollback smoke;
- isolated candidate package/dependency evidence for a portable backend;
- mutation regression tests proving persistence errors cannot authorize or weaken a mutation.

The current migration scenario is also synthetic: it changes the stored schema marker and reloads the records, but does not yet exercise a real row-by-row schema migration or rollback.

The current benchmark is therefore evidence for the adapter boundary and basic lifecycle behavior, not an authorization to enable persistence.

## Decision

See `docs/adr/0009-index-persistence-backend.md`. The decision is to reaffirm memory-only for the current release and defer backend selection until the remaining failure, concurrency, fallback and observability gates have real evidence.

## Residual risks

- Native SQLite is experimental on the declared Node `22.5.0` floor and requires the explicit runtime flag.
- The JSON adapter is a reference candidate only; atomic replacement alone does not prove crash or multi-process safety.
- Benchmark timings are local observations and are not SLAs.
- No durable cache is enabled, so no production migration or cache rollback is required for this change.
