# Tasks: local MCP production readiness

Implementation is phase-gated. Each slice follows RED -> GREEN -> VERIFY -> documentation -> exact staged manifest -> Conventional Commit. No push, publish, tag or hosted release occurs without explicit operator authorization.

## 0. SDD and historical closure

Execution order is fixed: Task 0.1 -> Task 0.2 -> Task 0.3. Each task owns one separate Conventional Commit and its exact manifest. No later task may be staged with an earlier one.

### Task 0.1: Open and review the production-readiness SDD

Status: review-gated. The task completes when a read-only auditor returns PASS for the exact SHA-256 hashes of all five files; do not edit only to restate that verdict.

Files:

- Create: `openspec/changes/2026-08-07-local-mcp-production-readiness/exploration.md`.
- Create: `openspec/changes/2026-08-07-local-mcp-production-readiness/proposal.md`.
- Create: `openspec/changes/2026-08-07-local-mcp-production-readiness/spec.md`.
- Create: `openspec/changes/2026-08-07-local-mcp-production-readiness/design.md`.
- Create: `openspec/changes/2026-08-07-local-mcp-production-readiness/tasks.md`.

Run `yarn prettier --check openspec/changes/2026-08-07-local-mcp-production-readiness/*.md`, `git diff --check` and `sha256sum openspec/changes/2026-08-07-local-mcp-production-readiness/*.md`; obtain read-only PASS for those hashes. Then run `git add -- openspec/changes/2026-08-07-local-mcp-production-readiness/exploration.md openspec/changes/2026-08-07-local-mcp-production-readiness/proposal.md openspec/changes/2026-08-07-local-mcp-production-readiness/spec.md openspec/changes/2026-08-07-local-mcp-production-readiness/design.md openspec/changes/2026-08-07-local-mcp-production-readiness/tasks.md`, `git diff --cached --check`, and commit `docs(sdd): open local MCP production readiness`. No runtime or historical-closure file belongs to this commit.

### Task 0.2: Record the lasting runtime decision

Status: complete.

Files:

- Create: `docs/adr/0010-local-stdio-runtime-governance.md`.

Record local stdio/Linux support, in-process bounded scheduling versus worker isolation, cooperative cancellation, completion-critical shutdown, the frozen public error/status contracts, `next -> verify-next -> latest` release recovery and rollback/evolution. Run `yarn prettier --check docs/adr/0010-local-stdio-runtime-governance.md` and `git diff --check`; obtain a read-only ADR delta review, stage only that file, run `git diff --cached --check`, and commit `docs(adr): record local stdio runtime governance`.

Evidence: commit `f6079a814608a3554e23e0194ef66c75d1dd12c6` created only `docs/adr/0010-local-stdio-runtime-governance.md` with the required conventional subject.

### Task 0.3: Archive superseded persistence evidence

Status: complete.

Files:

- Modify then move: `openspec/changes/2026-08-06-symbol-index-persistence-evidence/tasks.md`.
- Modify then move: `openspec/changes/2026-08-06-symbol-index-persistence-evidence/verification.md`.
- Move unchanged: `exploration.md`, `proposal.md`, `spec.md`, `design.md` from `openspec/changes/2026-08-06-symbol-index-persistence-evidence/`.
- Destination: `openspec/archive/2026-08-06-symbol-index-persistence-evidence/`.

Record that ADR 0009 and `openspec/archive/2026-08-07-symbol-index-persistence-integration/` supersede the earlier provisional memory-only conclusion while preserving it as dated evidence. The exact destination manifest is `design.md`, `exploration.md`, `proposal.md`, `spec.md`, `tasks.md`, `verification.md`.

After edits, run `mkdir -p openspec/archive && mv openspec/changes/2026-08-06-symbol-index-persistence-evidence openspec/archive/2026-08-06-symbol-index-persistence-evidence` exactly once. Then run `for file in design.md exploration.md proposal.md spec.md tasks.md verification.md; do test -f "openspec/archive/2026-08-06-symbol-index-persistence-evidence/$file" || exit 1; done`, `test ! -e openspec/changes/2026-08-06-symbol-index-persistence-evidence`, `yarn prettier --check openspec/archive/2026-08-06-symbol-index-persistence-evidence/*.md` and `git diff --check`. Obtain a read-only archive delta review. Stage only the six renames/modifications with `git add -A -- openspec/changes/2026-08-06-symbol-index-persistence-evidence openspec/archive/2026-08-06-symbol-index-persistence-evidence`, run `git diff --cached --check`, and commit `docs(sdd): archive symbol index persistence evidence`.

Evidence: commit `ff95c01a5f79fd9cdeb38abd74235304b80dd744` moved the complete six-file change to `openspec/archive/2026-08-06-symbol-index-persistence-evidence/`. Its actual conventional subject is `docs(sdd): archive persistence evidence`, a documented variance from the task's planned `docs(sdd): archive symbol index persistence evidence` subject; history is not rewritten for that cosmetic difference.

## 1. Runtime policy and strict session capacity

### Task 1.1: RED/GREEN pure runtime policy

Status: complete.

Files:

- Create: `src/services/runtime-policy.ts`.
- Create: `test/runtime-policy.test.ts`.

Steps:

1. Write failing tests for `AST_MAX_PROJECT_SESSIONS`, `AST_MAX_QUEUED_OPERATIONS_PER_PROJECT`, `AST_QUEUE_WAIT_TIMEOUT_MS`, `AST_OPERATION_DEADLINE_MS`, `AST_SHUTDOWN_DRAIN_TIMEOUT_MS`, their defaults/valid bounds and invalid/NaN/overflow fallback.
2. Run `yarn test test/runtime-policy.test.ts`; confirm RED from missing implementation.
3. Implement the pure parser with no process/global reads in the core function.
4. Run `yarn test test/runtime-policy.test.ts && yarn prettier --check src/services/runtime-policy.ts test/runtime-policy.test.ts && yarn eslint src/services/runtime-policy.ts test/runtime-policy.test.ts && yarn typecheck`.

Evidence:

- RED: `yarn test test/runtime-policy.test.ts` failed because `src/services/runtime-policy.ts` did not exist.
- GREEN/VERIFY: 20/20 focused assertions passed; touched-file Prettier and ESLint plus repository typecheck passed.

### Task 1.2: RED/GREEN strict session registry

Status: complete.

Files:

- Modify: `src/services/project.ts`.
- Test: `test/project.test.ts`.

Prove idle LRU eviction, all-busy rejection before compiler/watcher/cache construction, exact max count, same-project dedupe, safe rejection and cleanup. Add test hooks only through bounded internal APIs; do not export mutable production maps.

Run `yarn test test/runtime-policy.test.ts test/project.test.ts test/project-watcher.test.ts test/project-status.test.ts test/symbol-index-policy.test.ts test/symbol-index-sqlite.test.ts`.

Evidence:

- RED: three new project-session tests failed against the soft-cap implementation because the bounded registry snapshot and strict admission contract did not exist.
- GREEN: 131/131 assertions passed across the exact six-file focused command.
- The all-busy fixture contains an invalid `tsconfig.json`; receiving `PROJECT_CAPACITY_EXCEEDED` proves rejection precedes compiler/config, watcher and cache construction.

### Task 1.3: Verify and commit strict capacity

Status: complete.

Run:

- `yarn format:check`;
- `yarn lint`;
- `yarn typecheck`;
- `yarn test test/runtime-policy.test.ts test/project.test.ts test/project-watcher.test.ts test/project-status.test.ts test/symbol-index-policy.test.ts test/symbol-index-sqlite.test.ts`;
- `yarn build`;
- `git diff --check`.

Update requirement traceability in this task file and commit `feat(runtime): enforce project session capacity`.

Evidence:

- `yarn format:check`, `yarn lint`, `yarn typecheck`, the 131/131 focused matrix, `yarn build` and `git diff --check` passed on the post-documentation tree.

## 2. Bounded project operation scheduler

### Task 2.1: RED scheduler state machine

Status: complete.

Files:

- Create: `src/services/project-operation-scheduler.ts`.
- Create: `test/project-operation-scheduler.test.ts`.

Test FIFO, cap-before-retention, overflow, queued cancellation, queue timeout, cooperative deadline, callback failure, listener/timer cleanup, saturating counters and shutdown admission closure. Use fake monotonic time where practical; do not create flaky wall-clock sleeps.

Evidence:

- RED: `yarn test test/project-operation-scheduler.test.ts` failed because the scheduler module did not exist.
- GREEN: 10/10 deterministic tests passed, including 50 repeated O(1) queued cancellations with zero retained nodes/listeners/timers.
- Touched-file Prettier and ESLint, repository typecheck and `git diff --check` passed.

### Task 2.2: Integrate scheduler with project sessions

Status: complete.

Files:

- Modify: `src/services/project.ts`.
- Modify: `src/tools/get_project_status.ts`.
- Test: `test/project.test.ts`, `test/project-status.test.ts`, `test/mcp.integration.test.ts`.

Replace the raw promise-chain counters with the scheduler while preserving one serialized compiler operation per project. Fix the exact public status schema through RED tests before implementation. Keep telemetry independent from freshness.

Evidence:

- `ProjectOperationScheduler` owns one active operation plus the bounded waiting queue for each canonical project session; session capacity treats admitted work as active and never evicts it.
- The runtime-status projection and MCP schema expose the exact bounded queue vocabulary without using telemetry as compiler freshness evidence.
- `test/project.test.ts`, `test/project-status.test.ts` and `test/mcp.integration.test.ts` cover serialized execution, queue capacity, active-session retention and the protocol projection.
- A final exact-file read-only review of `src/services/project-status.ts` and `test/project-status.test.ts` returned `PASS` with no critical, important or minor issues before the cancellation integration expanded the candidate.

### Task 2.3: Propagate MCP cancellation

Status: complete.

Files:

- Create: `src/services/request-context.ts`.
- Modify: `src/tools/apply_operation.ts`, `src/tools/explore.ts`, `src/tools/find_references.ts`, `src/tools/get_diagnostics.ts`, `src/tools/get_file.ts`, `src/tools/get_impact.ts`, `src/tools/get_operation_preview.ts`, `src/tools/get_outline.ts`, `src/tools/get_project_status.ts`, `src/tools/get_symbol_source.ts`, `src/tools/list_files.ts`, `src/tools/rename_symbol.ts`, `src/tools/replace_symbol_body.ts`, `src/tools/scaffold_class.ts`, `src/tools/search_symbols.ts`.
- Modify: `src/services/project.ts`, `src/services/context-builder.ts`, `src/services/operations.ts`, `src/services/symbols.ts`, `src/services/impact.ts`, `src/services/relationships.ts`, `src/services/references.ts`, `src/services/file-snapshot.ts`, `src/services/outline.ts`, `src/services/diagnostics.ts`.
- Test: `test/mcp.integration.test.ts`, `test/operations.test.ts`, `test/context-builder.test.ts`, `test/symbols.test.ts`, `test/impact.test.ts`, `test/relationships.test.ts`, `test/file-snapshot.test.ts`, `test/outline.test.ts`, `test/diagnostics.test.ts`, `test/explore.test.ts`.

Use the SDK callback `extra.signal`. Add checkpoints from the design. Prove queued cancellation does no sync work, active read cancellation stops at a checkpoint, prepare retains no operation and successful uncancelled contracts remain unchanged.

Evidence:

- All 15 tool callbacks adapt `extra.signal` through the SDK-independent `RequestContext`; services receive the scheduler-owned active context rather than importing MCP types.
- Checkpoints cover admission, queue wait, synchronization, index operations, relationships, tool traversal/serialization and prepared-operation retention.
- Queued cancellation is unlinked before synchronization/callback work, and the in-memory MCP test exercises cancellation through `Client.callTool(..., { signal })`.
- Running MCP apply cancellation is observed at the final pre-write checkpoint, returns cancellation, retains no plan/write side effect and drains the active session.
- Prepare/apply use the same bounded project scheduler without opening or refreshing the optional persistence backend; the existing mutation-persistence isolation regression remains green.
- The production `ast_explore` query route propagates the scheduler context through outline, compiler search and indexed search. Cancellation that wins while an index query is pending bypasses failure reporting and leaves the SQLite session ready without incrementing fallback telemetry.

### Task 2.4: Protect apply completion-critical work

Status: complete.

Files:

- Modify: `src/services/operations.ts`.
- Modify: `src/tools/apply_operation.ts`.
- Test: `test/operations.test.ts`, `test/runtime-state.test.ts`, `test/mcp.integration.test.ts`, with the child-process shutdown boundary covered later by `scripts/mcp-lifecycle-smoke.mjs`.

Add explicit cancellation checks before lock/first replacement. Inject cancellation before and after the first write; prove pre-write cancellation writes nothing and post-write cancellation cannot skip rollback/postimage/receipt completion. Preserve replay and conflict behavior.

Evidence:

- Apply checkpoints before lock acquisition, while staging and immediately after the final pre-write test hook.
- The first `link`/`rename` transition enters completion-critical exactly once; later cancellation cannot interrupt remaining writes, rollback, postimage verification, directory sync or receipt persistence.
- Cancellation observed during completion-critical increments bounded telemetry without aborting the active signal, restoring the execution deadline or changing the successful terminal outcome.
- Post-apply invalidation runs only after the scheduler operation reaches its terminal result and only while the session is idle; a same-project operation already promoted by the scheduler retains ownership of the session.
- Cross-session write-lock waiters release their queue node from `finally` even when cancellation is observed immediately after the prior owner releases, so later retries cannot remain behind an unresolved promise.
- Direct tests prove zero writes on pre-write cancellation, a deterministic applied result plus cancellation telemetry after cancellation immediately following the first source write, and continued execution of queued same-project work; the full mutation suite preserves rollback, conflict, recovery and idempotent replay behavior.

### Task 2.5: Verify and commit scheduler/cancellation

Status: complete.

Run:

- `yarn test test/project-operation-scheduler.test.ts test/runtime-policy.test.ts test/project.test.ts test/project-status.test.ts test/mcp.integration.test.ts test/operations.test.ts test/runtime-state.test.ts test/context-builder.test.ts test/explore.test.ts test/symbols.test.ts`;
- `yarn format:check`;
- `yarn lint`;
- `yarn typecheck`;
- `yarn test`;
- `yarn build`;
- `yarn test:mcp`;
- `yarn test:cli`;
- `git diff --check`.

Commit `feat(runtime): bound and cancel project operations` only after exact-tree review.

Evidence:

- The prior 35-file candidate at staged tree `a0f287bdde63ba7238ed8f7dea488b3795802044` received two exact-tree `REQUEST_CHANGES` verdicts and was not committed.
- The later 36-file candidate at staged tree `53dd1acf45d621c5674cde4d634a6940075c73e1` was not committed: its spec review returned `REQUEST_CHANGES` because `ast_explore` dropped the active context in query/index traversal. The parallel quality review timed out after reproducing a cancelled cross-session write-lock waiter that retained an unresolved queue promise.
- The repaired scheduler enforces queue and execution deadlines from monotonic checkpoints even before timer delivery; prepares remove plans canceled after retention; operation previews run through the project scheduler; cooperative cancellation/deadline errors bypass index/reference fallback catches; `ast_explore` threads the active context through query traversal; and cancelled write-lock waiters release later retries.
- Focused matrix on 2026-08-07 with Node.js `v24.16.0` and Yarn `4.15.0`: 10 files, 171/171 tests passed.
- Full regression: 35 files, 328/328 tests passed.
- `yarn format:check`, `yarn lint`, `yarn typecheck`, `yarn build` and `git diff --check` passed.
- `yarn test:mcp` passed over real stdio with 15 tools and TOON output.
- `yarn test:cli` passed read composition, TOON output, persisted apply, lock contention, replay, skill installation and agent setup.
- The final 37-file staged tree `2777557da5c849e11d07bb265e8990c335ca6349` received independent exact-tree `PASS` verdicts for spec compliance and code quality/regressions. Commit `6b4eb840283d6c2287444ad6bd8b3501d7743f80` (`feat(runtime): bound and cancel project operations`) preserves that exact tree, and the post-commit working tree was clean.

## 3. Public error boundary

### Task 3.1: RED public error classification and redaction

Status: complete.

Files:

- Create: `src/services/public-errors.ts`.
- Modify: `src/tools/result.ts`.
- Modify: `src/services/project-status.ts` to import the canonical sanitizer from `src/services/public-errors.ts` without coupling status and protocol DTOs.
- Test: `test/public-errors.test.ts`, `test/result-format.test.ts`, `test/project-status.test.ts`, `test/operations.test.ts`.

Test every required code, unknown-error fallback, UUID correlation shape, UTF-8 bounds, idempotence, POSIX/Windows/UNC/traversal paths, quoted/multiline paths, authorization schemes, tokens, URIs, source-like content and hostile thrown values.

Evidence:

- `src/services/public-errors.ts` owns the closed 14-code vocabulary, privately branded operational errors, allowlisted legacy class/code mappings, bounded anchored recognition of reachable domain failures, early active-proxy rejection, UUIDv4 correlation and fail-closed `INTERNAL_ERROR` fallback.
- The shared sanitizer bounds work before normalization, removes controls, redacts POSIX/Windows/UNC/traversal paths and credential-shaped values idempotently, and applies separate 2048-byte message and 4096-byte serialized-response budgets without splitting UTF-8 code points.
- `src/services/project-status.ts` now imports the canonical sensitive-text sanitizer instead of maintaining a divergent redactor and bounds hostile diagnostic input before running the shared regex pipeline while preserving truncation metadata.
- Classification, operation and status tests cover every public code, errors captured from actual conflict/block/expiry branches plus preview/path cases, typed/legacy/forged/unknown errors, revoked and active proxies without trap execution, accessors, Bearer/Basic/Digest/opaque authorization values, path and credential classes, pre-normalization status bounds, multibyte truncation, JSON-escape expansion and the frozen compact MCP envelope.

### Task 3.2: RED protocol compatibility spike

Status: complete.

Files:

- Test: `test/mcp.integration.test.ts`.
- Modify: `src/tools/result.ts` only after RED proves the chosen error envelope.

Exercise the frozen compact-JSON error envelope from tools with and without `outputSchema` through in-memory MCP. Keep success shapes unchanged. Send hostile pre-callback schema inputs containing paths/credentials; if the SDK echoes them, add a lower-level sanitized call-tool boundary and keep the task RED until fixed.

Evidence:

- In-memory MCP exercises a production tool with `outputSchema` and a fixture tool without one; both preserve exactly one compact JSON text item, `isError: true`, no `structuredContent` and the same `{ error: { code, message, correlation_id } }` shape.
- Existing JSON and TOON success assertions remain unchanged and green.
- The installed SDK rejected hostile schema-invalid arguments before callback without echoing their path or credential values. The compatibility spike therefore passed without a lower-level `tools/call` interception; no artificial protocol layer was added merely to manufacture a RED state.

### Task 3.3: Correlated structured stderr

Status: complete.

Files:

- Create: `src/services/runtime-logger.ts`.
- Modify: `src/tools/result.ts` and tool adapters to include tool identity.
- Test: `test/public-errors.test.ts`, `test/result-format.test.ts`, `test/mcp.integration.test.ts`, `scripts/public-error-smoke.mjs`.

Emit exactly one <=8192-byte compact JSON stderr event per tool failure. Assert stdout remains valid MCP only. Do not log raw args, source, environment or stack.

Evidence:

- `src/services/runtime-logger.ts` accepts only already-public fields, validates UUID/tool/digest shapes and emits one compact newline-terminated `tool_failure` event bounded to 8192 UTF-8 bytes.
- `src/tools/result.ts` reuses the response correlation ID, derives optional project identity through the canonical opaque digest helper and protects the MCP response from stderr sink failure. All 15 production adapters pass an explicit canonical tool identity.
- Unit and MCP integration assertions prove one event, matching correlation/code/message, valid opaque project identity, invalid-identity fail-closed behavior, no raw path/token and response survival when the stderr sink throws.
- Real stdio smoke captures piped stderr event-first with a timeout, sends hostile content through accepted `file_path`, correlates it with the MCP envelope and verifies protocol stdout remains valid. Embedded CLI smoke treats the tool event plus command failure as two intentional NDJSON stderr records.

### Task 3.4: Compile hostile probes and commit

Status: complete under the prospective-commit convention: this status applies only if the exact
reviewed staged tree is committed unchanged with the subject below.

Files:

- Create: `scripts/public-error-smoke.mjs`.
- Modify: `scripts/mcp-smoke.mjs`, `scripts/cli-smoke.mjs`, `scripts/package-smoke.mjs`, `package.json`, `yarn.lock`.

Register `test:errors` in `package.json`. Run:

- `yarn test test/public-errors.test.ts test/result-format.test.ts test/mcp.integration.test.ts`;
- `yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build`;
- `yarn test:errors && yarn test:mcp && yarn test:cli && yarn test:package`;
- `yarn audit && git diff --check`.

Commit `feat(protocol): sanitize and classify tool errors`.

Evidence:

- The compiled-artifact hostile smoke intercepts stderr and proves the 4096/8192-byte boundaries, generic unknown-error fallback, exact correlation and absence of path, stack, source, URI and credential sentinels.
- The stdio smoke reports 15 tools, successful TOON output, hostile-error containment and stderr correlation. The packed-tarball smoke invokes the installed MCP artifact and proves the same bounded error envelope and stderr correlation while preserving package/handshake, installation and setup contracts. CLI smoke preserves read, mutation, replay and NDJSON failure behavior.
- The audit-discovered `nanoid` advisory was remediated with the minimum compatible `3.3.17` resolution; immutable install succeeds and `yarn audit` reports no suggestions.
- The pre-documentation candidate reproduced `47/47` focused tests and `357/357` full tests plus format, lint, typecheck, build, hostile-error, MCP, CLI, package, immutable-install, audit and whitespace gates. Because this evidence block changes the tree, the same complete matrix is rerun afterward and bound externally to the staged tree; its exact-tree review verdict and resulting commit SHA are intentionally not backfilled into this candidate.

## 4. Idempotent process shutdown

### Task 4.1: RED shutdown coordinator

Status: complete.

Files:

- Create: `src/services/shutdown.ts`, `src/services/runtime-activity.ts`.
- Refactor: `src/index.ts` into a testable stdio startup function.
- Modify: `src/server.ts`, `src/services/project-operation-scheduler.ts`, `src/services/project.ts`.
- Test: `test/shutdown.test.ts`.

Test stop-admission ordering, shared promise, cancellation of queued/non-critical work, bounded graceful drain, non-critical timeout without close-under-use, completion-critical apply preservation, repeated triggers and cleanup-on-error.

Evidence:

- RED: `yarn test test/shutdown.test.ts` failed because `src/services/shutdown.ts` did not exist and also exposed that importing `src/index.ts` immediately started stdio instead of providing a side-effect-free startup seam.
- The project registry closes global admission before resolution, every live scheduler atomically closes admission, rejects queued work and cooperatively aborts active non-critical work, while completion-critical apply work remains un-aborted until its terminal result.
- One coordinator promise owns all triggers, applies the bounded grace only to non-critical work, emits one fixed-field incomplete event on forced shutdown, avoids closing in-use resources and attempts both MCP and project cleanup after a safe drain even when MCP close fails.
- Runtime callback plus transport-send tracking closes the scheduler-idle/protocol-response race. The idle transition is revalidated on the next event-loop turn, so `SERVER_SHUTTING_DOWN` envelopes are written before transport close rather than being lost after callback settlement.
- `test/shutdown.test.ts` passes `10/10`, covering admission ordering, queued/active cancellation, completion-critical preservation, project-idle callback grace expiry, shared promise, repeated triggers, cleanup-on-error, post-callback send drain and side-effect-free startup.

### Task 4.2: Child-process lifecycle matrix

Status: complete.

Files:

- Create: `scripts/mcp-lifecycle-smoke.mjs`.
- Modify: `package.json` with a stable smoke command.

Exercise stdin EOF, `SIGINT`, `SIGTERM`, active read drain, queued rejection, non-critical grace expiry, finite injected completion-critical apply and canary close/reopen. Use disposable fixtures/cache. Assert bounded exit only for clean/non-critical cases, no close-under-use for completion-critical apply, no protocol stdout corruption and no orphan process after successful graceful cleanup.

Evidence:

- `yarn test:lifecycle` builds the compiled artifact and runs disposable child processes over real JSON-RPC stdio for EOF, `SIGINT`, `SIGTERM`, active compiler-backed read cancellation, queued rejection and non-critical forced exit.
- The queued request receives the frozen `SERVER_SHUTTING_DOWN` MCP envelope before transport close; the forced non-critical child remains active before project-scheduler admission, exits `1`, emits exactly one `shutdown_incomplete` event and records no resource-close event.
- A real `ast_apply_operation` is paused by an IPC-controlled test hook after the first source replacement. The parent waits for one child acknowledgement per handled `SIGTERM` before sending the next, releases the critical apply only after two acknowledgements, then repeats the handshake during MCP close; event order proves completion-critical entry, controlled release and only then resource close, while the apply response remains `applied` and the source postimage is verified.
- A mixed child keeps unrelated non-critical callback activity stalled while an apply remains completion-critical past the initial grace. A coordinator acknowledgement gates critical release; the apply still returns `applied`, then the re-enabled finite grace produces one `shutdown_incomplete`, no resource close and exit `1` for the remaining non-critical work.
- Canary mode creates SQLite state in a disposable cache, exits gracefully, then a fresh child reopens the same cache and serves compiler-backed symbol search with `backend: sqlite`. Every graceful child exits naturally with code `0`, protocol stdout contains only valid JSON-RPC and the harness reports `orphan_processes: 0`.

### Task 4.3: Verify and commit lifecycle

Status: complete under the prospective-commit convention: this status applies only if the exact
reviewed staged tree is committed unchanged with the subject below.

Run `yarn test test/shutdown.test.ts test/project.test.ts test/operations.test.ts test/runtime-state.test.ts test/symbol-index-sqlite.test.ts`, then `yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build && yarn test:mcp && yarn test:lifecycle && yarn test:cli && yarn test:package && git diff --check`. Commit `feat(runtime): close stdio resources gracefully`.

Evidence:

- The pre-review candidate passes `93/93` focused lifecycle/project/mutation/runtime/SQLite tests and `380/380` full tests.
- `test:lifecycle` reports all nine lifecycle scenarios true, clean protocol stdout and zero orphan processes. Because this evidence block changes the tree, the same complete matrix is rerun afterward and bound externally to the staged tree; its exact-tree review verdict and resulting commit SHA are intentionally not backfilled into this candidate.

## 5. Canary, scale and support evidence

### Task 5.1: Deterministic canary contract

Status: pending.

Files:

- Create: `scripts/canary-local-mcp.mjs`.
- Create: `scripts/canary-local-mcp.d.mts`.
- Create: `test/canary-local-mcp.test.ts`.
- Create: `benchmark/canary-workloads/ast-mcp-server.json`.
- Create: `benchmark/canary-workloads/x-scraper.json`.
- Modify: `package.json`.
- Test: `test/canary-local-mcp.test.ts`.

Implement immutable real-repository absent-policy/canary/policy-rollback subprocess runs plus separate disposable corruption, non-corruption write-failure and mutation-failure fixtures. Add complete ordered compiler-result hash equality conjoined with SQLite ready/accepted/loaded/reused and zero unexpected fallback/corruption/write-failure evidence, restart, persistence fallback against independent disabled-policy compiler baselines and explicit recovery, byte-exact mutation rollback, queue/cancellation gates, complete unfiltered source-file counts, byte-exact pre/post Git status plus exact worktree-tree comparison and bounded raw/frozen schemas. Require `--node-bin` to physically equal the matching `AST_NODE_22_BIN`/`AST_NODE_24_BIN`, execute/validate it and use it for every child. For cache accounting, recursively `lstat` without following symlinks after graceful flush/close, fail on unreadable/symlink/non-regular entries, and report sorted relative file names plus bytes for main/WAL/SHM/quarantine/temp files. Raw evidence uses a new direct child of literal `/tmp`; raw/frozen I/O pins file/directory descriptors before physical-containment checks and exclusive writes. `freeze-report` rejects duplicate options and credentials in exact argv, revalidates live OS/runtime/workload/harness/tree identity, accepts only the four identity-bound checked destinations and records the exact raw SHA-256. Register `benchmark:production-readiness` in `package.json`.

After focused GREEN and the complete repository gate, commit only the harness, declarations, tests, workloads, SDD clarification and `package.json` as `test(canary): add deterministic production readiness harness`. Task 5.2 evidence MUST run from that clean commit; any later harness/workload edit invalidates all four reports.

### Task 5.2: Measure current repository

Status: pending.

Run:

- `yarn benchmark:production-readiness --node-bin "$AST_NODE_24_BIN" --expected-node 24 --project "$PWD" --workload benchmark/canary-workloads/ast-mcp-server.json --iterations 20 --restarts 3 --output /tmp/ast-mcp-server-node24.raw.json`;
- `node scripts/canary-local-mcp.mjs freeze-report --input /tmp/ast-mcp-server-node24.raw.json --output benchmark/results/production-readiness/ast-mcp-server-node24.json`;
- `yarn benchmark:production-readiness --node-bin "$AST_NODE_22_BIN" --expected-node 22.5.0 --node-option=--experimental-sqlite --project "$PWD" --workload benchmark/canary-workloads/ast-mcp-server.json --iterations 20 --restarts 3 --output /tmp/ast-mcp-server-node22.5.raw.json`;
- `node scripts/canary-local-mcp.mjs freeze-report --input /tmp/ast-mcp-server-node22.5.raw.json --output benchmark/results/production-readiness/ast-mcp-server-node22.5.json`.

Require `"$AST_NODE_22_BIN" --version` to equal `v22.5.0` and `"$AST_NODE_24_BIN" --version` to match `^v24\.` before either command. The runner starts the deterministic fixture with the selected binary plus `--expose-gc`, invokes `global.gc()` exactly once before each RSS sample, and executes 10 warm-up plus 50 measured reads. Real-repository latency/RSS remains observational.

### Task 5.3: Measure `x-scraper` read-only

Status: pending.

Set `AST_X_SCRAPER_ROOT` to the absolute `x-scraper` checkout and run:

- `yarn benchmark:production-readiness --node-bin "$AST_NODE_24_BIN" --expected-node 24 --project "$AST_X_SCRAPER_ROOT" --workload benchmark/canary-workloads/x-scraper.json --iterations 20 --restarts 3 --output /tmp/x-scraper-node24.raw.json`;
- `node scripts/canary-local-mcp.mjs freeze-report --input /tmp/x-scraper-node24.raw.json --output benchmark/results/production-readiness/x-scraper-node24.json`;
- `yarn benchmark:production-readiness --node-bin "$AST_NODE_22_BIN" --expected-node 22.5.0 --node-option=--experimental-sqlite --project "$AST_X_SCRAPER_ROOT" --workload benchmark/canary-workloads/x-scraper.json --iterations 20 --restarts 3 --output /tmp/x-scraper-node22.5.raw.json`;
- `node scripts/canary-local-mcp.mjs freeze-report --input /tmp/x-scraper-node22.5.raw.json --output benchmark/results/production-readiness/x-scraper-node22.5.json`.

Use isolated temporary cache roots. Capture byte-exact baseline/final git status inside the runner. Real `x-scraper` is read-only; all invalidation/failure cases remain in the generated fixture. Any source/config/status change invalidates the run. Reports replace the host path with `[x-scraper]`.

### Task 5.4: Define canary acceptance and support policy

Status: pending.

Files:

- Modify: `benchmark/README.md`.
- Modify: `README.md`.
- Create: `docs/support.md`.

Require zero semantic mismatches/mutation effects, successful rollback/fallback, bounded queue/session behavior and the preregistered fixture RSS/cache criteria from `MCP-PROD-404`. Record real-repository RSS/latency as observations only. Declare Linux supported; mark other platforms unverified unless equivalent gates are added.

### Task 5.5: Adversarial canary review and evidence commit

Status: pending.

Freeze reports/docs against the committed Task 5.1 harness. Run `yarn test test/canary-local-mcp.test.ts && yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build`, then the two exact Task 5.2 commands and two exact Task 5.3 commands. Run `sha256sum benchmark/results/production-readiness/*.json`, `rg -n '/home/|mongodb(\\+srv)?://|redis://|Bearer[[:space:]]+|api[_-]?key|password|secret|token' benchmark/README.md benchmark/canary-workloads benchmark/results/production-readiness openspec/changes/2026-08-07-local-mcp-production-readiness` and `git diff --check`. Request read-only review of measurement honesty, path/secret hygiene and parity. Commit only reports/docs/evidence as `test(canary): add local production readiness matrix` after PASS.

## 6. Supply chain and release candidate

### Task 6.1: Security and CI RED review

Status: pending.

Files:

- Create: `SECURITY.md`.
- Create: `.github/dependabot.yml`.
- Create: `.github/workflows/security.yml`.
- Modify: `.github/workflows/ci.yml`.
- Create: `scripts/workflow-policy-check.mjs`.
- Create: `test/workflow-policy-check.test.ts`.

Add least permissions, job timeouts/concurrency and immutable reviewed action revisions. Verify Node 22.5/24 Linux matrix remains complete. Do not add secrets or broad write permissions. Run `yarn test test/workflow-policy-check.test.ts && node scripts/workflow-policy-check.mjs && yarn format:check && git diff --check`.

### Task 6.2: Exact-SHA staging release workflow

Status: pending.

Files:

- Create: `.github/workflows/release.yml`.
- Create: `scripts/release-preflight.mjs`.
- Create: `scripts/registry-consumer-smoke.mjs`.
- Create: `test/release-preflight.test.ts`.

Implement explicit `workflow_dispatch` inputs `mode`, exact commit SHA, version and optional `verification_run_id`. Modes are `publish-next`, `verify-next` and `promote-latest`. `publish-next` requires selected-branch SHA equality, exact-SHA successful CI, package version equality, official registry, trusted publishing/provenance and pack inspection. It reads the exact version first, publishes at most once under `next`, and after any ambiguous result re-reads `gitHead`: matching SHA transitions to verification without republish; mismatch blocks as a security failure. `verify-next` never publishes and runs the exact MCP-PROD-604 metadata, integrity, attestation, `npm audit signatures` and consumer assertions, then uploads SHA/version-keyed evidence. `promote-latest` requires `verification_run_id`, downloads/validates that exact successful evidence, re-reads registry state and waits on the separately protected production Environment before promotion. Git tag is not a publish trigger. Deterministic package/verifier failure requires a new patch version. Fail closed when publisher configuration is absent. No local credential file access. Verify with `yarn test test/release-preflight.test.ts test/workflow-policy-check.test.ts && node scripts/workflow-policy-check.mjs && git diff --check`.

### Task 6.3: Documentation consistency and v0.7.0 candidate

Status: pending.

Files:

- Modify: `README.md`.
- Modify: `CHANGELOG.md`.
- Modify: `package.json`.
- Modify: `docs/adr/0008-node-runtime-floor.md` only if its current-state wording is stale.
- Modify: `docs/adr/0009-index-persistence-backend.md` only if its current-state wording is stale; preserve explicit-canary/default-disabled/`enabled_not_released`.
- Modify: `docs/adr/0010-local-stdio-runtime-governance.md` with verified final evidence.
- Modify: `docs/support.md` and `SECURITY.md`.
- Modify: `skills/structural-code-editing/SKILL.md` only where version/runtime/error/support contracts are bundled.
- Verify: `test/agent-setup.test.ts`, `test/agent-targets.test.ts`, `test/setup-wizard.test.ts`, `test/skill-installer.test.ts`, `scripts/package-smoke.mjs` and package metadata.

Run `rg -n '0\\.6\\.0|20\\.19|memory.only|15 tools|macOS|Windows|Linux|enabled_not_released|AST_SYMBOL_INDEX_PERSISTENCE' README.md CHANGELOG.md docs skills package.json openspec/changes benchmark/README.md`, classify every hit as current or dated history, and update current claims. Run `yarn test test/agent-setup.test.ts test/agent-targets.test.ts test/setup-wizard.test.ts test/skill-installer.test.ts && yarn test:package && yarn format:check && git diff --check`. Bump to `0.7.0` only after all implementation gates pass. Commit `chore(release): prepare v0.7.0`.

### Task 6.4: Final local release candidate

Status: pending.

Files:

- Create: `scripts/release-candidate-matrix.mjs`.
- Create: `test/release-candidate-matrix.test.ts`.
- Modify: `package.json` to register `test:release-candidate`.

The matrix script requires `AST_NODE_22_BIN` and `AST_NODE_24_BIN`, validates exact major/minimum versions, and for each runtime runs in this order: `yarn install --immutable`, `yarn format:check`, `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, `yarn test:mcp`, `yarn test:errors`, `yarn test:lifecycle`, `yarn test:cli`, `yarn test:package`, `yarn audit`, `yarn pack --dry-run --json`, workflow policy check and `git diff --check`. Node 22.5 runs with `NODE_OPTIONS=--experimental-sqlite`.

#### Task 6.4a: Commit the matrix mechanism

Run `yarn test test/release-candidate-matrix.test.ts`, then `git add -- scripts/release-candidate-matrix.mjs test/release-candidate-matrix.test.ts package.json`, `git diff --cached --check`, and verify `git diff --cached --name-only` contains exactly those three paths. Commit `test(release): add candidate verification matrix` and require `test -z "$(git status --porcelain=v1 --untracked-files=all)"`.

#### Task 6.4b: Preliminary evidence and Review A

Run `AST_NODE_22_BIN=<absolute-node-22.5-binary> AST_NODE_24_BIN=<absolute-node-24-binary> yarn test:release-candidate --output-dir /tmp/ast-mcp-release-candidate/preliminary`. Re-run the four immutable real-repository canaries with the measurement commands from Tasks 5.2/5.3 except raw `--output` targets `/tmp/ast-mcp-release-candidate/preliminary/{ast-mcp-server-node24,ast-mcp-server-node22.5,x-scraper-node24,x-scraper-node22.5}.json`; do not run `freeze-report` or replace checked reports. Run `sha256sum benchmark/results/production-readiness/*.json`, `rg -n '/home/|mongodb(\\+srv)?://|redis://|Bearer[[:space:]]+|api[_-]?key|password|secret|token' README.md CHANGELOG.md docs skills benchmark openspec/changes/2026-08-07-local-mcp-production-readiness`, and `git diff --check`.

Create `openspec/changes/2026-08-07-local-mcp-production-readiness/verification.md`, map every `MCP-PROD-*` requirement to implementation/assertions/artifacts and record the preliminary evidence. Freeze the six active SDD artifacts and the complete implementation manifest. Obtain read-only Review A PASS before archive; any finding returns to the owning implementation slice and invalidates preliminary evidence.

#### Task 6.4c: Archive and stage the candidate tree

After Review A PASS, run `mkdir -p openspec/archive && mv openspec/changes/2026-08-07-local-mcp-production-readiness openspec/archive/2026-08-07-local-mcp-production-readiness` exactly once. Run `for file in design.md exploration.md proposal.md spec.md tasks.md verification.md; do test -f "openspec/archive/2026-08-07-local-mcp-production-readiness/$file" || exit 1; done` and `test ! -e openspec/changes/2026-08-07-local-mcp-production-readiness`.

Stage only this closure with `git add -A -- openspec/changes/2026-08-07-local-mcp-production-readiness openspec/archive/2026-08-07-local-mcp-production-readiness`. Require `git diff --quiet`, `test -z "$(git ls-files --others --exclude-standard)"`, `git diff --cached --check`, and an exact `git diff --cached --name-status --no-renames` manifest containing five deletions under the change path plus six additions under the archive path and no other entry. Set `CANDIDATE_TREE=$(git write-tree)`.

#### Task 6.4d: Post-archive exact-tree gates and Review B

Run `AST_NODE_22_BIN=<absolute-node-22.5-binary> AST_NODE_24_BIN=<absolute-node-24-binary> yarn test:release-candidate --candidate-tree "$CANDIDATE_TREE" --output-dir /tmp/ast-mcp-release-candidate/final`. Re-run the four immutable real-repository canaries with the Task 5.2/5.3 measurement commands plus `--candidate-tree "$CANDIDATE_TREE"`, raw outputs under `/tmp/ast-mcp-release-candidate/final/`, no `freeze-report`, and require each report to record `candidate_tree == CANDIDATE_TREE`.

Run `sha256sum benchmark/results/production-readiness/*.json`, `rg -n '/home/|mongodb(\\+srv)?://|redis://|Bearer[[:space:]]+|api[_-]?key|password|secret|token' README.md CHANGELOG.md docs skills benchmark openspec/archive/2026-08-07-local-mcp-production-readiness`, `git diff --quiet`, `test -z "$(git ls-files --others --exclude-standard)"`, `git diff --cached --check`, and `test "$(git write-tree)" = "$CANDIDATE_TREE"`. Any checked-report hash change, sensitive unclassified match, unstaged/untracked path, staged-manifest change or candidate-tree mismatch blocks closure.

Obtain Review B PASS over the exact staged `CANDIDATE_TREE`, archive delta and final command reports. Do not edit `verification.md` to copy the verdict; the review is external exact-tree evidence and an edit would invalidate it. Re-run `test "$(git write-tree)" = "$CANDIDATE_TREE"` after review.

#### Task 6.4e: Commit/read back the reviewed tree

Commit the already-staged archive-only manifest as `docs(sdd): archive local MCP production readiness`. Require `test "$(git rev-parse HEAD^{tree})" = "$CANDIDATE_TREE"`, `test -z "$(git status --porcelain=v1 --untracked-files=all)"`, and `git show --name-status --format=fuller --no-renames HEAD` to contain exactly the reviewed five deletions/six additions. This commit is the first eligible local release candidate.

## 7. External release transitions

### Task 7.1: Push authorization and exact-SHA CI

Status: blocked pending completed local release candidate and explicit operator authorization.

After authorization, first require `git log -1 --format=%s` to equal `docs(sdd): archive local MCP production readiness`, `test -z "$(git status --porcelain=v1 --untracked-files=all)"`, and successful Task 6.4e tree/manifest readback. Only then set `RELEASE_SHA=$(git rev-parse HEAD)` and `RELEASE_TREE=$(git rev-parse HEAD^{tree})`. Run `git push origin main`, verify `git ls-remote origin refs/heads/main` equals `RELEASE_SHA`, then use `gh run list --workflow ci.yml --commit "$RELEASE_SHA"` and `gh run view <run-id> --json headSha,conclusion,jobs` to require success on that exact SHA/tree. A local pass cannot substitute remote CI.

### Task 7.2: Staging publication authorization and registry readback

Status: blocked pending Task 7.1 and explicit operator authorization.

Verify `npm view ast-mcp-server@0.7.0 version --registry=https://registry.npmjs.org` reports absence and record current `npm view ast-mcp-server dist-tags --json --registry=https://registry.npmjs.org`. After explicit authorization, run `gh workflow run release.yml --ref main -f mode=publish-next -f sha="$RELEASE_SHA" -f version=0.7.0`, identify the exact run with `gh run list --workflow release.yml --event workflow_dispatch --commit "$RELEASE_SHA" --json databaseId,status,conclusion,headSha,createdAt --limit 10`, and inspect it with `gh run view <publish-run-id> --json headSha,status,conclusion,jobs`.

On any ambiguous publish result, run `npm view ast-mcp-server@0.7.0 version gitHead dist.integrity dist.tarball dist.attestations --json --registry=https://registry.npmjs.org` before another dispatch. If absent, a new `publish-next` dispatch still requires explicit authorization; matching `gitHead == RELEASE_SHA` proceeds only to `verify-next`; mismatched `gitHead` stops as a security failure. Verify `npm view ast-mcp-server dist-tags --json --registry=https://registry.npmjs.org`; `next` MUST be `0.7.0` and `latest` MUST still be the previous release.

### Task 7.3: Fresh public-consumer proof

Status: blocked pending registry readback.

Run `gh workflow run release.yml --ref main -f mode=verify-next -f sha="$RELEASE_SHA" -f version=0.7.0`, identify the exact successful run with the same `gh run list`/`gh run view` procedure, and set `VERIFICATION_RUN_ID=<verify-run-id>`. The workflow runs `node scripts/registry-consumer-smoke.mjs --version 0.7.0 --expected-sha "$RELEASE_SHA" --registry https://registry.npmjs.org --output /tmp/ast-mcp-registry-consumer-0.7.0.json` in a clean directory with lifecycle scripts disabled. It MUST verify tarball integrity; exact version/`gitHead`; `next`; official tarball/attestation URLs; predicate `https://slsa.dev/provenance/v1`; and `npm audit signatures --json --registry=https://registry.npmjs.org` exit zero before running handshake/tool inventory, reads, JSON/TOON, disabled/canary fixture, all three prepare/preview/apply/replay workflows, conflicts and setup idempotency. Download and inspect the SHA/version-keyed workflow evidence artifact; require overall PASS and matching metadata/audit/consumer hashes.

An unchanged transient infrastructure failure may rerun `verify-next`. A deterministic package/consumer failure, or any source/verifier edit needed to pass, permanently blocks `0.7.0` promotion; leave it off `latest` and prepare a new patch release rather than reusing the version.

### Task 7.4: Promote latest, tag, hosted release and final readback

Status: blocked pending public-consumer PASS and explicit operator authorization for dist-tag promotion.

After explicit promotion authorization, run `gh workflow run release.yml --ref main -f mode=promote-latest -f sha="$RELEASE_SHA" -f version=0.7.0 -f verification_run_id="$VERIFICATION_RUN_ID"`, inspect the exact run, and verify `npm view ast-mcp-server dist-tags --json --registry=https://registry.npmjs.org` maps both `next` and `latest` to `0.7.0`. Only after separate Git/tag authorization, run `git tag -a v0.7.0 "$RELEASE_SHA" -m 'chore(release): v0.7.0'`, `git push origin v0.7.0`, and `gh release create v0.7.0 --verify-tag --title 'v0.7.0' --notes-file <verified-release-notes-file>`. Read back branch, commit, exact-SHA CI, npm version/dist-tags/`gitHead`/integrity/attestations, verification artifact, tag and hosted release. Report any partial transition explicitly.

## 8. Deferred product expansion

After public dogfooding, measure where agents fall back from AST operations to text editing. Open a separate SDD for the highest-value proven gap, such as signature migration, member edits or import changes. Do not bundle speculative mutation breadth into this readiness release.
