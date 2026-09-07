# Feature Branch Chain: Issue #265 Required Quality Gates

## Governing Boundary

- **Authority:** approved issue #265. The immediate planning base is PR #270 commit `5e9d303`, which is planning-only and supplies no candidate, review, correction, merge, or delivery authority.
- **Mode:** RDD `disabled/unmanaged`; no receipt or approval is implied. Delivery strategy is `auto-chain` with a feature-branch chain.
- **Apply edit set:** only the exact U1 or U2 files named below after a future authorized apply context. This tasks phase edits only this OpenSpec change directory.
- **Excluded:** DeepSeek Harness files/runtime, `.github/workflows/ci.yml`, public APIs/schemas/tool registration, relationship/impact/test-candidate behavior, issue #247 implementation, gate weakening, retries, skips, cache additions, reordered gates, commits, pushes, PR/issue mutation, acquire/settle execution, review, merge, archive, or release.
- **Budget:** authored additions plus deletions, including tests and metadata, MUST remain at or below 400 per unit. Generated lock data remains in candidate identity and review even where forecasted separately.

## Immediate-Predecessor Topology

| Unit / branch                     | Exact base           | Forecast / hard max | Independently usable finish                                                                          |
| --------------------------------- | -------------------- | ------------------: | ---------------------------------------------------------------------------------------------------- |
| U1 `fix/265-u1-private-pnpm`      | PR #270 at `5e9d303` |       260–390 / 400 | Every adapter profile install uses one exact, private, verified pnpm authority with bounded cleanup. |
| U2 `fix/265-u2-audit-resolutions` | Frozen U1 candidate  |         30–90 / 400 | Yarn 4.15 resolves patched transitives; immutable install and audit are clean.                       |

U1 targets the PR #270 planning branch; U2 targets U1. A child diff MUST contain only its own unit. Auto-chain authorizes this plan, not branch, commit, push, PR, review, issue, or delivery operations.

## Common Strict-TDD and Attempt Protocol

Before runtime-bearing work, U1 uses acquire ID `issue265-u1-apply-v1` and settle ID `issue265-u1-settle-v1`; U2 uses `issue265-u2-apply-v1` and `issue265-u2-settle-v1`. IDs are globally distinct and may be reused only for idempotent replay. Proceed only on compact attempt state `proceed`; retain the opaque token, and let a child authenticate that same attempt with the token rather than acquiring blind. `blocked` or `complete` stops the unit.

Strict RED twice means: make test-only edits; run the unit’s exact focused command; record exit code, failing test names, and normalized failure fingerprint; without changing any test, fixture, source, manifest, lockfile, config, or generated output, rerun the identical command and require the identical behavior failure. A pass, changed fingerprint, infrastructure/network failure, or unrelated failure stops apply. Never publish a failing-test-only child.

After GREEN, refactor only while the focused command stays green. Each unit records changed paths, authored line count, complete candidate manifest (including untracked/generated files), focused result, runtime result, Node versions, immutable/audit evidence, cleanup readback, rollback boundary, and exact candidate identity before settle.

## U1 — Deterministic Adapter pnpm Authority

### Exact files and functions

- Create `scripts/private-pnpm.mjs`: constants for exact descriptor/version/hex and registry SRI; `createPrivatePnpmEnvironment`, `isCorepackCompatibilityFailure`, and `provisionPrivatePnpm`. Private paths include `COREPACK_HOME`, `PNPM_HOME`, `HOME`, all XDG homes, npm cache/userconfig, and PATH under the smoke temporary root.
- Modify `scripts/dsh-adapter-smoke.mjs`: import the helper; in `resolvePinnedHarness`, provision immediately after `resolveHarnessNode` and before `materializePinnedHarness`; pass one closed environment through `materializePinnedHarness`, `packPinnedMcpClient`, `installJourneyProfile`, `runNativeAgentJourney`, and the smoke/web plugin-add loops; record `summary.packageManager` before any plugin add. Remove all `COREPACK_USE_LATEST` authority.
- Create `test/private-pnpm.test.ts`: tests named `owns every package-manager path below the disposable root`, `rejects version or digest mismatch before profile state`, `ignores hostile ambient pnpm and Corepack homes`, `permits fallback only for classified Corepack incompatibility`, `preserves launcher exit and signal outcomes`, and `removes repeated success and failure roots`.
- Modify `test/dsh-adapter.test.ts`, `pinned Harness smoke contract`: parse/order assertions proving provision and bare `pnpm --version` precede every `installJourneyProfile`/plugin add, exact summary identity exists, and obsolete authority variables are absent.

### RED, GREEN, runtime, and cleanup

Exact RED/GREEN command: `yarn vitest run test/private-pnpm.test.ts test/dsh-adapter.test.ts --reporter=dot`. Expected RED: new authority tests fail because the helper, closed environment, exact identity, compatibility classifier, and ordering are absent; existing unrelated adapter assertions remain green.

GREEN provisions `pnpm@11.7.0+sha512.19cc852c120c7125760f2443ee6be0ca5b40f9f50598de1a09a1f177503e010e57c23c77646e01e761de59bf874fb22a3398c33ab9691fc13eb946b6f0f4d620`, then requires bare `pnpm --version` to equal `11.7.0`. Set `COREPACK_DEFAULT_TO_LATEST=0`, `COREPACK_ENABLE_AUTO_PIN=0`, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, `NODE_OPTIONS=""`, and `CI=true`; private bin and qualifying Harness Node precede host tools.

Use `runBoundedCommand`: 120 seconds for provisioning, 30 seconds for identity, bounded output, process-tree termination, no retries, and no `Promise.race` early return. Only a classified Corepack incompatibility may run `npm pack --json pnpm@11.7.0`; require registry integrity `sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==`, recompute local SHA-512, extract privately, and create a PATH-first exec launcher preserving exit/signal behavior. Timeout, network, integrity, extraction, or platform errors fail `BLOCKED` without fallback.

Runtime matrix, twice per cell: `env DSH_HARNESS_SOURCE="$DSH_HARNESS_SOURCE" "$AST_NODE_22_13_BIN" scripts/dsh-adapter-smoke.mjs` and `env DSH_HARNESS_SOURCE="$DSH_HARNESS_SOURCE" "$AST_NODE_24_BIN" scripts/dsh-adapter-smoke.mjs`. Require observed Node `22.13.0` and `24.x`, private pnpm `11.7.0`, `DSH_ADAPTER_SMOKE_OK`, zero owned processes, and absence of the complete temporary root after success and forced failure. Node 22.13 must use the smoke-selected qualifying Node 24 for Harness/pnpm, never ambient pnpm.

Rollback: revert only `scripts/private-pnpm.mjs`, U1 hunks in `scripts/dsh-adapter-smoke.mjs`, `test/private-pnpm.test.ts`, and U1 hunks in `test/dsh-adapter.test.ts`. Do not remove U1 after U2 exists; revert the complete #265 candidate only after a superseding gate fix.

## U2 — Audit-Safe Resolutions and Lock

### Exact files and assertions

- Create `test/dependency-policy.test.ts`: `reads package.json and yarn.lock through readFile`; assert `packageManager === "yarn@4.15.0"`; exact resolutions `fast-uri: "3.1.6"` and `qs: "6.16.0"`; one lock selector for `fast-uri@npm:^3.0.1` resolving only `3.1.6`; one combined selector for `qs@npm:^6.14.0, qs@npm:^6.15.2` resolving only `6.16.0`; no `3.1.5`/`6.15.3`; and admitted parent edges `ajv → ^3.0.1`, `express → ^6.14.0`, `body-parser → ^6.15.2`.
- Modify `package.json` `resolutions` only by adding the two exact values beside existing pins.
- Regenerate `yarn.lock` only by Yarn 4.15.0 from the final manifest. Never hand-edit selectors, checksums, integrity, or resolution records.

Exact RED/GREEN command: `yarn vitest run test/dependency-policy.test.ts --reporter=dot`. Expected RED twice: assertions report manifest pins absent and lock resolutions still `fast-uri@3.1.5` and `qs@6.15.3`; record `yarn audit` as a separate baseline, not as the RED fingerprint.

GREEN/refactor gates: require `yarn --version` = `4.15.0`; snapshot manifest/lock hashes; run `NODE_OPTIONS= yarn install --immutable`; require hashes unchanged; run `yarn audit` and require exit 0 without resolutions bypass, exclusions, suppressions, or exceptions. Repeat immutable install to prove repeatability, run the focused test, `yarn vitest run test/workflow-policy-check.test.ts test/dsh-adapter.test.ts --reporter=dot`, and verify `.github/workflows/ci.yml` blob equals the U1 predecessor.

Rollback: remove only both resolutions and `test/dependency-policy.test.ts`, then regenerate `yarn.lock` with Yarn 4.15.0 from the reverted manifest. Never restore checksums by hand or revert U1, #247, Harness, workflow, or relationship files.

## Requirement / Scenario Map (11 / 11)

| Requirement                        | Unit / direct proof                          |
| ---------------------------------- | -------------------------------------------- |
| R1 Private Corepack state          | U1 environment ownership/order test          |
| R2 Exact pnpm identity/integrity   | U1 version/digest mismatch test              |
| R3 No ambient authority            | U1 hostile-host test                         |
| R4 Bounded cleanup/repetition      | U1 repeated success/failure cleanup test     |
| R5 Fail-closed fallback launcher   | U1 classifier plus exit/signal tests         |
| R6 Patched transitive resolutions  | U2 manifest/lock/parent-edge test            |
| R7 Immutable audit-safe graph      | U2 immutable hash and audit gates            |
| R8 Supported Node matrix           | U1 and complete-candidate 22.13.0/24 runs    |
| R9 Workflow topology preservation  | U2 policy suite plus unchanged blob          |
| R10 Harness/relationship exclusion | Complete candidate path allowlist/hashes     |
| R11 Independent rollback           | Both unit rollback drills and final ordering |

## Unit and Final Quality Gates

At each unit checkpoint run `yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build`. Also run `yarn test:mcp && yarn test:errors && yarn test:lifecycle && yarn test:cli && yarn test:package`, `yarn pack --dry-run --json`, `node scripts/workflow-policy-check.mjs`, and `git diff --check`. U1 additionally runs the four adapter matrix smokes; U2 and the complete candidate run immutable install twice and clean audit. Inspect names/comments/interfaces, bounded execution, secret-free diagnostics, no retries, no mutable global cache, no leaked process/timer/listener/root, and no drive-by or excluded-path changes.

Stop before further edits if a unit exceeds 400 authored lines, RED is unstable, the base is not the immediate predecessor, a child diff includes prior-unit bytes, a required gate fails for a change-caused reason, immutable install mutates dependency data, audit is nonzero, cleanup is incomplete, or any excluded surface changes. Split only at an independently green behavior seam; update tasks/chain/progress and assign new unique attempt IDs before resuming. No size exception is allowed.

## Complete Candidate, Judgment, Strict Verify, and Delivery

After U2 settles, freeze one immutable manifest containing U1, U2, generated lock data, test evidence, and exclusion hashes. Launch two blind read-only Judgment judges in parallel against identical bytes, criteria, and resolved skill paths. Wait for both and merge confirmed, suspect, contradiction, and INFO rows. Only severe findings confirmed by both are correction-eligible; correction requires explicit consent and at most two fix/re-judgment rounds. Partial judgment, contradiction, or unresolved severe findings ends `JUDGMENT: ESCALATED`; only `JUDGMENT: APPROVED` advances. Judgment grants no receipt or delivery authority.

Independent strict verification binds to the post-Judgment exact candidate and requires all 11 requirements and 11 scenarios mapped to direct assertions; zero active RED; both focused suites; all unit/final commands above; two immutable installs with unchanged hashes; clean audit; four adapter smokes; exact exclusion hashes; and the unchanged required CI workflow passing both Node cells for that exact SHA. Read back remote CI by commit SHA. Any byte change invalidates Judgment, verification, and CI evidence.

Only after those gates and separate repository delivery authority may issue #265’s implementation chain merge independently to `main`. Read back protected `main` and required CI at the merged SHA. Then rebase the issue #247 chain root-to-child onto that final `main`; each child must retain only its own diff. Resolve dependency conflicts by regenerating `yarn.lock` from each final manifest with Yarn 4.15.0, never by hand. Re-run #247 focused/runtime/full/benchmark/format/audit/strict requirement trace, dual-review state validation as required by its own lineage, and exact-SHA Node 22.13.0/24 CI before any #247 delivery claim.
