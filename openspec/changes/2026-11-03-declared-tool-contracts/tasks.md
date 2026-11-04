# Tasks: Declared tool contracts in the dsh-adapter smoke

Issue #383. Strict TDD: every task names its RED test first (file + test name), then GREEN, then refactor. Gate per unit: `yarn typecheck && yarn lint && yarn format:check && yarn build`, `env -u GIT_EDITOR yarn test`, `yarn test:package`, `env -u GIT_EDITOR yarn test:dsh-adapter` (must exit 0, no green-skip); U2 also `yarn test:local-registry` once.

## Review Workload Forecast

| Field                   | Value                                                                         |
| ----------------------- | ----------------------------------------------------------------------------- |
| Estimated changed lines | U1 design ~490, realistic 700-950; U2 design ~260-300, realistic 520-700      |
| 400-line budget risk    | High (both units exceed 400; U1 may approach or exceed the 800 review budget) |
| Chained PRs recommended | Yes                                                                           |
| Suggested split         | Tracker (draft) -> U1 module and gate wiring -> U2 descriptions, pins, docs   |
| Delivery strategy       | auto-chain                                                                    |
| Chain strategy          | feature-branch-chain                                                          |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Estimate basis: applied the recorded 2-2.5x lesson (design estimates undercount; tests are 75-84% of lines). Review budget 800 (repo budget 400; over it needs `size:exception`).

- U1 risk: High. Likely above 400 and possibly near 800 because the rules test is ~260 design lines and the smoke edit is a net-removal plus rewiring. Request `size:exception` on the U1 PR; if apply measures above 800, split the smoke wiring (tasks 1.9-1.11) into a U1b PR based on U1.
- U2 risk: Medium. Above 400 mainly from the formatted fixture entries (120-160 lines JSON) and docs; under 800. Request `size:exception` if measured above 400.

### Suggested Work Units

| Unit | Goal                                                         | Likely PR | Focused test command                                                                                          | Runtime harness                                        | Rollback boundary                                            |
| ---- | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| U1   | Pure module, empty fixture, smoke wiring; behavior identical | PR 1      | `yarn vitest run test/declared-tool-contracts.test.ts test/dsh-adapter.test.ts`                               | `env -u GIT_EDITOR yarn test:dsh-adapter` (once)       | Revert PR: inline equality and local `semanticSchema` return |
| U2   | Two descriptions, fixture entries, oracle, three pins, docs  | PR 2      | `yarn vitest run test/declared-tool-contracts.test.ts test/mcp.integration.test.ts test/angular-docs.test.ts` | `yarn test:dsh-adapter` and `yarn test:local-registry` | Revert PR: descriptions, pins, entries, docs return together |

Base boundaries: U1 base = tracker `feat/declared-tool-contracts`; U2 base = U1 branch `feat/declared-tool-contracts-u1-module`. Details in `chain.md`.

## Spec ID key (for verify traceability)

- DTC = declared-tool-contracts: R1 Undeclared equal public (S: silent description drift, silent schema drift, unchanged); R2 Declared equal declaration (S: description differs, schema differs, matches); R3 Declarations differ from public (S: stale); R4 Valid targets (S: unknown tool, missing from candidate, ast_explore); R5 Scope and strictness (S: semantically equal schemas, strictness regression on declared tool); R6 Fixture shape (S: baseline mismatch, empty declarations); R7 Lifecycle (S: baseline advances); R8 Per-tool evidence in summary (S: evidence recorded); R9 Testability and mandatory execution (S: unit test without smoke, smoke cannot skip); R10 Inventory digest pins re-baselined (S: pins consistent, canary pin source).
- ATR-R8 = angular-template-references R8 (diagnostics TS-only; find_references description states template errors are not diagnosed).
- ATN-R8 = angular-template-rename R8 (rename_symbol description states TS-only diagnostics).

## Pre-apply checklist

- [x] 0.1 Issue #383 exists.
- [ ] 0.2 Maintainer applies `status:approved` to #383 (human action, pending; apply must not start before it).
- [ ] 0.3 Orchestrator creates tracker branch `feat/declared-tool-contracts` from main and opens the draft tracker PR.
- [ ] 0.4 Apply phase runs `git log -S tools_list_sha256` on the pin files before any re-baselining (feeds U2 task 2.7).

---

## Unit 1: Module, empty fixture, smoke wiring (split into U1a 1.1-1.5 and U1b 1.6-1.12; branches `feat/declared-tool-contracts-u1{a-module,b-wiring}`, 625/334 lines; behavior identical to today)

- [x] 1.1 Create fixture `test/fixtures/declared-tool-contracts.json` = `{"baseline":"0.13.0","tools":{}}`.
  - RED: `test/declared-tool-contracts.test.ts` > "committed fixture baseline equals PUBLIC_BASELINE_VERSION in the smoke source" (source regex) and "fixture entries are semanticSchema fixed points" (vacuous with `{}`, enforced in U2).
  - Spec: DTC-R6. Parallel with 1.2.
- [x] 1.2 RED the module import: create `test/declared-tool-contracts.test.ts` with the import of `scripts/lib/declared-tool-contracts.mjs` (fails: module absent) and the core cases below as separate `it`s, added alongside 1.3-1.7.
  - Spec: DTC-R9 (S: unit test without smoke).
- [x] 1.3 Normalization and digests. RED: "semanticSchema treats zod 3 and zod 4 variants as equal ($ref vs inline, MAX_SAFE_INTEGER bounds, uuid pattern, additionalProperties false)", "contractFromTool returns description and semantic input_schema", "digests are sha256 of name, description, semantic parameters and deterministic". GREEN: create `scripts/lib/declared-tool-contracts.mjs` with `RESERVED_TOOL_NAMES`, `semanticSchema` (moved verbatim from the smoke), `contractFromTool`, digest helper.
  - Spec: DTC-R5 (S: semantically equal schemas), DTC-R8 (digest form). Depends on 1.2.
- [x] 1.4 Undeclared and declared rules. RED: "identical catalogs pass", "undeclared description drift fails naming tool and description", "undeclared schema drift fails naming input_schema", "matching declaration passes", "declaration mismatch on description fails", "declaration mismatch on input_schema fails", "stale declaration fails stale_equals_public". GREEN: `compareToolContracts` core.
  - Spec: DTC-R1 (3 S), DTC-R2 (3 S), DTC-R3. Depends on 1.3.
- [x] 1.5 Target validation and catalog shape. RED: "declaration for unknown tool fails unknown_tool", "declared tool missing from candidate fails", "tool missing from public fails", "ast_explore declaration fails reserved_tool", "ast_explore skipped in comparison", "catalog names differing fails names_differ", "malformed entry or extra key fails malformed", "baseline mismatch fails baseline_mismatch", "never throws on bad data". GREEN: validation paths.
  - Spec: DTC-R4 (3 S), DTC-R6 (S: baseline mismatch). Depends on 1.4.
- [x] 1.6 Strictness. RED: "additionalProperties true or {} fails loosened for undeclared and declared tools", "undefined and false pass", "ast_explore exempt". GREEN: same predicate as today (`String(parameters?.additionalProperties)` is `"false"` or `"undefined"`).
  - Spec: DTC-R5 (S: strictness regression on declared tool). Depends on 1.4.
- [x] 1.7 Ordering, messages, empty-declarations proof. RED: "failures sorted by tool then field", "formatContractFailures renders tool.field: reason joined by '; '", "empty declarations reproduce the blanket freeze (committed fixture)", "result exposes per-tool status, digests and undeclaredSha256 public and candidate". GREEN: `formatContractFailures`, result assembly.
  - Spec: DTC-R6 (S: empty declarations), DTC-R8, DTC-R9. Depends on 1.5, 1.6, 1.1.
- [x] 1.8 Create `scripts/lib/declared-tool-contracts.d.mts` following the agent-fixtures precedent.
  - RED: `yarn typecheck` fails on the test's typed import until the declaration exists. Spec: DTC-R9. Depends on 1.3; parallel with 1.4-1.7.
- [x] 1.9 Smoke wiring RED. `test/dsh-adapter.test.ts` > "smoke imports the declared tool contracts module and fixture" (contains `./lib/declared-tool-contracts.mjs`, `compareToolContracts(`, `declared-tool-contracts.json`, `declaredContracts`) and > "smoke no longer defines semanticSchema or the blanket unaffected equality" (no `function semanticSchema(`, no `unaffectedSemanticSha256 ===`, still no `process.exit(`).
  - Spec: DTC-R9 (S: smoke cannot skip). Depends on 1.7.
- [x] 1.10 GREEN in `scripts/dsh-adapter-smoke.mjs`: import the module, delete local `semanticSchema`, add `toolContracts` (bare-name map from `astTools`) to `runNativeAgentJourney` and remove it before `summary.h01a`, drop only the `unaffectedSemanticSha256` clause (assertion near 2123-2129), replace the strictness assertion (near 2133-2138) with the module check, read the fixture, call `compareToolContracts(..., PUBLIC_BASELINE_VERSION)`, assert `ok` with `` `declared tool contracts failed: ${formatContractFailures(...)}` ``, write `summary.h02.declaredContracts = { baseline, tools, undeclaredSha256 }`. `schemaEvidence` and `ast_explore` checks unchanged.
  - Spec: DTC-R8, DTC-R9. Depends on 1.9.
- [x] 1.11 REFACTOR: remove dead helpers left by the move; keep the printed summary size unchanged.
- [x] 1.12 U1 gate: all gates; one real `env -u GIT_EDITOR yarn test:dsh-adapter` run proves behavior identical (empty `tools`). Native ledger labels `dtc-u1-acquire` / `dtc-u1-settle`.
  - Spec: DTC-R6 (S: empty declarations), DTC-R9.

Dependency order: 1.1 || 1.2 -> 1.3 -> 1.4 -> (1.5 || 1.6 || 1.8) -> 1.7 -> 1.9 -> 1.10 -> 1.11 -> 1.12.

## Unit 2: Descriptions, fixture entries, pins, docs (branch `feat/declared-tool-contracts-u2-descriptions`, base U1)

- [ ] 2.1 Pre-check on the U1 base: `yarn build && vitest run test/mcp.integration.test.ts test/supervised-worker.integration.test.ts` green; inspect `git log -S tools_list_sha256` (checklist 0.4).
  - Spec: DTC-R10. Sequential first.
- [ ] 2.2 RED oracle: `test/declared-tool-contracts.test.ts` > "declared fixture matches the in-process server" (`createServer()` + `InMemoryTransport`, each entry `toEqual(contractFromTool(tool))`, and each declared tool differs from public baseline description). Fails first because entries are absent/mismatched.
  - Spec: DTC-R2, DTC-R3, DTC-R8. Depends on 2.1.
- [ ] 2.3 GREEN: add the two fixture entries (`ast_find_references`, `ast_rename_symbol`, formatted JSON, values taken from the oracle vitest diff) and change the exact description strings in `src/tools/find_references.ts` and `src/tools/rename_symbol.ts` (strings from design.md "Exact descriptions").
  - Spec: ATR-R8, ATN-R8, DTC-R2. Depends on 2.2.
- [ ] 2.4 RED per-tool description checks: `test/tools/find_references.test.ts` > "description states template usages and that template errors are not diagnosed" and `test/tools/rename_symbol.test.ts` > "description states external template edits and TS-only diagnostics" (assert fail before 2.3 if added first; keep them in the same RED batch as 2.2).
  - Spec: ATR-R8, ATN-R8. Parallel with 2.2.
- [ ] 2.5 Smoke evidence RED: extend `test/dsh-adapter.test.ts` > "smoke records per-tool declaredContracts with public, candidate and declared digests" (source-text); GREEN already provided by 1.10, verified in 2.11.
  - Spec: DTC-R8 (S: evidence recorded).
- [ ] 2.6 RED pin 1: `test/mcp.integration.test.ts` tool-inventory digest test fails after 2.3. GREEN: set `test/fixtures/tool-inventory.json` to the received hex from that failing assertion.
  - Spec: DTC-R10 (S: pins consistent). Depends on 2.3.
- [ ] 2.7 RED/GREEN pin 2: new test `test/declared-tool-contracts.test.ts` > "registry-consumer pin equals tool-inventory pin" (both formulas use SDK `Client.listTools()`). GREEN: set `EXPECTED_TOOLS_SHA256` in `scripts/registry-consumer-smoke.mjs` to the 2.6 value.
  - Spec: DTC-R10. Depends on 2.6.
- [ ] 2.8 RED/GREEN pin 3 (independent): `yarn build`, `vitest run test/supervised-worker.integration.test.ts` fails with the digest printed by `assertExpectedToolInventory` (`...independent oracle (<hex>)`); commit that value in `scripts/canary-local-mcp.mjs`, rerun green. Never copy from 2.6; expected to differ (`fa9a5661...` vs `a7027585...` class of difference).
  - Spec: DTC-R10 (S: canary pin source). Depends on 2.3; parallel with 2.6/2.7 (own run).
- [ ] 2.9 Docs RED: `test/angular-docs.test.ts` > rename to "updated tool descriptions": Unreleased Changed entry mentions `description` and `TypeScript-only`, and the "Deferred tool description text" bullet is gone; `test/dsh-adapter.test.ts` README rule asserts the declared-contract paragraph. GREEN: rewrite CHANGELOG deferred bullet into a Changed entry, add README mandatory-verification paragraph (`README.md:391-397`), add ADR 0015 addendum in `docs/adr/0015-harness-adapter-first-slice.md` (lifecycle: declare, change source, re-baseline three pins, drop declaration when baseline advances; stale rule enforces the drop).
  - Spec: DTC-R7 (S: baseline advances), ATR-R8, ATN-R8, DTC-R9. Depends on 2.3.
- [ ] 2.10 REFACTOR: format fixture and docs; confirm no skill file touched (`skills/structural-code-editing/releases.json` needs no regeneration).
- [ ] 2.11 U2 gate: all gates plus `yarn test:local-registry` once and one full `env -u GIT_EDITOR yarn test:dsh-adapter` (checks `summary.h02.declaredContracts`: candidate == declared digest, public differs, for both tools). Native ledger labels `dtc-u2-acquire` / `dtc-u2-settle`. Then hand to `sdd-verify`.
  - Spec: DTC-R8, DTC-R9, DTC-R10.

Dependency order: 2.1 -> (2.2 || 2.4) -> 2.3 -> (2.6 -> 2.7 || 2.8 || 2.9) -> 2.5 -> 2.10 -> 2.11.

## Coverage matrix (every spec requirement has at least one task)

DTC-R1: 1.4 | R2: 1.4, 2.2, 2.3 | R3: 1.4, 2.2 | R4: 1.5 | R5: 1.3, 1.6 | R6: 1.1, 1.5, 1.7, 1.12 | R7: 2.9 | R8: 1.3, 1.7, 1.10, 2.5, 2.11 | R9: 1.2, 1.7, 1.9, 1.10, 1.12, 2.9, 2.11 | R10: 2.1, 2.6, 2.7, 2.8, 2.11
ATR-R8: 2.3, 2.4, 2.9 | ATN-R8: 2.3, 2.4, 2.9
