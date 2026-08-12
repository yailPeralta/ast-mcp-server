# Cold-install runtime separation

## Problem

The successor CI run `31547160641` for commit `94cbdf9b92104b92b14d0cc5a692ad597e4e945f` disproved the previous Node 22.5 package-manager diagnosis. The job explicitly cleared `NODE_OPTIONS`, yet Yarn 4.15.0 still terminated during a first-attempt cold link with exit code 42 and `unexpected empty event loop`. Node 24 completed the full job.

The local release-candidate matrix had reported PASS because it ran `yarn install --immutable` in the already-populated maintainer workspace. That was an incremental install, not a cold-link reproduction.

Fresh exact-tree probes reproduced the Node 22.5 failure in four of five first attempts. Yarn 4.18.0 failed at the same boundary, so upgrading Yarn does not remove the defect. Installing the exact candidate with Node 24 and then running the complete suite with Node 22.5 and `--experimental-sqlite` passed 529/529 tests.

## Intent

1. Separate package-manager execution from the runtime-under-test: Node 24 performs Corepack activation and immutable dependency installation; the exact Node 22.5/24 matrix still executes every product and quality gate.
2. Make the local release-candidate matrix materialize each exact candidate into a private fresh Git worktree before installation.
3. Fail closed unless the fresh worktree starts without dependency/link/build state, installs under a private allowlisted environment, and remains clean in tracked candidate bytes.
4. Bind the combined action/command topology to the closed workflow policy and adversarial reordering tests.
5. Invalidate the failed successor's local evidence and require a new exact-tree matrix, four canaries, reviews, commit, push, and successful exact-SHA CI.

No npm publication, dist-tag mutation, Git tag, or GitHub Release is authorized.
