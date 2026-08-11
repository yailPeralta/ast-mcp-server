# Exact-SHA CI remediation design

## Failure model

The failures are three independent environment-boundary defects rather than one product regression:

1. job-scoped `NODE_OPTIONS` reached Yarn itself;
2. Ubuntu 24.04 supplied GNU coreutils 9.4 while the supported freezer contract requires the later `none-fail` update mode;
3. one test bypassed the existing Vitest environment restoration mechanism.

The fix keeps the required Node matrix and the production freezer implementation unchanged.

## GNU primitive bootstrap

Add a CI-only Node script that has no shell interpolation or caller-provided URL/version/hash. It accepts only `prepare` and `probe` modes. `prepare` requires `CI=true`, Linux x64, and a physical absolute `RUNNER_TEMP`.

The source descriptor is closed over GNU coreutils 9.7, the kernel.org GNU HTTPS mirror URL, and the independently verified SHA-256. The script bounds the archive size, extracts beneath a private runner-temporary directory, invokes configure and make without a shell, and clears inherited `NODE_OPTIONS`/`GIT_INDEX_FILE` from child processes. It proves the built executable before using `sudo install` to replace only `/usr/bin/mv`, then proves the installed executable.

The proof checks exact version, successful source-to-absent-destination movement, collision failure, and preservation of both source and destination bytes on collision. A version banner alone is insufficient.

## Node option boundary

Keep the reviewed job-scoped option because all Node 22.5 runtime gates need the native SQLite capability. Override it for both package-manager processes with `NODE_OPTIONS= corepack enable` and `NODE_OPTIONS= yarn install --immutable`. The workflow policy treats those exact commands as authority, so reverting either process to ambient execution is rejected. The local release-candidate runner invokes its pinned Yarn entry directly and applies the same per-command environment boundary while retaining its no-shell Node/Yarn invocation.

## Test isolation

Replace the direct environment assignment with `vi.stubEnv`. The existing `afterEach` already calls `vi.unstubAllEnvs`, restoring the pre-test value. This repairs the class of failure without increasing production operation deadlines or weakening scheduler tests.

## Evidence transition

The failed pushed SHA remains immutable incident evidence. The remediation is a successor tree and commit, never an amended remote history. Because workflow, policy, test, and CI bootstrap bytes change, all candidate gates and reviews are regenerated. Publication remains blocked until the successor's exact-SHA CI run succeeds.
