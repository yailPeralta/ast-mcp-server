## Exploration: Issue #188 relationship coverage recovery

### Current State

#### Authority and repository baseline

- GitHub issue [#188](https://github.com/yailPeralta/ast-mcp-server/issues/188) is open and labeled `status:approved`; it authorizes a **fresh recovery Feature Branch Chain from main**.
- `main`, `HEAD`, and the observed `origin/main` all resolve to `6173a39a73f1540c17335a330ea7f14f982387cb`.
- The workspace has one pre-existing untracked sibling change, `openspec/changes/2026-09-04-issue-186-polymorphic-call-authority/`. It was read as dependency context and was not modified.
- Issue #161 and PRs #162–#185 are closed and immutable. Their Git objects and remote branches are evidence only. The exhausted Judgment lineage, receipts, correction attempts, delivery state, and old approval claims MUST NOT be resumed, extended, copied, or treated as authority.
- The native `gentle-ai` binary is unavailable (`command not found`). AST MCP calls were available but returned no model-visible status, symbols, or diagnostics. Consequently, this exploration uses bounded Git-object and source reads as **textual evidence**, not compiler-authoritative AST evidence.
- Persistence mode is hybrid with OpenSpec authoritative. This phase writes only this change's `exploration.md` and `state.yaml`; no Harness/control-plane mirror was written because the user explicitly prohibited Harness writes.

#### Main versus the clean U7 foundation

Current main has the pre-R-01 behavior: no public per-kind/direction/endpoint coverage ledger, no one-request relationship work tracker, no scoped call producer, and no direct `contains` producer. The public candidate gate therefore cannot distinguish proven empty results from missing applicable relationship work.

The clean cumulative foundation at `bac52a4de598e0c01412d0d54efdfe9cef3a4353`, after excluding the old change directory, is:

- **Coverage:** main reports traversal truncation only; U7 adds ordered `completed`, `not_applicable`, `unsupported`, or `unfinished` entries.
- **Work:** main has node/edge/depth bounds; U7 adds request-scoped `max_items`, `consumed_items`, `exhausted`, and `work_limit`.
- **Calls:** main's whole-project collector does not prove scoped impact completeness; U7 has scoped incoming/outgoing producers with fail-closed unfinished signaling.
- **Contains:** main has no authoritative producer; U7 adds direct module/declaration containment and its exact inverse.
- **Public schema:** main has no coverage/work projection; U7 adds bounded Zod coverage/work schemas and ordering.
- **Candidates:** main can lack per-kind completion proof; U7 freezes six incoming kinds, excludes `contains`, and rejects unsafe coverage.
- **Matrix/docs:** main has six-kind-era claims; U7 adds a seven-kind positive/negative matrix and additive cutover/rollback guidance.

The clean main-to-U7 delta is 19 files, 1,403 additions, and 126 deletions. It cannot be reviewed or delivered as one PR.

### Exact Replay Units

Only the listed non-OpenSpec file deltas are replayable. Counts are authored additions plus deletions from each exact commit after excluding `openspec/changes/2026-09-02-r01-honest-relationship-coverage/**`.

1. **U1 deterministic RED** — evidence `1a08635520d0d961c5c2887847a664065674f3f8`; `test/mcp.integration.test.ts`; 51 additions, 0 deletions, **51 total**. Registered MCP reproduces false-complete incoming call coverage before production changes. RED must fail for the intended assertion, not setup noise.
2. **U2 coverage ledger/shared tracker** — evidence `13af89de4976799ccc233c1613699395c378ccf9`; `src/services/impact.ts`, `src/services/read-contracts.ts`, `src/services/relationships.ts`, `test/impact.test.ts`; 282 additions, 71 deletions, **353 total**. Adds coverage accounting, aggregate completeness, shared work-tracker foundation, and focused service tests.
3. **U3 scoped calls** — evidence `92db7e2f3ed162ecd69a27d5cc73217e821b4fe0`; `src/services/relationships.ts`, `src/tools/get_impact.ts`, `test/impact.test.ts`; 291 additions, 29 deletions, **320 total**. Adds scoped incoming/outgoing call producers and public impact projection. Known callable-dispatch limitations remain explicitly temporary for #186.
4. **U4 direct contains** — evidence `19a96218ba7bc3800b1932b7599fca32512f1c37`; `src/services/relationships.ts`, `test/impact.test.ts`; 331 additions, 6 deletions, **337 total**. Adds direct named containment, exact inverse, exclusions, determinism, and bounds tests.
5. **U5 public schemas/candidates** — evidence `15e252e957139f113cec8735afdc10adb77a0a92`; `src/services/impact.ts`, `src/services/relationships.ts`, `src/services/test-candidates.ts`, `src/tools/find_test_candidates.ts`, `src/tools/get_impact.ts`, `src/tools/relationship-schema.ts`, `test/mcp.integration.test.ts`, `test/relationship-schema.test.ts`, `test/test-candidates.test.ts`; 254 additions, 34 deletions, **288 total**. Publishes additive schemas and requires complete safe coverage for the six-kind incoming candidate query.
6. **U6 seven-kind matrix** — evidence `3af4fe67f3b3f50947e9a93dce9bf377c9cc5132`; `src/services/read-contracts.ts`, `src/tools/explore.ts`, `src/tools/get_project_status.ts`, `test/impact.test.ts`, `test/mcp.integration.test.ts`, `test/read-contracts.test.ts`; 198 additions, 4 deletions, **202 total**. Proves all seven kinds, mixed-kind failure, cancellation, work-limit vocabulary, and public serialization boundaries.
7. **U7 docs/gates** — evidence `bac52a4de598e0c01412d0d54efdfe9cef3a4353`; `CHANGELOG.md`, `README.md`, `docs/adr/0007-compiler-first-impact-relationships.md`, `docs/adr/0012-public-affected-test-candidates.md`, `docs/ast-mcp-server-harness-improvement-report.md`; 23 additions, 9 deletions, **32 total**. Re-author current truthful docs and rollback guidance only after U1–U6 behavior is present. Do not replay old evidence/settlement files.

Every replay unit is at or below the 400-line review budget. The cumulative foundation is intentionally split because U2–U5 are close to the limit and have independent behavior/test rollback boundaries.

### Dependency and Replay Feasibility

```text
main 6173a39
  └── recovery tracker (draft/no-merge; issue #188)
       ↑ U1 base
       └── U1 RED [51]
            ↑ U2 base
            └── U2 coverage + tracker [353]
                 ↑ U3 base
                 └── U3 scoped calls [320]
                      ↑ U4 base
                      └── U4 direct contains [337]
                           ↑ U5 base
                           └── U5 schemas + candidates [288]
                                ↑ U6 base
                                └── U6 seven-kind matrix [202]
                                     ↑ U7 base
                                     └── U7 docs + gates [32]
                                          ↑ #186 base
                                          └── issue #186 callable authority
                                               ↑ #187 base
                                               └── issue #187 request-work accounting
                                                    └── fresh integration review/verify/archive
                                                         └── tracker may merge to main
```

The original source evolution is cleanly recoverable: the old planning parent of U1 differs from main only inside the excluded old change directory, and every settlement commit between U2–U7 has zero non-artifact delta. `git diff --check main..bac52a4...` over the clean paths passes.

**Do not directly cherry-pick U1–U7.** Each original commit also changes old `state.yaml`, `tasks.md`, `apply-progress.json`, or evidence. Raw cherry-picks would import stale execution/approval claims and may conflict because the old planning/settlement files are deliberately absent. Instead, re-author each new unit against its immediate new parent using only the file/hunk behavior from:

```text
git diff <evidence-sha>^ <evidence-sha> -- <unit allowlisted paths>
```

Then review the resulting diff, run its fresh tests, and create a new commit and candidate identity. Expected source conflicts are none when units remain ordered and no later-main drift exists; semantic conflicts remain possible when adapting tests/docs to current dependencies. Any hunk outside the allowlist is a hard stop, not a conflict to resolve opportunistically.

### Exclusions

The recovery MUST exclude:

- tracker/planning commits `507b234...` through `7be9022...` as reusable authority; new proposal/spec/design/tasks must be authored for #188;
- settlement commits `32e4109...`, `6e9412f...`, `5ab9185...`, `5e74c1d...`, `77842a3...`, and `e15e879...`;
- every old `apply-progress.json`, `state.yaml`, `tasks.md`, `evidence.md`, `chain.md`, and `judgment-day.json` execution or approval claim;
- PRs #181–#185 and source corrections `d7cf233...` and `22e38d2...` from replay;
- all old receipts, reviewer identities, Judgment results, fix budgets, target hashes, R-01 archive/delivery state, CI status, issue-state snapshots, and Harness snapshots as current proof;
- stale statements that issue #161 or PRs #162–#185 are open, approved for delivery, review-allowed, or mergeable;
- any claim that passing old tests approves the new candidate.

The old objects may be cited only as provenance for a behavior or defect that is freshly reproduced and reverified.

### Temporary Known Limitations and Non-Mergeability

The U1–U7 foundation intentionally recreates prerequisites, not a mergeable final candidate.

- **Exclusive to #186:** callable-member dispatch finality and exactness, including override-capable base/interface/property/accessor calls, owner-typed private/`#private` parameter calls, exact recursive incoming calls, and per-direction call coverage contamination. #186 must add RED/GREEN service and registered-MCP proof without changing request-work accounting.
- **Exclusive to #187:** all request-wide work charging not completed by U2, including BFS dequeue/dispatch, source-file enumeration sorting, containment-candidate sorting, neighbor sorting/finalization, probing, retention, deduplication, and emission. Charges must be exact-once and tested at exact-bound and one-below. #187 must not redefine callable authority.
- U1–U7 child PRs may be reviewed and integrated only inside the recovery chain. The tracker is draft/no-merge, and the foundation MUST NOT merge to `main` until both #186 and #187 close their assigned limitations, severe findings are absent, and the final integrated candidate receives fresh review and strict verification.

### New SDD Specifications Required

The proposal/spec phases should create fresh deltas rather than copying the R-01 specs:

1. **`relationship-coverage-recovery`**
   - Define ordered coverage combinations, completeness authorization, scoped calls, direct containment, public schemas, seven-kind matrix, cancellation, and compatibility as fresh #188 requirements.
   - Mark the foundation as integration-only and non-mergeable while either delegated limitation remains open.
2. **`recovery-chain-authority`**
   - Require a tracker created from the approved main SHA, immediate-parent child bases, clean ≤400-line diffs, fresh candidate identities, and issue-specific links.
   - Forbid importing old receipts, Judgment/correction state, settlements, or approval language.
   - Require #186 and #187 as separately specified, reviewed, verified, and rollback-capable children before tracker merge.
3. **Modify `affected-test-candidates`**
   - Freeze exactly six incoming relationship kinds (`reference`, `import`, `export`, `extends`, `implements`, `call`), exclude `contains`, and reject any unsafe coverage or exhausted work before `proven_empty`.

The #186 and #187 OpenSpec changes remain independent specifications. #188 supplies their prerequisite branch baseline and integration gate, not replacement acceptance criteria.

### Branch, PR, and Issue-Link Rules

Recommended branch names:

- tracker: `feat/issue-188-relationship-coverage-recovery`, based exactly on the then-current protected `origin/main`;
- replay children: `test/issue-188-u1-red`, `feat/issue-188-u2-coverage-ledger`, `feat/issue-188-u3-scoped-calls`, `feat/issue-188-u4-direct-contains`, `fix/issue-188-u5-public-candidates`, `test/issue-188-u6-relationship-matrix`, `docs/issue-188-u7-gates`;
- issue children: `fix/issue-186-polymorphic-call-authority`, then `fix/issue-187-request-work-accounting`.

PR rules:

- The tracker targets `main`, remains draft/no-merge, references #188 without closing it early, and lists #186/#187 as mandatory children.
- U1 targets the tracker branch. Each later child targets its immediate predecessor branch. A diff containing earlier units is a base bug and must be retargeted/rebased.
- U1–U7 use `Refs #188`; they MUST NOT use `Fixes #161`, imply R-01 approval, or close #188.
- The #186 child uses `Fixes #186` and `Refs #188`; the #187 child uses `Fixes #187` and `Refs #188`. Neither may close the other's issue.
- Only the final tracker/integration action may use `Fixes #188`, after both issue children, fresh review, verification, archive readiness, and CI are green.
- Every PR includes start/end state, immediate dependency, follow-up, exact additions+deletions, focused tests, runtime/Harness evidence or justified N/A, rollback, exclusions, and a dependency diagram marking itself with `📍`.

### Fresh Test, Gate, Harness, and Review Requirements

Per-unit minimums:

- **U1:** Run only the new registered-MCP regression first; record deterministic RED twice if repository policy requires repeatability.
- **U2:** Run `yarn vitest run test/impact.test.ts` plus the U1 regression; assert coverage order/completeness and shared tracker snapshots.
- **U3:** Run `yarn vitest run test/impact.test.ts test/relationships.test.ts test/call-spines.test.ts`; use a generous work budget so #187 ownership is not blurred.
- **U4:** Run `yarn vitest run test/impact.test.ts`; cover direct/inverse positives and statement/anonymous/transitive negatives.
- **U5:** Run `yarn vitest run test/test-candidates.test.ts test/relationship-schema.test.ts test/mcp.integration.test.ts`; prove the six-kind freeze, `contains` exclusion, and fail-closed candidate behavior.
- **U6:** Run `yarn vitest run test/impact.test.ts test/mcp.integration.test.ts test/relationships.test.ts test/call-spines.test.ts test/test-candidates.test.ts test/read-contracts.test.ts`; prove the seven-kind and cancellation matrix.
- **U7:** Run `yarn format:check`, `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, `yarn test:mcp`, `yarn test:cli`, `yarn test:errors`, `yarn test:package`, and `git diff --check`.

After #186 and #187, rerun their focused exact-bound/dispatch matrices and all U7 gates on the **same final candidate**. Required CI must pass for each child head and the final tracker head.

Harness verification is fresh evidence only: run the repository's pinned adapter/catalog tests and `yarn test:dsh-adapter` without editing the Harness checkout; verify the guarded catalog remains exactly 15, apply remains absent, direct `ast_apply_operation` returns `UNKNOWN_TOOL`, and canonical before/after Harness snapshots are identical. A Harness write invalidates the gate.

Fresh review starts a new ordinary bounded-review lineage for the new final candidate. It must not recover, reopen, amend, or continue the #161 Judgment lineage. Any candidate change after review invalidates its receipt and requires the policy-prescribed new validation; any severe unresolved finding blocks tracker merge. Strict SDD verification must bind commands, zero exit codes, requirement/scenario counts, output hashes, tree identity, and current evidence before archive readiness.

### Approaches

1. **Fresh ordered re-authoring from exact U1–U7 evidence (recommended)** — use allowlisted per-commit diffs as implementation reference, generate new commits and evidence, then append #186 and #187.
   - Pros: clean authority, exact review boundaries, no old artifact import, all replay slices ≤400 lines.
   - Cons: requires careful hunk review and full fresh verification.
   - Effort: High overall, bounded per child.

2. **Direct cherry-pick with artifact cleanup** — cherry-pick old SHAs and delete/restore old artifacts afterward.
   - Pros: mechanically quick.
   - Cons: transiently imports prohibited authority, creates artifact conflicts, obscures candidate provenance, and risks retaining stale claims.
   - Effort: Medium, unacceptable authority risk.

3. **Start from terminal `629801d...`** — branch from the final closed chain.
   - Pros: includes attempted fixes and fixtures.
   - Cons: imports exhausted Judgment/correction state, known defects, stale delivery claims, and a polluted 3,000+ line baseline.
   - Effort: Low initially, non-deliverable.

### Recommendation

Proceed to `sdd-propose` for `2026-09-04-issue-188-relationship-coverage-recovery`. Author fresh recovery and chain-authority specs, preserve the exact U1–U7 boundaries above, then create the draft Feature Branch Chain from a rechecked protected `origin/main`. Treat every old object as untrusted implementation evidence until reproduced. Keep the tracker non-mergeable until independent #186 and #187 children, fresh review, strict verification, archive readiness, CI, and no-write Harness checks all pass.

### Risks and Blockers

- **Risk:** an allowlist misses a coupled hunk. Mitigation: compare each new unit against its exact evidence diff and run the unit plus cumulative tests.
- **Risk:** re-authoring silently preserves known severe U3/U2 limitations. Mitigation: record them in specs/tracker and make #186/#187 closure a deterministic merge gate.
- **Risk:** child diffs become polluted by earlier units. Mitigation: enforce immediate-parent bases and inspect GitHub additions/deletions before review.
- **Risk:** old evidence language is mistaken for fresh approval. Mitigation: prohibit old receipts/status/settlements and generate new candidate-bound evidence only.
- **Risk:** main advances after exploration. Mitigation: recheck protected `origin/main`; if changed, recalculate every patch/conflict/count and update the plan before branching.
- **Blockers:** none for proposal. Implementation remains gated by proposal/spec/design/tasks, tracker creation, fresh RED, and later child/review requirements.

### Rollback

- Before tracker merge, rollback is branch-local: close/abandon the recovery tracker and children; `main` remains unchanged.
- Within the chain, revert one re-authored work-unit commit together with its tests/docs and rebuild every descendant; do not retain public schema/docs without the producer they describe.
- #186 and #187 each require independent rollback boundaries. Reverting one must not claim the other is resolved.
- After final merge, revert the tracker merge as one integration rollback if any authority invariant fails, then reopen a newly approved recovery path; never reactivate #161 Judgment state.

### Ready for Proposal

Yes. Issue #188 supplies the previously missing authority and chain strategy. The next phase is `sdd-propose`; no runtime implementation, branch, commit, PR, issue mutation, review launch, or Harness write occurred during this exploration.
