# Specification: Safe and Efficient Structural Engine

Normative terms MUST, MUST NOT, SHOULD, and MAY are used deliberately.

## Project state

### AST-PROJ-001 Fresh reads

Before a read operation executes, the server MUST make source files changed outside the MCP process visible to the ts-morph project.

Scenario: an editor changes an existing source file after the first outline call. The next outline MUST reflect the new declaration.

### AST-PROJ-002 Project membership

The synchronized project MUST discover newly included files and stop returning deleted files.

Scenario: a new file matching the tsconfig include set is created. A subsequent file listing MUST include it without restarting the MCP server.

### AST-PROJ-003 Bounded sessions

Cached project sessions MUST have bounded cardinality or idle lifetime. Eviction MUST NOT write unsaved content.

### AST-PROJ-004 Serialized project access

Synchronization and structural operations against the same tsconfig MUST be serialized. Independent projects MAY execute concurrently.

## File and symbol identity

### AST-PATH-001 Exact path resolution

Absolute paths and project-relative paths MUST resolve exactly after normalization.

### AST-PATH-002 Ambiguity rejection

A non-exact suffix that matches more than one file MUST fail with all bounded candidate paths. It MUST NOT select a candidate by iteration order.

### AST-SYM-001 Symbol discovery

The server MUST expose bounded symbol search by name, declaration kind, and optional file filter. Results MUST include project-relative file, line, declaration kind, signature, and a reusable symbol path.

### AST-SYM-002 Supported executable declarations

Replace-body preparation MUST support function declarations, methods, constructors, accessors, top-level arrow/function-expression variables, and class-property arrow/function expressions.

Unsupported or ambiguous symbols MUST fail with an actionable error and candidates when available.

## Outlines

### AST-OUT-001 Signature fidelity

Outlines MUST preserve exported/default/abstract/static/access modifiers, async/generator markers, declaration names, generic parameters, parameters, optional/definite markers, return types, extends, and implements where present.

### AST-OUT-002 No bodies or initializers

Outlines MUST omit function bodies and property/variable initializer bodies while retaining enough type information to identify the contract.

### AST-OUT-003 Valid compact representation

Text outlines MUST NOT emit duplicate modifiers or terminators. Representative output MUST parse as declaration-like TypeScript after supported normalization.

### AST-OUT-004 Structured metadata

Outline results MUST include structured symbol metadata and project-relative locations. The human-readable outline MAY be included as one field of that structure.

## Read efficiency

### AST-EFF-001 Single payload

A tool MUST NOT duplicate the same JSON payload in both MCP `content` and `structuredContent`. Schema-backed tools SHOULD return only `structuredContent`.

### AST-EFF-002 Relative paths

Project-owned paths MUST be returned relative to the resolved project root unless an explicit absolute-path option is requested.

### AST-EFF-003 Pagination

Potentially unbounded outputs, including file lists, symbol searches, diagnostics, and references, MUST accept a positive bounded `limit` and cursor/offset and MUST report whether more results exist.

### AST-EFF-004 Deterministic order

Paginated output MUST have deterministic ordering so repeated reads of an unchanged project do not skip or duplicate entries.

## References

### AST-REF-001 Complete impact

Reference and rename impact MUST report the declaration file in `affected_files`, even when the symbol has zero references.

### AST-REF-002 Precise locations

References MUST include relative file, line, column, and bounded context. Counts MUST distinguish references, declarations, and affected files.

### AST-REF-003 Bounded processing

Context extraction SHOULD split each source file at most once per request and MUST bound returned context length.

## Diagnostics

### AST-DIAG-001 Query diagnostics

The server MUST expose project/file diagnostics with code, category, relative file, line, column, and flattened message, using bounded output.

### AST-DIAG-002 Delta semantics

Prepared writes MUST compare diagnostic multisets before and after mutation. Existing diagnostics MUST NOT block an operation merely because their positions shifted. Newly introduced error diagnostics MUST block preparation by default.

### AST-DIAG-003 Explicit override

An override for new diagnostics MAY exist but MUST be explicit in preparation input and visible in the prepared result.

## Prepared operations

### AST-OP-001 Immutable preparation

Rename and replace-body dry runs MUST execute the real structural mutation in an isolated project and return an immutable operation plan with a unique `operation_id`.

### AST-OP-002 Exact preview

The plan MUST contain the exact proposed contents or exact text edits for every changed file. The apply path MUST NOT recompute the mutation from the original arguments.

### AST-OP-003 Workspace binding

The plan MUST record a cryptographic fingerprint covering every project source plus the root, extended, and referenced TypeScript configs, and MUST bind that fingerprint and every exact postimage into a reviewable `plan_hash`. Apply MUST verify the workspace fingerprint, plan hash, and target hashes before replacing any destination.

### AST-OP-004 Bounded plan lifecycle

Plans MUST expire and the plan store MUST be bounded. Applied plans MUST be idempotent: repeating apply returns the recorded result and performs no extra write.

### AST-OP-005 Apply contract

`ast_apply_operation` MUST accept both `operation_id` and `plan_hash`, verify the workspace, stage all outputs, and then replace destination files. A mismatch detected before replacement MUST fail without writing.

### AST-OP-006 Failure recovery

If replacement fails after one or more files changed, the server MUST attempt to restore originals and MUST report whether rollback fully succeeded. Silent partial success is forbidden.

### AST-OP-007 Concurrency

Only one apply operation per project MAY write at a time within one server process. Hash checks MUST detect external changes before staging and immediately before replacement; the server does not claim isolation from external writers after replacement begins.

### AST-OP-008 Direct apply deprecation

Existing write tools invoked with `dry_run=false` MUST fail with instructions to prepare and call `ast_apply_operation` using the returned operation id and plan hash.

## Tool and package quality

### AST-QA-001 Test layers

The project MUST include unit tests for formatters/resolvers, integration tests against temporary projects, write conflict/rollback tests, and an MCP stdio smoke test.

### AST-QA-002 Automated gates

The package MUST expose build, typecheck/lint, test, format-check, and benchmark scripts. CI MUST run deterministic non-mutating gates.

### AST-QA-003 Benchmark

The benchmark MUST report source characters, outline characters, reduction ratio, tool result size, and latency. End-to-end task benchmark methodology MUST distinguish character proxy from actual model tokens.

### AST-DOC-001 Hermes setup

Documentation MUST use the current Hermes CLI workflow (`hermes mcp add`, `hermes mcp test`) and explain prepare/apply, compatibility, limits, and verification.

## Acceptance thresholds

1. Freshness, ambiguity, conflict, invalid-body, and rollback regressions: 100% pass.
2. No prepared operation with default policy introduces a new TypeScript error diagnostic.
3. x-scraper file-list default response: at most 200 entries and explicit continuation metadata.
4. JSON tool results: one semantic payload only.
5. Outline fixture corpus: exact snapshot fidelity for all supported declaration kinds.
6. Existing build remains green; full new test suite and MCP smoke pass.
7. The benchmark reports numbers without claiming token savings from character counts alone.
