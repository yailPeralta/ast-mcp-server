# Delta for Scoped Compiler Impact

## MODIFIED Requirements

### Requirement: Preserve deferred classifier scope

Computed-call classification MUST distinguish one bounded literal key from a key domain with multiple alternatives. A single literal computed key MAY proceed to existing exact-target eligibility checks, but eligibility alone MUST NOT authorize property, element, external, or multiple-target edges. If any compiler-derived alternative is unsupported, unresolved, or unselected, incoming call coverage MUST be `unfinished`; applicable outgoing coverage MUST also be `unfinished`. Such a site MUST emit no guessed edge, MUST make impact incomplete without implying truncation, and MUST NOT prove no callers or no callees. Exactly resolved direct calls MUST retain existing behavior. This change MUST remain independent from #186, #188, and F-01; issue #220 and Harness/apply behavior MUST remain excluded.

(Previously: Computed union-key classification was deferred wholesale to issue #219, while issue #220 convergence remained unfinished.)

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
