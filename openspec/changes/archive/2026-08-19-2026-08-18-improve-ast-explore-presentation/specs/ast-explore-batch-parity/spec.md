# ast-explore-batch-parity Specification

## Purpose

Expose `ast_explore` in read batches through one semantic implementation.

## Requirements

### Requirement: MCP-handler parity

The system MUST admit `ast_explore` as a bounded read step, invoke the registered MCP handler, inject the authoritative project root, and preserve logical JSON/TOON meaning; TOON MAY change serialization only. Bounds and failures MUST remain explicit and deterministic.

#### Scenario: Equivalent execution

- GIVEN an admissible request and project root
- WHEN run directly and in a read batch
- THEN fields, ordering, omissions, completeness, and byte accounting are equivalent.

#### Scenario: Root or bound failure

- GIVEN a conflicting/missing root or exceeded batch/context bound
- WHEN execution is attempted
- THEN the authoritative root and declared bounded error apply, without alternate handlers or silent truncation.

#### Scenario: Final serialization

- GIVEN one logical result
- WHEN CLI JSON or TOON is requested
- THEN JSON is MCP-equivalent and TOON changes representation, not meaning.
