# Tasks: promote SQLite symbol-index persistence to default

No task authorizes push, npm publication, dist-tag mutation, Git tag or hosted release. Preserve the pre-existing unrelated untracked `openspec/archive/2026-08-13-improve-agent-setup/verify-report.md`.

## Closure policy

Receipt-driven review is disabled for this clone by explicit maintainer decision. This change therefore closes under ordinary repository policy: focused/full tests, hooks, and CI replace Review A and Review B as delivery gates. Historical review attempts and findings below remain evidence, but no Review A or Review B PASS is claimed. Conditional commit, staging, archive, push, publication, tag, and hosted-release transitions are authorization or later-phase boundaries, not apply/verify completion tasks.

## 0. Freeze exploration boundary

- [x] Record `git status --short --branch`, current commit/tree and the complete untracked manifest.
- [x] Confirm official Node 22 SQLite history: added `22.5.0`; flag removed `22.13.0`; still active-development.
- [x] Provision explicit Node `22.13.0` and current Node 24 binaries without implicit runtime downloads inside benchmark scripts.
- [x] Materialize baseline `34f6a8eeb52acf9bd082cbdff7fc450ccea8abe0`, run its default-disabled focused policy tests and save the 5/5 PASS transcript outside the repository.
- Deferred authorization boundary: commit this SDD separately only if a planning-artifact commit is explicitly authorized.

## 1. Runtime floor and policy contract

### 1.1 RED: default policy

- [x] Modify `test/symbol-index-policy.test.ts` first.
- [x] Assert absent policy resolves `mode=enabled`, `backend=sqlite` with injected safe implicit root.
- [x] Assert explicit `enabled` behaves identically.
- [x] Assert `disabled` does not call home/XDG/root resolution and derives no path.
- [x] Assert `canary` still requires an explicit normalized absolute root.
- [x] Assert invalid explicit root does not silently fall back to XDG/home.
- [x] Assert unknown modes fail closed.
- [x] Run `yarn test test/symbol-index-policy.test.ts`; expected RED from the current disabled default.

### 1.2 GREEN: policy resolver

- [x] Modify `src/services/symbol-index-policy.ts` with injectable environment/home resolution.
- [x] Keep `symbolIndexPolicyKey` and opaque file derivation deterministic.
- [x] Stop emitting `enabled_not_released` for valid enabled/default policy while retaining schema compatibility.
- [x] Run `yarn test test/symbol-index-policy.test.ts` and `yarn typecheck`.

### 1.3 Runtime floor

- [x] Modify `package.json` engine to `>=22.13.0` and `.github/workflows/ci.yml` floor to exact `22.13.0` without `--experimental-sqlite`.
- [x] Update runtime probes/declarations in `scripts/release-candidate-matrix.mjs`, tests and package smokes.
- [x] RED/GREEN exact-floor tests must reject `22.12.x`, accept `22.13.0` and current Node 24, and reject a mismatched configured binary.
- [x] Run focused runtime/package tests under both explicit binaries.
- Deferred authorization boundary: commit locally as `feat(runtime): raise Node floor for default SQLite` only if phase commits are authorized.

## 2. Private default cache boundary

### 2.1 RED: root creation and permissions

- [x] Extend `test/symbol-index-sqlite.test.ts` with a permissive umask fixture.
- [x] Assert capability failure creates no default-root suffix.
- [x] Assert missing package-owned suffixes become `0700` on Linux and existing external parents are unchanged.
- [x] Assert main/WAL/SHM/quarantine artifacts are owner-only before successful exposure.
- [x] Cover symlinked ancestor/target, non-directory ancestor, hard-linked target, inode replacement and an outside sentinel.
- [x] Run the focused test; expected RED on current umask-derived creation.

### 2.2 GREEN: safe private creation

- [x] Modify `src/services/symbol-index-sqlite.ts`; preserve capability-before-filesystem order and bounded header/row reads.
- [x] Apply private modes only to package-owned suffix/artifacts; never chmod unrelated parents.
- [x] Fail closed to the existing typed storage boundary when ownership/mode cannot be established.
- [x] Run SQLite, project and integration focused tests plus typecheck/build.

### 2.3 Cache inspection and cleanup

- [x] Create `src/services/symbol-index-cache.ts` only after RED tests define inventory and deletion invariants.
- [x] Add bounded inventory tests for main/WAL/SHM/quarantine files, byte accounting, record limits and stable order.
- [x] Add cleanup tests for no-follow containment, hard links, symlinks, changed inode, unreadable/non-regular entries, concurrent open store and partial failure.
- [x] Wire local CLI commands in the existing `ast-tool` parser; add CLI smoke and help tests.
- [x] Do not add an MCP tool or automatic background pruning.
- [x] Run focused CLI/cache tests, `yarn test:cli`, typecheck and build.
- Deferred authorization boundary: commit locally as `feat(cache): manage default symbol index storage` only if authorized.

## 3. Project lifecycle, status and mutation invariants

### 3.1 Default-enabled project RED/GREEN

- [x] Update `test/project.test.ts` so an isolated absent-policy session opens SQLite, builds once and hits after reopen.
- [x] Assert explicit enabled/default failures retain requested policy, effective memory backend, failed state, canonical result and bounded counter/error evidence.
- [x] Retain every current corruption, omission, migration, read/write/flush/contention regression.
- [x] Update `src/services/project.ts` minimally; do not reorder compiler synchronization or fallback installation.

### 3.2 MCP status compatibility

- [x] Update `test/mcp.integration.test.ts` for absent/explicit enabled, explicit disabled and canary compatibility.
- [x] Update `src/tools/get_project_status.ts` only as needed; keep historical reason literal if required for schema compatibility.
- [x] Prove public results contain no XDG/home/cache path.

### 3.3 Mutation-only no-side-effect

- [x] Extend `test/operations.test.ts` to run prepare/apply under absent policy with isolated home/cache.
- [x] Assert no default root is created and plan hash, diagnostics, conflict, rollback and replay remain exact.
- [x] Run `yarn test test/project.test.ts test/mcp.integration.test.ts test/operations.test.ts`.
- Deferred authorization boundary: commit locally as `feat(index): enable SQLite by default` only if authorized.

## 4. Test isolation and deterministic benchmark

### 4.1 Test harness isolation

- [x] Add one explicit shared-test memory policy where needed so unrelated unit tests cannot write into the developer home.
- [x] Dedicated default-policy tests must override that guard with isolated `HOME`, `XDG_CACHE_HOME` and temp roots.
- [x] Add an external sentinel proving the complete focused/full suite creates no cache outside owned temp directories.

### 4.2 Integration benchmark

- [x] Modify `scripts/benchmark-symbol-index-integration.mjs` after RED assertions.
- [x] Replace `default_disabled` with `default_enabled_persisted` and `default_restart_hit`.
- [x] Replace `enabled_fails_closed` with `enabled_persisted`.
- [x] Retain explicit disabled and rollback, canary compatibility and all failure injection gates.
- [x] Add private-mode and cache inspect/cleanup gates.
- [x] Run under exact Node `22.13.0` and Node 24 to `/tmp`; both commands must exit non-zero on any false gate.

### 4.3 Full local gates

- [x] Prospectively freeze the final unchanged pre-Review-A sibling only if the external matrix reports bind that exact tree and pass, in repository order under both runtimes: `yarn format:check`, `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`, `yarn test:mcp`, `yarn test:errors`, `yarn test:lifecycle`, `yarn test:cli`, `yarn test:package`, `yarn audit`, `yarn pack --dry-run --json`, workflow policy and `git diff --check`.
- [x] Any source/test/harness/documentation edit invalidates later exact-tree evidence; restart from the focused gate or mint and fully rerun a successor sibling before Review A.

## 5. Packed consumer and representative evidence

### 5.1 Installed/registry consumer

- [x] Update `scripts/registry-consumer-smoke.mjs` and tests.
- [x] Default connection omits persistence variables, uses isolated XDG/home, creates one private SQLite artifact and records a restart hit.
- [x] Disabled connection creates no root.
- [x] Canary connection remains compatible.
- [x] Mutation-only default connection creates no cache.
- [x] Run against the packed candidate, then against an isolated local registry before any public publication.

### 5.2 Candidate-bound representative matrix

- [x] Freeze the complete 58-path evidence-sibling manifest, including new tests/docs/scripts/reports and excluding the unrelated pre-existing file; require manifest SHA-256 `df486f9b5dfe80c3d394454255fb8646d066c6b6a27f7ab499522e0c2446e822`.
- [x] Modify `scripts/canary-local-mcp.mjs` and its tests so treatment is absent-policy default and rollback is explicit disabled; preserve workload/order/counts.
- [x] Generate four fresh raw reports from one immutable candidate: `ast-mcp-server` and `x-scraper` × Node `22.13.0` and Node 24.
- [x] Require 20 warm reads, three restarts, compiler parity, zero unexpected fallback/corruption/write failures, exact repository identity, mutation rollback and resource/cache gates.
- [x] Add permission and cache-ownership gates without weakening the existing 40-gate cohort.
- [x] Write raw outputs only to `/tmp` while iterating.

### 5.3 Atomic evidence publication

- [x] Define a new versioned checked-report destination; do not overwrite/relabel historical reports.
- [x] Freeze the complete four-member set atomically with existing no-replace/report-lock invariants.
- [x] Verify report hashes, no host paths/secrets, candidate identity and full requirement traceability.
- Deferred authorization boundary: commit evidence separately only if authorized.

## 6. ADR, support and exact-tree closure

### 6.1 Documentation and decision projection

- [x] Amend ADR 0008 for Node `22.13.0` and official flag history.
- [x] Supersede ADR 0009 canary-only/default-disabled policy with enabled default and explicit disabled rollback.
- [x] Amend ADR 0010 runtime/persistence boundary.
- [x] Update `README.md`, `docs/support.md`, `benchmark/README.md`, `CHANGELOG.md`, package metadata and bundled structural-editing guidance.
- [x] Document active-development SQLite status, cache location precedence, inspect/clear commands, permissions, fallback and rollback.

### 6.2 Verification and Review A

- [x] Prospectively re-freeze `verification.md` after Review A remediation bytes, replacement checked reports and successor exact-tree evidence stopped changing; bind the final immutable candidate and post-documentation matrix in the external owner ledger without another repository edit.
- [x] Map every declared `IDX-DEFAULT-*` requirement to implementation, direct assertions and transport evidence without undeclared or shifted IDs.
- [x] Record Review A candidate `a3ab5c89c191a63335156dd473e831e3e232ad09` as `REQUEST_CHANGES` (`high=1`, `medium=2`) plus one independent `NOT_COMPLETED` lane; do not preserve sibling PASS as whole-candidate approval.
- [x] Add RED regressions for untrusted writable ancestry, descriptor-bound SQLite open and a writer activated immediately before sidecar deletion.
- [x] Implement trusted ancestry plus Linux descriptor-bound main open and an exclusive WAL/SHM/main deletion guard.
- [x] Authenticate the first remediation with 54/54 focused tests and 686/686 complete tests under exact Node `v22.13.0` and Node `v24.16.0`, plus dual-runtime typecheck and Node 24 lint/format.
- [x] Record focused recovery candidate `f1a851d30ff94cc8154d8545224c5245de49a115`: traceability `PASS`; security `REQUEST_CHANGES` with one Medium descriptor-reopen finding and one Low capability-typing finding.
- [x] Add RED regressions for a valid-SQLite outside swap before guard acquisition, a group/other-accessible cache root and unavailable descriptor-open capability.
- [x] Bind cache activity probes/guards to an authenticated `O_NOFOLLOW` descriptor, reject non-private package-owned directories and retain descriptor failures as capability failures.
- [x] Authenticate the second remediation with 57/57 focused tests and 689/689 complete tests under exact Node `v22.13.0` and Node `v24.16.0`, exact Node 22.13 typecheck, and Node 24 lint/typecheck/format/diff checks.
- [x] Obtain focused recovery PASS on immutable tree `578886ad1980cfba082f761aec08582e0a3a632e`: security and SDD lanes both reported zero findings at every severity.
- [x] Reproduce the predecessor freezer's mode-`0644` output, add a RED/GREEN `0600` publication assertion and move the first no-replace successor cohort to versioned sibling `production-readiness-sqlite-default-v2` while preserving v1 bytes.
- [x] Reauthenticate the harness edit with 27/27 tests under both runtimes, regenerate all four raws from immutable producer tree `b375a38fa974134056d816f8e292856971247d22` and freeze v2 mode `0600`.
- [x] Preserve v2 as superseded after the exact-tree matrix exposed that `scripts/mcp-smoke.mjs` declared nonexistent isolated HOME/XDG roots and fell back with `invalid_path`.
- [x] Create the MCP smoke's isolated HOME/XDG roots mode `0700` and reproduce GREEN default-SQLite stdio behavior under exact Node `v22.13.0` and Node `v24.16.0`.
- [x] Preserve rejected code-only candidate `ad3da867f9c0d9d9c58c59cd5eb3b9b81686ec5c`: its first exact-tree matrix passed Node 22.13 install through public-error smoke, then failed lifecycle because the canary cache fixture root was mode `0755`; cleanup passed and no later cell was resumed.
- [x] Create the lifecycle smoke's canary cache root mode `0700` and reproduce GREEN close/reopen behavior under exact Node `v22.13.0` and Node `v24.16.0`.
- [x] Preserve rejected code-only candidate `377465a1ea4c66c2d00c965b5ff80375ee70de22`: its first exact-tree matrix passed Node 22.13 install through lifecycle and CLI, then failed package smoke because isolated HOME/XDG/TMP fixture roots were mode `0755`; cleanup passed and no later cell was resumed.
- [x] Create the package smoke's isolated HOME/XDG/TMP roots mode `0700` and reproduce GREEN packed default-SQLite rebuild/restart behavior under exact Node `v22.13.0` and Node `v24.16.0`.
- [x] Preserve candidate `e79e2f9660e376212d51a861aceeb6bf29aacaa5` first-attempt environment failure: Node 22.13 passed through CLI and reached package global-install after the SQLite assertions, but its runtime authority omitted `npm`; cleanup passed and no later cell was resumed.
- [x] Rebuild both physical runtime authorities with runtime-matched private npm payloads, then require a fresh whole-matrix attempt rather than resuming the package cell.
- [x] Preserve candidate `4a60de755fb4d69ed1a55ecc12253e7389eacaae`: its exact-tree matrix passed all 15 commands under both runtimes, but the first Node 22 packed-consumer attempt exposed invalid fixture roots and produced no release report.
- [x] Make pack/consumer HOME, TMP and project ancestry private, create valid default/mutation-only XDG roots, let the package create the canary root, and reproduce all 22 consumer gates under exact Node `v22.13.0` and Node `v24.16.0`.
- [x] Run the successor exact-tree matrix and packed consumer from gate one before generating final reports.
- [x] Regenerate the four raw reports from the post-consumer-fix producer and freeze a no-replace v3 checked set; preserve v1 and v2 bytes.
- [x] Preserve rejected Review A tree `124bfc6be0f1855aa0497566822127c03fe68677`: specification/compliance passed with zero findings; security returned `REQUEST_CHANGES` with four Medium findings; whole-candidate coverage did not complete and does not count as a verdict.
- [x] Remediate package-created SQLite directories under restrictive umask with descriptor-bound exact mode normalization, defer local-registry PASS publication until server/root cleanup succeeds, and preserve OpenCode file mode independently of umask.
- [x] Remediate release-matrix report authority, sensitive failure persistence and partial-set publication with private branded evidence, closed schemas and atomic no-replace directory publication.
- [x] Authenticate a fresh code producer, rerun the complete dual-runtime matrix and local-registry consumer from gate one, and generate four fresh producer-bound raw reports.
- [x] Preserve v3 bytes as rejected-Review-A evidence and atomically freeze the no-replace v4 successor cohort with private `0700`/`0600` modes.
- [x] Materialize documentation/report sibling tree `d80d4095abba66c65a94734be5364bd802237a11` and rerun its complete 15/15 dual-runtime matrix and 22/22 local-registry consumer from gate one.
- [x] Preserve rejected Review A tree `d80d4095abba66c65a94734be5364bd802237a11`: specification/compliance and whole-candidate quality passed with complete zero-finding coverage; security returned `REQUEST_CHANGES` with one Medium finding because bare Yarn/npm selection through ambient `PATH` was not causally bound to authenticated package-manager and transitive-Node authority.
- [x] Require absolute Yarn/npm JavaScript entries, authenticate Node/Yarn/npm physical file ownership/mode/single-link/canonical identity plus version and SHA-256, execute both managers through the authenticated Node under a closed path policy, reauthenticate before PASS publication, and add hostile PATH/transitive-Node regressions.
- [x] Preserve v4 bytes as rejected-Review-A evidence and advance the no-replace freezer destination to `production-readiness-sqlite-default-v5`.
- [x] Authenticate a fresh code producer, complete dual-runtime matrix and 23/23 local-registry consumer from gate one, then generate fresh producer-bound raws and atomically freeze v5.
- [x] Materialize the final v5 documentation/report sibling and prospectively require its complete dual-runtime matrix and local-registry consumer from gate one; any first-attempt failure rejects that sibling and requires a documented successor.
- [x] Record replacement Review A as not applicable under clone-local `disabled/unmanaged` policy; preserve every historical finding and make no PASS claim. Ordinary tests, hooks, and CI are the active gates.

### 6.3 Deferred archive and delivery boundaries

- Archive is a separate `sdd-archive` phase after independent ordinary-policy verification; it is not an apply-completion task.
- Staging is unauthorized. If later authorized, stage only the authenticated owned manifest and verify `git diff --cached --check`, candidate tree, untracked baseline, and no unrelated path.
- Review B is not applicable while clone-local review remains `disabled/unmanaged`; ordinary tests, hooks, and CI apply instead, with no review PASS claim.
- A local Conventional Commit remains separately authorized; if authorized, verify `HEAD^{tree}` against the authenticated candidate.
- Push remains unauthorized.

## 7. Separately authorized release transitions (not apply/verify tasks)

- Push only on explicit instruction after an authorized commit.
- Publish one new immutable version under npm `next` only after explicit authorization and exact-SHA CI passes.
- After any authorized publication, verify registry metadata, integrity, provenance/signature, and fresh public consumer default/disabled/canary behavior.
- Promote that exact version to `latest` only on separate instruction and authenticated tag readback.
- Create a Git tag and hosted release only after separate authorization and `latest` verification.
- Never republish an ambiguous or failed immutable version; resume through readback or issue a new version.
