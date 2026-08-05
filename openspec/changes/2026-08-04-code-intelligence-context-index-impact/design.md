# Design: compiler-first code intelligence for Hermes

## Decision summary

Keep the existing compiler/mutation core and add a read-side intelligence layer around it:

```text
MCP tools
  ├── existing exact read tools
  ├── ast_get_file
  ├── ast_explore
  ├── ast_get_project_status
  └── ast_get_impact

Read services
  ├── ProjectSession / CompilerAdapter
  ├── FreshnessManager
  ├── FileSnapshotProvider
  ├── SymbolIndex (memory first, optional persistence)
  ├── RelationshipIndex
  ├── ContextBuilder
  └── TestCandidateResolver

Mutation services
  └── existing Operations / Workspace / RuntimeState path
```

The new services may accelerate or enrich reads, but they never become a second semantic authority.

## Architectural boundaries

### CompilerAdapter

The existing `ProjectContext` remains the boundary around `ts-morph`. A thin adapter may be introduced to centralize:

- source-file resolution;
- compiler refresh;
- exact selector resolution;
- outlines and declaration source;
- compiler-backed references;
- diagnostics.

The adapter MUST expose domain result types rather than leaking `ts-morph` objects through the MCP/index layers.

### FreshnessManager

`FreshnessManager` owns the state machine for a project session:

```text
fresh
  ├── file/config event → pending
  ├── successful fingerprint + compiler/index refresh → fresh
  └── watcher/index failure → degraded
pending → rebuilding → fresh | stale | degraded
```

It uses canonical config/source fingerprints from the workspace layer. Watcher events are hints only. A fresh state requires a successful fingerprint check and completed relevant synchronization. Source synchronization uses a refresh → snapshot → refresh → verification pass; a changed verification fingerprint fails closed as stale instead of claiming that the compiler matches the filesystem.

The current per-project `withProject()` queue remains the serialization boundary. Watcher refresh work is queued through the same session rather than mutating a `Project` concurrently.

### FileSnapshotProvider

This provider returns bounded exact source from the filesystem and file metadata. It should reuse existing path canonicalization and hash helpers. It must not read from persisted source bodies because the filesystem/compiler snapshot is the authority.

A read result contains:

```text
file
range: { offset, limit, total_lines }
lines
file_hash
snapshot_state
```

The provider is not a generic arbitrary filesystem API; it is scoped to files in the resolved TypeScript project and applies the same path safety rules as existing tools.

## `ast_get_file` design

The tool layer validates a strict input schema and delegates to `FileSnapshotProvider`.

Default limits should be conservative and configurable only through server constants, not arbitrary unbounded caller values. Explicit ranges may be paginated. The tool returns project-relative paths, one-based line numbers and exact line text.

`symbols_only` delegates to the current outline/symbol services and returns selectors plus signatures. It does not pretend that symbol-only output is a source snapshot.

The response uses the existing structured result/error conventions. It remains JSON-only unless a benchmark proves a compact representation useful for this source-heavy shape.

## `ast_explore` design

`ContextBuilder` orchestrates the existing services in one process:

1. resolve project and freshness state;
2. if an exact file/selector route exists, validate it first;
3. otherwise query the symbol index or compiler candidate set;
4. rank candidates with the existing deterministic search comparator;
5. return selectors and summaries within the requested page/budget;
6. optionally resolve exact source for selected selectors;
7. optionally attach shallow relationships from the relationship service;
8. attach completeness, freshness, budgets and unresolved-item metadata.

The builder must not perform arbitrary natural-language interpretation in the server. `query` remains a bounded search string; structured filters are preferred for kind, file and selector constraints.

The public response is a progressive union with closed detail modes, following the v0.5.0 result-shaping precedent. The canonical internal value is validated before JSON or any future model-facing presentation. Presentation cannot change ranking, pagination or completeness.

The batch runner remains available for custom pipelines. `ast_explore` is for common workflows where server-side orchestration reduces model round-trips.

## Index design

### Phase 1: in-memory file/symbol index

Add an index owned by the project session, keyed by canonical file path and config/project identity. Each entry contains:

```text
file_path
content_hash
config_digest
symbol records
index_schema_version
last_indexed_at
```

Symbol records contain the existing domain fields required for ranking and routing:

```text
name
symbol_path
selector
kind
signature
line
range
```

The index is rebuilt for changed/added files and removes deleted files. Search candidates may come from the index, but exact resolution is rechecked through the compiler before the result is returned.

The first implementation should detect changes using metadata as a cheap filter and verify content hashes where correctness requires it. It must handle timestamp granularity, editor atomic saves, renames and deletions without assuming one filesystem event shape.

### Phase 2: persistent backend decision

Introduce a `SymbolIndexStore` interface before choosing a storage dependency:

```text
load(project_identity, schema_version)
upsert(file_entry)
remove(file_path)
query_symbols(query, filters, limit)
clear(project_identity)
flush()
```

Compare the following options in an ADR/task gate:

| Option                                 | Benefit                                 | Cost/risk                                                           |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| Memory only                            | No packaging/dependency risk; simplest  | Rebuild after restart; no cross-process sharing                     |
| Native SQLite (`better-sqlite3`-class) | FTS5, mature queries, good warm startup | Native binaries, Yarn lifecycle-disabled packaging, platform matrix |
| WASM/portable SQLite                   | More portable package behavior          | Memory/startup cost, FTS feature availability and larger runtime    |
| JSON/index files                       | No native dependency                    | Poor concurrent updates/querying and weaker transactional behavior  |

The target contract is persistent local storage with versioned schema and rebuild-on-corruption, but it is not enabled until the selected backend passes the package and runtime gates. The index stores metadata/hashes by default, not source bodies.

## Relationship design

`RelationshipIndex` produces a normalized edge domain type:

```text
from: SelectorRef
to: SelectorRef
kind: import | export | reference | extends | implements | type | call | callback | route | test_candidate
provenance: compiler | syntax | heuristic
confidence: exact | high | medium | low
location?: SourceLocation
freshness: SnapshotState
```

Initial exact relationships should be implemented using the compiler/project model and existing reference service. Import/export and heritage relations may be extracted from AST syntax and module resolution; if resolution is incomplete, the edge is marked syntax-derived rather than exact.

Call/callback/event/framework relations are a later layer. They require an evaluation corpus with negative controls because false edges are worse than missing optional context for an agent deciding what to inspect.

## Impact traversal design

`ast_get_impact` resolves one exact root selector, loads indexed/compiler-backed edges, then performs a deterministic bounded BFS/priority traversal. The result includes:

- root;
- nodes and edges;
- direct vs transitive classification;
- provenance/confidence;
- depth and counts;
- truncation/incomplete flags;
- candidate tests when requested.

Traversal ordering must be stable by depth, provenance rank, project-relative file, line and selector. It must not claim runtime completeness. A missing edge is reported as an incomplete graph condition when the service knows the relevant relationship kind is unsupported.

## Candidate test design

`TestCandidateResolver` starts with explicit project conventions:

- test filename suffixes and directories;
- direct references from the impact set;
- imports/dependency distance;
- matching source/test basename.

It returns candidates with:

```text
file
reason
confidence
evidence: [{ relation, source, target }]
```

It does not invoke Jest/Vitest or inspect coverage. Future framework-specific adapters must be additive and separately evaluated.

## Watcher design

A watcher is optional and read-only. It watches resolved source/config roots, debounces events and records pending paths. It does not call arbitrary user code or run tests.

On event overflow/error:

1. mark the session `degraded`;
2. stop trusting event completeness;
3. perform synchronous fingerprint checks before exact reads;
4. rebuild the affected index/compiler state through the project queue;
5. expose the failure via `ast_get_project_status`.

Watchers must close on session eviction and process shutdown. The first implementation should avoid creating a watcher for every transient project call; it should be session-owned and reference-counted or lazily activated.

## Persistence and locking

The existing runtime state directory and workspace apply lock remain dedicated to operation plans/receipts. Read-index files must use a separate project-keyed namespace and must never be mistaken for mutation state.

Index writes require:

- private path creation;
- atomic replacement or transactional backend commit;
- schema version;
- project/config identity;
- rebuild on malformed state;
- no source credential or environment leakage.

Index locking may coordinate index writers, but it must not replace or weaken the existing apply lock. Read-index failure must leave apply behavior unchanged.

## Agent target registry design

Replace the setup wizard's closed branching with a target contract while preserving current Claude/Hermes implementations:

```text
AgentTarget {
  id
  label
  detect()
  inspectMcp()
  configureMcp()
  installSkill()
  verify()
}
```

Target implementations remain explicit and conflict-safe. Adding a target requires an isolated CLI smoke and does not change existing config unless selected by the user. The registry phase is independent from the index/graph phases and may ship later.

## Observability

Record structured, bounded metrics/log fields:

- project identity hash, not unnecessary absolute paths;
- tool name and request correlation ID;
- freshness transition;
- changed/added/deleted file counts;
- compiler sync duration;
- index hit/miss/rebuild duration;
- watcher events/errors;
- relationship node/edge counts and truncation;
- result bytes/records;
- fallback reason.

Never log source secrets, environment variables, credentials or full source bodies by default.

## Failure and recovery matrix

| Failure                        | Read behavior                                 | Mutation behavior                                        |
| ------------------------------ | --------------------------------------------- | -------------------------------------------------------- |
| File changes during read       | Mark stale/retry bounded or return warning    | Existing fresh workspace/plan gates remain authoritative |
| Watcher unavailable            | Synchronous fallback; status degraded         | No change                                                |
| Index corrupt                  | Rebuild or disable cache                      | No change; compiler path continues                       |
| Compiler refresh fails         | Structured error; do not serve as fresh       | Prepare/apply fails closed                               |
| Heuristic edge unresolved      | Omit or return low-confidence incomplete edge | Never affects plan/apply                                 |
| Output budget exceeded         | Truncated result with continuation metadata   | No mutation result is truncated into an apply contract   |
| Persistent backend unavailable | Memory index or compiler fallback             | No change                                                |
| Project config changes         | Rebuild session/index; status rebuilding      | Plan freshness prevents stale apply                      |

## Testing strategy

### Unit

- file range/path validation;
- freshness state transitions;
- fingerprint invalidation;
- index upsert/remove/query;
- relationship provenance and confidence;
- deterministic impact traversal;
- candidate-test reasons;
- target registry behavior.

### Integration

- exact file retrieval from fixtures;
- explore selector-to-source chaining;
- stale file and config changes;
- index rebuild after add/delete/rename;
- compiler-vs-index selector mismatch;
- impact depth/edge budgets;
- heuristic edges never exposed as exact;
- watcher overflow/degraded fallback;
- persistent restart/migration/corruption if backend enabled.

### Regression

Run all existing MCP, operations, persisted-plan, batch, CLI, package, diagnostics, lock and scaffold tests in every phase.

### Benchmarks

Add a checked agent corpus and report:

- evidence correctness;
- required calls and invocations;
- output characters/bytes/tokenizer estimates;
- fresh/cold/warm timings;
- index hit/miss and compiler fallback;
- relationship coverage/truncation;
- static tool metadata.

No benchmark may claim provider billing, cache savings or universal model quality from local measurements.
