# Exploration: Batch CLI orchestration

## Problem

MCP clients normally require one model/tool round-trip per structural operation. Hermes can collapse such pipelines with `execute_code`; Claude Code exposes Bash but current Anthropic programmatic tool calling excludes tools supplied through an MCP connector.

The desired outcome is one Bash invocation that performs a bounded structural pipeline and returns only the projected result, without duplicating AST behavior or weakening reviewed writes.

## Existing constraints

- Ten MCP tools are registered through `createServer()` and already own Zod input/output contracts.
- Read sessions are process-local and benefit from reuse inside one batch.
- Prepared operations and receipts are currently process-local memory.
- `prepare` and `apply` are deliberately separated by `operation_id` plus `plan_hash` review.
- Stdout must remain machine-readable; diagnostics belong on stderr.
- The package currently exposes only `ast-mcp-server`.

## Options considered

### Generate shell/Node code that invokes one CLI operation repeatedly

Minimal server work, but repeatedly loads projects, exposes shell quoting/injection problems, materializes every intermediate result, and offers no stable orchestration contract.

### Refactor every handler into a new command registry

Clean long-term domain boundary, but duplicates or moves ten validated contracts before product value is proven. Migration risk is disproportionate.

### In-process MCP client/server pair

Use the SDK's linked `InMemoryTransport`: the CLI calls the exact registered MCP tools without a subprocess or protocol duplication. Overhead is negligible beside TypeScript project loading and the adapter remains replaceable.

Chosen for v0.3.0.

## Persistent write problem

A one-shot CLI loses the in-memory operation record at exit. Applying in the same batch would avoid that mechanically but would destroy review. The plan must therefore be persisted as an exact, expiring, permission-restricted artifact and applied in a separate command.

## Scope

- Versioned JSON batch schema.
- Ordered steps, `$ref`, bounded `foreach`, `$item`, fail-fast behavior, and final `emit` projection.
- Read tools plus at most one prepare operation; no apply tool in `run`.
- Persist prepared plan automatically; separate `ast-tool apply` command.
- Unit, integration, Bash smoke, benchmark, docs, packaging and CI.

## Out of scope

- Arbitrary JavaScript/eval, branches, while loops or user-defined functions.
- Cross-project pipelines.
- HTTP/daemon mode.
- Globally atomic multi-file writes, automatic stale-lock breaking, or coordination with non-cooperating external writers.
- Automatic `prepare -> apply` chaining.
