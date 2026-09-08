# Design: Honest Scoped Call Coverage

## Technical Approach

On planning base PR #252 (`75b1479`), add resolver coverage, separate traversal bounds, exact scoped direct calls, and a frozen six-kind candidate gate. Exclude #219/#220 classifiers, a `contains` producer, historical recovery, call-spine authority, universal MCP schemas, and Harness work.

## Contracts and Decisions

```ts
export const RELATIONSHIP_COVERAGE_STATUSES = [
  "not_applicable",
  "completed",
  "unsupported",
  "unfinished",
] as const;
export type RelationshipCoverageStatus = (typeof RELATIONSHIP_COVERAGE_STATUSES)[number];
export type RelationshipEndpointClass = "module" | "symbol";
export interface RelationshipCoverageEntry {
  readonly kind: RelationshipEdgeKind;
  readonly direction: "incoming" | "outgoing";
  readonly endpoint_class: RelationshipEndpointClass;
  readonly status: RelationshipCoverageStatus;
}
export interface RelationshipWork {
  readonly work_items: number;
  readonly max_work_items: number;
  readonly work_limit_reached: boolean;
}
```

| Decision      | Choice and tradeoff                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lattice       | `mergeRelationshipCoverage()` uses `unfinished > unsupported > completed > not_applicable`; `canonicalRelationshipCoverage()` orders `RELATIONSHIP_EDGE_KINDS`, direction, module/symbol. More payload, but no observation-order masking.                                                                                                                                                                     |
| Applicability | `relationshipCoverageApplicability()` marks module reference/heritage/call N/A; module import/export applicable both ways; symbol reference/call applicable by callable/owned-body shape, import/export incoming only, heritage by class/interface shape. `contains` is applicable for both endpoint classes/directions and unsupported. Candidate exclusion of `contains` keeps six-kind admission possible. |
| Compatibility | `CompilerRelationshipResolution` gains `coverage`/`work`, retains legacy work fields, and strengthens `incomplete`. `RelationshipCoverageEntrySchema`/`RelationshipWorkSchema` validate additive `ImpactResult.coverage`, `.work`, and `.proven_empty`; edges, kinds, errors, and defaults remain.                                                                                                            |

## Data Flow and Algorithms

```text
root → traverseCompilerImpact shared work budget → resolver.edgesFor(endpoint)
     → canonical cells + producers → coverage/work/edges
     → traversal coverage merge + truncation → impact authority
     → six incoming kinds → exact-evidence gate → candidates → whole-proof pagination
```

`createCompilerRelationshipResolver()` initializes requested-direction cells for the endpoint class. Missing applicable producers stay `unsupported`; exhaustive producers become `completed`; ambiguity or edge/work stop becomes `unfinished`; N/A never blocks. `consumeScopedWork()` charges lookup, scans, resolution, sorting, probes, and restrictions to one traversal-wide `RelationshipWork`; probes merge evidence without admitted edges.

`addScopedIncomingCalls()` scans target-resolving compiler references, climbs to call/new/tag syntax, and emits only when `unwrapInvocationExpression()` is an identifier, declarations reduce to one project `locatedCallTarget()`, and `scopedContainingSymbol()` owns the site. `addScopedOutgoingCalls()` scans only the owner body, skips nested named owners, and applies that rule. Relevant property, element, dynamic, external, unresolved, or multiple targets mark only that direction unfinished; unrelated incoming sites do not.

`traverseWithNeighborProvider()` accumulates work and class-level cells from every normal/restricted/probe call. `incomplete = truncation.truncated || work.work_limit_reached || !isRelationshipCoverageComplete(coverage)`; `proven_empty = edges.length===0 && !incomplete`. `assertCompleteExactImpactEvidence()` also requires fresh exact resolved compiler edges.

`AFFECTED_TEST_RELATIONSHIP_KINDS = ["reference","import","export","extends","implements","call"]`; `registerFindTestCandidates()` passes these with `direction:"incoming"`, rejects failed authority as `INCOMPLETE_EVIDENCE`, then sorts candidates by depth/file before `paginate()`. Coverage/work/relationship kinds are unpaginated; each path remains atomic. MCP and batch use the registered handler; CLI TOON losslessly encodes its JSON result.

Cancellation propagates without partial output; local maps/budgets require no cleanup. Compiler drift uses sanitized public errors. Work exhaustion returns bounded incomplete impact, but candidates return no page.

## Files and Five Immediate-Predecessor Units

| Unit/base      | Files and usable finish                                                                                                                                                                                                                                                                           | RED/gate                                                                               | Forecast; rollback                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| U1 ← `75b1479` | `src/services/relationships.ts`, `test/impact.test.ts`: lattice, applicability, resolver coverage                                                                                                                                                                                                 | absent 14 symbol cells; focused impact tests, typecheck                                | 300–380; remove contract/tests                 |
| U2 ← U1        | `src/services/impact.ts`, `src/tools/relationship-schema.ts`, `src/tools/get_impact.ts`, `test/impact.test.ts`, `test/mcp.integration.test.ts`: honest impact/public parity                                                                                                                       | unsupported call must be incomplete/non-empty-proof; focused tests, MCP, typecheck     | 320–395; revert projection, leave U1 internal  |
| U3 ← U2        | `src/services/relationships.ts`, `test/impact.test.ts`, `test/relationships.test.ts`: exact scoped calls                                                                                                                                                                                          | unsupported direct call/new/tag must become exact; focused tests, typecheck            | 330–395; producer removal restores unsupported |
| U4 ← U3        | `src/services/test-candidates.ts`, `src/tools/find_test_candidates.ts`, `test/test-candidates.test.ts`, `test/mcp.integration.test.ts`, `test/batch.test.ts`: six-kind gate                                                                                                                       | unfinished call must error; true empty must pass; focused/MCP/batch/typecheck          | 320–395; revert candidate additions only       |
| U5 ← U4        | `README.md`, `docs/adr/0007-compiler-first-impact-relationships.md`, `docs/adr/0012-public-affected-test-candidates.md`, `skills/structural-code-editing/SKILL.md`, `benchmark/impact-corpus.json`, `scripts/benchmark-agent-workflows.mjs`, `scripts/cli-smoke.mjs`: published/audit convergence | inventory/smoke assertions lack contract; benchmark, CLI smoke, format/lint/test/build | 180–300; docs/audit-only revert                |

Each tested child targets its predecessor, stays ≤400 authored lines, and is not atomically promised.

## Requirement/Scenario Verification Trace

| Requirement (scenarios)                                              | Unit/seam               |
| -------------------------------------------------------------------- | ----------------------- |
| Canonical cells (2); applicability/direction (2)                     | U1 lattice              |
| Unsupported containment (1); semantic/bounded split (2)              | U2 impact               |
| Exact direct calls (2); refuse guesses (1); deferred classifiers (2) | U3 producer             |
| Honest impact (2); compatibility (1)                                 | U2/U3 public regression |
| Incoming six kinds (2); fail closed (4)                              | U4 admission            |
| Whole-proof pagination (1); metadata (1); MCP/batch parity (2)       | U4/U5 parity            |

Trace total: 14 requirements, 25 scenarios. Full gate per unit is `yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build`; only the focused RED subset runs before implementation.

## Threat Matrix / Rollout

N/A — no routing, shell, subprocess, VCS/PR automation, executable classification, or process-integration boundary. Additive rollout requires no migration; default-all impact deliberately becomes incomplete because `contains` is honestly unsupported. Roll back U5→U1 only; never restore completed/proven-empty for absent producers. Open questions: none.
