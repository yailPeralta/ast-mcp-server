# Exploration: progressive results and safe class scaffolding

## Problem

v0.4.0 reduced representation overhead for three collection tools, but it still returns more evidence than many agent steps need. The checked format benchmark shows that serialization alone cannot remove duplicate domain fields, broad default pages or per-reference source context.

A separate proposal, `/home/yail/Descargas/ast_scaffold_class_spec.md`, suggests an AST class-scaffolding tool so an agent can create signatures first and fill method bodies through targeted operations. The workflow is directionally aligned with progressive disclosure, but the supplied design predates the current ten-tool server and bypasses its hash-bound prepare/review/apply boundary.

## Current evidence

Measured against the same repository and deterministic fixtures used by the v0.4.0 benchmark:

| Counterfactual                        | TOON tokens |             Change from current TOON |
| ------------------------------------- | ----------: | -----------------------------------: |
| Search, full 100-result page          |       3,881 |                             baseline |
| Search, full 20-result page           |         892 |                               -77.0% |
| Search, summary fields                |       2,916 |                               -24.9% |
| Search, selector fields               |       1,701 |                               -56.2% |
| References, current context           |       2,150 |                             baseline |
| References, locations only            |       1,200 |                               -44.2% |
| References, locations grouped by file |       1,041 |                               -51.6% |
| Diagnostics, grouped by file          |         869 |                               -16.0% |
| Diagnostics, messages removed         |         583 | -43.6% but not diagnostically useful |

These are tokenizer estimates for serialized results, not provider-reported billing or proof of end-to-end task success. The temporary ablation probe was removed after measurement.

## Current architecture

- `src/services/symbols.ts` filters case-insensitive substrings and sorts matches by file and source position. It does not rank exact or prefix matches.
- `src/services/pagination.ts` defaults every collection tool to 100 records.
- `ast_search_symbols` repeats `name`, `symbol_path`, `selector` and `line` even when downstream tools need only `file_path` and the exact selector.
- `ast_find_references` includes a bounded source-line context for every occurrence.
- TOON is an orthogonal final presenter. Canonical tool values and batch intermediates remain JSON objects.
- Every mutation is prepared in memory, diagnosed, hash-bound, previewed and applied through `ast_apply_operation`.
- The operation engine currently models only modifications to existing regular files.
- `src/server.ts` hard-codes MCP version `0.3.0`, while package metadata is `0.4.0`; existing package smoke checks package metadata but not the MCP handshake.

## Result-shaping options

### Continue shortening field names or serialize more tools

Rejected. TOON already removes repeated table keys. Source, outline and mutation payloads are dominated by unique text where serialization changes measured near zero. Short public field names would make the API harder to understand for little gain.

### Generic `fields[]` projection

Rejected for the first iteration. Arbitrary field combinations enlarge the input schema, weaken stable result contracts and create invalid combinations such as signatures without selectors. Named semantic detail levels are smaller and testable.

### Lower the search limit without ranking

Rejected. The current path-order sort could move the relevant declaration beyond the first page and trade output tokens for extra calls or task failure.

### Rank first, then use semantic details and a smaller search page

Chosen. Exact and prefix matches should precede broad substrings deterministically. Search can then default to a summary page of 20 while retaining selector-only and full views.

### Group references by file immediately

Deferred. Omitting context buys 44.2%; grouping adds only another 7.4 percentage points in the measured fixture while introducing a second pagination shape. Keep flat locations in this change.

## Scaffold assessment

The supplied scaffold proposal has four useful ideas:

1. signatures before bodies;
2. deterministic loud placeholder bodies;
3. exact pending-method selectors;
4. immediate diagnostics.

Its direct-write contract is rejected because:

- `dry_run` only reports intent and does not bind reviewed bytes;
- `overwrite` can replace an existing file without the existing operation engine;
- `save()` occurs before a separate review/apply action;
- path containment alone does not prevent symlink, hard-link or ownership attacks;
- ts-morph structures produce syntax, but raw types/decorators/initializers are still untrusted code fragments;
- partial save failures do not use the existing rollback and receipt machinery.

## Scaffold alternatives

### Direct `ast_scaffold_class` write

Rejected. It creates a weaker mutation path than rename/body replacement.

### Generic raw `ast_prepare_file`

Deferred. It has a smaller schema but grants arbitrary whole-file creation, duplicates ordinary file-writing tools and does not encode the signature-first workflow.

### Structured class scaffold as a prepare operation

Chosen with corrections:

- create-only in v1; no overwrite flag;
- project-relative `.ts`/`.tsx` path under an existing safe parent;
- one exported named class assembled with ts-morph structures;
- bounded imports, decorators, heritage, constructor parameters, properties and methods;
- deterministic throwing placeholders for every method;
- whole-project diagnostic delta before a plan is returned;
- no disk write until `ast_apply_operation` receives the reviewed plan hash;
- absent-file state represented distinctly from an empty file;
- apply uses atomic no-clobber creation and exact-postimage rollback;
- output adds an outline and exact pending method paths to the normal prepared-operation review coordinates.

## Static metadata trade-off

A class scaffold is rare and adds an eleventh MCP schema to every `tools/list`. Its value is safety and progressive implementation, not an unmeasured universal token claim. The benchmark must report the new static characters and tokenizer estimate together with dynamic workflow savings. Documentation must not describe the scaffold as token-saving unless the checked workflow corpus supports that statement.

## Scope

- Package-derived MCP version and handshake regression test.
- Deterministic symbol relevance ranking.
- Search detail levels with a 20-result compact default.
- Reference detail levels with a location-only default.
- TOON compatibility for every detail level.
- Workflow benchmark including evidence completeness, calls, tokens and static metadata.
- Prepare-only class scaffolding and operation-engine support for safe file creation.
- Batch/persisted-plan integration, README, skill, changelog and ADRs.

## Out of scope

- Making TOON the default.
- Changing diagnostics, source, outline or mutation presentation.
- Arbitrary `fields[]` projection.
- Grouped reference pagination.
- Whole-file overwrite or deletion.
- Interfaces, enums, functions or multi-file scaffolds.
- Method overloads, computed/private-field names or generated business logic.
- Provider-billing claims without provider usage data.
