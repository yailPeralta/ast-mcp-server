# Symbol-Index Persistence Specification

## Purpose

Define the supported default SQLite read projection, its private cache boundary,
compiler fallback, and operator controls. The compiler remains the semantic and
mutation authority.

## Requirements

### Requirement: Compiler authority and policy selection

The verified TypeScript compiler state MUST remain authoritative for symbols,
references, relationships, diagnostics, freshness, ranking, and mutation
eligibility. SQLite MUST be body-free and MUST NOT authorize mutations.

Absent `AST_SYMBOL_INDEX_PERSISTENCE` and the exact value `enabled` MUST select
SQLite and report `policy=enabled`. `disabled` MUST select memory only and MUST
not resolve, create, or open a cache root. `canary` MUST remain available only
with an explicit absolute normalized root. Unknown values MUST fail closed to
memory with bounded invalid-mode evidence.

#### Scenario: Default restart reuse

- GIVEN a supported runtime with isolated safe home/cache directories and no policy
- WHEN a project synchronizes, exits, and synchronizes again
- THEN the first run persists one private index and the second reports a hit with compiler-equivalent results.

#### Scenario: Explicit memory rollback

- GIVEN a populated SQLite cache and `AST_SYMBOL_INDEX_PERSISTENCE=disabled`
- WHEN the session is invalidated and reopened
- THEN it uses memory only, leaves existing SQLite files untouched, and creates no cache root.

### Requirement: Safe default root and private storage

For `enabled`, the root MUST resolve in order: validated absolute
`AST_SYMBOL_INDEX_CACHE_ROOT`, validated absolute `XDG_CACHE_HOME` plus
`ast-mcp-server/symbol-index`, then the invoking home plus
`.cache/ast-mcp-server/symbol-index`. An invalid explicit override MUST NOT be
silently replaced. Unsafe ancestry, symlink, traversal, non-directory, or
physical-escape conditions MUST fail closed before outside side effects.

On supported Linux, package-owned directories and SQLite main, WAL, SHM, and
quarantine files MUST be inaccessible to group/other users regardless of umask;
external parent modes MUST NOT be changed. Paths and home locations MUST NOT
appear in public results, errors, or evidence.

#### Scenario: Unsafe root rejection

- GIVEN a symlinked, writable-untrusted, or non-directory cache ancestor
- WHEN default persistence is requested
- THEN no package-owned artifact is created and memory/compiler fallback remains available.

### Requirement: Same-operation fallback and mutation isolation

The process MUST synchronize compiler state before adopting persisted rows. Any
capability, path, permission, open, migration, integrity, read, write, flush,
or close failure MUST install a complete memory/compiler context before cleanup.
The same operation MUST return canonical compiler evidence, never stale indexed
success. Status MUST retain the requested policy while reporting effective
memory, failed index observability, and bounded failure evidence; synchronized
compiler freshness MUST remain independently fresh. Consumers MUST inspect the
index state or `index_observability`, not infer persistence health from the
top-level project freshness state.

A process-stable `capability_unavailable` fallback MUST reuse its compiler-backed
memory index until restart or a persistence-policy change. Invalid-root memory
policy fallback MUST likewise avoid retrying within an unchanged session. Other
storage, corruption, migration, read/write, flush, close, and contention failures
MUST remain eligible for automatic retry and recovery on a later operation.

Mutation-only prepare/apply MUST use scheduler/compiler admission and MUST NOT
create cache artifacts or alter plan hashes, diagnostics, conflicts, rollback,
receipts, or replay.

#### Scenario: Persistence failure

- GIVEN an enabled read with an injected storage or integrity failure
- WHEN the tool executes
- THEN it returns compiler-equivalent evidence through memory, keeps compiler freshness independent, and exposes the persistence failure through index observability.

### Requirement: Explicit cache inspection and cleanup

The local CLI MUST offer bounded inspection and explicit root/project-scoped
cleanup. Inspection MUST use no-follow accounting and report regular-file count,
bytes, database count, WAL/SHM count, and quarantine count. Cleanup MUST refuse
symlinks, hard links, non-regular, unreadable, changed, active, or out-of-root
targets, and MUST leave compiler operation available without deleting source or
mutation data. Automatic pruning is not required.

#### Scenario: Safe cleanup

- GIVEN inactive authenticated derived files inside the selected package root
- WHEN cleanup runs
- THEN only those derived files are removed and a subsequent read rebuilds from compiler state.

### Requirement: Supported runtime and promotion evidence

The package and CI MUST require Node `>=22.13.0`; exact Node 22.13.0 and the
current Node 24 line MUST pass the complete promotion matrix without an
experimental SQLite flag. Evidence MUST bind the immutable candidate tree,
workload, runtime identity, and external project identity; historical reports
MUST remain byte-identical and separately labeled.

#### Scenario: Runtime gate

- GIVEN an exact-floor or current supported runtime
- WHEN the promotion matrix runs
- THEN default, disabled, canary, fallback, permission, cleanup, and mutation gates pass without path or secret disclosure.
