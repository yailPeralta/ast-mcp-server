# ADR 0012: Expose affected test candidates through compiler authority

- Status: Accepted
- Date: 2026-08-17
- Decision owners: ast-mcp-server maintainers

## Context

The service already projected affected test candidates from impact evidence, but clients could not request that outcome through MCP or the batch CLI. Reimplementing the projection in each client would duplicate conventions and could turn a partial traversal into false confidence.

The public contract must distinguish a proven empty result from missing evidence. It also must keep relationship proof intact when responses are paginated and keep MCP and CLI semantics aligned.

## Decision

Expose `ast_find_test_candidates` as a read-only MCP tool and admit it to `ast-tool run` as a read step.

The tool resolves an exact symbol in the synchronized TypeScript project and forces bounded incoming traversal. Callers cannot provide an impact graph, direction, relationship filters, or MCP TOON output. A candidate is eligible only when every relationship is fresh, exact, resolved, and compiler-authoritative.

Stale, rebuilding, degraded, truncated, incomplete, unresolved, heuristic, or non-authoritative analysis fails closed with a bounded public error. Only a complete authoritative traversal with no eligible test may return an empty page marked `proven_empty: true`.

Pagination applies to deterministic candidate objects, not their evidence. Each returned candidate retains its complete relationship IDs and relationship path. Traversal budgets remain independent from `offset` and `limit`.

The batch runner injects its authoritative `project_root`, rejects conflicts, and calls the registered MCP implementation through its in-memory client. JSON is the canonical logical result. `ast-tool run --output-format toon` encodes that final result losslessly; intermediate tool calls remain JSON.

## Consequences

### Positive

- Clients receive explainable direct, transitive, or convention-driven candidates without duplicating compiler analysis.
- Proven emptiness cannot be confused with incomplete traversal.
- Whole-candidate pagination preserves review evidence.
- MCP and batch CLI share registration, errors, ordering, budgets, and proof semantics.

### Negative

- Conservative compiler authority may omit tests connected only at runtime or through unsupported frameworks.
- Complete relationship paths repeat across pages and can increase payload size.
- Callers must execute selected tests separately; this operation is discovery only.

## Rollback

Remove `ast_find_test_candidates` from MCP registration, the read-batch allowlist, compatibility inventories, and public guidance. The internal resolver and compiler impact service remain available for a later design. Re-run MCP, CLI, package, and inventory gates after rollback.

## Evidence and verification

- `test/test-candidates.test.ts` proves trust rejection, classification, and whole-candidate pagination.
- `test/mcp.integration.test.ts` proves the public schema, annotations, errors, and deterministic candidates.
- `test/batch.test.ts` proves allowlisting, authoritative root injection, logical parity, and atomic pages.
- `scripts/cli-smoke.mjs` proves built CLI JSON/TOON parity through the registered implementation.
