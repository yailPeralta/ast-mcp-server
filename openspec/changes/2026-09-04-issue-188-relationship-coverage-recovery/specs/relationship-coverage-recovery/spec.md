# Relationship Coverage Recovery Specification

## Requirements

### Requirement: Report every requested coverage cell deterministically

The operation MUST emit one entry per requested kind/direction cell. Kind order MUST be `reference`, `import`, `export`, `extends`, `implements`, `call`, `contains`; direction order MUST be `incoming`, then `outgoing`. Status MUST be `completed` for finished work, `not_applicable` for structurally inapplicable work, `unsupported` for no producer, or `unfinished` for incomplete work.

#### Scenario RCR-001: Stable order

- GIVEN all seven kinds are requested bidirectionally in arbitrary order
- WHEN coverage is serialized
- THEN fourteen unique entries follow the fixed kind and direction order.

#### Scenario RCR-002: Distinct states

- GIVEN one cell lacks a producer and another starts without finishing
- WHEN coverage is finalized
- THEN their statuses are `unsupported` and `unfinished` respectively.

### Requirement: Authorize aggregate evidence conservatively

Evidence MUST be complete only when applicable cells are `completed`, other cells are `not_applicable`, freshness is authoritative, and no bound or cancellation failed. `unsupported` or `unfinished` MUST make it incomplete. Only complete zero-edge evidence MAY be `proven_empty`.

#### Scenario RCR-003: Proven empty

- GIVEN every cell safely completes or is not applicable and yields no edge
- WHEN evidence is finalized
- THEN it is complete and MAY be `proven_empty`.

#### Scenario RCR-004: Unsafe cell

- GIVEN one cell is `unsupported` or `unfinished`
- WHEN all other cells complete
- THEN evidence is incomplete and MUST NOT be `proven_empty`.

### Requirement: Share one bounded request tracker

One request record MUST expose `max_items`, `consumed_items`, and `exhausted`. Kinds, directions, traversal, and production MUST share it without reset. Exhaustion MUST return `work_limit`; cancellation MUST return its typed outcome. Both MUST leave interrupted cells unfinished and return no authoritative page.

#### Scenario RCR-005: Shared record

- GIVEN earlier cells consumed request work
- WHEN a later cell reaches the limit
- THEN the same record is exhausted and `work_limit` is returned.

#### Scenario RCR-006: Cancellation

- GIVEN relationship work is active
- WHEN cancellation is observed
- THEN interrupted coverage is unfinished and no complete result is returned.

### Requirement: Recover scoped call evidence

`call` MUST evaluate scoped incoming callers and outgoing callees independently and emit only compiler-exact edges. Ambiguity MUST emit no guessed edge and leave only its direction unfinished. Final callable dispatch acceptance MUST belong exclusively to #186.

#### Scenario RCR-007: Call directions

- GIVEN the foundation proves an exact caller and callee
- WHEN both directions are requested
- THEN each reports only its scoped edge and status.

#### Scenario RCR-008: Isolated ambiguity

- GIVEN one direction is ambiguous and the other completes
- WHEN coverage is finalized
- THEN only the ambiguous direction is unfinished and evidence is incomplete.

### Requirement: Recover direct containment evidence

`contains` MUST report direct named module/declaration containment and its exact inverse. Statement, anonymous, and transitive nesting MUST NOT become direct edges.

#### Scenario RCR-009: Containment inverse

- GIVEN a named declaration is directly contained by a named owner
- WHEN both directions are requested
- THEN the direct edge and exact inverse are returned.

#### Scenario RCR-010: Containment exclusions

- GIVEN candidates are statements, anonymous, or transitively nested
- WHEN containment completes
- THEN none becomes a direct edge.

### Requirement: Preserve compatibility and delegated finality

The F-01 boundary MUST remain: four JSON/TOON tools keep `output_format` and omit a universal MCP `outputSchema`. Vocabulary MUST remain seven kinds. Read-only Harness verification MUST retain 15 guarded tools, absent apply, and direct `ast_apply_operation` denial as `UNKNOWN_TOOL`. Exact-once sorting/finalization accounting MUST belong exclusively to #187. Foundation and tracker MUST NOT be merge-authorized until #186 and #187 pass independently.

#### Scenario RCR-011: Compatibility denial

- GIVEN JSON, TOON, schemas, and guarded Harness are inspected
- WHEN compatibility is verified
- THEN F-01 remains unchanged and direct apply returns `UNKNOWN_TOOL`.

#### Scenario RCR-012: Merge gate

- GIVEN either #186 or #187 has not passed
- WHEN merge eligibility is evaluated
- THEN foundation and tracker remain non-mergeable.
