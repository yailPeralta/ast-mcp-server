# Archive Report: 2026-11-03-angular-template-references

**Status**: archived, intentional-with-warnings
**Archive date**: 2026-11-03
**Archived to**: `openspec/changes/archive/2026-11-03-2026-11-03-angular-template-references/`
**Issue**: #370 (closed). **Tracker**: #371, merged to `main` as merge commit c75f0b6. Chain PRs #372-#379 and #381 merged into the tracker. Chain branches deleted.
**Follow-up**: #380 "feat: template evidence in ast_explore" (open).

## Artifacts Read (Engram, hybrid mode)

| Artifact | Observation ID | Notes |
|----------|----------------|-------|
| proposal | #3846 | Full content read. |
| spec | #3847 | Summary of the corrected delta specs. The authoritative text is the delta files. |
| design | #3848 | Summary. The authoritative text is `design.md`. |
| tasks | #3850 | Summary. Its progress line ("U2-U4 pending") is stale and ranks below the persisted `tasks.md`. |
| verify-report | #3867 | Full content read. Supersedes #3866 ("verify-report (summary)"), which was not used. |

Not read from Engram: `explore`, `apply-progress` (both in the folder as files), and `sdd/{change}/review/*`. The review topics do not exist because no review was discovered for this candidate (see Native Review Gate).

## Native Review Gate

`gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition` returned `next_transition.kind: stop` with `reason_code: rdd_disabled`. The `reviewGate` key is structurally absent. Archive proceeds under ordinary repository policy.

## Final State at Close

Source precedence follows the Final-State Authority hierarchy. Snapshots (`verify-report`, `apply-progress`) are cited with their time of writing.

- **Implementation**: merged to `main` (c75f0b6). Per the launch prompt's final-state facts.
- **Verification at verify time** (per verify-report #3867, written 2026-11-03 19:51): PASS WITH WARNINGS, 0 CRITICAL, 4 WARNING, 3 SUGGESTION. 52 of 53 scenarios compliant. All 11 gates exited 0. Full test run: 91 files, 1304 passed, 2 skipped. The launch prompt restates the same test numbers as the final-state fact.
- **Warnings at close**:
  - W1 (ATN-R8 / task 3.8, `rename_symbol` tool description): **still deferred and open**. This is a deliberate deferral, not a stale snapshot. See Task Completion below.
  - W2 (ATR-R8 tool-description clause): **still deferred**. The docs clause is met (`test/angular-docs.test.ts`).
  - W3 (ATR-R7 inventory re-baseline): verify-report states no re-baseline was needed, because the output schema is not hashed and goldens are unchanged vs `main`. Not an open gap.
  - W4 (tracking checkboxes): verify-report records it as fixed by the orchestrator. Not an open gap.
- **Suggestions at close**:
  - S1 (`hasDerivedComponent` over-blocks rename for a base component's own members, fail-closed): candidate follow-up, no issue yet.
  - S2 (`ast_explore` template evidence): tracked in #380.
  - S3 (apply-progress is JSON, not a markdown table): cosmetic.

## Task Completion

`tasks.md` has 30 checked items and 1 unchecked item: task 3.8 (ATN-R8, `rename_symbol` description and inventory re-baseline), marked blocked by the dsh-adapter smoke. The Task Completion Gate requires either all tasks checked or an explicit reconciliation backed by proof. Task 3.8 is not a stale checkbox, so no reconciliation was performed and `tasks.md` was not edited.

The archive proceeds as **intentional-with-warnings** because the orchestrator's launch prompt explicitly accepts the deferred gap and instructs archive.

**Contradiction recorded (unranked)**: `tasks.md` line 113 (persisted artifact, rank 2) says "maintainer decision pending". The launch prompt (rank 3, most recent) says "accepted deferred gap". No repository evidence in this executor's scope confirms the maintainer decision. Both statements are recorded here. The archive is based on the launch prompt.

## Specs Synced

Main specs live in `openspec/specs/`.

| Domain | Action | Details |
|--------|--------|---------|
| external-writer-safe-apply | Updated (MODIFIED) | 2 requirements replaced, 0 added, 0 removed. "Multi-file apply is sequential, not globally atomic" gains 1 scenario (template file earlier in the sequence). "Existing operation invariants remain authoritative" gains an extended invariant sentence and 2 scenarios (template file in receipts and replay; diagnostics stay TypeScript-only). Requirement count stays 7. |
| angular-template-references | Created (new domain) | 8 requirements, copied from the delta with the header converted to `## Requirements`. ATR-R8 carries a deferral note for the tool-description clause. |
| angular-template-rename | Created (new domain) | 8 requirements, copied from the delta with the header converted. ATN-R8 carries a deferral note for the tool-description clause. |
| template-workspace-freshness | Created (new domain) | 5 requirements, copied from the delta with the header converted. |

Total: 21 requirements added across 3 new domains. Total: 23 requirements in the change, per verify-report #3867 (ATR 8, ATN 8, TWF 5, EWS 2).

## Archive Contents

Moved with `git mv` from `openspec/changes/2026-11-03-angular-template-references/` into this folder. The archive contains: `apply-progress.json`, `chain.md`, `design.md`, `exploration.md`, `proposal.md`, `specs/` (4 domains), `state.yaml`, `tasks.md`, `verify-report.md`, and this `archive-report.md`.

`state.yaml` was updated before the move (`lastPhase: archive`, `archiveState: done`, `nextRecommended: none`, and an `archive` block with date 2026-11-03), so the archived copy matches the pre-move snapshot exactly.

## Process Notes

- Estimation: actual changed lines were 2 to 2.5 times the forecast (U2 879 vs 350, U3 1204 vs 550). Tests were 75 to 84 percent of changed lines. U1, U2, and U3 were each split into chained slices (U1a/b/c, U2a/b, U3a/b/c).
- Mechanical copy: archive and spec-merge readbacks were run with `diff -r` and the verbatim output is in the phase result.
