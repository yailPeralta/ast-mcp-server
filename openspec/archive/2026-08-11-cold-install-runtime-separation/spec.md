# Cold-install runtime separation specification

## COLD-CI-001 — Package-manager/runtime separation

GitHub CI MUST use reviewed Node 24 for GNU `mv` preparation, `corepack enable`, and `yarn install --immutable`. It MUST then activate the exact matrix runtime and execute all product and quality gates under Node `22.5.0` or current Node 24 as declared by the closed matrix. The policy MUST bind actions and commands as one exact interleaved step chain so neither runtime setup can move across its authority boundary. Both Corepack invocations and immutable installation MUST receive an explicitly empty `NODE_OPTIONS`; Node 22.5 runtime gates MUST retain `--experimental-sqlite`.

## COLD-CI-002 — Genuine cold local matrix

For every runtime cell, the local release-candidate matrix MUST materialize the exact candidate tree into a distinct private Git worktree. Before immutable installation it MUST prove that `node_modules`, Yarn install-state metadata, and build output are absent. Installation MUST execute with the authenticated Node 24/Yarn launcher, empty `NODE_OPTIONS`, private `HOME`/`TMPDIR`, and an explicit closed environment allowlist that excludes ambient Yarn, Corepack, npm, proxy, and credential variables. Subsequent gates MUST execute with the authenticated runtime-under-test under a separate closed allowlist. Reports MUST record both admitted environment-key sets without recording secrets.

Every Git operation that authenticates, materializes, checks, or removes a candidate worktree MUST use the reviewed absolute `/usr/bin/git` authority after proving its physical path, file type, ownership, write permissions, executability, version output, and SHA-256 digest. The matrix and canary harness MUST reject every ambient `GIT_*` control before parsing or candidate authentication and before creating evidence output. Every repository-bound Git child MUST receive a closed environment that fixes the validated worktree, rejects contradictory repository controls, disables system/global configuration, hooks, executable filesystem monitors, external attributes/filters/diffs, and local worktree/bare redirects through command-scope controls, and does not inherit caller `PATH` or Git configuration redirects. Matrix and canary reports MUST retain the authenticated Git digest, version, and admitted environment-key set without publishing host paths; the canary freezer MUST revalidate that authority before canonicalization and immediately before atomic visibility.

A Git `clone` used solely to create a private temporary index MUST retain the closed binary/configuration authority but MUST NOT receive `GIT_WORK_TREE` or command-scope `core.worktree` for the source checkout. The source and destination MUST instead remain explicit absolute argv authorities, and every operation against the resulting temporary repository/index MUST restore the validated source worktree controls. A direct regression MUST execute this boundary against a real existing worktree.

The matrix MUST inspect whitespace errors across the authenticated candidate-parent delta, not merely a clean worktree. A timeout MUST terminate the complete spawned process group. The matrix MUST reject materialization failure, pre-existing dependency/link/build state, command failure, timeout, signal, tracked-tree mutation, worktree cleanup failure, or main-index drift. Every post-output-directory exit MUST leave terminal FAIL evidence; cleanup failure MUST downgrade any prepared PASS. A retry MUST NOT convert a failed first attempt into PASS.

## COLD-CI-003 — Closed workflow authority

The workflow policy MUST require the exact two-setup-node action chain, complete action inputs, checkout depth sufficient to authenticate `HEAD^`, exact interleaving with the ordered package-manager/runtime command chain, and existing runner, permission, trigger, matrix, environment, and skip-control boundaries. Adversarial tests MUST reject shallow checkout, package-manager setup drift, runtime activation before cold install or after a quality gate, ambient Corepack/Yarn execution, and omission of either runtime setup.

## COLD-CI-004 — Evidence identity

Any byte changed for this remediation invalidates the matrix, canaries, reviews, and release authorization associated with tree `c6a51f6949a302253a34d51b35ead930e585a640` and commit `94cbdf9b92104b92b14d0cc5a692ad597e4e945f`. The successor MUST receive fresh exact-tree local evidence, archive/readback, Review A/B with unresolved Critical/High/Medium `0/0/0`, remote-main readback, and successful `ci.yml` evidence whose `headSha` is exactly the successor commit.

## COLD-CI-005 — External boundary

This remediation MAY commit and push a successor to `main` under the operator's authorization. It MUST NOT publish to npm, mutate `next` or `latest`, create `v0.7.0`, or create a GitHub Release.
