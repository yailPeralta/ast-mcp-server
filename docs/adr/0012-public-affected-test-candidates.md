# ADR 0012: Expose affected test candidates through compiler authority

- Status: Accepted
- Date: 2026-08-17
- Decision owners: ast-mcp-server maintainers

## Context

The service already projected affected test candidates from impact evidence, but clients could not request that outcome through MCP or the batch CLI. Reimplementing the projection in each client would duplicate conventions and could turn a partial traversal into false confidence.

The public contract must distinguish a proven empty result from missing evidence. It also must keep relationship proof intact when responses are paginated and keep MCP and CLI semantics aligned.

## Decision

Expose `ast_find_test_candidates` as a read-only MCP tool and admit it to `ast-tool run` as a read step.

The tool resolves an exact symbol in the synchronized TypeScript project and forces exactly six incoming kinds, in order: `reference`, `import`, `export`, `extends`, `implements`, and `call`. `contains` is excluded so its unsupported producer cannot block or certify candidate evidence. Callers cannot provide an impact graph, direction, relationship filters, or MCP TOON output.

Admission requires fresh, exact, resolved, compiler-authoritative edges; complete/inapplicable coverage for every six-kind cell; and no depth/node/edge/work exhaustion. Any semantic gap (`unsupported` or `unfinished`) or bounded traversal gap returns stable `INCOMPLETE_EVIDENCE` and no page. Deferred property/element/dynamic dispatch and the #219/#220 classifiers therefore cannot produce guessed candidates or a false empty result.

Pagination applies only after admission and deterministic sorting. Each candidate retains its complete relationship IDs and path; unpaginated `coverage`, `work`, relationship kinds, trust, freshness, traversal bounds, and counts remain available on every page. Only admitted zero-candidate evidence sets `completeness: { complete: true, proven_empty: true }`.

The batch runner injects its authoritative `project_root`, rejects conflicts, and calls the registered MCP implementation through its in-memory client. The additive metadata and gate decision are identical across MCP and batch. Candidate MCP output is canonical JSON; `ast-tool run --output-format toon` losslessly encodes that same final logical result while intermediate calls remain JSON.

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

- `test/test-candidates.test.ts` proves six-kind admission, semantic/bounded rejection, classification, and whole proofs.
- `test/mcp.integration.test.ts` proves additive authority metadata, stable errors, proven empty, and public registration.
- `test/batch.test.ts` proves authoritative root injection, unpaginated metadata, logical parity, and atomic pages.
- `benchmark/impact-corpus.json` separates unsupported containment, unfinished dispatch, proven empty, and bounded negative controls.
- `scripts/cli-smoke.mjs` proves built CLI JSON/TOON parity and fail-closed incomplete candidate evidence.
