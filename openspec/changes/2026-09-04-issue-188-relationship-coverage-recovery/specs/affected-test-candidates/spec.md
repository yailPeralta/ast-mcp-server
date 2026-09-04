# Delta for Affected Test Candidates

## MODIFIED Requirements

### Requirement: Traverse incoming compiler relationships

The operation SHALL use a synchronized compiler session, incoming traversal, and depth, node, edge, and shared work budgets. It MUST request exactly six incoming kinds in this order: `reference`, `import`, `export`, `extends`, `implements`, `call`. It MUST NOT request `contains`, emit a `contains` coverage entry, or use containment as candidate evidence. Caller-provided, outgoing, or bidirectional relationships MUST NOT become affected-test evidence.

(Previously: Incoming traversal was required without freezing the six authoritative kinds, their order, the exclusion of `contains`, or the shared work budget.)

#### Scenario ATC-001: Incoming traversal is authoritative

- GIVEN a resolvable root and fresh compiler session
- WHEN analysis runs
- THEN exactly the six ordered compiler-owned incoming kinds are requested and all budgets are reported.

#### Scenario ATC-002: Contains is absent from candidate authority

- GIVEN authoritative incoming `contains` edges exist for the root
- WHEN affected-test candidates are requested
- THEN `contains` is absent from coverage, traversal, classification, and candidate proof.

### Requirement: Fail closed on untrusted evidence

Candidates MAY be returned only when evidence is complete, fresh, exact, resolved, compiler-authoritative, not cancelled, and the shared work record is not exhausted. All six required coverage entries MUST exist in frozen order and MUST be `completed` or `not_applicable`; any `unsupported`, `unfinished`, missing, duplicate, or out-of-order entry MUST produce an incomplete-analysis error, never a candidate page or empty result. Stale, rebuilding, degraded, truncated, unresolved, heuristic, or otherwise non-authoritative evidence MUST also produce an error. A zero-candidate result MAY be `proven_empty` only after every condition holds.

(Previously: Unsafe per-kind coverage, coverage shape, cancellation, and exhausted shared work were not explicit prerequisites for candidates or `proven_empty`.)

#### Scenario ATC-003: Partial traversal is rejected

- GIVEN traversal reaches a node, edge, byte, or shared work bound before completion
- WHEN analysis is requested
- THEN it returns an incomplete-analysis error and no candidate page.

#### Scenario ATC-004: Unsafe coverage is rejected

- GIVEN a required entry is unsupported, unfinished, missing, duplicated, or out of order
- WHEN candidate classification is requested
- THEN it returns an incomplete-analysis error and no candidate page.

#### Scenario ATC-005: Exhaustion is rejected

- GIVEN all relationship cells otherwise complete but shared work is exhausted
- WHEN candidate evidence is finalized
- THEN it returns `work_limit` and no candidate page or proven-empty claim.

#### Scenario ATC-006: Cancellation is rejected

- GIVEN candidate analysis is active
- WHEN cancellation is observed
- THEN it returns the typed cancellation outcome and no candidate page.

#### Scenario ATC-007: Proven empty requires six-kind proof

- GIVEN all six ordered entries are safe, work is not exhausted, and complete traversal finds no eligible test
- WHEN the result is finalized
- THEN it returns an empty page marked complete and `proven_empty`.
