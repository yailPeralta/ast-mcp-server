# Specification: Batch CLI orchestration

## Batch contract

### AST-BATCH-001 Versioned input

`ast-tool run` MUST accept a schema-versioned JSON document from a file or stdin, reject unknown schema versions, duplicate step ids and malformed templates before executing any step.

### AST-BATCH-002 Existing tool parity

Every step MUST call the existing registered MCP tool through an in-process MCP transport. The CLI MUST NOT duplicate AST implementations or bypass their schemas.

### AST-BATCH-003 Project ownership

A pipeline MUST declare one `project_root`. The runner MUST inject it into project tools and MUST reject a conflicting per-step root.

### AST-BATCH-004 References

A template object containing only `$ref` MUST resolve an RFC 6901 JSON Pointer rooted at prior step outputs. Forward, missing and malformed references MUST fail with the consuming step id.

### AST-BATCH-005 Foreach

A step MAY expand over a referenced array with `$item` substitutions. Expansion MUST preserve source order, enforce a global invocation cap and use bounded concurrency only for read-only tools.

### AST-BATCH-006 Projection

Only the resolved `emit` template, final status and bounded execution metadata MUST be written to stdout. If `emit` is omitted, only the final step output is returned. Intermediate outputs remain internal. A persisted prepare is the sole exception: top-level `operation_id`, `plan_hash`, and `plan_file` MUST remain visible even when `emit` omits them.

### AST-BATCH-007 Failure semantics

Execution MUST be fail-fast. Tool errors, invalid structured results and limit violations MUST produce a structured error with step id, write no success JSON, and exit non-zero.

### AST-BATCH-008 Tool policy

`ast_apply_operation` and `ast_get_operation_preview` MUST NOT be callable through arbitrary batch steps. At most one prepare tool MAY run, it MAY NOT run inside `foreach`, and no ordinary step may follow it.

## Persisted plans

### AST-PLAN-001 Automatic persistence

A successful CLI prepare MUST atomically persist the exact retained operation record and augment its CLI result with top-level `operation_id`, `plan_hash`, and an absolute `plan_file` path.

### AST-PLAN-002 Private bounded artifact

Plan directories MUST be mode `0700`, plan files mode `0600`, files size-bounded, schema-versioned and rejected after their embedded expiry.

### AST-PLAN-003 Integrity

Loading a plan MUST require the reviewed 64-character `plan_hash`, validate every serialized byte hash and relative contained path, and reject mismatch before writes.

### AST-PLAN-004 Separate apply

Only `ast-tool apply <plan-file> --plan-hash <hash>` MAY apply a persisted plan. It MUST load the exact plan, invoke the existing apply service, and atomically persist an applied receipt before releasing the same cooperative workspace lock used by MCP apply.

### AST-PLAN-005 Retry boundary

A persisted applied receipt MUST return an idempotent replay even after the preparation TTL. If sources were replaced but receipt persistence failed, apply MUST exit non-zero and a retry MAY recover the receipt only when the complete workspace exactly matches the reviewed post-workspace fingerprint. Partial or divergent state MUST fail closed and MUST NOT recompute or blindly write.

## Operational quality

### AST-CLI-001 Machine contract

Success output MUST be one JSON value on stdout. Logs and errors MUST use stderr. Exit code 0 means success, 1 execution failure and 2 usage/schema failure.

### AST-CLI-002 Limits

Defaults MUST cap document bytes, steps, total tool invocations, foreach items, each retained result, cumulative retained context, and serialized output. Exceeding a cap MUST fail explicitly.

### AST-CLI-003 Packaging

The package MUST expose `ast-tool`, include CLI modules in `dist`, document Claude Code/Hermes usage and exercise the installed-style bin in smoke tests.

### AST-CLI-004 Benchmark

A reproducible benchmark MUST compare separate client calls with one batch for model round-trips, wall time and final serialized characters without claiming token savings.

## Acceptance

- Unit and integration suites pass.
- One Bash call performs search -> source and list -> outline pipelines.
- Prepare and later apply succeed across separate Node processes.
- Same-batch apply and prepare/apply chaining are impossible.
- Wrong hash, stale workspace, expired/corrupt/oversized plan and invalid refs write nothing.
- MCP and CLI apply contend on one canonical workspace lock; exact complete postimages recover a missing receipt while partial state fails closed.
- Existing 10-tool MCP smoke remains green.
