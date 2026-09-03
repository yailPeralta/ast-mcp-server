# Delta for Honest Relationship Coverage

## ADDED Requirements

### Requirement: Report combinations

`ast_get_impact` MUST add one coverage entry per requested kind/effective direction/endpoint class (`module` or `symbol`), statused `completed`, `not_applicable`, `unsupported`, or `unfinished`.

#### Scenario: Explicit keys

- GIVEN multiple kinds or `both` directions
- WHEN impact returns
- THEN every normalized combination has exactly one coverage entry.

### Requirement: Order deterministically

Coverage MUST sort by public kind order (`reference`, `import`, `export`, `extends`, `implements`, `call`, `contains`), incoming/outgoing, then module/symbol; discovery order MUST NOT alter public output.

#### Scenario: Stable projects

- GIVEN equivalent projects with reordered declarations
- WHEN identical requests run
- THEN public ordering is identical.

### Requirement: Authorize completeness

A result, including complete-empty, MUST be complete only when every entry is `completed` or `not_applicable`; `unsupported` or `unfinished` MUST make the request incomplete.

#### Scenario: Mixed kinds fail closed

- GIVEN completed and unsupported or unfinished kinds
- WHEN requested together
- THEN the incomplete entry prevents request completeness and complete-empty.

### Requirement: Resolve exact calls

`call` MUST resolve exact compiler caller→callee edges for free functions, methods, constructors, and overloads; ambiguous, dynamic, or unresolved targets MUST be `unfinished` without guessed edges.

#### Scenario: Exact calls

- GIVEN exact free functions, methods, constructors, and overloads
- WHEN applicable call impact runs
- THEN named callees have exact edges and completed coverage.

#### Scenario: Inexact calls

- GIVEN an ambiguous, dynamic, or unresolved target
- WHEN call impact runs
- THEN coverage is unfinished and incomplete, without guessed edges.

### Requirement: Expose direct containment

`contains` MUST mean module→top-level named declaration or named declaration→direct nested named declaration; incoming MUST expose the exact inverse.

#### Scenario: Direct containment

- GIVEN compiler-resolved direct named ownership
- WHEN applicable contains impact runs
- THEN only direct edges appear with completed coverage.

### Requirement: Exclude false containment

`contains` MUST NOT claim statements, anonymous nodes, transitive nesting, runtime ownership, heuristic matches, or index-derived ownership.

#### Scenario: Exclusions

- GIVEN only excluded constructs
- WHEN contains impact runs
- THEN no edge appears and completed coverage proves only the direct negative.

### Requirement: Bound request work

One request budget MUST cover BFS, producers, and probes without per-node, kind, or producer resets; exhaustion MUST produce unfinished coverage and deterministic incomplete evidence.

#### Scenario: Exhaustion

- GIVEN aggregate work exceeds its bound
- WHEN impact runs
- THEN it stops with unfinished coverage and deterministic exhaustion reasons.

### Requirement: Cancel without partial success

Cancellation MUST return typed `REQUEST_CANCELLED`; partial results MUST NOT return as success.

#### Scenario: Cancellation

- GIVEN cancellation during discovery
- WHEN cancellation is observed
- THEN only `REQUEST_CANCELLED` returns, without a partial success payload.

### Requirement: Prove seven kinds

Public requests for `reference`, `import`, `export`, `extends`, `implements`, `call`, and `contains` MUST return applicable exact edges and completed-empty applicable negatives.

#### Scenario: Seven-kind matrix

- GIVEN exact positive and negative fixtures for all seven kinds
- WHEN each kind is requested through registered MCP
- THEN positives have exact edges and negatives have completed, complete-empty coverage.

### Requirement: Preserve compatibility

Coverage MUST be additive. Trust, provenance, freshness, resolution, confidence, pagination, bounds, ordering, and errors MUST remain fail-closed; only fresh compiler-exact evidence MAY be complete.

#### Scenario: No upgrade

- GIVEN stale, rebuilding, degraded, unresolved, or heuristic evidence
- WHEN coverage is serialized
- THEN existing fields retain meaning and the evidence remains incomplete.

### Requirement: Preserve public boundaries

Registered MCP MUST expose this contract. DeepSeek Harness MUST retain exactly 15 guarded AST tools, MUST NOT expose apply, and direct `ast_apply_operation` MUST return `UNKNOWN_TOOL`.

#### Scenario: MCP rejects false-complete call emptiness

- GIVEN an exact incoming caller→callee fixture
- WHEN registered MCP call impact runs
- THEN the edge and completed coverage replace false-complete emptiness.

#### Scenario: Harness remains read-only

- GIVEN Harness inventory and a direct apply attempt
- WHEN both are checked
- THEN 15 guarded tools exclude apply and the attempt returns `UNKNOWN_TOOL`.
