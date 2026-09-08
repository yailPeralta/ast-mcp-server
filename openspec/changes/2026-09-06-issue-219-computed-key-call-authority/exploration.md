## Exploration: Issue #219 computed-key call authority

### Current State

#### Baseline and independent authority

- Repository baseline is current `origin/main` commit `6173a39a73f1540c17335a330ea7f14f982387cb`; local `main`, `HEAD`, and `origin/main` were identical and the worktree was clean before exploration.
- GitHub issue #219, `fix(relationships): keep computed-key call alternatives uncertain`, is open and carries `status:approved` and `type:bug`.
- The maintainer comment explicitly authorizes a fresh independent SDD change from current `main` and prohibits reopening or inheriting issue #186 Judgment authority.
- No current repository RDD enablement was found. This exploration therefore records `rdd_mode: disabled/unmanaged`; it creates no receipt, review, settlement, or delivery authority.
- Closed issues #186 and #188, closed PRs #189–#218, and their commits are historical evidence only. Their verdicts, correction budgets, receipts, branches, and implementation are not authority for this change.
- Action context was honored: only this change directory was edited. Source, tests, specifications, ADRs, historical commits, issues, PRs, and DeepSeek Harness were read-only. No commit, push, PR, issue mutation, review, acquire, settle, or apply occurred.

#### Deterministic public reproduction on main

A disposable TypeScript project was created outside the repository, invoked through the built stdio MCP server with the public MCP client, and removed afterward. Its source was:

```ts
export class Base {
  method(): void {}
  other(): void {}
}
export function invoke(base: Base, key: "method" | "other"): void {
  base[key]();
}
```

The exact public results for fresh compiler state were:

1. `ast_explore` incoming call spines for `Base.method` emitted one exact compiler-authoritative edge from `invoke` to `Base.method`, with `authority_state: authoritative`, `incomplete: false`, and `empty_proven: false`.
2. The same request for `Base.other` emitted no path, with `authority_state: authoritative`, `incomplete: false`, and `empty_proven: true`.
3. `ast_get_impact` for `Base.other`, `direction: incoming`, `relationship_kinds: [call]`, returned zero edges, `incomplete: false`, no truncation, and fresh compiler metadata.
4. `ast_find_test_candidates` for `Base.other`, with an included `test/base.test.ts`, returned zero candidates, `compiler_authoritative: true`, `completeness.complete: true`, and `completeness.proven_empty: true`.

This reproduces the user-visible false-authority outcome on main. It also reveals two different implementation causes:

- `ast_explore.call_spines` uses a whole-project call collector that selects `Base.method` for `base[key]()` and has no semantic unfinished signal for the unselected `Base.other` alternative.
- Scoped impact does not currently register any `call` producer, so a requested call cell silently produces no edges and is still reported complete. Test-candidate discovery inherits that false completeness.

Focused existing tests remained green:

```text
yarn vitest run test/relationships.test.ts test/call-spines.test.ts test/impact.test.ts test/test-candidates.test.ts --no-file-parallelism
4 files passed; 76 tests passed.
```

Those green tests are a coverage gap, not contrary evidence: no current scoped-impact test exercises `call`, and the whole-project call test covers only uniquely resolved free functions, constructors, and tagged templates.

#### Main versus historical lineage

Current main contains the public vocabulary but not the historical dispatch/coverage substrate:

- `RELATIONSHIP_EDGE_KINDS` advertises `call` and `contains`.
- `collectCompilerCallRelationships` exists only as a separate whole-project producer for call spines. It resolves one target from the invoked expression/signature and returns only `{ edges, incomplete }`, where `incomplete` means work/edge budget exhaustion.
- `createCompilerRelationshipResolver().edgesFor(...)` registers scoped producers for reference, import, export, extends, and implements. It registers no scoped `call` or `contains` producer.
- `traverseCompilerImpact` exposes traversal truncation as `incomplete`, but has no per-kind/per-direction coverage cells and no impact-level `proven_empty` field.
- `ast_find_test_candidates` treats `!impact.incomplete && !impact.truncation.truncated` as complete evidence and computes `proven_empty` from an empty candidate list.

Historical issue #188 recovery commits added the missing concepts in separate review slices: deterministic per-kind/per-direction coverage, scoped call producers, direct containment, consumer completeness gates, and public schemas. Historical issue #186 then added and repeatedly corrected a callable dispatch classifier. None of that lineage merged into main.

At terminal historical commit `8839978d`, `classifyCompilerInvocation` enumerated receiver-type alternatives only for `PropertyAccessExpression`. `ElementAccessExpression` did not enumerate the union key's member alternatives. For `base[key]()` the selected target could therefore be `Base.method`; an incoming query for `Base.other` could pass the different-name disjoint shortcut and finish the incoming call coverage cell. The immutable terminal ledger at `66727c3` records this as severe finding `R3-F1` and denies approval. This explains issue #219, but grants no implementation authority.

The gap is large and causally prior. Historical main-to-substrate deltas were already near a full review slice each:

- Recovery U2 (coverage aggregation/public completeness foundation): 312 additions + 82 deletions = 394 changed lines across four files.
- Recovery U3 (scoped call coverage): 321 additions + 44 deletions = 365 changed lines across two files.
- Later consumer/schema and callable-classifier work spans additional independent slices. Main-to-terminal historical comparison is far above 400 authored changed lines.

Therefore the same public symptom exists on main, but the narrow #219 classifier defect is not independently reachable there. Main first fails at an absent prerequisite capability.

#### Defect classification

| Classification      | Main finding                                                                                                      | Consequence                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Runtime defect      | Public call spines guess `Base.method` and certify `Base.other` empty for a union computed key.                   | A focused call-spine RED is feasible now.                                                                                 |
| Missing capability  | Scoped impact advertises `call` but has no scoped call producer or coverage cell.                                 | Incoming call impact can report complete empty for every scoped call query, not only computed keys.                       |
| Absent prerequisite | Main lacks the coverage aggregation and callable dispatch classifier on which issue #219's narrow fix is defined. | The approved issue cannot honestly deliver all stated impact, spine, and candidate outcomes as a standalone narrow patch. |

### Affected Areas

#### Current main source and public contract

- `src/services/relationships.ts`
  - `collectCompilerCallRelationships` — whole-project call-spine producer; currently chooses one computed-key target and cannot report semantic unfinished coverage.
  - `createCompilerRelationshipResolver` / `edgesFor` — scoped impact producer registry; has no `call` producer and no per-cell coverage contract.
  - `callLikeExpression`, `unwrapInvocationExpression`, `locatedCallTarget` — current invocation extraction and endpoint resolution.
  - `createRelationshipEdge` — exact authority requires compiler provenance, exact confidence, resolved resolution, and fresh state; this rule must remain unchanged.
- `src/services/context-builder.ts`
  - `buildExploreContext` invokes the whole-project call collector and maps only collector budget exhaustion to `discovery_complete: false`.
- `src/services/call-spines.ts`
  - `planCallSpines` correctly denies empty authority when `discovery_complete` is false or freshness is untrusted, but it cannot infer ambiguity that its producer failed to report.
- `src/services/impact.ts`
  - `traverseCompilerImpact` delegates to the scoped resolver and equates incomplete evidence with traversal truncation/work limits; it has no requested-cell coverage aggregation.
- `src/tools/get_impact.ts`
  - Public schema exposes `incomplete` and truncation but no coverage or explicit impact `proven_empty` field.
- `src/tools/find_test_candidates.ts`
  - Consumer forces incoming traversal without a relationship-kind filter and certifies candidate emptiness whenever traversal is not marked incomplete.
- `src/services/test-candidates.ts`
  - Pure candidate projection assumes its impact input has already passed exact-completeness gates.
- `src/tools/relationship-schema.ts`
  - Contains relationship edge schemas but no per-cell relationship coverage schema on main.

#### Current tests and specifications

- `test/relationships.test.ts` — tests the separate whole-project call collector for exact free function, constructor, tagged-template, and negative dynamic calls; it explicitly proves generic relationship collection has no call edge.
- `test/call-spines.test.ts` — tests planner behavior with supplied edges and `discovery_complete`, but not producer ambiguity.
- `test/impact.test.ts` — tests scoped references/imports/exports/heritage and bounds; no scoped call producer coverage exists.
- `test/mcp.integration.test.ts` — tests ordinary exact call spines and public impact/candidate surfaces; it lacks the computed-key case.
- `test/test-candidates.test.ts` — tests rejection of explicitly incomplete/untrusted impact objects, not absent requested producers.
- `openspec/specs/ast-explore-call-spines/spec.md` — requires dynamic/ambiguous calls to be excluded and only fresh complete traversal to prove empty.
- `openspec/specs/affected-test-candidates/spec.md` — forbids incomplete or unsupported evidence from becoming an empty result.
- `docs/adr/0007-compiler-first-impact-relationships.md` — says unsupported relationship kinds remain incomplete and guessed edges are worse than omitted optional edges.
- `docs/adr/0012-public-affected-test-candidates.md` — requires incomplete analysis to fail closed and reserves `proven_empty` for complete authoritative traversal.

#### Historical evidence only

- Recovery U2 commit/PR #196 — coverage cells and aggregate completeness.
- Recovery U3 commit/PR #198 — scoped call producers.
- Recovery U5 commit/PR #202 — public consumer/schema completeness gates.
- Issue #186 PRs #212–#217 — callable dispatch classifier and corrections.
- PR #218 terminal ledger — severe computed-key finding `R3-F1`; no approval and no remaining correction authority.

### Public Contract and No-Guess Boundary

The stable authority rule is conjunctive: an emitted edge may be authoritative only with compiler provenance, exact confidence, resolved identity, and fresh state. Absence requires stronger proof than edge inclusion. For the supplied call:

- The key domain is exactly `"method" | "other"`.
- Both names identify callable properties on the receiver type.
- The site may invoke either endpoint.
- The compiler does not prove one final implementation for either incoming endpoint at this syntax site.
- Therefore no guessed exact edge may be emitted to either endpoint.
- Applicable incoming call discovery must remain unfinished/incomplete.
- `Base.other` must not receive proven-empty impact, authoritative empty call spines, or proven-empty affected-test-candidate authority.

A property-name mismatch is not disjoint proof for computed element access until every compiler-derived key/receiver alternative has been enumerated and excluded. If key values, receiver alternatives, external declarations, callable ownership, or final implementation convergence cannot be bounded and proven, the result must be unfinished rather than guessed or completed.

### Exclusions

- Do not reopen, extend, or inherit #186 or #188 Judgment, receipt, correction, review, or delivery authority.
- Do not copy the terminal classifier as approved code; it is invalidated historical evidence.
- Do not include issue #220's local/external receiver-alternative defect except as a regression boundary that remains unfinished.
- Do not include issue #187 request-wide work accounting, sorting/finalization accounting, or cancellation redesign.
- Do not claim runtime dispatch or whole-program certainty from static compiler evidence.
- Do not add heuristic/name-only edges, weaken exact confidence, or treat syntax evidence as compiler proof.
- Do not broaden to `contains`, module relationships, index persistence, mutations, apply, or DeepSeek Harness.
- Preserve direct apply absence in DeepSeek Harness; no Harness change is needed or authorized.

### Approaches

1. **Patch only the current whole-project call collector** — detect element-access key alternatives, suppress the selected edge when alternatives diverge, and set its existing `incomplete` flag.
   - Pros: Small, directly RED-testable on main, likely below 400 changed lines, fixes the `ast_explore.call_spines` symptom.
   - Cons: Does not establish scoped impact call coverage, does not correct the general unsupported-kind completeness defect, and cannot honestly satisfy the issue's impact/candidate acceptance boundary.
   - Effort: Medium.

2. **Implement #219 plus the missing coverage/dispatch substrate in one change** — add coverage cells, scoped call producers, classifier, public schemas, consumer gates, and computed-key alternatives.
   - Pros: Could satisfy the full end-to-end behavior.
   - Cons: Broad prerequisite redesign not authorized by the narrow bug issue; historical evidence shows multiple near-400-line work units before #219 itself; high regression and review load; risks silently reviving invalidated #186/#188 lineage.
   - Effort: High and necessarily chained.

3. **Authorize a fresh prerequisite redesign, then deliver #219 independently** — create a new approved authority for the minimal coverage/dispatch foundation from current main, review it independently, then apply #219's computed-key delta as a separate rollback boundary.
   - Pros: Preserves causal authority, no-guess semantics, review budget, independent rollback, and #219's fresh review requirement. The #219 patch can remain narrow after the prerequisite exists.
   - Cons: Requires maintainer authorization and additional phases before #219 can be proposed as deliverable.
   - Effort: High overall; Medium for #219 after the prerequisite.

### Recommendation

Choose Approach 3. Treat issue #219 as valid and reproducible but non-deliverable standalone from baseline `6173a39`. Ask the maintainer to authorize a new prerequisite redesign from current main that supplies only the minimal honest relationship-coverage and scoped call-dispatch foundation. That prerequisite must not inherit #186/#188 authority or blindly replay their invalidated code.

After that prerequisite is independently accepted, #219 should remain its own work unit: enumerate computed element-access key and receiver alternatives, require convergence before exactness, mark unresolved/divergent alternatives unfinished, and verify the same result through scoped impact, call spines, and affected-test candidates.

### Likely Work Units and Review Budget

#### Separately authorized prerequisite (not authorized by this exploration)

1. **Coverage truth model** — per-kind/per-direction `completed | not_applicable | unsupported | unfinished` cells, aggregate completeness/proven-empty rules, schemas, and focused tests.
2. **Scoped call production** — independent incoming/outgoing call producers with exact-edge and unfinished semantics, plus focused compiler tests.
3. **Consumer propagation** — impact, call-spine, and candidate gates consume the same call authority and fail closed.

Each must be forecast and sliced to stay at or below 400 authored additions plus deletions. Historical 394-line and 365-line slices show high budget risk even before consumer propagation.

#### Issue #219 after prerequisite

1. **RED: computed-key authority** — compiler/service tests for `Base.method`/`Base.other` and public MCP assertions that neither endpoint gains guessed exactness or proven emptiness.
2. **GREEN: alternative enumeration** — one shared compiler-derived helper for literal/union computed keys and receiver alternatives; exact only on one converged final target, unfinished otherwise.
3. **Consumer parity controls** — scoped impact, whole-project call spines, and candidates agree; preserve private, `super`, free-function, constructor, tagged-template, budget, freshness, and issue #220 unfinished controls.

The post-prerequisite #219 slice is likely below 400 lines if the foundation exposes one shared classifier. Without that prerequisite, budget risk is High and chained PRs are mandatory.

### RED Feasibility

- **Feasible now, but only for the call-spine symptom:** a public MCP integration test for the supplied fixture would fail because main marks `Base.other` authoritative and empty while choosing `Base.method` exactly.
- **Feasible now for the broader missing-capability defect:** a scoped incoming call-impact test would expose complete empty output even for ordinary direct calls. That RED does not isolate issue #219.
- **Not feasible as an issue-specific scoped classifier RED on main:** the classifier, scoped call producer, and coverage contract do not exist. A test expecting #219's `unfinished` coverage state necessarily specifies prerequisite behavior.
- Strict TDD can resume once the prerequisite authority is resolved. No test was added during exploration because source/tests are read-only.

### Rollback

- Exploration rollback: delete only `openspec/changes/2026-09-06-issue-219-computed-key-call-authority/`.
- Prerequisite rollback, if separately authorized: revert its coverage/producer/consumer work units without reverting #219 planning artifacts or unrelated relationship kinds.
- #219 rollback after prerequisite: revert only computed-key alternative enumeration and its paired tests. The prerequisite's general honest coverage remains intact.
- Never use rollback to restore false exact edges or proven-empty authority; a conservative unfinished result is the safe fallback.

### Risks

- **Authority conflation:** importing historical #186/#188 code may accidentally imply their exhausted review authority transfers. It does not.
- **False narrowness:** fixing call spines alone can leave impact and candidates falsely authoritative.
- **False completeness:** adding a call producer without explicit requested-cell coverage can still certify empty when a producer is absent or unfinished.
- **Classifier coupling:** property access, element access, receiver unions, key unions, private members, accessors, callable properties, constructors, and external declarations share dispatch logic; duplicated classifiers will drift.
- **Issue overlap:** issue #220's external-alternative loss is adjacent but independently authorized; #219 must preserve uncertainty without absorbing that fix.
- **Budget overrun:** the foundation historically required multiple near-limit slices; a standalone implementation would exceed the 400-line review budget.
- **Public schema change:** adding coverage/proven-empty fields affects JSON, TOON, MCP, batch, docs, and tests; compatibility must be explicitly designed under prerequisite authority.
- **Structural evidence limitation:** compiler-backed AST tools were present but returned no model-visible project-status/outline payload in this session. Source mapping therefore used bounded direct reads and textual search, labeled non-compiler-backed. The runtime reproduction itself used fresh public MCP compiler results and is authoritative for observed behavior.

### Ready for Proposal

No. Exploration is complete, the defect is reproducible, and the required no-guess behavior is clear, but proposal should stop until a maintainer authorizes the missing prerequisite relationship-coverage/scoped-dispatch redesign or explicitly narrows #219 acceptance to call spines only. Narrowing would be a maintainer scope decision and would not satisfy the current issue's stated impact/candidate boundary.
