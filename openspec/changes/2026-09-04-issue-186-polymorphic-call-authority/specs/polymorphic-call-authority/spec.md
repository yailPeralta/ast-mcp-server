# Polymorphic Call Authority Specification

## Purpose

Exact callable dispatch authority.

## Requirements

### Requirement: Prove callable dispatch

Call, construction, and tagged-template sites MUST be exact only when receiver alternatives converge on one implementation. Disjoint MUST require compiler proof against the incoming endpoint. Other uncertainty MUST be unfinished.

#### Scenario: Alternatives converge

- GIVEN receiver alternatives resolve identically
- WHEN the site is classified
- THEN one exact compiler-authoritative edge MUST result.

#### Scenario: Alternatives are uncertain

- GIVEN alternatives diverge, are ambiguous, external, anonymous, or unresolved
- WHEN the site is classified
- THEN no edge MUST be guessed and coverage MUST be unfinished.

#### Scenario: Endpoint is disjoint

- GIVEN compiler evidence excludes the queried endpoint
- WHEN incoming dispatch is classified
- THEN the site MUST be disjoint without contaminating endpoint coverage.

### Requirement: Cover virtual callable forms

Methods, callable properties, and callable accessors MUST use convergence. Interface, union, base, and parameter receivers MUST NOT become exact from syntax or one implementation.

#### Scenario: Callable getter override

- GIVEN a base receiver invokes an override-capable callable getter
- WHEN a child may replace it
- THEN dispatch MUST be unfinished unless alternatives converge.

#### Scenario: Callable property override

- GIVEN an interface, base, or parameter receiver invokes a callable property
- WHEN that property is override-capable
- THEN dispatch MUST be unfinished unless alternatives converge.

#### Scenario: Method and union dispatch

- GIVEN an override-capable method or union receiver has alternatives
- WHEN alternatives converge, differ, or remain unresolved
- THEN dispatch MUST respectively be exact, unfinished, or unfinished.

### Requirement: Preserve exact controls

Uniquely resolved private and `#private` slots, `super`, free functions, lexical class statics, constructors, and single-implementation overloads MUST remain exact. Parameter syntax MUST NOT weaken nominal private proof. Constructor parameters and static `this` MUST remain unfinished when subclass dispatch is possible.

#### Scenario: Private owner parameter

- GIVEN an owner parameter accesses its private or `#private` slot
- WHEN one nominal slot resolves
- THEN one exact edge MUST result.

#### Scenario: Non-virtual exact controls

- GIVEN `super`, free, lexical-static, constructor, or unique-overload dispatch
- WHEN one implementation resolves
- THEN one exact edge MUST result.

#### Scenario: Polymorphic static receiver

- GIVEN a constructor parameter or static `this` may denote a subclass
- WHEN its static member is invoked
- THEN dispatch MUST be unfinished unless alternatives converge.

### Requirement: Isolate coverage and stabilize edges

Incoming and outgoing coverage MUST remain independent. Exact edges MUST preserve stable identity, order, deduplication, freshness, and compiler authority.

#### Scenario: Directional isolation

- GIVEN exact, unfinished, and disjoint sites exist
- WHEN either impact direction is requested
- THEN only its applicable unfinished sites MUST poison that direction.

#### Scenario: Stable edge set

- GIVEN unchanged fresh state and repeated exact sites
- WHEN collection repeats
- THEN edge identity, order, and deduplication MUST remain stable.

### Requirement: Preserve work and cancellation

This capability MUST NOT change charging, sorting, retention, finalization, work limits, cancellation checkpoints, or fail-closed outcomes. Those remain #187 scope.

#### Scenario: Runtime controls remain unchanged

- GIVEN equal generous work limits and cancellation state
- WHEN equivalent requests run
- THEN only dispatch evidence MAY differ.

### Requirement: Keep consumers fail closed

Scoped relationships and whole-project call spines MUST share dispatch authority. Spines MUST exclude guessed edges. Affected-test candidates MUST reject unfinished incoming call coverage. Acceptance MUST use fresh #186 evidence over recovered U7 and MUST NOT claim #187 accounting or closed #161 Judgment authority.

#### Scenario: Ambiguity reaches consumers

- GIVEN callable dispatch is unfinished
- WHEN spines or candidates consume it
- THEN no authoritative spine, candidate result, or proven emptiness MUST result.

#### Scenario: Exact acceptance boundary

- GIVEN dispatch is complete, fresh, exact #186 evidence over U7
- WHEN consumers or acceptance evaluate it
- THEN eligibility MUST match scoped authority, while #187 and Judgment evidence MUST grant none.
