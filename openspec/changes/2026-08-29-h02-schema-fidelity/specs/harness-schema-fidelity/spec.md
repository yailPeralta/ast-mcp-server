# Harness Schema Fidelity Specification

## Requirement: Required input publication

The system MUST publish `ast_explore` as an object schema whose `required` set contains `project_root` at direct MCP, scoped Harness, and native model boundaries.

### Scenario: Public RED and candidate GREEN

- GIVEN the pinned Harness and public 0.13.0 package
- WHEN native tool schemas are captured
- THEN public `ast_explore` lacks the required declaration and the candidate restores it without changing the other 14 schemas.

## Requirement: Cross-field rejection

The system MUST reject an empty route, `symbol_path` without `file_path`, and `call_spines` without exact file and symbol inputs.

### Scenario: Invalid native invocation

- WHEN each invalid combination is executed through the Harness registry
- THEN it produces a deterministic tool failure, never a successful or transport-level result.

## Requirement: Explicit output exception

Native schema evidence MUST distinguish model-facing input schemas from MCP output schemas. JSON/TOON tools MAY omit one universal structured output schema rather than publish a false shape.
