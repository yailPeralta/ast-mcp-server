# Design: Exact Request-Wide Work Accounting

## Technical Approach

Keep one `CompilerImpactWorkTracker` created by `traverseCompilerImpact`; pass it through resolver producers, merge/finalization, `collectNeighbors`, every BFS dispatch/probe, coverage, and result emission. Build authority-bearing output in request scratch state and publish it only after a non-exhausted final checkpoint. Public schemas stay unchanged.

```text
get_impact/candidates → traverseCompilerImpact[tracker,scratch]
 → resolver → producers → merge/finalize → collectNeighbors
 → BFS/probes → coverage/finalize → commit OR discard(work_limit)
```

## Work Contract

`WorkStage` is a frozen internal enum. `tracker.checkpoint()` checks cancellation only; `charge(stage)` checkpoints then charges one item; `reserve(stage,n)` checkpoints once and atomically charges a known cardinality before any guarded observation/effect. State is `active(consumed≤max) → exhausted(consumed=max)` on the first denied unit; cancellation changes neither state nor count. No reset exists. Test-only events `{stage,count,before,after}` provide evidence without changing results.

| Frozen stage        | Unit formula                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| source files        | compiler files + retained-path sort + path lookup/emission                                                               |
| producer candidates | producer dispatch + candidate attempts + retained sort + emission                                                        |
| merge/finalize      | producer-edge scan/retention + merged sort + `min(M,limit)+[M>limit]` selection scans + selected-ID sort + edge emission |
| neighbors           | edge sort + edge scan + retention attempt + unique-neighbor sort + emission                                              |
| BFS                 | dequeue + resolver/probe dispatch + neighbor classification/filter + edge retention + node retention + enqueue           |
| result              | node sort + edge sort + coverage-cell aggregation + node emission + edge emission                                        |
| contains            | existing inspection/emission + candidate-count sort only                                                                 |

Sorting charges cardinality before `sort`, never comparator calls. Exact bound `N` is the sum of a fixture’s asserted stage-cardinality vector; run at `N`, `N-1`, and generous budget. Comparator invocation counts are ignored. Stage vectors and final bytes must repeat exactly.

## Ownership, Transaction, and Failure

`relationships.ts` extends helpers and threads the tracker into `scopedSourceFiles`, candidate heaps, contains flush, producer dispatch/merge, selection, and emission. `impact.ts` adds tracker ownership to `NeighborProvider`, `collectNeighbors`, probes, BFS, coverage, and finalizers. Scratch maps/coverage observations commit only when `tracker.exhausted=false`; otherwise edges are empty, nodes retain at most diagnostic root, `proven_empty=false`, and canonical coverage is rebuilt: for `both`, all 14 ordered cells exist and every applicable interrupted cell is `unfinished` (static `not_applicable` remains so). Cancellation/deadline escapes before work-limit handling as existing `REQUEST_CANCELLED`.

The legacy `collectCompilerCallRelationships` retains its own explicit tracker boundary and gains source-sort, retention/dedupe, final sort/selection/emission accounting; exhaustion returns no edges and `incomplete=true`, so `buildExploreContext` cannot certify a call spine complete. Candidate projection remains separately unbounded but `find_test_candidates.ts` rejects exhausted/incomplete impact before `findTestCandidates`; MCP and batch therefore emit existing `INCOMPLETE_EVIDENCE(work_limit)`, never pages.

## Requirement and Test Map

| Requirement → seam                                       | Scenarios → fixture/assertion                                                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| RWA-001 → tracker/resolver/provider signatures           | S01 identity/event lineage across incoming/outgoing/both and probes                                                        |
| RWA-002 → `WorkStage`, helpers, candidate/contains flush | S01 fixed stage vector/no duplicate events; S02 failed sort reserve leaves input untouched                                 |
| RWA-003 → all pre-stage call sites                       | S01 guarded getters/maps throw if observed before charge                                                                   |
| RWA-004 → tracker + request context                      | S01 explicit-vector N/N-1; S02 abort at denied boundary, unchanged count                                                   |
| RWA-005 → impact scratch commit                          | S01 late failure yields root-only/no edges/no proven-empty and unfinished matrix                                           |
| RWA-006 → coverage aggregation                           | S01 `graphFixture` 7×2 canonical order, no duplicate `both` cells                                                          |
| RWA-007 → final ordering/tool presenter                  | S01 repeated exact/generous JSON bytes; decoded TOON, MCP, CLI equal                                                       |
| RWA-008 → legacy collector/context builder               | S01 exhausted call fixture emits no spine/empty authority                                                                  |
| ATC fail-closed → candidate tool/service                 | ATC-001 MCP+batch typed error; ATC-002 spy proves projector untouched; ATC-003 complete empty fixture remains proven-empty |

Tests extend `test/impact.test.ts`, `relationships.test.ts`, `context-builder.test.ts`, `test-candidates.test.ts`, `mcp.integration.test.ts`, and `batch.test.ts`. Instrumentation asserts no reset/double charge and failure-stage evidence.

## Delivery, Compatibility, and ADRs

| Slice | Boundary                                              | Budget/rollback       |
| ----- | ----------------------------------------------------- | --------------------- |
| #187A | relationship tracker/stages + cardinality/legacy REDs | ≤400; revert A        |
| #187B | impact/BFS transaction + candidate/MCP/batch parity   | ≤400; revert B then A |

A starts at PR #223 commit `02dc447`; B targets A. Keep heap retention and existing comparators/IDs to avoid extra sorting/emission cost. No migration or flag: additive internal signatures with optional tracker compatibility, unchanged JSON/TOON schemas. ADR choices: stage/cardinality accounting over low-level/comparator counting; scratch commit over post-hoc redaction; shared tracker over probe allowances. Rejected: producer-only budget, counter reset, new public limit/schema/error, and charging candidate projection. Threat matrix: N/A—no routing, shell, subprocess, VCS automation, executable classification, or process boundary.

Risks are omitted/double/pre-work charges, partial authority, ordering drift, and slice overflow; mitigate with stage vectors, guarded spies, cancellation collision tests, byte parity, and hard line-count gates. Excludes #186, #219, #220, Harness, and new schemas.
