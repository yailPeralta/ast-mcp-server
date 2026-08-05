# Exploration: code intelligence context, indexing, freshness, and impact

## Date and decision context

Date: 2026-08-04

The project will continue with `ast-mcp-server` as the canonical MCP for Hermes. CodeGraph is a reference implementation and benchmark source for read-side code intelligence; it is not a dependency, replacement, or write authority for this change.

The initiative combines the improvements identified during the CodeGraph comparison:

- direct bounded file reads;
- one primary composed exploration workflow;
- explicit freshness and project/index status;
- incremental symbol indexing;
- typed relationships and bounded impact traversal;
- candidate test discovery;
- watcher-driven invalidation;
- optional persistent index storage;
- agent-target extensibility;
- agent-behavior evaluation rather than serializer-only measurement.

This is a multi-phase SDD. It does not authorize implementation of every phase in one unreviewed change.

## Repository state

The working tree was clean on the main branch at the start of exploration. Recent commits include progressive result shaping and safe class scaffolds. The current package is v0.5.0 and uses Yarn 4.15.0 with lifecycle scripts disabled.

The existing v0.5.0 verification recorded:

- `yarn test`: 16 files and 90 tests passed;
- `yarn build`: passed;
- MCP, CLI, package, audit, typecheck and lint gates passed in the archived change verification;
- result-shaping and batch benchmarks passed their declared evidence gates.

These are baseline facts for this SDD, not new verification of the future change.

## Current architecture evidence

### Compiler and project session

`src/services/project.ts` owns project resolution and the cached `ts-morph` project session.

- `resolveTsConfigPath()` accepts a project directory or explicit config path.
- Sessions are keyed by canonical tsconfig path and capped at eight entries.
- `withProject()` serializes operations per project through a promise queue.
- `synchronizeSession()` currently re-adds source files and calls `refreshFromFileSystem()` for every source file on each operation.
- A config digest rebuilds the project when extended configs or project references change.

The compiler project is the semantic authority for declarations, references, source ranges, diagnostics and mutations.

### Workspace identity and mutation safety

`src/services/workspace.ts` computes SHA-256 file hashes and complete workspace digests over source/config files. The mutation engine in `src/services/operations.ts` already owns reviewed plans, diagnostic deltas, workspace freshness, exact previews, locks, rollback and idempotent receipts.

Any new read index MUST remain advisory. It MUST NOT become the authority for mutation eligibility, rename locations, apply safety, or diagnostics.

### Symbol extraction and search

`src/services/symbols.ts` currently:

- extracts declaration-like symbols from TypeScript source files;
- constructs stable symbol paths and line selectors;
- resolves exact declarations from selectors;
- ranks matches using the progressive-search rules introduced in v0.5.0.

`ast_search_symbols` still obtains its candidate set by walking the current compiler project. There is no persistent symbol index or file-level invalidation map.

### Current MCP surface

`src/server.ts` registers eleven tools:

- `ast_list_files`;
- `ast_get_outline`;
- `ast_get_symbol_source`;
- `ast_search_symbols`;
- `ast_find_references`;
- `ast_get_diagnostics`;
- `ast_rename_symbol`;
- `ast_replace_symbol_body`;
- `ast_scaffold_class`;
- `ast_get_operation_preview`;
- `ast_apply_operation`.

The batch runner already provides bounded, deterministic, JSON-pointer-based read composition. It is useful infrastructure for experiments and CLI workflows, but it still requires the client or agent to know the pipeline in advance.

### Current protocol strengths

The project already has the properties that must not regress:

- compiler-resolved references;
- compact progressive result profiles;
- canonical JSON values with optional TOON presentation only where measured;
- prepare-only mutations;
- exact operation previews;
- hash-bound plans;
- workspace freshness checks;
- no-clobber class creation;
- rollback and idempotent receipt recovery;
- bounded batch execution;
- private runtime state and cooperative apply locks;
- package and agent setup smoke tests.

### Current scalability and observability gaps

The main read-side costs are:

1. project synchronization refreshes every source file for every operation;
2. symbol discovery scans all source files for every search;
3. there is no explicit status endpoint for pending changes, stale reads, index coverage or degraded synchronization;
4. relationships beyond compiler references are not exposed as a bounded graph contract;
5. the agent workflow benchmark mostly measures payload shape and known batch composition, not selection correctness and fallback behavior over a task corpus;
6. setup targets are represented as a closed `claude | hermes` union rather than a reusable target registry.

## CodeGraph observations to reuse

CodeGraph is strongest as a read-side code intelligence product. The useful patterns are:

- a primary exploration workflow instead of forcing every agent to compose low-level queries;
- a local symbol/file/relationship index with FTS-style retrieval;
- explicit graph edge provenance and traversal limits;
- incremental synchronization and stale/degraded status;
- context construction that separates summaries from expensive source evidence;
- affected-test discovery as a candidate list rather than an absolute guarantee;
- agent adoption and setup treated as a tested product surface;
- search quality evaluated with task evidence, not only character or token reduction.

The relevant ideas will be adapted to the compiler-first architecture rather than copied as a second semantic engine.

## Alternatives considered

### Replace `ast-mcp-server` with CodeGraph

Rejected. It would sacrifice the current hash-bound mutation boundary and compiler-first guarantees for a broader read graph. The user decision is to retain AST as the Hermes MCP.

### Run both MCPs by default in Hermes

Rejected. Overlapping tools create selection ambiguity, duplicate schemas and competing freshness/relationship semantics. CodeGraph may remain in a separate research profile for comparison or multi-language repositories.

### Add Tree-sitter and broad multi-language parsing now

Rejected for this initiative. It would add parser, grammar, packaging and semantic-divergence costs before the TypeScript/JavaScript retrieval problem is solved. A future backend abstraction may support it, but it is out of scope here.

### Use heuristic graph edges as mutation authority

Rejected. Heuristic callers, framework routes, callback edges and dynamic dispatch are useful exploration evidence but cannot decide rename, replacement, diagnostics, or apply behavior.

### Build a daemon before measuring the warm session path

Rejected. The existing session cache and per-project queue should be optimized first. A long-lived daemon is a later option only if startup, concurrency or watcher measurements justify its operational cost.

### Persist full source content in the read index

Rejected by default. The index should store file hashes and derived metadata; exact source must come from the canonical filesystem/compiler snapshot. Storing source is unnecessary for the first version and increases privacy, invalidation and disk-cost concerns.

## Scope boundaries

### In scope

- additive read tools and response metadata;
- incremental in-memory symbol indexing;
- optional persistent index behind a versioned storage interface;
- explicit freshness and project/index status;
- compiler-backed and clearly labelled derived relationships;
- bounded impact traversal and candidate test discovery;
- watcher invalidation with synchronous safe fallback;
- agent workflow evaluation corpus;
- extensible agent target registry;
- documentation, skills, ADRs, benchmarks and packaging gates.

### Out of scope

- replacing `ts-morph` or TypeScript compiler semantics;
- arbitrary text write or delete tools;
- heuristic-driven mutation plans;
- automatic test execution from MCP tools;
- background code modifications;
- remote indexing service or telemetry backend;
- multi-language parsing;
- daemon/proxy as a required deployment mode;
- embeddings or an external vector database;
- claims about billed tokens, prompt-cache savings or model quality without provider/task evidence.

## Vocabulary and trust boundaries

- **Compiler-authoritative:** derived from the active TypeScript project/language service or exact filesystem snapshot and suitable for semantic navigation.
- **Index-derived:** a cached projection of compiler/file facts used for ranking and retrieval; invalid when its fingerprint is stale.
- **Syntax-derived:** a relationship discovered by bounded AST syntax inspection but not fully resolved by the compiler.
- **Heuristic:** a framework, convention or dynamic-dispatch inference; useful context only.
- **Fresh:** the relevant source/config fingerprints match the active project/index snapshot.
- **Stale:** source or config changes are pending or the watcher/index cannot prove freshness.
- **Degraded:** the service can answer through synchronous fallback, but an optional watcher or index backend failed.

Every relationship returned by a graph-capable tool MUST expose enough provenance for an agent to avoid treating heuristic evidence as exact.
