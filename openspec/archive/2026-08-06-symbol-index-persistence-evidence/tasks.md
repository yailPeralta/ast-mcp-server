# Tasks: symbol-index persistence evidence

This change is phase-gated. It starts as an exploration/evidence SDD and must not enable production persistence until the selection gate and ADR are complete.

Closure status: archived historical evidence. The partial/blocked task statuses below describe the evidence available when this study closed; they are not active work. `openspec/archive/2026-08-07-symbol-index-persistence-integration/` subsequently closed the conformance, failure, isolation, fallback, observability and mutation-safety gates. ADR 0009 now authorizes only explicit `canary`; `disabled`/memory remains the default and `enabled` remains unreleased/fail-closed.

## 0. Compatibility lock

- [x] Re-read ADR 0005, `src/services/symbol-index.ts`, project lifecycle/fallback code, CI matrix and the current storage benchmark.
- [x] Preserve the current memory-only default and compiler/mutation authority.
- [x] Capture clean-tree state and the current Node 24 benchmark to a temporary path without modifying tracked benchmark results.

## 1. Runtime and package probes

### Task 1.1: Run explicit supported-runtime probes

Status: complete — the full project quality/package gates passed on the declared Node `22.5.0` floor and the local Node 24 line. The benchmark explicitly executed both configured binaries and reported `pass`. The built-in SQLite API is available on Node `22.5.0` only with the explicit experimental flag. Native SQLite remains unselected until conformance and failure-injection gates pass.

Files:

- Modify: `scripts/benchmark-index-storage.mjs` only if explicit executable invocation or report redaction is missing.
- Test: temporary runtime reports under `/tmp`.

Run the storage workload with the Node 22.5.0 floor, Node 24 and explicitly provisioned versions when needed. Record availability, native API presence, package install behavior and exact blockers. Never download a runtime implicitly.

### Task 1.2: Establish dependency/package evidence

Status: partial — JSON and native SQLite were exercised only as disposable evidence adapters; no portable dependency was installed or added to the production manifest.

Files:

- Create: temporary candidate package probe or isolated package workspace.
- Test: isolated tarball/install smoke.

For each portable candidate, measure package contents, lifecycle behavior, startup, import shape and removal/rollback. Do not modify production dependencies until the selection gate passes.

## 2. Backend-neutral conformance

### Task 2.1: Write RED conformance tests

Status: complete for the current memory implementation and disposable benchmark adapters.

Files:

- Create: `test/symbol-index-store-conformance.test.ts`.
- Modify: `src/services/symbol-index.ts` only if the existing interface cannot express the required failure classification.

Cover semantic parity, deterministic ordering, limits, project/config isolation, schema filtering, body exclusion, upsert/remove/clear and flush behavior for every adapter. The TypeScript suite covers `InMemorySymbolIndex`; the benchmark applies the same basic matrix to JSON and native SQLite candidates.

### Task 2.2: Add lifecycle failure tests

Status: partial — clean restart, interrupted-flush recovery, real row migration, native concurrent writers, cross-project writer isolation and the basic two-readers-plus-writer probe pass on Node 22.5.0 and Node 24; JSON fails the lost-update negative control. The complete cross-project reader/writer contention matrix, migration rollback, typed failure classification and compiler fallback remain open.

Files:

- Create: adapter-specific test helpers under `test/helpers/` if required.
- Test: conformance suite and temporary storage fixtures.

Cover clean restart, schema migration, malformed/truncated storage, interrupted flush, corruption quarantine/rebuild, bounded contention and concurrent readers/writers. Expected failure behavior is compiler fallback, never stale success.

## 3. Candidate decision gate

### Task 3.1: Compare candidates against the acceptance matrix

Status: partial — the runtime/package/conformance/lifecycle report exists, but the remaining cross-project reader/writer contention, migration rollback, fallback, observability and mutation-safety gates prevent candidate selection.

Files:

- Modify: `scripts/benchmark-index-storage.mjs` and `benchmark/README.md` only for reproducible evidence.
- Create: temporary report; no tracked timing artifact unless intentionally normalized.

Require pass/fail evidence for every runtime, packaging, lifecycle, concurrency, isolation, body-exclusion, fallback and observability criterion. Local timing values remain descriptive only.

### Task 3.2: Record the decision in an ADR

Status: complete — ADR 0009 reaffirms memory-only and records the exact missing evidence.

Files:

- Create or modify: `docs/adr/0009-index-persistence-backend.md`.

Select one backend only if all gates pass. Otherwise record a reaffirmation of memory-only and the exact missing evidence. Do not integrate a backend from benchmark performance alone.

## 4. Integration only after explicit authorization

### Task 4.1: Add policy and adapter behind a disabled default

Status: blocked until Task 3.2 selects a backend.

Files:

- Modify: `src/services/symbol-index.ts`, project/session lifecycle and bounded status projection.
- Test: conformance, project freshness, fallback and status tests.

Keep compiler synchronization before persistence, validate fingerprints on load, isolate cache paths, classify failures and preserve mutation checks.

### Task 4.2: Add rollback and operational smoke

Status: blocked until Task 4.1.

Files:

- Modify: CLI/operator documentation and package smoke as needed.
- Test: disable/quarantine/rebuild smoke, MCP/CLI/package and mutation regression suite.

Prove that disabling persistence returns to memory-only without source or operation-plan changes.

## 5. Final verification and archive

- [x] Run focused conformance tests and the available lifecycle benchmark on the current tree.
- [x] Re-run the full quality gates after the evidence changes on the frozen tree.
- [x] Run Node 22.5.0/24 matrix and isolated package smoke.
- [x] Verify no source bodies, secrets, compiler objects or mutation plans enter the cache for the exercised derived records.
- [x] Create `verification.md` with requirement-to-evidence traceability and residual risks.
- [x] Archive after the successor integration SDD, ADR 0009 canary-only decision and final acceptance evidence superseded this provisional study.
