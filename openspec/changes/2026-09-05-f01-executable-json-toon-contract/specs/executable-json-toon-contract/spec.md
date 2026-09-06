# Executable JSON/TOON Contract Specification

## Purpose

Define retained executable evidence that registered MCP JSON and TOON results are equivalent without claiming a current runtime defect.

**Strict count:** 6 requirements; 12 scenarios.

## Requirements

### F01-REQ-001: Closed format eligibility

The eligible inventory MUST be exactly `ast_search_symbols`, `ast_find_references`, `ast_get_impact`, and `ast_get_diagnostics`.

#### F01-SCN-001: Exact eligible inventory

- GIVEN the registered server and oracle manifest
- WHEN their tool inventories are inspected
- THEN both MUST contain exactly the four eligible tools.

#### F01-SCN-002: Public input schemas

- GIVEN `tools/list` for every registered tool
- WHEN input schemas are inspected
- THEN eligible tools MUST expose `output_format` with enum `json | toon` and default `json`, while unsupported tools MUST omit it.

### F01-REQ-002: Registered paired execution

The oracle MUST invoke registered stdio MCP handlers, not only formatting helpers, using identical inputs first with explicit JSON and then explicit TOON.

#### F01-SCN-003: Paired transport calls

- GIVEN one declared case for an eligible tool
- WHEN the oracle runs it
- THEN the registered handler MUST receive identical semantic inputs in JSON then TOON mode.

#### F01-SCN-004: Incomplete oracle fails closed

- GIVEN a manifest or oracle missing, duplicating, or adding a tool or required case/check
- WHEN contract validation runs
- THEN it MUST fail rather than silently reduce coverage.

### F01-REQ-003: Canonical lossless success

JSON success MUST contain the canonical schema-validated object in `structuredContent`. TOON success MUST contain exactly `{format:"toon",data}` in `structuredContent`; both MUST use empty `content`. Decoded TOON MUST equal JSON after normalizing only `duration_ms` and `checked_at`.

#### F01-SCN-005: JSON canonical object

- GIVEN a successful JSON call
- WHEN its result is validated
- THEN `structuredContent` MUST satisfy that tool's canonical result schema.

#### F01-SCN-006: TOON envelope and equality

- GIVEN the paired successful TOON call
- WHEN `data` is decoded
- THEN the envelope MUST have only `format` and `data`, and the normalized decoded value MUST deeply equal normalized JSON.

### F01-REQ-004: Deterministic evidence

The oracle MUST serialize normalized canonical values deterministically and MUST produce stable bytes and hashes for identical fixtures.

#### F01-SCN-007: Stable normalized hash

- GIVEN two runs with identical fixtures
- WHEN normalized canonical bytes are hashed
- THEN their bytes and hashes MUST match exactly.

### F01-REQ-005: Required shape matrix

The retained matrix MUST exercise every eligible tool and collectively cover empty, paginated, bounded/truncated, Unicode, null, omitted optional, finite numeric, and boolean values.

#### F01-SCN-008: Empty and paginated collections

- GIVEN empty and multi-page fixture results
- WHEN paired cases run
- THEN empty arrays, offsets, limits, totals, and page booleans MUST remain equivalent.

#### F01-SCN-009: Bounded and truncated results

- GIVEN constrained graph or page budgets
- WHEN paired cases run
- THEN bounds, completeness, and truncation values MUST remain equivalent.

#### F01-SCN-010: Scalar and optional shapes

- GIVEN Unicode text, null and omitted fields, finite numbers, and booleans
- WHEN paired cases run
- THEN each value and omission distinction MUST survive losslessly.

### F01-REQ-006: Characterization and compatibility boundary

The work MUST state that current runtime probes reveal no defect. Production behavior MAY change only after this oracle witnesses a concrete defect. Public errors and limits MUST remain unchanged.

#### F01-SCN-011: Passing characterization

- GIVEN all contract cases pass existing runtime behavior
- WHEN results are reported
- THEN they MUST be characterized as retained evidence, not a fabricated runtime correction.

#### F01-SCN-012: Scope remains closed

- GIVEN no witnessed runtime defect
- WHEN the change is applied
- THEN it MUST NOT alter production behavior, `outputSchema`, issue #103 behavior, recovery, UI, Code Mode, apply/mutation flows, or Harness.

## Test Trace

| Scenarios       | Executable evidence                                               |
| --------------- | ----------------------------------------------------------------- |
| F01-SCN-001–002 | Registered `tools/list` plus exact manifest admission             |
| F01-SCN-003–004 | Dedicated stdio paired runner and fail-closed manifest test       |
| F01-SCN-005–007 | Canonical schema, envelope, decode/equality, byte/hash assertions |
| F01-SCN-008–010 | Declared fixture-case matrix                                      |
| F01-SCN-011–012 | Characterization and production-diff compatibility gates          |
