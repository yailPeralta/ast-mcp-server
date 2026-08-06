# ADR 0006: Make read context and freshness explicit

- Status: Accepted
- Date: 2026-08-06
- Decision owners: ast-mcp-server maintainers

## Context

The server has several read-side representations of a TypeScript project: the filesystem, the synchronized compiler project, the session-owned watcher, and a derived symbol index. A file event is only an invalidation hint. It does not prove that the compiler snapshot or a derived query result is current. A read that silently serves stale or incomplete evidence can look like a valid negative result to an agent.

The same problem appears at two different scopes:

- a file snapshot must say whether the returned bytes match the synchronized compiler snapshot;
- a project session must say whether synchronization is fresh, pending, rebuilding, stale, or degraded and why.

The design must also preserve bounded responses. A record, byte, traversal, invocation or serialization limit is a correctness signal: omitted evidence must be visible instead of being represented as absence.

The contract must not expose absolute project identity, credentials, environment values or unbounded error text. It must work when the watcher fails, when a synchronous refresh is required, and while the symbol index remains memory-only.

## Decision

Expose two separate concepts in read results:

1. `snapshot_state` describes the returned file bytes (`fresh` or `stale`) relative to the synchronized compiler snapshot.
2. `freshness` describes the project/session state with:
   - `state`: `fresh`, `pending`, `stale`, `rebuilding`, or `degraded`;
   - bounded `causes`: `source_change`, `config_change`, `index_failure`, `watcher_failure`, or `compiler_rebuild`;
   - bounded `checked_at` timestamp, or `null` when no successful check exists.

A session may report `fresh` only after a successful source/config fingerprint check and completed relevant synchronization. Source synchronization uses refresh, snapshot, refresh and verification; if the verification fingerprint changes, the session remains stale or degraded rather than claiming that the compiler matches the filesystem.

The per-project `withProject()` queue remains the serialization boundary for compiler and watcher work. Watcher events are queued invalidation hints, not authority. On watcher overflow or error, the session discards incomplete pending paths, transitions to `degraded`, exposes the failure, and uses bounded synchronous fingerprint/refresh recovery before an exact read can be trusted.

Read tools expose freshness together with completeness, unresolved items, budgets and truncation where their result shape can be partial. A truncated result carries a machine-readable reason; it is never treated as a complete negative result. `ast_get_impact` fails closed when exact relationships are not fresh. `ast_explore` preserves degraded/stale metadata and incomplete evidence for the caller to handle.

The symbol index is a derived accelerator. It does not change this contract or become a read/mutation authority. The current production backend is memory-only; missing, stale or mismatched index evidence falls back to compiler-backed synchronization or remains unavailable.

Status projections are JSON-safe and bounded. They redact absolute paths, credentials, authorization values and unbounded provider/error text before returning data to an MCP client.

## Consequences

### Positive

- Agents can distinguish current evidence, pending work, stale snapshots, rebuilds and degraded recovery instead of inferring state from missing records.
- File bytes and project synchronization have unambiguous, non-overlapping freshness semantics.
- Watcher failure fails closed without making exact reads permanently unavailable when bounded synchronous recovery is possible.
- Budgets and truncation become part of the evidence contract, preventing partial responses from masquerading as complete results.
- Read/index evolution remains independent from the reviewed mutation protocol.
- The contract is compatible with the current memory-only index and a future derived backend.

### Negative

- Every read response carries additional metadata and clients must inspect it before making absence or impact decisions.
- A degraded or stale session can require synchronous compiler work and therefore increase read latency.
- The server may refuse impact traversal or preserve an incomplete result rather than return a convenient but unsafe answer.
- Bounded status/error projections can omit detail and require a follow-up diagnostic command.

## Alternatives considered

### One boolean `current` flag

Rejected. It conflates file bytes, compiler synchronization, watcher state and index state, and cannot explain why a result is not current.

### Treat watcher events as authoritative freshness

Rejected. Filesystem event streams can coalesce, overflow, miss atomic-save shapes or fail. Only fingerprint verification plus completed synchronization can establish freshness.

### Silently serve the last successful result

Rejected. It converts stale or incomplete evidence into a false negative and is especially unsafe for impact and candidate-test decisions.

### Throw on every stale or degraded read

Rejected for bounded exact reads. The synchronous fallback can recover exact source/compiler state, while composed reads can return explicit degraded/incomplete metadata. Impact remains fail-closed because its relationship semantics require fresh evidence.

### Make a persistent index the freshness source

Rejected. The index is derived and currently memory-only. Persistence requires separate runtime, packaging, restart, migration and corruption evidence and cannot replace compiler synchronization.

## Verification

- `test/read-contracts.test.ts` validates state, cause, budget and truncation domains.
- `test/project-status.test.ts` covers state transitions, bounded projections and redaction.
- `test/project.test.ts` covers freshness races, recovery and session lifecycle.
- `test/project-watcher.test.ts` covers debounce, errors, overflow fail-closed behavior and cleanup.
- `test/project-fallback.test.ts` covers exact synchronous recovery while the session remains degraded.
- `test/mcp.integration.test.ts` verifies public freshness and snapshot metadata.
- Full repository gates, MCP/CLI/package smokes and audit must pass before release.
