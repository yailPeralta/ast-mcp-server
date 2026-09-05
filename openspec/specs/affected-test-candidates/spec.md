# Affected Test Candidates Specification

## Requirements

### Requirement: Resolve an exact project root

The operation MUST accept a project root, file selector, and symbol selector, resolve them inside the active compiler project, and reject missing, ambiguous, or excluded roots with an error. Callers MUST NOT supply an impact graph, direction, or relationship filter.

#### Scenario: Exact symbol resolves

- GIVEN an included source file and unambiguous symbol selector
- WHEN `ast_find_test_candidates` is invoked
- THEN the response identifies the resolved root and proceeds.

#### Scenario: Root cannot be resolved

- GIVEN a missing, ambiguous, or excluded selector
- WHEN the operation is invoked
- THEN it returns an error and no page.

### Requirement: Traverse incoming compiler relationships

The operation SHALL use a synchronized compiler session, incoming traversal, and depth, node, and edge budgets. Caller-provided or outgoing/bidirectional relationships MUST NOT become affected-test evidence.

#### Scenario: Incoming traversal is authoritative

- GIVEN a resolvable root and fresh compiler session
- WHEN analysis runs
- THEN only compiler-owned incoming relationships are used and budgets are reported.

### Requirement: Fail closed on untrusted evidence

Candidates MAY be returned only when evidence is complete, fresh, exact, resolved, compiler-authoritative, and not work-exhausted. Stale, rebuilding, degraded, truncated, incomplete, unresolved, heuristic, or work-exhausted evidence MUST produce the existing typed `INCOMPLETE_EVIDENCE` error with bounded reason `work_limit` when applicable, never an empty or partial candidate page. Candidate grouping, path construction, sorting, and pagination MUST NOT begin after rejected impact evidence. A complete authoritative traversal with no matches MUST be marked proven empty.

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

### Requirement: Classify deterministic candidates

The operation MUST preserve deterministic ordering and report direct, transitive, and convention-driven reasons. Each candidate MUST include its exact relationship path and relationship identifiers; conventions MUST NOT override compiler evidence.

#### Scenario: Direct and transitive candidates

- GIVEN fresh incoming evidence containing direct and multi-hop test dependents
- WHEN the operation runs
- THEN it returns both with their direct or transitive reason and its path.

#### Scenario: Convention-driven candidate

- GIVEN a compiler-resolved test file matching configured conventions
- WHEN the operation runs
- THEN it reports the convention-driven reason only with valid compiler evidence.

### Requirement: Paginate whole candidate proofs

The operation MUST support bounded offset/limit pagination over a deterministic sequence. Pages MUST include candidates atomically and MUST NOT truncate, split, or weaken relationship paths. Traversal budgets remain distinct from page limits.

#### Scenario: Page boundary preserves evidence

- GIVEN more candidates than the page limit
- WHEN consecutive pages are requested
- THEN candidates are neither duplicated nor omitted, and each retains full proof.

### Requirement: Return trust and budget metadata

Responses MUST identify the TypeScript compiler backend, resolved root, `compiler_authoritative`, freshness, completeness, truncation/proven-empty state, traversal counts, effective depth/node/edge budgets, and page bounds. Errors MUST use bounded codes/messages without source paths, stacks, raw arguments, or secrets.

#### Scenario: Metadata distinguishes confidence

- GIVEN a successful non-empty or proven-empty analysis
- WHEN the response is serialized
- THEN trust, freshness, completeness, truncation, and budget metadata are present and valid.

### Requirement: Keep MCP and batch semantics identical

MCP and `ast-tool run` MUST use one implementation and produce identical candidate ordering, relationship proof, metadata, and errors; serialization differences MUST NOT change meaning. Capability inventory, read-only batch allowlist, compatibility checks, tests, documentation, and managed skill metadata MUST advertise the same contract.

#### Scenario: Cross-surface parity

- GIVEN identical selectors, conventions, budgets, and page bounds
- WHEN invoked through MCP and `ast-tool run`
- THEN both return equivalent logical results and evidence.

#### Scenario: Inventory remains synchronized

- GIVEN the capability is installed and queried by compatibility checks
- WHEN the public tool list is inspected
- THEN `ast_find_test_candidates` appears exactly once and synchronized surfaces agree on availability.
