## Exploration: Honest Scoped Call Coverage Substrate (Issue #247)

### Status and Authority

- **Status:** Success. The change is ready for proposal without an exploration blocker.
- **Change:** `2026-09-06-issue-247-honest-scoped-call-coverage`.
- **Persistence:** OpenSpec.
- **Authority:** GitHub issue #247 is open with `status:approved` and `type:feature`.
- **Baseline:** local `main`, local `HEAD`, and `origin/main` all resolve to `6173a39a73f1540c17335a330ea7f14f982387cb`.
- **Independence:** issue #247 is the sole implementation authority. Closed issues #186 and #188, their branches, commits, PRs, reviews, and Judgment outcomes are evidence only and confer no review, correction, or delivery authority.
- **Dependency direction:** active issue #219 depends on this prerequisite. This change does not depend on #219 and must not implement its computed union-key classifier behavior.
- **Workspace:** pre-existing untracked `openspec/changes/2026-09-06-issue-219-computed-key-call-authority/` was present at start and was not modified. There is no open PR for #247; the only open PRs are unrelated Dependabot PRs #3, #5, and #53.
- **RDD mode:** `disabled/unmanaged`; no repository RDD enablement was found. No receipt, acquire/settle, review, Harness, commit, push, PR, or issue mutation was performed.

### Current State

The public relationship vocabulary in `RELATIONSHIP_EDGE_KINDS` advertises `reference`, `import`, `export`, `extends`, `implements`, `call`, and `contains`. `ast_get_impact` accepts any of those kinds and defaults an omitted filter to all seven.

`createCompilerRelationshipResolver().edgesFor(...)` registers scoped producers for references, imports, exports, and heritage. It registers no scoped `call` or `contains` producer. Its result has only one `incomplete` boolean, driven by edge/work limits. A requested kind with no producer therefore contributes no edge and no incompleteness.

`traverseCompilerImpact(...)` treats resolver incompleteness as traversal truncation and returns `incomplete: false` whenever no budget reason was recorded. It has no representation for producer support, semantic completion, or proven emptiness.

A separate whole-project `collectCompilerCallRelationships(...)` supports `ast_explore.call_spines`. It recognizes call/new/tagged-template syntax and emits only a single compiler-resolved target, but it is not used by scoped impact and cannot report why an invocation was skipped. Reusing its empty result as completion would preserve the same authority defect.

`ast_find_test_candidates` forces incoming traversal with the default seven-kind set. It rejects only `impact.incomplete`/truncation or non-exact returned edges. Because absent producers emit neither edges nor incompleteness, the tool can publish `completeness: { complete: true, proven_empty: true }` without proving every requested relationship cell.

This conflicts with ADR 0007, which says unsupported kinds remain incomplete and unmarked bounded gaps are forbidden, and ADR 0012/the affected-test-candidate spec, which permit proven empty only after complete authoritative traversal.

### Main Reproductions

#### R1 — Registered MCP false empty for a uniquely named direct call

The built registered MCP transport was invoked against baseline `6173a39` for:

```ts
export function createPaginationInputSchema(...) { ... }
export const PaginationInputSchema = createPaginationInputSchema();
```

Command scenario: `ast_get_impact`, root `src/services/pagination.ts#createPaginationInputSchema`, `direction: incoming`, `relationship_kinds: ["call"]`, depth 1, 10 nodes, 10 edges.

Observed:

```json
{
  "relationship_kinds": ["call"],
  "nodes": [{ "endpoint": { "symbol_path": "createPaginationInputSchema" }, "depth": 0 }],
  "edges": [],
  "visited_nodes": 1,
  "visited_edges": 0,
  "incomplete": false,
  "truncation": { "truncated": false, "reason": null },
  "truncation_reasons": []
}
```

The direct invocation is present at `src/services/pagination.ts:28`, yet scoped incoming call impact reports an apparently complete empty graph. This is the minimal current-main defect and does not rely on computed keys, polymorphic dispatch, or historical code.

#### R2 — Candidate proven-empty authority is structurally under-specified

The registered MCP integration baseline explicitly expects `formatValueHelper`, which has no eligible test in its fixture, to return:

```json
{
  "candidates": [],
  "total": 0,
  "completeness": { "complete": true, "proven_empty": true }
}
```

That traversal requests all normalized kinds internally, while scoped `call` and `contains` have no producer or coverage state. The result may be observationally empty, but it is not a proof over the advertised request. This is an authority defect even when the empty candidate list happens to be correct.

#### R3 — Existing green tests are a coverage gap

`yarn vitest run test/relationships.test.ts test/impact.test.ts test/test-candidates.test.ts --reporter=dot` passed **68/68** on baseline. The whole-project call test covers resolved free functions, constructors, and tagged templates; scoped impact tests do not request `call`. Green baseline tests therefore do not contradict R1 or R2.

### Minimal Root Cause

The smallest causal invariant is:

> Every requested relationship kind/direction cell must have deterministic applicability and completion evidence before impact or affected-test consumers may claim completeness or proven emptiness.

Three missing pieces violate that invariant:

1. **No coverage ledger:** `CompilerRelationshipResolution` cannot distinguish a completed empty producer from an absent producer or a producer that stopped on semantic uncertainty.
2. **No scoped call producer:** exact direct calls cannot become scoped edges, and uncertain calls cannot mark only their applicable direction unfinished.
3. **Consumers conflate no edge with proof:** impact derives incompleteness only from traversal budgets, and candidates derive proven empty from `candidates.length === 0` after that incomplete check.

The minimal independently justifiable substrate is therefore coverage contract → impact propagation → conservative scoped calls → candidate completeness. None of those layers can be omitted while satisfying issue #247.

### Recommended Coverage Contract

Use one deterministic cell for each requested kind and effective direction (`incoming`, `outgoing`), with endpoint class retained so module applicability cannot mask symbol applicability:

```ts
type RelationshipCoverageStatus = "not_applicable" | "completed" | "unsupported" | "unfinished";

interface RelationshipCoverageEntry {
  kind: RelationshipEdgeKind;
  direction: "incoming" | "outgoing";
  endpoint_class: "module" | "symbol";
  status: RelationshipCoverageStatus;
}
```

Semantics:

- **`not_applicable`:** the kind/direction cannot apply to that endpoint class; it does not block completeness.
- **`completed`:** the registered producer exhaustively inspected that applicable cell within semantic and work/edge bounds; zero edges is meaningful.
- **`unsupported`:** the cell is applicable but no producer exists. It blocks completeness and proven empty.
- **`unfinished`:** a producer exists but ambiguity, unresolved dispatch, cancellation, work exhaustion, or another bounded stop prevented proof. It blocks completeness and proven empty.

Ordering must be canonical: `RELATIONSHIP_EDGE_KINDS` order, then incoming before outgoing, then endpoint class if aggregation contains both classes. Duplicate observations aggregate by fail-closed precedence rather than observation order: `unfinished` > `unsupported` > `completed` > `not_applicable`. A completed observation must never erase an unfinished observation for the same cell.

Keep budget truncation separate from semantic coverage. `truncation` and `truncation_reasons` continue to describe depth/node/edge/record bounds; coverage describes producer authority. `incomplete` becomes true when either channel is incomplete. `proven_empty` is true only when there are zero selected edges, traversal is not truncated, and every requested applicable coverage cell is completed (with remaining cells not applicable).

`contains` remains in the vocabulary but reports `unsupported` for applicable explicit/default requests. This is the honest minimal behavior; implementing containment is not required. The resulting default-all-kinds impact may become incomplete because the existing default includes `contains`. Proposal/design must call out that deliberate fail-closed migration rather than hiding it by silently changing the default set.

### Bounded Scoped Call Producer

Implement scoped call discovery inside `createCompilerRelationshipResolver`, sharing the existing work tracker, cancellation checkpoints, deterministic candidate ordering, neighbor restrictions, excluded relationship IDs, edge limit, and stop-after-first behavior.

Minimum supported exact shapes should be limited to compiler-resolved direct invocation sites for which one project declaration and one containing caller are proven, initially including direct identifier calls, direct constructors, and direct tagged-template identifiers. Exact edges retain the existing normalized `call` edge contract.

For incoming discovery, start from compiler references/declarations associated with the queried target and classify only invocation-shaped relevant sites. Unrelated dynamic calls elsewhere must not poison the target's incoming cell. For outgoing discovery, scan only the selected caller's owned body and exclude nested named call owners, matching existing scoped ownership rules.

When the producer encounters a relevant invocation that cannot be reduced to one exact project target, it emits no guessed edge and marks that call direction `unfinished`. Unresolved, ambiguous, external, dynamic, property/element dispatch, or multiple-declaration cases use this conservative fallback unless a proof already present on main establishes exactness. Directional isolation is mandatory: outgoing uncertainty must not downgrade an independently completed incoming cell, and vice versa.

This substrate must not enumerate computed union keys, unify property/element receiver alternatives, or implement issue #219's convergence classifier. A computed or otherwise complex element access may conservatively remain unfinished without classifying its alternatives. Likewise, issue #220 external-alternative convergence is excluded; unproven external alternatives remain unfinished.

The whole-project `collectCompilerCallRelationships` remains a separate call-spine producer. Shared low-level invocation-shape helpers are acceptable only if they preserve each consumer's independent bounded/completeness contract. Do not claim call-spine parity for uncertain dispatch until a later authorized classifier change.

### Impact and Candidate Propagation

`CompilerRelationshipResolution` should add coverage (and, if needed for one shared bound, a typed work snapshot) without removing existing fields. `traverseCompilerImpact` aggregates coverage from every probed endpoint and returns additive public `coverage`, `work`, and `proven_empty` fields. Existing `incomplete` remains but becomes semantically stronger.

`assertExactImpactEvidence` should be replaced or complemented by one predicate that requires:

- fresh compiler evidence;
- every returned edge exact/resolved/compiler-authoritative;
- no traversal truncation;
- no exhausted work bound;
- no `unsupported` or `unfinished` requested applicable coverage cell.

`ast_find_test_candidates` should freeze the six incoming relationship kinds relevant to affected-test discovery: `reference`, `import`, `export`, `extends`, `implements`, and `call`. It must explicitly exclude `contains`; containment is not required to prove incoming affected tests under this change. It should publish the admitted coverage/work metadata and return `INCOMPLETE_EVIDENCE`, never an empty page, when any selected cell is unsupported or unfinished. `proven_empty` remains candidate-level and is true only after the complete six-kind gate.

### Exact Source and Compatibility Map

#### Primary source symbols

- `src/services/relationships.ts`
  - `RELATIONSHIP_EDGE_KINDS` / `RelationshipEdgeKind` — preserve all seven public kinds.
  - `CompilerRelationshipQuery` — retains direction/kinds/edge/work/restriction inputs.
  - `CompilerRelationshipResolution` — additive coverage authority surface.
  - `ScopedEdgeCollector`, `consumeScopedWork`, `addScopedEdge`, scoped candidate helpers — bounded producer substrate.
  - `createCompilerRelationshipResolver` / `edgesFor` — coverage registry and incoming/outgoing call producers.
  - `callLikeExpression`, `unwrapInvocationExpression`, `locatedCallTarget`, `collectCompilerCallRelationships` — whole-project call-spine evidence; reuse only narrowly.
- `src/services/impact.ts`
  - `ImpactResult` (or a compiler-specific extension) — additive coverage/work/proven-empty fields.
  - `normalizeRelationshipKinds` — retain existing default unless proposal explicitly accepts the documented migration.
  - `traverseWithNeighborProvider` — aggregate producer coverage separately from truncation.
  - `traverseCompilerImpact` — carry resolver coverage/work into the public result.
  - `assertExactImpactEvidence` / `isExactImpactEdge` — complete-evidence gate.
- `src/services/test-candidates.ts`
  - `findTestCandidates` — consume only complete exact impact evidence; candidate classification/path logic otherwise remains unchanged.
- `src/tools/get_impact.ts`
  - `ImpactOutputSchema`, `registerGetImpact` — expose additive coverage/work/proven-empty JSON and TOON fields. Do not add a universal MCP `outputSchema`.
- `src/tools/find_test_candidates.ts`
  - `FindTestCandidatesOutputSchema`, `registerFindTestCandidates` — use six-kind incoming traversal and fail closed on incomplete coverage.
- `src/tools/relationship-schema.ts`
  - add reusable coverage/work schemas for the two public tools.

#### Test and audit surfaces

- `test/impact.test.ts` — coverage ordering/precedence, unsupported/unfinished/completed states, directional isolation, exact scoped calls, work/edge/depth behavior, and impact aggregation.
- `test/relationships.test.ts` — retain whole-project call-spine behavior and add only helper-level tests if shared classification changes.
- `test/test-candidates.test.ts` — complete-evidence predicate and proven-empty rejection.
- `test/mcp.integration.test.ts` — registered JSON schemas, R1 regression, candidate incomplete error, true proven empty, and JSON/TOON impact parity.
- `test/relationship-schema.test.ts` — new file only if reusable public schemas merit focused canonical validation.
- `test/batch.test.ts` — candidate batch parity remains through the registered implementation.
- `scripts/cli-smoke.mjs` / candidate batch smoke and `scripts/mcp-smoke.mjs` — update only if additive output fixtures assert exact shapes.
- `benchmark/impact-corpus.json` and `scripts/benchmark-agent-workflows.mjs` — add an honest unsupported/unfinished negative control only if the current benchmark can represent coverage without expanding into issue #219.
- `README.md`, `skills/structural-code-editing/references/runtime-and-reading.md`, ADR/spec deltas — document the distinction between unsupported, unfinished, and proven empty with the behavior unit that exposes it.

#### Compatibility surface

- Relationship kind strings and edge shape remain unchanged.
- Coverage/work/proven-empty are additive in impact JSON/TOON; TOON remains a lossless representation of the same logical object.
- `ast_get_impact` currently has no MCP `outputSchema`; this change must not introduce a universal output-schema project.
- Candidate output already has a local Zod/MCP output schema; additive coverage/work fields must be reflected there and in batch parity.
- `incomplete` broadens from budget-only to budget-or-semantic incompleteness. Existing consumers that equate `incomplete` with `truncation.truncated` must migrate to inspect both truncation and coverage.
- Some previously successful empty impact/candidate responses will become incomplete errors. This is intentional fail-closed correction, not a wire-kind removal.

### Acceptance Matrix

| Case                                                         | Expected edge/coverage                                                                  | Impact authority                                                               | Candidate authority                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| Incoming uniquely named direct identifier call               | One exact `call`; incoming call `completed`                                             | complete, not empty                                                            | exact path may contribute                         |
| Outgoing direct identifier/new/tagged-template call          | Stable exact edges; outgoing call `completed`                                           | complete within bounds                                                         | N/A (candidate traversal is incoming)             |
| Supported direction with no relevant invocation              | Zero edges; cell `completed`                                                            | `proven_empty: true` only if all other requested cells complete/not applicable | empty allowed only after full six-kind gate       |
| Explicit applicable `contains` query                         | `contains: unsupported`                                                                 | `incomplete: true`, not truncated, not proven empty                            | contains is not requested by candidate tool       |
| Module endpoint for a semantically impossible call direction | `not_applicable`                                                                        | does not independently block completion                                        | N/A                                               |
| Relevant dynamic/unresolved/multiple-target invocation       | No guessed edge; applicable call cell `unfinished`                                      | `incomplete: true`, not proven empty                                           | `INCOMPLETE_EVIDENCE`                             |
| Generic property/element dispatch without current-main proof | No guessed edge; applicable call cell `unfinished`                                      | incomplete                                                                     | incomplete error; no #219 alternative enumeration |
| Work or cancellation boundary                                | unfinished coverage plus typed exhausted work; existing bounded reason where applicable | incomplete                                                                     | incomplete error                                  |
| Mixed completed reference plus unsupported contains          | reference edge retained; contains unsupported                                           | incomplete despite useful edges                                                | N/A                                               |
| Incoming/outgoing `both` with uncertainty in one direction   | independent ordered cells                                                               | only uncertain direction unfinished; aggregate incomplete                      | N/A                                               |
| True no-test result over six selected incoming kinds         | all applicable cells completed; no test nodes                                           | complete                                                                       | `proven_empty: true`                              |
| JSON versus TOON impact                                      | identical logical coverage/work/proven-empty                                            | equivalent                                                                     | N/A                                               |
| MCP versus batch candidate call                              | same registered implementation and error/result                                         | N/A                                                                            | equivalent complete/error decision                |

### Strict RED Feasibility

Strict RED is feasible at each work-unit boundary without relying on #219:

1. **Coverage model RED:** tests import the absent status/entry contract and expect fourteen ordered symbol cells for a `both`/all-kinds request; current main fails at compile/assertion time.
2. **Impact authority RED:** R1 expects incoming `call` to be `unsupported`, `incomplete: true`, and not proven empty before a producer exists; current main returns `incomplete: false` with no coverage.
3. **Scoped call RED:** after the coverage unit, direct identifier/new/tagged-template tests expect exact completed call edges, while a generic unresolved callback expects `unfinished`; the pre-unit state remains `unsupported` and fails distinctly.
4. **Candidate RED:** candidate tests expect a frozen six-kind incoming set, rejection of unfinished call coverage, and true proven empty only after all six cells complete; current main can publish proven empty without those cells.
5. **Public parity RED:** registered MCP JSON/TOON and batch assertions require the additive fields and equivalent decision; current schemas/results lack them.

Each implementation commit must include its RED-turned-GREEN tests. Do not merge a standalone failing-test PR.

### Feature Branch Chain Forecast

Historical recovery is sizing evidence only: old U2 was 394 authored changed lines, old U3 was 365, and old candidate recovery was 338 across its implementation/test files. Blind replay is prohibited, and combining those concepts would exceed the 400-line review budget.

Use a tracker branch rooted at `6173a39`, then the following immediate-predecessor chain. Every slice must remain at or below 400 authored additions plus deletions, include tests with behavior, and be independently revertible:

| Unit | Branch / immediate base                                        | Deliverable behavior                                                                                      | Forecast | Rollback                                                             |
| ---- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| U1   | `feat/247-u1-coverage-contract` ← feature tracker at `6173a39` | Coverage statuses, deterministic registry cells, precedence, focused resolver tests                       | 280–380  | Revert coverage types/registry/tests; old edge resolution remains    |
| U2   | `feat/247-u2-impact-authority` ← U1                            | Aggregate coverage/work, semantic `incomplete`, `proven_empty`, get-impact public fields and parity tests | 300–390  | Revert impact projection/schema/tests while U1 remains internal      |
| U3   | `feat/247-u3-scoped-direct-calls` ← U2                         | Bounded conservative incoming/outgoing scoped call producer; exact direct shapes and unfinished fallback  | 320–395  | Revert call producers/tests; call cells return unsupported via U1/U2 |
| U4   | `feat/247-u4-candidate-completeness` ← U3                      | Frozen six-kind candidate traversal, complete-evidence gate, schema/MCP/batch tests                       | 300–390  | Revert candidate gate/output additions; impact honesty remains       |
| U5   | `docs/247-u5-contract-and-audit` ← U4                          | Spec/ADR/guidance/benchmark or smoke convergence and final evidence                                       | 180–320  | Revert documentation/audit-only behavior without source rollback     |

If any slice forecasts above 400 after exact tasking, split tests and implementation by a still-working behavior boundary, not by file type. For example, split U3 into incoming direct calls and outgoing direct calls only if each child is independently usable and tested. Do not seek a size exception during proposal.

### Approaches

1. **Recommended: narrow new coverage contract plus conservative scoped direct-call producer**
   - Pros: independently derived from current main; fixes the general false-empty invariant; makes uncertainty explicit; leaves #219/#220 as genuine later refinements; supports isolated rollback.
   - Cons: additive public metadata and stronger incompleteness semantics require migration; property/element call coverage remains conservative.
   - Effort: High, but chainable.

2. **Reuse the whole-project call collector inside scoped impact**
   - Pros: less new code and existing call-shape tests.
   - Cons: cannot distinguish skipped unsupported/ambiguous invocations; scans too broadly; does not obey scoped neighbor/probe semantics; risks false completion.
   - Effort: Medium; rejected.

3. **Replay #188 U2–U5 and #186 classifier code**
   - Pros: historical code and tests exist.
   - Cons: violates independent authority, carries invalidated classifier assumptions, imports #219/#220 defects, and exceeds review focus.
   - Effort: High; prohibited.

4. **Add only a boolean `calls_supported` or force every empty result incomplete**
   - Pros: small patch.
   - Cons: cannot isolate kind/direction, distinguish unsupported from unfinished, aggregate traversal honestly, or permit true proven empty.
   - Effort: Low; insufficient.

### CI and Audit Baseline

- Local focused relationship/impact/candidate tests: **PASS**, 3 files and 68 tests.
- Local `yarn typecheck`: **PASS**.
- Baseline GitHub Security workflow for exact SHA `6173a39`: **PASS**.
- Baseline GitHub CI for exact SHA `6173a39`: **FAIL** only in Node 22.13.0 `yarn test:dsh-adapter`; the Node 24 quality job passed format, lint, typecheck, tests, build, MCP/errors/lifecycle/CLI/package smokes, DSH adapter, audit, pack dry-run, workflow policy, and diff check. Historical failed logs were unavailable from `gh run view`.
- Current local `yarn npm audit --all --recursive`: **FAIL** with four high `fast-uri@3.1.5` advisories through `ajv@8.20.0` and two moderate `qs@6.15.3` advisories through `express@5.2.1`. This is baseline dependency drift, not caused by issue #247; open Dependabot PRs may conflict with lockfile assumptions and should be rebased before final verification.
- No coverage provider or threshold is configured. Verification must use scenario/requirement coverage rather than claim line coverage.

### Risks and Migration

- **Default-all migration:** explicit/default `contains` becomes visibly unsupported unless the caller filters it. This may make formerly apparently complete impact results incomplete. Do not add contains merely to avoid surfacing the truth.
- **Over-conservative calls:** marking every project uncertainty unfinished can make broad outgoing queries unusable. Scope incoming analysis to target-relevant references and outgoing analysis to the selected caller.
- **False exact dispatch:** a unique resolved signature is not always a unique runtime implementation. Exact support must stay narrower than historical #186 logic; unproven property/element dispatch remains unfinished.
- **Coverage aggregation masking:** merging by observation order or without endpoint class can let completed/not-applicable cells erase unfinished symbol work.
- **Probe semantics:** edge/node/depth probes still perform discovery. Their coverage and shared work must be included even when no edge is admitted.
- **Candidate regression:** six-kind completeness can turn prior empty results into errors. That is required where call discovery is unfinished; true empty fixtures must prove all selected cells.
- **Payload growth:** coverage cells repeat across JSON/TOON and candidate pages. Keep bounded canonical entries; do not weaken evidence by paginating coverage.
- **Line budget:** historical sizes sit near 400. U1/U2 must be separated and U3 must avoid importing the historical classifier.
- **Baseline CI/audit:** Node 22 DSH-adapter failure and current dependency advisories are pre-existing. Final verification must distinguish unchanged baseline failures from change-caused failures without suppressing either.

### Rollback

Rollback is fail-safe when performed in reverse chain order:

1. Revert U5 documentation/audit convergence.
2. Revert U4 candidate completeness/output changes; impact coverage remains available.
3. Revert U3 scoped call producers; U1/U2 must then report call as `unsupported`, never completed empty.
4. Revert U2 public impact propagation; U1 remains internal but no public claim should depend on it.
5. Revert U1 coverage contract only after all consumers are removed.

Never roll back by restoring a false `completed`/`proven_empty` result for an absent or unfinished producer. The safe fallback is explicit unsupported/incomplete behavior.

### Exact Exclusions

- No computed union-key dispatch or receiver/key alternative enumeration from issue #219.
- No external/local receiver-alternative convergence from issue #220.
- No reopening, continuation, replay authority, or review inheritance from issues #186/#188.
- No full historical recovery chain or wholesale cherry-pick.
- No direct `contains` producer unless later proposal evidence proves it strictly necessary; current recommendation is explicit unsupported coverage.
- No universal MCP `outputSchema` project.
- No UI, browser, DeepSeek Harness, or DSH adapter feature work.
- No mutation tools, apply behavior, runtime test execution by the candidate tool, framework heuristics, or whole-program/runtime completeness claims.

### Recommendation

Proceed to proposal under issue #247. Specify the four-state deterministic coverage contract, conservative scoped direct-call support, impact propagation, and six-kind candidate completeness as the required substrate. Use the five-unit Feature Branch Chain above, enforce strict RED within each working unit, and keep issue #219 blocked until this prerequisite is delivered and independently verified.

### Ready for Proposal

**Yes.** The approved authority, exact baseline, independent reproduction, minimal causal invariant, compatibility surface, RED path, rollback, and ≤400-line chain are sufficiently defined. There is no exploration blocker. Proposal must preserve the exclusions and treat current CI/audit failures as explicit baseline evidence rather than silently broadening scope.
