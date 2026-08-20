## Exploration: Expose affected test candidates through MCP and CLI

### Current State

`src/services/test-candidates.ts` already provides `findTestCandidates(impact, conventions)`. It accepts only complete impact evidence whose edges are fresh, exact, resolved, and compiler-authoritative; it returns deterministic direct or transitive candidates with the full relationship path and rejects stale or truncated evidence. Compiler-backed reference analysis confirms that production code does not call it today: its only current callers are `test/test-candidates.test.ts` and the agent-workflow benchmark.

`ast_get_impact` already owns the trusted project flow: `withProject()` synchronizes the compiler session, `resolveImpactRoot()` resolves an exact selector, and `traverseCompilerImpact()` applies explicit depth/node/edge budgets. MCP tools are composed in `createServer()`. The existing CLI is not a second analysis implementation: `ast-tool run` invokes MCP tools admitted by `READ_BATCH_TOOLS`, so adding the new read tool to that allowlist is the coherent CLI surface. The SQLite-default prerequisite named by the roadmap has already been archived and verified.

### Affected Areas

- `src/tools/find_test_candidates.ts` — new read-only adapter that builds trusted incoming impact and invokes the existing resolver; it should not accept caller-supplied impact evidence.
- `src/services/test-candidates.ts` — existing candidate rules and evidence model remain authoritative; only reusable public bounds/schema constants may need exporting.
- `src/tools/get_impact.ts` and a small shared tool-schema module — reuse one Zod contract for relationship endpoints, freshness, and edges so the two public evidence surfaces cannot drift.
- `src/server.ts` — register `ast_find_test_candidates` with read-only, non-destructive, idempotent, closed-world annotations.
- `src/batch/schema.ts` — admit `ast_find_test_candidates` as a read batch tool, which exposes it through `ast-tool run` without a standalone CLI command.
- `src/services/agent-targets.ts` — include the new capability in installed-agent compatibility checks.
- `test/test-candidates.test.ts` and `test/mcp.integration.test.ts` — preserve resolver invariants and prove direct, transitive, convention-driven, empty-complete, and fail-closed public behavior.
- `test/batch.test.ts` and `scripts/cli-smoke.mjs` — prove the CLI batch route, project-root injection, pagination, and final JSON/TOON serialization.
- `scripts/mcp-smoke.mjs` and `scripts/registry-consumer-smoke.mjs` — update exact public tool inventory assertions from 15 to 16 tools.
- `README.md`, `CHANGELOG.md`, `skills/structural-code-editing/SKILL.md`, and `skills/structural-code-editing/releases.json` — document the public contract and update the managed-skill digest/version rather than leaving guidance that calls the resolver internal.
- `docs/adr/0007-compiler-first-impact-relationships.md` (or a focused successor ADR) — record the lasting public-contract decision: incoming compiler traversal is the only authority for affected-test candidates.

### Approaches

1. **Dedicated compiler-backed tool plus existing batch CLI** — add `ast_find_test_candidates` with exact root coordinates, traversal budgets, optional test conventions, and candidate pagination. Internally force incoming traversal, reject incomplete evidence, then call `findTestCandidates()`.
   - Pros: Preserves the compiler trust boundary, exposes the user outcome directly, reuses existing runtime/session controls, and gives MCP and CLI one implementation.
   - Cons: Requires a new public schema, registration, inventory updates, and focused integration/documentation work.
   - Effort: Medium

2. **Add test candidates to `ast_get_impact`** — add an opt-in field that appends candidates to the generic impact response.
   - Pros: Reuses the same traversal in one response and adds fewer tool registrations.
   - Cons: Couples generic graph inspection to test conventions, complicates the output contract, hides the high-value operation behind an option, and still requires CLI allowlisting because `ast_get_impact` is not currently a batch tool.
   - Effort: Medium

3. **Accept a caller-supplied `ImpactResult`** — expose `findTestCandidates()` almost literally and let MCP/CLI clients provide the graph.
   - Pros: Minimal adapter logic.
   - Cons: Lets callers forge freshness and authority labels, creates a large duplicated input, breaks the compiler-first boundary, and makes stale or partial graph provenance impossible to trust.
   - Effort: Low implementation effort, unacceptable correctness risk

### Recommendation

Choose approach 1 and publish `ast_find_test_candidates`. The input should contain `project_root`, `file_path`, `symbol_path`, `max_depth`, `max_nodes`, `max_edges`, optional `test_file_patterns`/`test_directories`, and `offset`/`limit`. Direction should be fixed to `incoming`; accepting `both` would let an exact but outgoing path be mislabeled as an affected test. Relationship-kind filtering should remain internal in the first slice so a caller cannot accidentally narrow the graph and treat the resulting absence as authoritative.

The adapter should use `withProject()` and the request context, require a fresh compiler session, resolve the exact root, run bounded incoming compiler traversal, and call `findTestCandidates()` only when the traversal is complete. A complete fresh traversal with no matches may return an empty page. Stale, incomplete, or non-authoritative evidence must return an explicit bounded public failure and must never be converted to `candidates: []`.

The response should include `backend: "typescript_compiler"`, `compiler_authoritative: true`, the resolved root, paginated candidates, traversal counts and effective budgets, freshness, completeness, and truncation metadata. Each candidate should retain the existing reason, confidence, relationship IDs, and full exact path. Pagination bounds the public payload without truncating a candidate's proof. JSON should be the initial MCP representation; the existing CLI final-output encoder already provides lossless TOON without introducing a second tool representation before it is benchmarked.

Strict TDD should start with public contract tests, then registration and CLI admission. The first slice should also update exact inventory checks and managed skill guidance; otherwise installed clients can incorrectly report the server as current while lacking the new capability.

### Risks

- A `both` or outgoing traversal can produce technically connected test files that are not affected dependents; the wrapper must force incoming traversal.
- Returning an empty list for a depth/node/edge-limited graph would create false confidence; incomplete traversal must be a public failure.
- Generic resolver errors currently fall back to `INTERNAL_ERROR`; the adapter must deliberately map expected stale/incomplete states to safe, actionable public errors without exposing paths.
- Candidate evidence repeats relationship paths, so pagination is required even though traversal already has node and edge budgets.
- Only tests included by the active TypeScript/JavaScript project can be authoritative candidates. Files outside the compiler project are unsupported, not silently absent.
- Exact tool inventories, agent compatibility checks, CLI allowlists, smoke tests, README guidance, and the managed skill digest are coupled to a new public tool and can drift if updated partially.
- The behavior is small, but contract tests, smoke fixtures, documentation, and managed-skill release metadata may put the implementation near the 400-line review budget; `sdd-tasks` should forecast this explicitly.

### Ready for Proposal

Yes. The smallest coherent slice is a dedicated read-only `ast_find_test_candidates` tool, exposed to CLI through the existing batch runner, with compiler-owned incoming impact, fail-closed evidence handling, bounded pagination, public trust metadata, and synchronized inventories/guidance. No product clarification is required before proposal; exact public error code/message selection and shared schema placement can be finalized in design.
