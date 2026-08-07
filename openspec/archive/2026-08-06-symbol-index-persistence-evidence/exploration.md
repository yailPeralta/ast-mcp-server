# Exploration: symbol-index persistence evidence

## Decision question

Can the symbol index become durable across restart without weakening compiler authority, freshness guarantees, mutation safety, package portability or fail-closed recovery on every supported Node runtime?

The answer is not accepted yet. This change is an evidence SDD; it does not add a production persistence dependency by itself.

## Repository evidence

- `package.json` declares Node `>=22.5.0`, Yarn 4.15.0, no SQLite or WASM persistence dependency, and an in-memory runtime today.
- `.github/workflows/ci.yml` tests the declared floor Node `22.5.0` and the current Node `24` line.
- `src/services/symbol-index.ts` already exposes an async `SymbolIndexStore` boundary with `load`, `upsert`, `remove`, `querySymbols`, `clear` and `flush`.
- The current implementation is `InMemorySymbolIndex`; it stores only derived symbol metadata, project/config identity, source/config hashes, schema version and canonical indexing time. Source bodies are not part of an entry.
- `src/services/project.ts` treats the index as disabled in the current runtime and keeps exact compiler reads and mutation validation independent of it.
- `test/symbol-index.test.ts` covers validation, project-relative paths, digest/timestamp metadata, body exclusion, ranking, affected-file rebuilds, deletion and the async store boundary.
- `docs/adr/0005-index-storage-backend.md` explicitly defers persistence until supported-runtime, packaging, restart, migration, corruption/rebuild and concurrency evidence exists.
- `scripts/benchmark-index-storage.mjs` is a disposable comparison harness. It exercises memory, JSON file and native SQLite where available, probes optional portable WASM packages without installing them, and runs the isolated package smoke.

## Fresh observed benchmark

Command:

```text
yarn benchmark:index-storage --output /tmp/ast-index-storage-sdd.json
```

Observed on Node `v24.16.0`:

- native `node:sqlite`: available;
- portable WASM SQLite: unavailable;
- initial benchmark runtime targets: Node 20.19+ and Node 22+ were not configured;
- isolated tarball/package smoke: pass, lifecycle scripts disabled, package/handshake `0.6.0`, two agent targets and idempotency pass;
- workload: 128 files × 8 body-free symbols, 30 queries;
- memory: expected non-durable behavior;
- JSON file: restart, schema migration and corruption rebuild passed in the synthetic fixture;
- native SQLite: restart, schema migration and corruption rebuild passed in the synthetic fixture;
- no source bodies were persisted by either durable candidate in this harness.

The timings are local observations on synthetic records. They are not capacity, latency-SLA or backend-selection evidence by themselves.

A direct local runtime probe on 2026-08-06 found only `<local-node-24-bin>`; explicit Docker probes then ran the package checkout on Node `20.19.6` and Node `22.23.2` without modifying the working tree. Both runtimes passed the project gates; Node 20 was retained as historical compatibility evidence but is no longer supported after the runtime-floor decision. Node 22 exposes experimental `node:sqlite`; native SQLite and JSON passed the same synthetic lifecycle fixture. Node 24 had already passed the equivalent gate and native SQLite probe. The supported-runtime gate for the new package range is satisfied by the Node 22.5+ capability evidence and Node 24 quality gate, but native SQLite still requires conformance and failure-injection evidence before production selection.

## Forces and constraints

1. Compiler/project snapshots remain authoritative for selectors, relationships, impact and every mutation decision.
2. A persisted index may rank candidates only; it must never authorize a mutation or make stale source current.
3. The supported package runtime starts at Node 22.5.0 and includes the current Node 24 line.
4. Persistence must be isolated per canonical project/config identity and safe across process restart.
5. Corruption, schema mismatch, unsupported runtime APIs and failed writes must degrade to bounded compiler fallback, not block exact reads or weaken mutation checks.
6. The dependency and package surface must remain reviewable with Yarn lifecycle scripts disabled.
7. The single developer maintainer needs a rollback path that does not require data repair to restore compiler-only operation.

## Unknowns that block selection

- Whether a native SQLite API is present and sufficiently stable on every supported runtime.
- Whether a portable WASM package can be added without unacceptable package size, startup cost, worker/runtime assumptions or lifecycle risk.
- Whether the chosen backend provides the required atomic replace, reader/writer isolation and crash recovery semantics under concurrent project sessions.
- Whether schema migration and corruption rebuild remain bounded with realistic repository-sized indexes, not only the 128-file synthetic fixture.
- Whether a durable cache improves restart time enough to justify operational complexity over rebuilding from the compiler.

## Scope boundary

In scope:

- runtime/package compatibility probes;
- a backend-neutral conformance suite;
- restart, migration, corruption, atomicity and concurrency evidence;
- explicit enablement, fallback and observability contracts;
- an ADR selecting a backend only if all gates pass.

Out of scope for this SDD:

- changing mutation authority;
- persisting source bodies, compiler objects or provider data;
- introducing a daemon or external database;
- enabling persistence by default before the evidence gate;
- optimizing benchmark timings without a correctness justification.

## Current conclusion

The store boundary is ready for an evidence spike. The runtime/package matrix is now aligned to Node 22.5.0 and Node 24, but the benchmark remains synthetic and does not yet prove multi-process/concurrent semantics, interrupted writes or production fallback behavior. Keep memory-only until those gaps close.
