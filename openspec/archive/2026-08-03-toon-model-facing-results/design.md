# Design: TOON model-facing results

The lasting representation decision is recorded in `docs/adr/0002-toon-at-model-boundary.md`.

## Decision

Keep validated JSON-compatible objects as the only domain and orchestration representation. Add TOON as an opt-in presenter at the final boundary consumed by a model. Do not maintain two simultaneous success representations.

This separates three layers:

1. MCP transport and schemas remain JSON/JSON Schema.
2. Tool handlers, pagination, batch references and mutation plans use canonical objects.
3. Eligible final responses may be presented in a structured TOON envelope.

## Public MCP contract

The three collection-heavy tools gain a shared optional input:

```text
output_format: "json" | "toon" = "json"
```

Eligible tools:

- `ast_search_symbols`
- `ast_find_references`
- `ast_get_diagnostics`

JSON mode returns the existing result unchanged. TOON mode returns:

```text
content: []
structuredContent: { format: "toon", data: <encoded TOON> }
```

It does not return the canonical JSON result or duplicate TOON in text content. Error results continue to use the current `isError: true` text response independently of the requested format.

No format field is added to file listing, outline, source, prepare, preview or apply. Measurements show no material TOON benefit for their current shapes, and mutation outputs should remain maximally explicit and machine-verifiable.

## Result presenter

`src/tools/result.ts` owns the MCP presentation boundary:

- export one shared Zod enum/input fragment for `output_format`;
- accept the tool's existing output schema and candidate logical value;
- parse the value before either presentation path;
- return current structured content for JSON;
- encode, size-check and decode-check one TOON envelope for TOON;
- convert validation/encoding failures through the normal error boundary.

The tool modules remain responsible for constructing domain values. They do not know TOON syntax and do not pre-serialize nested records.

`@toon-format/toon` is pinned at `4.1.0`. Encode/decode functions are wrapped so format-specific behavior has one test seam and a future version migration does not leak through handlers.

## Output schema semantics

The RED integration spike proved that the installed MCP SDK rejects content-only success when `outputSchema` is registered and that its Zod compatibility path does not support the required top-level union. The three eligible tools therefore do not register an MCP output schema. Publishing a permissive schema would misrepresent validation; publishing the canonical schema would reject TOON.

TOON does not weaken internal validation: the Zod output schema is parsed explicitly before encoding rather than relying solely on SDK validation of `structuredContent`. The encoded document is decoded and deep-compared with that value so non-finite numbers and other unsupported representations fail instead of degrading silently.

## Batch behavior

The batch engine continues to call tools through the in-memory MCP transport and requires structured object results.

`parseBatchDocument` rejects a literal `output_format: "toon"` in step input. The runtime invocation boundary repeats the check after `$ref`/`$item` resolution so templates cannot bypass it. Foreach resolves every item once before concurrency starts, then resolves again during execution to avoid retaining up to 200 cloned input payloads. The batch runner may normalize an explicit `json` to the existing default, but it never decodes TOON intermediates.

This preserves:

- RFC 6901 `$ref` traversal;
- `foreach` and `$item` substitution;
- retained-context limits;
- prepare persistence and review coordinates;
- one canonical value for final `emit`.

## CLI final rendering

The public form becomes:

```text
ast-tool run <pipeline.json|-> [--output-format json|toon]
```

The pipeline document remains version 1 and JSON input. Format selection is a command presentation option, not pipeline data.

CLI execution returns a canonical result plus an out-of-band renderer selection to `main`; it does not insert format metadata into the success payload. JSON rendering keeps `JSON.stringify`. TOON rendering encodes the complete final batch result only after successful execution and final-output validation.

A pipeline containing a prepare operation is rejected before execution when TOON output was selected. `validate`, `apply`, `setup`, `install-skill` and all failures remain JSON. This avoids changing persisted-plan review and automation contracts.

The renderer builds the complete string and validates its UTF-8 size before one stdout write, preventing partial success documents.

## Format selection guidance

TOON is explicitly selected, not inferred from character count. Character count is not a reliable token metric, and automatic shape switching makes programmatic behavior unpredictable.

The bundled skill should request TOON when:

- the result is expected to contain several uniform symbol/reference/diagnostic records;
- the result is consumed directly by the model;
- the consumer accepts the explicit `{format,data}` representation.

It should retain JSON for small results, automation, batch intermediates and every write/review flow.

## Limits and failure behavior

- Existing pagination executes before encoding.
- MCP TOON envelope data is bounded to 10 MiB of UTF-8; CLI batch output also remains within `MAX_BATCH_OUTPUT_BYTES`.
- Encoder, round-trip or schema failures produce the existing error path, bounded to 64 KiB of UTF-8.
- No partial TOON is written.
- No TOON payload is logged to stderr.
- Untrusted strings are encoded by the library; no raw-string escape bypass is used.

## Benchmark

Add `scripts/benchmark-formats.mjs` and a checked `benchmark/results/self-formats.json`.

The benchmark corpus includes:

1. broad self-project symbol search;
2. a symbol with multiple references;
3. a deterministic project with multiple diagnostics, including nullable locations and multiline/special-character messages;
4. negative controls for list files, outline, symbol source and prepared rename.

For each logical value:

- validate once;
- compact-serialize with `JSON.stringify`;
- encode and decode TOON;
- assert deep equality;
- count UTF-8 bytes, characters and tokens using a named pinned tokenizer;
- measure repeated encode/decode duration after warm-up;
- report raw values and reductions.

The benchmark compares current serialized `tools/list` characters with the retained v0.3.0 character baseline to expose the net static schema change. It does not derive a historical token estimate without the historical payload and does not claim provider billing or task quality. A future default-format proposal would require same-model/provider A/B tasks and usage data.

## Testing

- Pure presenter tests for JSON parity, TOON round-trip, invalid logical output, special strings and encoded limits.
- MCP in-memory integration for the TOON envelope and unchanged structured mode.
- Batch tests for literal and runtime-resolved TOON rejection before invocation.
- CLI smoke for JSON default, final TOON, deterministic decode, prepare rejection, stderr and exit codes.
- Existing mutation integration unchanged.
- Package smoke proving the pinned encoder ships and runs with lifecycle scripts disabled.
- Benchmark threshold and checked evidence.

## Rollback and evolution

The feature is opt-in. Rolling back code or dependency leaves default JSON contracts untouched. If a TOON library upgrade changes output, update the pin, fixtures, benchmark and ADR in one reviewed change. Making TOON automatic or default requires a separate SDD with client/provider A/B evidence.
