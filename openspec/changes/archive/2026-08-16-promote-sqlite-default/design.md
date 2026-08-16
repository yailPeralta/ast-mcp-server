# Design: default SQLite symbol-index persistence

## Decision

Promote the existing native SQLite store rather than adding another backend. The policy default changes only after runtime, root, permissions, storage ownership and exact-tree evidence are closed. Compiler/memory remains the correctness path and explicit rollback.

## Policy model

| Input          | Requested policy | Effective initial backend | Root                               |
| -------------- | ---------------- | ------------------------- | ---------------------------------- |
| absent         | `enabled`        | SQLite                    | validated implicit XDG/home root   |
| `enabled`      | `enabled`        | SQLite                    | explicit override or implicit root |
| `canary`       | `canary`         | SQLite                    | required explicit root             |
| `disabled`     | `disabled`       | memory                    | none; do not resolve               |
| unknown/unsafe | fail-closed      | memory                    | none                               |

A storage failure retains requested `policy=enabled|canary`, swaps effective backend to memory, sets failed/fallback observability and returns canonical compiler evidence.

## Runtime decision

Official Node 22 API history records:

- `node:sqlite` added in `22.5.0` behind `--experimental-sqlite`;
- flag removed in `22.13.0`, module still Stability 1.1 / active development.

Raise the exact floor to `22.13.0`. Keep current Node 24 as the second line. The adapter already uses bounded SQL `LIMIT/OFFSET` pages rather than relying on newer `StatementSync.iterate()`, so the data path remains compatible with the lower API surface.

## Root resolution

Add a pure resolver in `src/services/symbol-index-policy.ts` with injectable environment and home directory for tests:

1. Parse persistence mode before any home/cache lookup. Return memory immediately for `disabled`.
2. For `canary`, require the existing explicit absolute normalized root.
3. For `enabled`, validate an explicit override if present; never mask an invalid override with fallback.
4. Otherwise validate `XDG_CACHE_HOME` as absolute and normalized, then append `ast-mcp-server/symbol-index`.
5. Otherwise use the injected/resolved home plus `.cache/ast-mcp-server/symbol-index`.
6. Return a policy value; do not touch the filesystem.

`symbolIndexPolicyKey` continues to include mode/backend/reason/root/timeout so runtime policy changes close old handles and swap contexts.

## Private storage creation

Strengthen `src/services/symbol-index-sqlite.ts`:

- capability-check before path work;
- authenticate every existing ancestor as root/invoking-UID owned and reject untrusted non-sticky group/other writability before creating package-owned suffixes;
- create only package-owned missing suffixes with `0700` on supported Linux;
- never chmod existing parent directories outside that suffix;
- reject symlink/non-directory replacement races;
- require the SQLite target to be a unique regular file within the root;
- on supported Linux, retain the authenticated main descriptor and open SQLite through `/proc/self/fd/N`, then reauthenticate the canonical pathname before and after initialization;
- enforce owner-only main/WAL/SHM/quarantine artifacts after creation and before exposure;
- fail to memory/compiler if the permission contract cannot be established.

The root and database path remain internal and redacted.

## Cache lifecycle surface

Create `src/services/symbol-index-cache.ts` as a local CLI-only service. It owns:

- resolving the effective explicit/default root through the policy resolver;
- bounded recursive `lstat` inventory without following symlinks;
- strict filename classification for main SQLite, WAL, SHM and quarantine artifacts;
- byte/file caps before materialization;
- identity snapshots for no-follow cleanup;
- explicit clear/prune with a second identity check immediately before deletion;
- require the selected root and package-owned descendant directories to remain invoking-UID-owned and `0700`, without chmod-modifying external ancestors;
- for every valid SQLite main, preflight all group hooks, open the inventoried inode with `O_NOFOLLOW`, verify its `fstat` identity, construct SQLite through the live `/proc/self/fd/N` capability, acquire `locking_mode=EXCLUSIVE` plus `BEGIN EXCLUSIVE`, retain that guard across WAL/SHM/main unlink, and release only after the group is complete;
- classify unavailable descriptor binding as a bounded capability failure rather than corruption/read failure, so a healthy cache is not quarantined because procfs is unavailable;
- refusal for hard links, symbolic links, non-regular files, unreadable entries and changed targets.

Wire focused commands through the existing `ast-tool` CLI, for example:

- `ast-tool cache inspect`;
- `ast-tool cache clear --yes` or the repository's established explicit-confirmation convention.

No MCP tool is added: cache ownership is an operator concern and must not increase every model's tool schema. No automatic background pruning is added in this slice.

## Project lifecycle

`src/services/project.ts` already performs the required ordering:

1. compiler refresh and verified source/config snapshots;
2. policy resolution;
3. optional SQLite open/load;
4. hash/config validation and changed-only refresh;
5. complete memory/compiler fallback before best-effort close/quarantine.

The implementation should avoid refactoring this sequence. The required production change is to admit `enabled` as SQLite and ensure fallback observability retains requested policy while effective backend becomes memory.

Mutation prepare/apply continues to use scheduler-only admission and must not call `ensureSessionSymbolIndex` or create cache files.

## Public status compatibility

- `policy` already accepts `enabled`.
- `backend`, state, operation and counters already express effective fallback.
- Keep `enabled_not_released` in the Zod/public literal set for at least the promotion release if removing it would create unnecessary schema churn; stop emitting it for valid enabled/default policy and mark it historical.
- Reuse existing bounded/redacted error classifications. Do not expose root source (`XDG` vs home) or path.

## Test isolation

Changing the package default can make ordinary tests write to the real home. Prevent that structurally:

- set explicit `disabled` in the shared unit-test environment unless a test is dedicated to default persistence;
- default-policy tests use injected environment/home values and temporary roots;
- MCP/lifecycle/package/registry smokes launch child processes with isolated `HOME`, `XDG_CACHE_HOME`, `TMPDIR` and closed environments;
- add a negative sentinel proving no artifact appears in the invoking developer home/cache;
- mutation-only tests omit policy inside an isolated home and still assert no cache root.

## Evidence changes

### Deterministic integration benchmark

Update `scripts/benchmark-symbol-index-integration.mjs` gates:

- replace `default_disabled` with `default_enabled_persisted` and `default_restart_hit`;
- replace `enabled_fails_closed` with `enabled_persisted`;
- retain explicit `disabled` and rollback gates;
- run all existing corruption/read/write/migration/contention probes against default/`enabled`;
- add private-mode and cache lifecycle gates.

### Production-readiness harness

Update `scripts/canary-local-mcp.mjs` and tests so the treatment process omits persistence policy, receives only isolated home/cache context, and proves `policy=enabled`. Keep explicit disabled control/rollback. Preserve the exact workload, iteration counts, runtime binding, report-set freezer and compiler/mutation parity requirements.

Preserve `v1` byte-for-byte as historical evidence, retain the pre-matrix `v2` cohort as a separately labeled superseded producer tree, and retain the rejected-Review-A `v3` and `v4` cohorts byte-for-byte as superseded evidence. `v4` is historical because its otherwise-green exact-tree Review A found that the local-registry harness selected bare Yarn/npm through ambient `PATH` without causally authenticating package-manager or transitive-Node authority. Generate the final promotion cohort at `benchmark/results/production-readiness-sqlite-default-v5`. Publish the complete four-member `v5` set atomically with no replacement and mode `0600` for every checked report.

### Packed/public consumer

Invert `scripts/registry-consumer-smoke.mjs`:

- default connection: no persistence variables, isolated XDG/home, SQLite ready, private artifact, restart hit;
- disabled connection: explicit memory-only, no cache root;
- canary connection: retained compatibility;
- mutation-only default process: no cache side effect.

## Documentation and ADRs

Modify only after evidence gates pass:

- `docs/adr/0009-index-persistence-backend.md`: supersede canary-only decision with enabled default and explicit disabled rollback.
- `docs/adr/0008-node-runtime-floor.md`: amend floor to `22.13.0` and cite official flag history.
- `docs/adr/0010-local-stdio-runtime-governance.md`: update persistence boundary/runtime matrix.
- `README.md`, `docs/support.md`, `benchmark/README.md`, `CHANGELOG.md`, bundled structural-editing guidance and package metadata.

## Release design

1. Freeze complete owned manifest, preserving unrelated local files.
2. Run exact Node `22.13.0` and Node 24 gates.
3. Generate all four candidate-bound representative raw reports after the final source/harness edit.
4. Freeze a new complete checked cohort atomically.
5. Obtain read-only Review A over requirements/implementation/evidence.
6. Archive SDD, authenticate the staged tree, rerun candidate gates and obtain Review B.
7. Commit locally if authorized.
8. Push, publish under `next`, verify public consumer, promote `latest`, tag and hosted release only through separately authorized transitions.

## Rollback

- Runtime: set `AST_SYMBOL_INDEX_PERSISTENCE=disabled`, invalidate/reopen sessions or restart.
- Cache: leave files unopened; inspect/clear explicitly when desired.
- Code: revert the policy/root/floor slice while retaining the backend and canary compatibility.
- Release: return consumers to the prior published version; never republish an immutable version.
