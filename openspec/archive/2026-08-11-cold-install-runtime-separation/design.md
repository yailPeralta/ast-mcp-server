# Cold-install runtime separation design

## Root cause

Yarn's CLI installs a `beforeExit` guard that reports exit 42 while its main promise is still pending. On Node 22.5, a cold node-modules link can transiently leave that promise without an active event-loop resource. Empty `NODE_OPTIONS` removes the SQLite contamination but cannot repair this Node/Yarn scheduling boundary. The failure reproduced with Yarn 4.15.0 and 4.18.0.

The previous local matrix missed this because it installed over an existing dependency layout. Its command and environment assertions were correct but its filesystem precondition was not.

## CI topology

The quality job remains one Linux x64 matrix job. Each cell performs:

1. checkout exact source with the candidate parent available;
2. setup reviewed Node 24 for package-manager work;
3. prepare/probe GNU `mv` 9.7;
4. activate Corepack and install immutably with empty `NODE_OPTIONS`;
5. setup the declared matrix runtime;
6. activate that runtime's Corepack shim with empty `NODE_OPTIONS`;
7. run the quality/release gates under the matrix runtime and inspect `HEAD^` to `HEAD` for whitespace errors.

This preserves Node 22.5 product coverage without requiring an affected runtime to perform the cold link. Both setup-node uses remain pinned to the same reviewed SHA and have closed, position-specific inputs. The workflow policy compares one combined action/command step sequence; validating the action and command subsequences independently is insufficient because either setup action could otherwise cross its authority boundary without changing either subsequence.

## Local exact-tree materialization

For each runtime, the matrix creates an unreferenced synthetic commit whose tree is the authenticated candidate and whose parent is the current HEAD. It adds a detached private Git worktree for that commit beneath a bounded temporary root. The worktree provides two properties that a plain archive lacks: exact staged-tree materialization before the real commit exists, and Git-native post-command mutation detection.

Before installation, the runner rejects existing `node_modules`, `.yarn/install-state.gz`, or `dist`. The install command uses the inspected Node 24 binary and its physical Yarn entry. It receives only fixed `CI`, locale and empty `NODE_OPTIONS` values, the inspected runtime `PATH`, and driver-created private `HOME`/`TMPDIR` paths. Ambient `YARN_*`, `COREPACK_*`, `NPM_*`, proxy, credential, user-home, and Git-index values are not inherited. Every remaining Yarn/script command uses the inspected cell runtime and its own Yarn entry under a second allowlist containing only fixed CI/locale values, runtime `NODE_OPTIONS`, authenticated PATH, and absolute HOME/TMPDIR. The report records both admitted key sets and runtime/package-manager identities.

Every command owns a POSIX process group; deadline handling signals the group, so Yarn descendants cannot outlive a timed-out gate. After the command chain, Git status in the private worktree and the original repository index are both reauthenticated. Cleanup removes only the driver-created registered worktree and temporary root and validates Git's result. Runtime evidence is prepared before cleanup but written once afterward; cleanup failure downgrades PASS. Any failure after output-directory creation leaves terminal FAIL evidence.

Git is a separate evidence authority rather than a command found through the operator's environment. The CLI rejects every ambient `GIT_*` key before candidate authentication or output creation. The shared authority resolves `/usr/bin/git` back to that same physical path, requires a root-owned regular executable that is not group/world-writable, validates its version output, and hashes its bytes. All matrix and canary authentication, synthetic-commit, worktree, temporary-index, postcondition, diff, and cleanup calls use that absolute binary with a closed environment: fixed system `PATH`, locale, non-existent home/config roots, disabled system/global configuration and prompts, `GIT_ATTR_SOURCE` bound to the empty tree, command-scope overrides for hooks, filesystem monitoring, untracked cache, attributes/excludes, line-ending/symlink/filemode/case behavior, and explicit non-bare state. Repository-bound calls additionally fix `GIT_WORK_TREE` and command-scope `core.worktree` to the validated normalized root; contradictory internal controls fail closed. Only the six fixed author/committer fields required by `commit-tree` may extend that map. The matrix helper accepts an explicit executor solely as a unit-test seam; `main()` supplies none and neither CLI exposes a Git-authority override.

The temporary-index `git clone --shared --no-checkout` is the deliberate exception to repository-bound worktree controls. Its source and destination are explicit absolute argv values, and it uses the same absolute binary plus closed system/global configuration, but it receives neither `GIT_WORK_TREE` nor command-scope `core.worktree`: applying the source checkout's worktree to clone itself makes Git reject the already-existing worktree. Immediately after clone, `read-tree`, `add`, and `write-tree` use an internally constructed `GIT_DIR`, source `GIT_WORK_TREE`, disposable `GIT_INDEX_FILE`, and fixed command-scope `core.worktree`.

The canary report retains a path-free Git alias plus the authenticated binary SHA-256, version, and closed environment-key set. All four raw reports must share that identity. Freeze reauthenticates it while binding each raw report to live clean repositories, before the four-report publication transaction, and again at the atomic visibility boundary. A Git authority change therefore invalidates the cohort rather than becoming observational metadata.

Direct tests exercise all three stale-state sentinels, candidate-delta whitespace, failed materialization cleanup, successful removal, cleanup rejection/PASS downgrade, preflight FAIL evidence, main-index drift, contaminated environments, complete process-group termination, the single-attempt execution primitive, a real existing-worktree clone boundary, and single-attempt canary Git snapshots for both snapshot and cleanup failure. They also exercise a PATH-prepended fake Git executable, ambient Git controls, and hostile local `core.worktree`, `core.fsmonitor`, filter, attributes, and external-diff configuration. The hostile-local-config regression proves both that no executable sentinel runs and that indexed bytes come from the validated root rather than the configured substitute. These are fail-closed branches, not claims inferred from a positive matrix.

## Evidence transition

Run `31547160641` remains immutable failed evidence. The new bytes require a fresh tree, matrix, four canaries, reviews, archive transition, commit, push, and exact-SHA CI. No retry of either failed commit is admissible as successor evidence.
