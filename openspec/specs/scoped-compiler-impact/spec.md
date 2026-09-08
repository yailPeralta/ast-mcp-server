# Scoped Compiler Impact Specification

## Requirements

### Requirement: Record canonical coverage cells

Each requested kind, direction, and endpoint class MUST have one cell: `not_applicable`, `completed`, `unsupported`, or `unfinished`.

#### Scenario: Canonical state and order

- GIVEN a multi-kind bidirectional request
- WHEN coverage is returned
- THEN cells follow kind order, incoming before outgoing, then module before symbol.

#### Scenario: Fail-closed precedence

- GIVEN duplicate observations for one cell
- WHEN aggregated
- THEN `unfinished > unsupported > completed > not_applicable` selects its status.

### Requirement: Preserve applicability and direction

Module/symbol applicability and incoming/outgoing completion MUST be independent; `not_applicable` MUST NOT block completeness.

#### Scenario: Endpoint is inapplicable

- GIVEN a call direction impossible for an endpoint class
- WHEN coverage is evaluated
- THEN it is `not_applicable` without masking applicable cells.

#### Scenario: One direction is uncertain

- GIVEN one direction completes and the other is uncertain
- WHEN coverage is aggregated
- THEN only the uncertain direction is `unfinished`.

### Requirement: Report unsupported containment

Seven public kinds and default-all selection MUST remain stable; applicable `contains` MUST be `unsupported`.

#### Scenario: Explicit or default containment

- GIVEN `contains` is explicit or default
- WHEN impact runs
- THEN applicable containment is unsupported, incomplete, and not proven empty.

### Requirement: Complete exact scoped direct calls

Exactly resolved direct identifier function calls, constructors, and tagged-template identifiers MUST complete within bounds.

#### Scenario: Incoming direct function call

- GIVEN a target has an exact identifier invocation
- WHEN incoming call impact runs
- THEN an exact edge is returned and incoming coverage is completed.

#### Scenario: Outgoing direct call shapes

- GIVEN a caller owns direct function, constructor, and tagged-template invocations
- WHEN outgoing call impact runs
- THEN stable exact edges are returned and outgoing call coverage is completed.

### Requirement: Refuse guessed dispatch

Relevant ambiguous, unresolved, multiple-target, property, element, or dynamic invocations MUST emit no guessed edge and mark only their direction `unfinished`.

#### Scenario: Uncertain invocation

- GIVEN a relevant invocation lacks one exact project target
- WHEN scoped call impact evaluates it
- THEN no edge is guessed and that directional cell is unfinished.

### Requirement: Separate semantic and bounded incompleteness

Coverage MUST describe semantic authority; truncation/work MUST separately describe exhausted traversal, work, or cancellation bounds.

#### Scenario: Semantic gap without truncation

- GIVEN an applicable cell is unsupported or unfinished within limits
- WHEN impact is returned
- THEN `incomplete` is true and truncation is false.

#### Scenario: Budget exhaustion

- GIVEN a producer exhausts a bound
- WHEN impact is returned
- THEN typed bound evidence is reported and applicable coverage is unfinished.

### Requirement: Make impact claims honest

Impact MUST be incomplete for either channel and proven empty only with zero edges, no exhausted bound, and completed applicable cells.

#### Scenario: Complete empty impact

- GIVEN no edges and all requested cells are completed or inapplicable
- WHEN no bound is exhausted
- THEN impact is complete and proven empty.

#### Scenario: Useful edges with a gap

- GIVEN exact edges coexist with a coverage gap
- WHEN impact is returned
- THEN edges remain while impact is incomplete and not proven empty.

### Requirement: Preserve compatibility

Additive bounded coverage/work/proven-empty fields MUST preserve edge shapes, kinds, public errors, and JSON/TOON meaning.

#### Scenario: Serialization parity

- GIVEN an impact result
- WHEN encoded as JSON and TOON
- THEN ordered coverage, work, completeness, and proven-empty values match.

### Requirement: Preserve deferred classifier scope

Computed-call classification MUST distinguish one bounded literal key from a key domain with multiple alternatives. A single literal computed key MAY proceed to existing exact-target eligibility checks, but eligibility alone MUST NOT authorize property, element, external, or multiple-target edges. If any compiler-derived alternative is unsupported, unresolved, or unselected, incoming call coverage MUST be `unfinished`; applicable outgoing coverage MUST also be `unfinished`. Such a site MUST emit no guessed edge, MUST make impact incomplete without implying truncation, and MUST NOT prove no callers or no callees. Exactly resolved direct calls MUST retain existing behavior. This change MUST remain independent from #186, #188, and F-01; issue #220 and Harness/apply behavior MUST remain excluded.

#### Scenario: One literal key is only eligible

- GIVEN a computed call whose bounded key domain is one literal
- WHEN scoped call impact classifies the site
- THEN the site may continue through existing exact-target checks, but the literal alone grants no edge authority.

#### Scenario: Union alternative is unselected

- GIVEN a union-key call has a compiler-selected target and another callable alternative
- WHEN incoming call impact evaluates either alternative
- THEN no edge is attributed to the site, incoming coverage is `unfinished`, impact is incomplete, and `proven_empty` is false.

#### Scenario: Alternative cannot be resolved

- GIVEN any compiler-derived key alternative is unsupported or unresolved
- WHEN incoming call impact evaluates the site within traversal bounds
- THEN incoming coverage is `unfinished` without reporting traversal truncation or proving no callers.

#### Scenario: Outgoing union ambiguity

- GIVEN a caller owns a union-key call with more than one relevant alternative
- WHEN outgoing call impact evaluates the caller
- THEN no target edge is guessed and outgoing call coverage is `unfinished`.

#### Scenario: Independent exact direct call remains useful

- GIVEN an exact direct call coexists with an ambiguous computed-key call
- WHEN impact is returned
- THEN the direct edge remains exact while the applicable computed-key gap keeps aggregate completeness false.

#### Scenario: Excluded dispatch remains non-authoritative

- GIVEN dispatch requires property, element, external, multiple-target, or issue #220 convergence authority
- WHEN scoped call impact runs
- THEN this change adds no such edge authority and unresolved evidence remains `unfinished`.

#### Scenario: Independent authority boundary

- GIVEN historical #186, #188, or F-01 authority, or a request concerning #220 or Harness/apply
- WHEN this change's contract is evaluated
- THEN no authority is inherited and no excluded behavior is specified or enabled.
