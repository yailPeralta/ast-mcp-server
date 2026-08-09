# Design: local MCP production readiness

## Architecture overview

Keep one in-process stdio MCP and one compiler project per cached session. Add boundaries around the existing model rather than introducing a worker/daemon topology:

1. `runtime-policy` parses bounded non-secret operational configuration.
2. `project-operation-scheduler` owns admission, FIFO queue state, wait deadlines, cancellation and cooperative operation deadlines for one session.
3. `project-session-registry` enforces strict session capacity and shutdown admission state around current session construction/eviction.
4. `public-errors` classifies and sanitizes all tool failures and emits one correlated stderr event.
5. `shutdown` coordinates server/transport/session cleanup exactly once.
6. `production-readiness` scripts exercise real stdio subprocesses and repositories without changing semantic authority.

The TypeScript compiler, symbol index, relationship graph and mutation services retain their current ownership.

## Runtime policy

Create `src/services/runtime-policy.ts` with a pure parser over an injected environment map. The public non-secret variables and defaults are:

- `AST_MAX_PROJECT_SESSIONS`: default `8`, finite range `1..32`;
- `AST_MAX_QUEUED_OPERATIONS_PER_PROJECT`: default `32`, finite range `1..256`;
- `AST_QUEUE_WAIT_TIMEOUT_MS`: default `30_000 ms`, finite range `100..300_000 ms`;
- `AST_OPERATION_DEADLINE_MS`: default `120_000 ms`, finite range `1_000..900_000 ms`;
- `AST_SHUTDOWN_DRAIN_TIMEOUT_MS`: default `10_000 ms`, finite range `100..60_000 ms`.

Invalid, non-integer, negative, zero, NaN or overflow values use conservative defaults and expose only safe policy reasons.

These values bound retained work; they are not SLAs.

The production-readiness harness runs representative repositories with a fixed `AST_OPERATION_DEADLINE_MS=300_000 ms` child environment and a `330_000 ms` MCP request timeout. This keeps the server-side cooperative deadline bounded and observable before the harness transport timeout while leaving the product default unchanged. Harness callers cannot override this preregistered value through ambient or per-fixture environment.

## Project operation scheduler

Extract queue mechanics from `project.ts` into a session-owned class because the state has lifecycle invariants.

Use an explicit doubly linked FIFO so a queued node can be unlinked without tombstones. Each admitted operation receives:

- monotonic sequence ID internal to the session;
- client `AbortSignal`;
- composed deadline signal;
- enqueue timestamp;
- explicit phase: `queued | synchronizing | executing | completion_critical | complete`.

The queue cap counts waiting nodes only; the one running node is accounted separately. `admitted = waiting + running`. Admission order:

1. reject if registry is shutting down;
2. reject if queue capacity is exhausted;
3. append a node, reserve one waiting slot and attach one abort listener/queue timer;
4. cancellation or queue expiry unlinks that waiting node in O(1), clears closure/listener/timer, decrements waiting and settles the caller immediately;
5. when no operation runs, dequeue the head, clear its queue timer/listener, decrement waiting and increment running;
6. compose a fresh execution-deadline signal with the client signal, synchronize with checkpoints and invoke the callback;
7. release running state/deadline listener/timer in one `finally` path and start the next head.

Repeated enqueue/cancel cycles behind a blocked running head retain no tombstones or callbacks. Tests inspect queue-node and listener counts through immutable snapshots, not exported mutable internals.

Use `performance.now()`/monotonic duration internally for wait/execution measurements. Public timestamps remain canonical UTC where existing contracts require them.

## Strict session registry

Keep session identity keyed by canonical `tsconfig.json`. Session lookup/creation is synchronous around the map, so duplicate construction for the same config remains impossible in one event loop.

When creating a new session at capacity:

- choose the least-recently-used session with no admitted/running work;
- close watcher and persistent store before deletion;
- if none exists, throw typed `PROJECT_CAPACITY_EXCEEDED` before `buildProjectContext()` or watcher/cache construction.

During shutdown, the registry rejects all new admission. It exposes bounded aggregate counts for tests/operator status but not host paths.

## Cancellation checkpoints

The MCP SDK supplies `extra.signal` to tool callbacks. Update adapters to pass it into service entrypoints through a small request context rather than importing SDK types throughout domain services.

Required checkpoints:

- before session lookup/creation;
- before and after queue wait;
- before config snapshot;
- between refresh/snapshot/refresh/verification phases;
- before symbol-index open/load/refresh/flush;
- before relationship collection;
- before tool-specific traversal/serialization;
- before retaining a prepared operation;
- before apply lock acquisition and before first source replacement.

Synchronous compiler calls can finish before the next checkpoint. The implementation must not race them with `Promise.race()` and return while they continue mutating session state.

### Apply completion-critical phase

Once apply begins the first source replacement, it enters `completion_critical`. Cancellation is recorded for observability but does not abort rollback, postimage verification or receipt persistence. The caller receives the actual terminal apply result. Before that boundary, cancellation prevents writes.

## Error boundary

Create `src/services/public-errors.ts` with:

- typed internal operational errors carrying public code and safe message;
- classifier for known project/path/selector/operation errors;
- idempotent sanitizer reusing or extracting the established status redaction rules;
- opaque UUID correlation ID;
- byte-bounded public rendering;
- byte-bounded structured stderr event.

`src/tools/result.ts` becomes the single protocol adapter. Tool callbacks pass tool name and optional opaque project identity; they never serialize raw `error.message` directly. The MCP representation is frozen: one text item containing compact canonical JSON `{ "error": { "code", "message", "correlation_id" } }`, `isError: true`, no successful `structuredContent`, at most 4096 UTF-8 bytes. The sanitized message budget is 2048 bytes.

stderr events are compact single-line JSON capped at 8192 UTF-8 bytes and contain only:

- event name/version;
- correlation ID;
- tool name;
- public code;
- safe bounded message;
- opaque project/config IDs when available;
- phase/duration counters when safe.

No source body, stack, raw arguments, environment, absolute path or cache path is logged. This release has no raw debug bypass.

## Runtime observability

Extend project status without making runtime telemetry freshness evidence. `operation_queue` preserves `state`, `active_operations`, `queued_operations` and adds the exact MCP-PROD-301 fields: `admission`, `queue_capacity`, four outcome counters, `last_outcome`, `max_queue_wait_ms` and `max_execution_ms`. There is no per-request history or high-cardinality tool/path label.

Create a pure immutable projection in `project-status.ts`. Session-local counters/maxima initialize at zero/`none` and reset only with session recreation/process restart. Projection clamps active to `0..1`, queued to the normalized capacity, counters to `2_147_483_647` and durations to `86_400_000`; derives state from normalized counts; maps malformed admission to `closed`, malformed outcome to `internal_error`, invalid counts/durations to zero and over-limit numbers to their ceilings. The tool Zod schema uses those exact finite enums/ranges. Existing three fields retain their meaning.

## Shutdown coordinator

Refactor executable startup into a testable `runStdioServer()` returning a shutdown handle. One coordinator owns a shared promise and tracks whether apply has crossed the first-source-write boundary:

1. set registry admission to closed;
2. cancel queued and active cancellable operations;
3. wait up to the configured grace for non-critical work;
4. never close transport/session/watcher/SQLite resources still referenced by active work;
5. if grace expires with no completion-critical apply, resolve the coordinator as `forced_noncritical`, emit exactly one sanitized incomplete-shutdown event and let `src/index.ts` call `process.exit(1)` without invoking close on in-use resources;
6. if apply is completion-critical, keep transport/session resources and wait for rollback/postimage/receipt terminal completion without claiming an upper bound;
7. after safe drain, close server/transport and project resources exactly once, remove listeners and resolve complete.

Signal handlers request shutdown; they do not call `process.exit()` before the coordinator resolves and they do not interrupt completion-critical work. stdin/transport closure follows the same coordinator as far as the transport remains available. A second trigger awaits the existing promise. External `SIGKILL` is outside graceful guarantees and relies on existing stale-lock/postimage recovery.

Tests spawn the built executable and use stdio/MCP requests, signals and deadlines. They inspect exit timing and disposable cache/lock state, never production repositories.

## Canary harness

Add a read-only script and package command. Inputs:

- absolute project root;
- explicit workload manifest;
- explicit `--node-bin` equal to `AST_NODE_22_BIN` or `AST_NODE_24_BIN`;
- expected runtime selector `22.5.0 | 24`;
- optional explicit `--candidate-tree` required only for final release-closure evidence;
- iterations/restarts;
- output report path;
- optional explicit canary cache root.

The runner starts fresh stdio server subprocesses with the persistence policy absent, explicitly set to canary, and explicitly rolled back to disabled. Immutable real-repository workloads capture byte-exact `git status --porcelain=v1 -z` and an exact temporary-index worktree tree before and after and fail if either changes. They exercise status, file list, exact/broad symbol search, exploration and selected exact impact paths supplied by the manifest, but never source/config mutation.

A separate disposable fixture workload exercises one-file changes, config invalidation, corruption fallback, an independently injected non-corruption SQLite write failure, byte-exact mutation rollback, queue saturation and cancellation, then removes the fixture. Its private fixture-only MCP registrations provide deterministic hold/snapshot/failure controls without changing the production tool inventory. No invalidation or injected-failure scenario runs against the real checkout.

Canonical parity is checked from results generated through compiler-authoritative paths and a preregistered ordered per-call logical projection. Disabled-policy results establish the complete per-call hash baseline; cold, warm measurement and every restart must reproduce the applicable baseline hashes. Corruption and non-corruption write-failure fixtures independently compute a disabled-policy compiler baseline for the same source state and require byte-equal complete canonical results plus equal recorded hashes from the failing operations. Cache evidence alone cannot satisfy parity: every real canary/restart gate also requires ready SQLite state, accepted/loaded/reused evidence and zero unexpected fallback/corruption/write-failure increments. Mutation workflows run only in generated disposable fixtures.

Report raw:

- commit/package/runtime/OS;
- complete unfiltered source-file count plus preregistered workload call count and ordered IDs;
- cold/warm/restart latency samples (observational for real repositories);
- child peak RSS where measurable;
- recursive quiescent cache file manifest/bytes from `lstat` without symlink following, including main/WAL/SHM/quarantine/temp files;
- hits/misses/rebuilds/fallbacks/corruptions/write failures;
- cancellation/queue saturation outcomes;
- disabled rollback behavior;
- pre/post git status equality;
- deterministic fixture resource gates under `node --expose-gc`, with exactly one `global.gc()` immediately before each RSS sample, using 10 warm-up plus 50 measured identical reads: final-five median RSS no more than `max(32 MiB, 20%)` over first-five median, and final-restart immutable cache bytes no more than `max(1 MiB, 5%)` over first complete build;
- each gate boolean and overall status.

The first cache measurement occurs after complete build plus graceful store flush/close; the final occurs after the third unchanged restart plus graceful flush/close. Symlink, unreadable or non-regular entries fail the gate. `--iterations=20` controls only the real-repository warm observations; the fixture independently fixes 10 warm-ups and 50 measured reads, invokes `global.gc()` once per measured sample and treats the complete build as generation zero followed by restarts 1–3. Each measurement writes a bounded ephemeral raw report as a new direct child of literal `/tmp`, independent of `TMPDIR`, checks byte-exact repository status and exact worktree-tree identity, then exits. Generate all four raw reports from the same clean committed Task 5.1 package tree before freezing any member.

The only checked-evidence transition is one closed `freeze-report-set`; no standalone freezer, callback-driven publication orchestrator or one-report checked transformation is exported. Validation-only test seams return no checked representation and cannot orchestrate or publish. It accepts exactly the four unique direct-/tmp regular non-aliased inputs plus a canonical explicit `--x-scraper-root` authority, and binds each member to one fixed alias/runtime/destination. Both `[x-scraper]` raws must physically match that clean root; each runtime pair must share one project/workload cohort. The freezer pins and reads every raw input, rejects any input whose inode has another hard link outside the set, completes closed schema/gate/secret/canonical-byte and live runtime/workload/harness/project/package Git verification for all four, then requires one shared clean package commit/tree/status and harness digest before publication starts. Queue state, admission, outcome, capacity, counter and duration fields use the exact MCP-PROD-301 domains and relations; runtime gates are recomputed from the retained outcomes, final queue snapshot and cache-existence evidence. The publisher revalidates the complete set, acquires and pins an exclusive sibling lock, requires an absent final directory, writes exactly four fixed files in a process-owned sibling stage, accepts no other package status, and rechecks runtime binaries and external project identities. Pre-commit cleanup locates only the pinned owned lock/stage inodes under the pinned parent, removes those objects after displacement and preserves replacements at their original pathnames. After that callback it byte-verifies the pinned stage and requires the source name to retain the pinned inode immediately before invoking GNU coreutils `mv --update=none-fail --no-copy --no-target-directory`. The publisher waits for definitive child termination rather than returning a timeout while rename remains possible. The move renames the complete stage to `benchmark/results/production-readiness` in one no-replace visibility transition and reports a collision as failure. A successful move, including an error-channel result whose final name is proven to hold the pinned stage inode, is the commit point; later owned lock/descriptor cleanup is best effort and cannot reverse success. It never overwrites or merges an existing final directory; any validation/write/recheck/publication failure before that point exposes zero final files and removes only the owned stage and lock. This is cooperative same-UID coordination and atomic visibility, not protection from a malicious peer with equal filesystem authority or power-loss durability through directory `fsync`. Checked reports use aliases `[ast-mcp-server]` and `[x-scraper]`; final verification records their SHA-256 digests. Post-freeze reruns target new `/tmp` names and do not overwrite checked reports.

## Platform/support policy

v0.7.0 support is Linux with GNU coreutils `mv` supporting `--update=none-fail`, plus Node 22.5/24. CI keeps the complete matrix on Ubuntu. README and `SECURITY.md` state that macOS/Windows and Linux systems without that no-replace primitive are unverified for evidence freezing due to filesystem/process semantics. Package metadata is adjusted only if a truthful npm `os` restriction is intentionally desired; do not add one casually because it can block experimental users. No cross-platform claim is derived from TypeScript compilation alone.

## Supply chain and release

Add:

- `SECURITY.md` with supported versions/reporting and no-secret instructions;
- Dependabot or equivalent read-only dependency update configuration;
- CodeQL/security workflow with least permissions and timeouts;
- explicitly dispatched exact-SHA release workflow pinned to immutable action SHAs;
- official-registry/trusted-publishing preflight and provenance;
- exact artifact/registry readback steps.

The workflow must fail closed when npm trusted publishing is not configured. `mode=publish-next` performs exact-SHA preflight and publishes at most once under `next`; an ambiguous success transitions to idempotent `mode=verify-next` after registry `gitHead` readback, never to republish. `verify-next` performs the exact MCP-PROD-604 metadata, attestation, integrity, `npm audit signatures` and registry-consumer assertions and stores SHA/version-bound evidence. A later `mode=promote-latest` requires that verification run/artifact and a separately protected production Environment. Transient unchanged verification may rerun; a deterministic package/verifier failure requires a new patch version. Git tag/GitHub Release follow `latest` readback. The workflow must not accept long-lived npm tokens in repository files.

## Documentation lifecycle

The stale `2026-08-06-symbol-index-persistence-evidence` change is historical evidence superseded by ADR 0009 and the archived integration SDD. Update its closure text and archive it in a dedicated docs commit before runtime implementation.

ADR 0010 records:

- local stdio/Linux product boundary;
- in-process bounded scheduler versus worker isolation;
- cooperative cancellation limitation;
- stable public error boundary;
- release provenance/readback model;
- rollback/evolution path.

README/ADR historical wording is synchronized only after implementation evidence exists.

## Verification strategy

Each phase uses RED/GREEN/VERIFY and a separate Conventional Commit. Final closure requires:

- focused scheduler/error/shutdown tests;
- compiled hostile runtime probes;
- full tests;
- format, lint, typecheck, build;
- MCP, CLI and package smokes;
- audit and pack inspection;
- Node 22.5 and 24 production-readiness matrix;
- real-repository read-only canary reports;
- exact-tree secret/path scan;
- read-only adversarial review;
- final `verification.md` requirement traceability;
- archive only after PASS.

Closure is two commits, not a mixed code/docs commit. First commit `scripts/release-candidate-matrix.mjs`, its test and the `package.json` script after focused GREEN. On that clean tree, run preliminary matrix/canary gates, author `verification.md`, freeze the six active SDD artifacts and obtain Review A.

After Review A PASS, move those six artifacts unchanged to the archive, stage only the five tracked renames plus the new archived verification, reject any unstaged/untracked path, and compute `CANDIDATE_TREE=$(git write-tree)`. Run the full dual-runtime matrix, four immutable-repository canaries, scans and Review B against that exact staged tree. Re-read `git write-tree` after every gate and require equality. Then commit only the staged archive manifest and require `git rev-parse HEAD^{tree}` to equal `CANDIDATE_TREE`, with clean index/worktree. Only that commit may become `RELEASE_SHA`.

Any source, test, script, checked report or documentation byte edit after its applicable gate invalidates downstream evidence. A commit that preserves the reviewed staged tree byte-for-byte does not; tree-hash equality proves that boundary without recursively editing `verification.md`.
