# Specification: default SQLite symbol-index persistence

## Authority and policy

### IDX-DEFAULT-101 Compiler authority

The synchronized TypeScript compiler project plus verified source/config snapshots MUST remain authoritative for declarations, ranking parity, references, relationships, diagnostics, freshness and mutation eligibility. SQLite MUST remain a body-free replaceable read projection and MUST NOT authorize or weaken a mutation.

### IDX-DEFAULT-102 Enabled default

When `AST_SYMBOL_INDEX_PERSISTENCE` is absent or exactly `enabled`, a supported process MUST select the SQLite policy. Project status MUST report `policy=enabled`. The prior `enabled_not_released` value MAY remain in the public schema for backward compatibility but MUST NOT be emitted for a valid enabled/default policy.

Unknown policy values MUST fail closed to memory-only with bounded `invalid_mode` evidence.

### IDX-DEFAULT-103 Explicit memory rollback

`AST_SYMBOL_INDEX_PERSISTENCE=disabled` MUST select `InMemorySymbolIndex`, MUST NOT resolve/create/open the default cache root, and MUST remain available on every supported runtime. Switching a populated session to `disabled` plus invalidation/reopen MUST leave existing SQLite files untouched and unopened.

### IDX-DEFAULT-104 Canary compatibility

`canary` MUST remain supported and MUST continue requiring an explicit absolute normalized `AST_SYMBOL_INDEX_CACHE_ROOT`. Existing schema-v2 canary files MUST remain readable without data migration solely because the policy name changed.

## Default storage boundary

### IDX-DEFAULT-201 Root resolution

For `enabled`, the cache root MUST resolve in this order:

1. explicit `AST_SYMBOL_INDEX_CACHE_ROOT`, when absolute, normalized and physically containable;
2. absolute normalized `XDG_CACHE_HOME` plus `ast-mcp-server/symbol-index`;
3. the invoking user's resolved home plus `.cache/ast-mcp-server/symbol-index`.

An explicit invalid override MUST fail closed; it MUST NOT silently redirect to another root. If no safe implicit root can be resolved, the operation MUST continue through memory/compiler fallback with bounded path/capability evidence and no filesystem side effect.

No cache path or home path may appear in MCP results, public errors, checked reports or structured stderr.

### IDX-DEFAULT-202 Lazy private creation

`createFreshProject` MUST remain side-effect free. Native capability detection, policy/root validation and nearest-existing-ancestor physical validation MUST happen before recursive creation. Compiler synchronization MUST complete before persisted rows are adopted as current.

On supported Linux, the dedicated application/cache subtree created by the package MUST be owner-only and every new SQLite main/WAL/SHM/quarantine artifact MUST be inaccessible to group/other users. A permissive process umask MUST NOT weaken this contract. Existing parent directories outside the package-owned subtree MUST NOT be chmod-modified.

Symlink, hard-link, non-directory, non-regular, traversal and physical-escape cases MUST fail closed before outside side effects.

On supported Linux, every existing directory ancestor MUST be owned by either root or the invoking UID and MUST reject group/other writability unless the directory has sticky semantics. The package-owned leaf MUST be invoking-UID-owned and `0700`. SQLite MUST open the authenticated main inode through a live descriptor rather than re-resolving the selected pathname after verification.

### IDX-DEFAULT-203 Storage ownership

The local CLI MUST provide bounded inspection of the effective cache root and an explicit cleanup operation for derived files. Inspection MUST account recursively through `lstat` without following symlinks and report regular-file count, total bytes, active database count, WAL/SHM count and quarantine count.

Cleanup MUST be explicit, project/root-scoped, no-follow, race-aware and refuse symbolic, multiply linked, non-regular, unreadable or concurrently changed targets. The selected cache root and every package-owned descendant directory MUST be invoking-UID-owned and inaccessible to group/other users. It MUST NOT delete source, mutation plans or paths outside the selected cache root. Failure MUST leave compiler operation available and report which derived artifacts were not removed without exposing secrets.

For every recognized SQLite main, cleanup MUST open the inventoried inode through `O_NOFOLLOW`, verify its descriptor identity, construct the exclusive SQLite activity guard through that live descriptor rather than a re-resolved pathname, retain the guard before deleting any member of its WAL/SHM/main group, release it only after the complete group is removed, and refuse with zero group deletions if the pathname changes or a reader/writer becomes active before guard acquisition.

Automatic background pruning is not required by this change.

## Runtime, failure and observability

### IDX-DEFAULT-301 Runtime floor

The package engine floor and CI floor MUST be Node `>=22.13.0`, the first Node 22 release whose official API history removes the `--experimental-sqlite` requirement. Exact Node `22.13.0` and the current Node 24 line MUST execute the complete promotion matrix without `NODE_OPTIONS=--experimental-sqlite`.

SQLite's active-development status MUST remain documented. Dynamic capability checks and memory fallback remain mandatory even inside the supported range.

### IDX-DEFAULT-302 Same-operation fallback

Any capability, root, permission, open, migration, integrity, load, query, refresh, transaction, checkpoint, flush or close failure MUST install/use a complete memory/compiler context before best-effort cleanup. The same tool call MUST return canonical compiler evidence or a normal bounded public tool error unrelated to persistence; it MUST NOT return stale/partial indexed success.

Status MUST report `policy=enabled`, effective `backend=memory`, `state=failed`, a closed operation/failure classification and saturated counters after an enabled/default persistence failure. A complete verified synchronization is required for recovery.

### IDX-DEFAULT-303 Mutation isolation

Prepare/apply admission MUST continue using the scheduler-only compiler/workspace path. A default-enabled process MUST create no cache as a side effect of mutation-only prepare/apply. Policy/root/storage failure MUST NOT change plan hashes, affected files, diagnostics delta, blocked state, conflict detection, rollback, receipts or replay.

### IDX-DEFAULT-304 Public compatibility

`ast_get_project_status` MUST retain bounded JSON-safe observability. Removing `enabled_not_released` from runtime behavior MUST not expose a host path or widen arbitrary policy strings. If the output schema retains the old literal for compatibility, documentation MUST mark it historical/unreachable after promotion.

## Promotion evidence

### IDX-DEFAULT-401 Deterministic and package gates

The deterministic benchmark MUST invert the old default assertions:

- absent policy: SQLite miss/rebuild, persisted artifact and restart hit;
- explicit disabled: memory-only and no cache creation;
- explicit canary: still isolated and compatible;
- default-enabled capability/root/read/write/corruption/contention failures: same-operation canonical fallback;
- explicit disabled rollback after populated enabled/default storage.

The installed-tarball and registry-consumer smokes MUST run with isolated `HOME`, `XDG_CACHE_HOME` and temp roots so no developer/runner cache is touched.

### IDX-DEFAULT-402 Representative exact-tree matrix

A single immutable candidate MUST run `ast-mcp-server` and `x-scraper` under exact Node `22.13.0` and current Node 24. Each member MUST retain the existing preregistered workload, 20 warm reads, three unchanged restarts, compiler-result parity, fallback/recovery, mutation rollback and resource/cache accounting gates, modified only so the treatment path is the absent-policy default and rollback is explicit `disabled`.

Every default/restart read MUST report SQLite ready/hit evidence and zero unexpected fallback, corruption or write-failure increments. Any semantic mismatch, mutation effect, repository byte change, path/secret disclosure, unexpected cache artifact, runtime mismatch or failed permission/cleanup gate MUST fail promotion.

Historical reports MUST remain byte-identical and labeled historical. They MUST NOT be reattributed to the promotion candidate.

### IDX-DEFAULT-403 Evidence authenticity

Raw and checked evidence MUST bind package commit/tree, harness bytes, runtime binary/version/digest, workload bytes and external project identity. Reports MUST be generated after the last source/test/harness edit. Checked publication MUST retain the repository's existing atomic closed-set protocol and exact-tree reauthentication. The predecessor `production-readiness-sqlite-default-v1` cohort MUST remain byte-identical and historical. The pre-matrix `production-readiness-sqlite-default-v2` cohort MUST remain separately labeled as superseded after the MCP smoke source fix invalidated its producer tree. The rejected-Review-A `production-readiness-sqlite-default-v3` cohort MUST remain byte-identical and separately labeled as superseded after security and whole-candidate review invalidated its producer/report sibling. The later rejected-Review-A `production-readiness-sqlite-default-v4` cohort MUST remain byte-identical and separately labeled as superseded after review found that its local-registry consumer did not causally authenticate Yarn/npm authority. The final promotion cohort MUST publish to the new `production-readiness-sqlite-default-v5` destination as one complete no-replace set; every checked report MUST be mode `0600`. An existing destination MUST fail closed without replacement. Reports MUST contain no credential or physical host path.

### IDX-DEFAULT-404 ADR and release gate

ADR 0009 and ADR 0010 MAY authorize default SQLite only after deterministic, full quality, dual-runtime, two-repository, package/consumer, rollback, cache-ownership and exact-tree review gates pass with zero unresolved Medium-or-higher findings.

Implementation, commit, push, npm publication, dist-tag promotion, Git tag and hosted release are distinct transitions. No later transition is authorized by an earlier one.

## Scenarios

### Scenario: clean default process reuses SQLite

- Given a supported runtime with isolated safe home/cache directories and no persistence policy
- When a project synchronizes, the process exits cleanly and a second process opens the same project
- Then the first process creates one private SQLite index and the second reports a cache hit with compiler-equivalent results.

### Scenario: explicit disabled creates nothing

- Given `AST_SYMBOL_INDEX_PERSISTENCE=disabled`
- When a project synchronizes
- Then status is memory-only and the default cache root is neither resolved nor created.

### Scenario: default SQLite fails

- Given absent policy and an injected capability, permission, corruption, read or write failure
- When a read tool executes
- Then it returns canonical compiler evidence through memory fallback, reports bounded degraded persistence evidence and never labels incomplete rows fresh.

### Scenario: mutation-only process has no cache side effect

- Given absent policy and a disposable project
- When rename/body/scaffold prepare and apply paths execute without read-index use
- Then mutation behavior remains exact and the default cache root is not created.

### Scenario: operator clears derived cache

- Given a package-owned root containing one inactive regular database and its bounded sidecars/quarantine files
- When the explicit cleanup command runs
- Then only authenticated derived artifacts inside that root are removed and a later read rebuilds from compiler evidence.

### Scenario: unsafe cleanup target

- Given a symlink, hard link, changed inode, unreadable entry or path outside the root
- When cleanup is requested
- Then cleanup refuses the unsafe target, removes nothing outside the root and returns a bounded local CLI failure.
