# Proposal: make the local stdio MCP operationally bounded and releasable

## Intent

Close the gap between a verified compiler-first implementation and a production-quality local MCP package. The release candidate must remain semantically compiler-authoritative while adding strict runtime admission, cooperative cancellation, lifecycle cleanup, safe public errors, real canary evidence and a reproducible public release path.

## Observable outcome

For a local agent using the MCP over stdio:

- no request is admitted beyond explicit session/queue bounds;
- a cancelled or expired queued request stops waiting without running compiler work;
- active read work observes cancellation at safe checkpoints;
- mutation preparation stops before plan retention when cancelled;
- apply remains hash-bound and cannot be interrupted after crossing its write boundary;
- process shutdown stops admission, cancels queued/cancellable work, and closes transport/watchers/SQLite exactly once only after no operation uses them; a completion-critical apply may extend graceful shutdown until rollback/postimage/receipt work reaches a terminal state;
- tool errors return stable bounded codes/messages without host paths or secrets and can be correlated to sanitized stderr evidence;
- project status exposes bounded queue/cancellation/rejection/latency evidence without turning telemetry into semantic authority;
- disabled mode creates no cache, canary remains explicit, and rollback to memory is exercised on real projects;
- the exact release SHA passes local and remote gates and the registry package is verified from a clean consumer.

## Product boundary

The supported v0.7.0 product is a trusted single-user local stdio MCP for TypeScript/JavaScript projects on Linux, running Node `22.5.0` or the current Node 24 line. It operates with the permissions of the invoking user. Remote transport, untrusted clients, multi-tenancy and OS sandboxing are not part of this release.

## Goals

1. Make resource bounds enforceable rather than descriptive.
2. Use the MCP SDK cancellation signal without claiming hard preemption of synchronous compiler work.
3. Preserve mutation completion and receipt invariants under cancellation and shutdown.
4. Establish one safe, stable public error boundary for all tools.
5. Produce reproducible canary evidence on this repository and `x-scraper`.
6. Make support, security, release and rollback procedures explicit.
7. Publish only the artifact proven by final-SHA CI. Publish it first under npm `next`, prove it from a fresh registry consumer, then promote the same version to `latest`.

## Non-goals

- No new AST mutation primitives.
- No HTTP server, auth, tenant isolation or remote deployment.
- No language backend beyond the TypeScript compiler.
- No worker pool or daemon topology.
- No default SQLite activation and no `enabled` release.
- No universal latency/RSS claims from one machine or fixture.

## Phased delivery

### Phase 0: documentation and baseline lock

- Archive or explicitly supersede the stale persistence-evidence OpenSpec.
- Record the current local/remote/registry mismatch.
- Add ADR 0010 for the local runtime/support/release boundary.
- Keep the tree default-disabled.

### Phase 1: runtime governance

- Introduce a small session-operation scheduler with a strict eight-session default, per-project queue cap, bounded queue wait and cooperative deadline/cancellation state.
- Reject new project/session work when no idle session can be evicted.
- Expose stable saturation/cancellation reasons and bounded counters.

### Phase 2: public error and lifecycle boundary

- Centralize error classification, redaction, correlation and stderr reporting.
- Wire SDK `extra.signal` through every public tool and internal operation path that can safely observe it.
- Add idempotent shutdown for stdin closure, signals and transport disconnect.

### Phase 3: canary, scale and support evidence

- Add immutable read-only real-repository workloads for disabled and explicit-canary subprocesses.
- Exercise restart reuse and parity on real repositories; exercise changed-only rebuild, config invalidation, fallback, rollback, queue saturation and cancellation only in disposable fixtures.
- Run against this repository and `x-scraper`; report runtime identity, workload, raw latency, RSS, DB size and observability counters.
- State Linux as the supported platform until other OS matrices pass.

### Phase 4: supply chain and release candidate

- Add security/support policy and dependency/security workflows.
- Pin third-party GitHub Actions to reviewed immutable revisions.
- Update README, ADR references and changelog from verified evidence.
- Bump to `0.7.0` only after implementation gates pass.
- Build and inspect the exact tarball.

### Phase 5: external release transitions

Each transition is separate and requires readback:

1. explicit operator authorization to push;
2. CI success on the exact release SHA;
3. explicit operator authorization to publish the exact version once under npm dist-tag `next`;
4. idempotent `verify-next` readback of exact version, git SHA, `next`, integrity, attestations and npm signature/provenance verification;
5. fresh registry-consumer MCP/CLI/mutation smoke recorded in the verification evidence;
6. explicit operator authorization to promote that exact verified version from `next` to `latest`;
7. `latest` readback;
8. annotated tag and GitHub Release only after registry-consumer and `latest` verification.

If npm accepted the version but publication evidence was lost, `verify-next` resumes from registry state and MUST NOT republish. A transient verifier/consumer failure may rerun unchanged against the same SHA. A deterministic package failure, or any source/verifier change required to pass, abandons that immutable version without `latest` promotion and starts a new patch release candidate.

A missing external authorization or trusted-publisher configuration leaves a valid local release candidate; it is not silently treated as a published release.

## Success criteria

1. Strict capacity tests prove sessions never exceed the configured maximum, including all-busy races.
2. Queue tests prove bounded admission, wait timeout, cancellation cleanup, FIFO for admitted work and counter/listener recovery.
3. Cancellation tests prove reads/prepares stop at safe checkpoints and apply completion remains deterministic after writes begin.
4. Shutdown child-process tests prove bounded cancellation/drain for non-critical work, idempotent cleanup, no close-under-use, and completion-critical apply preservation. They explicitly do not claim a universal exit deadline after source replacement begins.
5. Every public tool returns the stable sanitized error contract; hostile path/credential/error fixtures leak no sensitive value.
6. Full compiler/mutation/persistence behavior remains unchanged except for explicit admission/cancellation/lifecycle outcomes.
7. Canary reports for both real repositories preserve compiler parity and exercise rollback; measurements remain scoped to their workload/runtime.
8. Node 22.5 and Node 24 pass format, lint, typecheck, full tests, build, MCP/CLI/package smokes, audit, pack and production-readiness benchmarks.
9. Remote CI passes on the exact release SHA before publication.
10. The installed registry artifact reports the expected version/tools and passes representative read, prepare, preview, apply, replay and conflict behavior.

## Rollback

- Runtime governance changes remain local modules and may be reverted without changing source/project formats.
- Queue/deadline configuration falls back to conservative compiled defaults on invalid input.
- Public errors switch atomically in v0.7.0 to the frozen compact-JSON envelope; there is no raw-text compatibility or raw-error fallback.
- Shutdown failure never authorizes mutation or SQLite state. Non-critical drain expiry reports failure and may terminate non-zero without closing resources still in use. Completion-critical apply retains its resources and completes recovery before graceful exit, even beyond the nominal drain window.
- SQLite rollback remains `AST_SYMBOL_INDEX_PERSISTENCE=disabled` plus process restart/session invalidation.
- A failed canary or release gate blocks version promotion/publication; npm `latest`, tags and hosted release remain untouched.
