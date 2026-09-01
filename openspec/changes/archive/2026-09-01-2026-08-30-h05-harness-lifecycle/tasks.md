# Tasks: H-05 user-visible Harness lifecycle

## Review workload and admission

Authored forecast: 780–1,080 total; four autonomous PRs ≤400 using `stacked-to-main`: `main ← PR1 docs ← PR2 seam ← PR3 native ← PR4 GUI/closure`. Tracker #116 does not authorize delivery; PR1 uses approved `type:docs` issue #117 and PR2–4 require approved `type:chore` children. Runtime apply/verify/remediation MUST use `gentle-ai sdd-attempt acquire/settle`; missing prerequisites fail, never skip.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

| PR  | Budget / focused gate / runtime / rollback                             |
| --- | ---------------------------------------------------------------------- |
| 1   | 45–90 / docs checks / N/A static / docs+OpenSpec                       |
| 2   | 170–280 / focused seam Vitest / N/A closed / fixture+helpers+tests     |
| 3   | 260–390 / build + `test:dsh-adapter` / pinned Harness / native helpers |
| 4   | 220–360 / canonical CI / pinned Web / GUI+closure                      |

## Phase 0 — PR1 baseline (RED → GREEN → REFACTOR)

- [x] 0.1 RED — Prove roadmap/annex falsely say #115 open or unmerged.
- [x] 0.2 GREEN — Record merged `7ab04c29a274156c78c470eb7bc3488ce057b928`, archived H-03, final main CI/Security green, unreleased v0.13.1, and H-05 next.
- [x] 0.3 REFACTOR — Compact all planning artifacts while preserving 6 requirements, 12 scenarios, 18 tasks, boundaries, risks, rollback, and four-PR strategy.
- [x] 0.4 Verify approved issue #117, links/format/lint/status/JSON/YAML, ≤400 authored lines, and docs-only rollback; prepare PR1 handoff without commit/push/PR.

## Phase 1 — PR2 private seam

- [x] 1.1 RED — Test closed descriptors, immutable generation/correlation/owner, stale effects, cancellation, sanitization, and zero counters.
- [x] 1.2 GREEN — Generalize `h03-timeout-fixture.ts`; retain environment gate and public `ast_get_project_status` only.
- [x] 1.3 REFACTOR — Deduplicate normalization; prove unchanged 15-tool public catalog/schema.
- [x] 1.4 Run focused tests, record rollback, settle; rebase after PR1 and merge PR2.

## Phase 2 — PR3 native lifecycle

- [x] 2.1 RED — Require identity-first failure, HMR `15→0→15`, stale/late rejection, Session cancel, shutdown, and zero residue.
- [x] 2.2 GREEN — Add loader barriers, AST terminal/durable joins, and worker/Host cleanup to the smoke.
- [x] 2.3 REFACTOR — Extract bounded helpers; forbid sleeps, duplicates, generic aborts, and sensitive errors.
- [x] 2.4 Preserve H-01a/H-02/H-03/apply denial; settle, rebase, and merge PR3.

## Phase 3 — PR4 GUI and closure

- [x] 3.1 RED — Require pinned Playwright/Chromium/auth and correlated rendered Tools rows `15→0→15`.
- [x] 3.2 GREEN — Managed-launch pinned `dsh web` with disposable profile/port/auth URL; never edit host.
- [x] 3.3 REFACTOR — Close all owners, prove root absence, and keep durable data correlation-only.
- [x] 3.4 Run blind dual Judgment Day; remediate RED-first with receipts and two re-judgments.
- [x] 3.5 Run canonical format/lint/typecheck/test/build/smoke/audit/pack gates; settle apply delivery and merge all four slices. Dedicated verify/archive follow.

### Post-archive release obligation

After merged-main CI and dedicated SDD verify/archive: set version `v0.13.1`, update the changelog, run the dry-run, publish, verify, promote, then tag the proven main SHA.
