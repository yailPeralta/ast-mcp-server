# ast-mcp-server

A correctness-oriented MCP server and batch CLI for compact structural reads and reviewed TypeScript/JavaScript edits. It uses the real TypeScript project model through `ts-morph`; declarations, references, rename locations, and diagnostics are not inferred with text search.

## Requirements

- Node.js 20.19 or newer
- A target project with a `tsconfig.json`

## Install

From a checkout:

```bash
npm ci
npm run build
npm link
```

From a package:

```bash
npm install --global ast-mcp-server
```

The package exposes two executables:

- `ast-mcp-server`: MCP stdio server.
- `ast-tool`: one-shot declarative batch CLI for Bash-capable agents.

## MCP setup

Hermes Agent:

```bash
hermes mcp add ast --command node --args /absolute/path/to/ast-mcp-server/dist/index.js
hermes mcp test ast
```

Each MCP tool accepts `project_root`, either the project directory or an explicit `tsconfig.json` path. The server contains no repository-specific paths.

## MCP tools

| Tool                        | Purpose                                                              | Mutates files |
| --------------------------- | -------------------------------------------------------------------- | ------------- |
| `ast_list_files`            | Paginated, project-relative source file inventory                    | No            |
| `ast_get_outline`           | Body-free declaration signatures; detailed symbol metadata is opt-in | No            |
| `ast_get_symbol_source`     | Exact source for one declaration                                     | No            |
| `ast_search_symbols`        | Paginated structural symbol discovery                                | No            |
| `ast_find_references`       | Compiler-resolved references with bounded context                    | No            |
| `ast_get_diagnostics`       | Project- or file-scoped TypeScript diagnostics                       | No            |
| `ast_rename_symbol`         | Prepare a project-wide rename                                        | No            |
| `ast_replace_symbol_body`   | Prepare a body-only replacement while preserving the signature       | No            |
| `ast_get_operation_preview` | Retrieve the complete retained diff for a prepared plan              | No            |
| `ast_apply_operation`       | Apply one reviewed, hash-bound plan                                  | Yes           |

Read results use project-relative paths, deterministic ordering, structured MCP output, and pagination where result sets can grow with the project.

## Batch CLI

`ast-tool` lets Claude Code and other Bash-capable clients collapse a known structural pipeline into one shell call:

```bash
ast-tool validate pipeline.json
ast-tool run pipeline.json
cat pipeline.json | ast-tool run -
```

Example search-to-source pipeline:

```json
{
  "version": 1,
  "project_root": "/absolute/project",
  "steps": [
    {
      "id": "search",
      "tool": "ast_search_symbols",
      "input": { "query": "UserService", "limit": 20 }
    },
    {
      "id": "source",
      "tool": "ast_get_symbol_source",
      "input": {
        "file_path": { "$ref": "#/steps/search/symbols/0/file" },
        "symbol_path": { "$ref": "#/steps/search/symbols/0/symbol_path" }
      }
    }
  ],
  "emit": { "$ref": "#/steps/source" }
}
```

A `$ref` is an RFC 6901 JSON Pointer rooted at prior step results. References cannot point forward. If `emit` is omitted, only the final step result is returned; intermediate results remain inside the process.

### Bounded foreach

```json
{
  "version": 1,
  "project_root": "/absolute/project",
  "limits": { "concurrency": 4 },
  "steps": [
    { "id": "files", "tool": "ast_list_files", "input": { "limit": 20 } },
    {
      "id": "outlines",
      "tool": "ast_get_outline",
      "foreach": { "$ref": "#/steps/files/files" },
      "input": { "file_path": { "$item": "" } }
    }
  ]
}
```

`$item` accepts an empty pointer for the complete item or `/field` for one field. Foreach is read-only, order-preserving, fail-fast, and concurrency-bounded.

### Batch limits

- Input document: 1 MiB.
- Steps: 50.
- Total tool invocations: 500.
- Foreach items per step: 200.
- Read concurrency: default 4, maximum 16.
- Each retained step result and final serialized output: 10 MiB.
- Total retained intermediate context: 50 MiB.
- One project root per pipeline.
- No branches, eval, embedded JavaScript, while loops, or arbitrary transformations.

Success is one JSON value on stdout. Errors are structured JSON on stderr. Exit code 0 is success, 1 is execution/apply failure, and 2 is usage or schema failure.

## Reviewed mutations

### MCP process

Rename and body replacement never write directly:

1. Call `ast_rename_symbol` or `ast_replace_symbol_body`.
2. Review the diagnostic delta, affected files, `blocked`, and `plan_hash`.
3. Fetch complete diffs with `ast_get_operation_preview` when needed.
4. Call `ast_apply_operation` with both `operation_id` and `plan_hash`.

MCP plans live in a bounded in-memory store and do not survive a server restart.

### CLI process boundary

A batch may contain at most one prepare operation. It must be the final step and cannot use foreach. `ast_apply_operation` and arbitrary preview calls are forbidden inside batch documents.

A CLI prepare writes an exact private plan and returns top-level `operation_id`, `plan_hash`, and `plan_file` even when `emit` omits them:

```bash
ast-tool run prepare-rename.json
ast-tool apply /path/from/plan_file.astplan --plan-hash <reviewed-sha256>
```

The default plan directory is:

```text
${XDG_STATE_HOME:-~/.local/state}/ast-tool/plans
```

Set `AST_TOOL_STATE_DIR` to isolate it. Directories are mode `0700`; plans are mode `0600`, atomically replaced, size-bounded, versioned, and expire with the prepared operation. Plan files contain exact proposed source bytes and must be treated as private code.

Apply loads the exact retained postimages, requires the separately supplied reviewed hash, validates serialized byte hashes and contained paths, rechecks the complete source/config workspace, stages writes, verifies postimages, and persists an applied receipt inside the same cooperative workspace lock. A later CLI invocation can replay that receipt idempotently, including after the preparation TTL.

### Guarantee boundary

The server does **not** claim a filesystem-wide transaction:

- Replacement is atomic per file where the local filesystem provides atomic rename.
- A multi-file apply has a short interval in which some replacements may already be visible.
- Rollback is best effort and refuses to overwrite a file changed by another writer after replacement.
- MCP and CLI apply share a fail-closed filesystem lock keyed by canonical `tsconfig.json` when they use the same state directory. It does not coordinate editors, NFS writers, or hostile external processes.
- Receipt persistence runs before that lock is released. If receipt storage fails after source replacement, apply exits non-zero and reports that verified postimages may be present; retry recovers the receipt only when the complete workspace exactly matches the reviewed post-workspace fingerprint.
- A hard process crash can leave a stale lock. Remove it only after inspecting its metadata and proving no apply is running; exact complete postimages can then recover the receipt, while partial or divergent state remains a conflict.
- Source encoding support is UTF-8, with or without BOM. Unsupported encodings are rejected.

## Development gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:mcp
npm run test:cli
npm audit
npm pack --dry-run
```

`test:mcp` exercises the built stdio server. `test:cli` runs a read pipeline and a prepare/apply/replay workflow across separate Node processes.

## Benchmarks

```bash
npm run benchmark -- /absolute/project --sample 20 --output benchmark/results/project.json
npm run benchmark:corpus -- benchmark/task-corpus.json --output benchmark/results/self-corpus.json
npm run benchmark:batch -- --iterations 5 --output benchmark/results/self-batch.json
```

The batch benchmark compares two separate client calls with one batch invocation in fresh Node processes, recording model round-trips, actual tool invocations, wall time, maximum RSS, and serialized character counts. Character counts are not model-specific token estimates. See `benchmark/README.md` for methodology and limitations.

## Scope

- TypeScript and JavaScript projects understood by the TypeScript compiler.
- Structural rename and callable-body replacement.
- Declarative DAG-like pipelines with prior-result references and bounded foreach.
- No arbitrary signature migration, file creation/deletion plans, cross-language refactors, or general-purpose scripting language.
