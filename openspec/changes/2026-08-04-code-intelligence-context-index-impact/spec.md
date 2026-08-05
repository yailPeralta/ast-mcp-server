# Specification: compiler-first code intelligence for Hermes

## Contract principles

### AST-CI-001 Compiler authority

The active `ts-morph`/TypeScript project and exact filesystem snapshots remain the authority for declarations, exact selectors, semantic references, diagnostics, mutation plans and apply eligibility. Indexes, watchers and graph projections MUST NOT authorize or alter a mutation.

### AST-CI-002 Bounded output

Every new collection or traversal operation MUST enforce explicit record, byte, depth and invocation budgets. A budget-limited result MUST expose `truncated: true` and a machine-readable reason. It MUST NOT silently discard evidence or allocate unbounded output.

### AST-CI-003 Project boundary

All operations MUST resolve one canonical project/tsconfig identity per call. Relative paths MUST remain project-relative in public results. Ambiguous suffixes, traversal paths and files outside the configured project MUST fail closed.

## Exact file retrieval

### AST-FILE-001 Bounded source

`ast_get_file` MUST accept a project root/config, a project-relative or unambiguous file path, and bounded line `offset`/`limit` values. It MUST return exact current source text for the requested range, deterministic line numbers, project-relative path, total line count and a SHA-256 file hash.

### AST-FILE-002 Source modes

The default mode MUST return source lines. `symbols_only: true` MAY return only body-free declarations and exact selectors for the file. It MUST NOT claim that a symbol-only projection is the complete file source.

### AST-FILE-003 File safety

The tool MUST reject directories, non-source files outside the project source set, ambiguous suffixes, symlink escapes and ranges exceeding configured limits. A missing or changed file MUST report a structured error or stale state; it MUST NOT return cached source as current without a warning.

### AST-FILE-004 Compatibility

`ast_get_file` is read-only and MUST NOT alter the behavior or safety of existing generic file tools, mutation tools or batch plans.

## Freshness and project status

### AST-FRESH-001 State model

The service MUST represent at least `fresh`, `pending`, `stale`, `rebuilding` and `degraded` states. The state MUST identify whether the cause is source change, config change, index failure, watcher failure or compiler rebuild.

### AST-FRESH-002 Fingerprints

Freshness MUST be based on canonical source/config fingerprints, not only watcher events or file modification timestamps. A watcher event MAY mark a path pending, but a successful fingerprint check is required before reporting fresh.

### AST-FRESH-003 Read fallback

If the watcher or index is unavailable, read operations MUST fall back to bounded synchronous synchronization or report that the result is stale. A failed optional component MUST NOT make exact mutation checks less strict.

### AST-STATUS-001 Project status

`ast_get_project_status` MUST return bounded, structured status including project identity, config digest or redacted digest identifier, compiler/index state, source count, indexed count, pending files, watcher state, last successful sync/index timestamps, operation queue state and degraded errors without secrets or unnecessary host paths.

### AST-STATUS-002 Observability

Status and internal metrics MUST distinguish compiler sync, index hit/miss, watcher failure, stale reads, relationship truncation, fallback reads and serialization limits. A generic `error` count MUST NOT collapse expected stale/pending states with actual failures.

## Composed exploration

### AST-EXPLORE-001 Read-only composition

`ast_explore` MUST be read-only and MUST compose existing resolver, outline, source, reference and index services. It MUST return no operation ID, plan hash or apply coordinate.

### AST-EXPLORE-002 Query routing

The tool MUST support an exact selector/file route when supplied and a bounded ranked query route otherwise. Exact selectors returned by exploration MUST be directly reusable by `ast_get_symbol_source`, `ast_find_references` and mutation prepare tools without transformation.

### AST-EXPLORE-003 Progressive evidence

The response MUST support bounded detail levels equivalent to:

- `selectors`: routing coordinates;
- `summary`: coordinates plus signatures;
- `context`: selected source/relationship evidence;
- `full`: explicit opt-in expanded evidence.

The default MUST favor selectors and summaries. Source and relationship expansion MUST be opt-in or limited by explicit budgets.

### AST-EXPLORE-004 Completeness declaration

The response MUST include total/returned counts, freshness, evidence completeness, truncation and any unresolved selectors. A successful empty result MUST be distinguishable from an incomplete result.

### AST-EXPLORE-005 Context budget

The tool MUST enforce a maximum serialized output budget independently of model-facing JSON/TOON presentation. It MUST report the logical result before presentation so TOON cannot change ranking, completeness or safety semantics.

## Incremental indexing

### AST-INDEX-001 File-level invalidation

The index MUST track a canonical fingerprint and derived metadata per source/config file. An unchanged file MUST be reusable on a warm read path. File additions, deletions, config changes and project-reference changes MUST invalidate affected index state.

### AST-INDEX-002 Compiler synchronization

Index refresh MUST occur only after the compiler session has observed the relevant filesystem/config state. Index entries MUST be rebuilt from the active compiler/AST services or exact source snapshot, not from stale index records.

### AST-INDEX-003 Search authority

The index MAY rank and narrow candidates. Final selector resolution MUST use the active compiler project and MUST fail if an indexed selector no longer resolves uniquely.

### AST-INDEX-004 Index metadata

An index entry MUST include enough metadata to identify project/config identity, source fingerprint, index schema version, symbol path/selector, declaration kind, line/range and searchable name/path fields. Source bodies MUST NOT be persisted by default.

### AST-INDEX-005 Rebuild behavior

Index corruption, schema mismatch or unsupported persisted state MUST trigger a bounded rebuild or disabled-cache state. It MUST NOT block direct compiler reads or mutation plan verification.

### AST-INDEX-006 Persistence gate

Persistent storage MUST be behind a versioned interface and an explicit enablement policy. A backend is shippable only if it passes isolated package installation, lifecycle-script-disabled installation, restart, migration, corruption/rebuild and concurrent-read tests on supported Node versions.

## Relationships and impact

### AST-REL-001 Edge contract

Every relationship MUST expose:

- `from` and `to` exact or best-known selectors;
- relationship kind;
- source file and location when available;
- `provenance`: `compiler`, `syntax` or `heuristic`;
- `confidence`: `exact`, `high`, `medium` or `low`;
- resolution status;
- freshness of the underlying evidence.

### AST-REL-002 Initial exact relationships

The first relationship implementation MUST prioritize compiler-backed references/usages, imports/exports where module resolution is available, inheritance and implemented types. It MUST preserve declaration/reference semantics already provided by `ast_find_references`.

### AST-REL-003 Derived relationships

Call, callback, event, framework-route and dynamic-dispatch edges MAY be added only as syntax or heuristic evidence unless the compiler resolves them. Such edges MUST never be presented as exact and MUST never be used by mutation planning.

### AST-IMPACT-001 Bounded traversal

`ast_get_impact` MUST accept direction, maximum depth, maximum nodes, maximum edges and optional relationship-kind filters. It MUST return deterministic ordering, visited counts, truncation reasons and incomplete state.

### AST-IMPACT-002 Exact selector input

The root symbol MUST be resolved by the compiler before traversal. Ambiguous or missing roots MUST fail rather than starting traversal from a guessed name.

### AST-IMPACT-003 Impact semantics

The result MUST distinguish direct compiler-resolved references from transitive/derived candidates. It MUST not claim that the transitive set is a complete proof of runtime impact.

### AST-TESTS-001 Candidate tests

When requested, impact analysis MAY return candidate test files based on exact references, dependency distance and configured test naming patterns. Each candidate MUST include a reason, confidence and evidence path. Candidate tests are recommendations, not automatically executed tests or proof of coverage.

## Watcher behavior

### AST-WATCH-001 Invalidation only

The watcher MUST mark files/configs pending and schedule bounded synchronization/index refresh. It MUST NOT write source code, apply plans or execute tests.

### AST-WATCH-002 Debounce and overflow

Watcher events MUST be debounced and bounded. Event overflow, watcher errors and unsupported filesystem behavior MUST transition the status to `degraded` and activate synchronous fallback rather than silently losing changes.

### AST-WATCH-003 Apply isolation

Existing apply locks and workspace fingerprints remain authoritative. A watcher MUST NOT hold or bypass the apply lock in a way that changes mutation ordering.

## Agent evaluation

### AST-EVAL-001 Corpus

A checked corpus MUST cover exact symbol lookup, prefix/substrings, file understanding, search-to-source exploration, multi-file references, impact traversal, stale changes, incomplete graph data and candidate tests. Each case MUST declare required evidence and an acceptable call bound.

### AST-EVAL-002 Correctness gate

A candidate workflow fails if it loses required selectors/source/reference coordinates, confuses stale data with fresh data, treats heuristic edges as exact or exceeds its declared call bound without an explicit pagination reason.

### AST-EVAL-003 Measurements

The benchmark MUST report separately:

- logical model round-trips;
- actual MCP invocations;
- serialized characters, bytes and named-tokenizer estimates;
- compiler/index/watcher timings;
- cache hit/miss and fallback counts;
- graph nodes/edges and truncation;
- static `tools/list` metadata.

It MUST NOT convert local serializer estimates into provider billing, cache or quality claims.

### AST-EVAL-004 Baselines

The corpus MUST compare at least:

1. generic full-file read workflow;
2. existing AST primitive/batch workflow;
3. new `ast_explore`/index workflow.

The comparison MUST use the same repository, task, model-facing evidence requirements and no hidden provider change.

## Agent setup

### AST-AGENT-001 Target registry

Agent setup MUST replace closed target-specific branching with a registry/interface that preserves current Claude and Hermes behavior. Each target MUST define detection, MCP registration, skill installation scope, conflict inspection, verification and removal semantics.

### AST-AGENT-002 Safe extension

A new agent target MUST NOT be enabled by default until its CLI/config contract, conflict behavior, idempotency and isolated smoke test are implemented. Existing targets MUST remain unchanged during target addition.

## Mutation compatibility

### AST-MUTATION-001 No read-index authority

Rename, body replacement, scaffold, preview and apply MUST continue to use fresh compiler/project/workspace state and existing plan hashes. A stale or corrupt index MUST not weaken a blocked plan or create a new write path.

### AST-MUTATION-002 Regression gate

Every phase MUST run existing operation, persisted-plan, lock, rollback, MCP, CLI, package and diagnostic tests before acceptance.

## Documentation

### AST-DOC-001 Trust labels

README, bundled skill and tool descriptions MUST explain the difference between compiler-authoritative, index-derived, syntax-derived and heuristic evidence.

### AST-DOC-002 Operational guidance

Documentation MUST explain freshness states, status inspection, fallback behavior, budgets, impact incompleteness, candidate-test semantics and the fact that the MCP does not execute tests automatically.
