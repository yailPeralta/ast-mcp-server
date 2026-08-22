# ADR 0013: Keep `ast_explore` evidence atomic and batch-compatible

## Status

Accepted.

## Context

`ast_explore` combines ranked symbols, source, references, freshness, and byte accounting. Returning partial source or silently dropping requested relationships would make a bounded response look complete. A separate batch implementation would also risk drifting from the registered MCP tool.

Exact-symbol callers additionally need static call paths, but generic references and runtime claims are not trustworthy substitutes for compiler-resolved invocation sites.

## Decision

Presentation is a pure planning boundary. It reserves the response shell and omission counts, then admits only whole symbol clusters, whole source, whole reference records, and whole call spines. Canonical UTF-8 JSON size determines admission and `budget.used_bytes`; selector-only fallback advances logical pagination when richer evidence does not fit.

Requested omissions are categorized as `budget`, `incomplete`, or `untrusted`. Exact counts are always retained, while details are a stable bounded prefix. Any omitted or unfinished evidence makes completeness false.

Call spines are opt-in and available only for exact `file_path` plus `symbol_path` requests. They contain fresh, exact, compiler-resolved call, constructor, or tagged-template sites. Generic references, callbacks-as-values, dynamic dispatch, ambiguous endpoints, and stale evidence are excluded.

`ast_explore` is a read-batch tool. The batch runner injects the pipeline root and invokes the same registered MCP handler. A conflicting step root fails before execution. Batch intermediates remain canonical JSON; CLI TOON is final serialization only and must decode to the same logical result.

## Consequences

- Repeated requests against one compiler snapshot have deterministic ordering and bytes.
- A response never slices source, references, or call paths to fit.
- Empty call-spine evidence is authoritative only after fresh, complete traversal.
- MCP and batch behavior share one implementation and one root policy.
- Call-spine discovery costs are paid only when explicitly requested and remain bounded by depth, node, edge, and byte limits.

## Verification

- Presenter and context tests cover stable pages, selector fallback, omissions, and completeness.
- Relationship and spine tests cover call classification, cycles, canonical shortest paths, bounds, and trust.
- MCP/batch integration compares logical results, root failures, cancellation, and final JSON/TOON decoding.
- Runtime smoke suites exercise direct MCP and batch CLI paths.
