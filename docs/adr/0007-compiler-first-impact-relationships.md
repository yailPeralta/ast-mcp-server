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

The unmerged #188 recovery candidate keeps `ast_get_impact` read-only and adds one request-scoped work record plus a root-endpoint-class coverage ledger. The ledger has at most 14 cells: `reference`, `import`, `export`, `extends`, `implements`, `call`, and `contains`, each ordered incoming then outgoing. Status is `completed`, `not_applicable`, `unsupported`, or `unfinished`; aggregation uses `unfinished > unsupported > completed > not_applicable`. Freshness, traversal bounds, cancellation, shared-work exhaustion, and every requested cell jointly determine completeness. Only complete zero-edge evidence may be `proven_empty`; exhaustion returns `work_limit`, and cancellation returns `REQUEST_CANCELLED` without partial authority.

Calls require exact scoped compiler resolution; ambiguity remains unfinished, with final polymorphic callable authority still delegated to approved #186. Containment is direct named compiler ownership only: module→top-level declaration or named owner→direct named child, with incoming as its inverse. Statements, parameters, anonymous/runtime owners, and producer-transitive edges are excluded. Syntax, heuristic, and index evidence never upgrades authority. Approved #187 still owns exact-once request-wide sorting/finalization accounting.

The internal test-candidate resolver is a pure read-side projection over exact impact evidence. It accepts only fresh, exact compiler-authoritative impact, applies bounded project conventions for test filenames/directories, and returns candidates with direct/transitive reason, confidence, relationship IDs and full bounded paths to the root. It never executes Jest, Vitest or another test runner, does not inspect coverage, and does not authorize a mutation.

Mutation preparation and apply remain separate. Impact, relationship and candidate-test output can inform review, but no relationship edge or candidate can bypass the existing prepare, diagnostics, hash review, freshness and explicit apply protocol.

## Consequences

### Positive

- Semantic authority is explicit and mechanically testable rather than implied by a field name or graph position.
- Stale, unresolved, ambiguous, syntax and heuristic evidence cannot silently become exact compiler evidence.
- Impact responses remain deterministic and bounded for large projects.
- Candidate-test suggestions are explainable through relationship IDs and direct/transitive paths.
- The index remains replaceable and useful for routing without becoming a second compiler.
- Mutation safety stays on the existing operation-plan path.

### Negative

- Some useful framework, callback, dynamic-dispatch and runtime relationships remain unavailable or non-authoritative.
- Impact can fail closed or report incomplete traversal where a heuristic graph would return more edges.
- Every edge carries provenance, confidence, resolution and freshness metadata, increasing payload size.
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

### Return an unmarked truncated traversal

Rejected. Depth, node, edge and unsupported-kind gaps must be visible so callers do not interpret a bounded graph as a complete impact closure.

## Evidence and verification

> Candidate status: the #188 recovery is not merged, approved for delivery, archived, released, or merge-authorized. Its integration is blocked until #186 and #187 pass independently. Closed #161 evidence grants none of those authorities.

- `test/relationships.test.ts` covers compiler-resolved references/imports/exports/heritage, negative same-name and dynamic-dispatch controls, provenance and freshness authority.
- `test/impact.test.ts` covers exact roots, direction/kind filters, deterministic bounded traversal and depth/node/edge truncation.
- `test/test-candidates.test.ts` covers direct/transitive compiler paths, project conventions and rejection of stale/truncated/heuristic evidence.
- `test/mcp.integration.test.ts` verifies the public impact contract and read-only registration.
- `benchmark/impact-corpus.json` and `yarn benchmark:agent-workflows` retain negative controls for heuristic authority, stale evidence and truncated traversal.
- Full repository gates, MCP/CLI/package smokes and audit must pass before release.
