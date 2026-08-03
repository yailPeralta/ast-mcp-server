# Design: Safe and Efficient Structural Engine

## Decision summary

1. Keep ts-morph as the structural engine.
2. Use synchronized cached sessions for reads.
3. Use fresh isolated projects for write preparation.
4. Bind preview to apply through immutable operation plans and SHA-256 file hashes.
5. Apply exact planned text through staged filesystem replacement under a per-project lock.
6. Emit schema-backed structured results once.
7. Preserve current tool names during v0.x.

## Module ownership

### `src/services/project.ts`

Owns synchronized read-project lifecycle, serialization, cache limits, tsconfig refresh, source refresh, and project-root metadata. It does not own symbol lookup or writes.

Implemented API:

```ts
interface ProjectContext {
  project: Project;
  projectRoot: string;
  tsConfigFilePath: string;
}

withProject<T>(projectRoot: string, operation: (context: ProjectContext) => Promise<T> | T): Promise<T>
invalidateProject(projectRoot: string): void
createFreshProject(projectRoot: string): ProjectContext
```

A keyed promise queue serializes access per tsconfig. Synchronization fingerprints the root and transitively extended configs, adds files from tsconfig, refreshes changed files, and forgets deleted files. Session eviction is LRU/idle bounded and only occurs after queued work completes.

### Source location in `src/services/project.ts`

Owns exact normalized source-file lookup and actionable ambiguity errors. It does not perform symbol traversal.

### `src/services/symbols.ts`

Owns declaration discovery, reusable symbol paths, executable-body resolution, and bounded candidate reporting. It supports nested namespace/class/interface/object paths and executable variable/property initializers.

### `src/services/outline.ts`

Owns pure formatting from ts-morph declarations to compact signatures and structured metadata. It performs no filesystem or MCP work.

### `src/services/diagnostics.ts`

Owns diagnostic normalization, pagination, multiset comparison, and presentation. It compares `{code, category, file, flattenedMessage}` counts so line shifts do not reclassify existing errors as new.

### `src/services/workspace.ts`

Owns byte-level SHA-256 snapshots for project sources and the root, extended, and referenced config graph. It also provides a config-only fingerprint for read-session invalidation.

### `src/services/operations.ts`

The current v0.x implementation keeps the bounded operation store, preparation, apply, lock, staging, and rollback in one service so those invariants remain co-located. It stores no global project objects.

Preparation:

Owns fresh-project mutation simulation:

1. Resolve fresh project from disk.
2. Capture baseline diagnostics.
3. Capture and validate the complete workspace snapshot.
4. Execute the real ts-morph mutation.
5. Detect changed source files by text comparison.
6. Capture exact resulting text.
7. Compute diagnostic delta.
8. Reject new errors unless explicitly allowed.
9. Bind kind, workspace fingerprint, policy, and exact postimages into `plan_hash`.
10. Persist the immutable plan in the bounded TTL store.

Apply owns precondition verification and filesystem effects:

1. Acquire per-project write lock.
2. Return prior result if plan already applied.
3. Require the exact reviewed `plan_hash` and verify the complete workspace fingerprint.
4. Verify every target file hash.
5. Create sibling temp files with destination mode.
6. Flush/stage all temp files.
7. Recheck target hashes and rename staged files over destinations.
8. Verify every written postimage.
9. On failure, restore destinations that still match this operation's postimages.
10. Record success or explicit partial/rollback result.
11. Invalidate the read session.

No mutation is recomputed during apply.

### `src/tools/*`

Own MCP schemas, annotations, descriptions, and mapping between tool input and domain services. They do not implement AST or filesystem logic.

## Tool contracts

### Existing reads

- `ast_list_files`: add `limit`, `cursor`, filters; return relative deterministic paths and pagination metadata.
- `ast_get_outline`: return `{file, outline}` by default; detailed `symbols` metadata is opt-in to avoid duplicating signatures.
- `ast_get_symbol_source`: relative location plus source.
- `ast_find_references`: precise, grouped/paginated result.

### Existing writes

- `ast_rename_symbol` and `ast_replace_symbol_body` prepare by default and return `operation_id`, exact changed files, diagnostics delta, and preview.
- `dry_run=false` returns a migration error. Application is available only through `ast_apply_operation` with the prepared `operation_id` and `plan_hash`.

### New reads

- `ast_search_symbols`
- `ast_get_diagnostics`

### New write

- `ast_apply_operation`

## Result encoding

Every schema-backed success declares `outputSchema`, returns `structuredContent`, and uses the valid empty MCP block array `content: []` so the semantic payload is not duplicated. Text content is reserved for errors. Paths are relative to the resolved project root.

Pagination uses integer offset internally for v0.x simplicity:

```ts
{ offset: number, limit: number, total: number, has_more: boolean, next_offset: number | null }
```

Default limit is 100; maximum is 500. Ordering is normalized path, then line, then column.

## Diagnostics policy

Preparation captures baseline and post-mutation diagnostics from the fresh project. The delta is a multiset, not a set, so introducing an additional identical diagnostic is still detected. Errors block by default. Warnings are reported but do not block.

Performance data is recorded separately for baseline diagnostics, mutation, post diagnostics, and total preparation. If full diagnostics prove too slow, optimization may scope semantic recomputation, but safety semantics cannot be weakened without a new spec decision.

## Filesystem consistency

Global atomicity across several files is unavailable on a normal filesystem. The design therefore provides:

- All preconditions verified before any destination replacement.
- All outputs staged before the first destination replacement.
- Per-file atomic rename on the same filesystem.
- Best-effort rollback using stored originals, only while a destination still matches this operation's postimage.
- Explicit failure text distinguishing successful rollback from incomplete rollback.

This is an in-process guarantee. The lock does not coordinate separate server processes or external writers, and local rename semantics must not be generalized to NFS or a globally atomic multi-file transaction. Prepared plans are in-memory and do not survive process restart.

The README MUST call this transactional staging with rollback, not globally atomic commit.

## Security

The stdio server is a local developer tool and currently accepts arbitrary project roots. A future HTTP transport requires an allowed-root/auth SDD. Paths returned by tsconfig are normalized; staging files are constrained to planned project files.

## Test strategy

- Pure unit tests for outline, diagnostics delta, pagination, hashing, and symbol locators.
- Temporary-project integration tests for freshness, membership, ambiguity, references, preparation, conflict, apply, idempotency, and rollback fault injection.
- Stdio client smoke test for discovery and representative tool calls.
- Benchmark script against a supplied project root.

Every behavioral slice uses RED -> GREEN -> REFACTOR -> VERIFY.

## Compatibility and versioning

Ship as a v0.x minor release with a migration note. Tool names remain stable. Result shapes become structured and bounded. Direct unsafe writes are removed deliberately; callers must prepare and apply by operation id.
