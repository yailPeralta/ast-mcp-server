# Proposal: Safe and Efficient Structural Engine

Status: accepted for implementation

## Intent

Turn ast-mcp-server from a useful structural-editing prototype into a correctness-safe, measurable MCP server whose token-efficiency and refactor-safety claims are enforced by executable tests.

## User outcome

Hermes can inspect and refactor TypeScript/JavaScript projects with less context than full-file workflows without reading stale code, silently selecting the wrong file, applying a different edit than the reviewed preview, or introducing new diagnostics unnoticed.

## Success criteria

1. External file edits are visible on the next tool call.
2. Ambiguous file paths fail with candidate paths.
3. Every write is prepared against a known workspace state and applied only if affected files still match that state.
4. Applied text is byte-for-byte the text returned by the prepared operation.
5. New TypeScript errors block preparation by default; existing diagnostics do not.
6. Rename impact includes the declaration and every changed file.
7. Outlines preserve declaration modifiers, generics, optional markers, and signatures without duplicate syntax.
8. JSON results are emitted once, with output schemas where supported.
9. Large listings and reference sets are relative, filterable, and paginated.
10. Focused, integration, MCP smoke, build, lint, and benchmark gates are automated.

## Chosen approach

Keep ts-morph as the structural engine. Add a synchronized `ProjectSession` boundary for reads and use fresh isolated project instances for prepared writes. Prepared operations produce immutable plans stored in a bounded in-memory registry. A generic apply tool verifies hashes and commits the exact planned content under a per-project write lock.

## Alternatives considered

### Recreate the TypeScript project for every call

- Simpler correctness model.
- Measured initial load on x-scraper: approximately 2.8 seconds.
- Rejected for all reads because repeated outline navigation would become unnecessarily slow.
- Retained for write preparation where correctness is more important than latency.

### Persistent Project without explicit synchronization

- Lowest latency and current implementation shape.
- Rejected because external editor changes are invisible and writes can start from stale source.

### Replace ts-morph with tsserver/LSP

- Mature incremental project synchronization and code actions.
- Higher protocol, process-lifecycle, and transformation complexity.
- Rejected for this release. Reconsider only if project-reference fidelity or measured refresh cost cannot meet the acceptance gates.

### Keep `dry_run=false` as direct apply

- Backward-compatible and simple.
- Rejected as the primary write contract because preview and apply are not causally bound.
- Compatibility path: existing prepare tools remain; direct apply without an operation id fails with an actionable error.

## In scope

- Synchronized project reads and exact path resolution.
- Safe rename and replace-body preparation/application.
- Diagnostic delta validation.
- Correct outline generation.
- Compact, schema-backed and paginated output.
- Symbol search and diagnostics read tools.
- Tests, benchmarks, CI, docs, and packaging hygiene.

## Out of scope

- General signature migration, extract/move, import/member mutations, HTTP/multi-tenant operation, and additional languages.
- Automatic commits or repository history changes.

## Compatibility

- Preserve existing tool names through v0.x.
- Preserve existing input fields where practical.
- Add `operation_id` to prepared write outputs.
- Add `ast_apply_operation` for writes.
- Mark direct `dry_run=false` calls without an operation id as unsupported rather than silently recomputing.
- Document result-shape changes and version the package.

## Rollback

- Code rollout is a normal package rollback to the previous version.
- Each apply operation stores original content until completion and attempts restoration if a staged commit fails.
- Hash mismatches fail without writing.
- The old unsafe direct-write path is not retained as a fallback.
