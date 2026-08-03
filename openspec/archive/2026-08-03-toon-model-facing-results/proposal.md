# Proposal: TOON model-facing results

## Outcome

Ship v0.4.0 with an opt-in TOON representation for collection-heavy read results. Keep validated JSON objects as the canonical internal and default MCP representation, preserve batch chaining, and encode TOON only at a model-facing final boundary.

## Success criteria

1. Existing calls without `output_format` return the same `structuredContent` contracts and empty text content.
2. `ast_search_symbols`, `ast_find_references` and `ast_get_diagnostics` accept `output_format: "toon"` and return one structured `{format,data}` TOON envelope without a duplicate canonical JSON result.
3. The logical value decoded from TOON exactly equals the value validated by the existing Zod output schema.
4. Errors remain bounded MCP error text and never masquerade as successful TOON.
5. Batch intermediates always remain structured JSON; static and dynamically resolved attempts to request TOON inside a step fail before the affected tool invocation.
6. `ast-tool run ... --output-format toon` serializes only the final success value and is rejected for any pipeline containing a prepare operation. JSON remains the CLI default and the only apply/validate/error format.
7. A checked benchmark reports compact JSON versus TOON tokens, bytes and encoding/decoding time for positive and negative shapes, plus the `tools/list` metadata delta.
8. The broad self-project symbol-search scenario retains all fields and reduces tokenizer-estimated input tokens by at least 20% versus compact JSON.
9. Unit, integration, stdio, CLI, package and existing full-suite gates pass.

## Compatibility

- Keep all ten MCP tool names.
- Keep default response shapes. Retain exact internal Zod output validation, but remove the incompatible single-shape MCP `outputSchema` from the three multi-shape tools.
- Add one optional input field to three read tools and one optional CLI flag.
- Keep the batch document schema at version 1 because the pipeline document contract does not change; TOON is a CLI presentation option.
- Pin `@toon-format/toon` at `4.1.0` because model-facing serialization is a public behavior.
- Treat this as a v0.x minor release: it adds public opt-in contracts without removing existing ones.

## Risks

- A host may render the structured TOON envelope differently from canonical structured content: cover the SDK and stdio paths and document tested consumers.
- TOON is not universally smaller: expose it only where measured and retain negative controls in the benchmark.
- Adding `output_format` increases three input schemas while removing three incompatible output schemas: record the exact net serialized metadata delta rather than assuming its direction.
- Encoding after schema validation could still exceed output limits: apply byte limits to the final encoded text before writing it.
- Delimiters, newlines and prompt-like source text can stress escaping: require lossless adversarial round-trip tests.
- A future TOON version may change encoding: pin the runtime dependency and record the format/library version in benchmark evidence.
