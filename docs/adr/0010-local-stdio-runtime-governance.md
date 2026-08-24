# ADR 0010: Govern the local stdio production runtime

- Status: Accepted; persistence clauses superseded by ADR 0011 and the in-process-only runtime clause superseded by ADR 0014
- Date: 2026-08-07
- Decision owners: ast-mcp-server maintainers
- Scope: local MCP runtime, lifecycle, operational contract and release transitions

## Decision

Treat `ast-mcp-server` as a production-quality local MCP server for a trusted single user on Linux x64 with the required GNU coreutils publication primitive, transported over `stdio`, with TypeScript and JavaScript as the supported language surface. ADR 0011 updates the current development-line runtime matrix to exact Node.js `22.13.0` and the governed Node 24 line; the `22.5.0` matrix recorded later in this ADR is historical release evidence.

Keep execution in process for this release, but place strict admission, scheduling, cancellation, lifecycle and disclosure boundaries around compiler work. Worker/process isolation remains a future option if measured workloads prove that cooperative in-process control is insufficient.

ADR 0014 now governs the current development line's opt-in supervised compiler worker. The historical decision above remains the default: `in_process` is still the default and rollback.

The compiler/project remains the sole semantic authority. Scheduling, persistence, telemetry and cancellation cannot authorize a result or weaken `prepare -> review -> apply` mutation checks.

## Runtime policy

Resolve a single validated startup policy before the server accepts requests:

- `AST_MAX_PROJECT_SESSIONS`: default `8`, range `1..32`;
- `AST_MAX_QUEUED_OPERATIONS_PER_PROJECT`: default `32`, range `1..256`;
- `AST_QUEUE_WAIT_TIMEOUT_MS`: default `30000`, range `100..300000`;
- `AST_OPERATION_DEADLINE_MS`: default `120000`, range `1000..900000`;
- `AST_SHUTDOWN_DRAIN_TIMEOUT_MS`: default `10000`, range `100..60000`.

Invalid, non-integer, negative, zero, NaN or overflow values fail closed to these conservative defaults and expose only safe policy reasons. Session capacity is strict: an occupied active session is never evicted to admit another project.

Each project uses one running slot and a removable doubly linked FIFO for waiting operations. Waiting cancellation or timeout unlinks in O(1), decrements that session's queue accounting exactly once and settles the caller immediately. There are no tombstones or unresolved predecessor chains.

## Cooperative cancellation and mutation safety

Combine the MCP SDK `AbortSignal`, queue-wait timeout and execution deadline into one operation context. Cancellation is cooperative at bounded checkpoints; this ADR does not claim preemptive interruption of synchronous compiler code.

Read operations may stop at a checkpoint and return a stable cancellation/deadline error. Mutation operations obey phase-specific rules:

- prepare/review before workspace writes: cancellable;
- apply before the first write: cancellable and releases its workspace lock;
- apply after the first write: completion-critical and must finish with its normal receipt, conflict or rollback result;
- cancellation observed after the first write is diagnostic only and cannot replace the terminal mutation result.

## Public errors and status

Every tool callback uses one central public error boundary. Public codes are a closed vocabulary: `INVALID_INPUT`, `PROJECT_NOT_FOUND`, `PROJECT_CAPACITY_EXCEEDED`, `PROJECT_QUEUE_FULL`, `QUEUE_WAIT_TIMEOUT`, `REQUEST_CANCELLED`, `OPERATION_DEADLINE_EXCEEDED`, `SERVER_SHUTTING_DOWN`, `NOT_FOUND`, `AMBIGUOUS_TARGET`, `STALE_WORKSPACE`, `MUTATION_BLOCKED`, `CONFLICT` and `INTERNAL_ERROR`. Unknown errors become `INTERNAL_ERROR`; internal codes never pass through.

Error results are compact JSON in exactly one MCP text content item with:

```json
{ "error": { "code": "<closed-code>", "message": "<safe-message>", "correlation_id": "<uuid>" } }
```

The result also has `isError: true` and no successful `structuredContent`. The serialized public payload is at most `4096` UTF-8 bytes, the safe message at most `2048` UTF-8 bytes, and the correlation ID is a lowercase canonical UUID.

Public output must not disclose absolute, UNC or drive-relative paths; traversal targets; credentials; tokens; connection strings; environment values; source bodies; raw stack traces; or cache paths. Sanitization is idempotent.

Internal stderr emits exactly one bounded structured event per tool failure, at most `8192` UTF-8 bytes, with event version, the same correlation ID, tool name, public code and safe opaque project identity when available. stdout remains MCP-only. Internal events exclude credentials, source bodies, raw arguments, stack traces and raw environment values. No debug mode may weaken either boundary.

MCP-PROD-201 through MCP-PROD-204 remain normative: in-memory, stdio and packed-consumer tests must preserve successful output schemas and prove that pre-callback SDK validation cannot echo hostile input. If the SDK cannot satisfy that test, release is blocked until a lower-level sanitized call-tool boundary exists.

`ast_get_project_status.operation_queue` remains additive and bounded. Existing `state`, `active_operations` and `queued_operations` retain their meaning. Admission, capacity, outcome counters, last outcome and wait/execution maxima use the exact enums, saturation limits and malformed-state normalization in `MCP-PROD-301`. Runtime telemetry is session-local evidence, not compiler freshness evidence.

## Shutdown

The lifecycle coordinator is idempotent and owns admission, transport, active operations, queued operations, project watchers, SQLite stores and session cleanup.

On stdin EOF, `SIGINT` or `SIGTERM`:

1. close admission and reject new requests;
2. cancel/unlink queued work;
3. request cooperative cancellation of active reads and pre-write mutation phases;
4. wait up to the configured non-critical drain grace;
5. close transport, watchers, SQLite and sessions only after their users finish;
6. return a stable terminal exit state.

If non-critical work exceeds grace, the entrypoint emits one bounded event and exits non-zero without closing resources underneath active code; the OS reclaims them. A post-write completion-critical apply may extend shutdown without a process deadline. Resources remain open until it reaches its normal terminal result. External `SIGKILL` remains outside graceful guarantees and relies on existing lock/receipt/recovery invariants.

## Persistence boundary

ADR 0011 now governs persistence:

- absent or `enabled` selects SQLite;
- `disabled` is the immediate memory-only rollback;
- `canary` requires an explicit canonical cache root;
- SQLite is a body-free, replaceable derived projection and never semantic authority.

## Verification and support

Production claims require deterministic fixture gates plus read-only canaries on representative real repositories. Real repository source/config/status bytes must remain unchanged. Invalidation and corruption tests run only in disposable fixtures.

Current runtime evidence must execute explicit `AST_NODE_22_13_BIN` and `AST_NODE_24_BIN` binaries and validate exact `v22.13.0` and major 24 respectively. The retained report freezer still uses its historical Node 22.5 authority. Resource gates use the preregistered RSS and quiescent recursive cache-byte criteria from `MCP-PROD-404`; real-repository latency/RSS are observations, not release gates.

Linux x64 with GNU coreutils 9.7 `mv --update=none-fail --exchange --no-copy --no-target-directory`, GNU coreutils `ln -L -T`, procfs descriptor paths at `/proc/self/fd`, and `O_DIRECTORY`/`O_NOFOLLOW` is supported. Other Linux architectures or systems without those primitives, macOS and Windows are unverified until they pass an equivalent SDD and evidence matrix.

The checked production-readiness cohort ran this repository and `x-scraper` under Node.js v22.5.0 and v24.16.0. All four immutable reports passed 40/40 retained gates with 20 warm reads, three restarts, zero semantic mismatches, exact repository identity, fallback/recovery, mutation rollback, queue/cancellation and MCP-PROD-404 resource evidence. The report set preserves 160/160 passing gates and is bound to the reviewed report tree `719b45ee3a73f43277981c0f842db13975f6b427`.

The exact-SHA release workflow candidate separately passed the complete repository gate, local MCP/lifecycle/public-error/CLI/package and 16-gate consumer smokes, action/workflow policy validation, a lifecycle-disabled localhost registry publication retaining the exact packed `gitHead`, and independent compliance, security and behavior reviews with zero unresolved Medium-or-higher findings.

## Release governance

Local candidate closure is exact-tree based:

1. commit the release-matrix mechanism;
2. create requirement-to-evidence verification and obtain Review A;
3. archive the SDD, stage the exact archive manifest and compute `CANDIDATE_TREE` with `git write-tree`;
4. run final gates and Review B against that staged tree;
5. commit without changing staged bytes and require `HEAD^{tree} == CANDIDATE_TREE` plus a clean worktree/index.

Push, publication, dist-tag promotion, Git tag and hosted release are separately authorized external transitions. Publication is bound to exact-SHA CI and proceeds:

1. publish the immutable version once under npm dist-tag `next`;
2. run idempotent `verify-next` registry, integrity, provenance/signature and clean-consumer proof;
3. separately authorize promotion of that exact evidence-bound version to `latest`;
4. create the annotated Git tag and hosted release only after `latest` readback.

An ambiguous accepted publication resumes through `verify-next`; it is never republished. A deterministic package/verifier failure or required source change abandons that version without `latest` promotion and starts a new patch release.

## Alternatives considered

### Worker/process isolation now

This would provide preemptive termination for CPU-bound compiler work, but adds IPC, compiler-state ownership, mutation coordination and crash-recovery complexity before evidence shows it is required. Deferred.

### Best-effort session eviction and promise-chain queues

This is simpler but cannot prove capacity, immediate cancellation or bounded retained memory. Rejected.

### Force bounded shutdown during post-write apply

This could terminate while source replacement or rollback is in progress. Rejected in favor of completion-critical mutation safety.

### Publish directly to `latest` from a Git tag

This couples irreversible transitions before public artifact/consumer proof and leaves weak recovery after ambiguous publication. Rejected.

## Consequences

- Local overload becomes explicit rejection instead of hidden memory growth.
- Cancellation latency remains bounded only at cooperative checkpoints; unsupported preemption is not claimed.
- Shutdown may remain alive for completion-critical apply, intentionally prioritizing source integrity over a false global deadline.
- Public error/status contracts become versioned compatibility surfaces.
- Release closure requires more evidence and approvals, but every irreversible transition has a forward recovery rule.
- HTTP, authentication, multitenancy, other languages, worker isolation, new mutation types and SQLite `enabled` promotion require separate SDDs.

## Rollback and evolution

Runtime changes are delivered in independently revertible slices: policy/session limits, scheduler/cancellation, error boundary, shutdown, canary/support and release automation. Reverting one slice must preserve compiler authority and mutation safety.

Operational rollback keeps persistence disabled, stops release before `latest`, and returns to the last published stable package. ADR 0014 governs worker isolation; any platform expansion or SQLite promotion must preserve the public error/status contracts or introduce an explicit versioned migration.
