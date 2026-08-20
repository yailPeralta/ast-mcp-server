<p align="center">
  <img src="assets/header.jpg" alt="Abstract network of connected code symbols with the text AST MCP Server." width="100%" />
</p>

# ast-mcp-server

[![CI](https://github.com/yailPeralta/ast-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/yailPeralta/ast-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ast-mcp-server.svg)](https://www.npmjs.com/package/ast-mcp-server)
[![Node.js 22.13+](https://img.shields.io/badge/Node.js-22.13%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

`ast-mcp-server` gives coding agents compact, type-aware access to TypeScript and JavaScript projects. It uses the real compiler project model through `ts-morph`, so declarations, references, rename locations, and diagnostics come from the AST instead of text-search guesses.

Reads are bounded and structured. Writes follow an explicit `prepare → review → apply` protocol with immutable hashes, workspace freshness checks, diagnostic guards, and idempotent receipts.

## The problem

Coding agents often fall back to two generic operations: read files as plain text and write text patches. That works, but it has three predictable costs:

1. **Too much context.** The agent may load hundreds of lines when it only needs one signature or method body. That consumes model context and tokens without improving the answer.
2. **Fragile edits.** Text patches do not inherently understand declarations, scopes, overloads, or TypeScript diagnostics. A plausible-looking edit can target the wrong construct or introduce a new compiler error.
3. **Weak cross-file reasoning.** Text search can find matching words, but it cannot reliably distinguish two unrelated symbols with the same name. Project-wide references and renames need the compiler's understanding of the program.

## What this tool does instead

This MCP server gives the agent structural code tools in addition to generic file reads and writes. Under the hood, `ts-morph` uses the TypeScript compiler project model, so the server can reason about declarations and references as code rather than undifferentiated text.

| Need                           | Structural operation       | Returned scope                                              |
| ------------------------------ | -------------------------- | ----------------------------------------------------------- |
| Read a bounded file            | `ast_get_file`             | Exact selected source lines, hashes, and bounded freshness  |
| Explore bounded context        | `ast_explore`              | Ranked selectors plus optional source and references        |
| Understand a file              | `ast_get_outline`          | Signatures without implementation bodies                    |
| Inspect one declaration        | `ast_get_symbol_source`    | Exact source for one function, method, class, or type       |
| Find usages across the project | `ast_find_references`      | Compiler-resolved reference locations                       |
| Understand symbol impact       | `ast_get_impact`           | Bounded direct/transitive compiler-backed relationships     |
| Select affected tests          | `ast_find_test_candidates` | Whole candidate proofs from incoming compiler relationships |
| Rename a symbol everywhere     | `ast_rename_symbol`        | A reviewed project-wide rename plan                         |
| Change one implementation      | `ast_replace_symbol_body`  | A body-only plan that preserves the declaration             |

Reads can start with a bounded file slice, a compact outline, or exact source only for the declaration that needs inspection. Mutations are prepared in memory first, compared against baseline diagnostics, and returned as immutable, hash-bound plans. Nothing is written until the caller reviews and explicitly applies the plan.

### Choosing a read tool

- Use `ast_get_file` when the file path is known and the agent needs exact source lines. It is read-only, uses zero-based `offset` and bounded `limit`, returns one-based line records, a SHA-256 byte hash, file-level `snapshot_state`, and bounded project `freshness` metadata (`fresh`, `pending`, `stale`, `rebuilding`, or `degraded`).
- Use `ast_get_file` with `symbols_only: true` when only selectors and body-free signatures are needed from one known file.
- Use `ast_explore` when the question spans discovery and evidence. Its default summary is bounded; use `detail: "context"` for selected source and `detail: "full"` for source plus compiler references.
- Use `ast_get_outline` for a compact body-free view of a known file without source lines.
- Use `ast_get_symbol_source` when one declaration or implementation is the required evidence.
- Use `ast_get_impact` when the exact symbol is known and bounded direct/transitive compiler relationships are needed; it is read-only evidence, not a mutation plan.
- Use `ast_find_test_candidates` when an exact symbol should map to conservative test candidates. It forces incoming compiler traversal, returns complete relationship paths, and never executes tests.

`snapshot_state: "fresh"` means that the returned file bytes match the synchronized compiler snapshot. The separate `freshness` object describes the project/session state and preserves causes such as source changes or watcher failure. Neither field means that the project has zero TypeScript diagnostics; use `ast_get_diagnostics` for compiler errors and warnings.

### Trust, freshness and completeness

The server exposes evidence labels instead of collapsing every result into an unqualified confidence score:

| Label                                                                                                 | Meaning                                                                                                                                                                                                       | Safe use                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `provenance: "compiler"`, `confidence: "exact"`, `resolution: "resolved"`, `freshness.state: "fresh"` | A relationship resolved by the active TypeScript compiler snapshot. This is the only combination that sets `compiler_authoritative: true`.                                                                    | May support bounded impact evidence and compiler-backed test candidates.                                 |
| `provenance: "syntax"`                                                                                | Syntax or AST structure without semantic symbol resolution.                                                                                                                                                   | Navigation and structural context only; not proof that two symbols are related.                          |
| `provenance: "heuristic"`                                                                             | A convention or name-based suggestion.                                                                                                                                                                        | Discovery hints only; never mutation authority or a compiler-backed test candidate.                      |
| index evidence                                                                                        | A derived query accelerator, not compiler authority. The current production status reports the index as disabled; any future ready index still requires compiler selector validation and a compiler fallback. | Faster routing only; stale, missing or mismatched entries must fail closed or fall back to the compiler. |

Freshness is orthogonal to TypeScript diagnostics. `fresh` means the evidence matches the synchronized snapshot; `pending`, `rebuilding`, `stale`, or `degraded` means the response must not be presented as current compiler evidence. Read tools expose the state, causes (`source_change`, `config_change`, `index_failure`, `watcher_failure`, or `compiler_rebuild`), and bounded `checked_at` timestamp. `ast_get_impact` refuses non-fresh compiler relationships. `ast_explore` returns the state together with `completeness`, `unresolved`, `budget`, and `truncation` metadata rather than silently dropping evidence.

All reads are budgeted. Callers control pagination and, where applicable, `max_bytes`, `reference_limit`, `max_depth`, `max_nodes`, and `max_edges`; responses report the effective limits and whether a record, byte, depth, edge, invocation, or serialization limit truncated the result. A truncated or unresolved result is incomplete evidence, not an empty negative result. `ast_find_test_candidates` follows the same rule: it accepts only fresh, exact compiler-backed impact, emits direct/transitive evidence and bounded relationship IDs, and never executes tests or guesses from filenames alone. Only a complete authoritative traversal may return `candidates: []` with `proven_empty: true`.

## Why this helps

- **Less context:** the agent retrieves the smallest structural unit that answers the question instead of loading the complete file by default.
- **Safer changes:** exact symbol selection, diagnostic deltas, workspace freshness checks, and `prepare → review → apply` reduce the failure modes of ad hoc text editing.
- **Accurate project-wide operations:** references and renames use compiler resolution rather than matching identifier text with grep.

AST-aware editing is not a proof that a change is semantically correct. The safety comes from combining structural selection with diagnostics, exact previews, reviewed hashes, freshness checks, and fail-closed apply semantics.

The included batch benchmark records a 50% reduction in model round-trips and a 94.67% reduction in serialized context for its search-to-source scenario. The result-shaping corpus records a 68.80% reduction in aggregate model-facing TOON tokens while preserving declared selectors/reference coordinates with the same six logical calls. The separate format benchmark records 25.87% across its eligible collection corpus. The context workflow benchmark verifies evidence preservation and call bounds for full-file, primitive, and `ast_explore` workflows. These are reproducible local `o200k_base` estimates, not universal token, billing, cache, or latency claims.

## Requirements

- Node.js 22.13.0 or newer
- Corepack with Yarn 4.15.0 (pinned by `packageManager`)
- A target project with a `tsconfig.json`

## Supported environment and trust boundary

The local `0.9.2` release candidate requires Node.js `>=22.13.0`; its evidence matrix targets exact Node.js 22.13.0 and the current Node.js 24 line. Published v0.8.1 retains its immutable historical Node.js 22.5.0/24 evidence. Managed setup-file publication additionally requires GNU coreutils 9.7 `mv` supporting `--update=none-fail`, `--exchange`, `--no-copy`, and `--no-target-directory`, GNU coreutils `ln -L -T`, procfs descriptor paths at `/proc/self/fd`, and `O_DIRECTORY`/`O_NOFOLLOW`. Other Linux architectures or systems without those filesystem primitives, macOS, and Windows remain unverified.

This is a local stdio server. It runs with the invoking user's filesystem permissions, and clients may request any `project_root` that user can access. It does not provide HTTP authentication, sandboxing, tenant isolation, or a remote-service security boundary. Remote, untrusted, and multi-tenant operation is unsupported.

In the local `0.9.2` release candidate, an absent `AST_SYMBOL_INDEX_PERSISTENCE` or explicit `enabled` selects the private SQLite symbol-index cache. `disabled` is the immediate memory-only rollback. `canary` requires an explicit absolute normalized `AST_SYMBOL_INDEX_CACHE_ROOT`. Invalid policy or storage fails closed to compiler-authoritative memory reads with bounded path-free status.

The default cache root is selected from `AST_SYMBOL_INDEX_CACHE_ROOT`, then `XDG_CACHE_HOME`, then `HOME`. Inspect or clear only derived cache artifacts through the bounded CLI:

```bash
ast-tool cache inspect
ast-tool cache clear --yes
```

Clear requires exact confirmation, refuses unsafe or active SQLite artifacts, and preserves unknown regular files. No automatic cache GC is enabled.

See [Support policy](docs/support.md) for the complete platform, runtime, persistence, and operational contract. Report security issues through [SECURITY.md](SECURITY.md).

## Install

Install the published CLI globally while keeping dependency lifecycle scripts disabled:

```bash
npm install --global ast-mcp-server --ignore-scripts
ast-tool setup
```

`--ignore-scripts` prevents dependencies from running `preinstall`, `install`, or `postinstall` hooks. The package and its current runtime dependencies do not require those hooks.

### Install from source

To build the current source instead:

```bash
git clone https://github.com/yailPeralta/ast-mcp-server.git
cd ast-mcp-server
corepack enable
yarn install --immutable
yarn build
```

The repository pins Yarn 4 and commits `enableScripts: false` in `.yarnrc.yml`. Dependency lifecycle scripts are therefore disabled during installation; switching from npm without this setting would merely change logos while preserving the risk.

The package exposes two executables when installed:

- `ast-mcp-server`: MCP stdio server.
- `ast-tool`: batch, skill-installation, and agent-setup CLI.

## Guided agent setup

The installed package opens the interactive wizard with:

```bash
ast-tool setup
```

From a source checkout, use the Yarn script; it builds first and then opens the same wizard:

```bash
yarn setup
```

The wizard supports exactly six CLI clients in this order: Claude Code, Hermes, OpenCode, Codex CLI, Gemini CLI, and GitHub Copilot CLI. Cursor, Windsurf, Cline, and other editor-integrated clients are intentionally excluded. Compatible detected clients start checked; unavailable or incompatible clients are disabled with a reason. Use Up/Down to move, Space to toggle, Enter to submit, or Escape/Ctrl-C to cancel.

1. preflights every selected client's existing `ast` MCP registration, skill destination, and effective managed-guidance destination;
2. installs or safely upgrades the bundled `structural-code-editing` skill;
3. adds one marker-owned activation block to each verified global instruction surface while preserving all user-owned bytes;
4. registers this package's MCP server through the agent's official CLI;
5. reconnects and verifies the expected tools.

Existing matching registrations, skill files, and managed blocks are unchanged. Conflicting MCP registrations or malformed/unknown managed guidance fail before any write; resolve them explicitly instead of letting a setup script guess. Skill upgrades are automatic only when the installed bytes match an exact SHA-256 admitted from a published npm tarball. Unknown or customized skill bytes fail closed unless `--force-skill` is explicit. That flag applies only to the skill and cannot override guidance conflicts, unsafe routes, or filesystem races.

Guidance uses each client's verified global instruction contract rather than one universal filename:

| Client   | Managed guidance destination                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| Claude   | `$CLAUDE_CONFIG_DIR/CLAUDE.md`, or `~/.claude/CLAUDE.md`                                                              |
| OpenCode | Effective native `AGENTS.md`; an existing Claude fallback may be shared or preserved when OpenCode has no native file |
| Codex    | Non-empty `$CODEX_HOME/AGENTS.override.md`, otherwise `$CODEX_HOME/AGENTS.md`; `CODEX_HOME` defaults to `~/.codex`    |
| Gemini   | The one supported safe `context.fileName` from `~/.gemini/settings.json`, otherwise `~/.gemini/GEMINI.md`             |
| Hermes   | `skill_only`; setup does not modify `SOUL.md` or invent a global instruction destination                              |
| Copilot  | `skill_only`; setup does not invent a personal global instruction destination                                         |

The managed range is delimited by `ast-tool:structural-code-editing guidance v1` begin/end markers. Setup updates only that range, preserves the file's UTF-8 BOM, newline style, mode, and all content outside the range, and rejects duplicate, partial, reordered, unknown, symlinked, or non-regular destinations. Writes pin the parent chain, preimage, held temporary inode, and destination. New files use descriptor-bound no-clobber publication; replacements use an atomic same-directory exchange, validate both exchanged identities plus the pinned preimage bytes and mode, and roll the exact pair back when an in-call substitution or same-inode edit is detected. Every completed postimage is reauthenticated before later asset or MCP mutation. Cross-client setup is convergent rather than globally transactional.

Successful setup output uses schema `version: 2`. Each agent reports `mcp`, `skill`, and `guidance`; physical writes include an `asset` of `skill`, `guidance`, or `mcp_config`. A complete replay returns every applicable item as `unchanged`/`skill_only` and an empty `physical_writes` array. A failed managed publication separates `completed_writes`, `possibly_committed`, `rolled_back`, `rollback_failed`, and `pending`; an uncertain commit or failed rollback is never reported as untouched and requires inspection plus a fresh replan.

For automation, make the target set and confirmation explicit:

```bash
ast-tool setup --agents all --yes
ast-tool setup --agents claude,codex --yes
```

From a source checkout, replace `ast-tool` with `yarn setup` in those commands.

`--agents all` is resolved only after detection and means every detected compatible client. If any detected client has unknown or incompatible output, setup fails before writes. Explicit IDs are strict and reject unavailable clients. Non-interactive setup requires both `--agents` and `--yes`.

OpenCode 1.18.18 or newer is required. Because `opencode mcp add` ignores custom config routing, setup updates only `mcp.ast` in `OPENCODE_CONFIG`, then `OPENCODE_CONFIG_DIR/opencode.json`, then `~/.config/opencode/opencode.json`. JSONC comments, unrelated keys, and file mode are preserved. OpenCode's nominally diagnostic config command normalizes both routed config files, so setup runs discovery and verification against disposable copies while retaining the selected config bytes and fails closed if the planned real destination changes. Gemini setup may require trusting the current folder before registration. Diagnostics use a correlation ID and omit command arguments, environment, credentials, and raw provider output; setup failures may include a bounded destination path so the operator can inspect an uncertain or pending write.

## Install the agent skill

The package bundles a `structural-code-editing` skill that teaches an agent when to use the AST tools, how to minimize context, and how to review mutations safely. Install it for both Claude Code and Hermes with one command:

```bash
ast-tool install-skill all
```

Or install one target at a time:

```bash
ast-tool install-skill claude
ast-tool install-skill hermes
```

The default is user scope. It writes to Claude Code's personal skill directory and to the active `HERMES_HOME`:

| Target                           | Destination                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Claude Code                      | `$CLAUDE_CONFIG_DIR/skills/structural-code-editing/SKILL.md`, or `~/.claude/skills/...` by default         |
| Hermes                           | `$HERMES_HOME/skills/software-development/structural-code-editing/SKILL.md`, or `~/.hermes/...` by default |
| OpenCode, Codex, Gemini, Copilot | `~/.agents/skills/structural-code-editing/SKILL.md` (one physical write, four logical outcomes)            |

To commit the skill into one project for Claude Code, use project scope:

```bash
ast-tool install-skill claude --scope project --project-root /absolute/project
```

This writes `.claude/skills/structural-code-editing/SKILL.md` below that project. Project scope is intentionally rejected for Hermes because Hermes skills belong to a profile, not a source repository.

Installation is idempotent. Existing current bytes are left untouched; exact predecessor bytes admitted by the bundled npm-provenance manifest are upgraded safely. Unknown or customized bytes fail closed unless `--force` is explicit. `install-skill` never writes global guidance or configures MCP. From an unlinked source checkout, replace `ast-tool` with `yarn node /absolute/path/to/ast-mcp-server/dist/cli.js`.

Claude Code detects changes in an existing skill directory live; restart it if the top-level skills directory did not exist when the session started. In Hermes, run `/reload-skills` or start a new session, then verify with `hermes skills list`.

`install-skill` only installs the skill; it does not configure the MCP transport. Use the guided `setup` command to do both, or complete the client-specific MCP setup below—the instructions are useful, but they have not yet learned to open a stdio socket through positive thinking.

## Use with Claude Code

Claude Code supports local stdio MCP servers. After building this repository, register the server with an absolute entrypoint:

```bash
AST_MCP_DIR="$(pwd)"
claude mcp add --scope user --transport stdio ast -- \
  node "$AST_MCP_DIR/dist/index.js"
claude mcp get ast
```

`claude mcp get ast` should report `Status: ✔ Connected`. The `--` separator is required: everything after it is the server command, not a Claude Code option.

The example uses `--scope user`, which makes the server available in all your projects. Use `--scope local` instead to register it only for the project from which you run the command. Avoid committing a project-scoped `.mcp.json` that contains another developer's absolute checkout path.

Start Claude Code inside any TypeScript project with a `tsconfig.json`:

```bash
cd /absolute/path/to/your-typescript-project
claude
```

Then ask Claude to use the `ast` tools. For example:

```text
Use the ast MCP server to inspect this project.
First search for UserService, then fetch only the exact source of its create method.
```

For a reviewed rename:

```text
Use ast_rename_symbol to prepare renaming UserService.create to createUser.
Do not apply it yet. Show me the affected files, diagnostic delta, plan hash,
and the complete operation preview.
```

After reviewing the preview:

```text
Apply that operation with ast_apply_operation using the exact operation_id and
plan_hash returned by the prepare step.
```

Project-scoped read and prepare tools require `project_root`. Claude should pass the current project directory or its explicit `tsconfig.json` path. Preview and apply calls instead use the prepared operation coordinates; the MCP server itself contains no repository-specific paths.

### MCP or batch CLI?

| Workflow                                         | Recommended interface                     |
| ------------------------------------------------ | ----------------------------------------- |
| Interactive exploration or one reviewed mutation | Claude Code MCP tools                     |
| A known multi-step read pipeline                 | `ast-tool run pipeline.json` through Bash |
| Prepare now and apply in a later process         | `ast-tool run`, then `ast-tool apply`     |

Use `/mcp` inside Claude Code to inspect server status and tools. Outside the session, use `claude mcp list`, `claude mcp get ast`, or `claude mcp remove ast -s user`.

## Other MCP clients

Hermes Agent:

```bash
hermes mcp add ast --command node --args /absolute/path/to/ast-mcp-server/dist/index.js
hermes mcp test ast
```

Project-scoped tools accept `project_root`, either the project directory or an explicit `tsconfig.json` path. The server contains no repository-specific paths.

## MCP tools

| Tool                        | Purpose                                                              | Mutates files |
| --------------------------- | -------------------------------------------------------------------- | ------------- |
| `ast_list_files`            | Paginated, project-relative source file inventory                    | No            |
| `ast_get_project_status`    | Read-only compiler, freshness, index, and operation status           | No            |
| `ast_explore`               | Bounded composed selectors, source evidence, and references          | No            |
| `ast_get_file`              | Bounded exact source lines, byte hash, and snapshot state            | No            |
| `ast_get_outline`           | Body-free declaration signatures; detailed symbol metadata is opt-in | No            |
| `ast_get_symbol_source`     | Exact source for one declaration                                     | No            |
| `ast_search_symbols`        | Paginated structural symbol discovery                                | No            |
| `ast_find_references`       | Compiler-resolved references with bounded context                    | No            |
| `ast_get_impact`            | Bounded incoming/outgoing compiler-backed impact evidence            | No            |
| `ast_find_test_candidates`  | Paginated affected tests with atomic compiler relationship proofs    | No            |
| `ast_get_diagnostics`       | Project- or file-scoped TypeScript diagnostics                       | No            |
| `ast_rename_symbol`         | Prepare a project-wide rename                                        | No            |
| `ast_replace_symbol_body`   | Prepare a body-only replacement while preserving the signature       | No            |
| `ast_scaffold_class`        | Prepare one new class file with explicit placeholder methods         | No            |
| `ast_get_operation_preview` | Retrieve the complete retained diff for a prepared plan              | No            |
| `ast_apply_operation`       | Apply one reviewed, hash-bound plan                                  | Yes           |

Read results use project-relative paths, deterministic ordering, structured MCP output, and pagination where result sets can grow with the project.

`ast_explore` supports query, exact file, and exact symbol routes. Its default `summary` profile returns bounded reusable selectors; `context` adds selected source and `full` adds compiler references. Every response reports freshness, completeness, truncation, unresolved selectors, record limits, and a serialized byte budget. Use the primitive tools when a single exact operation is clearer or when preparing a mutation.

Symbol search is relevance-ranked and defaults to at most 20 `summary` records containing `file`, a directly reusable `selector`, `kind`, and body-free `signature`. Request `detail: "selectors"` for routing coordinates only, or `detail: "full", limit: 100` for the v0.4.0 fields/page. References default to `detail: "locations"`; request `detail: "context"` only when the bounded source line is needed.

### Optional TOON results

`ast_search_symbols`, `ast_find_references`, `ast_get_impact`, and `ast_get_diagnostics` accept `output_format: "toon"` for collection-heavy results consumed directly by a model. JSON remains the default and preserves the canonical structured object.

MCP TOON is returned once as structured content shaped like `{ "format": "toon", "data": "..." }`; `data` is the lossless TOON document. The complete JSON result is not duplicated. These four tools validate their canonical Zod result and verify an encode/decode deep-equality round trip before presentation, but do not advertise a single MCP `outputSchema` because their successful structured content has two representations.

Do not request TOON for source, outlines, file lists, previews, or mutation results. Checked negative controls show that the MCP envelope makes those shapes larger. TOON is an explicit shape-specific optimization, not a new dialect for every object in sight.

## Batch CLI

`ast-tool` lets Claude Code and other Bash-capable clients collapse a known structural pipeline into one shell call:

```bash
ast-tool validate pipeline.json
ast-tool run pipeline.json
ast-tool run pipeline.json --output-format toon
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
        "symbol_path": { "$ref": "#/steps/search/symbols/0/selector" }
      }
    }
  ],
  "emit": { "$ref": "#/steps/source" }
}
```

A `$ref` is an RFC 6901 JSON Pointer rooted at prior step results. References cannot point forward. If `emit` is omitted, only the final step result is returned; intermediate results remain inside the process.

`ast_find_test_candidates` is admitted as a read step. The batch runner injects the pipeline `project_root`, rejects a conflicting step root, and invokes the same registered MCP implementation. Candidate pagination keeps each relationship path whole; final JSON and TOON differ only in serialization, not logical evidence.

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

Success is one compact JSON value on stdout by default. `ast-tool run --output-format toon` writes one plain TOON document for a read-only batch; internal steps remain structured JSON, and prepare batches reject TOON before execution. Encoding and output-limit failures write no partial stdout and use stable `ENCODING_ERROR` or `OUTPUT_LIMIT` codes. Errors are always structured JSON on stderr. Exit code 0 is success, 1 is execution/apply failure, and 2 is usage or schema failure.

## Reviewed mutations

### MCP process

Rename, body replacement, and class scaffold never write directly during preparation:

1. Call `ast_rename_symbol`, `ast_replace_symbol_body`, or `ast_scaffold_class`.
2. Review the diagnostic delta, affected files, `blocked`, and `plan_hash`.
3. Fetch complete diffs with `ast_get_operation_preview` when needed.
4. Call `ast_apply_operation` with both `operation_id` and `plan_hash`.

MCP plans live in a bounded in-memory store and do not survive a server restart.

`ast_scaffold_class` accepts structured imports, heritage, decorators, constructor parameter properties, initialized properties, and one or more method signatures. It creates an in-memory preview for one absent project-relative `.ts`/`.tsx` target. Each generated method initially contains only `throw new Error("Not implemented: Class.method")`. Review the `/dev/null` creation diff and diagnostics, apply the scaffold, then replace each pending method body with `ast_replace_symbol_body`. Existing targets and symbolic/traversing parents fail closed.

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
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn build
yarn test:mcp
yarn test:cli
yarn test:package
yarn test:installed-agents
yarn npm audit --all --recursive
yarn pack --dry-run
```

`test:mcp` exercises the built stdio server. `test:cli` runs a read pipeline and a prepare/apply/replay workflow across separate Node processes. `test:installed-agents` is a host-dependent manual gate: it builds first, detects locally installed supported clients, uses only disposable homes/config roots, verifies deterministic effective discovery without model calls, reports unavailable clients, and removes the disposable state. It is not a portable CI requirement because CI does not install every external client.

## Benchmarks

```bash
yarn benchmark /absolute/project --sample 20 --output benchmark/results/project.json
yarn benchmark:corpus benchmark/task-corpus.json --output benchmark/results/self-corpus.json
yarn benchmark:batch --iterations 5 --output benchmark/results/self-batch.json
yarn benchmark:formats
yarn benchmark:shapes
```

The batch benchmark compares two separate client calls with one batch invocation in fresh Node processes, recording model round-trips, actual tool invocations, wall time, maximum RSS, and serialized character counts. Character counts are not model-specific token estimates.

The format benchmark runs real tools against this repository plus deterministic reference/diagnostic fixtures. It checks JSON→TOON→value equality, UTF-8 bytes, `gpt-tokenizer` `o200k_base` estimates, encode/decode latency, the actual MCP envelope, tool metadata, and negative controls. Its checked result is `benchmark/results/self-formats.json`; local tokenizer estimates do not establish provider-side billing or cache savings. See `benchmark/README.md` for methodology and limitations.

The result-shaping benchmark compares the v0.4.0-compatible `full/100/context` profiles with the new public defaults across exact-name, exact-path, prefix, broad-substring, and multi-file-reference tasks. It fails on missing evidence, extra required calls, fewer than the benchmark's required minimum tool surface, or less than 35% aggregate TOON token reduction. Its checked result is `benchmark/results/self-result-shapes.json`.

## Scope

- TypeScript and JavaScript projects understood by the TypeScript compiler.
- Structural rename, callable-body replacement, and reviewed creation of one class scaffold.
- Declarative DAG-like pipelines with prior-result references and bounded foreach.
- No arbitrary signature migration, general file creation/deletion, cross-language refactors, or general-purpose scripting language.
