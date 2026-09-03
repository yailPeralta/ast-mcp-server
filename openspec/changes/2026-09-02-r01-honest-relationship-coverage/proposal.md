# Proposal: Honest Relationship Coverage

## Intent

Fix approved bug #161: `ast_get_impact` can claim complete emptiness when accepted `call` or `contains` coverage never ran. Preserve all seven public kinds and fail closed.

## Scope

### In Scope

- Implement exact scoped `call`/`contains` producers and per-request coverage accounting.
- Update candidates, public schemas/docs, and regression evidence.

### Out of Scope

- T-01 reconstruction, F-01, runtime/dynamic or heuristic/index authority, and new kinds.
- Harness changes, apply behavior, or delivery-chain selection.

## Capabilities

### New Capabilities

- `honest-relationship-coverage`: Exact seven-kind production, coverage accounting, and complete-negative rules.

### Modified Capabilities

- `affected-test-candidates`: Request incoming `reference`, `import`, `export`, `extends`, `implements`, `call`; exclude `contains`. Incomplete coverage remains `INCOMPLETE_EVIDENCE`, never `proven_empty`.

## Approach

- Emit an additive, ordered coverage list keyed by requested kind, effective direction, and endpoint class; statuses are `completed`, `not_applicable`, `unsupported`, and `unfinished`. Complete empty requires every combination completed/not-applicable; unsupported/unfinished makes impact incomplete.
- Freeze `contains` as direct compiler-owned module→top-level named declaration and named declaration→direct nested named declaration edges. Exclude statements, anonymous nodes, transitive edges, heuristics/indexes, and runtime ownership; BFS depth composes direct edges.
- Share one request-scoped work/cancellation tracker across producers and BFS probes. Never run a global collector per node; exact call classification may be shared.
- Preserve fields, order, bounds, freshness, trust, pagination, and errors. Document cutover and candidates; remove silent-skip/temporary paths.

## Affected Areas

| Area                                                                 | Impact   | Description                              |
| -------------------------------------------------------------------- | -------- | ---------------------------------------- |
| `src/services/{relationships,impact}.ts`                             | Modified | Producers, coverage, budget/cancellation |
| `src/tools/{get_impact,relationship-schema,find_test_candidates}.ts` | Modified | Public contract, candidate set           |
| Tests and public/schema docs                                         | Modified | RED, matrix, compatibility               |

## Risks

| Risk                                 | Likelihood | Mitigation                                                              |
| ------------------------------------ | ---------- | ----------------------------------------------------------------------- |
| Incoming scans multiply work         | Medium     | Shared budget and checkpoints                                           |
| Overloads create false targets       | Medium     | Compiler-resolved fixtures                                              |
| Additive fields break strict clients | Medium     | Stable schema and cutover docs                                          |
| Matrix exceeds review budget         | High       | Tasks forecast slices; default ask-on-risk remains; no chain choice yet |

## Rollback Plan

Revert producers, coverage, schemas, candidate set, docs, and tests together; retain no partial completeness claims. Re-run full/package/Harness gates.

## Dependencies

- Fresh synchronized TypeScript compiler project; no new dependency.

## Success Criteria

- [ ] First gate is the smallest registered-MCP incoming-`call` RED proving false-complete negativity.
- [ ] A compiler-backed positive/negative seven-kind matrix covers mixed kinds, overloads/methods/constructors, module/symbol endpoints, stable order, bounds/work exhaustion, and cancellation.
- [ ] Empty, unsupported/unfinished, candidate-error, and MCP/batch candidate-equivalence contracts pass.
- [ ] Format, lint, typecheck, focused/full tests, build, package/smokes, and Harness gates pass; Harness has exactly 15 guarded tools, no apply, and direct `UNKNOWN_TOOL`.
