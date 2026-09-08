# ADR 0007: Keep impact relationships compiler-first

- Status: Accepted
- Date: 2026-08-06
- Decision owners: ast-mcp-server maintainers

## Context

Agents need more than isolated declarations: they need bounded evidence about callers, imports, exports, inheritance and other symbols affected by a change. A relationship layer can improve navigation and candidate-test discovery, but a guessed edge is worse than a missing optional edge when the result influences what an agent edits or treats as covered.

The repository can produce several kinds of relationship evidence:

- compiler-resolved declarations and references;
- syntax-derived structure without semantic resolution;
- heuristic conventions or name-based suggestions;
- derived index candidates used to accelerate routing.

These sources have different trust levels. Without a machine-readable distinction, syntax or heuristic edges can be mistaken for compiler proof, stale edges can survive a source change, and a traversal can appear complete after reaching a budget limit.

## Decision

Represent each relationship as a normalized edge with project-relative endpoints, relationship kind, provenance, confidence, resolution, freshness, a stable relationship ID and an explicit `compiler_authoritative` flag.

`compiler_authoritative` is true only when all of the following hold:

- `provenance === "compiler"`;
- `confidence === "exact"`;
- `resolution === "resolved"`;
- `freshness.state === "fresh"`.

A derived index may provide candidates for routing, but exact selector resolution and semantic relationship evidence are rechecked through the active compiler project. Index state never upgrades an edge's authority.

`ast_get_impact` is read-only and accepts one exact root selector. It performs deterministic bounded traversal with explicit direction, relationship-kind filters, and depth/node/edge/work budgets. If the compiler session is not fresh, the tool fails closed instead of presenting cached impact as current.

Completeness is not inferred from edge count. Every requested kind/direction/endpoint-class cell is `not_applicable`, `completed`, `unsupported`, or `unfinished`; aggregation uses fail-closed precedence (`unfinished` before `unsupported`, `completed`, then `not_applicable`). This semantic `coverage` remains separate from traversal `truncation` and shared `work`. `incomplete` is their conservative union, and `proven_empty` requires zero edges, complete applicable cells, and no exhausted bound.

The seven public relationship kinds and default-all selection remain stable. Exact direct identifier calls, constructors, and tagged templates are compiler-backed when they resolve to one project target. Property, element, dynamic, unresolved, multiple, or external dispatch emits no guessed call edge and leaves only the applicable direction `unfinished`. Applicable `contains` is `unsupported` because this decision adds no scoped containment producer. Computed-key alternatives (#219) and external convergence (#220) remain uncertified.

The internal test-candidate resolver is a pure read-side projection over exact impact evidence. It accepts only fresh, exact compiler-authoritative impact, applies bounded project conventions for test filenames/directories, and returns candidates with direct/transitive reason, confidence, relationship IDs and full bounded paths to the root. It never executes Jest, Vitest or another test runner, does not inspect coverage, and does not authorize a mutation.

Mutation preparation and apply remain separate. Impact, relationship and candidate-test output can inform review, but no relationship edge or candidate can bypass the existing prepare, diagnostics, hash review, freshness and explicit apply protocol.

## Consequences

### Positive

- Semantic authority is explicit and mechanically testable rather than implied by a field name or graph position.
- Stale, unresolved, ambiguous, syntax and heuristic evidence cannot silently become exact compiler evidence.
- Impact responses distinguish semantic gaps from traversal/work exhaustion while remaining deterministic and bounded.
- Complete zero-edge results can be recognized without treating unsupported analysis as proven empty.
- Candidate-test suggestions are explainable through relationship IDs and direct/transitive paths.
- The index remains replaceable and useful for routing without becoming a second compiler.
- Mutation safety stays on the existing operation-plan path.

### Negative

- Some useful framework, callback, dynamic-dispatch and runtime relationships remain unavailable or non-authoritative.
- Impact may return useful exact edges while still reporting semantic or bounded incompleteness.
- Additive coverage/work authority and per-edge trust metadata increase payload size.
- Candidate-test discovery is conservative and may omit tests that are related only through conventions, coverage or runtime behavior.

## Alternatives considered

### Text search by symbol name

Rejected. It creates false relationships for same-name declarations, strings, dynamic dispatch and unrelated files, and cannot provide compiler authority.

### Treat every syntax edge as exact

Rejected. AST shape can show a syntactic construct without proving module resolution, declaration identity or runtime behavior. Syntax evidence remains explicitly labeled.

### Use heuristic edges as mutation or test authority

Rejected. Name conventions and framework guesses are useful navigation hints but are not safe authorization evidence.

### Use a graph database as the semantic source

Rejected. Storage can accelerate derived queries but cannot replace the TypeScript compiler as semantic authority. Persistence is separately deferred by ADR 0005.

### Execute tests automatically to discover candidates

Rejected. It adds side effects, runtime/framework coupling and unbounded execution to a read tool. Candidate resolution remains pure and bounded; test execution belongs to an explicit external workflow.

### Collapse every gap into traversal truncation

Rejected. Semantic `unsupported`/`unfinished` coverage and depth/node/edge/work exhaustion answer different questions. Both must remain visible so an untruncated traversal cannot certify an absent producer.

## Evidence and verification

- `test/relationships.test.ts` covers compiler-resolved references/imports/exports/heritage, negative same-name and dynamic-dispatch controls, provenance and freshness authority.
- `test/impact.test.ts` covers exact roots, direction/kind filters, deterministic bounded traversal and depth/node/edge truncation.
- `test/test-candidates.test.ts` covers direct/transitive compiler paths, project conventions and rejection of stale/truncated/heuristic evidence.
- `test/mcp.integration.test.ts` verifies the public impact contract and read-only registration.
- `benchmark/impact-corpus.json` and `yarn benchmark:agent-workflows` retain negative controls for heuristic authority, stale evidence and truncated traversal.
- Full repository gates, MCP/CLI/package smokes and audit must pass before release.
