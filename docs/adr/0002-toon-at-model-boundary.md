# ADR 0002: Use TOON only at the model-facing result boundary

- Status: Accepted
- Date: 2026-08-03

## Context

The MCP server returns validated JSON-compatible objects through `structuredContent`. This is correct for schemas, clients and batch `$ref` traversal, but uniform collections repeat property names when a host serializes them into model context.

The v0.4.0 decision measurements with TOON v4.1.0 and `gpt-tokenizer` `o200k_base` showed MCP-envelope reductions of 25.72% for a 100-row symbol search, 30.33% for references, and 21.01% for diagnostics. File lists, outlines, source, and prepare outputs became 5.50% to 23.40% worse. TOON therefore has value for particular result shapes, not as a universal protocol replacement. Current release measurements live in `benchmark/results/self-formats.json`.

The implementation spike also established an SDK constraint: when a tool registers `outputSchema`, the lockfile-resolved MCP SDK requires successful calls to provide matching `structuredContent`. A top-level union schema is not accepted by the installed Zod compatibility path. Text-only TOON with the existing output schema is therefore not a valid contract.

The decision must preserve:

- MCP JSON-RPC and JSON Schema compatibility;
- current behavior for existing clients;
- exact canonical Zod validation before presentation;
- structured batch intermediates and mutation review;
- one representation in model context rather than duplicated JSON plus TOON.

## Decision

Keep JSON-compatible objects as the canonical internal representation and default MCP output.

Add an explicit `output_format: "json" | "toon"` option, defaulting to `json`, only to collection-heavy read tools with measured or fixture-backed benefit:

- symbol search;
- semantic references;
- diagnostics.

Before presentation, validate the canonical value against the existing Zod output schema. JSON mode returns the existing canonical `structuredContent`. TOON mode encodes, decodes and deep-compares the value before returning one structured envelope `{ "format": "toon", "data": "<TOON document>" }`; it does not duplicate the canonical JSON or add text content. Unsupported representations such as non-finite numbers fail rather than degrading silently.

The three multi-shape tools do not register an MCP `outputSchema`. Publishing a permissive schema would misrepresent validation, while publishing the canonical schema makes the TOON envelope invalid. Internal Zod validation remains exact in both modes; single-shape tools retain their existing MCP output schemas.

Batch steps always use JSON objects. A CLI may encode the final result of a read-only batch as TOON, but cannot use TOON for intermediate steps or mutation preparation/apply.

Pin `@toon-format/toon` at `4.1.0` and maintain reproducible byte/token/latency and round-trip benchmarks. Scenario-specific savings may be documented; provider-billing savings require provider usage evidence.

## Consequences

### Positive

- Uniform arrays avoid repeated JSON keys in model context.
- Existing clients and automation remain compatible by default.
- Batch and write correctness remain independent of a model-facing format.
- The feature is reversible and does not require agent-specific setup or proxy infrastructure.
- One shared presenter prevents TOON syntax from leaking into tool/domain logic.
- Successful TOON requests prove losslessness with one decode/deep-equality pass.

### Negative

- Three tool input schemas gain a small recurring metadata cost.
- Clients must explicitly request and understand the TOON envelope.
- One tool can have two success presentation shapes.
- Clients that introspected the three canonical MCP output schemas no longer receive those schemas; default runtime result objects remain unchanged.
- The package gains a pinned runtime dependency and format-version maintenance obligation.
- MCP error text is bounded to 64 KiB of UTF-8 and TOON success data to 10 MiB.
- TOON cannot reduce large multiline code/diff payloads without a separate representation design.

## Alternatives considered

### Replace JSON throughout MCP and batch

Rejected. MCP transport, arguments and schemas remain JSON, while batch references require structured objects. The change would break compatibility for little or no benefit on several payload classes.

### Return TOON and JSON together

Rejected. Some hosts may expose both to the model, eliminating the intended savings and potentially increasing context.

### Global server output mode

Rejected for this phase. It avoids input-schema fields but forces mixed clients into one representation and complicates existing setup registrations. Per-call opt-in is more reversible.

### Automatic shape-based selection

Rejected. Serialized character count is not token count, behavior would become unpredictable for programmatic clients, and negative shapes exist. Explicit format selection is testable.

### External client proxy

Rejected as the package's primary solution. It adds deployment and trust surface and leaves native CLI output unsolved. Proxies remain compatible with the canonical JSON default.

## Verification

- Lossless encode/decode fixtures for every eligible output schema.
- In-memory and stdio MCP tests for structured default and the structured TOON envelope.
- Batch tests proving TOON cannot enter intermediate results.
- CLI smoke proving final read-only TOON and mutation rejection.
- Checked format benchmark with raw values, tokenizer identity and negative controls.
- Full Yarn quality, package and audit gates.
