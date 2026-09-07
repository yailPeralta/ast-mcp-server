# Proposal: Restore Required Quality Gates

## Intent

Restore issue #265’s Node CI matrix from PR #267 commit `4e24b03`, without weakening gates or changing Harness or relationships. Node 22.13 selects ambient pnpm and fails adapter installation; Node 24 installs vulnerable transitives.

## Scope

### In Scope

- Provision and report exact `pnpm@11.7.0` for the disposable DSH adapter profile using private temporary state.
- Resolve `fast-uri@3.1.6` and `qs@6.16.0` through Yarn resolutions and lockfile.
- Add regression, immutable-install, audit, cleanup, and unchanged-workflow gates.

### Out of Scope

- Harness mutation; CI suppression, retry, cache, topology, or ordering changes.
- Changes to Node 22.13/24, public APIs, or relationship/impact/candidate semantics.
- Broad parent upgrades, #247 implementation, release, or delivery actions.

## Capabilities

### New Capabilities

- `required-quality-gates`: Disposable package-manager authority and audit-safe dependency resolution required by CI.

### Modified Capabilities

None.

## Approach

Provision integrity-bound pnpm 11.7 into `COREPACK_HOME` beneath the smoke temporary root, disable latest/auto-pin drift, pass the closed environment to profile installs, assert identity before installation, and remove private state during teardown. If bundled Corepack diverges across Nodes, use a disposable PATH-first exact launcher preserving exit/signal behavior; if that fails, stop rather than mutate Harness or CI.

Pin both patched transitives through existing Yarn `resolutions`, regenerate `yarn.lock` only with Yarn 4.15.0, then prove immutable resolution and a clean audit.

## Affected Areas

| Area                            | Impact    | Description                               |
| ------------------------------- | --------- | ----------------------------------------- |
| `scripts/dsh-adapter-smoke.mjs` | Modified  | Private pnpm authority, identity, cleanup |
| `test/dsh-adapter.test.ts`      | Modified  | Authority and regression assertions       |
| `package.json`, `yarn.lock`     | Modified  | Exact security resolutions                |
| `.github/workflows/ci.yml`      | Unchanged | Preserved mandatory topology              |

## Risks

| Risk                                | Likelihood | Mitigation                                             |
| ----------------------------------- | ---------- | ------------------------------------------------------ |
| Corepack divergence                 | Medium     | Prove both Nodes; bounded launcher fallback            |
| Supply-chain drift/integrity bypass | Medium     | Exact digest, private cache, identity assertion        |
| Dependabot lock conflict            | Medium     | Rebase and regenerate; never hand-merge integrity data |

## Rollback Plan

Revert this independent work unit only after a superseding gate fix exists; remove provisioning/tests and both resolutions together. Never revert #247 or alter Harness.

## Dependencies

- Approved issue #265; planning-only PR #267 at `4e24b03`.
- Registry availability for cold disposable provisioning.

## Success Criteria

- [ ] Both Nodes report private pnpm 11.7.0, complete `DSH_ADAPTER_SMOKE_OK`, and clean temporary state.
- [ ] Yarn 4.15 immutable install succeeds; affected paths resolve only patched versions; audit exits 0 without exceptions.
- [ ] Existing matrix and workflow-policy controls pass with unchanged CI topology and #247 behavior.

## Delivery Strategy

Deliver one sub-400-line bug-fix unit to `main`, with tests beside behavior. Then rebase #247 root-to-child, regenerate conflicting lockfiles from the final manifest, and rerun exact-SHA CI before delivery.
