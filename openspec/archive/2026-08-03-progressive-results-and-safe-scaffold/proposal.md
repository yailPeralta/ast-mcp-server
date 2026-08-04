# Proposal: progressive results and safe class scaffolding

## Outcome

Ship v0.5.0 with progressive collection results and a hash-bound class scaffold. Reduce model-facing evidence volume by ranking and shaping results before optional TOON presentation, while extending the existing prepare/review/apply transaction to create one new class file safely.

## Success criteria

1. The MCP handshake version is read from shipped package metadata and equals the installed package version.
2. Symbol search ranks exact selector/path/name matches, then prefixes, then substrings, with deterministic path/position tie-breaking.
3. Search defaults to `detail: "summary"` and 20 results; `selectors`, `summary` and `full` have closed, documented schemas and preserve exact downstream selectors.
4. References default to `detail: "locations"`; `detail: "context"` preserves the v0.4.0 records exactly.
5. JSON and TOON encode the same canonical value for every supported detail level, and batch intermediates remain JSON.
6. The checked task corpus retains every expected selector/reference coordinate in the required workflow while reducing aggregate model-facing tokens by at least 35% against the v0.4.0 full-detail TOON baseline.
7. The benchmark reports tool calls and static `tools/list` metadata separately; it makes no provider-billing claim.
8. `ast_scaffold_class` prepares exactly one absent `.ts`/`.tsx` file and never writes during preparation.
9. The scaffold preview, hashes, diagnostics and workspace fingerprint bind the exact generated postimage; apply is no-clobber, rollback-safe and idempotent.
10. A successful scaffold returns an outline and direct pending method paths; each generated method initially throws a deterministic placeholder error.
11. Existing rename/body replacement operations, persisted plans and read tools pass unchanged safety gates.
12. Unit, integration, batch, stdio, CLI, package, audit and benchmark gates pass.

## Public contract changes

- Add `detail: "selectors" | "summary" | "full"` to `ast_search_symbols`; default `summary`.
- Change the search default page size from 100 to 20. Explicit limits retain the existing 1..500 range.
- Add `detail: "locations" | "context"` to `ast_find_references`; default `locations`.
- Add prepare tool `ast_scaffold_class`.
- Add operation kind `scaffold_class` and absent-file semantics to persisted/apply plans without weakening existing plan verification.
- Add `ast_scaffold_class` to the final-prepare batch-tool set.
- Keep `output_format: "json" | "toon"` orthogonal and JSON as the default.

This is an intentional v0.x minor contract evolution. Full/context modes preserve v0.4.0 field-level results for callers that need the previous shape.

## Scaffold contract corrections from the supplied draft

- Remove direct writes and `overwrite`.
- Replace absolute output paths with project-relative paths.
- Keep `dry_run` only as a compatibility field; every invocation prepares and never applies.
- Add `allow_new_errors` with the same blocked-plan behavior as existing prepare tools.
- Reject existing targets, unsafe parent paths, duplicate method names and unsupported declaration forms.
- Route review through `ast_get_operation_preview` and writes through `ast_apply_operation`.

## Risks

- Smaller defaults can cause pagination if ranking is poor. The task corpus must prove expected evidence remains reachable in the first page for supported search scenarios.
- Detail-level unions remove one fixed response shape. Internal Zod validation and integration tests must cover every branch.
- New-file apply introduces absent/existing races. Creation must use an atomic no-clobber primitive, not a pre-check followed by overwrite-capable rename.
- Raw TypeScript fragments in types, decorators and initializers can be invalid or malicious-looking. They remain inert until reviewed apply, must parse into the expected AST shape, and are covered by diagnostics and exact previews.
- An eleventh tool increases static schema tokens. Report the delta and keep descriptions/contracts bounded.
- Old persisted modification plans must remain importable and hash-compatible.

## Rollback

- Callers can request `detail: "full"`, explicit `limit: 100` and reference `detail: "context"` to recover v0.4.0 logical results.
- Scaffold is additive and prepare-only; disabling its registration does not affect existing plans.
- A scaffold plan that is not applied expires without changing disk.
- Applied scaffold rollback during a failed transaction removes only the exact created postimage.
