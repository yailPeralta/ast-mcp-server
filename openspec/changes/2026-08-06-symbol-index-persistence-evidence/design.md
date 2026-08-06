# Design: evidence-first persistence evaluation

## Design stance

Keep `InMemorySymbolIndex` as the production implementation while this SDD runs. Treat every durable backend as an adapter behind `SymbolIndexStore`; do not let adapter-specific rows, SDK objects or file formats leak into project/session APIs.

The design is two-stage:

1. prove a candidate store against a backend-neutral conformance and failure matrix;
2. only after that evidence, select and integrate one backend behind an explicit disabled-by-default policy.

## Evidence harness

Extend the existing disposable `scripts/benchmark-index-storage.mjs` or add a focused companion script without changing production defaults.

The harness must:

- accept explicit runtime executables for the Node 22.5.0 floor and Node 24 rather than guessing or downloading them;
- report unavailable runtimes as structured `not_available` evidence;
- execute identical contract tests against memory and each candidate adapter;
- use both the existing 128-file synthetic workload and a repository-sized sample with body-free entries;
- test clean restart, malformed/truncated storage, schema mismatch, interrupted flush, concurrent readers/writers and two project identities;
- write only temporary files under `/tmp` unless an explicit report path is supplied;
- redact absolute paths and never include environment/config secrets in reports.

## Adapter contract

The existing `SymbolIndexStore` interface remains the public boundary. A candidate adapter must be constructed with an explicit project/cache policy and expose no raw database handle.

Required invariants:

- all writes receive a validated `SymbolIndexFileEntry`;
- all reads validate schema and project/config identity before returning;
- query order and limit match `InMemorySymbolIndex`;
- `flush` has a defined durability/atomicity result;
- close/reopen behavior is deterministic;
- errors are typed or classified sufficiently for status projection;
- the adapter never supplies source text or compiler objects.

## Candidate evaluation tracks

### Track A: native runtime capability

Probe the Node built-in SQLite API on Node 22.5.0 and Node 24. If it is unavailable or unsuitable on any supported runtime, it cannot be the sole production backend without a documented capability check and fallback policy.

### Track B: portable dependency

Only if needed, evaluate a pinned portable SQLite/WASM dependency in an isolated branch/package smoke. Measure package contents, startup and API behavior. Do not install a candidate in the production manifest during the exploration phase.

### Track C: JSON reference

Retain JSON only as a reference adapter unless it proves atomic replacement, interrupted-write recovery and multi-process semantics at repository-sized workloads. Passing single-process restart/migration/corruption tests is not sufficient.

## Runtime integration if a candidate passes

Introduce an explicit policy concept, for example:

- `disabled` / memory-only (default);
- `enabled` for an operator-selected cache root;
- `fail_closed` / degraded after adapter failure.

The policy must be resolved from a safe non-secret configuration boundary and reported in bounded project status. No persisted cache path may be accepted outside the canonical operator-selected cache root or project identity boundary.

Project synchronization remains ordered:

1. canonicalize project/config;
2. synchronize the compiler and compute source/config fingerprints;
3. load candidate entries only for the exact identity/schema;
4. validate/reject stale entries;
5. perform bounded compiler/index refresh;
6. persist only validated derived entries;
7. expose hit/miss/rebuild/fallback state.

Mutation operations continue to resolve fresh compiler/workspace state and plan hashes independently. A persistence exception must never downgrade a blocked plan or create a write path.

## Storage model

The current entry shape is the minimum persisted record:

- schema version;
- project/config identity;
- project-relative file path;
- source content hash;
- config digest;
- body-free symbol records and ranges;
- canonical `last_indexed_at`.

A durable backend may add metadata for format version, integrity/checksum and migration state. It must not add source bodies, compiler snapshots, operation plans or credentials.

## Failure and recovery policy

- Unsupported backend: remain memory-only and report disabled.
- Read/open failure: classify degraded, quarantine only derived cache if safe, rebuild from compiler.
- Schema mismatch: migrate atomically or quarantine and rebuild; never mix versions.
- Flush interruption: use temp-plus-atomic-replace or backend transaction semantics; startup validates before adoption.
- Lock/transaction timeout: bounded error and compiler fallback; no unbounded wait.
- Corruption: preserve evidence, quarantine with bounded retention, rebuild, expose recovery cause.
- Cache path escape or project mismatch: reject closed.

## Observability

Expose bounded fields for:

- policy and backend name;
- cache hit/miss;
- entries loaded/accepted/rejected;
- stale/schema/corruption counts;
- rebuild and migration state;
- flush failure and contention cause;
- fallback count and last successful persistence time.

These are diagnostic facts, not authority. Do not expose raw database paths, host details or secrets.

## Verification plan

Planning phase: artifact existence, format and diff checks only.

Evidence phase: runtime matrix, adapter conformance, failure-injection, package smoke, benchmark and full quality gates.

Integration phase, only if authorized by the evidence ADR: focused store/project tests, mutation regression tests, MCP/CLI/package smoke, audit, full CI matrix and rollback smoke.

## Rollback and evolution

Persistence is removable by policy. If a backend is later selected, keep the adapter versioned and preserve the memory implementation as the fallback. A future schema migration must be additive or rebuildable, with old-cache quarantine rather than in-place mutation when safety is uncertain.
