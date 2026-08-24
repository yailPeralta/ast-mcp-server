# ADR 0014: Reclaim idle compiler memory with a supervised worker

## Status

Accepted.

## Context

The local stdio server keeps its TypeScript compiler project warm for responsive structural reads. On large projects, that compiler state can retain substantial proportional set size (PSS) after work becomes idle even though the MCP connection must remain available.

Evicting project sessions does not release compiler memory owned by the process. A shared daemon or worker pool would introduce cross-client ownership, versioning, cancellation, and mutation-recovery problems that are not required to solve per-connection idle retention.

## Decision

Keep `in_process` as the default runtime and operational rollback. Add an explicit per-connection opt-in, `AST_COMPILER_WORKER_MODE=supervised`, that keeps a lightweight stdio parent connected while one disposable child owns the compiler, project sessions, and SQLite-derived index.

This supersedes only ADR 0010's in-process-only clause. ADR 0010's compiler-authority and lifecycle boundaries remain in force, while ADR 0011 continues to govern persistence.

The parent and child use a bounded, versioned private lifecycle protocol. Startup sends the handshake, waits for the child's `ready` acknowledgement, and only then replays the retained `initialize` request and `notifications/initialized` notification. This ready-before-replay barrier prevents control-channel acknowledgements from making the first forwarded response appear stale.

Every child generation owns its forwarded request identifiers and cancellations. Replies from stale generations are rejected, and forwarded calls are never retried. The parent preserves bounded outcomes for startup, crash, and ambiguous apply cases without exposing source, paths, environment values, or operation identifiers.

Idle recycling requires stable agreement from both sides: the parent has no relay work, and the child reports open admission with no active, queued, or completion-critical work. Mutation history and live operation leases pin the generation. Completion-critical apply work is allowed to reach its normal terminal result before shutdown; parent death closes admission and does not leave an orphan after that bounded drain.

`AST_COMPILER_WORKER_IDLE_TTL_MS` controls recycling and defaults to 60 seconds. Setting it to `0` keeps the supervised relay but disables idle recycling. Setting `AST_COMPILER_WORKER_MODE=in_process` removes the process boundary entirely.

## Evidence boundary

The Linux canary passed on exact Node.js 22.13.0 and the governed Node.js 24 line. Three independent connected parents each completed three load/idle/respawn cycles with at least 80% load-delta PSS reclamation and no upward idle-PSS trend.

Unchanged respawns preserved the compiler source fingerprint, produced six SQLite hits, reused exactly 400 files, rebuilt zero files, and returned reads equivalent to `in_process`. Lifecycle evidence covered generation-affine cancellation, mutation pinning, completion-critical parent death, bounded redacted events and public errors, and zero orphan processes.

These are scoped Linux/Node canary results, not universal memory, latency, macOS, or Windows claims.

## Consequences

- Operators can reclaim idle compiler memory without disconnecting the MCP client.
- Respawn pays compiler startup cost; SQLite remains derived acceleration, never semantic authority.
- The default behavior and public tool schemas do not change.
- The private process boundary increases lifecycle complexity, which is contained behind `CompilerWorkerHost` and fail-closed protocol checks.

## Rejected expansion

This decision does not introduce a shared daemon, worker pool, cross-connection deduplication, automatic prepared-plan persistence or repair, default promotion, or a Node.js floor change.

## Rollback

Set `AST_COMPILER_WORKER_MODE=in_process`. To retain the relay while stopping idle recycle, set `AST_COMPILER_WORKER_IDLE_TTL_MS=0`.
