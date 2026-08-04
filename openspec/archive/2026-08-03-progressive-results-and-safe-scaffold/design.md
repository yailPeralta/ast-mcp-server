# Design: progressive results and safe class scaffolding

## Decision summary

This change introduces progressive disclosure before serialization and extends the existing mutation transaction to one safe creation primitive. It does not create an alternate write path.

The lasting decisions will be recorded in two ADRs after implementation evidence:

- progressive result shaping and relevance-ranked search;
- hash-bound no-clobber source creation.

## Version identity

`src/server.ts` imports the root package metadata through TypeScript's JSON-module support and passes that version to `McpServer`. The packed stdio smoke reads the installed package metadata and inspects the initialize result exposed by the SDK client. This removes the second release-version source.

## Search ranking

`src/services/symbols.ts` owns a pure rank tuple. Filtering remains case-insensitive substring matching over declaration name and symbol path. For each admitted declaration, construct its exact selector and compare the normalized query in this order:

1. selector equality;
2. symbol-path equality;
3. name equality;
4. symbol-path/name prefix;
5. substring.

The final comparator appends normalized project-relative file, start line, symbol path and kind. Pagination occurs only after this order is complete.

Ranking belongs in the service rather than the MCP tool so unit tests and future batch/CLI callers observe one semantic order.

## Search result profiles

`ast_search_symbols` adds a Zod `detail` enum. The service still returns complete internal `SymbolMatch` values; the tool projects a paginated page through one pure presenter:

- selectors: routing coordinates only;
- summary: routing coordinates plus body-free signature;
- full: existing record mapping.

The result includes the existing pagination metadata. It does not duplicate hidden full records. The default search input uses a tool-specific limit schema with default 20; other collection defaults remain unchanged.

Because search already supports JSON/TOON output shapes and therefore omits MCP `outputSchema`, each profile is parsed against its exact internal Zod schema before `formattedResult` presents it. JSON and TOON share that parsed value.

## Reference result profiles

The reference service continues to compute context and the complete affected-file set so semantic behavior remains centralized. The tool maps the paginated records to:

- locations: omit only `context`;
- context: current record unchanged.

If profiling later shows context extraction itself is expensive, a separate change may make it lazy. This change claims model-facing reduction only.

Flat pagination is retained. Grouping by file is intentionally deferred because its incremental measured benefit is small and it complicates offset semantics.

## Defaults and compatibility

The new defaults intentionally favor model navigation:

- search summary, limit 20;
- reference locations.

Pre-1.0 clients that require the previous values can explicitly request search full/100 and reference context. README and changelog call this out as a v0.x contract evolution.

JSON remains the default representation. The bundled skill requests TOON only for collection results large enough to benefit.

## Workflow benchmark

Add a checked benchmark dedicated to result shaping rather than extending format-only claims ambiguously.

The corpus uses deterministic fixtures and self-project symbols with declared evidence:

- exact name and path where a lower-ranked lexical substring exists;
- prefix query with expected direct selector;
- broad query with expected selectors inside the first 20 ranked results;
- multi-file references with declaration and usage coordinates.

For baseline and candidate calls, record:

- logical evidence pass/fail;
- calls needed to obtain declared evidence;
- JSON and TOON chars, bytes and `gpt-tokenizer` tokens;
- aggregate dynamic totals;
- full serialized `tools/list` chars/tokens.

The benchmark exits non-zero on evidence loss, extra required calls or less than 35% aggregate candidate TOON savings. Timing remains informative rather than a hard gate.

## Scaffold input model

The public tool keeps the structured intent from the supplied draft because it provides a stable declaration contract and avoids accepting arbitrary whole-file source. Every nested object is strict and bounded.

A dedicated `src/services/scaffold.ts` module owns:

- semantic identifier/duplicate validation;
- conversion from validated input to ts-morph structures;
- in-memory source creation;
- AST-shape verification;
- outline and pending-method extraction.

The tool layer owns only Zod input/output schemas and result formatting. `src/services/operations.ts` owns transaction integration.

The initial class is exported and named. Method overloads and duplicate names are rejected so every pending path is directly resolvable. Generated methods have only the deterministic throw body. A constructor has an empty body; parameter properties carry their requested scope/readonly semantics.

Properties without initializers use an explicit definite-assignment token only when the input model requests it; silent automatic weakening is not allowed. If the final implementation omits that input, initializer-less properties are rejected.

## Prepare integration

Add `prepareScaffoldClass` as a thin operation-service entry point. It invokes the same internal `createPlan` transaction used by existing operations, with a mutation callback that adds one source file to the in-memory ts-morph project and returns zero references.

`createPlan` is generalized to observe both modified existing files and one newly added file. Existing files retain byte-for-byte behavior.

The scaffold service captures outline/pending metadata from the in-memory file and returns it beside the standard prepared operation. The exact source bytes, not that derived metadata, are authoritative and plan-hashed.

## Representing absence

Use a domain-separated absent-file sentinel in the existing 64-character `original_hash` field and retain zero original bytes. This distinguishes absence from SHA-256(empty) without adding a required field that would invalidate old strict persisted-plan schemas or old plan hashes.

Internal helpers must use an explicit `isAbsentOriginal` predicate; code must not infer absence from empty bytes. Existing files cannot be assigned the sentinel during normal hashing.

The plan hash already commits to each file's original hash, updated hash, path and mode, so the sentinel binds creation intent. Existing modification plan hashes remain byte-compatible because their serialized hash material does not change.

## Safe target resolution

Preparation resolves the canonical project root, rejects absolute/traversing file paths, validates `.ts`/`.tsx`, and requires an existing canonical parent directory under the project root. The target must fail `lstat` with `ENOENT`; any other result/error aborts.

On POSIX, parent ownership is required. Canonical parent equality rejects symbolic directory traversal. The operation stores only a normalized project-relative path and reconstructs the absolute target under the verified root.

## Workspace snapshots

The preimage workspace snapshot contains normal config/source files and no target. Postimage construction adds the target path and updated hash explicitly before computing the post workspace digest. Recovery snapshots use operation-aware augmentation so the planned target participates even if project discovery behavior differs.

Before staging any write, apply validates:

- operation/plan hash and expiry;
- current workspace digest equals the preimage, or exact postimage recovery applies;
- existing-file hashes and metadata match;
- absent targets remain absent and their parents remain safe.

## Atomic creation and rollback

Existing-file writes keep staged same-directory temp files and atomic rename.

For a new file:

1. stage exact bytes with exclusive create in the target directory;
2. fsync and chmod the staged inode;
3. atomically hard-link the staged inode to the absent target (`link`), which fails with `EEXIST` rather than replacing a racer;
4. unlink the staging name;
5. fsync the containing directory.

Platforms without safe same-filesystem no-clobber semantics must fail explicitly rather than fall back to overwrite-capable rename.

Rollback for a created target before durable operation completion:

1. revalidate safe path metadata;
2. hash the current target and require the planned updated hash;
3. unlink it;
4. fsync the directory.

If bytes or metadata changed, rollback reports failure and preserves the file. Existing-file rollback remains unchanged.

Receipt persistence occurs after verified source commit and applied-state transition, as it does for existing operations. A receipt failure retains the exact postimage and reports a recoverable error; retry with the same plan hash verifies the postimage and persists an idempotent receipt.

## Diff and preview

Creation uses a unified diff from `/dev/null` to the project-relative target. The normal inline preview threshold and `ast_get_operation_preview` exact retrieval remain unchanged.

## Persisted plans and batch

The existing persisted schema can retain the absent sentinel and empty original bytes without a schema-version bump. Import validation branches on the sentinel:

- existing preimages validate decoded original bytes and safe current files;
- absent preimages require empty original bytes and a safe absent target.

`ast_scaffold_class` joins `PREPARE_BATCH_TOOLS`; therefore existing rules automatically enforce one final non-foreach prepare step and JSON mutation output. The batch runner persists its operation ID through the same callback.

## Tool metadata

Descriptions remain concise and refer to README/skill for examples. The rich nested input schema is unavoidable for a structured scaffold, so the benchmark records its recurring cost. No token-savings claim for scaffold is made from output-size arithmetic alone.

## Testing strategy

### Ranking and shaping

- Pure rank tests for exact/path/name/prefix/substring and deterministic ties.
- Integration tests for default and explicit detail shapes.
- Exact selector chaining into source/reference tools.
- TOON round-trip for every profile.
- Batch JSON intermediates with detail inputs.

### Scaffold construction

- Pure service tests for imports, decorators, heritage, constructor parameter properties, properties, async/access methods, exact placeholders, outline and pending paths.
- Strict/bounded schema tests and invalid/duplicate fragment rejection.
- New diagnostic blocking and explicit override.

### Filesystem transaction

- No prepare-time write.
- Existing target, traversal and symlink-parent rejection.
- Target-appeared race rejection.
- Exact creation apply and source discovery.
- Persist/import/apply and receipt replay.
- Receipt failure rollback deletes exact postimage.
- Changed postimage rollback preserves it and reports failure.
- Existing rename/replace operation regression tests.

### Packaging

- In-memory and stdio tool count/schema checks.
- Packed server handshake version equality.
- Packed skill/docs/tool execution with lifecycle scripts disabled.

## Release posture

The target is v0.5.0 because defaults change and a public prepare tool is added. Release is outside apply unless explicitly requested; the implementation must still leave package metadata, changelog and tarball gates release-ready.
