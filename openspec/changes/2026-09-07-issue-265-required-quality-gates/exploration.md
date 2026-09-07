## Exploration: Restore required Node quality gates for issue #265

### Current State

#### Authority and baseline

- **Observed:** GitHub issue [#265](https://github.com/yailPeralta/ast-mcp-server/issues/265) is open with `status:approved` and `type:bug`. Its exclusions forbid Harness changes, CI weakening, and relationship/impact/candidate behavior changes.
- **Observed:** the requested planning baseline is current `HEAD` and PR [#266](https://github.com/yailPeralta/ast-mcp-server/pull/266) head `f8fdcff0f46eeb0420a1eb93babbc4bc1a371142`; `origin/main` is `6173a39a73f1540c17335a330ea7f14f982387cb`.
- **Observed:** the working tree was clean before this exploration. Relevant files (`package.json`, `yarn.lock`, `.yarnrc.yml`, `.github/workflows/ci.yml`, `scripts/dsh-adapter-smoke.mjs`, and `test/dsh-adapter.test.ts`) have identical Git blob IDs at `6173a39` and `f8fdcff`; therefore both defects predate and are independent of the #247 relationship implementation.
- **Observed:** RDD is `disabled/unmanaged` in the adjacent active #247 state, and no repository enablement was found. This phase claims no receipt, review, delivery, commit, push, PR, issue, acquire/settle, or archive authority.

#### Required CI topology

`.github/workflows/ci.yml` has one `quality` matrix over Node `22.13.0` and `24`. Node 24 performs the immutable Yarn 4.15.0 install, then the matrix runtime is activated. Both cells run the same ordered gates, including Playwright installation, `yarn test:dsh-adapter`, and then `yarn audit`. No `actions/setup-node` package-manager cache is configured. `scripts/workflow-policy-check.mjs` freezes this exact matrix and ordered command chain, so weakening, skipping, or reordering the failing gates is not an acceptable fix.

#### Failure 1 — Node 22 DSH adapter

**Observed exact evidence:** PR #266 pull-request run [34071574543](https://github.com/yailPeralta/ast-mcp-server/actions/runs/34071574543), SHA `f8fdcff0...`, completed `failure`. Job `quality (22.13.0)` passed setup, immutable install, format, lint, typecheck, tests, build, all prior smokes, and Playwright installation; `yarn test:dsh-adapter` alone failed with exit 1. The log recorded:

```text
dsh: initialized profile smoke at /tmp/ast-dsh-adapter-ektUgD/dsh-home/profiles/smoke
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-12.3.4.tgz
! The local project doesn't define a 'packageManager' field. Corepack will now add one referencing pnpm@12.3.4+sha512.961aa41f...
Error: Cannot find module '/home/runner/.cache/node/corepack/v1/pnpm/12.3.4/bin/pnpm.cjs'
code: 'MODULE_NOT_FOUND'
Node.js v22.13.0
dsh: pnpm failed in profile directory /tmp/ast-dsh-adapter-ektUgD/dsh-home/profiles/smoke
```

The same signature occurred on prior completed run `34070085488` at `1715ddca...`, with another fresh `/tmp/ast-dsh-adapter-*` profile. The current push and pull-request runs for `f8fdcff` both failed, while the Node 24 cell completed the full DSH adapter and failed only at audit.

**Observed mechanism:**

1. `package.json` pins this project to `yarn@4.15.0`; that pin does not govern DSH profile plugin installation.
2. The pinned Harness root declares `packageManager: pnpm@11.7.0` and engines `^22.19.0 || >=24.0.0`.
3. `scripts/dsh-adapter-smoke.mjs` correctly uses a qualifying cached Harness Node when the matrix Node is 22.13.0, but its DSH environment inherits ambient `PATH` and ambient Corepack cache. It sets undocumented `COREPACK_USE_LATEST=0`, not Corepack's documented `COREPACK_DEFAULT_TO_LATEST=0`.
4. Pinned Harness `runPlugin` initializes the disposable profile and then executes bare `spawnSync('pnpm', ...)` in that profile.
5. Pinned Harness `initProfile` writes a profile `package.json` with name/private/dependencies/DSH metadata but no `packageManager` field. Corepack therefore has no project-local selector and chooses its moving Known Good/latest release.
6. Registry metadata confirms `pnpm@12.3.4` is Node-compatible (`>=18.*`) but publishes top-level bin entries (`pnpm`, `pn`, `pnpx`, `pnx`), while the failing bundled Corepack attempted the absent legacy path `bin/pnpm.cjs`. Registry metadata for the Harness-pinned `pnpm@11.7.0` declares Node `>=22.13`, uses `bin/pnpm.mjs`, and therefore supports both repository matrix floors.

**Classification:** deterministic package-manager authority/configuration defect, not a network/cache flake. A cache miss is visible, but it is the consequence, not the cause: two fresh CI executions selected the same unpinned version and failed on the same absent entrypoint after the registry download announcement; there is no DNS, timeout, HTTP, checksum, or transient network error. The version/layout mismatch is reproducible from the logged path and registry package metadata. Retrying or caching `pnpm@12.3.4` would preserve the wrong authority and can preserve the same incompatible entrypoint.

#### Failure 2 — Node 24 Yarn audit

**Observed exact evidence:** the same PR #266 run's `quality (24)` job passed the complete DSH adapter (`DSH_ADAPTER_SMOKE_OK`) and then `yarn audit` exited 1. The lockfile and CI log identify six deterministic advisories:

| Locked package   | Advisory IDs                                                                               | Severity | Vulnerable range                                             | Patched candidate |
| ---------------- | ------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------ | ----------------- |
| `fast-uri@3.1.5` | `GHSA-5jgf-p345-68v8`, `GHSA-f65p-4m7j-42xc`, `GHSA-fph4-wmhf-6fwf`, `GHSA-jqff-g426-hqxp` | high     | all four exclude `3.1.6` (`<3.1.6` under their lower bounds) | `3.1.6`           |
| `qs@6.15.3`      | `GHSA-x5fp-wj9c-mxmx`, `GHSA-4mjr-xmp4-gh2g`                                               | moderate | `>=6.14.2 <=6.15.3`; `>=2.2.5 <6.16.0`                       | `6.16.0`          |

**Observed dependency paths from `yarn.lock`:**

```text
ast-mcp-server
└─ @modelcontextprotocol/sdk@1.30.0
   ├─ ajv@8.20.0
   │  └─ fast-uri@^3.0.1 → 3.1.5
   └─ express@5.2.1
      ├─ qs@^6.14.0 → 6.15.3
      └─ body-parser@2.3.0
         └─ qs@^6.15.2 → 6.15.3
```

Both patched candidates satisfy every existing parent range. Registry metadata reports no `engines` restriction for `fast-uri@3.1.6` and Node `>=0.6` for `qs@6.16.0`, so both are compatible with Node 22.13 and 24. Registry integrity evidence is available for both (`fast-uri@3.1.6` sha512 `7Ical1v...`; `qs@6.16.0` sha512 `h6fhOIa...`).

**Classification:** deterministic lockfile defect, not a registry flake. `yarn install --immutable` faithfully installs the vulnerable exact lock entries, and audit reports the same dependency graph on repeated runs.

#### Local reproduction boundary

No local test or reproduction command was run because the approved write boundary permits only this change directory. `yarn test:dsh-adapter` intentionally writes build/tarball/profile/workspace/Corepack/browser state under the checkout, `$HOME`, and `/tmp`; `yarn audit` may read or populate Yarn cache/network state; Vitest fixtures use `os.tmpdir()`. None can be proven write-confined to the allowed root. Existing exact CI logs, lockfile evidence, pinned Harness source inspection, and registry metadata provide the safe exploration evidence.

Safe future reproduction in an authorized disposable worktree/container:

1. Start from exact candidate SHA with a new writable `HOME`, `XDG_CACHE_HOME`, `COREPACK_HOME`, `TMPDIR`, and no reused package-manager cache.
2. Activate Yarn 4.15.0 and run `yarn install --immutable` under Node 24.
3. Activate Node 22.13.0, run the focused regression test, then `yarn test:dsh-adapter`; before the fix expect Corepack's `pnpm@12.3.4` selection and `MODULE_NOT_FOUND`, after the fix require the exact pinned pnpm identity and `DSH_ADAPTER_SMOKE_OK`.
4. Under Node 24 run `yarn audit`; before the fix expect exactly the six advisories above and exit 1, after the fix expect exit 0.
5. Run the complete Node 22.13/24 CI matrix and `node scripts/workflow-policy-check.mjs`; require unchanged workflow topology and a clean post-run Git diff.

### Affected Areas

- `scripts/dsh-adapter-smoke.mjs` — owns the disposable Harness checkout/profile, Corepack environment, plugin installation, identity summary, and cleanup; this is the primary package-manager fix seam.
- `test/dsh-adapter.test.ts` — existing adapter contract suite and focused RED/GREEN seam for exact package-manager selection, private cache ownership, no ambient-latest fallback, and cleanup assertions.
- `package.json` — existing `resolutions` policy is the narrow place to pin patched transitive security versions without adding them as public runtime dependencies.
- `yarn.lock` — records the vulnerable dependency paths and must resolve `fast-uri@3.1.6` and `qs@6.16.0` after the Yarn-governed update.
- `.github/workflows/ci.yml` — read-only implementation verification target; no change is recommended because the matrix and mandatory gates are correct.
- `scripts/workflow-policy-check.mjs` and `test/workflow-policy-check.test.ts` — unchanged negative controls proving the CI chain was not weakened or reordered.
- `CHANGELOG.md` — optional concise bug-fix note only if project release convention requires it; no behavior documentation or public API migration is otherwise needed.
- Pinned DeepSeek Harness `apps/cli/src/plugin.ts` and `packages/boot/app-boot/src/profile.ts` — read-only causal evidence only; MUST NOT be changed.
- Relationship source/tests (`src/services/relationships.ts`, impact/candidate services, and their tests) — explicit negative scope; no edits and no semantic changes.

#### Structural inspection note

Compiler-backed AST tools were attempted before TypeScript inspection. `ast_get_project_status` returned no model-visible content for both the repository root and `tsconfig.test.json`; `ast_get_file` returned `NOT_FOUND` with correlation ID `afc51639-8858-449a-89d5-7857fe01fffc` for the root selector and no model-visible content with `tsconfig.test.json`. Consequently, the bounded read of `test/dsh-adapter.test.ts` is explicitly a textual fallback, not compiler-authoritative evidence. This does not block proposal because the defect is in package-manager/configuration/runtime-script boundaries, but implementation should retry a fresh compiler-backed status before any TypeScript test edit.

### Approaches

1. **Private exact Corepack authority for the disposable smoke (recommended)** — before DSH plugin installation, provision `pnpm@11.7.0` (prefer the exact sha512-bound descriptor) into `COREPACK_HOME` below `temporaryRoot`, set documented `COREPACK_DEFAULT_TO_LATEST=0` and `COREPACK_ENABLE_AUTO_PIN=0`, and pass that same closed environment to every DSH profile install. Require the smoke to report/read back the selected pnpm identity and rely on existing `finally` removal of `temporaryRoot` to remove the cache.
   - Pros: uses the Harness-declared pnpm version; compatible with Node `>=22.13`; removes registry-latest and ambient-home authority; requires no Harness or workflow change; cleanup stays inside the existing disposable rollback boundary.
   - Cons: still relies on the matrix Corepack shim to execute a privately provisioned manager; the exact `corepack install --global`/legacy equivalent must be proven on both bundled Corepack versions; current integrity-key bypass deserves a hash-bound package descriptor rather than version-only trust.
   - Effort: Low/Medium.

2. **Pin `packageManager` inside each generated profile** — arrange profile initialization before the first plugin add, then add exact `pnpm@11.7.0` metadata and let Corepack resolve it.
   - Pros: selection is visible in the profile manifest and follows Corepack's preferred project contract.
   - Cons: the first `dsh plugin add` currently creates the profile and immediately invokes pnpm, so the smoke would have to duplicate private Harness profile schema or introduce an extra Harness boot/init dependency; it couples the test to internals and allows Corepack to write profile metadata. This is less isolated than private provisioning.
   - Effort: Medium; not recommended.

3. **Bypass the ambient shim with a disposable exact pnpm launcher** — place a private `pnpm` launcher first on `PATH` that invokes `corepack pnpm@11.7.0` (or a verified extracted exact package) with the qualifying Harness Node and private cache.
   - Pros: strongest control over the executable and Node used by Harness's bare `spawnSync('pnpm')`; no profile schema duplication.
   - Cons: adds launcher/platform/process-forwarding code and signal/exit semantics; more code than private KGR provisioning. Keep as fallback if bundled Corepack cannot share the private exact default reliably.
   - Effort: Medium.

4. **Audit lock refresh only** — use Yarn's supported transitive update (`yarn up -R fast-uri@3.1.6 qs@6.16.0` or equivalent lock refresh) without manifest resolutions.
   - Pros: smallest manifest surface; both parent ranges already admit patched versions.
   - Cons: the security floor is implicit and may regress on a later broad lock refresh; exact command behavior must be verified with Yarn 4.15.0.
   - Effort: Low.

5. **Exact Yarn `resolutions` plus regenerated lock (recommended)** — add `fast-uri: 3.1.6` and `qs: 6.16.0` beside existing security/compatibility resolutions, regenerate only `yarn.lock` with Yarn 4.15.0, then run immutable install and audit.
   - Pros: deterministic, explicit, consistent with the repository's existing `hono`/`nanoid` resolution practice, within all parent semver ranges, and does not make either package a direct/public dependency.
   - Cons: exact transitive pins require later maintenance and can conflict textually with open Dependabot PR #3's independent `package.json`/`yarn.lock` updates.
   - Effort: Low.

6. **Upgrade broad parents or suppress audit** — upgrade MCP SDK/Ajv/Express, add audit exceptions, skip the gate, or retry/cache the moving pnpm release.
   - Pros: none sufficient for this defect boundary.
   - Cons: broader compatibility blast radius or explicit CI weakening; retries/caches do not establish authority; prohibited by issue scope.
   - Effort: Medium/High; rejected.

### Recommendation

Implement one independent bug-fix work unit combining approach 1 and approach 5:

1. Introduce an exact, hash-aware `pnpm@11.7.0` smoke constant derived from the pinned Harness package-manager contract and registry integrity (`sha512` hex `19cc852c120c7125760f2443ee6be0ca5b40f9f50598de1a09a1f177503e010e57c23c77646e01e761de59bf874fb22a3398c33ab9691fc13eb946b6f0f4d620`). Provision it into a `COREPACK_HOME` below the existing `temporaryRoot`, disable latest/KGR drift with the documented variable, disable auto-pin, and reuse that environment for every DSH profile install. Do not edit or patch Harness.
2. Add behavior-oriented assertions that fail on the current ambient selection, prove exact pnpm identity/private cache ownership before plugin installation, and preserve the end-to-end `yarn test:dsh-adapter` as the authoritative RED-before/GREEN-after runtime proof.
3. Add exact Yarn resolutions `fast-uri: 3.1.6` and `qs: 6.16.0`, regenerate the lock with Yarn 4.15.0, and require `yarn install --immutable` plus `yarn audit` exit 0 under both matrix cells where reached.
4. Leave `.github/workflows/ci.yml`, Harness, and all relationship/impact/candidate code unchanged.

#### Strict behavior-first RED map

| Requirement                         | RED before fix                                                                                                                                                                                                  | GREEN after fix                                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact profile package manager       | Existing Node 22 CI `yarn test:dsh-adapter`: exit 1 after selecting `pnpm@12.3.4` and missing `bin/pnpm.cjs`; focused test should reject absent private exact authority and undocumented `COREPACK_USE_LATEST`. | Focused assertion passes; smoke records exact `pnpm@11.7.0`, uses only disposable `COREPACK_HOME`, completes `DSH_ADAPTER_SMOKE_OK`, and removes the entire temporary root. |
| Audit-safe graph                    | Existing Node 24 CI `yarn audit`: exit 1 with exactly four high fast-uri and two moderate qs advisories.                                                                                                        | Lock assertions resolve only `fast-uri@3.1.6` and `qs@6.16.0`; `yarn install --immutable` and `yarn audit` exit 0.                                                          |
| No CI weakening                     | Negative workflow-policy tests already reject matrix/command removal or reordering.                                                                                                                             | Existing workflow-policy unit suite and executable checker remain green with byte-unchanged `ci.yml`.                                                                       |
| No relationship/DSH behavior change | Existing relationship, impact, candidate, adapter catalog/guard, and exact Harness smoke results are baseline controls.                                                                                         | Same tests and Harness identities/catalog semantics pass; only package-manager provisioning and dependency lock identities differ.                                          |

#### Compatibility and rollback

- Public package API, MCP schemas, CLI arguments, tool catalog, relationship/impact/candidate semantics, and DeepSeek Harness source/profile behavior remain unchanged.
- Node support remains `>=22.13.0`; pnpm 11.7.0 explicitly supports `>=22.13`, fast-uri has no restrictive engine, and qs supports `>=0.6`.
- Rollback boundary is one independent work-unit revert covering the smoke's private pnpm provisioning/tests plus the two manifest resolutions and lock entries. It must not revert #247 relationship commits or modify Harness. A rollback intentionally restores the known red gates, so it is operationally safe only after a superseding package-manager and audit fix exists.

#### Authored diff forecast and delivery strategy

Forecast: `scripts/dsh-adapter-smoke.mjs` 35–80 lines; focused adapter/dependency assertions 25–70 lines; `package.json` 2–4 lines; `yarn.lock` roughly 10–30 changed lines; optional changelog 2–6 lines. Expected authored additions plus deletions: **75–190**, low risk and below 400. Keep tests and fix in one reviewable bug-fix commit/PR; no chain or size exception is needed. If exact private-launcher fallback pushes the patch toward 400, split only into independently working package-manager and dependency-audit work units, each with its own RED/GREEN and rollback—not by file type.

#### Chain/rebase integration

Issue #265 is independent in behavior but a delivery prerequisite for #247. The relevant fix files are byte-identical between `origin/main@6173a39` and PR #266 head `f8fdcff`, so the recommended integration is:

1. Design and verify against the requested full-chain baseline `f8fdcff`.
2. Deliver #265 as a standalone root PR to `main` (or transplant the single self-contained work-unit commit onto a branch from current `main`) so required checks can become green independently.
3. After #265 merges, rebase PR #249 onto updated `main`, then cascade/rebase each immediate child through PR #266 and rerun exact-SHA CI. Do not merge #247 while its ancestor checks remain red merely because a later child contains the fix.
4. Resolve the predictable `package.json`/`yarn.lock` conflict with open Dependabot PR #3 by regenerating the lock from the final rebased manifest; do not hand-merge checksums.

Appending #265 only after PR #266 would avoid mass rebases but leave earlier required checks red and make the prerequisite depend on the feature it is meant to unblock; it is therefore not recommended for strict delivery.

### Risks

- Bundled Corepack command syntax differs across Node 22.13 and 24; proposal/design must choose and test one exact provisioning sequence supported by both, with a private launcher fallback if necessary.
- `COREPACK_INTEGRITY_KEYS=0` currently bypasses signing-key validation for pinned Harness builds. Exact sha512 package binding should prevent the new provisioning step from becoming a weaker moving download, but this must be demonstrated rather than assumed.
- The DSH smoke runs a qualifying Harness Node while its bare pnpm child currently resolves through matrix `PATH`; environment and identity assertions must distinguish those two authorities and avoid claiming the Harness itself runs on unsupported Node 22.13.
- Exact transitive resolutions can become stale; retain comments/change documentation explaining the advisory floor and reevaluate when parent packages advance.
- Open Dependabot PR #3 overlaps the manifest/lockfile and can cause a textual or semantic rebase conflict.
- Compiler-backed AST inspection was unavailable in this session; TypeScript test edits require a fresh AST preflight during implementation.
- No local executable proof was safe under this phase's write boundary; final confidence depends on authorized disposable RED/GREEN execution and exact-SHA remote matrix readback.

**Concrete proposal blockers:** none. Implementation blockers remain conditional: if neither exact private Corepack provisioning nor a private exact launcher works on both bundled Corepack versions, stop and document that compatibility result rather than modifying Harness or CI. Registry availability is required for a cold smoke unless a verified package-manager archive is deliberately provisioned.

### Ready for Proposal

**Yes.** Both failures are precisely classified with current exact-SHA CI evidence, dependency paths, supported patched versions, a minimal no-Harness/no-relationship solution, behavior-first RED/GREEN gates, a sub-400-line delivery forecast, rollback, and chain integration. The next phase is `sdd-propose` for `2026-09-07-issue-265-required-quality-gates`.
