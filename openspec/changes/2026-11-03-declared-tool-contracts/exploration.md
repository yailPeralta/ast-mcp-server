# Exploration: declared intentional tool-contract changes in the dsh-adapter smoke

Issue: #383. Related: #370 (deferred ATN-R8), #380.

## Context

- `yarn test:dsh-adapter` freezes every `mcp__ast__*` tool except `ast_explore` against the public npm package `0.13.0`. Bumping `PUBLIC_BASELINE_VERSION` cannot help: the next candidate must again equal that version.
- #370 shipped Angular template usages in `ast_find_references` and template writes in `ast_rename_symbol`; their descriptions could not change. The deferred text is parked in CHANGELOG Unreleased ("Deferred tool description text").
- Wanted rule: undeclared tools stay hash-equal to public; declared tools must match an explicit recorded contract and differ from public only where declared. No silent exemption.

## Current behavior (evidence)

- `scripts/dsh-adapter-smoke.mjs:46` `PUBLIC_BASELINE_VERSION = "0.13.0"`, used at 399-409 (npm integrity binding) and 1212. `test/dsh-adapter.test.ts:237-239` asserts these as source text.
- `runNativeAgentJourney` (~990-1162) runs once for public (`label: "public"`, line 2094) and once for the candidate (line 2103) with the same Harness and fixture, so both sides yield the same `astTools` array (1014-1018: model's first request tools filtered to `mcp__ast__`, sorted; exactly 15 tools; no apply tool).
- `semanticSchema` (148-171) resolves local `$ref`, drops `$schema`/`$defs`/`definitions`, drops `additionalProperties`/`additionalItems` when `false`, drops safe-integer bounds and `pattern` when `format: uuid`, sorts keys.
- `schemaEvidence` (1132-1156): `catalogSha256`, `unaffectedSha256`, `unaffectedSemanticSha256` (the gate: hash of `{name, description, parameters: semanticSchema}` for tools other than `ast_explore`), `unaffectedAdditionalProperties`, `exploreSha256`, `exploreRequired`, `exploreProperties`.
- Assertions (2112-2138): raw status and names-only catalog equal across runs; public `ast_explore` empty (RED baseline); candidate `ast_explore` `required == ["project_root"]` with `call_spines`, and `unaffectedSemanticSha256` equal to public; every unaffected tool's `additionalProperties` is `"false"` or `"undefined"`; direct MCP, registry and native `ast_explore` schemas match (2139-2156).
- Result JSON (2157-2164): `summary.h02` holds explore hashes plus `unaffectedSha256`; `summary.h01a` holds both journeys. Printed as `DSH_ADAPTER_SMOKE_OK:{...}`.
- The smoke uses top-level await and cannot be imported; `test/dsh-adapter.test.ts:196-380` only does source-text checks. CI runs it at `.github/workflows/ci.yml:48` in the `quality` matrix (Node 22.13.0 and 24); it needs network (public tarball), Playwright chromium and a source-built Harness; several minutes.

## Tool definitions and digests

- `src/tools/find_references.ts:87-88` description: "Finds type-resolved references and returns bounded project-relative locations, including declaration impact by default."
- `src/tools/rename_symbol.ts:30-31` description: "Prepares an exact hash-bound rename plan without writing. Review the preview and apply its operation_id with ast_apply_operation."
- CHANGELOG.md:19 states the required content of the deferred descriptions (template usages with `template_coverage`; external template writes; TypeScript-only diagnostics), not a final string. `test/angular-docs.test.ts:48-53` matches `/description/i` against the Unreleased section.
- Three digest pins: `test/fixtures/tool-inventory.json:3` (`a7027585...`, used by `test/mcp.integration.test.ts:530-535` as sha256 over `JSON.stringify(client.listTools().tools)`, so it covers descriptions, annotations and output schemas); `scripts/registry-consumer-smoke.mjs:61` (`a7027585...`, checked at 865-872); `scripts/canary-local-mcp.mjs:172` (`fa9a5661...`, same formula at 205 but computed under `AST_MCP_APPLY_GUARD=allow`, lines 2709/3300/3309, checked at 2849/2901/2968). The canary value is a different tool-list shape and must be recomputed independently, never copied.
- Git history of `tools_list_sha256` re-baselines was not inspected (no shell in this phase); the apply step must check it first.

## Gate promises to amend

- README.md:391-397: "mandatory verification", "hashes all 14 unaffected model schemas", public empty `ast_explore` frozen as RED.
- `docs/adr/0015-harness-adapter-first-slice.md:20` (Accepted) describes phases A/B/C and says nothing about description freezing; the freeze lives only in the smoke and the README.

## Options compared

| Option                                            | Description                                                                                                                                                                                                                                                                        | Pros                                                                                                                                                                                               | Cons                                                                                                                                                                       | Effort        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| A. Declaration map inside the smoke               | `DECLARED_CONTRACT_CHANGES` const in the script                                                                                                                                                                                                                                    | One file                                                                                                                                                                                           | Script not importable, so only source-text tests (weak RED/GREEN); bulky inline JSON; diffs mix with a 2200-line script                                                    | Low           |
| B. JSON fixture + pure module (recommended)       | `test/fixtures/declared-tool-contracts.json` with `{ baseline, tools: { name: { description, input_schema } } }`; `scripts/lib/declared-tool-contracts.mjs` exports pure `compareToolContracts({ public, candidate, declared })`; the smoke and a vitest unit test both consume it | Real unit seam (undeclared drift, stale declaration equal to public, declared mismatch, unknown tool, `ast_explore` special case); data separate from logic; consistent with `tool-inventory.json` | New module and fixture; smoke must import it                                                                                                                               | Medium        |
| C. Compare against the previous published version | Diff candidate vs latest npm release                                                                                                                                                                                                                                               | No declaration per change                                                                                                                                                                          | Removes the freeze that guards silent drift; unreleased intentional changes undetectable; moving, non-reproducible target; conflicts with the pinned npm integrity binding | Medium, risky |

## Recommended approach (Option B)

1. Fixture `test/fixtures/declared-tool-contracts.json` with exactly two entries, `ast_find_references` and `ast_rename_symbol`: expected description and expected semantic input schema. Their input schemas equal public, so the rule is "differs from public somewhere", not "schema differs".
2. Pure comparison: undeclared tool must equal public on `{name, description, semanticSchema}`; declared tool must equal the declared contract and must not equal public (stale declaration fails); reject declarations for unknown tools, for `ast_explore` (keeps its own RED contract) and for names missing on either side; keep the `additionalProperties` strictness check for all tools.
3. Smoke: replace the single equality at 2126-2127 with `compareToolContracts`; record `declaredContracts` evidence in `summary.h02` (per tool: public, candidate and declared sha); keep `unaffectedSemanticSha256` for the undeclared set.
4. Apply the two descriptions in `src/tools/*`; recompute the three pins (canary in its own guard=allow environment); rewrite the CHANGELOG deferred bullet into a Changed entry while keeping `test/angular-docs.test.ts` green or adjusting it.
5. Docs: README mandatory-verification paragraph gains the declared-contract rule; ADR 0015 addendum naming the procedure (declare in the fixture, change the source, re-baseline the three pins, drop the declaration once `PUBLIC_BASELINE_VERSION` advances to a release that already contains it).
6. `test/dsh-adapter.test.ts` source-text checks: the smoke imports the module and no longer hashes all non-explore tools unconditionally.

## Affected files

`scripts/dsh-adapter-smoke.mjs`; `scripts/lib/declared-tool-contracts.mjs` (new); `test/fixtures/declared-tool-contracts.json` (new); `test/declared-tool-contracts.test.ts` (new); `test/dsh-adapter.test.ts`; `src/tools/find_references.ts:87`; `src/tools/rename_symbol.ts:30`; `test/fixtures/tool-inventory.json`; `scripts/registry-consumer-smoke.mjs:61`; `scripts/canary-local-mcp.mjs:172`; `CHANGELOG.md`; `README.md:391-397`; `docs/adr/0015-harness-adapter-first-slice.md` (addendum); possibly `test/angular-docs.test.ts` and the skill `releases.json` hashes if skill docs change.

## Risks

- `semanticSchema` drops `additionalProperties: false`: declared schemas must be stored and compared in semantic form, and the strictness assertion kept for all tools.
- zod 4 (candidate) vs zod 3 (public) serialization is why semantic normalization exists; raw schemas in the fixture would differ by serialization alone.
- Canary independence: compute the canary pin from its own run, never copy `tool-inventory.json`.
- Stale declarations: the "must differ from public" rule needs an explicit RED test.
- Smoke cost and non-importability: all new logic must be unit-testable; the single full smoke run is the integration check.
- Docs hashes: README or skill doc edits may require regenerating `releases.json` hashes and adjusting `test/angular-docs.test.ts`.

## Open questions

1. Compare input schemas for the two tools even though they equal public? Recommendation: yes, store the semantic schema so later schema drift also needs a declaration.
2. Final wording of the two descriptions (digest-sensitive). To be fixed in the proposal/spec.
3. ADR 0016 vs addendum to 0015. Recommendation: addendum, the gate belongs to 0015.
4. Why the canary digest differs from the other pins; inspect `tools_list_sha256` history before re-baselining.
5. Whether a declaration may outlive a baseline bump, and whether the smoke should fail when a declaration equals the baseline (recommended: yes, that is the stale-declaration rule).

## Estimated size

Module 50-70, smoke 20-30, descriptions 2, pins 3, fixture 60-100, docs 40-60, tests 150-220: about 350-500 lines. Past forecasts ran 2-2.5x short with tests at 75-84% of lines, so plan for the upper end or beyond. Likely two chained PRs: (1) comparison module, fixture, smoke wiring with an empty declaration list; (2) descriptions, re-baselined pins, docs.

Ready for proposal: yes.
