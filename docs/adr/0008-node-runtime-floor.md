# ADR 0008: Raise the minimum Node.js runtime to 22.5.0

- Status: Accepted; persistence clauses superseded by ADR 0009
- Date: 2026-08-06
- Decision owners: ast-mcp-server maintainers

> Persistence amendment: ADR 0009 later authorizes native SQLite only for the explicit canary policy while preserving memory-only default/rollback. Persistence statements below describe this ADR's decision point; ADR 0009 defines the current backend policy.

## Decision

Raise the package runtime floor from Node.js `>=20.19` to `>=22.5.0`.

The CI matrix must exercise the declared floor (`22.5.0`) and the current Node 24 line. README requirements, package metadata, runtime probes and persistence evidence must use the same floor.

This runtime-floor decision did not itself select or enable a persistent symbol-index backend. At this decision point, `InMemorySymbolIndex` remained the production implementation pending the persistence SDD gates later recorded by ADR 0009.

## Question

Should the package keep supporting Node.js 20.19, or raise its minimum runtime to make the built-in SQLite capability available to a supported package runtime?

## Context

The persistence evaluation found:

- Node `20.19.6` passed the existing project quality/package gates but does not expose `node:sqlite`.
- Node `22.23.2` passed the same gates and exposes `node:sqlite`.
- The official Node.js v22.5.0 documentation identifies the SQLite module as added in v22.5.0 and marks it `Stability: 1.1 - Active development`.
- Node `24.16.0` passed the equivalent local gate and exposes the API.
- At the time of this decision, the package had no SQLite/WASM dependency and intentionally kept the index memory-only.

The goal is to avoid adding a portable database dependency solely to preserve Node 20 compatibility while keeping the storage adapter replaceable and the compiler-first boundary intact.

## Options considered

### A. Keep Node.js `>=20.19`

Pros:

- Preserves the existing consumer compatibility contract.
- Avoids a breaking runtime-floor change.

Costs:

- A native `node:sqlite` backend cannot be the sole implementation.
- The project would need a portable dependency or an explicit capability split with a memory/JSON fallback.
- The persistence design and CI matrix would carry the Node 20 branch indefinitely.

### B. Raise the floor to Node.js `>=22.5.0` — selected

Pros:

- Makes the built-in SQLite API available at the declared minimum runtime.
- Removes the Node 20 compatibility branch from the supported package matrix.
- Avoids an immediate third-party native/WASM dependency.
- Keeps Node 24 coverage for the current development runtime.

Costs and risks:

- Consumers on Node 20 are no longer supported by the package contract.
- `node:sqlite` remains active development; availability is not the same as API stability.
- Persistence still requires conformance, corruption, interrupted-write, concurrency, isolation, packaging and compiler-fallback evidence.

### C. Raise the floor to Node.js `>=24`

This would narrow the support surface further without providing a correctness benefit proportional to the lost Node 22 compatibility. It is rejected.

## Consequences

- `package.json`, README and CI declare Node.js `>=22.5.0`.
- Node 20 remains useful as historical compatibility evidence but is no longer a supported runtime for the package.
- This ADR alone does not authorize native SQLite as the production default; ADR 0009 later authorizes only the explicit canary policy behind the existing `SymbolIndexStore` adapter.
- The adapter must capability-check the runtime and preserve a memory-only/compiler fallback for disabled, unavailable, stale, corrupt or failed persistence.
- No source bodies, compiler objects, credentials or mutation plans may enter a future persistent store.
- The mutation boundary remains `prepare -> review -> apply`; persistence cannot authorize or weaken it.

## Rollback and migration

Before a release that depends on this ADR, revert the runtime-floor changes and keep the existing Node 20/22 matrix. After a release, the previous published package remains the Node 20-compatible rollback target; do not claim Node 20 support for a package whose `engines` field rejects it.

Consumers must upgrade to Node.js 22.5.0 or newer before upgrading to a package version that declares this floor. This ADR itself shipped no durable backend and required no persistent-cache migration; current persistence rollback and migration policy is governed by ADR 0009.

## Evidence

- Node 20.19.6 Docker quality/package probe: underlying format, lint, typecheck, 29 suites/213 tests, build, MCP, CLI, package and audit commands passed; native SQLite unavailable.
- Node 22.23.2 Docker quality/package probe: exit `0`; all gates passed; native SQLite and JSON lifecycle fixtures passed.
- Node 24.16.0 local quality/package and native SQLite probe: previously passed.
- Official API reference: https://nodejs.org/download/release/v22.5.0/docs/api/sqlite.html
