## Exploration: Improve `ast_explore` presentation

### Decision Summary

Proceed with one SDD change, but keep the first public slice narrow: adaptive clustering and omission metadata apply to every existing `ast_explore` route, while call spines are opt-in and require the existing exact `file_path + symbol_path` route. Do not infer a call graph from the current generic `reference` edges. Add a bounded compiler-resolved call projection, then let a small presentation service build deterministic spines and allocate the existing hard byte budget.

This keeps the four presentation capabilities coherent without turning `ast_explore` into a second impact engine or a repository-wide graph product.

### Business Problem and Outcome

Agents currently receive ranked symbols, optional whole declaration source, and compiler references, but a tight byte budget can remove evidence without naming the affected selector or component. They also have no concise path-shaped explanation of how an exact symbol calls or is called by other symbols. The outcome should be a response that is easier to consume while remaining testably bounded and honest about every omission.

Success is observable when:

- the same request and compiler snapshot always produce the same ordered output;
- `budget.used_bytes` never exceeds `max_bytes`;
- no source body or evidence record is string-truncated;
- an empty call-spine result is presented as complete only after a complete, fresh, authoritative traversal;
- MCP and `ast-tool run` expose the same logical JSON result, with final CLI TOON only changing serialization.

### Current State

- The compiler project was `fresh` during exploration; the compiler and watcher were ready, the symbol index was disabled with compiler fallback available, and `src/tools/explore.ts`, `src/services/context-builder.ts`, and `src/services/relationships.ts` had no compiler diagnostics.
- `src/tools/explore.ts` exposes query, file, and exact-symbol routes. `detail` progresses from selectors to summaries, source, and source plus compiler references. The public byte ceiling is caller-controlled, defaults to 64 KiB, is at least 1 KiB, and is capped at 1 MiB.
- `src/services/context-builder.ts` preserves search ranking and pagination, resolves each page item through the active compiler project, returns a whole declaration from `node.getText()`, and collects a bounded reference page.
- Byte fitting is currently a tail-removal loop over two parallel arrays. It removes whole evidence objects before removing symbols. This avoids sliced source text, but it can leave a returned symbol without requested evidence, reports only the aggregate `byte_limit`, and does not identify which selector/component was omitted.
- `completeness.evidence_complete` currently means that an evidence object exists for each returned symbol. It does not account for `references.has_more`, and `unresolved` only distinguishes source or reference resolution failures. Budget omission, incomplete compiler work, and non-authoritative evidence are not separate concepts.
- A very large summary/signature can force every symbol off a page. Because `next_offset` is derived from the number of returned symbols, a zero-symbol byte page can repeat the same offset instead of guaranteeing pagination progress.
- `src/services/relationships.ts` declares `call` and `contains` in the relationship-kind vocabulary, but the compiler collectors currently produce references, imports, exports, extends, and implements relationships. No producer emits an exact `call` edge. Compiler-backed impact evidence confirms that generic `reference` edges also include types, interfaces, properties, and other non-invocation uses; labeling those edges as calls would be incorrect.
- `src/services/impact.ts` already provides deterministic bounded traversal, stable endpoint/edge identity, explicit depth/node/edge truncation, and freshness-aware compiler authority. Those invariants should be reused rather than recreated in the MCP adapter.
- `ast_explore` is registered over MCP but is absent from `READ_BATCH_TOOLS`, so `ast-tool run` cannot currently execute it. The batch runner otherwise injects the authoritative project root and invokes the same registered MCP implementation, which is the correct parity mechanism.
- Existing tests cover routes, ranking, pagination beyond 10,000 results, exact source plus references, cancellation, compiler-index fallback, MCP schemas, and a 1 KiB byte limit. They do not cover call classification/spines, selector-level omissions, reference-page incompleteness, oversized single-symbol progress, atomic presentation variants, or batch parity.

### Call Path / Spine Definition

A call spine MUST describe static compiler-resolved call-site relationships, not a runtime stack, coverage trace, or generic reference chain.

An exact call relationship exists only when:

1. the TypeScript compiler resolves the referenced declaration inside the project;
2. the reference is the invoked expression of a call-like syntax node (`CallExpression`, constructor invocation, or tagged-template invocation), after deterministic wrapper normalization;
3. the source is the innermost containing project symbol and the target is the resolved project declaration; and
4. the relationship is fresh, compiler-provenanced, exact, resolved, and therefore `compiler_authoritative`.

Value references, type references, imports alone, callbacks merely passed as values, unresolved dynamic dispatch, and framework/runtime conventions are not calls. They remain available through existing reference/impact evidence but do not enter a call spine.

A spine is one canonical shortest path per reachable endpoint over those directed call relationships:

- outgoing paths follow root caller to callees;
- incoming paths preserve actual call order from caller to the requested root;
- cycles never repeat an endpoint;
- sorted relationship IDs determine predecessor selection when several shortest paths exist;
- paths are ordered by direction, length, and stable endpoint identity (`file`, `symbol_path`, `selector`);
- explicit depth, node, edge, and byte ceilings remain visible.

The first slice should keep this projection internal to exploration. It should reuse the normalized relationship endpoint/trust contract but must not change the existing generic `reference` semantics or silently claim that `ast_get_impact` already supports public call traversal.

### Adaptive Budget Decision

Keep `max_bytes` as the caller-owned hard ceiling. "Adaptive" means deterministic allocation inside that ceiling, not a model-selected or history-dependent limit.

Use a pure presentation planner with this order:

1. reserve the fixed result shell, freshness/completeness fields, and compact omission counters;
2. preserve the requested root selector and pagination progress;
3. for an exact-symbol route, prioritize the root cluster, then call-spine paths by distance and stable identity;
4. for query/file routes, preserve the existing ranked page order;
5. add source bodies and reference records only at whole component boundaries;
6. stop or downgrade a presentation variant before canonical serialized bytes would exceed `max_bytes`.

Source text is all-or-nothing. Reference locations remain whole records and may use a shorter deterministic prefix with their existing `has_more`/`next_offset` metadata. Summary fields may downgrade to selector-only form when necessary to guarantee that a non-empty logical page advances its numeric offset. Every downgrade creates omission metadata; nothing disappears silently. The final object is measured again with the same canonical UTF-8 JSON representation used for `budget.used_bytes`.

### Whole-Symbol Clustering Decision

Build one internal cluster per selector instead of budgeting `symbols` and `evidence` independently. A cluster owns:

- the reusable symbol descriptor;
- the complete declaration source, when requested and admitted;
- the bounded reference page, when requested and admitted;
- call-spine membership/evidence for exact-symbol presentation.

The public response may retain the existing `symbols` and `evidence` arrays for compatibility, but both must be projected from the selected cluster variants. A source body is never sliced, an evidence item is never emitted without its symbol descriptor, and unresolved/omitted metadata is filtered to the selectors represented by that page. A component too large for the budget is omitted as a component, not partially serialized.

### Omission Metadata Decision

Add bounded, additive omission metadata with three semantic categories:

| Category     | Meaning                                                                      | Examples                                                                              | Caller interpretation                                  |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `budget`     | Valid evidence exists but a declared output/traversal limit excluded it      | byte, record, reference, depth, node, edge limit                                      | Retry with a continuation or a larger explicit budget  |
| `incomplete` | The compiler-backed operation could not finish or resolve requested evidence | source/reference unresolved, interrupted relationship discovery, incomplete traversal | Do not treat absence as a negative result              |
| `untrusted`  | Available relationship evidence failed the authority contract                | non-fresh, non-compiler, non-exact, unresolved, or ambiguous edge                     | Evidence is withheld; never upgrade it to a call claim |

Each omission entry should identify a stable selector/path subject, the omitted component (`signature`, `source`, `references`, or `call_spine`), category, and machine-readable reason. To keep metadata bounded, also return exact counts by category/component, a deterministic prefix of detailed entries, and `has_more` when detail entries themselves are summarized. The result shell reserves room for these counts before admitting optional evidence.

Existing `truncation` remains the aggregate hard-limit signal. Existing `completeness.unresolved` remains compatible, but `completeness.complete` and `evidence_complete` must account for reference-page continuations, omitted requested components, and incomplete/untrusted spine evidence. Freshness stays orthogonal: a structurally complete stale result is still not current compiler evidence.

### Affected Areas

- `src/services/context-builder.ts` — replace parallel-array tail trimming with cluster construction and projection; correct completeness and pagination progress.
- `src/services/explore-presentation.ts` (new) — pure deterministic cluster selection, spine projection, omission aggregation, and byte accounting.
- `src/services/relationships.ts` — expose a bounded exact call-site projection using existing endpoint and trust normalization; do not reinterpret generic references.
- `src/services/impact.ts` — reuse traversal ordering/budget concepts or a shared pure path helper; avoid duplicating graph semantics.
- `src/tools/explore.ts` — additive opt-in spine inputs and additive output schemas for spines/omissions.
- `src/batch/schema.ts` — admit `ast_explore` as a read step so batch uses the same MCP handler.
- `src/batch/runner.ts` — likely no semantic change; verify project-root injection, retained-context limits, foreach bounds, and logical output parity.
- `src/server.ts` — registration is already correct; verify only unless the tool contract wiring changes.
- `test/context-builder.test.ts`, `test/explore.test.ts` — clustering, exact byte bounds, progress, completeness, and omission categories.
- `test/relationships.test.ts`, `test/impact.test.ts` — exact call-site classification, branches, cycles, stable paths, and bounded/incomplete evidence.
- `test/mcp.integration.test.ts`, `test/batch.test.ts` — additive public schema, default compatibility, project-root authority, and MCP/batch JSON plus final TOON parity.
- `scripts/canary-local-mcp.mjs`, `scripts/mcp-smoke.mjs` — accepted arguments, response shape, and inventory/parity checks.
- `benchmark/context-corpus.json`, `scripts/benchmark-agent-workflows.mjs` — branching call-spine, tight-budget, large-symbol, and omission scenarios; benchmark claims must remain project-owned and reproducible.
- `README.md`, `CHANGELOG.md`, a new ADR, and `skills/structural-code-editing/SKILL.md`/`releases.json` — explain static-call semantics, omissions, batch availability, and managed guidance.

### Approaches

1. **Extend `context-builder.ts` inline** — add call lookup, path shaping, and smarter trimming directly to the existing builder.
   - Pros: Few new modules; fastest initial patch.
   - Cons: Mixes compiler discovery, graph semantics, presentation, and serialization policy in an already central service; hard to test deterministically; encourages MCP-only behavior.
   - Effort: Medium.

2. **Small presentation service over exact compiler evidence** — keep route/search resolution in the builder, add a bounded exact call projection at the relationship boundary, and pass clusters plus optional call evidence to a pure presenter.
   - Pros: Preserves compiler authority and existing search ranking; isolates budget/omission policy; enables focused property-style tests; the same output flows through MCP and batch.
   - Cons: Requires an additive public result contract and careful reserved metadata accounting; touches relationship tests to prove that calls are not generic references.
   - Effort: Medium-High.

3. **General repository call-graph/index subsystem first** — materialize call edges broadly, persist them, and make exploration query that graph.
   - Pros: Could support future repository-wide graph queries.
   - Cons: Violates the smallest-slice goal, duplicates or weakens live compiler authority, creates freshness/index lifecycle work, and expands into multi-language/backend design prematurely.
   - Effort: High.

### Recommendation

Choose approach 2. Keep one named SDD change because call spines, adaptive budgeting, whole-symbol clusters, and omission semantics share one correctness boundary: a path is not useful if its evidence can be partially or silently removed. Narrow the public behavior rather than splitting the contract:

- all routes receive deterministic clustering and explicit omissions;
- only the exact-symbol route can request call spines in the first slice;
- defaults remain backward-compatible and do not add graph work unless requested;
- `ast_explore` becomes a read-batch operation using the same MCP implementation;
- implementation may be delivered as reviewable PR slices if the tasks forecast exceeds 400 changed lines.

Suggested implementation slices are: (1) exact call classification and pure spine planner with unit tests; (2) cluster budgeting/omissions and MCP schema; (3) batch parity, benchmarks, ADR, and managed documentation. These are delivery slices inside one coherent SDD change, not separate product contracts.

### Current Test Gaps

- No test proves that a generic value/type reference is excluded from call paths.
- No exact call tests cover functions, methods, constructors, tagged templates, branches, cycles, ambiguous declarations, or dynamic dispatch.
- No test proves deterministic predecessor selection when several shortest paths exist.
- No tight-budget test checks a single oversized body/signature, guaranteed offset progress, or simultaneous record and byte omission.
- No test verifies that source text is atomic and reference-page `has_more` makes evidence incomplete.
- No public test distinguishes budget, incomplete, and untrusted omission categories.
- No batch test admits `ast_explore` or compares MCP logical JSON with final CLI JSON/TOON.
- The existing context corpus has only two happy-path scenarios and no branching spine, stale/untrusted relationship, or omission negative control.

### Risks

- **Semantic overclaim:** A static compiler call spine can be mistaken for runtime execution. Mitigate with the exact definition above and explicit out-of-scope wording in schema/docs.
- **Backward compatibility:** Changing default fields or ranking could break clients and benchmarks. Keep new inputs opt-in, make output additions additive, and preserve current ranked selector order.
- **Budget metadata recursion:** Detailed omissions themselves consume bytes. Reserve compact counts first and bound detailed samples.
- **Pagination stall:** An oversized first symbol can yield no progress. Permit deterministic selector-only fallback with an explicit omitted-component record.
- **Graph cost:** Incoming call discovery can scan many compiler nodes. Reuse scoped relationship work budgets, cancellation checkpoints, and explicit depth/node/edge limits.
- **Authority drift:** Do not derive calls by target name or by treating all references to callable declarations as invocation. Only compiler-resolved call-site syntax qualifies.
- **Working-tree overlap:** The repository already contains unrelated modified/untracked release-candidate and archived-change files. Implementation must edit only the approved change paths and preserve all unrelated files.

### Out of Scope

- Heuristic framework edges, callback conventions, dependency-injection guesses, runtime coverage, or dynamic dispatch inference.
- Making syntax or heuristic evidence compiler-authoritative.
- Multi-language backends, SCIP, ast-grep/Tree-sitter integration, or capability negotiation.
- Mutations, diagnostics policy changes, operation plans, staging, commits, pushes, or PR creation.
- Repository-wide call-graph persistence, new index lifecycle work, or changing the derived symbol index into an authority.
- Broadening the public `ast_get_impact` call-kind contract in this first slice.
- Guessing a call-spine root from a query/file result; callers must provide an exact selector.

### Ready for Proposal

Yes. The proposal should preserve all four capabilities in one change while explicitly limiting first-slice call spines to opt-in exact-symbol exploration. It should require static compiler-resolved call semantics, a hard deterministic byte ceiling, atomic component projection, bounded omission metadata, and identical logical MCP/batch results. The proposal must reject any design that labels generic reference chains or heuristic/runtime relationships as calls.
