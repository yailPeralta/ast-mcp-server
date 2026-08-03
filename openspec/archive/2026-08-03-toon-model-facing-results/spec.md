# Specification: TOON model-facing results

## Canonical result contract

### AST-FORMAT-001 Canonical logical value

Every successful tool MUST construct and validate the same JSON-compatible logical value against its existing Zod output schema before presentation. Output format MUST NOT change fields, ordering, pagination, selectors, counts, diagnostics or durations.

### AST-FORMAT-002 Default compatibility

If `output_format` is absent or equals `json`, the tool MUST return the current MCP shape: empty `content` and the validated object in `structuredContent`.

### AST-FORMAT-003 TOON success representation

If an eligible tool receives `output_format: "toon"`, it MUST encode the validated logical value with the pinned TOON implementation and return `structuredContent` shaped exactly as `{ "format": "toon", "data": "<TOON document>" }` with empty `content`. It MUST NOT include the canonical JSON result or duplicate TOON text.

### AST-FORMAT-004 Eligible tools

Only `ast_search_symbols`, `ast_find_references` and `ast_get_diagnostics` MAY accept `output_format`. The accepted values MUST be the closed enum `json | toon`, defaulting to `json`. Other tools MUST retain their existing inputs and outputs.

### AST-FORMAT-005 Validation and encoding failure

Invalid output data, unsupported values, encoder failures or encoded-size violations MUST return the existing MCP error shape with `isError: true`. A failed call MUST NOT include partial TOON or successful `structuredContent`.

### AST-FORMAT-006 Lossless encoding

For every successful TOON result, decoding emitted TOON with the pinned decoder MUST deep-equal the validated canonical value. Values such as non-finite numbers that pass a domain schema but cannot round-trip through TOON MUST fail before success is returned. Tests MUST include empty arrays, nullable diagnostic locations, booleans, numbers, Unicode, delimiters, quotes, multiline strings and prompt-like text.

### AST-FORMAT-007 Bounded output

TOON encoding MUST be performed only after existing pagination. The MCP envelope's TOON `data` MUST be limited to 10 MiB of UTF-8; final CLI TOON MUST remain within the existing `MAX_BATCH_OUTPUT_BYTES` limit. The complete encoded value MUST be checked before it is returned or written. Limit failures MUST be explicit and non-partial. MCP error text MUST remain bounded to 64 KiB of UTF-8.

## Batch invariants

### AST-BATCH-FORMAT-001 Structured intermediates

Every `ast-tool run` step MUST retain a structured JSON object so `$ref`, `$item`, limits, persistence and final projection continue to operate on canonical values.

### AST-BATCH-FORMAT-002 Reject step-level TOON

A batch document containing a statically visible `output_format: "toon"` in a step MUST fail validation. If template resolution introduces that value at runtime, the step MUST fail before invoking the tool. Every input in one foreach expansion MUST be preflighted before any sibling invocation begins. `output_format: "json"` MAY be accepted but MUST NOT alter the retained value.

### AST-BATCH-FORMAT-003 Final CLI representation

`ast-tool run <pipeline.json|-> --output-format toon` MUST encode only the complete final success value after execution and projection. The default MUST remain one compact JSON value. The TOON path MUST write one complete TOON document plus a trailing newline to stdout.

### AST-BATCH-FORMAT-004 Mutation boundary

`--output-format toon` MUST be rejected before execution when a batch contains a prepare tool. `ast-tool validate`, `ast-tool apply`, setup, skill installation and every CLI error MUST remain JSON.

### AST-BATCH-FORMAT-005 CLI failure semantics

TOON encoding failure or final-size overflow MUST write no success payload, emit the existing structured error on stderr, and exit non-zero. No partial TOON document may reach stdout.

## Compatibility and schema surface

### AST-COMPAT-001 Tool identity

The server MUST continue to expose the same ten tool names and annotations. Single-shape tools MUST retain their output schemas. The three eligible multi-shape tools MUST validate the canonical result internally and MUST NOT publish a misleading single-shape MCP output schema.

### AST-COMPAT-002 Multi-shape compatibility

Integration tests using the lockfile-resolved MCP SDK and stdio transport MUST prove that eligible tools return canonical structured content by default and a decodable structured TOON envelope when explicitly requested. The suite MUST preserve the RED evidence that registered canonical output schemas make the envelope invalid.

### AST-COMPAT-003 Metadata accounting

The implementation MUST record the serialized `tools/list` character size against the checked v0.3.0 baseline. Documentation MUST distinguish this recurring static surface from dynamic tokenizer-estimated result savings and from provider-billed cost; it MUST NOT invent a historical token count when the baseline payload was not retained.

### AST-COMPAT-004 Versioned dependency

The runtime dependency MUST be pinned as `@toon-format/toon` version `4.1.0` in `package.json` and `yarn.lock`. Dependency lifecycle scripts remain disabled by repository policy, and package/audit gates MUST include the dependency.

## Measurement

### AST-MEASURE-001 Reproducible corpus

A checked benchmark MUST compare compact JSON and TOON for actual or deterministic outputs representing broad symbol search, references and non-empty diagnostics. It MUST also include source, outline, file-list and prepared-operation negative controls.

### AST-MEASURE-002 Reported units

For each fixture the benchmark MUST report raw compact-JSON and TOON bytes, characters, tokenizer-specific tokens, encode/decode duration, round-trip status, library version and tokenizer identity. Percentages MUST include their raw values.

### AST-MEASURE-003 Acceptance threshold

The broad self-project symbol-search fixture MUST preserve all logical fields and reduce tokenizer-estimated tokens by at least 20% versus compact JSON. Every fixture MUST pass round-trip equality. No universal savings claim may be derived from one fixture.

### AST-MEASURE-004 Claims boundary

Repository docs MAY claim scenario-specific serialized/tokenizer savings. They MUST NOT claim reduced provider billing, cached-input cost or end-to-end task cost without a same-workload provider A/B that records reported usage and task correctness.

## Documentation

### AST-DOC-001 Usage guidance

README and the bundled structural-editing skill MUST explain:

- JSON remains canonical and default;
- when to request TOON for broad collection results;
- why source, outline and mutation responses remain structured/textual;
- why batch steps cannot request TOON;
- how to request TOON only for final read-only CLI output;
- how to fall back to JSON for programmatic consumers.

## Acceptance scenarios

- Existing MCP client omits `output_format`: response is unchanged structured JSON.
- Model-facing client requests TOON for 50 symbol matches: one decodable `{format,data}` envelope is returned with no duplicate canonical JSON.
- Client requests TOON for empty diagnostics: the empty canonical value round-trips.
- Special characters occur in a diagnostic message or reference context: decoded value is exact.
- Batch step explicitly requests TOON: document validation fails before project loading.
- `$ref` resolves an input object containing TOON format: runtime guard fails before the consuming invocation.
- Read-only batch requests final TOON: intermediate `$ref` traversal succeeds and stdout contains one TOON document.
- Prepare batch requests final TOON: command fails before execution and no plan is persisted.
- Encoder throws or output exceeds its limit: no partial stdout/success response is emitted.
- Existing prepare, preview and apply flows remain byte-contract compatible and pass unchanged tests.
