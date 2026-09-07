# Design: Restore Required Quality Gates

## Technical Approach

At PR #269 commit `8ae73b3`, add smoke-owned package-manager authority and pin vulnerable Yarn transitives. The smoke provisions `pnpm@11.7.0+sha512.19cc852c120c7125760f2443ee6be0ca5b40f9f50598de1a09a1f177503e010e57c23c77646e01e761de59bf874fb22a3398c33ab9691fc13eb946b6f0f4d620` before any profile install. No Harness, workflow, public API, or relationship surface changes.

## Architecture Decisions

| Question | Options / tradeoff | Decision |
|---|---|---|
| How should the smoke own pnpm authority? | Ambient Corepack is small but moving; profile mutation couples to Harness internals; private Corepack preserves Harness behavior. | New `scripts/private-pnpm.mjs` prepares the exact descriptor with a private `COREPACK_HOME`, then verifies bare `pnpm --version` is `11.7.0`. |
| What is the fallback? | Retrying/latest masks authority; a launcher adds code. | Only classified Corepack incompatibility may `npm pack` exact `pnpm@11.7.0`, verify registry integrity `sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==` and local digest, extract privately, and install an `exec` launcher. Timeout, network, digest, or platform failures close without fallback. |
| How should audit remediation persist? | Lock-only refresh may regress; broad parent upgrades expand risk. | Add exact `resolutions` for `fast-uri: 3.1.6` and `qs: 6.16.0`; regenerate, never hand-edit, `yarn.lock` with Yarn 4.15.0. |

## Data Flow

```text
mkdtemp → private env → Corepack exact prepare → bare-pnpm identity gate
                         └─ compatibility only → verified archive → exec launcher
      → every DSH plugin add → existing probes → outer finally removes root
manifest resolutions → Yarn 4.15 resolver → regenerated lock → immutable install/audit
```

`createPrivatePnpmEnvironment` sets `PATH` (private bin, qualifying Harness Node, then host tools), `COREPACK_HOME`, `COREPACK_DEFAULT_TO_LATEST=0`, `COREPACK_ENABLE_AUTO_PIN=0`, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, `PNPM_HOME`, `HOME`, all XDG homes, `npm_config_cache`, `npm_config_registry`, an empty `npm_config_userconfig`, `NODE_OPTIONS=""`, and `CI=true`, all state below `temporaryRoot`. One environment is reused by `installJourneyProfile` and the smoke/web plugin loops. Node 22.13 therefore launches pnpm with the cached qualifying Node 24; Node 24 uses itself.

Provision/identity use `runBoundedCommand` with 120/30-second bounds, no retries, bounded output, and process-tree termination. Cache reuse is intra-run only. Cold/offline fails `BLOCKED`; outer `finally` removes all state.

## File Changes

| File | Action | Exact seam |
|---|---|---|
| `scripts/private-pnpm.mjs` | Create | constants; `createPrivatePnpmEnvironment`, `isCorepackCompatibilityFailure`, `provisionPrivatePnpm` |
| `scripts/dsh-adapter-smoke.mjs` | Modify | provision inside `resolvePinnedHarness` after `resolveHarnessNode`; replace four ad-hoc Corepack environments; record `summary.packageManager` before plugin add |
| `test/private-pnpm.test.ts` | Create | environment ownership, order, mismatch, fallback allow/deny, repeated-root cleanup |
| `test/dsh-adapter.test.ts` | Modify | assert provisioning precedes every plugin add and obsolete `COREPACK_USE_LATEST` is absent |
| `test/dependency-policy.test.ts` | Create | exact manifest/lock selectors and admitted parent ranges |
| `package.json`, `yarn.lock` | Modify | exact resolutions and Yarn-generated patched entries |
| `.github/workflows/ci.yml`, Harness, relationship sources | Unchanged | negative controls |

## Strict RED / GREEN and Trace

Capture each RED before its production edit, then rerun the identical focused command for GREEN.

| Req/scenario | RED | GREEN evidence |
|---|---|---|
| R1–R5 (5/5) | New helper tests fail because private authority/fallback is absent. | Focused tests plus twice-run adapter smoke prove env, digest/version, hostile ambient isolation, compatibility-only fallback, cleanup. |
| R6–R7 (2/2) | Dependency-policy assertion sees 3.1.5/6.15.3; audit exits 1. | Exact lock selectors/checksums, `yarn install --immutable`, `yarn audit` exit 0. |
| R8 (1/1) | Existing Node 22/24 jobs fail. | Unchanged matrix passes exact-SHA chain and reports `DSH_ADAPTER_SMOKE_OK`. |
| R9 (1/1) | Existing policy negatives reject weakening. | Policy tests/checker pass; `ci.yml` blob unchanged. |
| R10 (1/1) | Exclusion snapshot is baseline. | Diff allowlist and existing adapter/relationship suites pass. |
| R11 (1/1) | Work-unit inventory rejects mixed rollback. | Two independent reverts are documented below. |

## Work Units, Rollout, and Rollback

1. **Adapter authority** (180–300 lines): helper, wiring, tests; rollback those hunks. RED/GREEN: `yarn vitest run test/private-pnpm.test.ts test/dsh-adapter.test.ts`; then run `yarn test:dsh-adapter` twice on each Node.
2. **Audit graph** (20–60 lines): manifest, lock, test; rollback resolutions and regenerate lock. RED/GREEN: `yarn vitest run test/dependency-policy.test.ts`; then `yarn install --immutable && yarn audit`.

Each unit is below 400 lines; combined forecast 200–360, so one PR is acceptable. Implement atop PR #266 as requested. After integration, rebase the stack root-to-child and rerun exact-SHA CI. If the Dependabot branch conflicts, rebase first and regenerate from the final manifest; never merge lock checksums manually. Workflow policy remains unchanged.

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A — no executable classification |
| Git repository selection | N/A — no new Git command |
| Commit state | N/A — no commit automation |
| Push state | N/A — no push automation |
| PR commands | N/A — no PR automation |

## Open Questions

None. Structural AST preflight returned `NOT_FOUND` (`77fc02dd-9965-4642-8f10-ece88cf5b11d`); TypeScript inspection here is textual, and implementation must retry compiler-backed status before test edits.
