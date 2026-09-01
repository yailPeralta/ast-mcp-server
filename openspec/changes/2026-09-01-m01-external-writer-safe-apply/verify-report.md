```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:966ab97cc89a921dd03642910042bfc0e3705955f8b4d1e4d618a73f9c98d423
verdict: pass
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 11/11
test_command: "env -u GIT_PAGER yarn test"
test_exit_code: 0
test_output_hash: sha256:cfea81daa2fd0707fa1c32a45dc78208947807d922488015078816d23e7540a4
build_command: "env -u GIT_PAGER yarn build"
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

- **Change**: `2026-09-01-m01-external-writer-safe-apply`
- **Artifact store**: OpenSpec/hybrid state; file artifacts are authoritative for this verification.
- **Mode**: Strict TDD
- **Branch / candidate**: `docs/m01-verify`; HEAD `dd48f3404d029e7bd310bdd1d662967334144743`; tree `d2f433f9eb7e7d6027e095d5a67caf73f72ed627`.
- **Lineage handed to verification**: `sha256:966ab97cc89a921dd03642910042bfc0e3705955f8b4d1e4d618a73f9c98d423`.
- **Approved authority**: issue #127 is OPEN with `status:approved` and `type:bug`; its scope and non-goals match this change.
- **Verdict**: **PASS**.

### Completeness

| Metric             |     Result | Evidence                                                                                                                                                      |
| ------------------ | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirements       |   7/7 PASS | Seven `### Requirement:` headings in the delta spec.                                                                                                          |
| Scenarios          | 11/11 PASS | Eleven `#### Scenario:` headings, each covered by passing runtime evidence below.                                                                             |
| Tasks              | 16/16 PASS | `tasks.md` has 16 checked and zero unchecked boxes; `state.yaml` and `apply-progress.json` agree.                                                             |
| TDD terminal state |       PASS | `apply-progress.json`: 0 RED, 9 GREEN, 1 refactored; historical RED commit `0b1f456` precedes implementation.                                                 |
| Issue scope        |       PASS | #127 requires deterministic replacement/config/multi-file races, owned rollback, bounded failure, retained invariants, Harness denial, and <=400-line slices. |

### 7-Requirement / 11-Scenario Compliance Matrix

| Req.                                                  | Scenario                               | Exact runtime/code evidence                                                                                                                                                                                                                                    | Result |
| ----------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R1 Creation is held and no-clobber                    | Competitor wins creation               | `test/operations.test.ts > creation race preserves the competitor and reports conflict`; `authenticated-publication.test.ts > does not clobber a competing creation`; `linkHeldFile` at `authenticated-publication.ts:121-126`.                                | PASS   |
| R2 Replacement authenticates displaced preimage       | External write follows final check     | `operations.test.ts > replacement preserves a substituted destination after final authentication` and `> same-inode bytes and mode edits remain current`; exact-pair logic `authenticated-publication.ts:179-202`.                                             | PASS   |
| R2                                                    | Distinct configurations share one file | `operations.test.ts > distinct configurations cannot overwrite a shared physical file`.                                                                                                                                                                        | PASS   |
| R3 Multi-file apply is sequential                     | Later target conflicts                 | `operations.test.ts > multi-file apply preserves a later external target`; reverse traversal `operations.ts:1113-1135`.                                                                                                                                        | PASS   |
| R3                                                    | Owned rollback loses proof             | `operations.test.ts > rollback preserves a changed earlier commit and reports ambiguity`; hidden evidence count is asserted; `rollbackOwnedCommit` at `authenticated-publication.ts:137-158`.                                                                  | PASS   |
| R4 Outcomes distinguish effect/ownership              | Required capability unavailable        | `operations.test.ts > unsupported publication capability has zero source effects and is mutation blocked`; all-parent preflight `operations.ts:1006-1043`; no fallback filesystem rename/copy/delete exists in structural publication.                         | PASS   |
| R4                                                    | Post-effect ownership unknowable       | Previous rollback test plus `operations.test.ts > preserves a created destination and hidden stage when rollback is ambiguous`; preserve-only settlement `operations.ts:1107-1109,1137-1144`.                                                                  | PASS   |
| R5 Existing operation invariants remain authoritative | Receipt persistence fails after commit | `operations.test.ts > recovers an applied operation from exact postimages after receipt persistence fails` and scaffold counterpart; `persistReceipt`/postimage recovery `operations.ts:900-910,960-978,1162-1165`.                                            | PASS   |
| R5                                                    | Replay and cancellation                | `operations.test.ts > serializes concurrent apply retries and returns an idempotent receipt`, `> ignores cancellation after the first source write until apply is consistent`, and `> releases a cancelled cross-session write-lock waiter for later retries`. | PASS   |
| R6 Support and Harness boundaries remain closed       | Target or Harness lacks authority      | Capability test above; `mcp.integration.test.ts > denies the apply tool while keeping reads, prepare and preview under the guard`; Harness unit/runtime evidence below.                                                                                        | PASS   |
| R7 Race tests are deterministic                       | Barrier-controlled race                | Named tests use `holdFilePhase`/promises and `onFilePhase(operationId,file,index,phase)` (`operations.ts:121-133`); no sleep/polling is used for these races.                                                                                                  | PASS   |

**Compliance summary**: **7/7 requirements and 11/11 scenarios PASS**.

### Publication, Recovery, and Threat-Boundary Inspection

- **No destructive pathname publication/rollback**: structural source publication calls held-descriptor `ln -L -T` or same-directory `mv --exchange --no-copy -T`; repository search found no filesystem `rename`, copy/delete, or pathname-only rollback in `operations.ts`. The only `rename` match is a ts-morph symbol rename during plan construction.
- **Held lifetimes**: `stageFile` opens and retains parent, stage, and replacement preimage handles (`operations.ts:707-768`). They remain in `HeldPublication.handles` through commit/rollback and close only in `cleanupHeldPublication`, `closeHeldPublication`, or preserve-only settlement (`798-824`).
- **Child settlement**: primitive spawn resolves/rejects only on `close`, with fixed executable/argv/env, no shell, bounded stderr, timeout, and kill (`authenticated-publication.ts:82-113`). Identity, not child exit alone, determines effect.
- **Capability preflight**: every distinct parent is behavior-probed before the publication loop (`operations.ts:1006-1043`); failure maps to `MUTATION_BLOCKED` before source effects.
- **Exact-pair classification**: replacement authenticates destination=stage, displaced=held preimage including dev/ino/hash/mode; conflict rollback exchanges back only after pair validation; unknown state is `AMBIGUOUS_APPLY` (`authenticated-publication.ts:137-202`).
- **Cleanup/preservation**: cleanup removes only an entry matching its complete owned identity (`127-135`). Ambiguity nulls cleanup identity and closes descriptors while preserving visible/hidden entries (`operations.ts:813-824,1107-1109,1137-1144`).
- **Completion-critical ordering**: admission/checkpoints occur before source effect; completion-critical begins immediately before the first publish (`operations.ts:1044-1059`) and receipt persistence happens only after all commits, directory sync, and settlement (`1103-1105,1162-1165`).
- **Receipts/replay/cancellation**: postimage recovery and applied replay require exact updated hashes; receipt failure does not repeat mutation; cancellation is deferred after completion-critical entry. Focused and full tests pass.
- **Orphan behavior**: focused no-orphan/scheduler tests pass; ambiguity deliberately retains hidden namespace evidence (two hidden entries for lost replacement rollback, one for post-create failure) rather than deleting evidence.

#### Threat boundary adjudication

**PASS, with an explicit scope limitation.** The accepted guarantee is deterministic external substitution or same-inode bytes/mode changes at the named pre-publication and pre-rollback hooks, plus the exact overlapping-config and multi-file acceptance interleavings. It is **not** a guarantee against a continuously racing arbitrary or hostile same-user writer. Proposal lines 21-26 exclude arbitrary-writer coordination; `docs/support.md:31-35` and ADR 0001 lines 79-83 explicitly disclaim malicious/continuous writers and global multi-file atomicity. The spec's MUST language is therefore read within that declared threat model and its eleven acceptance scenarios, not as universal linearizability. The implementation and docs do not claim more.

### Commands and Exact Results

| Command                                                                                                                                                                   |       Exit | Exact-output SHA-256                                                      | Result                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `env -u GIT_PAGER yarn vitest run test/operations.test.ts -t 'replacement                                                                                                 | same-inode | creation race                                                             | distinct configurations                                                           | multi-file | rollback | unsupported | receipt | replay | cancellation | does not orphan | scheduler' --reporter=dot` | 0   | `sha256:b417ab81f78e7ae63c5e72d92c9abcf1c9a74ec3929c1c6bfb43c87531482333` | 19 passed, 15 skipped. |
| `env -u GIT_PAGER yarn vitest run test/authenticated-publication.test.ts test/managed-guidance.test.ts test/public-errors.test.ts --reporter=dot`                         |          0 | `sha256:1fe657898ff0635ac3f8a16f41b27b9a0be65a6e91eb775289dc11660a89a793` | 76 passed.                                                                        |
| `env -u GIT_PAGER yarn test:errors`                                                                                                                                       |          0 | `sha256:64808d39e1f9b163a451e6916be5741367be59396cf73c5b34b831973fb78733` | Compiled hostile-error/correlation smoke OK.                                      |
| `env -u GIT_PAGER yarn test`                                                                                                                                              |          0 | `sha256:cfea81daa2fd0707fa1c32a45dc78208947807d922488015078816d23e7540a4` | 74 files/937 tests plus supervised 1 file/2 tests.                                |
| `env -u GIT_PAGER yarn build`                                                                                                                                             |          0 | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | TypeScript build passed with empty stdout/stderr.                                 |
| `env -u GIT_PAGER bash -c 'yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build && node scripts/ci-prepare-gnu-mv.mjs probe && yarn test:package'` |          0 | `sha256:314440df63309964521b6df5eb4154b6360222d05e192fd21ff52cfe45477c11` | Format/lint/typecheck/build pass; 937+2 tests; GNU mv 9.7 pass; package smoke OK. |
| `git diff --check`                                                                                                                                                        |          0 | N/A                                                                       | PASS.                                                                             |

Coverage is not configured. Formatter, linter, typechecker, build, package smoke, primitive probe, public-error smoke, and full tests all pass.

### Harness Evidence

- `env -u GIT_PAGER yarn vitest run test/dsh-adapter.test.ts test/tool-catalog.test.ts --reporter=dot`: exit 0, 23 passed, output `sha256:06881e936587880991d3e28a9ce7a17dd674141d629d61e5df25988c5528824e`.
- `env -u GIT_PAGER yarn test:dsh-adapter`: exit 0, `DSH_ADAPTER_SMOKE_OK`, output `sha256:cf964ce3890e84545e660bcb969d46f6e9b295ff567ba9367eddd3fe30175859`.
- Runtime result is pinned to Harness revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`, tag/client `0.1.2-alpha.1`, and reports catalogs **15/0/15**. The rendered guarded names contain exactly 15 tools and omit apply.
- Static/runtime smoke contract requires direct `mcp__ast__ast_apply_operation` rejection with `UNKNOWN_TOOL`; integration denial also passed in the 937-test gate.
- `git diff origin/main...HEAD` and impl-5 diff contain no pinned Harness checkout/config/patch changes; only repository smoke call-site hook migration occurred earlier, with no catalog/guard edit.

### Task, TDD, Receipt, PR, and Budget Evidence

- All 16 checkboxes are checked. Final protocol state is exactly **0 RED / 9 GREEN / 1 refactored**. The nine named GREEN files exist and pass; the refactor safety net passes. Historical PR #131/commit `0b1f456` preserves seven deterministic RED assertions before GREEN implementation.
- Assertion audit of the changed `operations.test.ts` and new `authenticated-publication.test.ts` found no tautology, ghost loop, production-free assertion, smoke-only assertion, or orphan empty assertion. Tests call production publication/apply and assert concrete bytes, inode/mode, public code, or retained hidden-entry count.
- PR chain bases are exact: #128→`main`; #129→tracker; #130→planning-1; #131→planning-2; #132→impl-1; #133→RED evidence; #134→primitive; #135→primitive evidence; #136→operations; #137→operations evidence; #138→rollback; #139→rollback evidence. Every PR is OPEN and has exactly one `type:*` label.
- Current GitHub changed-line totals for PRs #128-139 are **23, 239, 275, 310, 125, 397, 130, 218, 162, 174, 184, 393**: all <=400. PR #133 and #135 body arithmetic is stale relative to current GitHub diff counts, but both remain safely under budget.
- PR body receipts visible in repository/GitHub evidence: #132 `sha256:1fc742f5d0a187cc4b8c94023aca3c3dd264245c006d8358270432392e4c4a7e`; #134 `sha256:838444ee836d9f88dd76d4480e3b51baf6e721755f90c43d58eaff51f5548e72`; #136 `sha256:bbb940962990e7f66df929c4886420402aa0528efd1a1efe10da1521aaa7ea7e`; #138 `sha256:9d23f29752062666da8ad54b8dcd451b6fcd6ee607663b674b90ecbff1db98de`; #139 `sha256:a6277736d4d65105865ce19f519a5d869dcb3f4e78d97f9a590b2472b38eb738`.
- Receipt byte preimages/native ledgers are not committed and were not available through GitHub, so those five hashes are **proven present as claims but independently INCONCLUSIVE as cryptographic receipts**. The supplied verification lineage was likewise not found in repository/GitHub text; it is retained as handed-off authority, not falsely re-derived. Functional/runtime PASS does not rely on apply narration.
- PR #139 points exactly to candidate HEAD and currently has successful Node 22.13.0 and Node 24 CI quality checks.

### Structural Evidence Trust

The AST MCP tools were available by schema but returned no model-visible payload for status/outlines, so no compiler-authoritative AST relationship claim is made. Exact bounded source reads and repository search were used as a declared non-compiler-backed fallback; independent `yarn typecheck`, build, and runtime suites passed.

### Findings and Residual Risks

- **CRITICAL**: None.
- **WARNING**: None blocking PASS.

**Residual risks**:

1. Continuously racing arbitrary/hostile same-user writers remain outside the guarantee; they can invalidate any check-to-cleanup interval.
2. Multi-file apply is sequential, not globally atomic; ambiguity can intentionally leave committed destinations and hidden stages for inspection.
3. Filesystems/platforms outside Linux x64 plus the actual procfs/GNU link/exchange identity probe matrix remain unsupported.
4. Historical receipt hashes cannot be independently recomputed from repository/GitHub evidence, and two PR body line-count narratives are stale though under budget.

### Recommendation

Proceed to **`judgment-day`** for independent adversarial dual review. No remediation is required from this verification. Judgment should specifically challenge the continuous-writer boundary, same-inode cleanup race, ambiguity evidence preservation, and receipt provenance without broadening the eleven accepted scenarios.

### Final Verdict

**PASS** — 7/7 requirements, 11/11 scenarios, 16/16 tasks, 0 RED/9 GREEN/1 refactored terminal TDD state, focused race/rollback/error/primitive/managed/Harness tests, canonical 937+2 tests, complete clean gate, package probe, exact 15-tool Harness denial, and bounded ambiguity behavior all pass independently at candidate `dd48f3404d029e7bd310bdd1d662967334144743`.
