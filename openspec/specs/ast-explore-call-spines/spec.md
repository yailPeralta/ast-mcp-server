# ast-explore-call-spines Specification

## Purpose

Opt-in static call paths for exact selectors, without runtime claims.

## Requirements

### Requirement: Exact authoritative spines

The system MUST require exact `file_path + symbol_path` and include only fresh compiler-resolved invocation sites between project symbols. Generic references, types, imports, value callbacks, dynamic/heuristic/runtime edges MUST be excluded. Direction, shortest-path ties, cycles, depth/node/edge/byte truncation, and authority state MUST be deterministic and explicit.

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
