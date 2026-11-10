# Proposal: Template evidence in ast_explore

Issue: #380. Exploration: `explore.md` / Engram `sdd/2026-11-10-explore-template-evidence/explore`.

## Intent

`ast_explore` builds reference evidence from TypeScript only (`context-builder.ts:378`). A component member used only in its template looks unused, so agents can draw a wrong "dead code" conclusion. `ast_find_references` already reports template usages with an honest coverage verdict. `ast_explore` should report the same evidence and verdict.

## Scope

### In Scope

- Switch explore evidence to `collectSymbolReferencesWithTemplates` (reuses `collectTemplateUsages`).
- Optional output fields: per-item `origin`, `template_coverage`, `template_reference_count`.
- New omission reason `template_coverage_incomplete`.
- A fallback for a non-cooperative throw in the template path.
- A latency measurement against a stated threshold.
- Shared leaf schema module. Pins, docs, skill bump, CHANGELOG, OpenSpec deltas.

### Out of Scope

- Template evidence in `ast_get_impact` or `ast_find_test_candidates`.
- New inputs. Changes to tool descriptions or input schemas (dsh-adapter baseline 0.13.0).
- A request-scoped template read cache, unless the measurement fails.
- Paging template items inside explore. Callers use `ast_find_references`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `angular-template-references`: `ast_explore` reports template usages and the same coverage verdict as `ast_find_references`.
- `ast-explore-omission-metadata`: adds the `template_coverage_incomplete` reason.

## Approach and Decisions

1. **Shared `reference_limit`.** It bounds the merged list, as in `find_references`. `origin` tells the two kinds of items apart. The frozen wording "compiler references" is now inexact. The skill and spec document this.
2. **Layered coverage.**
   - Optional fields appear only when the status is not `not_applicable`.
   - The builder emits one `template_coverage_incomplete` omission for each selector whose status is not `completed`. The omission survives `byte_limit` trimming and sets `evidence_complete=false`.
   - **Throw policy.** If the template-aware call throws, explore falls back to the sync TS references. It adds a synthetic `{unfinished, template_unresolved}` coverage and the omission. TS evidence stays, as it does today.
3. **Budgets.** Per-symbol scan budgets stay as they are. **Latency threshold:** for `detail=full` and `limit=20` on a 500-component fixture with 20 `@Input` members, the added p95 wall time must be ≤ 2 s over the non-Angular baseline. On 2000 components, every request must end in time with a typed result. If either check fails, the cache becomes a follow-up issue before release.
4. **Symbol scope.** Fully delegated to `collectTemplateUsages`, so verdicts match `find_references`.
5. **Schemas.** Move the `origin` enum, the coverage schema and `template_reference_count` to a shared module. The `find_references` JSON schema must stay byte-identical.

Check against the code: the builder is already `async` (`buildExploreContext`), so the switch needs no signature change. One edge case: a throw from the TS half of the merged call also triggers the fallback. The sync retry then throws too and still yields `references_unresolved`. That is correct, at the cost of doing the work twice.

## Affected Areas

| Area | Impact |
| --- | --- |
| `src/services/context-builder.ts`, `src/services/explore-presentation.ts` | Modified |
| `src/tools/explore.ts`, `src/tools/find_references.ts` | Modified |
| `src/tools/template-evidence-schema.ts` | New |
| `test/explore-unchanged.test.ts` (inverted, non-Angular deep-equal kept), new Angular explore, batch-parity and isolation tests | New/Modified |
| `test/fixtures/tool-inventory.json`, `scripts/registry-consumer-smoke.mjs`, `scripts/canary-local-mcp.mjs`, `test/angular-docs.test.ts` | Re-pinned |
| README, skill `SKILL.md` + `operations.md` (version > 4.8.0, predecessor in `releases.json`), CHANGELOG | Modified |

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Latency on `@Input`-heavy workspaces | Med | Threshold, cooperative timeout, cache follow-up |
| A missed `tools_list_sha256` pin | Med | Three pins in the same PR |
| Template items push TS refs off the page, or the reverse | Med | `has_more` raises `reference_limit`. Documented. |

## Rollback Plan

Revert the PR. All fields and the enum value are additive, and non-Angular output is unchanged.

## Success Criteria

- [ ] A member used only in its template shows `origin` template evidence and a `completed` coverage.
- [ ] Every coverage status other than `completed` produces the omission, including after `byte_limit` trimming.
- [ ] Non-Angular explore output deep-equals the current output, both direct and batch.
- [ ] The impact and test-candidate tools ignore template usages.
- [ ] The latency threshold is met, or a follow-up issue is filed.

## Decisions needing product confirmation

1. **Shared limit despite the frozen wording "compiler references".** The alternative is a separate limit, which needs a new input and breaks the frozen schema.
2. **Coverage other than `completed` marks evidence incomplete.** Every Angular project without `@angular/compiler` loses `evidence_complete=true`. That is honest, but agents will see it more often.
3. **The latency threshold value** (≤ 2 s added p95).

## Proposal question round

The proposal was written by a subagent, so these questions were not asked:

1. Is the main user an agent hunting for dead code or doing impact triage in Angular apps?
2. Should an incomplete template verdict count as incomplete evidence (decision 2), or only as a warning?
3. Is the frozen-wording mismatch acceptable until the next contract re-baseline?
