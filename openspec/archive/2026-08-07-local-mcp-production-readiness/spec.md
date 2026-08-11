# Specification: local MCP production readiness

## Runtime admission and scheduling

### MCP-PROD-001 Strict project-session capacity

The server MUST enforce a finite project-session capacity. When capacity is reached and no inactive session can be safely evicted, a new project request MUST fail before constructing a compiler project, watcher, queue or SQLite store. The default capacity MUST remain eight. Invalid configuration MUST fail closed to the default.

#### Scenarios

- Eight idle sessions: least-recently-used idle session is closed before the ninth is created.
- Eight active sessions: ninth project receives `PROJECT_CAPACITY_EXCEEDED`; session count remains eight.
- Concurrent requests for the same new project create exactly one session.
- Rejection creates no watcher/cache path and leaks no host identity.

### MCP-PROD-002 Bounded per-project queue

Each project session MUST cap retained waiting operations before allocating operation-specific compiler/index work. One running operation is tracked separately and does not consume a waiting slot. The server MUST reject overflow with `PROJECT_QUEUE_FULL`, preserve FIFO order for admitted operations, and restore all counters/listeners after success, failure, timeout or cancellation.

The default queue cap MUST be explicit and documented. Configuration MUST have finite minimum/maximum bounds and invalid values MUST use the conservative default.

### MCP-PROD-003 Queue wait timeout

An admitted waiting operation MUST have a bounded queue-wait deadline. Expiry before execution MUST unlink the node in O(1), settle the caller immediately with `QUEUE_WAIT_TIMEOUT`, release its waiting slot and retained closure/listeners/timer immediately, MUST NOT synchronize the project or invoke the operation callback, and MUST NOT break later admitted work. Repeated enqueue/cancel cycles behind a blocked running head MUST retain neither tombstones nor operation closures.

### MCP-PROD-004 MCP cancellation propagation

Every tool callback MUST consume the SDK `RequestHandlerExtra.signal`. Cancellation while queued MUST unlink the waiting node in O(1), settle the caller immediately and remove retained operation state before compiler work. Active work MUST check cancellation at defined safe checkpoints and return `REQUEST_CANCELLED` when no completion-critical mutation phase has begun.

The server MUST NOT claim hard preemption during a synchronous TypeScript compiler call.

### MCP-PROD-005 Mutation-safe cancellation

Rename, body replacement and scaffold preparation MUST NOT retain a plan after cancellation is observed. Apply MUST check cancellation before acquiring the write boundary. Once any source replacement begins, cancellation MUST NOT interrupt rollback, postimage verification or receipt persistence; apply MUST return/recover the deterministic terminal result of that write attempt.

### MCP-PROD-006 Deadline semantics

A finite server-side cooperative deadline MUST be combined with client cancellation. Deadline expiry MUST use `OPERATION_DEADLINE_EXCEEDED`. Checkpoints and non-preemptible regions MUST be documented. A timeout wrapper that returns while compiler/write work continues untracked is forbidden.

## Lifecycle

### MCP-PROD-101 Admission shutdown gate

Shutdown MUST atomically stop new operation/session admission before draining existing work. Rejected shutdown-time requests MUST use `SERVER_SHUTTING_DOWN`.

### MCP-PROD-102 Idempotent shutdown with bounded non-critical grace

stdin closure, transport closure, `SIGINT` and `SIGTERM` MUST converge on one idempotent shutdown coordinator. It MUST:

1. stop admission;
2. cancel queued and active cancellable work;
3. wait up to a bounded graceful-drain deadline for non-critical work;
4. never close MCP/session/watcher/SQLite resources while an operation still uses them;
5. if the grace expires without a completion-critical apply, return `forced_noncritical`, emit one sanitized incomplete-shutdown event and let the executable call `process.exit(1)` without invoking close on in-use resources;
6. if an apply crossed its first-source-write boundary, retain transport/session resources and wait without a claimed upper bound until rollback/postimage verification/receipt persistence reaches a terminal result;
7. close the MCP server/transport and idle project resources exactly once after safe drain;
8. exit zero only after complete cleanup.

Repeated or concurrent shutdown triggers MUST share one completion promise.

### MCP-PROD-103 Process-boundary verification

Child-process tests MUST prove clean stdin shutdown, signal shutdown, active read drain, queued-request rejection, non-critical grace expiry, completion-critical apply preservation and canary SQLite close/reopen. Tests MUST fail on orphaned handles after successful graceful shutdown. Completion-critical tests MUST use a finite injected release and assert resources are not closed before release; they MUST NOT claim a universal bound for a genuinely stalled post-write apply.

## Public error contract

### MCP-PROD-201 Stable classification

All tool callback failures MUST map to this closed public code vocabulary:

- `INVALID_INPUT`;
- `PROJECT_NOT_FOUND`;
- `PROJECT_CAPACITY_EXCEEDED`;
- `PROJECT_QUEUE_FULL`;
- `QUEUE_WAIT_TIMEOUT`;
- `REQUEST_CANCELLED`;
- `OPERATION_DEADLINE_EXCEEDED`;
- `SERVER_SHUTTING_DOWN`;
- `NOT_FOUND`;
- `AMBIGUOUS_TARGET`;
- `STALE_WORKSPACE`;
- `MUTATION_BLOCKED`;
- `CONFLICT`;
- `INTERNAL_ERROR`.

Unknown errors MUST become `INTERNAL_ERROR`, never raw internal text.

Adding a public code requires a documented protocol change and direct tests; arbitrary internal error codes MUST NOT pass through.

### MCP-PROD-202 Bounded sanitized response

Public errors MUST use exactly one MCP text content item whose UTF-8 text is canonical compact JSON shaped as `{ "error": { "code": PublicErrorCode, "message": string, "correlation_id": string } }`, together with `isError: true` and no successful `structuredContent`. The complete JSON text MUST be at most 4096 UTF-8 bytes; the sanitized message budget MUST be at most 2048 UTF-8 bytes; the correlation ID MUST be a lowercase canonical UUID. They MUST NOT expose absolute/UNC/drive-relative paths, traversal targets, credentials, tokens, connection strings, environment values, source bodies, raw stack traces or cache paths. Sanitization MUST be idempotent.

### MCP-PROD-203 Correlated stderr evidence

Each tool failure MUST emit exactly one compact JSON stderr line of at most 8192 UTF-8 bytes with event version, the same correlation ID, tool name, public code and safe opaque project identity when available. stdout MUST remain MCP-only. Logs MUST redact credentials and MUST NOT include source bodies, raw arguments, stack traces or raw environment values. There is no raw-error/debug bypass in this release.

### MCP-PROD-204 Protocol compatibility

The error representation MUST be exercised through in-memory MCP, stdio and packed-consumer flows. Successful tool output schemas MUST remain unchanged. Hostile schema-validation requests MUST prove that SDK failures raised before a callback do not echo input values, paths or secrets. If the installed SDK cannot satisfy that test, the server MUST install a lower-level sanitized call-tool boundary or block release; documenting a leak is not acceptance.

## Observability

### MCP-PROD-301 Runtime status

`operation_queue` MUST preserve the existing `state`, `active_operations` and `queued_operations` fields and add exactly:

- `admission`: `open | closed`;
- `queue_capacity`: integer `1..256`;
- `rejected_operations`: integer `0..2_147_483_647`;
- `cancelled_operations`: integer `0..2_147_483_647`;
- `queue_timeout_operations`: integer `0..2_147_483_647`;
- `deadline_exceeded_operations`: integer `0..2_147_483_647`;
- `last_outcome`: `none | succeeded | failed | rejected | cancelled | queue_timeout | deadline_exceeded | internal_error`;
- `max_queue_wait_ms`: integer `0..86_400_000`;
- `max_execution_ms`: integer `0..86_400_000`.

`state` remains `idle | queued | running`; `active_operations` is clamped to `0..1`; `queued_operations` is clamped to `0..queue_capacity`. Counters and maxima are cumulative per project session, initialize at zero/`none`, and reset only when that session is closed/recreated or the process restarts. Counters saturate at `2_147_483_647`; durations saturate at `86_400_000`. Projection derives `state` from normalized active/queued counts. Invalid/non-integer/negative values normalize to zero, over-limit values clamp to their ceiling, invalid capacity uses the configured/default policy capacity, invalid admission becomes `closed`, and invalid outcome becomes `internal_error`. Existing fields are never removed or reinterpreted. Runtime telemetry MUST NOT affect compiler freshness or mutation authority.

### MCP-PROD-302 Measurement integrity

The ephemeral raw canary report MUST record the exact command with each option at most once. The checked report MUST replace path-bearing arguments with canonical aliases, include the SHA-256 of the exact raw bytes and retain every non-path argument. Both reports MUST record commit, exact worktree tree, harness/workload byte digests, package version, OS, selected Node runtime, project identity alias, iterations, the complete unfiltered source-file inventory count, preregistered call count/ordered IDs, raw latencies, RSS, cache size, hit/miss/rebuild/fallback/cancellation counts and the complete preregistered gate set. They MUST distinguish local process measurements from provider latency, universal SLA or model-quality claims.

The harness MUST preregister `AST_OPERATION_DEADLINE_MS=300000` for every canary child and use a `330000 ms` MCP request timeout so a bounded server deadline remains authoritative and observable before the client transport timeout. These harness-owned values MUST NOT change the product runtime default of `120000 ms`.

## Canary and rollback

### MCP-PROD-401 Disabled-default control

Every production-readiness test and public-consumer smoke MUST prove that absent policy uses memory and creates no cache root/file.

### MCP-PROD-402 Explicit read-only canary

The real-project canary MUST require both `AST_SYMBOL_INDEX_PERSISTENCE=canary` and an explicit isolated cache root. Its default workload MUST be read-only and MUST capture the target repository git status before and after. Any mutation workflow MUST use a disposable fixture, never the real repository.

### MCP-PROD-403 Compiler parity and restart

Canary workloads have two disjoint classes:

1. immutable real-repository workloads run against `ast-mcp-server` and `x-scraper`, compare indexed search/explore evidence with canonical compiler evidence, exercise absent-policy/canary cold/warm/restart reads plus read-only policy rollback, and require both byte-identical pre/post `git status --porcelain=v1 -z` and an identical exact worktree tree; they MUST NOT change source or config;
2. disposable generated/copied fixture workloads exercise one-file change, config invalidation, corruption fallback, a separately injected non-corruption SQLite write failure with compiler fallback, queue saturation, cancellation and mutation rollback to byte-exact originals, then delete the fixture.

No digest or cache hit is a completeness proof. A real-repository canary PASS requires the exact preregistered ordered call sequence and canonical compiler-result hash equality for every cold/restart call and the selected warm measurement call, together with `backend=sqlite`, ready state, accepted/loaded/reused evidence and zero unexpected fallback, corruption and write-failure increments. Every unchanged restart MUST satisfy the same conjunction. The corruption fixture MUST return a complete canonical result byte-equal to an independently executed disabled-policy compiler baseline for the same fixture state, record equal baseline/result hashes, increment fallback/corruption counters and recover explicitly. A separate non-corruption write-failure fixture MUST prove the same complete-result equality against its own disabled-policy compiler baseline, record equal hashes, increment fallback/write-failure counters and recover explicitly.

### MCP-PROD-404 Promotion gate

`enabled` MUST remain fail-closed in this SDD. Canary success authorizes release of the canary capability, not global/default activation. Any semantic mismatch, mutation-boundary effect, unrecovered fallback or secret/path disclosure MUST fail the gate.

The deterministic fixture resource gate MUST launch Node with `--expose-gc` and run 10 warm-up plus 50 measured identical read iterations in one process. It MUST invoke `global.gc()` exactly once immediately before every measured RSS sample. The median RSS of the final five iterations MUST be no more than `max(32 MiB, 20%)` above the median of the first five measured iterations, and immutable-cache bytes after the final restart MUST be no more than `max(1 MiB, 5%)` above the first complete-build bytes. Real-repository RSS and latency are observational only and MUST NOT determine PASS/FAIL in this release.

`immutable-cache bytes` means the recursive sum of `lstat.size` for every regular file under the isolated cache root without following symlinks, including SQLite main, WAL, SHM, quarantine and temporary files. A symlink, unreadable entry or non-regular file fails the gate. Measurements occur only after the canary child exits cleanly and store flush/close completes: once after the first complete build and once after the third unchanged restart. The same sorted relative-file manifest and per-file bytes MUST be included in the report.

### MCP-PROD-405 Runtime identity and durable reports

`AST_NODE_22_BIN` and `AST_NODE_24_BIN` are the only runtime-binary variables for release/canary evidence. The canary runner MUST receive one via `--node-bin`, resolve both paths physically and require equality, execute that exact resolved binary, require exactly `v22.5.0` for the floor run or `^v24\.` for the Node 24 run, use it for every server/fixture/resource child, and record the full observed version and binary digest. Node 22.5 subprocesses MUST receive `--experimental-sqlite`; filenames/labels cannot establish runtime identity. When `--candidate-tree` is supplied, the runner MUST compare it with the exact current package worktree tree before and after the run.

Every measurement MUST first write its bounded ephemeral raw report as a new direct child of the literal physical `/tmp` tree independent of `TMPDIR` and complete the byte-exact pre/post repository-status and exact-worktree-tree comparison. All four raw reports MUST be generated from the same clean committed Task 5.1 package tree before any checked evidence becomes visible. Raw and checked report reads/writes MUST pin the opened regular file or destination directory through a file descriptor before the final containment check and exclusive write so path/symlink replacement cannot redirect evidence.

The only freeze surface is one closed `freeze-report-set` transition; a standalone one-report freezer, callback-driven publication orchestrator or one-report checked transformation MUST NOT be exposed through the CLI, module API or declarations. Validation-only test seams return no checked representation and cannot orchestrate or publish. The set command requires exactly four unique, non-aliased regular raw inputs, each a direct physical child of `/tmp`, plus one canonical absolute `--x-scraper-root` authority that both `[x-scraper]` raw commands MUST physically match; it rejects missing, duplicate, hard-linked, symbolic, nested or unknown inputs and a missing, non-canonical or mismatched project root. Before publication it MUST pin and read all four members, validate every closed schema/gate/canonical byte bound/path/secret rule, recompute live OS/runtime/workload/harness/project/package Git identity for every member, require one member for each preregistered alias/runtime/destination, require the two runtime members for each alias to share one project/workload cohort, and require the same clean package commit, HEAD tree, worktree tree, byte-exact status and harness digest across the set. Runtime queue evidence MUST enforce the exact MCP-PROD-301 enums, ranges, count/state relations and capacity relation; every retained runtime gate MUST be recomputed from the retained outcomes, queue snapshot and cache-existence evidence rather than trusted as an asserted boolean. The checked destinations are fixed as:

- `benchmark/results/production-readiness/ast-mcp-server-node22.5.json`;
- `benchmark/results/production-readiness/ast-mcp-server-node24.json`;
- `benchmark/results/production-readiness/x-scraper-node22.5.json`;
- `benchmark/results/production-readiness/x-scraper-node24.json`.

After every member is prepared, the freezer MUST revalidate the complete live four-member set and the clean package identity before staging, acquire and pin an exclusive process-owned sibling lock, require the final `production-readiness` directory to be absent, and stage exactly the four fixed canonical regular files in a process-owned sibling directory. Immediately before publication it MUST recheck live package commit/tree/status plus the harness, both runtime binaries and every external project root/tree/status, then reverify the exact staged bytes through the pinned descriptor and require the source name to identify that same pinned staging-directory inode. On supported Linux it MUST publish the complete fixed directory through GNU coreutils `mv --update=none-fail --no-copy --no-target-directory`, which provides one no-replace sibling-directory rename without overwrite, merge or collision-as-success. The freezer MUST await definitive child termination; it MUST NOT return an ambiguous timeout failure while the move child can still rename. A successful move, including an error-channel outcome proven to have moved the pinned inode to the fixed final name, is the commit point: all planned fallible validation, byte verification and return preparation MUST precede it, and best-effort owned lock/descriptor cleanup after it MUST NOT convert committed publication into failure. Missing/invalid input, validation failure, staging/write failure, a competing lock, an existing/appearing final directory or a failed final identity recheck before the commit point MUST publish zero final files and clean only its owned staging/lock paths. Cleanup MUST locate the pinned owned stage and lock inodes under the pinned parent, remove those owned objects after displacement, and preserve replacements at their original pathnames.

Checked reports MUST use repository aliases, contain no absolute runtime/project/cache paths, and include SHA-256 digests in final verification. Raw reports are ephemeral and MAY contain the exact path-bearing argv only; they MUST NOT contain credentials. The freeze step occurs after repository immutability has been proven, so its intentional checked-report write is not part of the measured repository status interval. Later reruns write to `/tmp` and validate gates without replacing frozen checked evidence unless the reports are intentionally regenerated, recommitted and all downstream gates rerun.

## Platform and security policy

### MCP-PROD-501 Supported platform truth

v0.7.0 MUST explicitly support Linux x64 with GNU coreutils `mv` supporting `--update=none-fail` only unless equivalent architecture, filesystem, process, MCP/CLI/package and mutation tests pass on another target. Unverified architectures/platforms MUST be labeled unverified, not silently supported. Node 22.5 and the current Node 24 line remain mandatory on the supported target.

### MCP-PROD-502 Trust boundary

Documentation MUST state that local stdio clients run with the invoking user's filesystem permissions and may request any accessible `project_root`. Freezer coordination assumes cooperating same-UID processes; it does not defend checked files against a malicious process with the same filesystem authority. The report-set rename guarantees atomic visibility, not persistence across sudden power loss because directory `fsync` durability is not established. Remote/untrusted/multi-tenant use is unsupported. No HTTP/auth/sandbox feature may be implied by this release.

### MCP-PROD-503 Security process

The repository MUST provide a bounded vulnerability-reporting policy, supported-version policy and no-secret disclosure guidance. Dependency/security automation MUST run read-only with least permissions. Third-party actions used for release MUST be pinned to reviewed immutable revisions.

## Release closure

### MCP-PROD-601 Documentation consistency

Active OpenSpecs, README, ADR supersession notes, package engines, tool count, support policy and changelog MUST describe the same current product. Historical artifacts may retain old evidence only when clearly archived and dated.

### MCP-PROD-602 Version and artifact

The production-readiness release MUST use a new semantic version; the proposed target is `0.7.0`. Version bump occurs only after implementation and local gates pass. Pack inspection MUST prove required runtime, skill, docs and entrypoints are present and no cache/database/secret/local path artifact is included.

### MCP-PROD-603 Final-SHA CI

Source push, remote CI, registry publish, tag and hosted release are separate transitions. Publication MUST be blocked until CI passes on the exact release SHA under Node 22.5 and Node 24 with immutable install, format, lint, typecheck, full tests, build, MCP/CLI/package smokes, audit and pack. Before any repository checkout or repository-supplied validator executes, the release workflow MUST require `github.ref == refs/heads/main` and the requested SHA to equal the immutable workflow-run `github.sha`; every later checkout MUST use that trusted `github.sha`, never the raw dispatch input. Any privileged release job MUST additionally cross a GitHub Environment whose deployment branch policy is restricted to `main`.

### MCP-PROD-604 Provenance and registry readback

Publication MUST use the official npm registry and provenance/trusted publishing. The exact version is published once under dist-tag `next` from an explicitly authorized workflow bound to the exact CI-passed SHA. The `publish-next` job MUST use the protected `npm-publish` Environment, and npm's trusted-publisher configuration MUST bind to that exact Environment name. The release workflow MUST provide idempotent `publish-next`, `verify-next` and `promote-latest` modes.

`publish-next` queries the exact version first. If absent, it publishes once. On any ambiguous publish result it queries again: absent is retryable only through a new explicit dispatch; present with mismatched `gitHead` is a hard security failure; present with matching `gitHead` transitions to `verify-next` without republishing.

`verify-next` never publishes. It reconstructs bounded evidence from the official registry and MUST assert exact version, `gitHead == release SHA`, `next == version`, a non-empty `dist.integrity`, an official-registry `dist.tarball`, a non-empty `dist.attestations.url`, provenance predicate type `https://slsa.dev/provenance/v1`, successful tarball integrity verification, and successful `npm audit signatures --json --registry=https://registry.npmjs.org` in the clean registry consumer. It then runs the public-consumer smoke and stores a SHA/version-keyed evidence artifact with hashes of metadata, audit output and consumer report.

`promote-latest` MUST require the exact successful `verify-next` evidence artifact/run ID and separate production authorization, re-read registry state, and refuse mismatched SHA/version/integrity. A transient unchanged verification may rerun. A deterministic package/consumer failure or any verifier/source change abandons the immutable version under `next`; the version MUST NOT reach `latest`, and recovery is a new patch release. The annotated Git tag and hosted release are created only after `latest` readback.

Trusted publishing MUST authorize only the initial `npm publish --tag next`. Initial publication MUST split into three ordered capability phases: OIDC-scrubbed GitHub/CI authorization with only `GITHUB_TOKEN`, credential-free build and real pack that binds a closed authorization record to exact physical tarball bytes whose packed manifest embeds the release SHA as `gitHead`, and OIDC-only publication of that tarball with lifecycle scripts disabled. Because npm's trusted-publisher action set does not authorize dist-tag changes, `promote-latest` MUST obtain a least-privilege granular npm token only from the separately protected `production` Environment, expose it only to the dist-tag step as `NODE_AUTH_TOKEN`, and fail closed when it is absent. GitHub run/artifact validation MUST execute separately with only `GITHUB_TOKEN`, bind a local authorization record to the numeric artifact ID and verification-evidence hash, and leave no step with both credentials. Both `npm-publish` and `production` MUST restrict deployment branches to `main`. Release automation MUST NOT read or write repository/home npm credential files, place a token in command arguments, or expose the promotion secret to another mode. It MUST reject ambient npm/Yarn/Corepack authentication or configuration aliases, including every unexpected `COREPACK_*` control, require the runner-temporary setup-node userconfig to contain only the reviewed official-registry placeholder configuration, and construct each npm child environment from an explicit allowlist; OIDC variables are admitted only to the trusted-publish subprocess and `NODE_AUTH_TOKEN` only to the dist-tag subprocess. The no-dependency environment/userconfig boundary MUST run immediately after setup-node and before Corepack or Yarn can execute or access the network. Corepack and dependency installation MUST execute from an empty environment rebuilt with only reviewed system paths/directories and CI markers, excluding OIDC, credential, runner-command and package-manager control variables; release dependency installation MUST disable lifecycle builds/scripts.

### MCP-PROD-605 Public-consumer proof

A clean consumer outside the source tree MUST install the exact registry version with lifecycle scripts disabled and verify:

- package metadata/engines/version;
- stdio handshake and all 15 tool names;
- representative JSON/TOON reads;
- disabled-default no-cache behavior;
- explicit canary on a disposable fixture where supported;
- rename, body replacement and scaffold prepare/preview/apply/replay, with byte snapshots proving prepare, preview and rejected mismatched-hash apply cannot modify any affected file before authorized apply, preview diffs reconstructing independently specified exact postimages, and authorized apply/replay matching those bytes with receipts bound to the prepared operation and expected files;
- stale/conflict fail-closed behavior;
- bundled integration setup idempotency;
- consumer audit.

A local tarball smoke does not satisfy this registry gate.

### MCP-PROD-606 External authorization

The implementation agent MUST NOT push, publish, tag or create a hosted release without explicit operator authorization for those external transitions. Missing authorization leaves the release candidate pending and MUST be reported truthfully.

### MCP-PROD-607 Exact-tree local closure

The final matrix runner/test/package-script slice MUST be committed before final SDD evidence is authored. `verification.md` then receives preliminary exact-tree evidence and Review A while the change remains active. After Review A PASS, the six SDD artifacts MUST move unchanged to the archive and be staged as an exact manifest. The staged candidate tree hash from `git write-tree` is the authority for post-archive local gates and Review B. No tracked, staged or untracked file may change during those gates or after Review B.

The archive commit MUST contain only the five tracked SDD renames plus the new archived `verification.md`. After commit, `HEAD^{tree}` MUST equal the reviewed staged candidate tree and the working tree/index MUST be clean. `RELEASE_SHA` MUST NOT be computed before those assertions pass. Committing staged bytes does not invalidate evidence; any byte change before or after commit does.

## Preserved invariants

### MCP-PROD-701 Compiler authority

The active TypeScript compiler/project remains the sole semantic authority. Runtime scheduling, logs, metrics, cancellation and SQLite cannot authorize or broaden a read/mutation result.

### MCP-PROD-702 Mutation protocol

`prepare -> review -> apply`, plan hashes, workspace/config/source fingerprints, diagnostic blocking, per-file atomic replacement, conservative rollback and receipt replay remain intact.

### MCP-PROD-703 Persistence policy

`disabled`/memory remains default and immediate rollback. `canary` remains explicit. `enabled` remains reserved with `enabled_not_released`.
