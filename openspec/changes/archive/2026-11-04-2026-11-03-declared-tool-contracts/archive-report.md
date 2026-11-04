# Archive Report: 2026-11-03-declared-tool-contracts

**Status**: archived, closed. Verify warnings fixed before close; two suggestion-level follow-ups open.
**Archive date**: 2026-11-04
**Archived to**: `openspec/changes/archive/2026-11-04-2026-11-03-declared-tool-contracts/`
**Issue**: #383 (closed). **Tracker**: #384, merged to `main` as merge commit e2300f9. Chain PRs #385 (U1a), #386 (U1b), #387 (U2) merged into the tracker. Chain branches deleted.

## Artifacts Read (Engram, hybrid mode)

| Artifact | Observation ID | Notes |
|----------|----------------|-------|
| proposal | #3880 | Full content read. |
| spec | #3881 | Full content read. The authoritative text is the delta files. |
| design | #3882 | Full content read. The authoritative text is `design.md`. |
| tasks | #3883 | Full content read. Its pre-apply lines (0.2, 0.3) are shown as pending and rank below the persisted `tasks.md`, which shows them checked. |
| verify-report | #3891 | Full content read. |

Not read from Engram: `explore` (#3879, referenced only), `apply-progress` (read as a file in the change folder, not as an Engram observation), and `sdd/{change}/review/*` (the review topics do not exist, see Native Review Gate).

## Native Review Gate

`gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` returned `next_transition.kind: stop` with `reason_code: rdd_disabled`. The `reviewGate` key is structurally absent. Archive proceeds under ordinary repository policy.

## Final State at Close

Source precedence follows the Final-State Authority hierarchy. Snapshots (`verify-report`, `apply-progress`) are cited with their time of writing.

- **Implementation**: merged to `main` as e2300f9 (the `git log` HEAD at archive time). Per the launch prompt's final-state facts (rank 3).
- **Verification at verify time** (per verify-report #3891, written 2026-11-03 23:14): PASS WITH WARNINGS, 0 CRITICAL, 3 WARNING, 3 SUGGESTION. 23 of 23 scenarios compliant. Gates at verify time exited 0 (typecheck, lint, format:check, build, full test, test:package, test:dsh-adapter).
- **Final numbers at close** (launch prompt, rank 3, which is the most recent account): full test run 93 files, 1344 passed, 2 skipped. `test:dsh-adapter` printed `DSH_ADAPTER_SMOKE_OK` with `find_references` and `rename_symbol` declared and the 13 other tools unchanged. `test:local-registry` reported `exact_tool_inventory: true` during apply. `yarn format:check` passes at archive time.
- **Warnings at close**:
  - W1 (tasks 0.2 and 0.3 stale checkboxes): **fixed**. `tasks.md` now shows all 27 tasks checked. Not an open gap.
  - W2 (`test:local-registry` not re-run during verify): **closed by apply evidence** (`exact_tool_inventory: true`). Not an open gap.
  - W3 (stale top-level gates in `apply-progress`): **fixed** by the orchestrator. Not an open gap.
- **Suggestions at close**:
  - S1 (DTC-R7 verified only indirectly, through the stale rule): **open follow-up**, no issue yet. Proposed: a direct unit test for the baseline-advance case.
  - S2 (no test asserts that the canary pin differs from the inventory pin): **open follow-up**, no issue yet.
  - S3 (ADR 0015 addendum dated 2026-11-04): **recorded deviation**, no action.

## Task Completion

`tasks.md` (persisted artifact, rank 2) has 27 checked items: pre-apply 0.1 to 0.4, U1 1.1 to 1.12, and U2 2.1 to 2.11. It has 0 unchecked items. No archive-time reconciliation was performed, and `tasks.md` was not edited. The Engram tasks observation #3883 is the pre-apply snapshot and is superseded.

## Specs Synced

Main specs live in `openspec/specs/`.

| Domain | Action | Details |
|--------|--------|---------|
| declared-tool-contracts | Created (new domain) | 10 requirements and 20 scenarios, copied from the delta. The header was converted from `## ADDED Requirements` to `## Requirements`. |
| angular-template-references | Updated (MODIFIED) | 1 requirement replaced: "Diagnostics remain TypeScript-only" (ATR-R8, 2 scenarios). The deferral blockquote was removed. Requirement count stays 8. |
| angular-template-rename | Updated (MODIFIED) | 1 requirement replaced: "Rename states TypeScript-only diagnostics" (ATN-R8, 1 scenario). The deferral blockquote was removed. Requirement count stays 8. |

Total for the change: 12 requirements and 23 scenarios (DTC 10, ATR-R8 1, ATN-R8 1), matching verify-report #3891 (23 of 23 compliant). The MODIFIED blocks keep the delta's `(Previously: ...)` annotation verbatim.

## Archive Contents

Moved with `git mv` from `openspec/changes/2026-11-03-declared-tool-contracts/` into this folder: `apply-progress.json`, `chain.md`, `design.md`, `exploration.md`, `proposal.md`, `specs/` (3 domains), `state.yaml`, `tasks.md`, `verify-report.md`, and this `archive-report.md`.

`state.yaml` was updated before the move (`lastPhase: archive`, `archiveState: done`, `nextRecommended: none`, and an `archive` block dated 2026-11-04), so the archived copy matches the pre-move snapshot. The `git mv` stages the rename with the pre-edit index content, so the `state.yaml` edits appear as unstaged changes for the orchestrator to add.

## Follow-ups

- S1 and S2 above, with no issues yet.
- Lifecycle reminder: when `PUBLIC_BASELINE_VERSION` advances past a release that contains the new descriptions, remove both fixture entries in `test/fixtures/declared-tool-contracts.json` and the oracle test's declared-set assertion.

## Process Notes

- Estimation: U1 forecast about 490 lines, actual 996 (split 625 and 334). U2 forecast 260 to 300, actual 267. Tests were about 70 to 80 percent of changed lines.
- Mechanical copy: the change-folder move and the spec merges were verified with `diff -r`. The verbatim output is in the phase result.
