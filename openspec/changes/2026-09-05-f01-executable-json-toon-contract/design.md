# Design: Executable JSON/TOON Contract

## Technical Approach

Add `scripts/json-toon-contract.mjs` and `test/json-toon-contract-admission.test.ts`, admitted by `yarn test:mcp-formats`. It launches built `dist/index.js` through the established MCP `Client`/`StdioClientTransport` pattern and one deterministic workspace. Its closed manifest drives every check; production stays untouched absent a witnessed mismatch.

## Architecture Decisions

| Decision                                                                                                                           | Alternatives                                  | Rationale                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Real stdio process, built server, sequential JSON-then-TOON calls                                                                  | Formatting-unit or in-memory-only assertions  | Exercises `createServer` registration, SDK schemas, transport, handlers, and presentation without copying production fixtures. |
| One frozen eight-case manifest and admission validator                                                                             | Ad hoc calls or separate drifting inventories | Exact tool/case/check cardinality fails closed and keeps one reviewable ≤400-line unit.                                        |
| Recursive normalization replaces values only at keys `duration_ms` and `checked_at`                                                | Raw comparison or wildcard omission           | Sequential telemetry varies; a closed key allowlist preserves every semantic key, value, null, and omission.                   |
| Canonical bytes recursively sort object keys, preserve array order, then UTF-8 encode `JSON.stringify`; SHA-256 hashes those bytes | Snapshot text                                 | Stable evidence is platform-independent and sensitive to all normalized semantics.                                             |

## Oracle Flow

```text
package command → build → manifest admission → isolated workspace/runtime
  → Client → StdioClientTransport → dist/index.js → tools/list
  → each case: JSON call; TOON call → envelope/schema checks → decode
  → closed normalization → stable bytes/hash/equality → cleanup
```

The oracle owns client, transport child, project, `HOME`, and `XDG_CACHE_HOME`. One `try/finally` closes the client before removing both roots. It deletes persistence overrides and fixes fixture bytes, paths, limits, order, and sequential execution.

## Exact Case Matrix

| Tool                  | Case 1                                                             | Case 2                                                   |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `ast_search_symbols`  | full Unicode paginated page (`limit:1`)                            | no-match empty page                                      |
| `ast_find_references` | Unicode/multiline context page, declarations/boolean               | offset-past-total empty page, `has_more:false`           |
| `ast_get_impact`      | `max_nodes:1` bounded/truncated graph                              | depth-zero root, empty kinds, nullable truncation reason |
| `ast_get_diagnostics` | error page with aggregates, finite signed code, nullable locations | clean-file empty page with omitted aggregates            |

Together the pairs cover empty, paginated, bounded/truncated, Unicode, null, omitted optional, finite numeric, boolean, and aggregate shapes.

## Contracts and Failure Taxonomy

JSON requires success, `content: []`, and object `structuredContent` matching a closed per-tool key/type inventory. TOON requires exactly keys `format`/`data`, pinned decoding, and normalized equality. `tools/list` must match the four-tool manifest; only eligible schemas expose `output_format` enum `["json","toon"]`, default `json`, and no `outputSchema`; unsupported tools omit `output_format`.

Failure classes are `admission`, `schema-inventory`, `transport/process`, `json-shape`, `toon-envelope/decode`, `semantic-mismatch`, `determinism`, and `cleanup`. Any exits nonzero with bounded identifiers/hashes, never temporary paths.

## RED, GREEN, and Anti-Cheating

Truthful RED is the absent command/oracle/manifest, not fabricated runtime failure. Admission tests require all three, then mutate the manifest to prove rejection of missing/duplicate/extra tools, fewer than two cases per tool, duplicate IDs, absent order/envelope/schema/normalization/hash/cleanup checks, and any extra normalization key. GREEN adds only the admitted oracle, test, command, and CI line. Production edits require a captured failing case and smallest correction; otherwise SCN-011/012 prohibit them.

## Trace Matrix

| Requirement | Scenarios | Design evidence                                     |
| ----------- | --------- | --------------------------------------------------- |
| REQ-001     | 001–002   | Manifest/tools-list exactness and schema omission   |
| REQ-002     | 003–004   | Sequential pair runner and mutation admission tests |
| REQ-003     | 005–006   | JSON inventory, empty content, TOON decode/equality |
| REQ-004     | 007       | Two identical oracle passes compare bytes/hashes    |
| REQ-005     | 008–010   | Eight-case shape matrix                             |
| REQ-006     | 011–012   | No-production-diff and scope gates                  |

## Threat Matrix

| Boundary                 | Applicability                                        | Safe/failure behavior and RED |
| ------------------------ | ---------------------------------------------------- | ----------------------------- |
| Documentation-like paths | N/A — fixed Node entry, no executable classification | None                          |
| Git repository selection | N/A — no Git invocation                              | None                          |
| Commit state             | N/A — no commit/index behavior                       | None                          |
| Push state               | N/A — no network/push behavior                       | None                          |
| PR commands              | N/A — no PR composition                              | None                          |

Process integration remains applicable: the fixed executable/argv, isolated environment, sequential ownership, close-before-remove cleanup, nonzero child exit, timeout, and leaked-child cleanup are admission/runtime assertions.

## File Changes, CI, Compatibility, Rollback

| File                                        | Action                       | Forecast |
| ------------------------------------------- | ---------------------------- | -------: |
| `scripts/json-toon-contract.mjs`            | Create oracle/manifest       |  210–270 |
| `test/json-toon-contract-admission.test.ts` | Create anti-cheating gate    |    55–80 |
| `package.json`                              | Add `test:mcp-formats`       |      1–3 |
| `.github/workflows/ci.yml`                  | Run command after `test:mcp` |        1 |

Forecast: 267–354 authored lines, one low-risk unit, no chain. Errors, limits, schemas, JSON defaults, and package contents remain compatible. Harness is excluded. Rollback removes both files and command lines. Verification runs the command twice, focused presenter/catalog/MCP tests, format, lint, typecheck, build, and CI-equivalent checks.

## Open Questions

None.
