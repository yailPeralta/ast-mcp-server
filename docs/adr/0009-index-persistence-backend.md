# ADR 0009: Reaffirm memory-only symbol-index storage

- Status: accepted
- Date: 2026-08-06
- Decision type: evidence gate
- Scope: symbol-index persistence candidates

## Decision

Keep `InMemorySymbolIndex` as the only production symbol-index backend for the current release. Do not add a native SQLite, portable/WASM SQLite or JSON persistence dependency, and do not change the default policy from memory-only.

The persistence SDD produced useful adapter-boundary and basic lifecycle evidence, but no candidate has passed every acceptance gate required by `openspec/changes/2026-08-06-symbol-index-persistence-evidence/spec.md`.

## Evidence considered

The disposable benchmark adapters were exercised under Node `v22.5.0` with `NODE_OPTIONS=--experimental-sqlite` and Node `v24.16.0`. The benchmark explicitly probed both runtime binaries:

| Candidate            | Basic conformance                      | Restart     | Migration   | Malformed/corrupt recovery | Decision           |
| -------------------- | -------------------------------------- | ----------- | ----------- | -------------------------- | ------------------ |
| Memory               | pass; durable lifecycle not applicable | N/A         | N/A         | N/A                        | production backend |
| File JSON            | pass                                   | pass        | pass        | pass                       | reference only     |
| Native SQLite        | pass                                   | pass        | pass        | pass                       | not selected       |
| Portable/WASM SQLite | unavailable; no dependency installed   | unavailable | unavailable | unavailable                | deferred           |

The conformance evidence covers identity isolation, schema filtering, deterministic query semantics, limits, body exclusion, upsert, remove, clear and flush. The benchmark also performs restart, interrupted flush, malformed-storage recovery, real row migration with close/reopen verification, concurrent writers, cross-project writer isolation, and a basic two-readers-plus-writer SQLite probe.

## Why no durable backend is selected

The JSON candidate also failed the concurrent-writer check: only 1 of 2 committed entries remained. Native SQLite retained both entries with a bounded `busy_timeout=1000`, but that is still only the writer subset of the full production acceptance matrix.

The following required evidence is still missing:

1. The complete cross-project multi-process reader/writer matrix, including typed contention failure and fallback behavior beyond the passing writer-isolation probe.
2. Multi-version migration rollback evidence; forward row migration is now proven only in the disposable adapters.
3. Production lifecycle integration proving typed failure classification and compiler fallback.
4. Bounded status/metrics for disabled, hit, miss, stale, migration, corruption, write failure and fallback states.
5. Disable/quarantine/rebuild rollback smoke and mutation-safety regression tests.
6. Complete package/dependency evidence for any portable candidate.

Native SQLite is also experimental on the Node `22.5.0` floor and requires an explicit runtime flag. That is acceptable for exploration, not sufficient for a production default.

## Consequences

- No production cache files, migrations, native artifacts or new dependencies are introduced.
- Exact compiler reads and mutation checks remain independent of derived-index storage.
- The existing `SymbolIndexStore` interface remains the seam for a future adapter.
- Future work must reopen the decision with a new evidence report or an update to the persistence SDD; benchmark performance alone is not sufficient.

## Reconsideration criteria

A future ADR may select a backend only when the full runtime/package matrix and every conformance, lifecycle, concurrency, fallback, observability, rollback and mutation-safety gate has a reproducible PASS or an explicitly justified not-applicable result.
