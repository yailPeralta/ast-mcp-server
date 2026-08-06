# Proposal: evaluate durable symbol-index storage without weakening compiler authority

## Intent

Produce enough reproducible evidence to decide whether the derived symbol index should survive process restart. If, and only if, the evidence gates pass on all supported runtimes, integrate one backend behind the existing `SymbolIndexStore` interface with persistence disabled by default until an explicit policy enables it.

This proposal is deliberately not a request to install SQLite/WASM now.

## Problem

The current memory-only index is safe and simple, but every process restart rebuilds derived metadata from the compiler. A durable cache could reduce warm-up cost, yet an incorrect or stale cache could make code intelligence misleading or weaken mutation safety. The cost is therefore correctness and operability, not merely storage speed.

## Options

| Option                   | Benefit                                                                              | Blocking cost/risk                                                                                                | Initial disposition                                  |
| ------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Keep memory-only         | No dependency, no corruption surface, compiler rebuild is authoritative              | No restart reuse; cold rebuild remains                                                                            | Safe baseline and rollback target                    |
| JSON file store          | Portable, easy to inspect and package                                                | Atomicity, concurrent writers, large rewrites and recovery need explicit proof                                    | Benchmark-only candidate until concurrency is proven |
| Native SQLite API        | Transactions, indexes and compact storage; no third-party dependency where available | `node:sqlite` availability/stability differs by Node version; package supports Node 20.19+                        | Evaluate only through the runtime matrix             |
| Portable SQLite/WASM     | One implementation across runtimes                                                   | New dependency/package size, startup/worker behavior, API compatibility and lifecycle surface                     | Evaluate only if matrix or native option requires it |
| External database/daemon | Shared multi-process state                                                           | Operational dependency, availability, deployment and failure complexity disproportionate to a local derived cache | Rejected for this SDD                                |

No backend is selected by this proposal. The evidence phase must compare the candidates against the same conformance and failure matrix.

## In scope

- Runtime probes for Node 20.19, Node 22 and current Node 24.
- Backend-neutral store contract and conformance tests.
- Restart, schema migration, corruption, atomicity, interrupted write, concurrent reader/writer and project isolation tests.
- Package/tarball/install evidence with Yarn lifecycle scripts disabled.
- Fail-closed runtime policy, metrics/status fields and rollback to memory-only.
- ADR update only after a candidate satisfies the gates.

## Out of scope

- Source-body persistence.
- Compiler/project snapshot persistence as an authority.
- Mutation plan approval from index data.
- External storage services or a resident index daemon.
- Live default enablement before supported-runtime evidence.

## Success criteria

A backend can be proposed for production only if it demonstrates:

1. semantic parity with `InMemorySymbolIndex` through the same conformance suite;
2. restart reuse with project/config isolation;
3. versioned migration and bounded corruption rebuild;
4. atomic or otherwise fail-safe writes under interruption and concurrency;
5. no source bodies or compiler objects persisted;
6. Node 20.19 and Node 22 support, plus the current Node 24 development runtime;
7. isolated package install and smoke with lifecycle scripts disabled;
8. disabled-cache/compiler fallback when any optional persistence operation fails;
9. no change to mutation plan verification, freshness authority or exact compiler reads;
10. deterministic observability sufficient for an operator to distinguish cache hit, miss, stale, disabled, rebuilding and degraded states.

If no candidate passes, the successful outcome is a documented decision to keep memory-only and revisit with a better runtime/dependency constraint.

## Rollback

The rollback is policy-level: disable persistence, discard or quarantine the cache, and rebuild the in-memory index from the active compiler session. No source or mutation data may depend on the persisted cache for correctness.
