# Proposal: compiler-first code intelligence for Hermes

## Outcome

Evolve `ast-mcp-server` into the canonical compiler-first code intelligence MCP for Hermes. The server will preserve its existing safe mutation engine while adding a bounded read layer inspired by CodeGraph: exact file retrieval, composed exploration, explicit freshness, incremental indexing, typed relationships, impact analysis, candidate test discovery and measured agent workflows.

The implementation is phased. The first shippable slice improves agent navigation without introducing a persistent database or watcher. Later slices add those capabilities only behind correctness, packaging and performance gates.

## Business problem

Hermes currently has accurate AST primitives, but an agent still has to discover how to combine them and the server refreshes/scans more state than necessary for repeated read workflows. The resulting costs are:

- additional model round-trips for common exploration;
- repeated full-project symbol scans;
- unclear stale/index state when files change during a session;
- weak visibility into callers, dependencies and likely tests affected by a change;
- no reproducible agent-task measure for whether a compact result actually answers the task.

If nothing changes, the mutation safety remains strong but the read workflow will become less attractive as repositories and sessions grow. The desired outcome is not a generic graph database; it is less context and fewer round-trips while retaining exact TypeScript semantics and fail-closed edits.

## Goals

1. Give Hermes one clear, bounded exploration entry point for common TypeScript/JavaScript questions.
2. Provide exact current-file reads with hashes and bounded ranges.
3. Avoid re-parsing unchanged files during repeated session reads.
4. Make freshness, pending changes and degraded fallbacks visible to the agent.
5. Expose relationships and impact with provenance, confidence and traversal limits.
6. Return candidate tests with reasons without pretending the graph is complete.
7. Measure task correctness, evidence reachability, calls, payload and fallback behavior.
8. Extend agent setup without weakening conflict-safe/idempotent installation.
9. Keep all existing mutation plans, hashes, diagnostics and receipts safe and compatible.

## Non-goals

- CodeGraph compatibility or dependency integration.
- Multi-language support in this initiative.
- External embeddings, remote search or vector storage.
- Automatic test execution or automatic code modification.
- Heuristic graph edges as authorization for mutation.
- A required daemon or always-on watcher.

## Proposed public surface

### `ast_get_file`

A read-only structural file retrieval tool with:

- project-relative `file_path`;
- bounded `offset` and `limit` line range;
- optional `symbols_only` mode;
- exact source text and line numbers;
- file hash and freshness metadata;
- deterministic project-relative paths.

It is a code-aware equivalent of a bounded generic file read, not a new write path.

### `ast_explore`

A read-only composed workflow that can accept a query and optional routing constraints, then return bounded progressive evidence:

- ranked symbol matches;
- exact selectors;
- body-free summaries;
- selected source declarations when requested;
- shallow relationships;
- affected files and freshness state;
- continuation metadata where budgets are reached.

The tool MUST call the same internal services as the primitive tools. It MUST NOT implement a second symbol resolver or silently use text matching for semantic operations.

### `ast_get_project_status`

A read-only operational/status tool returning:

- canonical project identity without leaking unnecessary absolute paths;
- config and compiler snapshot state;
- source file count;
- index coverage and version;
- pending files;
- watcher state;
- last sync/index timings;
- degraded/error state and safe fallback mode.

### `ast_get_impact`

A read-only bounded relationship and impact tool supporting:

- exact symbol selector input;
- direction (`incoming`, `outgoing`, `both`);
- bounded depth and node/edge budgets;
- relationship-kind filters;
- optional candidate test discovery;
- per-edge provenance, confidence and source location;
- incomplete/truncated indicators.

The first release should prioritize module/import, inheritance, type/reference and compiler-resolved usage relationships. Call and framework relationships remain explicitly lower-confidence unless resolved by a supported compiler path.

## Success criteria

The initiative is successful only if all of the following are true:

1. Existing v0.5.0 tools and mutation safety tests remain green.
2. `ast_get_file` returns exact bounded source for valid project files and fails closed on ambiguous/out-of-project paths.
3. `ast_explore` can complete the checked search-to-source workflow in one MCP call without losing required selectors or source evidence.
4. The default exploration response is bounded by explicit byte/record/depth budgets and reports truncation rather than silently dropping evidence.
5. Unchanged files are not reparsed or re-indexed on a warm read path after the initial index is ready.
6. Every read response that relies on cached/indexed data exposes freshness state and source/config fingerprint information sufficient for safe interpretation.
7. `ast_get_impact` never labels a syntax or heuristic edge as compiler-authoritative and never participates in mutation plan approval.
8. Candidate tests include a reason and confidence; missing or incomplete graph data is reported rather than hidden.
9. The checked agent corpus preserves declared evidence, does not exceed the declared call bound, and reports payload, fallback and latency measurements separately.
10. Persistent storage, if enabled, survives restart and schema migration tests; corruption or unsupported storage fails back to rebuild/read-only mode without affecting mutations.
11. Agent setup remains conflict-safe, idempotent, secret-free and compatible with Claude/Hermes before additional targets are enabled.
12. Documentation clearly distinguishes exact, cached, syntax-derived and heuristic evidence.

## Release strategy

### Phase 1: read parity and context composition

Ship `ast_get_file`, `ast_get_project_status`, common context contracts and `ast_explore` using the existing in-memory compiler session. No persistent database and no watcher are required for the first slice.

### Phase 2: incremental index

Add file fingerprints and an in-memory symbol index. Search may use the index for candidate ranking, but exact selector resolution and all mutations continue through the compiler project.

### Phase 3: relationships and impact

Add typed edges, bounded traversal and candidate tests. Start with compiler-backed relationships and add syntax/heuristic relationships only with separate provenance and corpus evidence.

### Phase 4: watcher and persistence

Add debounced invalidation and an optional persistent index backend. Watcher failure must degrade to synchronous freshness checks. Persistence is enabled only after package/tarball, restart, migration and rebuild gates pass.

### Phase 5: productization and evaluation

Add the agent target registry, agent-task benchmark, docs and ADRs. A daemon remains a future decision, not a release requirement.

## Rollback

- New read tools are additive and can be disabled at registration/configuration level.
- Primitive v0.5.0 tools remain available.
- The index can be discarded and rebuilt from the compiler/filesystem.
- Watcher failure falls back to synchronous synchronization.
- Persistent schema migration failure disables the cache, not the compiler project or mutation engine.
- Relationship computation may return incomplete results or fail closed without blocking exact reads or mutations.
- No migration may rewrite source files as part of enabling these features.
