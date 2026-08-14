# Tasks: Managed Structural Editing Guidance

## Review Workload Forecast

| Field                   | Value                                                        |
| ----------------------- | ------------------------------------------------------------ |
| Estimated changed lines | 1,000–1,500                                                  |
| Primary risk            | User-global file mutation                                    |
| 800-line review risk    | High                                                         |
| Recommended slices      | 3 local commits or chained PRs if remote review is requested |
| Apply authorization     | Granted by Yail on 2026-08-13                                |

No commit, push, PR, package publish, or writes to real agent homes are implied by these tasks.

## Phase 1: Canonical Assets and Official Skill Upgrades

- [x] Maintain requirement traceability against both `specs/managed-structural-guidance/spec.md` and the modified `specs/setup-agent-support/spec.md` throughout RED/GREEN and verification.

### 1.1 RED — package asset contract

- [x] Add failing tests in `test/skill-installer.test.ts` for resolving `SKILL.md`, `guidance.md`, and `releases.json` from source and built package layouts.
- [x] Add failures for malformed manifest, duplicate digest, unsupported algorithm, and source/current digest mismatch.
- [x] Run `yarn vitest run test/skill-installer.test.ts`; expected failure from missing asset resolver/manifest validation.

### 1.2 GREEN — canonical assets

- [x] Update `skills/structural-code-editing/SKILL.md` with the canonical activation policy and bump its version.
- [x] Create `skills/structural-code-editing/guidance.md` with marker-free canonical body text.
- [x] Create `skills/structural-code-editing/releases.json` containing the new current candidate digest and the registry-proven predecessor digests for npm `0.3.0` through `0.7.2`: `61251830…`, `b9f75a8c…`, `fbc6a9ee…`, `622ab595…`, `e10f89e8…`, `672307b0…`, and `6284fbea…`, with full hashes and package-version provenance in the actual JSON.
- [x] Explicitly exclude the installed Hermes digest `c25ed470e5c504c38a9be75ffa38f4b6c5a4046548b562e6a33ddba9044fa4d2`; add a regression proving it remains an unknown/custom conflict without force.
- [x] Replace `resolveBundledSkillPath` with a typed asset resolver and closed manifest parser in `src/services/skill-installer.ts`.
- [x] Update `package.json` files/package-smoke expectations if recursive skill packaging does not already include both new assets.
- [x] Run the focal test until GREEN.

### 1.3 RED/GREEN — digest-based safe upgrade

- [x] Add RED cases for current digest (`unchanged`), admitted predecessor (`updated` without force), customized bytes retaining old version (`conflict`), unknown bytes with force (`updated`), and cross-target preflight/no writes.
- [x] Refactor skill classification into a pure plan that stores preimage/postimage digests and logical owners.
- [x] Preserve standalone `install-skill` behavior and explicit force semantics.
- [x] Run `yarn vitest run test/skill-installer.test.ts`; expected all GREEN.

## Phase 2: Effective Guidance Planner

### 2.1 RED — managed block byte safety

- [x] Create `test/managed-guidance.test.ts` covering empty/missing files, human content append, one-block update, idempotency, UTF-8 BOM, LF/CRLF, mode preservation, terminal newline, invalid UTF-8/NUL, final symlink, non-regular target, duplicate/nested/reversed/partial/unknown markers.
- [x] Add exact assertions that bytes outside the managed block are unchanged.
- [x] Run `yarn vitest run test/managed-guidance.test.ts`; expected failure because planner does not exist.

### 2.2 GREEN — marker planner and safe file apply

- [x] Create `src/services/managed-guidance.ts` with pure decode/marker/postimage planning.
- [x] Reuse or extract canonical future-path resolution and snapshot-safe atomic write primitives rather than duplicating subtly different implementations.
- [x] Apply create-only through a held-descriptor no-clobber link and replacements through same-directory atomic exchange with two-sided identity validation; verify postimage digest/mode.
- [x] Run focal test until GREEN.

### 2.3 RED — client routing matrix

- [x] Add Claude cases for default and relative/absolute `CLAUDE_CONFIG_DIR`.
- [x] Add OpenCode cases for native rules, Claude fallback preservation, shared Claude/OpenCode physical path, `OPENCODE_CONFIG_DIR`, admitted `OPENCODE_CONFIG` root behavior, and ambiguous routing failure.
- [x] Add Codex cases for default home, `CODEX_HOME`, non-empty override, empty override, and path aliases.
- [x] Add Gemini cases for default `GEMINI.md`, one custom safe filename, one-item array, malformed settings, multiple names, traversal/absolute filenames, and unsupported settings.
- [x] Add Hermes/Copilot `skill_only` cases proving no path/write.
- [x] Run focal test; expected routing failures.

### 2.4 GREEN — effective destination resolution

- [x] Implement closed per-client resolvers in `managed-guidance.ts` using existing environment/config-root semantics.
- [x] Canonicalize and group physical aliases; reject groups requiring different postimages.
- [x] Return ordered logical outcomes plus physically deduplicated plans.
- [x] Run `yarn vitest run test/managed-guidance.test.ts test/opencode-config.test.ts`; expected GREEN with no regressions to MCP config routing.

## Phase 3: Combined Setup Orchestration

### 3.1 RED — global preflight and result v2

- [x] Extend `test/agent-setup.test.ts` for per-agent `guidance`, setup schema `version: 2`, physical write asset kind, and `skill_only` outcomes.
- [x] Add a guidance conflict in a later-selected client and assert zero MCP/skill/guidance writes across every selected client.
- [x] Add source/manifest failure before artifact/MCP mutation.
- [x] Add race-after-preflight, bounded partial completion, replay convergence, and zero-write replay.
- [x] Run `yarn vitest run test/agent-setup.test.ts`; expected failures against schema v1 and missing planner.

### 3.2 GREEN — wire planners into setup

- [x] Extend `RunAgentSetupOptions` with bundled assets and any explicit home/CWD test seams needed by both planners.
- [x] Preflight MCP inspections, skill plans, and guidance plans before apply.
- [x] Apply physically deduplicated asset plans, then sequential MCP mutation/verification; retain completed outcomes on failure.
- [x] Bump stable success schema to v2 and keep bounded/redacted failures.
- [x] Update `src/cli.ts` and CLI serializers without changing confirmation/selection semantics.
- [x] Run `yarn vitest run test/agent-setup.test.ts test/cli-contract.test.ts test/skill-installer.test.ts test/managed-guidance.test.ts` (use actual existing CLI contract test path if named differently); expected GREEN.

### 3.3 VERIFY — sibling call paths

- [x] Verify `install-skill` consumes the same manifest but writes no guidance.
- [x] Verify `--force-skill` cannot override malformed guidance markers, unsafe routes, or races.
- [x] Verify four shared `.agents/skills` logical clients still produce one physical skill write.
- [x] Run focused setup/skill/wizard/adapter tests.

## Phase 4: Fixtures, Package, and Real-Client Evidence

### 4.1 RED/GREEN — fake client discovery

- [x] Extend `scripts/fixtures/fake-agent.mjs` or add bounded fixture helpers that expose effective instruction discovery for Claude/OpenCode/Codex/Gemini.
- [x] Add CLI smoke cases for fresh setup, official predecessor upgrade, custom conflict, human-content preservation, precedence/override, unsupported skill-only clients, and zero-write replay.
- [x] Keep fake binaries/environment hermetic; expected results MUST derive only from controlled fake agents.
- [x] Run `yarn test:cli`; expected GREEN.

### 4.2 RED/GREEN — packed consumer

- [x] Update `scripts/package-smoke.mjs` and release-preflight package-file assertions for all three packaged assets.
- [x] Install the tarball in a clean consumer with paths containing spaces.
- [x] Run setup twice and assert source-independent asset resolution plus idempotency.
- [x] Run `yarn test:package`; expected GREEN.

### 4.3 VERIFY — locally installed clients in isolated homes

- [x] Build first so smoke never exercises stale `dist/`.
- [x] Create disposable HOME/config roots and preserve prerequisite directories required by clients (for example existing `CODEX_HOME`).
- [x] For locally installed Claude/OpenCode/Codex/Gemini, verify the managed block appears in the effective instruction chain using non-destructive/read-only client mechanisms where possible.
- [x] Do not invoke model-credit-consuming probes when a deterministic config/discovery command suffices; if unavoidable, document and seek explicit authorization.
- [x] Confirm Hermes/Copilot receive only the shared skill and no unsupported global instruction file.
- [x] Delete disposable homes after verification; never touch the real home.

## Phase 5: Documentation and Full Verification

### 5.1 Documentation

- [x] Update `README.md` setup output/schema, support matrix, effective paths, `skill_only`, safe official upgrades, custom conflicts, and force scope.
- [x] Update `CHANGELOG.md` under Unreleased.
- [x] Update `docs/adr/0001-secure-yarn-and-agent-setup.md` with managed-block ownership, precedence, digest provenance, convergence, and rollback boundaries.
- [x] Keep claims limited to verified client versions/surfaces.

### 5.2 Canonical gates

- [x] Run `yarn format:check`.
- [x] Run `yarn lint`.
- [x] Run `yarn typecheck`.
- [x] Run `yarn test` and record exact count: 48 files / 631 tests.
- [x] Run `yarn build`.
- [x] Run `yarn test:agent-fixtures`.
- [x] Run `yarn test:mcp`.
- [x] Run `yarn test:lifecycle`.
- [x] Run `yarn test:cli`.
- [x] Run `yarn test:errors`.
- [x] Run `yarn test:package`.
- [x] Run `yarn audit`.
- [x] Run `node scripts/workflow-policy-check.mjs`.
- [x] Run `git diff --check`.

### 5.3 Exact-tree delivery boundary

These checks record the authenticated pre-archive tree. They remain valid only for the unchanged implementation bytes reviewed below; an implementation edit reopens the cohort and all three Review A lanes.

- [x] Stage only the approved implementation/SDD paths in a temporary index; never use `git add -A` or modify the real index.
- [x] Confirm `openspec/archive/2026-08-13-improve-agent-setup/verify-report.md` remains untracked and SHA-256 `df75a6c68d047ef417c74e13db3ac725a1325af21d2ff1067ffcdaf6d1755e9b`.
- [x] Materialize tree `db521aa0ac5880a3e1b1263200bd4058f299cdee` in an isolated execution directory and pass the full cohort on its first attempt.
- [x] Obtain three complete formal Review A PASS verdicts on tree `db521aa0ac5880a3e1b1263200bd4058f299cdee`; trees `9b400946…`, `0ce293f0…`, and `40e18e68…` remain rejected historical evidence.
- [ ] Request explicit authorization before commit/push if not already granted for this separate change.
- [ ] If authorized, create a Conventional Commit, push the exact SHA, verify remote equality, and follow all workflows to terminal status.

### 5.4 Review A remediation

- [x] Preserve `9b4009465c8627d17e7bdd7829f8af4753bd1122` as historical rejected evidence and retain its independent conformance PASS separately from the adversarial `REQUEST_CHANGES`.
- [x] Add RED regressions for parent substitution on create/replace, externally materialized missing parents, identical-byte destination inode replacement, stale `unchanged` plans, and identical-byte postimage replacement before later setup phases.
- [x] Bind existing ancestors, created parent directories, preimages, and postimages by device/inode identity; keep writes and postimage reads relative to authenticated Linux directory descriptors.
- [x] Reauthenticate every plan including `unchanged` before apply and every completed postimage before later asset/MCP mutation and success reporting.
- [x] Use one authenticated read for guidance snapshot bytes plus identity; preserve standalone skill/guidance call paths and update the public Linux support boundary.
- [x] Recompute the bundled skill digest and require exact equality with `releases.json` current SHA-256.
- [x] Run post-fix focused evidence: 54/54 managed-asset tests, 92/92 asset/release-preflight tests, typecheck, and build.

### 5.5 Review A successor remediation

- [x] Preserve tree `0ce293f06b2436b78e32299e2bd83055ef9094f8` and its three Review A verdicts as historical rejected evidence before removing the five authenticated temporary surfaces.
- [x] Add deterministic RED regressions for same-byte and symlink temporary substitution, destination creation/substitution after final validation, successful/failed rollback, committed verification failure, and possibly committed destination replacement.
- [x] Keep the staged and preimage descriptors open through publication; publish missing files from the held staged descriptor.
- [x] Replace pathname overwrite with GNU `mv --exchange --no-copy -T`, validate both identities, and roll back only a proved exact pair.
- [x] Classify post-commit failures as committed or possibly committed, report successful/failed rollback separately, and exclude committed/uncertain operations from genuinely pending work.
- [x] Update public support/security/ADR/skill/SDD contracts for the complete Linux primitive and partial-reporting boundary.
- [x] Run the successor focused and canonical owner-worktree gates recorded in `verification.md`.
- [x] Freeze successor tree `40e18e684861efd79169e91baac5b1ce79a5a937` and pass its isolated exact-tree cohort from the first attempt.
- [x] Obtain Review A for tree `40e18e684861efd79169e91baac5b1ce79a5a937`; its quality lane returned `REQUEST_CHANGES` with three Medium findings while two lanes remained `NOT_COMPLETED`.

### 5.6 Review A remediation for tree `40e18e68…`

- [x] Preserve the authenticated quality-lane `REQUEST_CHANGES` verdict with three Medium findings; retain the conformance and security timeouts as `NOT_COMPLETED`, not verdicts.
- [x] Add deterministic RED regressions for same-inode content and mode edits after final destination validation, including setup partial-result classification.
- [x] Revalidate pinned preimage digest/mode after exchange, revalidate the exact pair before rollback, and wait for a killed coreutils child to close before classifying its mutation outcome.
- [x] Move new development entries under `Unreleased`, restore immutable published `0.7.2` history, and require both headings in the packed-consumer smoke.
- [x] Distinguish the `>=22.5.0` engine floor and published-v0.7.2 evidence from the Node.js 24-only exact-tree evidence for current managed setup bytes; reconcile bounded setup-path diagnostics.
- [x] Run successor focused and canonical owner-worktree gates recorded in `verification.md`.
- [x] Freeze tree `db521aa0ac5880a3e1b1263200bd4058f299cdee` and pass its first-attempt isolated cohort: 48 files / 631 tests plus all declared gates.
- [x] Obtain complete replacement Review A verdicts with zero unresolved Medium-or-higher findings: all three lanes PASS at Critical 0 / High 0 / Medium 0 / Low 0.

### 5.7 Archive and post-archive boundary

- [x] Reconcile this evidence and move the complete seven-file change to `openspec/archive/2026-08-13-managed-structural-editing-guidance/` exactly once.
- [ ] Freeze the post-archive documentary successor and obtain a bounded Review B PASS on those exact bytes.
- [ ] Request explicit authorization before any product commit, push, PR, remote CI, npm publish, dist-tag mutation, tag, or release.
