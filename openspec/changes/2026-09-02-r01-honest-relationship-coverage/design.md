# Design: Honest Relationship Coverage

## Technical approach

Make compiler impact a request-scoped, coverage-accounted traversal. `traverseCompilerImpact()` creates one mutable work tracker, expands `both` into effective directions, and accumulates resolver observations into a bounded public ledger. Exact scoped `call` and direct `contains` producers complete the seven-kind registry. A result is complete only when traversal is untruncated and every aggregate coverage entry is `completed` or `not_applicable`.

```text
registered MCP/candidate request
  -> fresh project + exact root
  -> traverseCompilerImpact creates one tracker and ledger
  -> BFS node/probe -> edgesFor(endpoint, tracker)
       -> total producer registry -> scoped scans -> exact edges + observations
  -> deterministic edge/node/coverage aggregation
  -> impact: data or cancellation error
  -> candidates: coverage gate -> candidate page or INCOMPLETE_EVIDENCE
```

AST project-status and outline calls produced no model-visible payload during design. The selectors below therefore come from bounded textual source inspection and are explicitly **non-compiler-backed**; compiler fixtures and RED/GREEN tests are the implementation authority.

## Architecture decisions

| Decision               | Choice and rationale                                                                                                                                                                                                        | Rejected alternative                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage granularity   | One aggregate per requested kind × effective direction × endpoint class actually admitted into `nodes`. This is bounded to 28 entries and describes evaluated closure, not individual nodes.                                | Per-node coverage grows with `max_nodes`; one entry per request kind hides directional/class gaps.                                             |
| Status precedence      | Merge observations with `unfinished > unsupported > completed > not_applicable`. Any interrupted execution dominates; an absent producer then dominates successful work; any completed applicable evaluation dominates N/A. | “Best result wins” could hide one unsafe observation in a mixed-kind/BFS request.                                                              |
| Work ownership         | One mutable `CompilerImpactWorkTracker` is created once by `traverseCompilerImpact`; no endpoint, probe, direction, kind, or producer reset.                                                                                | Current per-`edgesFor` budgets permit aggregate work to exceed the stated bound.                                                               |
| Calls                  | Share pure invocation classification with the global collector, but scope discovery separately: local owned-body outgoing and sorted-project incoming.                                                                      | Calling `collectCompilerCallRelationships()` per BFS node is quadratic and its global completeness cannot be safely projected after filtering. |
| Contains               | Emit only direct lexical compiler-owned edges between canonical named endpoints. BFS supplies transitivity.                                                                                                                 | Runtime ownership, syntax-only statements, and transitive producer edges overclaim authority and duplicate traversal.                          |
| Legacy graph traversal | Keep `traverseImpact(root, suppliedEdges, ...)` as a closed-array BFS returning the existing `ImpactResult` without compiler coverage. `traverseCompilerImpact` returns a new subtype with coverage/work.                   | Fabricating compiler-complete coverage from caller-supplied arrays would make test helpers an authority source.                                |
| Public cutover         | Add bounded `coverage` and `work` fields to `ast_get_impact`; preserve every existing field and JSON/TOON logical equivalence.                                                                                              | A new tool/version or removing kinds is unnecessary and breaks established clients.                                                            |

## Contracts and canonical ordering

In `src/services/relationships.ts` add frozen constants and types:

```ts
export const RELATIONSHIP_COVERAGE_STATUSES = Object.freeze([
  "not_applicable",
  "completed",
  "unsupported",
  "unfinished",
] as const);
export type RelationshipCoverageStatus = (typeof RELATIONSHIP_COVERAGE_STATUSES)[number];
export type EffectiveRelationshipDirection = "incoming" | "outgoing";
export type RelationshipEndpointClass = "module" | "symbol";
export interface RelationshipCoverageEntry {
  readonly kind: RelationshipEdgeKind;
  readonly direction: EffectiveRelationshipDirection;
  readonly endpoint_class: RelationshipEndpointClass;
  readonly status: RelationshipCoverageStatus;
}
export interface CompilerImpactWork {
  readonly max_items: number;
  readonly consumed_items: number;
  readonly exhausted: boolean;
}
```

`CompilerRelationshipResolution` gains `coverage: readonly RelationshipCoverageEntry[]`; `work_items` remains the delta consumed by that call for internal observability. In `src/services/impact.ts`, `CompilerImpactResult extends ImpactResult` with `coverage` and `work`. `traverseImpact` keeps its old return contract; compiler-vs-array parity tests compare graph/truncation fields explicitly rather than whole-object equality. `assertExactImpactEvidence` and `findTestCandidates` accept `CompilerImpactResult` and require safe coverage.

Canonical coverage ordering is `RELATIONSHIP_EDGE_KINDS`, then `incoming`, `outgoing`, then `module`, `symbol`, independent of BFS and source discovery. `both` expands to incoming then outgoing; a single direction stays single. The endpoint class is derived solely from `symbol_path === "<module>"`. A class enters the ledger when its root or neighbor is admitted to `nodes`; classes observed only behind a rejected node/edge limit do not create entries, while the existing truncation still prevents completeness.

Each admitted endpoint produces one observation for every requested kind/effective direction. The impact ledger reduces equal keys using the precedence above and emits exactly one entry. `coverageComplete = coverage.every(status is completed/not_applicable)`. Final `incomplete = truncation.truncated || !coverageComplete`. Unsupported coverage alone sets `incomplete: true` while `truncation.truncated: false`; truncation remains a bound fact rather than a synonym for capability support. Depth/node/edge limits retain existing ordered reasons. Add `work_limit` to `TRUNCATION_REASONS`, ordered after `record_limit` and before `edge_limit`; work exhaustion sets truncation and coverage `unfinished`.

## Shared work and cancellation control flow

`CompilerImpactWorkTracker` is mutable but request-private: `{ max, consumed, exhausted, charge(label), checkpoint() }`. The fixed current private maximum remains `IMPACT_RELATIONSHIP_WORK_ITEMS = 100_000`; it is reported but is not a new MCP input. Add `CompilerImpactTraversalControls { readonly max_work_items?: number }` as the final optional `traverseCompilerImpact(..., options, requestContext, controls)` parameter solely for bounded service tests. `charge` first calls `RequestContext.checkpoint()`, then refuses when `consumed === max`, sets `exhausted`, and throws internal `CompilerImpactWorkExhausted`; otherwise it increments exactly once, so `consumed <= max`.

Charge one item before each unit is inspected or committed:

1. BFS dequeue and each normal/probe `edgesFor` dispatch.
2. Each producer start and each source-file/compiler-source-file record visited.
3. Each direct child/descendant, located symbol, declaration, signature, or candidate target inspected.
4. Each allowed-neighbor key parsed and each excluded-ID/allowed-neighbor membership decision.
5. Each candidate edge classification, dedupe/retention decision, and final edge emission.

The same tracker is passed through `traverseWithNeighborProvider` only on the compiler path, all BFS limit/overflow/known-node probes, `edgesFor`, every producer/helper/scan, `ScopedCandidateSet`, and allowed/excluded bookkeeping. Remove `max_work_items` from per-call construction; tests may inject one request maximum through an internal-only `traverseCompilerImpact` option/hook. `CompilerImpactWorkExhausted` is caught only at the compiler traversal boundary: the active and not-yet-run observations for admitted combinations become `unfinished`, partial exact edges may remain in `ast_get_impact`, and `work_limit` makes the result incomplete. `RequestContextError` is never caught as exhaustion: cancellation/deadline crosses producers and BFS unchanged; MCP maps cancellation to `REQUEST_CANCELLED` and returns no success payload.

## Total producer registry

`createCompilerRelationshipResolver().edgesFor()` resolves the endpoint once, then looks up every requested `(endpoint class, direction, kind)` in a total registry. Registry values are `producer[]`, `not_applicable`, or temporary `unsupported`; an absent key is treated as `unsupported`, never success.

| Endpoint/direction | Applicable producers                                                         | Explicit N/A                                             |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| symbol incoming    | `reference`, `import`, `export`, `extends`, `implements`, `call`, `contains` | none                                                     |
| symbol outgoing    | `reference`, `extends`, `implements`, `call`, `contains`                     | `import`, `export`                                       |
| module incoming    | `import`, `export`                                                           | `reference`, `extends`, `implements`, `call`, `contains` |
| module outgoing    | `import`, `export`, `contains`                                               | `reference`, `extends`, `implements`, `call`             |

A producer-backed observation starts `unfinished`; all producers for that key returning normally, including zero edges, transitions it to `completed`. Non-applicable is terminal `not_applicable`. An intentionally unavailable applicable implementation is `unsupported`. Edge/work early stop leaves the active key `unfinished`; remaining applicable keys are `unfinished` after work exhaustion and `unsupported` only when the registry says no implementation. Cancellation emits no ledger. Producer-local `ScopedRelationshipLimitReached` marks `unfinished` plus `edge_limit`. Mixed requests reduce fail closed, so a completed kind cannot mask another status.

## Scoped call producer

Extract `callLikeExpression`, `unwrapInvocationExpression`, and target normalization into pure shared helpers used by both scoped and `collectCompilerCallRelationships`; do not invoke the global collector from impact.

Outgoing scans only the current `LocatedSymbol.node` subtree and accepts a call/new/tag node only when `scopedContainingSymbol(...)?.node === current.node`. Thus nested named declarations are excluded from the caller’s owned body; bodyless declarations complete empty. Incoming iterates compiler project files in normalized path order under the shared tracker, then source-order descendants, classifies each invocation once, and retains only edges whose normalized target endpoint equals the requested target.

Normalization uses the checker’s resolved signature as primary authority:

1. `new` maps a resolved constructor declaration to its enclosing named class endpoint.
2. A body-bearing function or method declaration maps directly to its canonical `LocatedSymbol`.
3. An overload/signature maps to the unique body-bearing implementation among the same de-aliased compiler symbol declarations; method identity also requires the same named container/name/staticness. If no body exists, only one canonical project declaration may be selected.
4. Function-valued variables/properties map the signature declaration to the nearest canonical named owner. Invoked-symbol declarations are a cross-check/fallback only when they collapse to the same single endpoint.
5. Zero or multiple normalized endpoints, dynamic dispatch, unresolved signatures, anonymous targets, parameters, and non-project declarations emit no guessed edge and mark the applicable call observation `unfinished`.

The caller is the nearest canonical named owner. Existing `createRelationshipEdge` remains authoritative: ID is `call:${JSON.stringify([source.file,source.symbol_path,source.selector])}->${JSON.stringify([target.file,target.symbol_path,target.selector])}`. A map keyed by this ID dedupes repeated sites; source and target selectors remain `${symbolPath}@${line}`. Sorting uses existing neighbor order, then relationship ID.

For outgoing, an unresolved site poisons only that caller’s call coverage. For incoming, an unresolved/ambiguous site that cannot be proven disjoint from the exact target can hide a real caller, so it makes the target’s observation unfinished—even when exact edges were also found. Consequently one dynamic site can prevent a proven incoming negative; this conservative false-negative is required instead of false authority. Sites whose resolved candidate set is provably disjoint do not poison it. Avoid accidental quadratic work by scanning once per incoming `edgesFor` call for all requested call work, reusing its target identity and candidate set; allowed-neighbor filtering happens during retention. Do not add cross-endpoint/session caches: without snapshot-, target-, budget-, and unresolved-state-complete cache proofs, reuse could falsely complete later BFS nodes. The shared 100,000 cap bounds unavoidable repeated incoming scans.

## Scoped contains producer

A named endpoint is exactly a `LocatedSymbol` admitted by the existing `forEachLocatedSymbol`/`namedNode` selector model; endpoints use existing `symbolEndpoint`/`moduleEndpoint` and `createRelationshipEdge`, so IDs and dedupe are canonical.

- Module outgoing enumerates source-file children in source order. A top-level named declaration is direct even when its canonical node is wrapped by a `VariableStatement`/declaration list. Emit module→each canonical declaration whose nearest named owner is absent.
- Symbol outgoing scans descendants in source order and emits current symbol→candidate only when the candidate’s nearest canonical named ancestor is exactly current.
- Symbol incoming walks ancestors to the first canonical named declaration; emit that owner→current, or module→current when none exists.
- Module incoming is `not_applicable`, because modules are never containment targets.

Sort candidates by node start, symbol path, selector, then relationship ID before retention. Constructors and other canonical named class members are eligible. Exclude import/export statements as containment, arbitrary statements, parameters, anonymous class/function expressions, unnamed declarations, transitive descendants, runtime ownership, and index/heuristic claims. A completed empty result proves only absence of these direct named edges.

## Public integration and candidates

`src/tools/relationship-schema.ts` exports `RelationshipCoverageEntrySchema` and `CompilerImpactWorkSchema`. `src/tools/get_impact.ts` adds `coverage` and `work` to `ImpactOutputSchema`; handler projection remains `{ ...impact, freshness }`. JSON is canonical and TOON remains a lossless encoding through `formattedResult`. Coverage contributes at most 28 small records; existing `max_edges`, transport frame/serialization limits, public bounded errors, and `correlation_id` behavior are unchanged. No paths, source text, stacks, cache data, raw arguments, or environment enter coverage/errors.

`src/tools/find_test_candidates.ts` defines and freezes `TEST_CANDIDATE_RELATIONSHIP_KINDS = ["reference", "import", "export", "extends", "implements", "call"] as const`, passes it explicitly to incoming compiler traversal, and excludes `contains`; T-01 path reconstruction/direction remains untouched. Before `findTestCandidates` or `proven_empty`, require no truncation/incompleteness and every coverage entry completed/N/A, otherwise throw existing `INCOMPLETE_EVIDENCE`. MCP and batch still invoke the same registered implementation; candidate output shape and pagination remain unchanged.

## Files and symbols affected

| File                                                                                    | Symbols/change                                                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/relationships.ts`                                                         | Coverage/work types, total producer registry, shared invocation classifier, scoped call/contains producers.                           |
| `src/services/impact.ts`                                                                | `CompilerImpactResult`, one tracker/ledger, compiler provider threading, completeness aggregation; legacy `traverseImpact` unchanged. |
| `src/services/read-contracts.ts`                                                        | Add bounded `work_limit` truncation vocabulary.                                                                                       |
| `src/tools/relationship-schema.ts`                                                      | Coverage/work Zod schemas.                                                                                                            |
| `src/tools/get_impact.ts`                                                               | Additive public projection for JSON/TOON.                                                                                             |
| `src/tools/find_test_candidates.ts`                                                     | Frozen six-kind set and coverage gate.                                                                                                |
| `src/services/context-builder.ts`, `src/services/call-spines.ts`                        | No intended behavior change; consume unchanged global call result.                                                                    |
| `test/{mcp.integration,impact,relationships,test-candidates,call-spines,batch}.test.ts` | RED, ledger/producers/matrix, compatibility and regression contracts.                                                                 |
| `README.md`                                                                             | Coverage/work semantics, direct containment, conservative calls, candidate six-kind set.                                              |

## TDD sequence and requirement trace

1. **Registered MCP RED:** in `test/mcp.integration.test.ts`, request incoming `call` for `formatValue` where `result = formatValue(42)`; forbid empty/non-incomplete and finally require exact edge plus completed `call/incoming/symbol` coverage.
2. **Ledger RED/GREEN:** total registry, direction/class aggregation, canonical order, safe empty, unsupported/unfinished and mixed-kind failure; retain a test-only missing-producer seam only while RED, then remove it.
3. **Scoped call:** outgoing ownership; incoming sorted scan; free/overloaded functions, methods, constructors, repeated sites; ambiguous/dynamic/unresolved poisoning; global collector parity.
4. **Contains:** module/symbol outgoing, symbol owner inverse, module incoming N/A, directness/exclusion/order.
5. **Seven-kind MCP matrix:** applicable positive and completed-empty negative for all kinds, both endpoint classes/orientations where applicable, stable insertion order and IDs.
6. **Candidates:** frozen six kinds, safe coverage before complete/proven-empty, T-01 unchanged, MCP/batch logical equivalence.
7. **Bounds/cancellation:** exact depth/node/edge/work boundaries, no tracker reset, probes and allowed/excluded charges, `work_limit`, mid-scan `REQUEST_CANCELLED` with no partial success.
8. **Public compatibility:** Zod projection, additive fields, stable JSON and lossless TOON, bounded payload/errors; legacy array traversal tests use graph-field parity.
9. **Full gates:** focused tests; `yarn format:check`, `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, `yarn test:mcp`, `yarn test:lifecycle`, `yarn test:cli`, `yarn test:errors`, `yarn test:package`; then `env -u GIT_PAGER bash -lc 'yarn vitest run test/dsh-adapter.test.ts test/tool-catalog.test.ts && yarn test:dsh-adapter'`. Authenticate pinned Harness `cd5ef814…`; require guarded 15, apply absent, direct `UNKNOWN_TOOL`; make no Harness edit.

| Requirement → scenario coverage                                                                                       | TDD step |
| --------------------------------------------------------------------------------------------------------------------- | -------- |
| HRC-R1 Report combinations → Explicit keys                                                                            | 2, 5     |
| HRC-R2 Order deterministically → Stable projects                                                                      | 2, 5     |
| HRC-R3 Authorize completeness → Mixed kinds fail closed                                                               | 2, 6     |
| HRC-R4 Resolve exact calls → Exact calls; Inexact calls                                                               | 1, 3     |
| HRC-R5 Expose direct containment → Direct containment                                                                 | 4        |
| HRC-R6 Exclude false containment → Exclusions                                                                         | 4        |
| HRC-R7 Bound request work → Exhaustion                                                                                | 2, 7     |
| HRC-R8 Cancel without partial success → Cancellation                                                                  | 7        |
| HRC-R9 Prove seven kinds → Seven-kind matrix                                                                          | 5        |
| HRC-R10 Preserve compatibility → No upgrade                                                                           | 6, 8     |
| HRC-R11 Preserve public boundaries → MCP rejects false-complete call emptiness; Harness remains read-only             | 1, 9     |
| ATC-R1 Traverse incoming compiler relationships → Incoming traversal is authoritative                                 | 6        |
| ATC-R2 Fail closed on untrusted evidence → Partial traversal; Unsupported or unfinished coverage; Proven empty result | 6, 7     |

This maps all **13 requirements and 17 scenarios**.

## Performance, compatibility, and observability

Outgoing call and contains scans are linear in the owned body/direct descendants. Incoming call is linear in sorted project syntax per visited target but globally capped; no unproven cache is introduced. Coverage is O(28), edge retention stays bounded by `max_edges + 1`, and consumed work is monotonic and externally visible. Qualitative review risk is **high** because compiler normalization, ledger propagation, and matrix tests cross service/public boundaries; implementation tasks should split into reviewable ≤400-authored-line behavior slices.

This is an additive response cutover: permissive clients continue working; exact-shape clients must accept `coverage`/`work`. Previously false-complete calls may now return edges or incomplete data, and candidates may conservatively return `INCOMPLETE_EVIDENCE`. No migration, dependency, feature flag, persisted state, or index rebuild is required. Observe status counts, work consumption/exhaustion, ordered truncation reasons, and unchanged correlation IDs through tests; do not add logs containing source or paths.

## Security, rollback, cleanup, and threats

Compiler authority remains fresh+exact+resolved only. Dynamic/ambiguous calls and syntax/index containment never upgrade. The change is read-only and creates no mutation, execution, shell, network, or VCS authority. Threat matrix: N/A — no new routing, shell, subprocess, VCS/PR automation, executable classification, or process-integration boundary.

Remove transitional unsupported seams and duplicate call classification before GREEN. Roll back producers, ledger/tracker, schemas, candidate set, docs, and tests together; never retain a path that restores silent complete negatives. Verify cleanup leaves no cache, fixture, process, Harness checkout, or generated artifact modifications.

## Open questions

None.
