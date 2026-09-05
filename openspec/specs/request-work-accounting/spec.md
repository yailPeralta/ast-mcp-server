# Request Work Accounting Specification

## Requirements

### Requirement: RWA-001 One tracker

One tracker MUST span resolver, `reference`, `import`, `export`, `extends`, `implements`, `call`, `contains`, merge/finalization, `collectNeighbors`, impact BFS/probes, coverage, and public consumers. Nested work MUST NOT reset or substitute allowances.

#### Scenario: RWA-001-S01 Shared lineage

- GIVEN incoming, outgoing, or both traversal
- WHEN any producer, probe, traversal, or finalizer runs
- THEN every charge updates the same tracker without reset.

### Requirement: RWA-002 Frozen stage/item units

One unit SHALL be one item entering one named stage. Frozen stages are: source-file enumeration, path sort, lookup/emission; producer dispatch, candidate filter/dedupe/retention, candidate sort, candidate emission; merge scan/dedupe/retention, merged sort, selection scan, selected-ID sort, edge emission; neighbor edge sort, scan, dedupe/retention, neighbor sort, emission; BFS dequeue, dispatch/probe, classification/filter, edge retention, node retention, enqueue; final node sort, edge sort, coverage aggregation, node emission, edge emission. Containment keeps existing inspection/emission units and adds only candidate-sort units.

#### Scenario: RWA-002-S01 Exact-once units

- GIVEN an item enters multiple stages
- WHEN accounting runs
- THEN it is charged once per stage, never per Map, Set, heap, repeated check, or comparator call.

#### Scenario: RWA-002-S02 Sort reservation

- GIVEN N retained sortable items
- WHEN sort preparation begins
- THEN N units are atomically reserved before sorting.

### Requirement: RWA-003 Pre-work charging

Known cardinalities MUST be reserved before scaled inspection, retention, materialization, or sorting; otherwise each item MUST be charged immediately before inspection, retention, or emission. A failed reservation MUST perform nothing guarded. Producer candidate stages, cross-producer merge, neighbor sort/scan/dedupe/emission, BFS dequeue/classification/retention/enqueue, and final node/edge/coverage ordering/emission MUST obey this rule without double charging.

#### Scenario: RWA-003-S01 Pipeline boundary

- GIVEN relationship candidates, ordered edges, or queued nodes
- WHEN a named stage inspects or mutates them
- THEN its charge occurs first and no earlier stage is recharged.

### Requirement: RWA-004 Limits and cancellation

Work equal to `max_items` MUST succeed with `consumed_items == max_items` and `exhausted == false`. The first denied unit MUST saturate the counter and report exhausted `work_limit`. Cancellation/deadline MUST precede charges and effects; cancellation MUST retain typed `REQUEST_CANCELLED` precedence.

#### Scenario: RWA-004-S01 Exact and one below

- GIVEN deterministic required work N
- WHEN limits N and N-1 are used
- THEN N succeeds; N-1 fails saturated with `work_limit` and unfinished coverage.

#### Scenario: RWA-004-S02 Cancellation wins

- GIVEN cancellation coincides with a denied charge
- WHEN the stage starts
- THEN `REQUEST_CANCELLED` returns without charging or partial success.

### Requirement: RWA-005 Transactional authority

Exhaustion MUST atomically discard authority-bearing nodes, edges, candidate pages, call spines, and `proven_empty`; a diagnostic root MAY remain. The result MUST be incomplete with `work_limit` and unfinished coverage.

#### Scenario: RWA-005-S01 Late exhaustion

- GIVEN earlier batches succeeded
- WHEN a later stage exhausts work
- THEN no accumulated authority page or completion claim is emitted.

### Requirement: RWA-006 Directions and coverage

Accounting MUST cover incoming, outgoing, and both traversal across fourteen cells: seven kinds by two directions. `both` MUST compose them without duplicates.

#### Scenario: RWA-006-S01 Fourteen-cell matrix

- GIVEN every direction/kind cell
- WHEN traversal completes or exhausts
- THEN cells are deterministically ordered and marked completed or unfinished.

### Requirement: RWA-007 Deterministic compatibility

Generous and exact limits MUST produce equal successful node, edge, relationship-ID, coverage, and page ordering. JSON bytes MUST be deterministic; TOON, MCP, and batch/CLI MUST preserve equivalent logic and existing schemas/errors.

#### Scenario: RWA-007-S01 Cross-surface parity

- GIVEN identical generous and exact inputs
- WHEN repeated through JSON, TOON, MCP, and batch/CLI
- THEN bytes or decoded values are equal without schema additions.

### Requirement: RWA-008 Legacy public collector

If publicly reachable, the legacy compiler-call collector's source-path sort, edge retention/dedupe, final sort, selection, and emission MUST use these stages; otherwise call-spine discovery MUST fail closed on exhaustion.

#### Scenario: RWA-008-S01 Spine exhaustion

- GIVEN a spine reaches the legacy collector
- WHEN work exhausts
- THEN no authoritative spine or complete-discovery claim returns.
