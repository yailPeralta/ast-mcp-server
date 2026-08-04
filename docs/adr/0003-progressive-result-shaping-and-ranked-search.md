# ADR 0003: Shape collection results before model-facing serialization

- Status: Accepted
- Date: 2026-08-03

## Context

The v0.4.0 collection tools could encode validated results as JSON or TOON, but serialization alone could not remove domain fields that a workflow did not need. Symbol search returned redundant name/path/line fields and a default page of 100 records. References repeated bounded source lines even when callers needed only routing coordinates.

At the same time, reducing evidence indiscriminately would make exact downstream calls less reliable. A useful compact result must retain stable selectors, reference coordinates, complete-set counts, and deterministic relevance order.

## Decision

Rank `ast_search_symbols` matches case-insensitively by:

1. exact selector;
2. exact symbol path;
3. exact declaration name;
4. symbol-path or name prefix;
5. remaining substring matches.

Use project-relative file, start line, symbol path, and kind as deterministic tie-breakers. Apply all semantic filters before ranking and paginate only after ranking.

Expose three closed search profiles:

- `selectors`: `file`, `selector`, and `kind`;
- `summary` (default): selector fields plus body-free `signature`;
- `full`: the v0.4.0 record.

Search defaults to 20 records. Explicit limits through 500 remain supported.

Expose two closed reference profiles:

- `locations` (default): file, line, column, kind, and declaration flag;
- `context`: the v0.4.0 record with bounded source-line context.

Counts, declaration inclusion, affected files, pagination metadata, and ordering are independent of detail. Project complete internal records first, then validate the exact canonical profile, then present it as JSON or lossless TOON. Batch intermediates remain JSON.

## Consequences

### Positive

- Common navigation calls carry only evidence needed for the next exact tool call.
- Exact names/paths outrank lexically earlier substring noise.
- Existing full/context consumers have explicit compatibility modes.
- JSON and decoded TOON remain semantically identical per profile.
- Pagination and scope metadata remain stable and testable.

### Negative

- Pre-1.0 defaults change for clients that omitted limits/detail.
- Consumers must use `selector`, not assume a summary record contains `symbol_path`.
- Tool schemas gain detail enums and compatibility documentation.
- Context extraction remains eager internally; this ADR claims model-facing savings, not compute savings.

## Evidence

The checked result-shaping corpus covers exact-name, exact-path, prefix, broad-substring, and multi-file-reference workflows. Against v0.4.0-compatible `full/100/context` calls, the defaults retained every declared selector/coordinate with the same six logical calls and reduced aggregate `o200k_base` tokens in serialized MCP TOON envelopes by 68.80% (3,910 to 1,220). The benchmark omits nondeterministic `duration_ms` from both measured representations. This is a local tokenizer estimate, not provider billing evidence.

## Alternatives considered

### Keep full records and rely only on TOON

Rejected. TOON reduces repeated keys but cannot remove unnecessary fields or oversized default pages.

### Return selectors only by default

Rejected. Body-free signatures usually avoid a second discovery call and remain compact enough for the measured workflows.

### Group references by file

Deferred. It complicates flat offset semantics for a smaller incremental benefit than omitting context.

### Change diagnostics in the same release

Rejected. Diagnostic messages are decision evidence; measured savings did not justify reducing them.
