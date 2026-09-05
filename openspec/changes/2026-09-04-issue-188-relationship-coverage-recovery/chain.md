# Issue #188 Recovery Feature Branch Chain

## Authority and stop conditions

OpenSpec is authoritative in hybrid mode; mirroring is skipped because Harness/control-plane writes are prohibited. Issues #186, #187, and #188 are open with `status:approved`. Issue #161 and PRs #162–#185 are immutable provenance only: never import their OpenSpec, attempts, settlements, reviews, Judgment, CI, archive, Harness snapshots, hashes, or approval claims.

Before apply run:

```bash
/home/yail/.local/bin/gentle-ai review mode status --cwd "$PWD" --json
gh issue view 186 --json state,labels,url
gh issue view 187 --json state,labels,url
gh issue view 188 --json state,labels,url
gh pr list --state open --json number,headRefName,baseRefName,title,url
git fetch origin main && test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --porcelain=v1 --untracked-files=all
git diff --check
```

Stop if approval disappears, main drifts, another authority line conflicts, RDD returns an unsafe/unrecognized state, a child exceeds 400 authored additions+deletions, a child includes ancestor/foreign scope, any receipt/tree differs, #186/#187 is incomplete, review has severe unresolved findings, verification/CI fails, or Harness bytes change. The draft tracker is the primary kill switch; abandon it before merge or revert the final integration after merge.

Phase 0 revalidated this baseline at `2026-09-04T23:34:31Z`: `origin/main` remains `6173a39a73f1540c17335a330ea7f14f982387cb` (tree `ab8b6b4fe739e9cfc939b7cd8c18cf2e09743051`); #186–#188 remain open and approved with exactly one `type:*` label; RDD is `disabled/unmanaged`; planning PRs #189–#193 are clean immediate-parent slices of 364/68/255/77/332 lines with one `type:docs` label each. PR #189 is the draft, merge-unauthorized tracker. U0 authority PR #194 is the feature-chain base at `48e535149d6501fa12ecdd8a78fd4e8366fe7170` (tree `d9e246085c9f237c1e8b86d94cc7b1718be22fe5`). U1 branch `test/issue-188-u1-red` targets PR #194 and uses `Refs #188`; its RED evidence is settled. U2 runtime PR #196 at `d73c1ec` is settled passed by `issue188-u2-a1-settle-20260905t0029z` with evidence `sha256:7046189dd91a030745db242eaf8baa86a697db2463576fb745fd6464606eab50`, remediating U1 evidence `sha256:c3de6e1ecfaf62e645e94e35d7d8fb473c363dd2e8ed1efc6d875580972ccab5`. U3 runtime PR #198 at `37a2084` is settled passed by `issue188-u3-a1-settle-20260905t0045z` with evidence `sha256:ce118867759f2654e243dbbdc519ad0ce1ac8d1fa1bc4f2f3f1c9d62e68aab90`; its acquire was `issue188-u3-a1-acquire-20260905t0033z`. The next child is `feat/issue-188-u4-contains`, based on evidence child `docs/issue-188-u3-evidence`.

## Dependency diagram and review forecast

```text
main 6173a39
 └── draft tracker #189 fix/issue-188-recovery-tracker
      └── planning #190 → #191 → #192 → #193 → U0 authority #194
           └── U1 RED (base: #194)
           └── U2 coverage/tracker ── U2E settlement if budget-bound
                └── U3 scoped calls ── U3E settlement if budget-bound
                     └── U4 contains ── U4E settlement if budget-bound
                          └── U5 schemas/candidates ── U5E settlement if budget-bound
                               └── U6 matrix
                                    └── U7 docs/gates
                                         └── #186A RED/classifier [#186B MCP/spine if >400]
                                              └── #187A accounting [#187B+ exact-bound/finalization if >400]
                                                   └── G1 pre-archive review/verify
                                                        └── G2 archive + post-archive proof
                                                             └── sequential accumulation → tracker → main
```

Forecast: U1–U7 **1,583** known authored lines; #186 **300–480**; #187 provisional **500–800**, independently reforecast before edits; planning/evidence/archive **420–740**. Total **2,800–3,600**, **16–18 review units**. No size exception. Every PR names start/end, immediate predecessor, follow-up, exclusions, focused/runtime evidence, rollback, exact line count, and marks itself `📍`.

## Exact U1–U7 admission table

| Unit | Immediate predecessor | Evidence / exact allowlist                                                                                                                                                                                                                       | Budget | Focused command                                                                                                                                                                 | Rollback                       |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| U1   | U0 / PR #194          | `1a08635520d0d961c5c2887847a664065674f3f8`; `test/mcp.integration.test.ts`                                                                                                                                                                       |     51 | `yarn vitest run test/mcp.integration.test.ts -t "rejects false-complete incoming call emptiness"` twice                                                                        | test only                      |
| U2   | U1                    | `13af89de4976799ccc233c1613699395c378ccf9`; `src/services/{impact,read-contracts,relationships}.ts`, `test/impact.test.ts`                                                                                                                       |    353 | `yarn vitest run test/impact.test.ts test/mcp.integration.test.ts`                                                                                                              | ledger/tracker/tests           |
| U3   | U2 evidence child     | `92db7e2f3ed162ecd69a27d5cc73217e821b4fe0`; `src/services/relationships.ts`, `src/tools/get_impact.ts`, `test/impact.test.ts`                                                                                                                    |    320 | `yarn vitest run test/impact.test.ts test/relationships.test.ts test/call-spines.test.ts`                                                                                       | call producer/projection/tests |
| U4   | U3E or U3             | `19a96218ba7bc3800b1932b7599fca32512f1c37`; `src/services/relationships.ts`, `test/impact.test.ts`                                                                                                                                               |    337 | `yarn vitest run test/impact.test.ts`                                                                                                                                           | contains producer/tests        |
| U5   | U4E or U4             | `15e252e957139f113cec8735afdc10adb77a0a92`; `src/services/{impact,relationships,test-candidates}.ts`, `src/tools/{find_test_candidates,get_impact,relationship-schema}.ts`, `test/{mcp.integration,relationship-schema,test-candidates}.test.ts` |    288 | `yarn vitest run test/test-candidates.test.ts test/relationship-schema.test.ts test/mcp.integration.test.ts`                                                                    | public contract/gate/tests     |
| U6   | U5E or U5             | `3af4fe67f3b3f50947e9a93dce9bf377c9cc5132`; `src/services/read-contracts.ts`, `src/tools/{explore,get_project_status}.ts`, `test/{impact,mcp.integration,read-contracts}.test.ts`                                                                |    202 | `yarn vitest run test/impact.test.ts test/mcp.integration.test.ts test/relationships.test.ts test/call-spines.test.ts test/test-candidates.test.ts test/read-contracts.test.ts` | matrix/vocabulary/tests        |
| U7   | U6                    | `bac52a4de598e0c01412d0d54efdfe9cef3a4353`; `CHANGELOG.md`, `README.md`, `docs/adr/0007-compiler-first-impact-relationships.md`, `docs/adr/0012-public-affected-test-candidates.md`, `docs/ast-mcp-server-harness-improvement-report.md`         |     32 | full gate below                                                                                                                                                                 | docs only                      |

For each Ux, inspect only `git diff <evidence>^ <evidence> -- <allowlist>`, manually re-author against the immediate predecessor, and reject all foreign hunks. U2/U5/U6 explicitly replace stale endpoint-class/28-row expectations with exactly 14 public kind×direction cells; no old `R-01` execution artifact may appear.

U2 used acquire `issue188-u2-a1-acquire-20260904t2353z` (token intentionally not persisted) and passed settlement `issue188-u2-a1-settle-20260905t0029z`. Runtime PR #196 commit `d73c1ec` contains 312 additions and 82 deletions (394 total). Focused RED produced 3 failures; GREEN impact plus registered MCP passed 76/76; typecheck, build, Prettier, ESLint, diff check, and `test:mcp` (`status ok 16`) passed. Evidence `sha256:7046189dd91a030745db242eaf8baa86a697db2463576fb745fd6464606eab50` remediates U1 `sha256:c3de6e1ecfaf62e645e94e35d7d8fb473c363dd2e8ed1efc6d875580972ccab5`. A full MCP inventory hash regression was corrected by making `work_limit` impact-only, leaving unrelated inventories stable. U1 and U2 are refactored with zero active RED. Issue #187 accounting remains unimplemented; both #186 and #187 remain integration kill switches.

U3 used acquire `issue188-u3-a1-acquire-20260905t0033z` and passed settlement `issue188-u3-a1-settle-20260905t0045z`. Runtime PR #198 commit `37a2084` contains 338 additions and 51 deletions (389 total, within the 400-line budget). The impact plus registered MCP baseline passed 76/76; focused scoped-call RED failed 2/2, then GREEN passed 2/2 twice; final impact plus registered MCP passed 78/78 and the call suite passed 67/67. Typecheck, build, `test:mcp`, Prettier, ESLint, and diff check passed. Evidence is `sha256:ce118867759f2654e243dbbdc519ad0ce1ac8d1fa1bc4f2f3f1c9d62e68aab90`. U3 is refactored with zero active RED. Issue #186 callable getter and private-parameter issues remain explicitly unresolved, and issue #187 request-wide accounting is untouched.

## Independent acquire/settle and evidence children

Each runtime-bearing unit uses unique acquire and settle IDs; a child process authenticates the same attempt with `acquire --token "$TOKEN"` rather than acquiring blind.

```bash
CHANGE=2026-09-04-issue-188-relationship-coverage-recovery
/home/yail/.local/bin/gentle-ai sdd-attempt acquire --cwd "$PWD" --change "$CHANGE" \
  --request-id "<unit>-acquire-<nonce>" --work-unit "<unit>" \
  --evidence-goal "<stable scenario goal>" --max-attempts 2 --max-changed-lines 400
/home/yail/.local/bin/gentle-ai sdd-attempt settle --cwd "$PWD" --change "$CHANGE" \
  --token "$TOKEN" --request-id "<unit>-settle-<nonce>" --outcome passed \
  --evidence-revision "sha256:<64hex>" --diagnosis "<proven result>" \
  --harness-disposition invalidated --cleanup-evidence "<status/temp hash>" \
  --process-evidence "<before/after process hash and owned-process count>"
```

A failed run settles `failed`; interruption omits `--evidence-revision`. Never reset automatically. Implementation owns tests/docs but not verbose settlement artifacts when its diff approaches 400: create a separate `UxE` child based on `Ux`, containing only this change's evidence/progress updates, settle it independently, and make the next implementation child target `UxE`.

Per unit capture:

```bash
git diff --numstat "$PARENT"..HEAD -- <allowlist> | awk '{a+=$1;d+=$2} END{print a,d,a+d}'
git diff --binary "$PARENT"..HEAD -- <allowlist> | sha256sum
git rev-parse "$PARENT^{tree}" HEAD^{tree}
git diff --check "$PARENT"..HEAD -- <allowlist>
git status --porcelain=v1 --untracked-files=all | sha256sum
ps -eo pid=,ppid=,stat=,command= | LC_ALL=C sort | sha256sum
```

The evidence revision hashes command, exit code, output, parent/head trees, allowlist, numstat, cleanup, and process readback. Runtime harness is the listed registered MCP command; internal-only units record `N/A` only with the concrete boundary reason.

## #186 and #187 independent children

#186 starts only after U7. Reforecast its own approved change before source edits. If projected total is >400, split **#186A** (compiler-backed RED plus callable-owner/classifier GREEN/refactor) and **#186B** (registered MCP, relationships, and call-spine parity). Both use generous work limits, `Fixes #186`/`Refs #188`, their own acquire/settle and blind review evidence, and never modify request-accounting semantics. Commands:

```bash
yarn vitest run test/impact.test.ts test/relationships.test.ts test/call-spines.test.ts
yarn vitest run test/mcp.integration.test.ts -t "accessor|private|call"
yarn typecheck
```

#187 starts only from accepted #186. Independently inventory/forecast BFS dequeue/dispatch, source-file enumeration sorting, containment-candidate sorting, neighbor sorting/finalization, probing, retention, dedupe, and emission. Split before edits into as many ≤400 slices as needed; every slice has exact-bound and one-below RED/GREEN/refactor, `Fixes #187`/`Refs #188`, its own acquire/settle/review/rollback, and no callable-dispatch edit. Commands:

```bash
yarn vitest run test/impact.test.ts test/relationships.test.ts test/test-candidates.test.ts
yarn vitest run test/mcp.integration.test.ts -t "work_limit|work|bound"
yarn typecheck
```

Closing one issue never authorizes the sibling or tracker. Any independent failure leaves the draft tracker non-mergeable.

## Trace: 14 requirements / 31 scenarios

| Requirement                        | Scenario ownership / proof                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| RCR-R1 deterministic cells         | RCR-001 U2/U6 14-cell order; RCR-002 U2 status precedence                                                          |
| RCR-R2 conservative aggregate      | RCR-003 U2/U5 proven-empty; RCR-004 U2/U6 unsafe-cell RED                                                          |
| RCR-R3 shared tracker              | RCR-005 U2 then #187 exact-bound; RCR-006 U6 cancellation                                                          |
| RCR-R4 scoped calls                | RCR-007 U1/U3/#186 directions; RCR-008 U3/#186 isolated ambiguity                                                  |
| RCR-R5 containment                 | RCR-009 U4 inverse; RCR-010 U4 exclusions                                                                          |
| RCR-R6 compatibility/finality      | RCR-011 U5–U7 plus Harness denial; RCR-012 static merge kill switch                                                |
| RCA-R1 fresh tracker               | RCA-001 planning tracker proof; RCA-002 planning drift rejection                                                   |
| RCA-R2 bounded ancestry            | RCA-003 every child diff admission; RCA-004 overage/foreign-scope rejection                                        |
| RCA-R3 fresh links                 | RCA-005 PR link inspection; RCA-006 issue-closure kill switch                                                      |
| RCA-R4 reject R-01                 | RCA-007 stale-artifact scan; RCA-008 fresh tree/receipt hashes                                                     |
| RCA-R5 independent children        | RCA-009 #186-only pass remains blocked; RCA-010 #187-only pass remains blocked                                     |
| RCA-R6 one final candidate         | RCA-011 final gate bundle; RCA-012 byte/Harness drift invalidation                                                 |
| ATC-R1 incoming six-kind authority | ATC-001 U5/U6 six-kind order; ATC-002 U5 no-contains                                                               |
| ATC-R2 fail closed                 | ATC-003 bound; ATC-004 coverage shape; ATC-005 exhaustion; ATC-006 cancellation; ATC-007 proven-empty — U5/U6/#187 |

Every scenario gets a test RED before production where behavior is executable. RCA-001..012 are static/process admissions with failing negative checks before tracker state changes; they are not synthetic runtime claims.

## Full, package, Harness, review, verify, archive

Run on one clean final tree, capture every exit/output SHA-256, then repeat after archive because archive changes bytes:

```bash
yarn install --immutable
yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build
yarn test:mcp && yarn test:lifecycle && yarn test:cli && yarn test:errors && yarn test:package
yarn vitest run test/dsh-adapter.test.ts test/tool-catalog.test.ts && yarn test:dsh-adapter
git diff --check && git status --porcelain=v1 --untracked-files=all
```

Pinned Harness is read-only at revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`. Before/after hash canonical `git status --porcelain=v1 --untracked-files=all`, `git diff --binary`, and process snapshots for that checkout; require identical hashes, 15 guarded tools, absent apply, direct `ast_apply_operation`=`UNKNOWN_TOOL`, cleanup zero, and no surviving owned process. Any Harness write or drift invalidates the gate.

Check RDD mode first. If enabled, obtain delivery authority only through repeated native routing:

```bash
/home/yail/.local/bin/gentle-ai review status --cwd "$PWD" --contract gentle-ai.review-integration/v2 --agent "$GENTLE_AI_RUNTIME_AGENT_ID" --next-transition
```

Execute only the returned transition; never reuse #161 lineage. Independently run fresh blind dual Judgment Day on the same frozen target. Judgment supplies no delivery receipt. Correct only severe findings confirmed by both judges, at most two rounds, each bounded and RED-first with focused/runtime/rollback evidence; re-judge only frozen ledger plus fix delta. Any contradiction or remaining severe finding escalates.

Build a strict report and admit its exact bytes:

```bash
/home/yail/.local/bin/gentle-ai sdd-verify-validate \
  --input openspec/changes/2026-09-04-issue-188-relationship-coverage-recovery/verify-report.md \
  --requirements 14 --scenarios 31
```

Archive only after all checkboxes, #186/#187 acceptance, ordinary policy (plus a native receipt only if RDD is enabled), Judgment approval, strict 14/31 verification, CI, and Harness proof pass. Merge #188/#186/#187 deltas into canonical specs, move each audit trail, freeze the post-archive tree, reacquire and repeat review/verify/CI/Harness. Sequentially accumulate children, close #186 then #187, and only then permit tracker integration with `Fixes #188`. Roll back by abandoning/reverting the smallest child before merge; after merge revert the tracker integration atomically and open a newly approved recovery path.

## Receipt families

1. approval/main/conflict/RDD baseline;
2. per-unit acquire and independent settle;
3. RED/GREEN/REFACTOR command evidence;
4. allowlist/numstat/diff/tree/cleanup/process identity;
5. focused, cumulative, full, package, CI, and pinned-Harness gates;
6. conditional native review receipt when RDD is enabled, plus separate Judgment ledger/re-judgments;
7. strict 14/31 verification admission;
8. archive/spec-merge and post-archive candidate proof;
9. sequential issue closure and final integration authorization.
