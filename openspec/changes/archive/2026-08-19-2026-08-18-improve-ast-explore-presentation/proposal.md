# Proposal: Improve `ast_explore` Presentation

## Intent

Make every `ast_explore` result deterministic, bounded, and explicit about omissions, while giving exact-symbol callers optional compiler-authoritative static call paths. Improve comprehension without creating a runtime tracer or second impact engine.

## Scope

### In Scope

- Deterministic whole-symbol clustering and bounded omission metadata across all existing routes.
- Opt-in incoming/outgoing static call spines only for exact `file_path + symbol_path` exploration.
- A hard caller-owned `max_bytes` ceiling, atomic components, and selector-only pagination fallback.
- `ast_explore` as a read-batch step using the registered MCP implementation with logical MCP/batch parity.

### Out of Scope

- Multi-language/index work, repository-wide call-graph persistence, and mutations.
- Runtime stacks, generic reference chains, heuristic/framework edges, dynamic inference, or public `ast_get_impact` call-kind expansion.

## Capabilities

### New Capabilities

- `ast-explore-cluster-presentation`: Deterministic atomic cluster selection within the byte ceiling.
- `ast-explore-omission-metadata`: Bounded selector/component omissions categorized as budget, incomplete, or untrusted.
- `ast-explore-call-spines`: Canonical paths over fresh, exact compiler-resolved call sites for opt-in exact-symbol requests.
- `ast-explore-batch-parity`: Read-batch admission through the MCP handler with JSON/TOON-equivalent meaning.

### Modified Capabilities

- None. Existing `affected-test-candidates` and `symbol-index-persistence` requirements remain unchanged.

## Approach

Add a pure presentation service that selects whole-cluster variants and verifies canonical UTF-8 JSON bytes. Add bounded call-site projection at the relationship boundary; never reinterpret generic `reference` edges. Reuse traversal ordering and trust metadata, then admit `ast_explore` to the read-batch allowlist.

## Affected Areas

| Area                      | Impact       | Description                 |
| ------------------------- | ------------ | --------------------------- |
| `src/services/`           | Modified/New | Projection and presentation |
| `src/tools/explore.ts`    | Modified     | Additive public contract    |
| `src/batch/`              | Modified     | Read parity                 |
| `test/`, docs, benchmarks | Modified     | Contract evidence           |

## Risks and Mitigations

| Risk                                | Mitigation                                                   |
| ----------------------------------- | ------------------------------------------------------------ |
| Static paths imply runtime behavior | Name and validate compiler-resolved call-site semantics only |
| Metadata consumes its own budget    | Reserve counts; bound deterministic details                  |
| Default clients regress             | Keep spines opt-in and additions backward-compatible         |
| Incoming discovery is costly        | Enforce cancellation and explicit depth/node/edge ceilings   |

## Rollback

Remove the opt-in fields and batch allowlist entry, restore the prior presentation path, and leave compiler, impact, mutation, and index contracts untouched.

## Dependencies

- Active TypeScript compiler project, existing relationship trust/endpoint model, traversal ordering, MCP registration, and batch runner.

## Success Criteria

- [ ] Identical request and snapshot produce identical ordering; `budget.used_bytes <= max_bytes`.
- [ ] No source or evidence record is sliced; every logical page advances with explicit omissions.
- [ ] Empty spines are complete only after fresh, authoritative, complete traversal.
- [ ] MCP and batch JSON are logically identical; final TOON changes serialization only.
