# Delta for Affected Test Candidates

## MODIFIED Requirements

### Requirement: Traverse incoming compiler relationships

The operation SHALL use a synchronized compiler session, incoming traversal, and depth, node, edge, and shared work budgets. It MUST request exactly `reference`, `import`, `export`, `extends`, `implements`, and `call`; it MUST exclude `contains`. Caller-provided or outgoing/bidirectional relationships MUST NOT become affected-test evidence.

(Previously: Traversal required incoming compiler evidence and public bounds but did not declare its relationship-kind set or shared work bound.)

#### Scenario: Incoming traversal is authoritative

- GIVEN a resolvable root and fresh compiler session
- WHEN analysis runs
- THEN only the six declared incoming compiler relationship kinds are used, `contains` is absent, and budgets are reported.

### Requirement: Fail closed on untrusted evidence

Candidates MAY be returned only when evidence is complete, fresh, exact, resolved, and compiler-authoritative. Every requested coverage entry MUST be `completed` or `not_applicable`. `unsupported`, `unfinished`, exhaustion, stale, rebuilding, degraded, truncated, incomplete, unresolved, heuristic, or otherwise non-authoritative evidence MUST return `INCOMPLETE_EVIDENCE`, never an empty result. Only complete authoritative traversal with no matches MAY be marked complete and `proven_empty`.

(Previously: Incomplete evidence failed closed, but candidate completeness and proven emptiness were not explicitly gated by per-kind coverage statuses.)

#### Scenario: Partial traversal is rejected

- GIVEN traversal exhausts any node, edge, byte, or shared work budget
- WHEN analysis is requested
- THEN it returns `INCOMPLETE_EVIDENCE` and no candidate page.

#### Scenario: Unsupported or unfinished coverage is rejected

- GIVEN any declared incoming coverage entry is unsupported or unfinished
- WHEN analysis is requested
- THEN it returns `INCOMPLETE_EVIDENCE` and never reports `proven_empty`.

#### Scenario: Proven empty result

- GIVEN complete authoritative traversal finds no eligible test relationship and all coverage is completed or not applicable
- WHEN requested
- THEN it returns an empty page marked complete and proven-empty.
