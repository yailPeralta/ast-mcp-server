```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:dd8e241a1f3a982dce87ca443057cb78de86967db811c03e1b6184b9232f5ba9
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 11/11
test_command: env -u GIT_PAGER -u PAGER yarn test
test_exit_code: 0
test_output_hash: sha256:c625ad7de5d3bdb1a1e8294cb766b2fc13dc4a110de7731fd6f175f6d7abc0e1
build_command: env -u GIT_PAGER -u PAGER yarn build
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verification Report

**Change**: `2026-08-17-expose-affected-test-candidates`

**Mode**: Strict TDD

**Verdict**: **PASS WITH WARNINGS** — all seven requirements and eleven scenarios are compliant. The prior convention-reason blocker is corrected and independently verified.

## Completeness

| Metric                                | Value |
| ------------------------------------- | ----: |
| Requirements total/compliant          |   7/7 |
| Scenarios total/compliant             | 11/11 |
| Task checkboxes complete              | 12/12 |
| Tasks substantively verified complete | 12/12 |
| Blocking candidate-caused findings    |     0 |
| Nonblocking pre-existing observations |     1 |

## Candidate identity and artifact integrity

The verification revision is reproducible from a sorted 25-line `sha256sum <product-path>` manifest containing every tracked changed product path plus the three intended untracked product paths: `docs/adr/0012-public-affected-test-candidates.md`, `src/tools/find_test_candidates.ts`, and `src/tools/relationship-schema.ts`.

- Product evidence revision: `sha256:dd8e241a1f3a982dce87ca443057cb78de86967db811c03e1b6184b9232f5ba9`.
- Historical failed verification revision: `sha256:375cc8d7c3c048ade569898d9586c8b2741891e39ad2fe5f69a8321769b2739e`.
- The remediation artifact binds the correction to three paths and 41 changed product/test lines.
- Proposal, specification, design, tasks, and the full cumulative apply-progress were read. All 12 task checkboxes remain complete.
- The managed skill is version `4.4.0`; its computed SHA-256 matches the current release manifest value `3abbc91462eb3c5ba910d6d79dd81f3879561f128d7d97c1d7ba33185e4b386f`.
- The verified predecessor remains skill `4.3.0` for npm `0.9.2`, digest `bf0814b539cd8638aeed108a4e118fe1f2ab418e2e968a77ad75f2d0dbde93b9`.

## Independent compiler-backed inspection

| Evidence                    | Result                                                                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project status              | Fresh compiler snapshot `snapshot_62186af1ec2df4b271544e9570c93d3b352c973d9c5706ceb5ee26ad9b9e2087`; compiler ready; no pending files.                                                                                                                                        |
| Corrected classifier        | `candidateReason` returns `convention_match` only when a candidate does not match the default test patterns/directories; default-recognized depth-one/deeper candidates retain `direct_compiler_reference`/`transitive_compiler_reference`.                                   |
| Public schema               | `TEST_CANDIDATE_REASONS` contains all three values and `TestCandidateSchema.reason` consumes that shared enum.                                                                                                                                                                |
| Adapter trust boundary      | `registerFindTestCandidates` resolves inside `withProject`, requires a fresh session, forces incoming traversal, rejects incomplete/truncated impact, calls `findTestCandidates`, and paginates whole candidates.                                                             |
| Shared implementation       | Compiler references show one registration in `createServer`; compiler impact links the same server to stdio and `src/batch/runner.ts`. The bounded impact inspection reached the relevant path and reported its depth-limit truncation rather than presenting it as complete. |
| Shared relationship schemas | Compiler references show `RelationshipEdgeSchema` consumed by both impact and candidate tools.                                                                                                                                                                                |
| Registration/inventory      | `createServer` registers `ast_find_test_candidates` exactly once after impact; the MCP runtime gate reports exactly 16 tools.                                                                                                                                                 |

The AST diagnostic session reports three TS1470 diagnostics for existing `import.meta` expressions in `src/index.ts` and `src/server.ts`. Exact `git show HEAD` readback proves those expressions predate this candidate. Canonical `yarn typecheck` and `yarn build` pass, so this is a non-candidate compiler-session configuration mismatch.

## Specification compliance

| Requirement                              | Scenario                            | Covering source/runtime evidence                                                                                                                                                               | Result       |
| ---------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Resolve an exact project root            | Exact symbol resolves               | MCP candidate integration resolves `src/value.ts#formatValue`; adapter returns the exact compiler root.                                                                                        | ✅ COMPLIANT |
| Resolve an exact project root            | Root cannot be resolved             | MCP integration returns bounded `NOT_FOUND` with no page; project and impact suites cover ambiguous/missing selectors through the same resolver, and public-error tests cover bounded mapping. | ✅ COMPLIANT |
| Traverse incoming compiler relationships | Incoming traversal is authoritative | Adapter hard-codes incoming traversal; MCP results and compiler inspection expose compiler-authoritative relationship paths and explicit traversal budgets.                                    | ✅ COMPLIANT |
| Fail closed on untrusted evidence        | Partial traversal is rejected       | MCP `max_nodes: 1` returns `INCOMPLETE_EVIDENCE`; unit matrix rejects stale, rebuilding, degraded, truncated, unresolved, heuristic, and non-authoritative evidence.                           | ✅ COMPLIANT |
| Fail closed on untrusted evidence        | Proven empty result                 | MCP runtime returns a complete empty page with `proven_empty: true`; resolver has a paired complete-authoritative empty test.                                                                  | ✅ COMPLIANT |
| Classify deterministic candidates        | Direct and transitive candidates    | Unit and MCP tests pass with deterministic direct/transitive reasons, depth, confidence, relationship IDs, and full paths.                                                                     | ✅ COMPLIANT |
| Classify deterministic candidates        | Convention-driven candidate         | Unit and MCP integration pass with custom-only candidates reporting `convention_match`; overlapping default patterns preserve direct/transitive reasons.                                       | ✅ COMPLIANT |
| Paginate whole candidate proofs          | Page boundary preserves evidence    | Unit, MCP, and batch tests pass with deterministic pages, no omission/duplication, and intact one-/two-edge proofs.                                                                            | ✅ COMPLIANT |
| Return trust and budget metadata         | Metadata distinguishes confidence   | MCP integration asserts backend, authority, exact root, freshness, completeness, truncation, counts, maxima/defaults, and page bounds; bounded errors pass.                                    | ✅ COMPLIANT |
| Keep MCP and batch semantics identical   | Cross-surface parity                | Batch reaches the registered MCP handler; batch and CLI gates pass lossless JSON/TOON parity with only per-invocation `checked_at` normalized between separate runs.                           | ✅ COMPLIANT |
| Keep MCP and batch semantics identical   | Inventory remains synchronized      | MCP smoke reports exactly 16 tools; batch allowlist, six agent targets, fixtures, package checks, README, ADR, and managed skill remain synchronized.                                          | ✅ COMPLIANT |

**Compliance summary**: 7/7 requirements and 11/11 scenarios compliant.

## Corrected convention-reason proof

| Case                                    | Expected reason                 | Independent evidence                                                                                            | Result |
| --------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| Custom-only `**/*.check.ts` candidate   | `convention_match`              | Unit assertion and in-memory MCP integration assertion pass.                                                    | ✅     |
| Custom-directory-only candidate         | `convention_match`              | Unit assertion passes with exact compiler relationship proof retained.                                          | ✅     |
| Default-recognized direct candidate     | `direct_compiler_reference`     | Unit and MCP integration assertions pass, including overlapping custom conventions.                             | ✅     |
| Default-recognized transitive candidate | `transitive_compiler_reference` | Unit and MCP integration assertions pass, including overlapping custom conventions and complete two-edge proof. | ✅     |

## Design and task coherence

| Commitment                                                         | Result      | Evidence                                                                                                   |
| ------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| Dedicated adapter with compiler/service ownership preserved        | ✅ Followed | One transport adapter; impact traversal and the pure resolver remain service-owned.                        |
| Shared relationship transport schemas                              | ✅ Followed | Compiler references show both public tools consume the extracted schema.                                   |
| Incomplete evidence fails instead of appearing empty               | ✅ Followed | Runtime incomplete-error and proven-empty cases both pass.                                                 |
| Whole-candidate pagination remains separate from traversal budgets | ✅ Followed | Unit/MCP/batch evidence preserves complete relationship paths.                                             |
| MCP/batch/CLI use one implementation                               | ✅ Followed | Compiler impact connects CLI batch execution to the same `createServer`; parity gates pass.                |
| Read-only annotations and exact 16-tool consumers                  | ✅ Followed | Integration assertions plus MCP/package/agent gates pass.                                                  |
| Docs, ADR, skill 4.4.0, and predecessor integrity                  | ✅ Followed | Documentation readback and cryptographic skill/release-manifest checks pass.                               |
| Twelve planned tasks complete                                      | ✅ Followed | Tasks show 12/12 checked; cumulative apply evidence and independent runtime gates substantiate completion. |

## TDD compliance

| Check                       | Result | Details                                                                                                                                                             |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TDD evidence reported       | ✅     | Full cumulative and remediation RED/GREEN/REFACTOR evidence exists.                                                                                                 |
| All task rows have evidence | ✅     | 12/12 task rows identify tests, contract checks, or explicit process verification.                                                                                  |
| RED confirmed               | ✅     | Referenced files exist; remediation records genuine unit and MCP failures that received the old direct reason instead of `convention_match`.                        |
| GREEN confirmed             | ✅     | Fresh focused execution passes 33/33; full suite passes 50 files and 718 tests.                                                                                     |
| Triangulation adequate      | ✅     | Custom pattern, custom directory, overlapping default direct, overlapping default transitive, empty, partial, and page-boundary variants assert different outcomes. |
| Safety nets recorded        | ✅     | Original and remediation safety nets are explicit; remediation records unit 13/13 and MCP 20/20 before its RED edits.                                               |

**TDD compliance**: 6/6 checks passed.

## Test layer distribution

| Layer       | Change-focused evidence                           | Changed files | Tools                       |
| ----------- | ------------------------------------------------- | ------------: | --------------------------- |
| Unit        | Resolver and public-error behavior                |             2 | Vitest                      |
| Integration | MCP, batch, inventory, agent, stdio, CLI, package |             4 | Vitest, MCP client, scripts |
| E2E/browser | Not applicable                                    |             0 | Not configured              |

The full suite passes 718 tests across 50 files. Built-artifact smokes independently cover MCP stdio, lifecycle, CLI, public errors, and package installation.

## Changed file coverage

Coverage analysis skipped — the project has no coverage script, Vitest coverage configuration, direct coverage package, or enforced threshold.

## Assertion quality

All six changed test files were scanned. Fixed arrays/non-empty inventories guard assertion loops; empty-result assertions have companion non-empty behavior; type-presence assertions are followed by behavioral use; and no tautologies, production-free assertions, ghost loops, smoke-only assertions, CSS/internal-state coupling, or mock-heavy ratios were found.

**Assertion quality**: ✅ All assertions verify real behavior.

## Quality metrics and independent commands

| Exact command                                                                                   | Exit | Exact output SHA-256                                               | Outcome                                                                             |
| ----------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `env -u GIT_PAGER -u PAGER yarn test test/test-candidates.test.ts test/mcp.integration.test.ts` |    0 | `194cdf47a35b51fea431d770055eb9abb527675881421c25930a1c7358fc7481` | Focused correction gate: 2 files, 33 tests passed.                                  |
| `env -u GIT_PAGER -u PAGER yarn test test/batch.test.ts`                                        |    0 | `de528e8d4dbbe673bd889b029194f218ae21b309e836bb9682a4fb1a6117884f` | Batch parity gate: 15/15 passed.                                                    |
| `env -u GIT_PAGER -u PAGER yarn format:check`                                                   |    0 | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` | Final admitted report and all matched files use Prettier style.                     |
| `env -u GIT_PAGER -u PAGER yarn lint`                                                           |    0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | No lint findings.                                                                   |
| `env -u GIT_PAGER -u PAGER yarn typecheck`                                                      |    0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Canonical source/test typecheck passed.                                             |
| `env -u GIT_PAGER -u PAGER yarn test`                                                           |    0 | `c625ad7de5d3bdb1a1e8294cb766b2fc13dc4a110de7731fd6f175f6d7abc0e1` | Full suite: 50 files, 718 tests passed.                                             |
| `env -u GIT_PAGER -u PAGER yarn build`                                                          |    0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Build passed.                                                                       |
| `env -u GIT_PAGER -u PAGER yarn test:mcp`                                                       |    0 | `f6992c50347923ee24cd77dd073d4dd5cb8a6750be8cb0eb94f2b0e097f3fb91` | Exact 16-tool stdio, SQLite, TOON, and error smoke passed.                          |
| `env -u GIT_PAGER -u PAGER yarn test:lifecycle`                                                 |    0 | `5deacb3394f568e40e07f6a59dda32ae9581de0349ae192dc23b32a64824890f` | EOF, signals, drain, rejection, completion-critical, and zero-orphan checks passed. |
| `env -u GIT_PAGER -u PAGER yarn test:cli`                                                       |    0 | `9d2f6885318db97926a1ce153ccfe48ad91391ec2cf7f14bbe6cc4a9534e636b` | Candidate JSON/TOON parity and all existing CLI gates passed.                       |
| `env -u GIT_PAGER -u PAGER yarn test:errors`                                                    |    0 | `64808d39e1f9b163a451e6916be5741367be59396cf73c5b34b831973fb78733` | Compiled hostile-error and stderr-correlation checks passed.                        |
| `env -u GIT_PAGER -u PAGER yarn test:package`                                                   |    0 | `3a5fb78969990cd8e17d3a174217d0eeb7d177c92f7f2ef6feb3b15315d3774c` | Tarball, SQLite restart, install, six-agent, and idempotency gates passed.          |

Before report replacement, the canonical formatter correctly identified only the historical failed `verify-report.md` as unformatted (exit 1, output SHA-256 `fa9b4137224409c6ea08a7f196927b66c815ddf0965dee1c71610ae08a73c3e6`). The admitted report replaces that historical artifact and the final canonical formatter passes.

## Findings

### CRITICAL

None.

### WARNING

1. The AST MCP diagnostic session reports three pre-existing TS1470 diagnostics caused by its compiler-session module interpretation of unchanged `import.meta` expressions. Canonical typecheck and build pass; this is not candidate-caused.

### SUGGESTION

None.

## Harness disposition and cleanup

- Required focused checks, full tests, build, runtime smokes, package validation, and check-only quality gates completed at the host boundary.
- No product, source, test, planning, or task artifact was modified by verification.
- Verification changes only this `verify-report.md` and its Engram mirror.
- No staging, commit, branch, push, or PR operation was performed.
- Unrelated untracked files retain SHA-256 values `dc229499ba545927e89ff9caa8e4b9a624b1b2cf34b747a98c3a3b780e7d01b1` and `df75a6c68d047ef417c74e13db3ac725a1325af21d2ff1067ffcdaf6d1755e9b`.

## Final verdict

**PASS WITH WARNINGS**. The correction satisfies the convention-driven classification requirement without changing default direct/transitive reasons. All seven requirements, eleven scenarios, twelve tasks, and required runtime/quality gates pass. The only warning is a proven pre-existing AST diagnostic-session mismatch.
