```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:e794b7f919fcd8a1855fbabeadf4546c22e726427ecb0fe37d3cc97f1f227335
verdict: pass
blockers: 0
critical_findings: 0
requirements: 11/11
scenarios: 11/11
test_command: env -u GIT_PAGER yarn test
test_exit_code: 0
test_output_hash: sha256:14e882952df752a0a85d9f68c3689209860c54e1d82be27ea5e9681dc82d962c
build_command: yarn build
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verification Report

**Change:** `2026-09-07-issue-265-required-quality-gates`
**Issue:** #265, OPEN, `status:approved`, `type:bug`
**Mode:** Dedicated strict SDD / Strict TDD verification
**Verification time:** 2026-09-07T20:01:56Z
**Exact candidate HEAD:** `66ae5fc661eb82a9ef96910fda7e9d3f6ee775b4` (PR #276)
**Runtime correction:** `8d1ac82b635282f38a38d5cf29705650cd20ff06` (PR #275)
**U2:** `41d3121f337e862626b5edf4b11639d9d10298fd` (PR #273)
**U1:** `4e4a42860a447d6246c29e1bd76b73f37db52fbf` (PR #272)
**Verification token:** `sha256:e794b7f919fcd8a1855fbabeadf4546c22e726427ecb0fe37d3cc97f1f227335`
**RDD mode:** `disabled/unmanaged`; no receipt, review, delivery, settle, merge, or archive authority is claimed.

## Verdict

**PASS — all 11 requirements and 11 scenarios are compliant on exact candidate `66ae5fc`; the terminal scoped dual Judgment is APPROVED with zero open severe findings; local Node 22.13.0/24.16.0, full, packaging, lifecycle, audit, adapter, cleanup, and exclusion gates pass; and both push and pull-request CI runs are green at the exact candidate SHA.**

Tasks 3.3 and 3.4 remain intentionally pending because merge/delivery and the later issue-247 rebase require separate authority and were explicitly excluded from this verification. No settle, commit, push, PR/issue mutation, merge, archive, source edit, test edit, package edit, lock edit, or Harness edit was performed.

## Candidate Identity and Judgment Gate

- `HEAD` is exactly `66ae5fc661eb82a9ef96910fda7e9d3f6ee775b4`, parent `8d1ac82b635282f38a38d5cf29705650cd20ff06`.
- U1 `4e4a428`, U2 `41d3121`, and runtime correction `8d1ac82` are all ancestors of `66ae5fc`.
- `8d1ac82..66ae5fc` changes only four current-change metadata files: `apply-progress.json`, `judgment-day.json`, `state.yaml`, and `tasks.md`.
- `judgment-day.json` records two independent scoped round-1 results, both `APPROVED`, C1 closed, zero confirmed or suspect correction-caused severe findings, zero contradictions, and `openSevere: 0`.
- The five open Judgment rows I2–I6 are INFO only. This report supplies I4's previously pending exact-candidate Node 22 and remote CI evidence without mutating the frozen Judgment ledger; all INFO rows remain visible and non-severe.

**JUDGMENT: APPROVED ✅**

## Completeness and Task Progress

| Metric                         | Result                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Normative requirements         | 11/11 compliant                                                                                 |
| Normative scenarios            | 11/11 compliant                                                                                 |
| Focused issue tests            | U1 28/28 twice; U2 1/1 twice; workflow 17/17 twice; combined Node-cell suite 46/46 in each cell |
| Full ordinary suite            | 76 files, 994/994 passed                                                                        |
| Supervised suite               | 1 file, 2/2 passed                                                                              |
| Adapter matrix                 | Two successful complete smokes per Node matrix cell                                             |
| Checklist after reconciliation | 15/17 checked; 3.3 delivery and 3.4 issue-247 rebase remain pending                             |
| Coverage tool                  | Not configured; skipped without failure                                                         |

## Exact 11/11 Requirement and Scenario Matrix

|   # | Requirement / scenario                                               | Executed evidence                                                                                                                                                                            | Result    |
| --: | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
|   1 | R1 Private Corepack state / Closed Corepack environment              | `private-pnpm.test.ts` verifies every authority path below the disposable root and all controls before install; passed repeatedly in both Node cells                                         | COMPLIANT |
|   2 | R2 Exact pnpm identity and integrity / Identity admitted             | Version/digest rejection assertions plus four adapter summaries report exact `pnpm@11.7.0+sha512.19cc...d620` before profile installation                                                    | COMPLIANT |
|   3 | R3 No ambient authority / Host state ignored                         | Hostile PATH/HOME/Corepack/cache test passes; private PATH and homes win; adapter summaries bind private pnpm and pinned Harness identity                                                    | COMPLIANT |
|   4 | R4 Bounded cleanup and repetition / Repeated isolated execution      | Repeated success/failure root test, four complete adapter teardowns, zero residue, and zero owned processes                                                                                  | COMPLIANT |
|   5 | R5 Fail-closed fallback launcher / Corepack incompatibility          | Classifier negatives, version/integrity failures, real copied-Corepack-shim regression, regular-file containment, exit 23 propagation, and SIGTERM propagation all pass                      | COMPLIANT |
|   6 | R6 Patched transitive resolutions / Parent ranges remain satisfied   | Dependency policy test proves `fast-uri@3.1.6`, `qs@6.16.0`, absence of old locks, and ajv/express/body-parser parent ranges                                                                 | COMPLIANT |
|   7 | R7 Immutable audit-safe graph / Clean immutable install and audit    | Yarn 4.15.0 immutable install and audit each pass twice under both Nodes; manifest/lock hashes remain unchanged                                                                              | COMPLIANT |
|   8 | R8 Supported Node matrix / Both matrix cells pass                    | Local exact Node 22.13.0 and 24.16.0 cells pass focused, install, audit, and two adapter smokes; exact-SHA CI passes both cells twice                                                        | COMPLIANT |
|   9 | R9 Workflow topology preservation / No CI weakening                  | Workflow test 17/17 twice, executable checker `3 workflows, 9 jobs, 24 actions`, and unchanged CI blob `c14a3ebb...`                                                                         | COMPLIANT |
|  10 | R10 Harness and relationship exclusion / Excluded surfaces unchanged | `src`, skills, Harness, MCP/API/schema/registration, relationship, impact, candidate, and all workflow objects are unchanged from planning base; complete full/MCP/CLI/error smokes pass     | COMPLIANT |
|  11 | R11 Independent rollback / Safe work-unit rollback                   | `chain.md` preserves U1 and U2 revert boundaries, forbids removing U1 beneath U2, and requires complete-candidate rollback only after a superseding fix; rollback was reviewed, not executed | COMPLIANT |

## Fresh Commands and Results

| Command / gate                                                                         | Result                                                               |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `yarn vitest run test/private-pnpm.test.ts test/dsh-adapter.test.ts --reporter=dot` ×2 | 0 both; 2 files, 28/28 each                                          |
| `yarn vitest run test/dependency-policy.test.ts --reporter=dot` ×2                     | 0 both; 1/1 each                                                     |
| `yarn vitest run test/workflow-policy-check.test.ts --reporter=dot` ×2                 | 0 both; 17/17 each                                                   |
| Combined four-file focused suite on Node 22.13.0 and Node 24.16.0                      | 0 both; 4 files, 46/46 per cell                                      |
| `yarn format:check`                                                                    | 0; all files formatted                                               |
| `yarn lint`                                                                            | 0                                                                    |
| `yarn typecheck`                                                                       | 0                                                                    |
| `env -u GIT_PAGER yarn test`                                                           | 0; 994/994 ordinary + 2/2 supervised; output SHA-256 `14e882...962c` |
| `yarn build`                                                                           | 0; output SHA-256 `e3b0c442...b855`                                  |
| `yarn test:mcp`                                                                        | 0; stdio, 16 tools, JSON/TOON enabled                                |
| `yarn test:lifecycle`                                                                  | 0; EOF/signals/drains/supervision clean, zero orphans                |
| `yarn test:cli`                                                                        | 0; CLI read/apply/replay/discovery/setup/upgrade checks pass         |
| `yarn test:errors`                                                                     | 0; compiled sanitized errors pass                                    |
| `yarn test:package`                                                                    | 0; packed install, handshake 0.13.1, cache and agent setup pass      |
| `yarn pack --dry-run --json`                                                           | 0; expected package contents listed                                  |
| `node scripts/workflow-policy-check.mjs`                                               | 0; 3 workflows, 9 jobs, 24 actions                                   |
| `git diff --check HEAD^ HEAD`                                                          | 0                                                                    |

The first broad `yarn test` invocation failed one canary assertion because the Harness session exported forbidden `GIT_PAGER=cat`; the production predicate reported that ambient control before the test's expected duplicate-input branch. Re-running the documented clean command `env -u GIT_PAGER yarn test` passed completely and was repeated for the final hashed evidence above. A mistakenly named `test/workflow-policy.test.ts` probe found no file; the actual registered test `test/workflow-policy-check.test.ts` then passed twice.

## Node, Package Manager, and Adapter Matrix

| Cell         | Yarn immutable | Audit                      | Focused | Adapter run 1                      | Adapter run 2                      |
| ------------ | -------------- | -------------------------- | ------- | ---------------------------------- | ---------------------------------- |
| Node 22.13.0 | 2/2 pass       | 2/2 `No audit suggestions` | 46/46   | `DSH_ADAPTER_SMOKE_OK`, cleanup ok | `DSH_ADAPTER_SMOKE_OK`, cleanup ok |
| Node 24.16.0 | 2/2 pass       | 2/2 `No audit suggestions` | 46/46   | `DSH_ADAPTER_SMOKE_OK`, cleanup ok | `DSH_ADAPTER_SMOKE_OK`, cleanup ok |

All four adapter summaries report pnpm `11.7.0`, exact descriptor/digest, source `corepack`, pinned Harness revision `cd5ef814...`, Harness runtime Node `v24.16.0`, phases A/B/C/H03/H05/D `ok`, zero owned processes, and profile/control removal. The Node 22.13.0 outer cell deliberately resolves the qualifying Node 24 Harness runtime through the bounded toolcache fixture, matching the checked design and CI topology.

A first local adapter attempt using the provided Harness working checkout as `DSH_HARNESS_SOURCE` blocked at Git identity because that checkout could not supply the required source Git identity to the smoke. The attempt cleaned its complete temporary root and left Corepack unchanged. The authoritative remote-source retry then passed twice per Node cell. This was an input-fixture limitation, not a candidate failure.

## Immutable Hashes and Corepack Host Non-Mutation

| Artifact                          | Before                                                             | After     |
| --------------------------------- | ------------------------------------------------------------------ | --------- |
| `package.json`                    | `55e22e8885db36a4ccceb878aefabbc30977b249481621ab2ca615b9da230961` | identical |
| `yarn.lock`                       | `7c735bc093c6c704228bd29c70b41599c7d6054ac53a59854a72b1f06f6c9ad1` | identical |
| Node 22.13 Corepack `corepack.js` | `3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9` | identical |
| Node 22.13 Corepack `pnpm.js`     | `7c2a67995976b5b592b611d8b236e3b0633bd654fb49aedd96c6eb7ce04c9cbb` | identical |
| Node 24.16 Corepack `corepack.js` | `3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9` | identical |
| Node 24.16 Corepack `pnpm.js`     | `7c2a67995976b5b592b611d8b236e3b0633bd654fb49aedd96c6eb7ce04c9cbb` | identical |

Fresh residue scan found no `ast-dsh-adapter-*`, `private-pnpm-test-*`, or `ast-node-toolcache-*` roots. The real copied-Corepack fixture test passed repeatedly and proved the fixture-global `dist/pnpm.js` bytes remain unchanged while the private symlink is replaced by a contained regular launcher. Exit and signal forwarding assertions passed.

## Remote Exact-SHA CI and PR Chain

GitHub reports no branch-protection-designated required checks on the chained feature branches (`gh pr checks --required` returned none). The repository's policy-mandated `CI / quality` matrix is nevertheless treated as required by the spec.

| PR   | Exact head                                 | Exact-head quality checks        | Interpretation                                                                                  |
| ---- | ------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| #272 | `4e4a42860a447d6246c29e1bd76b73f37db52fbf` | Node 22 FAIL ×2; Node 24 FAIL ×2 | Stale U1-only pre-U2/pre-correction head; non-green historical evidence, not candidate evidence |
| #273 | `41d3121f337e862626b5edf4b11639d9d10298fd` | Node 22 PASS ×2; Node 24 PASS ×2 | Initial U1+U2 candidate, predates Judgment correction                                           |
| #275 | `8d1ac82b635282f38a38d5cf29705650cd20ff06` | Node 22 PASS ×2; Node 24 PASS ×2 | Corrected runtime source candidate                                                              |
| #276 | `66ae5fc661eb82a9ef96910fda7e9d3f6ee775b4` | Node 22 PASS ×2; Node 24 PASS ×2 | Exact requested candidate, green push and pull-request CI                                       |

Exact candidate run `34156045218` (push) and run `34156074124` (pull request) are both completed `success` at SHA `66ae5fc661eb82a9ef96910fda7e9d3f6ee775b4`. All four exact-SHA check runs completed successfully; no pending or non-green candidate check remains.

## Exclusions, Workflow, Budget, and Rollback

- `.github/workflows/ci.yml` is unchanged: planning-base and HEAD Git blob are both `c14a3ebb1843c5bb8c8e0da22ab4ae7e5e424c3e`.
- No `src`, Harness, skills, public API, MCP schema/tool registration, relationship, impact, test-candidate, or workflow source changed in the issue-265 implementation chain.
- Work-unit authored totals remain bounded: U1 395, U2 314, correction round 1 225 including metadata (correction code/test delta is 128). Each is at or below 400; the chain, rather than one oversized review unit, holds the complete candidate.
- Rollback was not executed. The documented boundary removes U1 provisioning/tests and U2 resolutions/generated lock only after a superseding gate fix, never issue #247 or Harness. Judgment INFO I3 about combined-versus-separate wording remains visible and non-blocking.

## Strict TDD, Assertion Quality, and Engineering Quality

| Check                 | Result | Details                                                                                                      |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| TDD evidence reported | PASS   | `apply-progress.json` retains RED/GREEN/refactor evidence for U1, U2, and R1-C1                              |
| Tests exist           | PASS   | `private-pnpm.test.ts`, `dsh-adapter.test.ts`, `dependency-policy.test.ts`, workflow policy test             |
| GREEN re-executed     | PASS   | All focused suites passed twice; combined suite passed under both Nodes                                      |
| Real boundary         | PASS   | Real copied Corepack, packed MCP/package, stdio, lifecycle, CLI, browser/Harness adapter boundaries executed |
| Assertion quality     | PASS   | No tautology, `.only`, ghost-loop, type-only-only, or no-production-call finding in issue tests              |
| Lint/type/format      | PASS   | Repository-wide checks pass                                                                                  |
| Coverage              | N/A    | No configured coverage command/provider                                                                      |

Names expose precise authority/containment intent; comments explain invariants and platform behavior; the helper remains private to runtime scripts. Timeouts are finite, output is bounded, no retries or mutable global cache were added, and process-tree/root cleanup is exercised. The fallback fails closed on unclassified failures and preserves child exit/signal outcomes. Security and supply-chain checks include exact registry integrity, local archive digest, exact version readback, immutable lock hashes, and clean audits.

## Blockers and Next Recommended

**Verification blockers:** none.
**Post-verification pending work:** task 3.3 independent merge/delivery and task 3.4 issue-247 root-to-child rebase/reverification. These remain outside this token and permission scope.
**nextRecommended:** `resolve-blockers` — obtain separate repository delivery authority for 3.3, then perform 3.4 under its own authority. Do not infer delivery, settle, merge, archive, or issue authority from this PASS or Judgment.

## Skill Resolution

Loaded and applied `dsh-sdd`, `daily-engineering-quality-gates`, `javascript-package-manager-operations`, `bounded-async-runtime-engineering`, `rdd-defect-workflow`, and `judgment-day`.

The requested exact file `/home/yail/.local/share/dsh-oauth-cutover/cd5ef8148158c3a752a658978873241fdf8e2bbc/dsh-home/skills/dsh-sdd/_shared/sdd-verify.md` does not exist in this checkout. Verification therefore loaded the installed fallback contracts at `/home/yail/.agents/skills/sdd-verify/{SKILL.md,strict-tdd-verify.md,references/report-format.md}` and `/home/yail/.agents/skills/_shared/sdd-status-contract.md`. The `gentle-ai` binary and native `sdd-verify-validate` are unavailable, so this report is a manually validated OpenSpec result written because the direct request explicitly required the artifact; no native-validator or archive authority is claimed.

## Key Learnings

1. Exact candidate `66ae5fc` contains the approved correction runtime unchanged and now has two fully green remote CI executions across both Node cells.
2. The private package-manager boundary repeatedly selects exact pnpm 11.7.0 while leaving both installed Corepack distributions byte-identical.
3. Four local adapter smokes and the copied-Corepack fixture prove bounded cleanup, host non-mutation, process quiescence, and exact Harness identity.
4. Patched dependency resolution is stable under repeated immutable installs and clean audits on Node 22.13.0 and 24.16.0.
5. Verification passes independently, while merge/delivery and issue-247 rebase remain separate pending authority-bound tasks.
