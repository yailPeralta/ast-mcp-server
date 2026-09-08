# Design: Preserve Computed-Key Call Uncertainty

## Technical Approach

Add one bounded compiler-derived classifier inside `relationships.ts`, the existing call-discovery owner. Enumerate every literal key and receiver-type constituent before deciding authority. **Invariant:** no selected union constituent can authorize an edge or completed coverage while another key remains possible.

`ComputedCallAuthority` is an internal union: `not_computed`, `single_key_eligible`, or `unfinished`, each computed state carrying canonical key and project-declaration alternatives. Missing, external, multiple, or unbounded identities force `unfinished`. Single-key eligibility grants nothing itself. No property, element, dynamic, external, or multiple-target edge is added.

## Architecture Decisions

| Decision question                          | Options and tradeoff                                                                             | Choice / rationale                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Where should alternative authority live?   | Duplicate producer checks are smaller locally but drift; a new service adds a shallow boundary.  | Deepen `relationships.ts` with one pure classifier used by scoped and whole-project producers.              |
| How should ambiguity be represented?       | Boolean `incomplete` loses relevance; guessed multi-edges increase recall but violate authority. | Retain canonical source/alternative endpoint identities as bounded unfinished gaps; emit no edge.           |
| How should incoming alternatives be found? | Selected-symbol references miss unselected members; repeated project scans are costly.           | Build one lazy request-local computed-call catalog per resolver/collector, charged to existing work bounds. |

## Data Flow

```text
call syntax → unwrap → enumerate all key × receiver alternatives
                         ├─ one key: existing eligibility checks
                         └─ any gap/divergence: unfinished gap, no edge
                                      ↓
       scoped coverage ← relevance by source/alternative endpoint
       call spines     ← relevance during exact-edge traversal
       candidates      ← six-kind complete gate rejects gap
```

`addScopedIncomingCalls` marks incoming `call` unfinished when its endpoint occurs in any alternative; outgoing does so when its caller owns the site. Exact direct calls remain. Existing impact aggregation maps unfinished to incomplete, not proven empty, without truncation. `buildExploreContext` passes gaps to `planCallSpines`, which retains exact paths but denies authority when a reached endpoint has a directional gap. Candidate registration then returns existing `INCOMPLETE_EVIDENCE` before pagination.

## Relationship Coverage and Output Contracts

Coverage vocabulary, order, precedence, edge schema, and seven kinds stay unchanged. Semantic gaps remain separate from bounds. Alternatives sort by key then selector; edges/paths remain relationship-id ordered. One canonical object preserves MCP JSON, `ast_get_impact` TOON, and final batch TOON meaning.

## Complexity and Performance

For visited nodes `N`, key constituents `K`, receiver constituents `R`, construction is `O(N·K·R)` time and bounded gap storage, once per request-local resolver/collector. Existing work accounting/checkpoints charge every item; exhaustion yields unfinished coverage. Traversal/serialization bounds stay unchanged.

## Exact File / Symbol Impact Map

| File                                                                                                            | Symbols                                                                                                                                                | Action                                       |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `src/services/relationships.ts`                                                                                 | `scopedDirectCallTarget`, `addScopedIncomingCalls`, `addScopedOutgoingCalls`, `createCompilerRelationshipResolver`, `collectCompilerCallRelationships` | Add classifier/catalog and directional gaps. |
| `src/services/context-builder.ts`                                                                               | `buildExploreContext`                                                                                                                                  | Pass gaps to spines.                         |
| `src/services/call-spines.ts`                                                                                   | `CallSpineOptions`, `planCallSpines`                                                                                                                   | Deny authority for relevant gaps.            |
| `src/services/impact.ts`                                                                                        | `traverseWithNeighborProvider`, `traverseCompilerImpact`                                                                                               | Verify only; no edit expected.               |
| `src/tools/get_impact.ts`                                                                                       | `registerGetImpact`                                                                                                                                    | Verify JSON/TOON only.                       |
| `src/tools/find_test_candidates.ts`, `src/services/test-candidates.ts`                                          | `registerFindTestCandidates`, `findTestCandidates`                                                                                                     | Verify existing gate only.                   |
| `test/relationships.test.ts`, `test/impact.test.ts`, `test/call-spines.test.ts`, `test/mcp.integration.test.ts` | producer, coverage, spine, candidate/batch cases                                                                                                       | Modify tests.                                |

AST CLI returned exact compiler declarations/references (`has_more: false`); freshness was not visible. Bounded reads are textual fallback.

## Testing and Observability

RED/GREEN tests cover both alternatives, one literal, unresolved keys, outgoing ambiguity, mixed exact calls, #220 controls, bounds/order, MCP/batch, and JSON/TOON. Existing coverage, work, completeness, spine authority, omissions, and errors provide observability; add no source/path logs.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration, Rollout, and Rollback

No migration, flag, or protocol rollout. `auto-chain` splits only at test/producer-consumer boundaries if needed. Rollback retains a coarse edge-free unfinished guard for all computed element calls; never restore false authority.

## Scope Boundary

Issue #247 is the merged prerequisite. Issues #186, #188, F-01 confer no authority. Issue #220, Harness apply, `contains`, runtime dispatch, generalized property/element dispatch, external convergence, multiple-target edges, mutations, review, and archive are excluded.

## Requirement and Scenario Traceability

| Requirement                                                     | Scenarios covered                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 `scoped-compiler-impact/Preserve deferred classifier scope`  | S1 One literal key is only eligible; S2 Union alternative is unselected; S3 Alternative cannot be resolved; S4 Outgoing union ambiguity; S5 Independent exact direct call remains useful; S6 Excluded dispatch remains non-authoritative; S7 Independent authority boundary. |
| R2 `ast-explore-call-spines/Exact authoritative spines`         | S8 Call classification; S9 Bounded canonical traversal; S10 Empty authority; S11 Union-key path is unproven; S12 Direct path coexists with ambiguity; S13 JSON and TOON preserve authority.                                                                                  |
| R3 `affected-test-candidates/Fail closed on untrusted evidence` | S14 Partial traversal is rejected; S15 Semantic gap is rejected; S16 Proven empty result; S17 Computed-key ambiguity is not certified; S18 Excluded dispatch is not certified; S19 Public surfaces fail closed consistently.                                                 |

## Open Questions

None; the safe fallback for any unbounded alternative is specified as edge-free `unfinished`.
