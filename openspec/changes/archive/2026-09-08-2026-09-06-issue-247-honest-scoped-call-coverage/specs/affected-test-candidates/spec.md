# Delta for Affected Test Candidates

## MODIFIED Requirements

### Requirement: Traverse incoming compiler relationships

The operation SHALL use a synchronized compiler session and only incoming `reference`, `import`, `export`, `extends`, `implements`, and `call` relationships, with depth, node, edge, and shared work bounds. It MUST exclude `contains`; caller-provided, outgoing, or bidirectional relationships MUST NOT become evidence.
(Previously: Incoming compiler traversal used budgets but did not freeze a complete six-kind gate.)

#### Scenario: Incoming traversal is authoritative

- GIVEN a resolvable root and fresh compiler session
- WHEN analysis runs
- THEN exactly the six incoming kinds are evaluated and their bounds are reported.

#### Scenario: Containment is isolated

- GIVEN default impact selection would include `contains`
- WHEN candidate traversal runs
- THEN containment is not requested and cannot block or certify candidate evidence.

### Requirement: Fail closed on untrusted evidence

Candidates MAY be returned only when evidence is fresh, exact, resolved, compiler-authoritative, untruncated, within work bounds, and every applicable six-kind cell is `completed`. `unsupported` or `unfinished` coverage and any exhausted bound MUST return stable `INCOMPLETE_EVIDENCE`, never an empty page. Zero matches MUST be proven empty only after this gate.
(Previously: Completeness did not require explicit per-kind semantic coverage.)

#### Scenario: Partial traversal is rejected

- GIVEN traversal or work reaches a bound before completion
- WHEN analysis is requested
- THEN it returns `INCOMPLETE_EVIDENCE` and no page.

#### Scenario: Semantic gap is rejected

- GIVEN any selected incoming cell is unsupported or unfinished
- WHEN analysis is requested
- THEN it returns `INCOMPLETE_EVIDENCE`, even without traversal truncation.

#### Scenario: Proven empty result

- GIVEN all six incoming cells complete and no eligible test is found
- WHEN requested within bounds
- THEN it returns an empty page marked complete and proven empty.

#### Scenario: Deferred dispatch is not certified

- GIVEN property, element, dynamic, #219 union-key, or #220 convergence evidence is unproved
- WHEN candidate analysis encounters it
- THEN no candidate edge is guessed and `INCOMPLETE_EVIDENCE` is returned.

### Requirement: Paginate whole candidate proofs

The operation MUST paginate a deterministic candidate sequence by bounded offset/limit. It MUST include each candidate and full path atomically, without splitting proof or paginating away coverage/work authority; traversal bounds remain distinct from page limits.
(Previously: Whole-proof pagination did not explicitly preserve semantic coverage authority.)

#### Scenario: Page boundary preserves evidence

- GIVEN more candidates than the page limit
- WHEN consecutive pages are requested
- THEN ordering is stable, candidates are neither duplicated nor omitted, and every proof remains whole.

### Requirement: Return trust and budget metadata

Successful responses MUST identify compiler backend, root, authority, freshness, canonical admitted coverage/work, completeness, truncation/proven-empty state, traversal counts, effective traversal bounds, and page bounds. Additive fields MUST be bounded. Errors MUST retain stable public codes and bounded messages without paths, stacks, raw arguments, or secrets.
(Previously: Metadata lacked admitted per-cell coverage and shared-work evidence.)

#### Scenario: Metadata distinguishes confidence

- GIVEN a successful non-empty or proven-empty analysis
- WHEN serialized
- THEN canonical coverage, work, trust, freshness, completeness, bounds, and pagination metadata are present.

### Requirement: Keep MCP and batch semantics identical

MCP and `ast-tool run` MUST share one implementation and produce identical gate decisions, candidate order, proofs, additive metadata, and stable errors. JSON/TOON or transport serialization MUST NOT change logical meaning; inventory, allowlists, compatibility checks, tests, docs, and managed skill metadata MUST remain synchronized.
(Previously: Parity did not include the six-kind coverage/work admission decision.)

#### Scenario: Cross-surface parity

- GIVEN identical selectors, conventions, bounds, and page inputs
- WHEN invoked through MCP and batch
- THEN both return equivalent logical results or the same public error.

#### Scenario: Inventory remains synchronized

- GIVEN the capability is installed and checked
- WHEN public surfaces are inspected
- THEN it appears exactly once and all surfaces advertise the same contract.
