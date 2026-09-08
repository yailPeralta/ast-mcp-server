# Delta for ast-explore-call-spines

## MODIFIED Requirements

### Requirement: Exact authoritative spines

The system MUST require exact `file_path + symbol_path` and include only fresh compiler-resolved invocation sites between project symbols. Generic references, types, imports, value callbacks, dynamic, heuristic, property, element, external, and multiple-target edges MUST be excluded unless already authorized by the existing exact-call contract. A union computed-key site with any unsupported, unresolved, or unselected alternative MUST emit no guessed path, MUST keep applicable discovery unfinished, and MUST NOT establish authoritative emptiness. Direct exact call behavior, deterministic bounds, and authority rules MUST remain unchanged.

(Previously: Ambiguous calls were excluded generally, without normative computed-key alternative and unfinished-coverage semantics.)

#### Scenario: Call classification

- GIVEN an exact selector and a resolved call, constructor, or tagged-template site
- WHEN an incoming or outgoing spine is requested
- THEN its stable path is included; non-invocations are excluded.

#### Scenario: Bounded canonical traversal

- GIVEN branches, cycles, or tied shortest paths
- WHEN bounded traversal runs
- THEN endpoints do not repeat, stable relationship ordering breaks ties, and truncation is visible.

#### Scenario: Empty authority

- GIVEN no reachable calls
- WHEN traversal is stale, incomplete, untrusted, or not fresh
- THEN emptiness is unproven; only fresh complete authoritative traversal may mark it complete.

#### Scenario: Union-key path is unproven

- GIVEN a computed call has more than one relevant key alternative
- WHEN a spine is requested for the caller or either endpoint
- THEN no path is guessed, authority is non-authoritative, discovery is incomplete, and `empty_proven` is false.

#### Scenario: Direct path coexists with ambiguity

- GIVEN an exact direct call and an ambiguous computed-key site are both relevant
- WHEN spines are planned
- THEN the exact path remains while the unfinished site prevents complete or empty authority.

#### Scenario: JSON and TOON preserve authority

- GIVEN the same call-spine result is available in JSON and TOON
- WHEN either encoding is selected
- THEN path inclusion, incompleteness, authority state, and `empty_proven` have identical logical meaning.
