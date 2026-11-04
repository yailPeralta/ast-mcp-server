# Proposal: Declared tool contracts in the dsh-adapter smoke

Issue: #383
Exploration: `exploration.md` (Option B). Related: #370 (deferred ATN-R8/ATR-R8).

## Intent

`yarn test:dsh-adapter` freezes every non-`ast_explore` tool against public `0.13.0`, so no description can ever change (#370 text is parked in CHANGELOG). Replace the blanket freeze with a declared-contract rule: intentional changes are explicit, reviewed and committed; silent drift still fails.

## Scope

### In Scope

- Pure module `scripts/lib/declared-tool-contracts.mjs` + fixture `test/fixtures/declared-tool-contracts.json`, wired into the smoke.
- Declarations for `ast_find_references` and `ast_rename_symbol` with the deferred descriptions.
- Re-baseline the three inventory digest pins; CHANGELOG, README, ADR 0015 addendum.

### Out of Scope

- Any other tool description or schema change.
- Changing `PUBLIC_BASELINE_VERSION`.
- Output-schema hashing in the smoke.

## Capabilities

### New Capabilities

- `declared-tool-contracts`: comparison rules, fixture shape, declaration lifecycle, smoke evidence.

### Modified Capabilities

- `angular-template-rename`: ATN-R8 tool-description clause un-deferred.
- `angular-template-references`: ATR-R8 tool-description clause un-deferred.

## Approach

Fixture: `{ "baseline": "0.13.0", "tools": { "<name>": { "description": "...", "input_schema": <semanticSchema form> } } }`.

`compareToolContracts({ public, candidate, declared })` rules, on `{name, description, semanticSchema(parameters)}`:

| Case                                                       | Result                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Undeclared tool                                            | must equal public                                                              |
| Declared tool                                              | must equal declaration AND differ from public (equal-to-public = stale, fails) |
| Declaration for unknown/missing tool, or for `ast_explore` | fails                                                                          |
| `ast_explore`                                              | existing RED/corrected checks, unchanged                                       |
| `additionalProperties` strictness                          | still checked for all tools                                                    |

Smoke records `summary.h02.declaredContracts` (per tool: public, candidate, declared sha256) and keeps `unaffectedSemanticSha256` for the undeclared set.

Lifecycle: a declaration lands with its source change; it is removed when the baseline advances to a release that already contains it (the stale rule forces this).

Proposed descriptions (append one sentence; proposed, confirm at review):

- `ast_find_references`: "When `@angular/compiler` resolves, it also reports Angular template usages tagged by `origin` with `template_coverage`; incomplete coverage does not prove absence."
- `ast_rename_symbol`: "The plan also rewrites external Angular templates hash-bound to the snapshot; diagnostics stay TypeScript-only."

## Affected Areas

| Area                                                                                                                            | Impact       |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `scripts/lib/declared-tool-contracts.mjs`, `test/fixtures/declared-tool-contracts.json`, `test/declared-tool-contracts.test.ts` | New          |
| `scripts/dsh-adapter-smoke.mjs`, `test/dsh-adapter.test.ts`                                                                     | Modified     |
| `src/tools/{find_references,rename_symbol}.ts`                                                                                  | Description  |
| `test/fixtures/tool-inventory.json`, `scripts/registry-consumer-smoke.mjs`, `scripts/canary-local-mcp.mjs`                      | Re-baselined |
| `CHANGELOG.md`, `README.md`, `docs/adr/0015-*.md`                                                                               | Docs         |

## Risks

| Risk                                      | Likelihood | Mitigation                                                                        |
| ----------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| Raw vs semantic schema mismatch (zod 3/4) | Med        | Store semantic form; keep strictness check                                        |
| Canary pin copied                         | Med        | Recompute under its own guard=allow run                                           |
| Smoke slow, not importable                | High       | Pure-module unit tests + source-text tests + one real smoke run (Strict TDD seam) |
| Docs hash / `angular-docs.test.ts` drift  | Med        | Regenerate hashes; adjust test in PR2                                             |

## Rollback Plan

Revert PR2 (descriptions, pins, entries); PR1 with an empty list behaves as today's freeze.

## Delivery

Two chained PRs. PR1: module, fixture (empty list), smoke wiring, tests. PR2: descriptions, fixture entries, three pins, docs.

## Success Criteria

- [ ] Smoke exits 0 with both declarations; never green-skips.
- [ ] Unit tests cover undeclared drift, stale, mismatch, unknown tool, `ast_explore` declaration.
- [ ] Inventory tests and `test/angular-docs.test.ts` green.

## Open questions

1. ATR-R8 says tool descriptions state template errors are undetected; is the `rename_symbol` sentence enough, or should `find_references` mention it too?

## Proposal question round

Auto mode; maintainer decisions taken. Assumption for review: declared `input_schema` equals public today and is stored so later schema drift also needs a declaration.
