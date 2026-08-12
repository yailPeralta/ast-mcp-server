# Cold-install runtime separation tasks

## 1. Incident authentication

- [x] Authenticate run `31547160641` against commit `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`.
- [x] Confirm Node 22.5 failed only at `NODE_OPTIONS= yarn install --immutable` with exit 42 while Node 24 completed all gates.
- [x] Reproduce first-attempt cold-link failure on Node 22.5 and disprove Yarn-version-only remediation.
- [x] Prove Node 24 immutable installation followed by the complete Node 22.5 suite passes 529/529.

## 2. RED and implementation

- [x] Add failing workflow-policy tests for package-manager/runtime topology drift.
- [x] Add failing matrix tests for Node 24 installation authority and fresh physical worktree requirements.
- [x] Update `ci.yml` and its closed policy to separate package-manager Node 24 from runtime setup.
- [x] Update the local matrix to materialize and clean a distinct exact-tree worktree per runtime.
- [x] Record package-manager/runtime/freshness identities in bounded reports.

## 3. Review A remediation

- [x] Record the rejected `f62d5d7ed7abd696564aab54ae7026b86a74b8de` Review A cohort without treating its PASS evidence as authorization.
- [x] Bind CI actions and commands as one exact interleaved step chain with early/late runtime-activation negatives.
- [x] Replace inherited package-manager environment with private `HOME`/`TMPDIR` and an explicit key allowlist.
- [x] Add direct negative coverage for every stale-state sentinel, materialization, cleanup, main-index drift, and first-attempt execution.
- [x] Reconcile the replacement quality review: candidate-delta diff, process-group timeout, terminal FAIL evidence, cleanup downgrade, and closed runtime-gate environment.
- [x] Record rejected tree `1c9f23b8c5428e663382a1fc00819f58ae0561ff`; centralize authenticated `/usr/bin/git` authority across matrix/canary, close repository/config/worktree controls, and add PATH, ambient-Git, and hostile-local-config negatives.
- [x] Record rejected first-attempt canary tree `f1c8cc54d30ae155c8071051daebd33679084b15`; remove source-worktree controls from the private-index clone child and add a real existing-worktree regression.
- [x] Record Review-A-rejected tree `87a40fa6a445a0b867e11fa46e0e3804da1e9eea`; remove the canary Git-snapshot retry and directly prove snapshot and cleanup failures receive no second attempt.

## 4. Verification

Status: complete. Successor tree `03c0dee3a63e8627f22c072b0a6072b881b808d3` passed its single first-attempt Node 22.5/24 matrix, four sequential exact-tree canaries, and Review A with unresolved Critical/High/Medium `0/0/0`.

- [x] Run focused tests and direct cold Node 22.5 matrix reproduction.
- [x] Rerun sequential format, lint, typecheck, full tests, build, smokes, audit, pack, policy, and candidate-delta gates after replacement-review remediation.
- [x] Freeze the exact successor tree and run the fresh Node 22.5/24 matrix with first-attempt semantics; rejected first attempts remain historical evidence.
- [x] Run four exact-tree canaries and authenticate report hashes for that same successor.
- [x] Write `verification.md` and reconcile the rejected Review A cohort.
- [x] Obtain Review A at unresolved Critical/High/Medium `0/0/0`.

## 5. Archive and exact-SHA CI

- [x] After Review A PASS, record its exact cohort and verdict in the bounded closure delta, archive the complete SDD, and authenticate the exact archive delta.
- [ ] Rerun affected post-archive gates and obtain Review B at `0/0/0`.
- [ ] Commit conventionally and push `main` without rewriting history.
- [ ] Require remote `main` and successful `ci.yml` `headSha` to equal the successor commit.
- [ ] Confirm npm, dist-tags, Git tags, and GitHub Releases remain unchanged.
