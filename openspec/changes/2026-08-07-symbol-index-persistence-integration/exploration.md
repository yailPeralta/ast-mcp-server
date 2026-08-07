# Exploration: productive symbol-index persistence integration

## Decision question

Can the existing derived symbol index gain a real SQLite lifecycle behind an explicit opt-in without making persisted data authoritative, without rebuilding unchanged files, and without weakening the immediate memory-only rollback?

This phase starts only after commit `7f41b23c6a7b2980b9eef3807436119bd7de3ebe`, which records the current disposable persistence evidence and the still-open gates. The current ADR 0009 remains a memory-only decision until this phase's production integration and failure gates pass.

## Current repository evidence

- `src/services/symbol-index.ts` has the async `SymbolIndexStore` seam and `InMemorySymbolIndex` implementation.
- `src/services/project.ts` owns one compiler session per canonical `tsconfig.json`, serializes operations, synchronizes source/config fingerprints, and currently extracts symbols from every source file before `refresh`.
- `src/services/project-status.ts` already has bounded freshness causes and disabled index/watcher component states, but the public projection intentionally forces the index to `disabled` and `indexed_count` to zero.
- `src/services/symbols.ts` provides the compiler-backed, body-free symbol projection and exact selector validation path.
- The active persistence evidence SDD and ADR 0009 prove disposable SQLite conformance/basic lifecycle behavior, but not production adapter lifecycle, fallback, status/metrics, migration rollback, mutation safety or the complete failure matrix.
- Node `22.5.0` exposes `node:sqlite` only with `--experimental-sqlite`; Node 24 exposes it without the flag. No SQLite dependency is currently in `package.json`.

## Problem and outcome

The expensive work on a warm session is derived symbol extraction, not compiler authority. A source/config snapshot already classifies changed and deleted files. The integration must avoid parsing unchanged files, reuse valid persisted metadata only after compiler synchronization, and make every storage failure observable while continuing with a bounded in-memory/compiler path.

Success is not "SQLite is faster". Success is: exact compiler reads remain correct, unchanged files are not extracted, persisted rows are body-free and isolated, failures converge to memory-only, and the operator can disable the feature without a code rollback.

## Options considered

| Option                                                         | Benefit                                                                                    | Cost/risk                                                                                                | Phase decision                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Keep memory-only and stop                                      | Lowest operational risk and already correct                                                | No restart reuse                                                                                         | Required baseline and rollback target                  |
| SQLite as active `SymbolIndexStore`, lazy-opened behind policy | Reuses current async seam, transactional row updates, bounded lifecycle, no new dependency | `node:sqlite` is experimental on the floor; requires capability check, migration and fallback            | Selected for implementation only, disabled by default  |
| Memory index plus SQLite sidecar                               | Keeps query path simple                                                                    | Duplicates lifecycle and makes consistency/observability harder; persistence is not truly the store seam | Rejected unless active-store integration proves unsafe |
| JSON durable runtime                                           | Portable                                                                                   | Lost updates and full rewrites already failed evidence                                                   | Rejected                                               |
| External database/daemon                                       | Shared state                                                                               | Operational complexity disproportionate to a derived local cache                                         | Rejected                                               |

## Scope boundary

In scope:

- Incremental refresh input that separates current file metadata from changed-file symbol extraction.
- Real `SQLiteSymbolIndexStore` lifecycle using dynamic `node:sqlite` capability detection.
- Versioned schema, row migration, corruption quarantine/rebuild, bounded busy timeout, close/reopen and flush semantics.
- Explicit disabled/canary/enabled policy, safe cache-root derivation and immediate fallback to `InMemorySymbolIndex`.
- Project status states and bounded index observability for hit, miss, rebuild, migration, corruption, write failure and fallback.
- Failure injection, integration tests, realistic benchmark output and rollback smoke.
- ADR 0009 update only after every required gate has a reproducible PASS.

Out of scope:

- Persisting source bodies, compiler objects, references, diagnostics or mutation plans.
- Changing compiler authority, exact selector validation or prepare/review/apply.
- A default enablement, implicit downloads, postinstall builds or a resident daemon.
- Portable/WASM SQLite dependency selection in this phase.
- Cross-project shared cache paths outside the explicit operator cache root.

## Non-negotiable invariants

1. Compiler synchronization and verified source/config fingerprints precede every load, refresh and persistence write.
2. Persisted rows are derived read evidence only; stale, malformed, mismatched or unavailable rows are ignored or quarantined.
3. Default mode is memory-only. A failed opt-in attempt must produce a useful in-memory/compiler result and a bounded degraded signal.
4. `createFreshProject` stays side-effect free; cached-session lifecycle owns optional storage handles and closes them on eviction/invalidation/cleanup.
5. The only production rollout before broad enablement is explicit operator opt-in/canary. The rollback is changing policy to memory-only and removing/quarantining derived files.
