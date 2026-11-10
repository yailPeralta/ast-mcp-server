# Design: Template evidence in ast_explore (#380)

## Technical Approach

The maintainer confirmed three decisions on 2026-11-10:

- One shared `reference_limit` for TypeScript and template items, using the merged pagination.
- Any coverage other than `completed` raises `template_coverage_incomplete`.
- The latency threshold is ≤ 2 s added p95.

The builder makes one call to a new sibling export in `references.ts`. That module owns the template fallback, so template internals stay out of `context-builder.ts`. The explore output schema gains optional fields from a new shared leaf module. No input or description changes. Specs: the deltas in `specs/` (angular-template-references, ast-explore-omission-metadata, declared-tool-contracts).

Anchors verified on `e49987b`:

- `buildExploreContext`: `context-builder.ts:307`
- the single references call: `:378`
- the `has_more` omission loop: `:422-431`
- `createResult`: `:475`
- `collectSymbolReferencesWithTemplates`: `references.ts:202`
- `collectTemplateUsages`: `angular-templates.ts:772`
- `SCAN_LIMITS`: `:88`
- the omission enum: `explore-presentation.ts:6`
- trimming: `:98-113` and `:202-222`
- the explore schemas: `explore.ts:132-166`
- the handler parse: `:324`
- the find_references leaf schemas: `find_references.ts:41-71`
- the mapping: `:118-147`

## Architecture Decisions

| Decision | Choice | Rejected (why) |
| --- | --- | --- |
| Seam | `references.ts` gains `collectSymbolReferencesWithTemplateVerdict(node, context, query, rc)`. It has the same signature and return type (`SymbolReferencesWithTemplates`) as `collectSymbolReferencesWithTemplates`. Internally, both exports compose two private steps. **Template half**: `collectTemplateUsages` plus mapping each usage to a `SymbolReference`. **Merge**: TS locations, origin tags, sort, paginate. When coverage is `not_applicable`, the merge returns `collectSymbolReferences` unchanged. | The builder calls `collectTemplateUsages` itself, which leaks template internals. An option flag on the existing export, which is a boolean behaviour switch. |
| Failure sources | Only the verdict export wraps the template half. A cooperative interruption (`isCooperativeInterruption`) is rethrown. Any other error becomes `{status:"unfinished", reason:"template_unresolved", templates:0}` with no template items, and the merge then runs once. A throw from the TS half propagates to the builder's existing catch (`:388-391`), which reports `references_unresolved`. The TS work never runs twice. | Catch everything in the builder and retry synchronously: TS work runs twice and the builder fabricates coverage. A typed wrapper error on the shared export: it changes the error identity of `ast_find_references`. |
| Builder call | `await collectSymbolReferencesWithTemplateVerdict(node, effectiveContext, {symbolPath: record.selector, includeDeclaration: true, detail: request.referenceDetail, offset: 0, limit: request.referenceLimit}, requestContext)`. `effectiveContext` is the `ProjectContext` already in scope (`:315`). `ExploreEvidence.references` becomes `SymbolReferencesWithTemplates`. | — |
| Omission | Emitted in the existing loop at `:422`. When `item.references?.template_coverage` is present and its status is not `completed` or `not_applicable`, it pushes `{subject, category:"incomplete", component:"references", reason:"template_coverage_incomplete"}`. Builder omissions sit outside trimming (`:123`, `:218`), so the omission survives `byte_limit` trimming. `evidence_complete` and `complete` become false through `effectiveOmissions.length` (`:145-148`). `createResult` does not change. | Emitting it in presentation, which would couple a generic presenter to template types. |
| Enum | Append `"template_coverage_incomplete"` to `EXPLORE_OMISSION_REASONS`. The category and component enums already contain `incomplete` and `references`. | A new category or component, which would change two more enums for no gain. |
| Shared schema | `src/tools/template-evidence-schema.ts` exports three schemas. `ReferenceOriginSchema` is the enum. `TemplateCoverageSchema` is moved verbatim. `templateEvidenceFields` is `{template_coverage, template_reference_count}`, both optional. find_references spreads `templateEvidenceFields` at the same key position (after `affected_files`, before the pagination fields), so the JSON schema bytes do not change. | Duplicating the 9-reason enum (drift). |
| Explore schema | `ExploreReferenceSchema` gains `origin: ReferenceOriginSchema.optional()`. The references object spreads `templateEvidenceFields`. A plain `z.object` strips unknown keys, so without this change the new fields would vanish at `:324`. | — |
| Isolation | By construction: only `context-builder.ts`, `find_references.ts` and `operations.ts` (`findNonDeclarationReferences`, for rename) import `references.ts`. `impact.ts`, `test-candidates.ts`, `call-spines.ts` and `relationships.ts` do not. | — |
| Scan budgets | Per symbol, unchanged. The 2000-component case exceeds `SCAN_LIMITS.templates` and yields `work_exhausted`, which is a typed result. | A shared budget per request, which makes verdicts depend on order. |

`find_references` registers no `outputSchema`, so `tools_list_sha256` does not cover it. A golden test therefore proves byte identity. That test is written first, on unmodified code. It compares `JSON.stringify(z.toJSONSchema(ReferenceOutputSchemas[detail]))` for `locations` and `context` with `test/fixtures/find-references-output-schema.json`. `ReferenceOutputSchemas` becomes a module export; that does not change any tool contract.

## Data Flow

    buildExploreContext ─ per record ─→ collectSymbolReferencesWithTemplateVerdict
                                          ├ template half (try) ── throw → unfinished/template_unresolved
                                          │                        cooperative → rethrow
                                          └ merge (TS half) ────── throw → builder: references_unresolved
         ← SymbolReferencesWithTemplates
    omission loop: has_more → reference_limit; non-completed coverage → template_coverage_incomplete
    → presentExploreClusters (trimming keeps builder omissions) → ExploreOutputSchema.parse

## File Changes

| File | Action | ~Lines |
| --- | --- | --- |
| `src/services/references.ts` | Modify: two private steps, the verdict export | 40 |
| `src/services/context-builder.ts` | Modify: the call, the type, the omission | 25 |
| `src/services/explore-presentation.ts` | Modify: the enum value | 1 |
| `src/tools/template-evidence-schema.ts` | Create | 25 |
| `src/tools/find_references.ts`, `src/tools/explore.ts` | Modify | 35 |
| `test/template-evidence-schema.test.ts`, its golden JSON | Create | 70 |
| `test/references-template-verdict.test.ts` | Create | 80 |
| `test/explore-unchanged.test.ts` | Invert; non-Angular and `not_applicable` deep-equal goldens | 70 |
| `test/explore-template-evidence.test.ts` | Create | 240 |
| `test/mcp.integration.test.ts` | Angular batch parity (next to `:1558`) | 40 |
| `test/fixtures/tool-inventory.json`, `scripts/registry-consumer-smoke.mjs:61-62`, `scripts/canary-local-mcp.mjs:172-173` | Re-pin. The canary value is computed from its own guard=allow run, not copied from the inventory digest | 6 |
| `scripts/benchmark-explore-templates.mjs`, `package.json`, `test/benchmark-explore-templates.test.ts`, `docs/spikes/0380-explore-template-latency.md` | Create | 210 |
| `test/angular-docs.test.ts:29-31`, README, `SKILL.md`, `references/operations.md`, CHANGELOG Unreleased | Modify | 60 |
| `releases.json`, `test/skill-installer.test.ts`, two `*-0.17.0.md.gz.base64` archives (generated) | Modify/Create | 22 |

Total: about 920 authored lines, which is over the 800 budget. **Recommendation: two chained PRs.**

- **PR 1** (~620 lines): the core, schemas, the golden, behaviour tests, the inversion, batch parity, and the three pins. The pins must land with the schema change.
- **PR 2** (~300 lines): the benchmark and its recorded result, docs, the skill bump to 4.9.0 with the 4.8.0 predecessor (`npm_versions: ["0.17.0"]`), the installer fixtures, the docs-test inversion, and CHANGELOG. PR 2 closes #380.

PR 1 leaves the docs saying "TypeScript-only", which is stale but passes the tests. No release is cut between the two PRs.

## Interfaces / Contracts

```ts
export async function collectSymbolReferencesWithTemplateVerdict(
  node: Node, context: ProjectContext, query: TemplateReferenceQuery, rc?: RequestContext,
): Promise<SymbolReferencesWithTemplates>; // template-half failure → unfinished/template_unresolved; TS-half and cooperative errors throw
```

## Testing Strategy (Strict TDD, in order)

1. **Characterization (green on main).** The find_references schema golden. A non-Angular explore deep-equal golden and an Angular `not_applicable` golden, direct and batch, captured before the switch.
2. **Unit (`references-template-verdict`).** It uses `vi.mock` of `angular-templates.js`.
   - A template throw gives the synthetic verdict, TS items tagged `compiler`, and template collection called once.
   - `REQUEST_CANCELLED` propagates.
   - A TS-half throw propagates.
3. **RED inversion.** In `explore-unchanged`, the Angular member now shows template items. The source assertion requires the verdict export.
4. **Integration (`explore-template-evidence`).**
   - A private member used only in its template is `completed`.
   - Parity with find_references for an `@Input`, a pipe and an inherited member.
   - Fixture-reachable reasons: `compiler_missing`, `template_parse_error`, `size_exceeded`.
   - `work_exhausted` through a mocked collection.
   - The shared limit: 3 TS + 4 template items with limit 5.
   - `byte_limit` trimming keeps both omissions.
   - The fallback, and `reference_detail=context`.
   - **Isolation:** impact, test-candidate and call-spine outputs have no `.html` and no `template_` origin.
5. **Batch parity** for Angular (JSON and TOON).
6. **Pins and docs tests**, then the benchmark test, which checks the report shape at `components: 3, runs: 1` with no timing assertion.

**Latency measurement.** The script runs as `yarn benchmark:explore-templates`. It is not part of `yarn test`, so it cannot make CI flaky. Setup:

- It imports `generateMatrixProject` and `createAngularFixture` from TypeScript, as the #421 spike does.
- `components: 167` gives 501 components and `components: 667` gives 2001.
- The query is `label` with `detail: "full"` and `limit: 20`.
- The baseline is the same tree without `@angular/core`.

Each case gets 1 warm-up run plus 10 measured runs. The script records p50/p95 wall time, the cold first call and peak RSS. It also asserts that every 2000-component response parses against `ExploreOutputSchema`.

The results go in `docs/spikes/0380-explore-template-latency.md`, with the machine, Node version and commit, and in Engram. If a check fails, a cache follow-up issue is filed before release.

## Threat Matrix

N/A: the change has no routing, shell, subprocess, VCS/PR automation, executable-file classification or process-integration boundary. The benchmark runs in-process.

## Migration / Rollout

All fields and the enum value are additive. Non-Angular output is byte-identical. To roll back, revert PR 2, then PR 1. The pins and the skill version revert with them.

## Open Questions

- [x] Recording 4.8.0 with `npm_versions: ["0.17.0"]` requires 0.17.0 to publish the 4.8.0 bytes first. The CHANGELOG says 0.17.0 is not yet published. PR 2 must merge after that publish. Closed: 0.17.0 was published to npm `next` on 2026-11-10 (commit e49987b) with the 4.8.0 skill bytes, so the ordering gate is satisfied.
