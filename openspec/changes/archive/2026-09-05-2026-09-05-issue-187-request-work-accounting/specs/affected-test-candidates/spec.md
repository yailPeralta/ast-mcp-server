# Delta for Affected Test Candidates

## MODIFIED Requirements

### Requirement: Fail closed on untrusted evidence

Candidates MAY be returned only when evidence is complete, fresh, exact, resolved, compiler-authoritative, and not work-exhausted. Stale, rebuilding, degraded, truncated, incomplete, unresolved, heuristic, or work-exhausted evidence MUST produce the existing typed `INCOMPLETE_EVIDENCE` error with bounded reason `work_limit` when applicable, never an empty or partial candidate page. Candidate grouping, path construction, sorting, and pagination MUST NOT begin after rejected impact evidence. A complete authoritative traversal with no matches MUST be marked proven empty.

(Previously: Incomplete evidence was rejected generally, without explicitly binding request-wide work exhaustion to pre-projection rejection and the bounded `work_limit` reason.)

#### Scenario: ATC-FAIL-001 Partial traversal is rejected

- GIVEN traversal reaches a node, edge, byte, or request-work limit before completion
- WHEN analysis is requested through MCP or `ast-tool run`
- THEN it returns `INCOMPLETE_EVIDENCE`, emits no candidate page, and reports bounded reason `work_limit` when work was exhausted.

#### Scenario: ATC-FAIL-002 Projection never runs on exhausted evidence

- GIVEN impact evidence is exhausted or incomplete
- WHEN candidate analysis receives it
- THEN candidate grouping, path traversal, sorting, and pagination perform no authority-bearing work or emission.

#### Scenario: ATC-FAIL-003 Proven empty result

- GIVEN complete authoritative non-exhausted traversal finds no eligible test relationship
- WHEN requested through either public surface
- THEN it returns an empty page marked complete and proven-empty with equivalent logical metadata.
