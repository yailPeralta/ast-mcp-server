# Design: Batch CLI orchestration

## Decision

Add a CLI adapter around the existing MCP server using `Client` plus a linked `InMemoryTransport`. Keep orchestration in `src/batch/`; keep AST and filesystem semantics in existing services.

## Public commands

```text
ast-tool run <pipeline.json|->
ast-tool apply <plan.astplan> --plan-hash <sha256>
ast-tool validate <pipeline.json|->
```

`run` and `apply` emit one JSON object. `validate` performs schema, static reference-order and policy validation without constructing a TypeScript project.

## Pipeline shape

```json
{
  "version": 1,
  "project_root": "/absolute/project",
  "limits": { "concurrency": 4 },
  "steps": [
    { "id": "search", "tool": "ast_search_symbols", "input": { "query": "User" } },
    {
      "id": "sources",
      "tool": "ast_get_symbol_source",
      "foreach": { "$ref": "#/steps/search/symbols" },
      "input": {
        "file_path": { "$item": "/file" },
        "symbol_path": { "$item": "/symbol_path" }
      }
    }
  ],
  "emit": { "$ref": "#/steps/sources" }
}
```

A normal step result is its tool's `structuredContent`; a foreach result is an array of structured results. Pointer roots expose only `{steps: <completed outputs>}`. `$ref` and `$item` are recognized only when they are the sole object property, so normal user objects remain data.

## Limits

- Input document: 1 MiB.
- Steps: 50.
- Total invocations: 500.
- Foreach items per step: 200.
- Read concurrency: default 4, maximum 16.
- Each retained step result and final JSON: 10 MiB.
- Cumulative retained context: 50 MiB.

No branches or expression evaluation. Validation rejects forward references by extracting the first `#/steps/<id>` pointer segment.

## Tool policy

Read-only allowlist: list, outline, symbol source/search, references and diagnostics. Prepare allowlist: rename and replace body. Apply and preview are not generic batch steps. A prepare must be singular, non-foreach and final. The runner persists its operation before printing success.

## Plan artifact

`src/services/operation-plan-file.ts` serializes a versioned envelope with public metadata, exact original/updated UTF-8 bytes encoded as base64, hashes, diffs and modes. Loading reconstructs a private operation record through explicit operations-service import/export functions.

Default location: `${XDG_STATE_HOME:-~/.local/state}/ast-tool/plans/<operation-id>.astplan`; optional `AST_TOOL_STATE_DIR` supports tests/isolated environments. Directory and file permissions are enforced on POSIX. Writes use sibling temp files, `fsync`, rename and directory sync.

The caller must provide the separately reviewed hash. Loader validates schema, preparation expiry, containment, byte hashes, summaries and recomputed plan hash before inserting the record. Applied receipts remain replayable after the preparation TTL.

The operations service owns a filesystem lock keyed by canonical `tsconfig.json`, so MCP and CLI apply share the same lock when configured with the same state directory. After source replacement, the CLI receipt callback rewrites the artifact with `status: applied` and `applied_at` before that lock is released. A new process can replay without writing. If receipt persistence fails, the command reports verified postimages may be present; retry recovers only from the exact complete post-workspace fingerprint. Partial/divergent state fails closed. A hard crash may leave a stale lock that requires operator inspection before removal.

## Observability

Success metadata includes duration, logical step count and actual invocation count. Persisted prepares always expose top-level review coordinates independently of `emit`. Errors include command, step id when known, error code and message. No source or intermediate payload is logged to stderr.

## Testing

- Pure tests for schema, references, `$item`, limits and projection.
- In-memory MCP integration tests for chained reads and errors.
- Separate-process CLI tests for stdout/stderr/exit codes.
- Separate-process prepare/apply test proving plan persistence and review boundary.
- Existing full suite and MCP smoke unchanged.
