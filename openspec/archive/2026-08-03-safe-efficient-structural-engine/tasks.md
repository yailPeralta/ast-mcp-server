# Tasks: Safe and Efficient Structural Engine

All code-producing tasks follow RED -> GREEN -> REFACTOR -> VERIFY. No commits are performed unless explicitly requested.

## 1. Establish quality harness

- [x] Add Vitest and test scripts to `package.json`.
- [x] Add ESLint flat config, Prettier config, and non-mutating check scripts.
- [x] Add `.gitignore` and temporary-project test helpers.
- [x] Add baseline MCP smoke test scaffold.
- [x] Verify: `npm run build`, `npm run lint`, `npm run format:check`, `npm test`.

## 2. Project session freshness and path identity

- [x] RED: external edit is stale after first read.
- [x] RED: newly included/deleted files are not reflected.
- [x] RED: duplicate suffix paths resolve silently.
- [x] Implement `ProjectSessionRegistry` with keyed serialization and bounded cache.
- [x] Implement synchronization and exact source locator.
- [x] GREEN: freshness/membership/ambiguity tests pass.
- [x] Verify focused tests plus build.

## 3. Correct outline engine

- [x] Add fixture snapshots for modifiers, generics, overloads, constructors, accessors, properties, arrow functions, interfaces, types, enums, namespaces, JSX-style variables, and default exports.
- [x] RED: current duplicate `async`/`;` and lost generic cases fail.
- [x] Replace brittle string splitting/`any` formatter paths with typed formatters.
- [x] Return structured symbol metadata.
- [x] GREEN: exact snapshots pass.
- [x] Verify focused tests plus build.

## 4. Compact read contracts

- [x] Add shared pagination schema/result helpers.
- [x] Add output schemas and structured-only results.
- [x] Make list paths relative, deterministic, filtered, and paginated.
- [x] Make symbol source locations relative.
- [x] Add tests proving no semantic payload duplication.
- [x] Verify MCP protocol-level response shapes.

## 5. References

- [x] RED: declaration file is missing for zero-reference rename impact.
- [x] Add line/column/kind and bounded context.
- [x] Group line extraction by source file.
- [x] Add deterministic pagination and declaration-aware counts.
- [x] GREEN: cross-file import/call/inheritance fixture passes.

## 6. Diagnostics service and tool

- [x] Add diagnostic normalization and multiset-delta unit tests.
- [x] Add pagination and project/file filtering.
- [x] Register `ast_get_diagnostics` with output schema.
- [x] Verify projects with pre-existing diagnostics remain queryable.

## 7. Immutable operation plans

- [x] Add SHA-256 hashing and immutable plan types.
- [x] Add bounded TTL/LRU operation store with injectable clock.
- [x] Test expiry, capacity, immutability, and idempotent applied lookup.

## 8. Safe replace-body preparation

- [x] RED: invalid body preview is accepted.
- [x] RED: top-level and class-property arrow functions are unsupported.
- [x] Execute actual mutation in a fresh project without saving.
- [x] Capture exact before/after contents and diagnostic delta.
- [x] Reject new error diagnostics by default.
- [x] Return operation id and exact preview.

## 9. Safe rename preparation

- [x] RED: declaration file omitted when there are zero references.
- [x] Prepare rename in a fresh project and capture every changed file.
- [x] Validate new identifier and diagnostics.
- [x] Return exact per-file planned outputs and operation id.

## 10. Transactional apply

- [x] RED: hash conflict must write nothing.
- [x] RED: repeated apply must not write twice.
- [x] RED: injected mid-commit failure must attempt rollback and report status.
- [x] Implement staged sibling files, hash verification, per-project lock, replacement, rollback, and cache invalidation.
- [x] Register `ast_apply_operation`.
- [x] Remove unsafe direct recomputation on `dry_run=false`.

## 11. Symbol search

- [x] Add declaration index/search with kind and file filters.
- [x] Support reusable symbol paths for every advertised executable declaration.
- [x] Add bounded deterministic results.
- [x] Register `ast_search_symbols`.

## 12. End-to-end MCP tests

- [x] Spawn built stdio server through the MCP SDK client.
- [x] Assert tool discovery, annotations, input/output schemas, structured-only output, prepare/apply, and conflict errors.
- [x] Confirm stdout remains protocol-clean and operational logs use stderr.

## 13. Benchmark and product documentation

- [x] Add benchmark CLI accepting a project root and optional sample/filter.
- [x] Report load/sync/tool latency, source/outline/result chars, ratios, and caveats.
- [x] Add a reproducible task-corpus methodology for model-token comparisons.
- [x] Update README with exact `hermes mcp add ...` and `hermes mcp test ast` commands.
- [x] Update bundled structural-editing skill for operation ids, pagination, diagnostics, and verification.
- [x] Add package files/engines/prepack hygiene.

## 14. CI and final quality gate

- [x] Add GitHub Actions workflow for install, format check, lint, test, build, and MCP smoke.
- [x] Run final full gates from a clean dependency state where practical.
- [x] Run `npm audit` and package dry-run.
- [x] Run benchmark on this repo and x-scraper.
- [x] Re-run `hermes mcp test ast` after rebuilding/reloading MCP.
- [x] Map every `AST-*` requirement to implementation and assertions in `verification.md`.
- [x] Record remaining risks and archive the completed SDD.
