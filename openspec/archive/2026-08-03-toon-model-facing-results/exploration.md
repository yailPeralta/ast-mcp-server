# Exploration: TOON model-facing results

## Problem

The server currently exposes successful tool results exclusively through MCP `structuredContent`. This preserves schemas and machine chaining, but every repeated JSON key is presented to the model when a client serializes the object into context. Broad, uniform result sets such as symbol searches, references and diagnostics therefore spend model input on representation rather than evidence.

The desired outcome is fewer model-facing input tokens without weakening exact selectors, pagination, output validation, batch `$ref` resolution, mutation review, or existing MCP clients.

## Current architecture

- `src/tools/result.ts` returns `{ content: [], structuredContent }` for every successful tool.
- `ast_search_symbols`, `ast_find_references` and `ast_get_diagnostics` return paginated arrays of uniform records plus scalar metadata.
- Every registered tool has a Zod output schema and MCP `outputSchema`.
- `src/batch/runner.ts` requires each step to return a structured object and resolves later `$ref` pointers against it.
- `ast-tool run` writes one JSON value to stdout and retains JSON objects internally.
- Mutation prepare, preview and apply responses contain hashes, diagnostics and multiline diffs whose safety value is not tabular compactness.

## Measured evidence

The official `@toon-format/cli` v4.1.0 was run against actual results from this repository. The numbers are tokenizer estimates for these scenarios, not provider-reported billing.

| Payload                                         | Compact JSON |  TOON | Reduction |
| ----------------------------------------------- | -----------: | ----: | --------: |
| `ast_search_symbols`, query `Batch`, 50 results |        3,199 | 2,244 |     29.9% |
| `ast_find_references`, `runBatchDocument`       |          217 |   172 |     20.7% |
| prepared rename including inline diff           |        2,677 | 2,649 |      1.0% |
| `ast_list_files`                                |          326 |   319 |      2.1% |
| large outline                                   |        1,431 | 1,430 |      0.1% |
| large symbol source                             |        1,335 | 1,332 |      0.2% |

A separate projection experiment reduced the broad search to 852 TOON tokens by retaining only routing fields, but projection changes the information contract and is not part of this change.

TOON is useful here because its tabular array syntax writes field names once. It does not materially improve payloads dominated by one multiline string.

## Protocol constraints

- MCP remains JSON-RPC. Tool arguments and tool schemas remain JSON/JSON Schema.
- MCP permits successful text content without `structuredContent` only when no registered output schema requires structured content. The lockfile-resolved SDK rejects text-only success for a tool with `outputSchema`.
- Returning TOON text and full JSON `structuredContent` together may cause clients to inject both representations into model context. This would increase rather than reduce tokens.
- Returning only TOON from a batch step would break structured `$ref` traversal and persisted prepare handling.
- Some consumers use tool results programmatically and require structured objects. Existing behavior must therefore remain the default.

The RED implementation spike confirmed two additional constraints. The installed SDK rejects content-only TOON when `outputSchema` is present, and its Zod compatibility layer does not accept a top-level union output schema for the canonical object plus TOON. The selected protocol-safe representation is therefore one structured `{format,data}` TOON envelope, with exact internal Zod validation and no MCP `outputSchema` on the three multi-shape tools.

## Options considered

### Replace every result with TOON

Rejected. It breaks programmatic consumers and batch chaining, changes mutation contracts, and produces negligible savings for source, outline and diff-heavy results.

### Return TOON text and structured JSON together

Rejected. It preserves compatibility mechanically but creates a client-dependent duplication risk and cannot support a defensible token-reduction claim.

### Configure one global server output mode

A server flag avoids adding input schema fields, but it forces every client and tool through one representation. It also complicates existing setup registrations and makes mixed machine/model use awkward.

### Per-call opt-in for eligible collection tools

Add an optional `output_format: "json" | "toon"` only to symbol search, references and diagnostics. Keep `json` as the default. TOON success responses contain one `{format:"toon",data:<TOON>}` structured envelope and omit the canonical JSON duplicate; errors keep the existing MCP error shape. Batch steps remain structured and a separate CLI flag may encode only the final read-only batch result.

Chosen because it is explicit, reversible, client-independent and confined to shapes with measured benefit. The added static tool-schema cost must be measured and reported rather than ignored.

### Client-side TOON proxy

Rejected as the primary design. A proxy owns the ideal last-mile boundary but introduces another install, trust and compatibility surface outside this package. Native opt-in support is sufficient and can coexist with proxies.

## Scope

- Pinned TOON runtime encoder.
- Shared validated result presenter.
- MCP opt-in for search, references and diagnostics.
- JSON-only batch intermediates.
- Optional TOON serialization of the final read-only `ast-tool run` output.
- Round-trip, transport, CLI and negative-path tests.
- Reproducible format benchmark including tokenizer, bytes, latency and schema metadata delta.
- README, bundled skill, changelog and architectural decision record.

## Out of scope

- Making TOON the default.
- Replacing MCP JSON-RPC, tool inputs or JSON Schema.
- TOON for source, outline, file lists, mutation prepare/preview/apply or errors.
- Returning JSON and TOON simultaneously.
- Field projection, compact selectors, ranking, grouping or preview compaction.
- Claiming provider-billed savings without provider usage data.
- Automatic format selection based only on serialized character count.
