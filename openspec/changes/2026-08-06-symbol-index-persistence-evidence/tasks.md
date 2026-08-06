# Tasks: symbol-index persistence evidence

This change is phase-gated. It starts as an exploration/evidence SDD and must not enable production persistence until the selection gate and ADR are complete.

## 0. Compatibility lock

- [ ] Re-read ADR 0005, `src/services/symbol-index.ts`, project lifecycle/fallback code, CI matrix and the current storage benchmark.
- [ ] Preserve the current memory-only default and compiler/mutation authority.
- [ ] Capture clean-tree state and the current Node 24 benchmark to a temporary path without modifying tracked benchmark results.

## 1. Runtime and package probes

### Task 1.1: Run explicit supported-runtime probes

Status: complete — explicit Docker probes passed the project quality/package gates on Node `20.19.6` and Node `22.23.2`; the local Node `24.16.0` gate was already green. Native SQLite is unavailable on Node 20 and experimental on Node 22, so it cannot be selected as the sole backend for the current engine range.

Files:

- Modify: `scripts/benchmark-index-storage.mjs` only if explicit executable invocation or report redaction is missing.
- Test: temporary runtime reports under `/tmp`.

Run the storage workload with Node 20.19, Node 22 and Node 24. Record availability, native API presence, package install behavior and exact blockers. Never download a runtime implicitly.

### Task 1.2: Establish dependency/package evidence

Status: proposed.

Files:

- Create: temporary candidate package probe or isolated package workspace.
- Test: isolated tarball/install smoke.

For each portable candidate, measure package contents, lifecycle behavior, startup, import shape and removal/rollback. Do not modify production dependencies until the selection gate passes.

## 2. Backend-neutral conformance

### Task 2.1: Write RED conformance tests

Status: proposed.

Files:

- Create: `test/symbol-index-store-conformance.test.ts`.
- Modify: `src/services/symbol-index.ts` only if the existing interface cannot express the required failure classification.

Cover semantic parity, deterministic ordering, limits, project/config isolation, schema filtering, body exclusion, upsert/remove/clear and flush behavior for every adapter.

### Task 2.2: Add lifecycle failure tests

Status: proposed.

Files:

- Create: adapter-specific test helpers under `test/helpers/` if required.
- Test: conformance suite and temporary storage fixtures.

Cover clean restart, schema migration, malformed/truncated storage, interrupted flush, corruption quarantine/rebuild, bounded contention and concurrent readers/writers. Expected failure behavior is compiler fallback, never stale success.

## 3. Candidate decision gate

### Task 3.1: Compare candidates against the acceptance matrix

Status: proposed.

Files:

- Modify: `scripts/benchmark-index-storage.mjs` and `benchmark/README.md` only for reproducible evidence.
- Create: temporary report; no tracked timing artifact unless intentionally normalized.

Require pass/fail evidence for every runtime, packaging, lifecycle, concurrency, isolation, body-exclusion, fallback and observability criterion. Local timing values remain descriptive only.

### Task 3.2: Record the decision in an ADR

Status: proposed.

Files:

- Create or modify: `docs/adr/0008-index-persistence-backend.md`.

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

- [ ] Run focused conformance/lifecycle tests and the full quality gates on the frozen tree.
- [ ] Run Node 20.19/22/24 matrix and isolated package smoke.
- [ ] Verify no source bodies, secrets, compiler objects or mutation plans enter the cache.
- [ ] Create `verification.md` with requirement-to-evidence traceability and residual risks.
- [ ] Archive only after the decision ADR and all acceptance gates are complete.
