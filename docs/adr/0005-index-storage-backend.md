# ADR 0005: Keep the symbol index memory-only until the runtime matrix is proven

- Status: Superseded by ADR 0011; intermediate runtime/canary decisions recorded by ADR 0008 and ADR 0009
- Date: 2026-08-06
- Decision owners: ast-mcp-server maintainers

> Supersession note: ADR 0008 raised the package floor to Node.js `>=22.5.0`, ADR 0009 later authorized native SQLite only for explicit canary use, and ADR 0011 now governs the current `>=22.13.0` default-SQLite policy with explicit memory rollback. This ADR records why persistence remained memory-only at its decision point.

## Decision

At this decision point, keep `InMemorySymbolIndex` as the only production backend. Do not add a native SQLite or portable/WASM SQLite dependency in Task 7.1, and do not introduce a JSON file store into the runtime path.

The original re-open gate required a supported-runtime matrix with real evidence for the then-supported Node.js 20.19+ and Node.js 22 lines, lifecycle-disabled tarball installation, restart reuse, schema migration, corruption recovery, and the existing mutation/read safety gates. ADRs 0008 and 0009 record the later runtime and persistence decisions.

## Question

Should the versioned `SymbolIndexStore` contract gain a persistent backend for warm restarts now?

## Forces and constraints

- The index is derived read evidence, not compiler authority. A missing or corrupt index must fall back to compiler-backed synchronization and must never authorize a mutation.
- At the time of this decision, the package supported Node.js `>=20.19`; a backend available only in newer Node versions could not become the default without a compatibility plan.
- Yarn lifecycle scripts are disabled and packed consumers must remain isolated and reproducible.
- The current store contract is asynchronous and project-scoped, with schema version, content/config fingerprints, body-free symbols, query limits, clear, and flush operations.
- The project is a solo-maintained package. A persistence dependency adds packaging, native binary/WASM, migration, corruption, and support surface that must pay for itself.

## Options considered

### A. Keep memory-only

Pros:

- No dependency or native/WASM loading risk.
- The then-current Node 20.19+ package contract remains unchanged.
- Fresh compiler synchronization is already the correctness fallback.
- Corruption and restart semantics are explicit: rebuild from the compiler project.

Costs:

- No warm index reuse after process restart.
- Large projects pay the index rebuild cost after every restart.

### B. Native SQLite through `node:sqlite`

Pros:

- Durable transactional storage without an npm native addon.
- Lower measured file footprint than the JSON probe.
- Restart, metadata migration, and invalid-database recovery are straightforward on the current runtime.

Costs and blockers:

- The API is available in the measured Node `v24.16.0` runtime, but no Node 20.19+ or Node 22 executable was available for the required compatibility run.
- Selecting it would either raise the package floor, add a runtime capability branch, or require a separate adapter and fallback.
- The current benchmark only exercises a synthetic adapter and a metadata-version migration marker; it is not production migration evidence.

### C. Portable/WASM SQLite

Pros:

- Potentially consistent behavior across supported Node versions and platforms.
- Avoids native addon compilation.

Costs and blockers:

- No supported WASM SQLite package is installed in the repository.
- Adding one before proving package size, startup, restart, migration, corruption, and lifecycle-disabled tarball behavior would be premature.
- No dependency-specific adapter or production operational evidence exists.

### D. Atomic JSON file store

Pros:

- Dependency-free and easy to inspect or rebuild.
- Works across the current package/runtime matrix.
- Atomic replacement and corruption recovery are simple to explain.

Costs and blockers:

- Full JSON rewrites make changed-file and config rebuilds scale with the complete index.
- It has no transaction/query engine and would require careful locking if multiple processes ever shared a path.
- It would add durable-state invalidation and migration semantics without solving the Node 20/22 performance/support evidence gap.

## Evidence

Command:

```bash
yarn benchmark:index-storage --output /tmp/ast-index-storage-verify.json
```

The command also ran the existing isolated tarball/package smoke. Workload: 128 body-free file entries, 8 symbols per entry, 30 warm queries for `symbol_0`, one changed-file rebuild, one config rebuild, restart, schema-marker migration, and corruption recovery. Values below are local observations from the real run, not latency or capacity SLAs.

| Backend       | Initial rebuild ms | Warm query p50/p95 ms | Changed file ms | Config rebuild ms | Restart ms | Storage bytes |
| ------------- | -----------------: | --------------------: | --------------: | ----------------: | ---------: | ------------: |
| memory        |              1.180 |         0.128 / 1.739 |           0.106 |             0.656 |        N/A |           N/A |
| file JSON     |              1.954 |         0.251 / 0.497 |           1.614 |             6.080 |      2.406 |       405,293 |
| native SQLite |              1.737 |         1.539 / 2.604 |           0.153 |             2.703 |      1.327 |       294,912 |

Recovery observations:

- File JSON: restart pass, schema-marker migration pass, malformed JSON recovery rebuilt all 128 entries.
- Native SQLite: restart pass, schema-marker migration pass, invalid-database recovery rebuilt all entries.
- Memory: restart, migration, and corruption are explicitly not applicable because no bytes are persisted.
- No backend persisted source bodies; the workload contained only `SymbolIndexFileEntry` projections.
- Current runtime: Node `v24.16.0`, `node:sqlite` available.
- Node `20.19+` and Node `22+`: no compatible executable was available locally; the benchmark did not download or implicitly install runtimes.
- Portable/WASM SQLite: unavailable because no candidate package is installed.
- Yarn lifecycle scripts: disabled by `.yarnrc.yml`; isolated package smoke passed with lifecycle scripts disabled, installed MCP handshake, two installed targets, and idempotent setup.

The benchmark was run once with package smoke skipped to isolate backend behavior and once with the full packaging probe. The full run is the evidence represented here.

## Consequences

- Task 7.2 remains deferred. The production index stays memory-only and continues to rebuild from compiler-backed project state.
- No dependency, native binary, WASM payload, persistent path, migration runner, or corruption-recovery runtime code is introduced.
- Warm restart performance is intentionally not optimized until the supported-runtime and packaging matrix is available.
- The `SymbolIndexStore` interface remains the seam for a later adapter; callers do not depend on storage models.
- A future persistence ADR must include supported Node 20/22 runs, package size/startup, isolated tarball install, multi-process/path ownership, migration from the exact schema, corruption recovery, and read/mutation fallback proofs before changing the default.

## Rollback and follow-up

Rollback is the current state: remove the experimental benchmark and keep the in-memory implementation. No production data migration is required because no persistent backend was shipped.

Before reopening:

1. Run the benchmark under Node 20.19+ and Node 22 in CI or explicitly provisioned local runtimes.
2. Evaluate one portable/WASM adapter or document why the package is rejected with measured package/startup evidence.
3. Add a production adapter behind the existing `SymbolIndexStore` contract only after restart, schema migration, corruption, project isolation, and mutation-safety tests are real rather than synthetic.
