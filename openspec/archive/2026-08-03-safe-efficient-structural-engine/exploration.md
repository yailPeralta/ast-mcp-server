# Exploration: Safe and Efficient Structural Engine

Date: 2026-08-03
Status: complete

## Problem

The prototype proves that AST-shaped reads can reduce source payloads substantially, but its current write path does not yet provide the freshness, preview fidelity, concurrency, or validation guarantees advertised by the product.

## Current architecture

- `src/services/project.ts` owns a process-global `Map<string, Project>` cache.
- `src/services/outline.ts` formats declarations manually.
- Six MCP tools are registered from `src/index.ts`.
- Read tools query the cached ts-morph project directly.
- Write tools mutate that same project and call `project.save()`.
- `dry_run` is an argument on each write tool; no durable reviewed operation exists.

## Verified evidence

### Value hypothesis

Measured character counts using the current outline implementation:

| Repository     | Files | Full source chars | Outline chars | Reduction | Ratio |
| -------------- | ----: | ----------------: | ------------: | --------: | ----: |
| ast-mcp-server |     9 |            22,294 |         1,279 |     94.3% | 17.4x |
| x-scraper      | 1,419 |        12,238,375 |     1,120,094 |     90.8% | 10.9x |

This validates payload potential, not end-to-end token savings. Tool schemas, round trips, duplicated result fields, and orientation payloads still need measurement.

### Freshness defect

After loading a fixture project through MCP, an external edit replaced `first` with `changed`. A subsequent outline still returned `first`; `changed` could not be resolved. `getProject()` never refreshes cached source files.

Risk: stale reads and stale structural writes. A later write may be based on content that no longer matches disk.

### Path ambiguity

With `src/a/index.ts` and `src/b/index.ts`, requesting `index.ts` silently selected one because `getSourceFileOrThrow()` falls back to suffix matching.

### Preview and validation defects

- `ast_replace_symbol_body` returned an invalid preview containing `return (value * 2;`.
- No syntactic or semantic diagnostics are computed.
- A dry-run rename with zero references returned `would_affect_files: []`, omitting the declaration file.
- Preview and apply are separate recomputations with no workspace-version binding.

### Outline fidelity defects

Observed output:

- `export async async function first(...);;`
- `class Box<T>` became `class Box`.
- `map<U>(...)` lost `<U>`.

The formatter duplicates modifiers/terminators and loses declaration information.

### Payload defects

- `ast_list_files` returned 152,662 characters for x-scraper.
- Absolute paths are always emitted despite documentation claiming relative paths when possible.
- Relative compact paths alone reduce that sample by 42.8%, but pagination is still required.
- Most tools return the same JSON in both `content` and `structuredContent`.
- Hermes combines both fields, producing 394 characters instead of 171 in a small measured sample: 130.4% overhead.

### Quality baseline

- `npm run build`: PASS.
- `npm audit`: 0 vulnerabilities.
- `hermes mcp test ast`: PASS, six tools discovered.
- No project tests, lint script, CI workflow, or Git metadata exist.

## Constraints

- TypeScript/JavaScript projects resolved from `tsconfig.json` remain the supported domain.
- The server stays local stdio-first and generic across repositories.
- Existing repositories may already contain TypeScript diagnostics; validation must compare diagnostic deltas.
- Reads must remain materially cheaper than full-file reads.
- Write correctness wins over latency; read latency remains a product metric.
- Existing MCP tool names remain compatible during the v0.x migration.
- No operation may require the model to resend complete files.

## Scope boundaries

Included:

- Project freshness, path identity, bounded cache lifecycle, and serialization.
- Exact prepare/apply operations with hashes, diagnostics, and rollback attempts.
- Rename and replace-body migration to the safe operation model.
- Correct compact outlines, symbol search, diagnostics query, pagination, and compact outputs.
- Tests, benchmark harness, CI, package hygiene, and Hermes documentation.

Deferred until the safety and benchmark gates pass:

- General change-signature rewriting.
- Extract/move symbol refactors.
- Import/member mutation tools.
- HTTP transport and multi-user authorization.
- Non-TypeScript language backends.

These are separate mutation families with materially different correctness rules; adding them before the common write protocol is proven would enlarge the unsafe surface.

## Main risks

1. Full diagnostics can be slow on large projects.
2. Files can change between preparation and application.
3. Multi-file filesystem replacement is not globally atomic.
4. TypeScript project references and generated files may expose refresh edge cases.
5. More MCP tools can erase token savings through schema overhead.
6. Existing clients may depend on current text-shaped results.

## Exit from exploration

Proceed with a staged v0.x compatibility-preserving implementation. Safety gates land before new mutation families. Each implementation slice follows RED -> GREEN -> VERIFY.
