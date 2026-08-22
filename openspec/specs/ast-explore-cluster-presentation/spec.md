# ast-explore-cluster-presentation Specification

## Purpose

Deterministic atomic exploration components within a caller-owned byte ceiling.

## Requirements

### Requirement: Bounded cluster presentation

The system MUST reserve the result shell and omission counters, select whole symbol clusters in stable order, and report canonical UTF-8 JSON with `used_bytes <= max_bytes`. Source and evidence MUST NOT be sliced; defaults MUST preserve ranking and perform no call work.

#### Scenario: Stable page

- GIVEN an identical request and compiler snapshot
- WHEN serialized repeatedly
- THEN ordering and bytes match and evidence has its symbol descriptor.

#### Scenario: Oversized symbol

- GIVEN the next symbol cannot fit with requested components
- WHEN planned
- THEN selector-only MAY be emitted, omissions are recorded, and numeric pagination advances.

#### Scenario: Default compatibility

- GIVEN no spine option
- WHEN any existing route runs
- THEN route/ranking semantics remain and no call traversal occurs.
