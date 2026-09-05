## Exploration: Issue #187 request-wide work accounting

### Current State

#### Authority, baseline, and phase state

- GitHub issue [#187](https://github.com/yailPeralta/ast-mcp-server/issues/187) is open with exactly the relevant `status:approved` and `type:bug` labels. It authorizes a new independent correction for request-wide sorting and finalization accounting.
- The workspace is clean at sibling recovery base `5d839bb1ee2550e5d0a6404784baa21121e188fa`, the head of open PR #206 (`docs/issue-188-u7-docs`). Issue #187 is now a **sibling from #206**, not a descendant of issue #186.
- Issue #186 and PRs #207–#218 are closed unmerged and terminally escalated. They are historical evidence only. Their changes, receipts, correction rounds, and review authority MUST NOT enter #187.
- Open issues #219 and #220 have no `status:approved` label and describe separate callable-dispatch defects. They MUST NOT enter #187. Issue #188 remains open, approved, and unmerged; its U7 candidate is a prerequisite code baseline, not merged authority.
- RDD is `disabled/unmanaged`: `GENTLE_AI_RDD` and `GENTLE_AI_RUNTIME_AGENT_ID` are unset, and the #188 chain records the same state. No receipt review was started or claimed.
- The AST MCP tools were present but returned no model-visible status or symbol evidence. Source findings below therefore use bounded exact source reads, Git-object evidence, and executable built-artifact probes; they are **textual/runtime evidence, not compiler-authoritative AST-tool evidence**.
- Mode is hybrid with OpenSpec authoritative. This phase writes only this `exploration.md`. No memory/control-plane or Harness mirror was written because the user prohibited Harness activity. As a dedicated explore executor, this phase does not create or mutate orchestrator-owned `state.yaml`.

#### Current tracker dataflow

One mutable `CompilerImpactWorkTracker` is created in `traverseCompilerImpact` (`src/services/impact.ts:621-623`), injected into `createCompilerRelationshipResolver` (`625-630`), captured/reused by `edgesFor` (`src/services/relationships.ts:1756-1759`), copied by reference into every endpoint and producer collector (`1811-1825`, `1959-1972`), and finally snapshotted by `traverseCompilerImpact` (`impact.ts:670`). The tracker is not passed into `traverseWithNeighborProvider` or `collectNeighbors`; all work after each resolver result therefore occurs outside the advertised record.

All accounting calls on the scoped path funnel through:

1. `CompilerImpactWorkTracker.charge` (`relationships.ts:471-479`), which checkpoints before mutating the counter and saturates to `max` before throwing on overflow;
2. `consumeRelationshipWork` (`561-566`) and `consumeScopedWork` (`568-573`) for one unit;
3. `reserveScopedWork` (`575-581`) for a known cardinality; and
4. the separate legacy call collector's direct `tracker.charge` (`2137`), used by `buildExploreContext` call-spine projection rather than by `traverseCompilerImpact`.

Every current tracker charge performs cancellation/deadline checking first through `charge` line 472. Independent checkpoints at `relationships.ts:1741,1751` and `impact.ts:378,407,449,514,547` protect lifecycle/traversal cancellation but do not account work. `relationships.ts:740-741` performs an extra checkpoint immediately before a charged declaration visit. The older whole-project relationship collector's checkpoints at `relationships.ts:2177-2206` are outside the scoped impact tracker.

#### What is already charged

The current resolver charges many producer inspections: endpoint lookup; alias/symbol declarations and declared cardinality reservations; base and implemented types; allowed-neighbor-key preparation; each compiler source file encountered during scoped enumeration; located-symbol/declaration scans; descendant/child scans for references, imports, exports, and calls; base-container traversal; nearest-owner comparisons; containment candidate retention; and containment emission (`relationships.ts:1664-1667`). These existing charges must not be charged again merely because a later stage uses the same item.

### Deterministic Reproduction

A read-only in-memory `ts-morph` probe was run twice against the built U7 artifact with three files: one `target` and two callers. Incoming `call`, depth 1, three nodes, and two edges produced byte-identical edge IDs and these stable counters both times:

```text
source files = 3
resolver(root) consumed_items = 112
whole traversal consumed_items = 328
visited nodes = 3
visited edges = 2
coverage = call/incoming completed
incomplete = false
```

The current exact-bound replay at `max_work_items=328` succeeds with `consumed_items=328`, `exhausted=false`. The one-below replay at 327 returns `consumed_items=327`, `exhausted=true`, `work_limit`, and unfinished coverage, but still retains both compiler-authoritative edges and all three nodes. Thus the existing exact-bound test proves only the current undercount, while one-below still exposes a partial authority-bearing impact page.

For the root resolver alone, exact 112 succeeds with two edges and completed coverage; 111 fails closed inside `edgesFor` with zero edges, unfinished coverage, and `work_limit_reached=true`. The partial-page leak is introduced by traversal retaining earlier successful batches before a later request-wide exhaustion.

The omitted work is deterministic from the same fixture even though it does not change `consumed_items`:

- `scopedSourceFiles` visits and charges three compiler files per incoming producer invocation, but its three-item path sort and three project lookups/output insertions are uncharged.
- Root relationship finalization has two candidates/edges: candidate sorting/emission, cross-producer merge/dedupe, merged ordering, slice/selection, relationship-id ordering, and output emission execute with cardinality two outside their required stage charges.
- Root `collectNeighbors` receives two edges: two edge-order inputs, two edge inspections, two neighbor retentions/dedupes, two final-neighbor sort inputs, and two neighbor emissions occur without tracker charges. Child calls receive zero edges, so their corresponding cardinalities are zero.
- Traversal performs three queue dequeues/dispatches, processes two returned neighbors, admits two edges and two nodes, enqueues two nodes, and finally sorts/emits three nodes and two edges without tracker charges.

A second probe used one class with three direct methods and outgoing `contains`. It deterministically returned `consumed_items=191`, four nodes, and three edges. The three containment candidates are already charged during candidate creation and again for the distinct emission stage, but all three candidates are sorted without a sorting-stage reservation. The correction must add exactly three sort units in that stage, not re-charge candidate inspection or emission.

Frozen PR #185 evidence independently records the same residual defect after two failed correction rounds: final neighbor sorting/emission, sorted compiler source paths, and containment candidate sorting remained uncharged. That evidence explains the defect but grants no current correction or review authority.

### Complete Operation Inventory

The inventory below covers every input-scaled stage in the scoped relationship/impact request and identifies whether it is presently charged. A charge unit is a **stage/item pair**, so one element may be charged once in each genuinely distinct stage but never twice in one stage.

| Area | Input-scaled operation | Current state | Required boundary |
| --- | --- | --- | --- |
| Relationship setup | requested kind normalization and coverage-cell construction | uncharged; bounded by seven kinds/fourteen cells | retain as constant protocol work or reserve cells consistently; do not pretend it scales with project input |
| Neighbor restriction | allowed-neighbor parsing | charged per key | preserve pre-key inspection charge; reserve sorting/emission of resulting unique paths separately |
| Source files | `program.getSourceFiles()` enumeration | charged per compiler file after array acquisition | charge each file before reading path/scope; cancellation first |
| Source files | project-path sorting | uncharged | reserve one unit per sortable retained path before sort |
| Source files | project lookup and returned-array emission | uncharged | charge each path before lookup/emission; do not combine with prior enumeration unit |
| Symbol/type producers | declarations, base types, implementations, symbol scans, descendant scans | charged | preserve; audit bulk reservations for exact cardinality and no double charge |
| Producer registry | producer dequeue/dispatch | uncharged | one unit before invoking each producer |
| Generic candidates | membership/filtering, neighbor-key derivation, dedupe, heap retention/swaps | uncharged | one documented unit per candidate entering retention; if internal heap operations are not independently counted, state that the unit covers bounded retention as a stage rather than comparator calls |
| Generic candidates | retained-candidate sort | uncharged | reserve retained candidate count before sort |
| Generic candidates | flush into producer collector | uncharged | charge each candidate immediately before emission; do not rerun membership/dedupe charges already paid in retention |
| Member-reference pairs | fixed two-direction pair sorting and push | uncharged | pair count is fixed at two but still use the same candidate-stage semantics for consistency |
| Contains | named-symbol gathering, candidate inspection, owner search, candidate preparation | charged | preserve these distinct inspection stages exactly once |
| Contains | candidate sorting | uncharged | reserve candidate count before sort |
| Contains | candidate emission | charged at `1665` | preserve; do not add another emission charge |
| Producer merge | collector-edge iteration, relationship-id dedupe, merged retention | uncharged | one unit before inspecting/retaining each producer edge |
| Relationship finalization | merged sort | uncharged | reserve merged cardinality before sort |
| Relationship finalization | max-edge selection/slice | uncharged | charge each selected/inspected item before selection; define overflow observation separately from output emission |
| Relationship finalization | selected relationship-id sort | uncharged | reserve selected cardinality before sort |
| Relationship finalization | final edge emission | uncharged | charge each edge immediately before returning it |
| Coverage finalization | map/status reduction and aggregate map/dedupe/sort | uncharged | reserve/charge one unit per observed cell before inspection; cells remain protocol-bounded |
| `collectNeighbors` | edge copy and edge sort | uncharged | reserve edge cardinality before sort |
| `collectNeighbors` | kind/match/filter inspection | checkpoint only | one charge before inspecting each ordered edge |
| `collectNeighbors` | neighbor-key derivation, dedupe, retention | uncharged | one charge before each candidate neighbor retention attempt; one stage, no double charge for Map membership plus set |
| `collectNeighbors` | final neighbor sorting | uncharged | reserve unique-neighbor cardinality before sort |
| `collectNeighbors` | neighbor-array emission | uncharged | charge each neighbor immediately before returned-array emission |
| BFS | queue dequeue | checkpoint only | one charge before `shift`/inspection |
| BFS | ordinary resolver dispatch | uncharged | one charge before each provider call |
| BFS probes | edge-full, restriction, known-node, and overflow probe dispatch | uncharged | one charge before every probe; every probe must share the request tracker rather than an ignored local allowance |
| BFS neighbor use | classification, excluded-neighbor filtering, selected-edge dedupe/retention, node retention, queue emission | checkpoint only or uncharged | one documented unit for each separate stage/item, always before inspection or mutation |
| BFS finalization | node sort, edge sort, and page emission | uncharged | reserve each collection cardinality before sort; charge each emitted node/edge before output construction |
| Impact coverage | observation append and aggregate coverage | uncharged | charge cells before append/aggregation, or make the fixed-cell protocol reservation explicit |
| Legacy call projection | source-file sorting, edge Map retention, final edge sorting/slicing/emission in `collectCompilerCallRelationships` | only descendant nodes charged | either apply the same stage semantics to its own tracker or explicitly remove any claim that its `max_work_items` bounds the whole projection; `buildExploreContext` is the consumer |
| Test candidates | `findTestCandidates` node/edge validation, candidate grouping, path BFS/sorts, final candidate sort/page | outside the impact tracker | do not silently claim impact `work` bounds candidate post-processing; candidate tool must reject exhausted impact before running these stages. A future independent bound is preferable to expanding #187 into candidate semantics. |

### Proposed Invariants

1. **One tracker, one request.** Every scoped relationship producer, BFS/probe path, neighbor pipeline, coverage aggregation, and impact finalization uses the exact tracker object created by `traverseCompilerImpact`; no reset or hidden local work allowance is authoritative.
2. **Exact-once stage units.** A unit is one item entering one named input-scaled stage. Sorting charges cardinality, not comparator invocations, because comparator counts are engine-dependent. Retention charges one candidate attempt, not each Map/Set/heap primitive. Emission is a separate unit because it constructs externally retained output.
3. **Charge before observation/effect.** `charge(context, n)` checkpoints first and reserves all `n` units before sorting/materializing a retained stage. Per-item stages charge immediately before reading, classifying, retaining, or emitting that item. A failed bulk reservation performs none of the guarded stage.
4. **Exact-bound semantics.** If total required units equal `max_items`, the request succeeds with `consumed_items=max_items` and `exhausted=false`. `exhausted` means an additional required unit was attempted and denied, not merely that the counter equals its maximum.
5. **One-below semantics.** At `required-1`, the first denied stage saturates the counter, sets `exhausted=true`, and produces typed `work_limit`; all applicable interrupted coverage cells remain `unfinished`.
6. **Transactional authority.** Any request-wide exhaustion discards accumulated authority-bearing edges/nodes from the public page (the root identity may remain for diagnostics), sets `incomplete=true`, denies `proven_empty`, and never emits a partial candidate page. Earlier successful batches cannot survive as an authoritative result.
7. **Cancellation precedence.** Because every charge checkpoints first, cancellation/deadline wins before counter mutation or stage inspection. Cancellation remains the existing typed `REQUEST_CANCELLED`/deadline outcome and returns no partial success.
8. **Stable output.** Charging does not alter comparator keys, relationship IDs, coverage order, traversal order, pagination, or successful JSON data. Exact-bound output must equal generous-budget output byte-for-byte after timestamp normalization.
9. **Consumer fail-closed behavior.** `ast_find_test_candidates` checks exhaustion/incompleteness before candidate projection and returns existing typed `INCOMPLETE_EVIDENCE` with bounded reason `work_limit`, with no candidate page. Call-spine projection must not certify discovery complete after its own work limit.
10. **Public compatibility.** `ast_get_impact` keeps the existing `work`, `coverage`, `incomplete`, and `truncation` shapes. `work_limit` remains a typed truncation reason for impact; no new MCP tool or mutation capability is added. JSON and TOON encode the same successful logical result, while errors remain the same bounded MCP error envelope. Batch/CLI candidate behavior remains logically identical to registered MCP behavior.

### Approaches

1. **Stage-accounting helpers with transactional traversal (recommended)** — extend tracker-aware helpers for cardinality reservation, per-item inspection, and emission; thread the same tracker through relationship finalization, `collectNeighbors`, and BFS; discard accumulated public authority on exhaustion.
   - Pros: explicit exact-once semantics, deterministic tests, smallest conceptual change, preserves output ordering and public schemas.
   - Cons: touches two dense services and requires adversarial review against both omissions and double charging.
   - Effort: High; use two bounded review slices.

2. **Charge low-level operations/comparator invocations** — count every Set/Map/comparator/internal heap action.
   - Pros: superficially fine-grained.
   - Cons: engine-dependent sort counts, brittle totals, easy double charging, difficult exact-bound tests, and repeats the failed PR #185 correction pattern.
   - Effort: High and not recommended.

3. **Redefine `max_items` as producer-only work** — document current counter as partial and leave traversal/finalization unbounded.
   - Pros: smallest code change.
   - Cons: contradicts approved issue #187 and the request-wide public contract; does not repair the safety defect.
   - Effort: Low but rejected.

### Recommendation

Proceed to `sdd-propose` with stage/item units and transactional fail-closed output. First freeze a table of stage names and cardinalities in tests; then implement helpers so review can mechanically prove that every input-scaled stage has exactly one pre-stage or pre-item charge. Reuse no code or authority from closed #186/PR #207–#218, and treat PR #185 changes only as negative evidence about double charging and pre-charge inspection.

### Affected Areas and Forecast

- `src/services/relationships.ts` — tracker validation/helpers; source-file path sorting/emission; generic and containment candidate finalization; producer merge/final output; legacy call collector scope. Forecast **120–190 changed lines**.
- `src/services/impact.ts` — tracker threading through `collectNeighbors` and BFS/probes; final node/edge/coverage accounting; transactional work-limit result. Forecast **100–170 changed lines**.
- `src/tools/get_impact.ts` — only if the proposal chooses an explicit public no-page mapping beyond existing truncation semantics. Forecast **0–35 changed lines**.
- `src/tools/find_test_candidates.ts` — assert existing fail-closed mapping and bounded work-limit reason; production change likely unnecessary. Forecast **0–20 changed lines**.
- `test/impact.test.ts` — cardinality fixtures, exact/generous/one-below equality, every residual sorting/finalization stage, cancellation, deterministic output, and no partial authority. Forecast **180–280 changed lines**.
- `test/relationships.test.ts` — legacy call collector/accounting and call-spine negative control if retained in scope. Forecast **30–80 changed lines**.
- `test/test-candidates.test.ts` — exhausted-impact rejection/no candidate page. Forecast **20–50 changed lines**.
- `test/mcp.integration.test.ts` — JSON/TOON parity, typed work-limit/incomplete mapping, no partial public authority. Forecast **50–100 changed lines**.
- `test/batch.test.ts` or `scripts/cli-smoke.mjs` — only if current candidate MCP/batch parity lacks a work-limit case. Forecast **0–60 changed lines**.

Forecast total is **500–985 authored additions plus deletions**, high risk above the 400-line review budget. Likely split:

```text
PR #206 @ 5d839bb (open U7 sibling base)
├── closed/unmerged #186 line and PRs #207–#218 (historical only; no ancestry)
├── #187A relationship-stage accounting + focused exact-bound tests (target ≤400)
│    └── #187B impact/BFS transactional accounting + MCP/candidate parity (target ≤400)
├── #219 separate unapproved residual (excluded)
└── #220 separate unapproved residual (excluded)
```

Use a feature-branch chain inside #187 only because A and B must integrate together before the #187 sibling can be accepted. #187A starts from the exact #206 head; #187B targets #187A. Both use `Fixes #187` only on the final issue-closing unit as repository convention permits, `Refs #188`, explicit immediate-parent diagrams, separate rollback, and clean diffs. No #186, #219, or #220 hunk is permitted.

### Reviewer Attack Surface

- A candidate can charge both candidate retention and every internal Map/heap primitive, recreating double counting.
- A sort may be charged after the sort or an endpoint key may be inspected before its charge, recreating the prior pre-charge defect.
- Bulk `charge(n)` may partially mutate output before throwing, or `n=0`/unsafe values may bypass tracker invariants.
- Exact-bound tests can self-calibrate to an undercount unless they assert named stage cardinalities and perturb each collection independently.
- Probes may accidentally use an independent 1,024-item allowance or reset the tracker.
- A late failure can leak earlier compiler-authoritative edges, nodes, `proven_empty`, call spines, or candidate pages.
- Cancellation can be converted into `work_limit`, or charging can mutate `consumed_items` before cancellation is observed.
- Sorting fixes can alter deterministic relationship/neighbor/candidate order or JSON/TOON equivalence.
- Legacy `collectCompilerCallRelationships` may continue advertising a whole-operation work bound while source sorting and final emission remain outside it.
- Public schema/tool inventories can drift if a new error field/code is added unnecessarily.

### Rollback and Integration Constraints

Before integration, rollback is branch-local: abandon #187A/#187B and leave PR #206 unchanged. After accumulation, revert #187B first, then #187A; never retain public claims/tests for request-wide accounting without the implementation they verify. A rollback must restore the exact U7 output/schema behavior and cannot revive #186 or old R-01 Judgment state.

The #188 tracker remains non-mergeable until its independently required siblings are resolved under current maintainer authority. Completing #187 does not approve #186, #219, #220, or #188. Conversely, terminal closure of #186 does not block exploration/proposal for the now-independent #187 sibling, but final integration still needs a separately authorized resolution for every outstanding #188 kill switch.

### Risks

- The exact stage-unit vocabulary is a specification decision; implementation before freezing it will invite another double-charge cycle.
- `getSourceFiles()` materializes an array before its length can be reserved. The contract can bound per-file inspection/sorting/emission but must not claim preemption inside the compiler API call itself.
- Candidate post-processing is input-scaled but currently outside impact `work`; broadening #187 into a second candidate budget would increase scope. Keep the consumer fail-closed and open a separate approved issue if a candidate-wide bound is required.
- Current `ast_get_impact` does not expose `max_work_items` as input, so exact/one-below tests are service-level unless a separate public API decision is approved. Do not add an input casually because that expands compatibility surface.
- The U7 branch and PR #206 are unmerged. Any base drift requires rerunning probes, line forecasts, and clean-diff ancestry checks before apply.

### Ready for Proposal

Yes. There are no exploration blockers. The next recommended phase is `sdd-propose` for `2026-09-05-issue-187-request-work-accounting`, with a required design decision that freezes stage/item charge semantics and the `ast_get_impact` work-limit page behavior before implementation. Implementation remains gated by proposal/spec/design/tasks, a ≤400-line chain plan, behavior-first REDs, and independent review.
