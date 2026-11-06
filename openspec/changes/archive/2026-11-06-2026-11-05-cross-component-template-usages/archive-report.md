# Archive Report: cross-component-template-usages (#408)

**Archived**: 2026-11-06
**Folder**: `openspec/changes/archive/2026-11-06-2026-11-05-cross-component-template-usages/`
**Store**: hybrid (Engram `sdd/2026-11-05-cross-component-template-usages/*` + openspec)
**Final state**: all work merged on main (HEAD 8d0cdb6). #408 closed by #422. Follow-up #421 (template type checking in rename plans) is OPEN.

## Engram observations read (traceability)

| Artifact | Observation ID | Topic key |
|---|---|---|
| proposal | #3952 | `sdd/2026-11-05-cross-component-template-usages/proposal` |
| spec | #3954 | `sdd/2026-11-05-cross-component-template-usages/spec` |
| design | #3955 | `sdd/2026-11-05-cross-component-template-usages/design` |
| tasks | #3962 | `sdd/2026-11-05-cross-component-template-usages/tasks` |
| verify-report | #3977 | `sdd/2026-11-05-cross-component-template-usages/verify-report` |

## Final state (launch-prompt facts, rank 3, outrank snapshots)

- Merged PRs: #412, #413, #414, #415, #416, #417, #418, #419, #420, #422. #408 closed by #422.
- Task 5.4 is reconciled to `[x]` at archive time. Its issue part is done via #421, which replaced the `TEMPLATE_TYPECHECK_FOLLOWUP_ISSUE` placeholder in README, CHANGELOG, the structural-code-editing skill and operations.md. The docs test asserts it. The remaining parts (digest rotation, CHANGELOG, spec sync) are done per the 5.4 parenthetical.
- Test result: the full suite on 8d0cdb6, re-run by the orchestrator, gives 1716 passed, 1 failed, 11 skipped. The one failure is the known environmental `test/canary-local-mcp.test.ts` GIT_EDITOR case. CI is green on every PR.

## Snapshot claims (not current state)

- `verify-report` #3977, at verification time: PASS WITH WARNINGS, 0 critical, 3 warnings. Its run reported 1714 passed, 3 failed, 11 skipped. Per the final-state facts, the two extra failures (an `operations.test.ts` 30s timeout under load and one unidentified) did not reproduce on the re-run. Load flakiness is the recorded diagnosis, not a confirmed cause. The current result is the 1716/1/11 run above.
- Task 5.4 was `[ ]` in the tasks artifact at verification time. It is `[x]` at archive, as described above.

## Spec sync (openspec/specs)

Option B was applied. Each MODIFIED requirement is replaced by the delta text. Main scenarios that the delta does not restate are re-appended to the same requirement, unless they are superseded.

| Domain | Action | Details |
|---|---|---|
| `angular-template-scope` | Created (new domain) | Copied from the delta. `## ADDED Requirements` became `## Requirements`. `[S#]` tags were stripped from requirement headers, matching main. |
| `angular-template-references` | Updated | 6 requirements replaced in place (Owning, Member usage extraction, Completeness, Additive schema, Diagnostics, Cross-component). 2 appended as ADDED (Template evidence, Docs and skill). |
| `angular-template-rename` | Updated | 4 MODIFIED requirements replaced. 4 ADDED requirements appended. |
| `declared-tool-contracts` | Updated | 1 MODIFIED requirement replaced (Inventory digest pins re-baselined). |

### Decisions

- REMOVED "Cross-component usages are reported as unfinished" is replaced in place by "Cross-component usages are reported". The delta's REMOVED note says it is superseded.
- MODIFIED names that are absent from main ("Template evidence stays out of impact analysis", "Docs and skill state the cross-component contract") are treated as ADDED and appended.
- Five scenarios are dropped as superseded: Pipe class or transform; Input or output member; Directive input or output; Member listed in metadata inputs; Path escapes the project root. Their behavior is covered by the new delta scenarios, including consumer-unsafe.
- Nine main scenarios not restated in the delta are re-appended. Each was checked against the new requirement text and against main code (see amendments below).
- Rename "Tool description" and declared "Pins consistent after a description change" are replaced by the delta's S1-S5 scenario variants. This is intentional.

### Amendments to re-appended scenarios

None. Each of the nine was checked against the new requirement text and against main code and CHANGELOG:

- Usage kinds, Control flow and pipes, Inline template usage: own-template behavior. The delta keeps the same own-template kinds, and the scenarios do not enumerate consumer kinds.
- Literal templateUrl resolves, Symlink or hardlink template, Computed templateUrl: consistent with the Owning requirement's resolution and safety rules.
- Counts: own-template arithmetic (3 TypeScript plus 2 template equals total 5). Consumer items increase `template_reference_count` through the same field, so the scenario still holds.
- Template breakage not diagnosed: consistent with the Diagnostics requirement.
- find_references tool description: the quoted string is byte-identical to `src/tools/find_references.ts` and the declared fixture. No amendment.

### Known spec-to-code mismatch (not amended here)

The delta names consumer kinds `TemplateBinding` and `TemplatePipeName`. Code emits `TemplateInputBinding`, `TemplateAttribute`, `TemplateTwoWayBinding` and `TemplateOutputBinding` for consumer bindings (`src/services/angular-template-bindings.ts`), and `TemplatePipeName` for pipes (`src/services/angular-templates.ts`). The archive records shipped code. The spec text in the `angular-template-references` and `angular-template-scope` domains should be corrected in a follow-up. This was not changed here, because amending the requirement text is outside the archive scope.

### Other notes

- The `Owning component and template resolution` requirement body starts with a delta provenance note, "(Previously: only the template of the declaring class was searched.)". It was kept verbatim from the delta.
- The `Path escapes the project root` scenario is dropped as superseded. The Owning requirement body still states the same path-safety rules.

## Mechanical readbacks

- Spec splice: for each of 17 merged requirements, the delta block (tags stripped) was diffed against the merged block. Zero delta lines were missing. The only extra lines are the re-appended scenarios listed above.
- `angular-template-scope`: `diff -r` against the delta source shows only the intended header changes (`## ADDED Requirements` to `## Requirements`, and tag stripping on 10 requirement headers).
- Archive move: `diff -r` of the pre-move snapshot against the archived folder was empty.

## Risks

- The kind-name mismatch above is recorded as a follow-up, not a blocker.
- The Engram archive-report topic and this file are the audit trail. The change folder is not modified after archive.
