# Delta for Affected Test Candidates

## MODIFIED Requirements

### Requirement: Fail closed on untrusted evidence

Candidates MAY be returned only when evidence is fresh, exact, resolved, compiler-authoritative, untruncated, within work bounds, and every applicable six-kind cell is `completed`. `unsupported` or `unfinished` coverage and any exhausted bound MUST return stable `INCOMPLETE_EVIDENCE`, never an empty page. A computed-key call with any unsupported, unresolved, or unselected alternative MUST therefore be rejected and MUST NOT prove no callers, even if another alternative was selected. Zero matches MUST be proven empty only after the complete gate. This change MUST NOT infer property, element, external, multiple-target, or issue #220 edges.

(Previously: Deferred #219 evidence was rejected generally, without explicit alternative-selection and no-callers semantics.)

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

#### Scenario: Computed-key ambiguity is not certified

- GIVEN a union-key call has any unsupported, unresolved, or unselected alternative
- WHEN candidate analysis encounters its unfinished incoming call coverage
- THEN no candidate edge is guessed and `INCOMPLETE_EVIDENCE` is returned.

#### Scenario: Excluded dispatch is not certified

- GIVEN property, element, external, multiple-target, or issue #220 convergence evidence is unproved
- WHEN candidate analysis encounters it
- THEN no candidate edge is guessed and `INCOMPLETE_EVIDENCE` is returned.

#### Scenario: Public surfaces fail closed consistently

- GIVEN identical ambiguous computed-key evidence
- WHEN requested through MCP or batch and encoded as JSON or TOON where supported
- THEN each applicable surface returns the same `INCOMPLETE_EVIDENCE` decision and no candidate page.
