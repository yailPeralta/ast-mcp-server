```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:7895396bd5f0482f0d2449de64e02a4e29e1ed05e0725a7a30e1eb6c8819638a
verdict: pass
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 13/13
test_command: env -u GIT_PAGER yarn test
test_exit_code: 0
test_output_hash: sha256:f7195fa44edfe693e62eab65a39720a5e42ed517467aec38c8ac695233301f16
build_command: yarn build
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verification Report: Exact Request-Wide Work Accounting

**Change:** `2026-09-05-issue-187-request-work-accounting`<br>
**Mode:** Strict TDD; OpenSpec authoritative<br>
**Runtime candidate:** `152ffa4f87011e66103f0ded83fa0b6a9186c119` (tree `4b5b1ef6a5255a8da5e00ccd654a226c51ea6f63`)<br>
**Review approval:** PR #232 HEAD `a1e05a971644839b603028ad0436509ff38efcf4`<br>
**Verdict:** **PASS** — 9/9 requirements and 13/13 scenarios have fresh passing runtime coverage; no active severe finding, RED, or #187 blocker remains.

## Completeness

| Metric                          |                                          Result |
| ------------------------------- | ----------------------------------------------: |
| Requirements                    |                                             9/9 |
| Scenarios                       |                                           13/13 |
| Tasks before verify             | 15/16; only task 3.2 was this verification gate |
| Active confirmed/suspect severe |                                             0/0 |
| Blocking findings               |                                               0 |

## Candidate, lineage, review, and budgets

- Authority base `1dbbf441b32cd9f226115785725b82142600a749` is an ancestor of the runtime candidate, and the runtime candidate is an ancestor of PR #232 HEAD.
- Candidate tree and ledger tree both equal `4b5b1ef6a5255a8da5e00ccd654a226c51ea6f63`; full candidate patch SHA-256 is `995b505f123e80d956190621cc964e3d1e8505bddf846452636139f1028e5ea6`.
- Runtime `src`/`test` tree identities are unchanged between candidate and approval HEAD: `8df6271beeb69fa53d1d0d5d408f89003c851bba` / `ac3fcd8c907c427fafad2c289ec8fff89e630113`.
- Recomputed child budgets: A `323+75=398`, B `309+86=395`, format `47+36=83`, correction-C runtime `79+0=79`; every bounded slice is at or below 400.
- Judgment ledger is terminal `APPROVED`: two scoped re-judges approved correction C, `JD-R1-SEV-001` is closed, correction-caused CONFIRMED/SUSPECT counts are zero, and no delivery receipt or merge authority exists.
- The four preserved `JD-R1-INFO-001..004` observations remain non-blocking, uncorroborated, and outside correction-C authority; this verification does not silently resolve or expand them.

## Executable evidence

| Gate                                                                                                                                                                                                                                                                                                                   | Exit | Result / count                                                                           | Output SHA-256                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `yarn vitest run test/impact.test.ts test/relationships.test.ts test/context-builder.test.ts test/test-candidates.test.ts test/mcp.integration.test.ts test/batch.test.ts --no-file-parallelism`                                                                                                                       |    0 | 6 files, 136 tests passed                                                                | `28e115ba9c03511abbd64852fa40dfd522191641cef661fb71c1cb9a503ddcd1` |
| `yarn vitest run test/impact.test.ts test/relationships.test.ts -t 'distinguishes exact bounds\|discards late-exhausted authority\|propagates cancellation observed\|charges the two-item member-reference\|uses a fixed exact relationship\|accounts the legacy compiler-call\|covers RCR-005' --no-file-parallelism` |    0 | 7 passed, 60 skipped                                                                     | `1385526e69fb761858a6e7cfbfc48389985fcd414921f9a0d260933168b0eaa4` |
| `env -u GIT_PAGER yarn test`                                                                                                                                                                                                                                                                                           |    0 | 75 files/983 tests plus supervised 1 file/2 tests; build included                        | `f7195fa44edfe693e62eab65a39720a5e42ed517467aec38c8ac695233301f16` |
| initial `yarn format:check`                                                                                                                                                                                                                                                                                            |    1 | Rejected the prior unformatted partial `verify-report.md`; all source remained unchanged | `af4b0f7afed943bc0e21ad53ea318e980be047a8d2df7e587fc48fa239eaa25d` |
| final `yarn format:check`                                                                                                                                                                                                                                                                                              |    0 | Prettier clean after admitting this report                                               | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |
| `yarn lint`                                                                                                                                                                                                                                                                                                            |    0 | no output/errors                                                                         | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `yarn typecheck`                                                                                                                                                                                                                                                                                                       |    0 | no output/errors                                                                         | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `yarn build`                                                                                                                                                                                                                                                                                                           |    0 | no output/errors                                                                         | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `yarn test:mcp`                                                                                                                                                                                                                                                                                                        |    0 | 16 tools; stdio/TOON/error checks true                                                   | `f6992c50347923ee24cd77dd073d4dd5cb8a6750be8cb0eb94f2b0e097f3fb91` |
| `yarn test:package`                                                                                                                                                                                                                                                                                                    |    0 | package/global install/discovery checks true                                             | `b8f31666c1ddc28758c4293089b1b9313ce0c10d50c043644205d6d9f16b2a31` |
| `yarn test:lifecycle`                                                                                                                                                                                                                                                                                                  |    0 | lifecycle/supervision; orphan processes 0                                                | `49f7089ae790302cd35dd1f5674858f629b66e33ef01faf5ee01503e49325959` |
| `yarn test:cli`                                                                                                                                                                                                                                                                                                        |    0 | CLI JSON/TOON/apply/replay/discovery checks true                                         | `c3eb92e541232f8d00610807afab5e8cde3f6525ffaa8493a15d51c7fa283d3d` |
| `yarn test:errors`                                                                                                                                                                                                                                                                                                     |    0 | compiled bounded errors/correlation true                                                 | `64808d39e1f9b163a451e6916be5741367be59396cf73c5b34b831973fb78733` |
| `git diff --check` for base→candidate and candidate→approval                                                                                                                                                                                                                                                           |    0 | clean                                                                                    | n/a                                                                |

## Frozen vector and boundary evidence

| Vector / boundary             | Fresh proof                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationship A                | exact required N=`160`; exact equals generous; N-1 saturates and emits zero edges                                                                                                       |
| Legacy collector              | exact required N=`27`; vector includes source sort, scan, retention, sort, selection, emission; N-1 returns `{edges: [], incomplete: true}`                                             |
| Impact request                | exact required N=`2624`; exact events equal generous events; N-1 is root-only, zero edges, `work_limit`, exhausted, and not proven empty                                                |
| Member reference correction C | exact required N=`235`; N-1=`234` fails closed; pair-sort events are `[2,2]` before sorting                                                                                             |
| One tracker / no reset        | contiguous event chain requires every event `before` to equal prior `after`; nested resolver, neighbors, BFS/probes, coverage, and emissions share the injected tracker                 |
| Pre-charge                    | sort cardinalities are reserved before sort; per-item scans/retentions/emissions charge before observation/effect; cancellation checkpoints occur inside `charge` before count mutation |
| Cancellation precedence       | abort collision returns typed `REQUEST_CANCELLED`; tracker count/event stream does not advance after cancellation                                                                       |
| Transaction                   | exhaustion catch publishes only diagnostic root, no edges, `visited_edges=0`, `incomplete=true`, `proven_empty=false`, and canonical interrupted coverage                               |
| Fourteen cells                | seven kinds × incoming/outgoing in canonical kind/direction order; static import/export outgoing cells remain `not_applicable`, interrupted applicable cells are `unfinished`           |
| Stable ordering               | exact event vector and normalized JSON bytes equal generous; existing comparators, relationship IDs, page ordering, and schemas remain unchanged                                        |

## Requirement and scenario trace matrix

| Requirement                     | Scenario                                | Runtime evidence                                                                        | Result    |
| ------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- | --------- |
| RWA-001 One tracker             | RWA-001-S01 Shared lineage              | relationship and impact event chains; probes dispatched through shared provider tracker | COMPLIANT |
| RWA-002 Frozen units            | RWA-002-S01 Exact-once units            | A160, legacy27, impact2624, member235 fixed stage vectors                               | COMPLIANT |
| RWA-002 Frozen units            | RWA-002-S02 Sort reservation            | sort wrappers/assertions observe the cardinality charge before sort                     | COMPLIANT |
| RWA-003 Pre-work charging       | RWA-003-S01 Pipeline boundary           | focused relationship/impact tests and contiguous before/after events                    | COMPLIANT |
| RWA-004 Limits/cancellation     | RWA-004-S01 Exact and one below         | explicit N/N-1 checks at 160/159, 27/26, 2624/2623, and 235/234                         | COMPLIANT |
| RWA-004 Limits/cancellation     | RWA-004-S02 Cancellation wins           | cancellation collision and legacy cancellation tests                                    | COMPLIANT |
| RWA-005 Transactional authority | RWA-005-S01 Late exhaustion             | impact late-exhaustion test proves root-only/no edge/no completion claim                | COMPLIANT |
| RWA-006 Directions/coverage     | RWA-006-S01 Fourteen-cell matrix        | impact and MCP matrix tests prove deterministic 7×2 ordering                            | COMPLIANT |
| RWA-007 Compatibility           | RWA-007-S01 Cross-surface parity        | impact exact/generous bytes plus JSON/TOON/MCP/batch focused suites                     | COMPLIANT |
| RWA-008 Legacy collector        | RWA-008-S01 Spine exhaustion            | legacy collector and context-builder spine fail-closed tests                            | COMPLIANT |
| ATC Fail closed                 | ATC-FAIL-001 Partial traversal rejected | candidate/MCP/batch tests return existing incomplete evidence semantics without page    | COMPLIANT |
| ATC Fail closed                 | ATC-FAIL-002 Projection never runs      | tool guard rejects incomplete/exhausted impact before `findTestCandidates`              | COMPLIANT |
| ATC Fail closed                 | ATC-FAIL-003 Proven empty               | complete non-exhausted empty fixture and public metadata remain proven empty            | COMPLIANT |

## Static correctness and design coherence

| Decision                     | Evidence                                                                                                                             | Result   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Shared tracker               | `traverseCompilerImpact` creates one tracker and injects it into resolver, neighbor collection, traversal, aggregation, and emission | Followed |
| Stage/cardinality accounting | named stage charges cover source, producer, merge, neighbor, BFS, result, contains, and legacy stages                                | Followed |
| Scratch/discard authority    | exhaustion is caught only when tracker is exhausted and returns canonical root-only incomplete evidence                              | Followed |
| Consumer fail closed         | candidate tool checks complete exact evidence before projection and preserves `INCOMPLETE_EVIDENCE(work_limit)`                      | Followed |
| Schema stability             | candidate runtime diff changes only `src/services/{impact,relationships}.ts`, paired tests, and #187 artifacts                       | Followed |

## Strict TDD evidence

### TDD Compliance

| Check                         | Result | Details                                                                                                                                                                              |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TDD evidence reported         | ✅     | Apply progress records RED for A.1-A.3 and B.1-B.3, GREEN for A.1-A.4 and B.1-B.5, and refactor for A.4/B.4-B.5.                                                                     |
| All behavior tasks have tests | ✅     | Production slices A and B have paired tests; process-only tasks 0.1, 0.2, A.5, B.0, B.6, 3.1, and 3.2 are not production behavior.                                                   |
| RED test files exist          | ✅     | `test/impact.test.ts`, `test/relationships.test.ts`, `test/context-builder.test.ts`, `test/test-candidates.test.ts`, `test/mcp.integration.test.ts`, and `test/batch.test.ts` exist. |
| GREEN confirmed               | ✅     | 136/136 focused tests and 7/7 targeted vector tests passed; the full 983+2 suite passed.                                                                                             |
| Triangulation adequate        | ✅     | Exact, one-below, generous, cancellation, direction, late exhaustion, empty, and public-surface cases provide distinct expectations.                                                 |
| Safety net                    | ✅     | Focused suites and the complete test suite passed at the unchanged frozen runtime tree.                                                                                              |

**TDD compliance:** 6/6 checks passed.

### Test Layer Distribution

| Layer               |                                                                               Tests |                  Files | Tools                                   |
| ------------------- | ----------------------------------------------------------------------------------: | ---------------------: | --------------------------------------- |
| Unit/service        |                        67 selected by the targeted two-file run; 7 executed by name |                      2 | Vitest                                  |
| Integration/runtime | 136 focused plus MCP, batch, lifecycle, CLI, package, errors, and supervised checks | 6 focused plus scripts | Vitest and built-artifact smoke scripts |
| E2E/browser         |                                                                                   0 |                      0 | Not configured                          |

### Changed File Coverage

Coverage analysis skipped — no coverage tool is configured. This is informational and non-blocking under the project contract.

### Assertion Quality

The candidate-added assertions in `test/impact.test.ts` and `test/relationships.test.ts` contain no tautology, orphan type-only, smoke-only, ghost-loop, implementation-detail, mock-heavy, or production-free patterns.

**Assertion quality:** ✅ All candidate-added assertions verify real behavior.

### Quality Metrics

**Formatter:** ✅ Final report and repository formatting pass.<br>
**Linter:** ✅ No errors or warnings.<br>
**Type checker:** ✅ No TypeScript diagnostics.<br>
**Structural MCP:** ⚠️ The AST tools returned no model-visible payload in this session, so no compiler-resolved AST claim is made from those calls; source inspection plus fresh `yarn typecheck` and tests provide the fallback evidence.

## Scope and external observations

- No candidate changes exist under #186, #219, #220, Harness, schema, apply/mutation, package metadata, CLI registration, or unrelated services. Candidate runtime paths are only `src/services/impact.ts`, `src/services/relationships.ts`, and their paired tests.
- PR #232 is open and mergeable at the exact requested HEAD. Its GitHub `reviewDecision` is empty; the approval authority used here is the frozen terminal Judgment ledger, not a fabricated GitHub review or RDD receipt.
- CI at the same HEAD passed all #187-required format/lint/typecheck/test/build/MCP/errors/lifecycle/CLI/package steps. Separate CI jobs are red from a Harness adapter Corepack cache failure on Node 22 and pre-existing transitive dependency audit advisories; both are outside #187 candidate paths and authority. They remain delivery-environment/dependency follow-ups, not #187 requirement failures or permission to expand this change.
- RDD remains `disabled/unmanaged`; no acquire/reset/settle, receipt, Harness action, commit, push, PR/issue mutation, archive, or merge was performed.

## Issues

**CRITICAL:** None.<br>
**WARNING:** None within #187 verification scope.<br>
**INFO:** Four frozen uncorroborated Judgment observations remain unresolved and non-blocking; external CI still reports excluded Harness/dependency failures.

## Delivery readiness and routing

Strict #187 verification is complete and archive-ready as an OpenSpec artifact only. This report grants no merge, archive, commit, push, PR, issue, release, or recovery-integration authority. The next recommended SDD route may be `archive` for #187. Issue #188 remains unmergeable because the #186 kill switch failed; archiving #187 MUST NOT imply that #188 recovery integration is approved or complete.
