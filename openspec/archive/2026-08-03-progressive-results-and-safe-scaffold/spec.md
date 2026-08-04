# Specification: progressive results and safe class scaffolding

## Version identity

### AST-VERSION-001 Single source of truth

The MCP server handshake version MUST equal the `version` field in the package metadata shipped with the running server. Runtime code MUST NOT contain an independently maintained release version literal.

### AST-VERSION-002 Packaged handshake verification

The stdio/package smoke path MUST connect to the packed server and assert that its reported version equals the installed package version.

## Ranked symbol search

### AST-SEARCH-001 Relevance order

`ast_search_symbols` MUST rank case-insensitive matches in this order:

1. exact selector;
2. exact symbol path;
3. exact declaration name;
4. symbol-path or name prefix;
5. remaining substring matches.

Within one rank, results MUST be ordered deterministically by project-relative file, start line, symbol path and kind.

### AST-SEARCH-002 Filter preservation

`kinds` and `file_filter` MUST be applied before pagination. Ranking MUST NOT admit declarations that do not satisfy the existing query/filter semantics.

### AST-SEARCH-003 Default page

If `limit` is omitted, search MUST return at most 20 ranked records. Explicit integer limits from 1 through 500 and the existing zero-based offset semantics MUST remain supported.

### AST-SEARCH-004 Detail levels

Search MUST accept the closed enum `detail: selectors | summary | full`, defaulting to `summary`.

- `selectors` records MUST contain exactly `file`, `selector` and `kind`.
- `summary` records MUST contain exactly `file`, `selector`, `kind` and `signature`.
- `full` records MUST preserve the v0.4.0 fields exactly: `file`, `symbol_path`, `selector`, `name`, `kind`, `signature` and `line`.

Every selector MUST be accepted unchanged as the `symbol_path` argument of exact downstream tools.

### AST-SEARCH-005 Counts and pagination

`total`, `offset`, `limit` and `has_more` MUST describe the ranked, filtered logical set independently of detail or output format. Detail projection MUST occur after ranking/pagination.

### AST-SEARCH-006 Format orthogonality

For each detail level, JSON and decoded TOON MUST deep-equal the same internally validated canonical value. `output_format` MUST NOT affect ranking, projection or pagination.

## Progressive references

### AST-REF-001 Detail levels

`ast_find_references` MUST accept `detail: locations | context`, defaulting to `locations`.

- `locations` records MUST contain exactly `file`, `line`, `column`, `kind` and `is_declaration`.
- `context` records MUST preserve the v0.4.0 record, adding the bounded `context` string to those fields.

### AST-REF-002 Scope metadata

`symbol`, `include_declaration`, `total`, `affected_files`, `offset`, `limit` and `has_more` MUST remain present and independent of detail. `affected_files` MUST continue to describe the complete reference set, not only the current page.

### AST-REF-003 Pagination and format

Pagination MUST occur before detail projection. JSON and decoded TOON MUST deep-equal the same canonical result for both levels.

## Diagnostics boundary

### AST-DIAG-001 Preserve diagnostic evidence

This change MUST NOT remove diagnostic messages or change diagnostic default fields. Grouping and message-free diagnostics remain out of scope because the measured savings do not justify reduced diagnostic usefulness.

## Result-shaping measurement

### AST-MEASURE-101 Workflow corpus

A checked deterministic corpus MUST cover exact-name, exact-path, prefix and broad-substring symbol queries plus multi-file references. Each case MUST declare the selectors or coordinates required to complete the task.

### AST-MEASURE-102 Correctness before savings

A candidate result profile MUST fail the benchmark if required evidence is missing, a selector no longer resolves exactly, reference scope metadata changes, or the workflow needs more calls than the checked bound.

### AST-MEASURE-103 Token and call accounting

The benchmark MUST report compact JSON and TOON characters, UTF-8 bytes and named-tokenizer tokens for v0.4.0-equivalent full results and the new defaults. It MUST report tool-call counts and aggregate workflow totals separately.

### AST-MEASURE-104 Acceptance threshold

Across the checked result-shaping corpus, the new default model-facing TOON values MUST reduce aggregate tokenizer-estimated tokens by at least 35% versus full-detail TOON with a 100-result search page, while preserving all declared evidence and without increasing required tool calls.

### AST-MEASURE-105 Static metadata

The benchmark MUST record serialized `tools/list` characters and tokenizer-estimated tokens for the complete eleven-tool server, compare them with the retained v0.4.0 baseline and report the scaffold contribution separately where reproducible.

### AST-MEASURE-106 Claims boundary

Documentation MUST distinguish serializer estimates, workflow estimates, static schemas and provider-reported usage. It MUST NOT claim reduced billing or cache cost without same-provider usage evidence.

## Class scaffold input

### AST-SCAFFOLD-001 Prepare-only tool

The server MUST expose `ast_scaffold_class` as a prepare mutation. Calling it MUST NOT create, overwrite, truncate or chmod the target file. `dry_run`, if supplied, MUST accept only `true` and MUST NOT alter behavior.

### AST-SCAFFOLD-002 Target path

`file_path` MUST be project-relative, end in `.ts` or `.tsx`, resolve within the canonical project root, and name an absent target under an existing safe directory. Absolute paths, traversal, symbolic-link parents, existing targets and non-regular parent directories MUST fail before plan creation.

### AST-SCAFFOLD-003 Bounded strict schema

The input MUST be a strict bounded schema containing:

- `project_root`, `file_path`, `class_name`;
- optional import declarations with `from`, named imports and/or a default import;
- optional class decorators, `extends` and `implements` clauses;
- optional constructor parameters with name, type and `public | protected | private | private readonly` access;
- optional property declarations with name, type, access and optional initializer;
- one or more methods with name, parameters, return type, async flag, access and decorators;
- optional `allow_new_errors` and compatibility `dry_run: true`.

Arrays and raw TypeScript fragments MUST have explicit upper bounds. Unknown object keys MUST be rejected.

### AST-SCAFFOLD-004 Declaration validation

Class/member/parameter/import identifiers MUST be valid TypeScript identifiers for the configured language target. Duplicate method names, duplicate parameter names and unsupported overload/computed/private-field forms MUST be rejected. Raw type, decorator, heritage and initializer fragments MUST parse into the expected declaration positions without creating extra top-level statements or members.

### AST-SCAFFOLD-005 Generated class

The generated file MUST contain imports followed by exactly one exported named class. It MUST contain at most one constructor. Formatting MUST be deterministic under the pinned ts-morph/TypeScript versions.

### AST-SCAFFOLD-006 Placeholder methods

Every requested method MUST be generated with exactly one loud placeholder statement equivalent to:

`throw new Error("Not implemented: <ClassName>.<methodName>");`

The tool MUST NOT generate silent `undefined`, empty operational methods or inferred business logic.

### AST-SCAFFOLD-007 Diagnostic policy

The complete in-memory project including the new source MUST be diagnosed before a plan is returned. New TypeScript errors MUST block apply by default. `allow_new_errors: true` MAY produce an unblocked reviewed plan and MUST expose the diagnostic delta.

### AST-SCAFFOLD-008 Review result

A successful prepare response MUST include the standard operation ID, plan hash, workspace hash, affected file hash, diagnostic delta, blocked state and preview coordinates. It MUST additionally include:

- the project-relative target file;
- a body-free outline of the generated source;
- one direct pending symbol path per generated method.

Inline preview truncation MUST retain the existing exact-preview retrieval flow through `ast_get_operation_preview`.

## New-file operation semantics

### AST-CREATE-001 Absent state

The operation plan MUST distinguish a nonexistent target from an existing empty file in its hash-bound file state. The distinction MUST survive in-memory export/import and persisted `.astplan` round-trips without invalidating existing modification plans.

### AST-CREATE-002 Workspace binding

The pre-apply workspace fingerprint MUST represent the target as absent. The post-apply fingerprint MUST include the exact created bytes. Any workspace drift or target appearance before apply MUST abort before writes.

### AST-CREATE-003 Atomic no-clobber apply

Creation MUST use an atomic no-clobber filesystem primitive in the target directory. A check-then-rename sequence that can replace a racing target is forbidden. File and containing directory durability MUST follow the existing staged-write/fsync policy.

### AST-CREATE-004 Rollback

If staging, commit or post-write verification fails before the operation reaches a durable applied state, rollback MAY remove the target only after verifying that it is the exact planned postimage and a safe regular file. A changed, linked or replaced target MUST be preserved and reported as a rollback failure rather than deleted.

### AST-CREATE-005 Idempotent recovery

After the exact postimage is durably present, retrying the same reviewed plan hash MUST return an idempotent applied receipt. Receipt-persistence failure after durable source commit MUST retain the verified postimage and be recoverable by retry, matching existing operation semantics. A different existing file at the target MUST be a conflict.

### AST-CREATE-006 Preview

Creation preview MUST be a valid unified diff from `/dev/null` to the project-relative file. Exact per-file preview retrieval MUST work before and after persisted-plan import.

### AST-CREATE-007 Existing operation compatibility

Rename and body replacement plan hashes, imports, applies, rollback behavior and receipts MUST remain compatible with v0.4.0 plans that only modify existing files.

## Batch and persisted plans

### AST-BATCH-SCAFFOLD-001 Final prepare step

`ast_scaffold_class` MUST be accepted as a prepare batch tool, with the same constraints as existing prepare tools: at most one prepare operation, final step only, no foreach and JSON final representation.

### AST-BATCH-SCAFFOLD-002 Persistence

A scaffold operation MUST survive `persistOperationPlan`, process-local operation-store clearing, `applyPersistedOperation` and receipt replay with all hashes and absent-state semantics intact.

## Documentation and compatibility

### AST-DOC-101 Skill workflow

The bundled structural-editing skill MUST teach selector-first search, signature summaries, context-on-demand references and scaffold→preview→apply→targeted-body replacement. It MUST never tell an agent that scaffold preparation writes a file.

### AST-DOC-102 Public docs

README and changelog MUST document new defaults, full/context compatibility modes, scaffold limits, review/apply requirements and benchmark claims with raw measurements.

## Acceptance scenarios

- Exact method query is first despite a lexically earlier substring match.
- Search omits `detail` and returns at most 20 summary records with resolvable selectors.
- Search requests `full`, `limit: 100` and receives the v0.4.0 fields.
- References omit `detail` and return every paginated location without source context.
- References request `context` and preserve bounded source lines.
- TOON round-trips every detail shape.
- Scaffold target exists: preparation fails and bytes are unchanged.
- Scaffold parent is a symlink: preparation fails.
- Scaffold contains duplicate/invalid declarations: preparation fails without disk writes.
- Scaffold adds a type error: plan is blocked unless explicitly allowed.
- Scaffold plan is previewed: diff starts at `/dev/null` and pending method selectors resolve after apply.
- A target appears after preparation: apply fails before replacing it.
- Receipt persistence fails after durable creation: the exact postimage remains and retry persists an idempotent receipt.
- Retried successful scaffold apply returns `idempotent_replay: true`.
- A packed server reports the same version as its packed `package.json`.
