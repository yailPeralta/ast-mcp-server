# Tasks: Executable JSON/TOON Contract

## Review Workload Forecast

| Field                   | Value                |
| ----------------------- | -------------------- |
| Estimated changed lines | 267–354 authored     |
| 400-line budget risk    | Low                  |
| Chained PRs recommended | No                   |
| Suggested split         | One oracle work unit |
| Delivery strategy       | single-pr            |
| Chain strategy          | pending              |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Files/forecast                                                                                                                                | Focused test                                                | Runtime                       | Rollback                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- | -------------------------------------- |
| U1   | `scripts/json-toon-contract.mjs` 210–270; `test/json-toon-contract-admission.test.ts` 55–80; `package.json` 1–3; `.github/workflows/ci.yml` 1 | `yarn vitest run test/json-toon-contract-admission.test.ts` | `yarn test:mcp-formats` twice | Remove two files and two command lines |

If reforecast exceeds 400, stop and auto-chain oracle then CI/closure, each ≤400.

## Attempt Boundary

U1 IDs: `f01-oracle-acquire-20260905-01` / `f01-oracle-settle-20260905-02`. Goal: `6 requirements/12 scenarios; eight cases/sixteen paired stdio calls`; `--max-attempts 2 --max-changed-lines 400`. Run only on `proceed`; settle token/hash. RDD: `disabled/unmanaged`; no receipts.

## Phase 0: Planning Authority

- [x] 0.1 Pin `docs/f01-design`, PR #239/`eb85ee9`, approved chore #235, hybrid/OpenSpec authority.
- [x] 0.2 Read F-01 and source/test/package/CI/ADR/roadmap seams; AST status exposed no evidence, so mapping is textual.
- [x] 0.3 Exclude `outputSchema`, #103, R-01/recovery, UI, Code Mode, Harness, apply/mutation, and unwitnessed production edits.

## Phase 1: Truthful RED

- [x] 1.1 Use parent-provided U1 token; run the existing 43-test safety net from `state.yaml`; stop on pre-existing failure.
- [x] 1.2 Create admission test first: require command/oracle, exact four-tool/eight-case manifest, order/envelope/schema/normalization/hash/cleanup; reject omissions, duplicates, extras, or normalization drift.
- [x] 1.3 Run focused Vitest twice unchanged; expect identical exit 1 for absent/incomplete command, oracle, or manifest. Retain both.

## Phase 2: GREEN Oracle

- [x] 2.1 Create isolated stdio oracle: fixed `dist/index.js`, identical-input sequential JSON→TOON, bounded failure/timeout, close-before-remove `finally` cleanup.
- [x] 2.2 Implement two cases per eligible tool (eight/sixteen): empty/page, bounded/truncated, Unicode/multiline, null/omitted, finite numeric/boolean, aggregates.
- [x] 2.3 Assert JSON canonical inventory plus `content:[]`; exact TOON `{format,data}` and decode; exact four-tool `tools/list` eligibility, enum/default, no `outputSchema`, unsupported omission.
- [x] 2.4 Normalize only `duration_ms`/`checked_at`; recursively sort objects, preserve arrays, compare values/UTF-8 bytes, SHA-256 cases/report. Add package command and CI invocation.

## Phase 3: GREEN, REFACTOR, Gates

- [x] 3.1 Run both twice; expect exit 0, 8 cases/16 calls, stable bytes/hashes, cleanup.
- [x] 3.2 REFACTOR after GREEN; rerun admission/oracle and presenter/catalog/MCP tests.
- [x] 3.3 Require empty production diff. A mismatch needs captured RED and reforecast correction; otherwise production edits are forbidden.

## Phase 4: Review, Verify, Archive

- [x] 4.1 Run format/lint/typecheck/test/build, MCP/errors/lifecycle/CLI/package, and `git diff --check`; record results/rollback.
- [ ] 4.2 Freeze candidate; run two blind read-only adversarial judgments.
  - Maintainer adjudicated Judge A's seven bypasses within F01-JD-C01 and authorized final correction round 2.
  - Correction 2 adds seven executable deterministic-fault probes and rejects the complete 23-case direct/probe matrix twice while preserving exact case mapping, stable two-run evidence, and `test:mcp` reachability.
  - Terminal status: prohibited/pending after both final judges independently ESCALATED on F01-FINAL-C01 and F01-FINAL-C02 following 2/2 corrections.
  - Seven ordinary-flow dead-branch/short-circuit bypasses remain admitted, and `runBehavioralProbes` can return expected IDs without executing faults.
  - No correction rounds remain. Task 4.2 cannot complete without explicit maintainer disposition; no approval is recorded.
- [ ] 4.3 BLOCKED — do not acquire, settle, verify, or write a verify report while terminal severe findings remain unresolved.
- [ ] 4.4 BLOCKED — do not archive, merge specs, deliver, commit, push, or alter issue/PR state before explicit maintainer disposition.
