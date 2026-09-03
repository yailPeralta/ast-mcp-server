# Exploration: honest public relationship coverage

## Decision summary

Proceed issue-first from approved bug [#161](https://github.com/yailPeralta/ast-mcp-server/issues/161), whose labels are exactly `status:approved` and `type:bug`. R-01 is the next core-authority item after completed M-02. The safest direction is **exact scoped producers plus mandatory per-kind coverage accounting**: no empty result is complete unless every requested kind/direction/endpoint combination is recorded as completed or explicitly not applicable.

The smallest RED belongs at the registered MCP `ast_get_impact` boundary. It must expose the current false-complete negative before implementation. Do not remove public vocabulary during this change, combine it with T-01/F-01, or alter the DeepSeek Harness surface; Harness apply remains absent and denied.

## Authority and evidence limits

`ast_get_project_status`, symbol searches, and two live `ast_get_impact` probes returned no model-visible payload in this exploration. Therefore the source reads below are **bounded, non-compiler-backed inspection**, not proof of compiler-backed absence. The authoritative RED must execute a real `ts-morph` project fixture through the registered MCP handler. Existing tests already use disposable compiler fixtures and an in-memory MCP transport.

Authority chain:

1. `src/server.ts` registers immutable descriptors from `src/tools/catalog.ts`.
2. `src/tools/get_impact.ts` publishes all seven `RELATIONSHIP_EDGE_KINDS`, requires a fresh project session, resolves an exact root, and calls `traverseCompilerImpact()` with cancellation context and public depth/node/edge bounds.
3. `src/services/impact.ts` normalizes an omitted filter to all seven kinds, performs deterministic BFS, and asks one resolver for each admitted endpoint.
4. `traverseCompilerImpact()` passes the complete normalized kind list to `createCompilerRelationshipResolver().edgesFor()` with a private 100,000-work-item bound.
5. `src/services/relationships.ts` validates all seven names, creates producers conditionally, merges exact compiler edges, and returns only `incomplete`, work-limit, and excluded-neighbor state.
6. `src/services/impact.ts` projects resolver incompleteness only into traversal truncation reasons. If no producer is installed, `edgesFor()` returns `edges: []` and `incomplete: false`; impact therefore reports a complete empty traversal.
7. `src/tools/get_impact.ts` serializes that result without per-kind coverage metadata. The public schema cannot distinguish “producer completed with no edge” from “producer never ran.”

This is the exact defect path: **schema accepts kind → handler forwards kind → traversal forwards kind → `edgesFor()` installs no producer → empty/non-incomplete resolution → public false-complete negative**.

## Consumers of completeness

- `ast_find_test_candidates` does not expose a kind filter. It calls incoming `traverseCompilerImpact()` with the default-all kind set, rejects only `impact.incomplete/truncated`, and emits `completeness.complete: true` plus `proven_empty: candidates.length === 0`. Missing `call`/`contains` coverage can therefore authorize a false `proven_empty` result.
- `findTestCandidates()` separately verifies edge trust and reconstructs paths in both directions. That T-01 directionality question is explicitly out of scope; R-01 changes only whether input impact is complete enough to consume.
- `ast_explore` call spines do **not** use the scoped resolver. `buildExploreContext()` invokes the separate whole-project `collectCompilerCallRelationships()`, passes `!projected.incomplete` to `planCallSpines()`, and projects `authority_state`, `empty_proven`, and omissions. This is useful prior art for honest emptiness but not proof that scoped impact supports `call`.
- Batch admits `ast_find_test_candidates` through its descriptor and invokes the registered implementation; `ast_get_impact` is direct-only. Candidate behavior must remain MCP/batch equivalent.

## Current capability matrix

Legend: **C** = a scoped compiler producer runs and can prove a negative; **N/A** = the edge model cannot be incident in that orientation, but current output does not record that fact; **G** = only a separate whole-project collector exists; **U** = accepted publicly but no scoped producer or coverage record exists.

| Kind         | Symbol incoming                                 | Symbol outgoing                                                                    | Module incoming                             | Module outgoing                             | Whole-project/index distinction                                                                                                                  |
| ------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reference`  | C: incoming reference scan and member relations | C: descendant reference scan and member relations                                  | N/A/no producer                             | N/A/no producer                             | `collectCompilerRelationships()` also emits references; no relationship index is consulted by impact.                                            |
| `import`     | C when symbol is the resolved target            | N/A/no producer because source is a module                                         | C for module targets                        | C for declarations owned by the module      | Generic collector emits module→symbol/module imports; scoped paths independently reproduce them.                                                 |
| `export`     | C when symbol is the resolved target            | N/A/no producer because source is a module                                         | C for module targets                        | C for declarations owned by the module      | Generic collector emits module→symbol/module exports; scoped paths independently reproduce them.                                                 |
| `extends`    | C only for class/interface target roots         | C producer is installed for any symbol, but only class/interface declarations emit | N/A/no producer                             | N/A/no producer                             | Generic collector emits class/interface→base symbol edges.                                                                                       |
| `implements` | C only for class/interface target roots         | C producer is installed for any symbol, but only class declarations emit           | N/A/no producer                             | N/A/no producer                             | Generic collector emits class→implemented symbol edges.                                                                                          |
| `call`       | U                                               | U                                                                                  | U/N/A under the current symbol-caller model | U/N/A under the current symbol-caller model | G: `collectCompilerCallRelationships()` scans sorted project files for resolved call/new/tag sites; generic collector explicitly emits no calls. |
| `contains`   | U                                               | U                                                                                  | U                                           | U                                           | No producer exists in the scoped resolver, generic collector, call collector, or relationship index.                                             |

Precise proof of the gap from bounded source inspection:

- `RELATIONSHIP_EDGE_KINDS` declares all seven names.
- `edgesFor()` validates every requested name and stores it in `relationshipKinds`.
- Producer construction mentions only heritage, `reference`, `import`, and `export`; neither `call` nor `contains` appears in that block.
- An empty `producers` array leaves `incomplete = false` and returns a complete-looking empty result.
- Text search found no `contains` edge construction. This is not compiler-backed absence; the executable fixture must be the authority.
- The generic whole-project collector invokes only reference, module, and heritage collectors. The separate call collector is consumed only by call spines and relationship tests.

The matrix also exposes a broader accounting ambiguity: several valid public requests have no producer because the endpoint class/orientation cannot be incident to that edge. A coverage ledger must distinguish `completed`, `not_applicable`, and `unsupported/not_run`; silently treating all three as an empty success recreates R-01.

## Existing tests and fixtures

- `test/helpers/project-fixture.ts` creates strict NodeNext projects under a disposable root; use it rather than textual mocks.
- `test/impact.test.ts` has extensive scoped-vs-global parity for references, module edges, and heritage, plus ordering, cycles, depth/node/edge probes, private work exhaustion, and irrelevant-scan guards. It has no `call`/`contains` kind request.
- `test/relationships.test.ts` proves whole-project call classification for calls, constructors, tagged templates, callbacks-as-values, and dynamic calls. It explicitly proves generic collection has no `call`; it does not cover overload call resolution or `contains`.
- `test/mcp.integration.test.ts` proves public impact and candidate shapes, including a candidate `proven_empty: true`, but not per-kind coverage.
- `test/call-spines.test.ts` proves stable paths, exhaustion, and empty authority over supplied call edges; it does not exercise scoped impact.
- ADR 0007 already requires unsupported kinds to remain incomplete. ADR 0012 permits candidate `proven_empty` only after complete authoritative traversal. Current behavior violates those accepted decisions.

## RED strategy

### Smallest first RED

Add one MCP integration case using the existing `formatValue`/`result` fixture:

1. Invoke registered `ast_get_impact` for `formatValue`, direction `incoming`, kinds `['call']`, depth 1, and roomy node/edge limits.
2. Assert the response must **not** be `edges: []` with `incomplete: false` when the compiler fixture contains `result = formatValue(42)`.
3. Assert the corrected result either carries the exact `result → formatValue` call edge with completed `call/incoming/symbol` coverage, or fails closed with explicit incomplete/unsupported coverage during an intentional intermediate ledger-only slice.
4. For the final acceptance state, require the exact edge and complete coverage. Current code fails because it returns the forbidden false-complete negative, not because of selector, freshness, serialization, or text search.

This one test is dual-purpose: it is a positive call fixture and a negative assertion against false completeness. Keep it as the first RED before helper/unit matrix work.

### Eventual full deterministic matrix

Use one compact compiler fixture with isolated source files and table-driven MCP calls:

- For each kind, include one incident positive and one true negative with the same applicable endpoint class and direction.
- Test both incoming and outgoing where the edge model permits incidence; test symbol and `<module>` endpoints separately.
- For non-applicable endpoint/direction pairs, assert an explicit `not_applicable` ledger entry rather than inferring it from zero edges.
- For calls, include overloaded free functions, overloaded methods, `new` constructor calls, and ordinary functions/methods. Pin the resolved implementation/owner endpoint and reject callback values, type-only uses, ambiguous/dynamic dispatch, and unresolved signatures.
- For containment, first freeze semantics: recommended candidates are module→top-level declaration and declaration→direct nested declaration, with incoming as the inverse. Both endpoints must resolve in the active compiler project; textual nesting alone must not be labeled compiler-authoritative.
- Add `['reference', 'call']` and `['reference', 'contains']` requests where the supported kind has an edge and the second kind is forced unsupported in a ledger-only RED. Assert one successful producer cannot hide one missing producer.
- Repeat calls and vary declaration/source insertion order; assert stable nodes, edges, relationship IDs, coverage order, and truncation reason order.
- Exercise exact edge, node, and depth exhaustion at MCP. Exercise private `max_work_items` at resolver/service level because it is not public input. Abort through the MCP request signal and assert typed `REQUEST_CANCELLED`, no partial success, and cooperative checkpoints inside every new scan.
- Re-run candidate tests: a complete empty page is allowed only when its declared incoming kind set has all coverage completed/not-applicable. Unsupported coverage must surface `INCOMPLETE_EVIDENCE`, never `proven_empty`.
- Re-run call-spine tests to prove any shared call-classification extraction preserves its existing global discovery completeness, authority state, ordering, and omission behavior.

## Architecture options

| Option                                                    | Authority and compatibility                                                                                                                                                                                                                                                                                 | Work, cancellation, and performance                                                                                                                                                                                                       | Test/rollback cost                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **A. Exact scoped producers**                             | Add `call` and `contains` producers to `edgesFor()`. Best final public behavior and no vocabulary removal. Requires explicit endpoint semantics, especially containment.                                                                                                                                    | Outgoing calls/contains can stay local; incoming discovery may scan sorted compiler files but must share the scoped work budget and checkpoints. Avoid invoking the global call collector once per BFS node.                              | Highest semantic matrix cost. Roll back producers independently while ledger keeps results fail-closed.            |
| **B. Coverage ledger with unsupported/incomplete output** | Record every requested kind × direction × endpoint class as `completed`, `not_applicable`, or `unsupported`. Immediately fixes false completeness and matches ADR 0007, but can make previously “successful” calls and candidates incomplete. Additive public metadata still requires schema/client review. | Low discovery cost; mandatory accounting prevents silent skips. Cancellation/work exhaustion must mark started-but-unfinished coverage incomplete.                                                                                        | Smallest safety slice and simplest rollback. Alone it leaves useful `call`/`contains` impact unavailable.          |
| **C. Adapt bounded global collectors**                    | Filter `collectCompilerCallRelationships()` or a precomputed global graph per endpoint; containment would need a new collector. Authority can remain compiler exact if snapshot identity is preserved.                                                                                                      | Simple reuse but rescans/materializes the project, can repeat per BFS node, and risks multiplying the 100k budget. Cancellation exists in call collection, but cache/global completeness and per-query edge caps need careful projection. | Medium implementation, high performance/cutover risk. Rollback is easy only if isolated behind resolver interface. |

### Recommendation

Combine **A + mandatory B**. Land the smallest fail-closed coverage accounting before or atomically with producers; the final implementation should provide exact scoped `call` and agreed `contains` producers. The ledger is not optional bookkeeping: it is the invariant that prevents future vocabulary additions or endpoint-specific gaps from becoming false complete negatives.

Do not use C as the default. Shared call-site classification helpers may be extracted from the global collector, but scoped discovery must own one query budget and cancellation context. A bounded per-session precomputation is a later benchmark decision, not R-01 authority.

## Proposed scope and likely files

- `src/services/relationships.ts` — coverage vocabulary/result, producer registration, exact call/contains producers, shared classification helpers, work/cancellation accounting.
- `src/services/impact.ts` — aggregate per-node coverage, project unsupported/unfinished states to `incomplete`, and preserve deterministic traversal ordering.
- `src/tools/get_impact.ts` and `src/tools/relationship-schema.ts` — expose bounded coverage metadata and validate it.
- `src/tools/find_test_candidates.ts` — declare the exact candidate relationship set or consume the new coverage contract before `proven_empty`.
- `src/services/context-builder.ts` / `src/services/call-spines.ts` — likely no behavior change; tests guard shared call logic if extracted.
- `test/mcp.integration.test.ts` — smallest RED and public matrix.
- `test/impact.test.ts`, `test/relationships.test.ts`, `test/test-candidates.test.ts`, `test/call-spines.test.ts` — scoped parity, work/cancellation, consumer and regression evidence.

Non-goals: unsupported-vocabulary removal; runtime/dynamic call claims; heuristic/index authority; T-01 path-direction correction; F-01 JSON/TOON execution proof; test execution; mutation/apply authorization; generic relationship backend refactor.

## Compatibility and cutover questions

1. What exact public shape records coverage without conflating unsupported and traversal truncation: a ledger array, grouped map, or typed public error?
2. Is `contains` module→top-level plus symbol→direct-child, symbol-only, or transitive lexical ownership? Proposal/spec must freeze this before GREEN.
3. Should affected-test candidates request all seven kinds after support, or a named candidate-specific subset? Implicit default-all must end.
4. Are non-applicable endpoint orientations successful ledger entries or invalid input? Prefer successful `not_applicable` for additive compatibility and deterministic mixed-kind queries.
5. Should a ledger-only first slice temporarily return successful `ast_get_impact` with `incomplete: true`, or typed `INCOMPLETE_EVIDENCE`? `ast_get_impact` currently represents bounded incompleteness as data; candidates already convert it to an error.
6. Can overload calls normalize to one implementation/owner endpoint across TypeScript versions, or must unresolved multi-target signatures remain explicit incomplete evidence?

## Risks and acceptance evidence

Risks:

- Exact incoming calls and containment can become whole-project scans disguised as scoped work.
- Duplicate `reference` and `call` edges may increase traversal pressure while remaining semantically distinct.
- Incorrect overload/constructor normalization can create authoritative false positives.
- Additive coverage output can break exact-shape consumers despite schema compatibility.
- Candidate behavior may become more conservative at cutover; that is preferable to false `proven_empty` but must be documented.
- New producers must not weaken call-spine completeness or cancellation.

Acceptance evidence:

- The first MCP RED fails on current code for the false-complete reason and passes after correction.
- Positive/negative compiler fixtures cover all seven kinds, permitted directions, and symbol/module endpoint classes.
- Mixed-kind, overload/function/method/constructor, stable-order, exact-bound, work-exhaustion, and cancellation cases pass.
- Every complete empty impact records completed/not-applicable coverage for every requested combination; unsupported/not-run/unfinished coverage is incomplete.
- Candidate `proven_empty` is impossible from incomplete coverage; MCP and batch candidate semantics remain identical.
- Existing format, lint, typecheck, focused/full tests, build, package, and smoke gates pass.
- DeepSeek Harness remains exactly 15 guarded AST tools; `ast_apply_operation` remains absent and direct invocation remains `UNKNOWN_TOOL`. No Harness checkout change is authorized.

## Ready for proposal

**Yes.** Propose the A+B fail-closed design, resolve containment semantics and candidate kind selection explicitly, and preserve the smallest MCP RED as the first implementation gate.
