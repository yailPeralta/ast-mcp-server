# Tasks: productive symbol-index persistence integration

This phase is closed. It implements SQLite only for explicit canary opt-in, keeps the default disabled/memory-only, and changed ADR 0009 only after every gate below passed.

## 0. Phase lock and SDD closure boundary

- [x] Commit the previous evidence phase before editing this phase (`7f41b23c6a7b2980b9eef3807436119bd7de3ebe`).
- [x] Create exploration, proposal, spec and design with compiler authority, fallback and rollback boundaries.
- [x] Keep `AST_SYMBOL_INDEX_PERSISTENCE=disabled` as the default throughout implementation.
- [x] Do not update ADR 0009 until Task 6.3 has a complete PASS matrix.

## 1. Incremental refresh

### Task 1.1: RED/GREEN refresh contract

Status: complete — refresh now separates current path/hash metadata from changed-file symbol projections; focused symbol-index and project tests pass.

Files:

- Modify: `src/services/symbol-index.ts`.
- Modify: `src/services/project.ts`.
- Modify: `src/services/symbols.ts` only if the extraction seam needs a pure helper.
- Test: `test/symbol-index.test.ts`, `test/project.test.ts`.

Separate current path/hash metadata from changed-file symbol projections. Prove initial rebuild, one changed file, config invalidation, additions, deletions and unchanged-file extraction count. Keep existing selector/ranking behavior.

### Task 1.2: Measure the actual incremental path

Status: complete — the integration benchmark records initial rebuild, warm hit, changed-file rebuild and config rebuild independently under Node 22.5 and Node 24.

Files:

- Modify or create: `scripts/benchmark-symbol-index-integration.mjs`.
- Modify: `benchmark/README.md` only with final reproducible methodology/results.

Measure initial build, warm hit, changed-file rebuild and config rebuild independently. Do not claim a universal latency threshold.

## 2. SQLite adapter and lifecycle

### Task 2.1: Contract conformance adapter

Status: complete — memory and SQLite pass the same 10-test store contract; 23 SQLite lifecycle tests cover schema v2 projection checksums, v1 migration with pre-read locking, transactional creation, integrity, component-safe paths, paginated bounded reads/scans, real flush, contention and defensive failure classification.

Files:

- Create: `src/services/symbol-index-sqlite.ts`.
- Modify: `src/services/symbol-index.ts`.
- Create: `test/symbol-index-sqlite.test.ts`.
- Modify: `test/symbol-index-store-conformance.test.ts`.

Implement dynamic `node:sqlite` capability detection, validated row mapping, deterministic query semantics, project/config isolation, body exclusion, refresh, remove, clear, flush and idempotent close. Keep no new dependency.

### Task 2.2: Lifecycle and failure injection

Status: complete — adapter tests and the integration benchmark cover capability-before-filesystem refusal, invalid/symlink-ancestor paths, migration failure, self-consistent omitted projection corruption/quarantine, atomic migration against a concurrent writer, non-contention COMMIT rollback with previous-state preservation, sidecar cleanup, reopen and bounded contention.

Files:

- Modify: `src/services/symbol-index-sqlite.ts`.
- Test: `test/symbol-index-sqlite.test.ts` and temporary child-process helpers.

Cover invalid header, empty/truncated database, row migration, interrupted transaction/flush, bounded lock timeout, sidecar cleanup, quarantine/rebuild, reopen and exact recovered count. Every failure must have a typed/classified path.

## 3. Policy, project lifecycle and fallback

### Task 3.1: Explicit policy and cache boundary

Status: complete — disabled remains the default, canary requires an explicit root, reserved `enabled` fails closed, opaque per-project paths are derived, and path components plus existing database targets are checked without following symlinks.

Files:

- Create: `src/services/symbol-index-policy.ts`.
- Modify: `src/services/project.ts`.
- Test: `test/symbol-index-policy.test.ts`, `test/project.test.ts`.

Implement disabled default, canary opt-in, explicit cache-root requirement, opaque project/config path derivation and safe unknown-input fallback. Keep `createFreshProject` side-effect free.

### Task 3.2: Session-owned store lifecycle

Status: complete — the project owns the optional store, opens after compiler synchronization, closes on invalidation/eviction/cleanup and falls back to memory.

Files:

- Modify: `src/services/project.ts`.
- Modify: `src/services/symbols.ts` and read callers only if the store type changes.
- Test: `test/project.test.ts`, `test/context-builder.test.ts`, `test/mcp.integration.test.ts`.

Open/load only after compiler verification, close on invalidate/eviction/cleanup, swap to memory on optional failures, preserve exact compiler fallback and prove unchanged-file reuse with an extraction spy.

## 4. States and observability

### Task 4.1: Status state machine integration

Status: complete — durable states preserve disabled/ready/rebuilding/failed, query and write failures degrade the session, and saturating counters plus bounded error codes are projected through MCP status.

Files:

- Modify: `src/services/project-status.ts`.
- Modify: `src/services/project.ts`.
- Modify: `src/tools/get_project_status.ts`.
- Test: `test/project-status.test.ts`, `test/project.test.ts`, `test/mcp.integration.test.ts`.

Preserve disabled memory semantics, allow explicit SQLite `ready/rebuilding/failed`, keep freshness evidence gates intact and add bounded policy/backend/operation/counter metadata. Add redaction and malformed-input regressions.

### Task 4.2: Mutation safety regression

Status: complete — the 21-test operations suite passes; a canary-configured prepare/apply regression proves no cache is created and compiler/workspace mutation guards remain authoritative.

Files:

- Modify: `test/operations.test.ts` or add a narrow persistence-failure fixture.

Prove persistence failures and policy changes do not alter prepare/apply plan hashes, diagnostics deltas, affected files or blocked behavior.

## 5. Real failure injection and benchmark

### Task 5.1: Integration benchmark

Status: complete — the current-tree benchmark passes 15 gates on Node 24.16.0 and Node 22.5.0, including recomputed-digest omission quarantine/compiler fallback, non-contention COMMIT rollback plus same-operation memory/compiler fallback, read failure, blocked flush, reserved-enabled fail-closed, corruption recovery and rollback. The command asserts every gate before emitting `status: ok`.

Files:

- Create/modify: `scripts/benchmark-symbol-index-integration.mjs`.
- Modify: `package.json` only if a stable command is required.
- Modify: `benchmark/README.md` with observed output, not invented values.

Run disabled, canary hit/miss, changed-only rebuild, config rebuild, restart, migration, corruption, unsupported capability, read failure, write failure, bounded contention and rollback. Run under explicit Node 22.5.0 (`--experimental-sqlite`) and Node 24 binaries; write reports to `/tmp`.

### Task 5.2: Package and runtime proof

Status: complete — MCP, CLI and tarball/package smokes pass with the disabled default; Node 22.5 and Node 24 targets pass.

Run the repository package/CLI/MCP smokes with default-disabled policy and prove no cache file is created by a clean consumer. Portable/WASM remains deferred.

## 6. Gate and rollout decision

### Task 6.1: Focused and full gates

Status: complete — focused tests, 271 full tests, format/lint/typecheck/build, MCP/CLI/package smokes, audit, regenerated 57-file pack dry-run, exact-tree 15-gate benchmarks on Node 24.16.0 and Node 22.5.0, and diff check pass on the second remediated tree.

Run focused tests, typecheck/build, format/lint, full tests, MCP/CLI/package smokes, audit, pack dry-run, integration benchmark and `git diff --check` on the final frozen manifest. A changed source/test/script/doc after a green gate invalidates downstream evidence.

### Task 6.2: Read-only adversarial review

Status: complete — five reviews of successive stale trees returned `REQUEST_CHANGES`; every finding was remediated and mapped in `verification.md`. The definitive closure review returned `PASS` for candidate digest `c3d2d8ed11200562066eeb295e0426fa8e221d0ada5a2577771ee627fd7fd9d1`.

Review the exact frozen tree for authority, runtime boundaries, path safety, fallback, status redaction, lifecycle cleanup, mutation isolation and untracked files. Missing review output is not PASS.

### Task 6.3: Conditional ADR and canary

- [x] Every gate passed; ADR 0009 selects SQLite only for explicit opt-in/canary and retains memory-only as default and rollback.
- [x] Negative-gate behavior remains documented: a missing or failed gate leaves memory-only and cannot enable canary.
- [x] Immediate rollback is verified by switching policy to `disabled`, invalidating/reopening the session and proving the reopened session uses memory without opening SQLite.

## Verification record

Create `verification.md` only after the final implementation tree is frozen. It must map each requirement to assertions, exact commands, runtime identities, benchmark reports, residual risks and the ADR decision. Do not archive this phase until the selected outcome and rollback evidence are complete.
