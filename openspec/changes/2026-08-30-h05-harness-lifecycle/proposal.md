# Proposal: H-05 user-visible Harness lifecycle

## Decision

Close tracker #116 through four stacked PRs, beginning with approved docs issue #117. Removal means deterministic Cordis config-HMR disposal; raw transport loss retains the last-good catalog and is not removal evidence.

## Scope

- Phase 0 records PR #115 merged at `7ab04c29a274156c78c470eb7bc3488ce057b928`, archived H-03, final main CI/Security green, and unreleased v0.13.1.
- Authenticate Harness `dsh-v0.1.2-alpha.1` / `cd5ef8148158c3a752a658978873241fdf8e2bbc`, bridge `0.1.2-alpha.1`, CLI/source, AST candidate/tarball/entrypoint, adapter/config, Node/executable, profile, Agent/Session, Web, Playwright, and Chromium before lifecycle state; drift is `BLOCKED`.
- Prove config-HMR `15 → 0 → 15`, stale/late rejection, one fresh schema-identical catalog, Session user cancellation with one bounded AST terminal result, shutdown, full owned-state cleanup, and rendered Trajectory Tools rows correlated to durable headers.
- Preserve H-01a/H-02/H-03, guarded 15 tools, and apply denial.

Excluded: apply/H-04, UI development, Code Mode/PTC, #103, generic executors/pools, canaries/newer identities, host/bridge edits, and the post-merge v0.13.1 release.

## Implementation and review

Extend `scripts/dsh-adapter-smoke.mjs` and the existing environment-gated fixture; modify runtime/production seams only after the smallest RED. Use the pinned browser surface; registry/config/MCP/probe/JSONL may correlate but never substitute for rendered GUI state.

| PR  | Deliverable                        | Rollback                        |
| --- | ---------------------------------- | ------------------------------- |
| 1   | Docs baseline and compact OpenSpec | Revert docs/OpenSpec only.      |
| 2   | Private closed seams               | Revert fixture/helpers/tests.   |
| 3   | Native HMR/cancel/shutdown gate    | Revert smoke lifecycle helpers. |
| 4   | GUI witness and closure            | Revert browser/closure slice.   |

Risks are cancellation or late-settlement ownership, indirect GUI proof, and HMR timing; fail exact REDs, require rendered correlation, and use event barriers. Success requires all lifecycle/predecessor gates green with no identity skip, duplicate evidence, or residue.
