# Exploration: promote SQLite symbol-index persistence to the package default

Date: 2026-08-14

## Decision question

Can native SQLite become the default derived symbol-index backend for every supported `ast-mcp-server` process without requiring operator configuration, while preserving compiler authority, same-operation memory/compiler fallback, explicit memory-only rollback, bounded storage ownership, and exact-tree release evidence?

## Outcome sought

A normal supported consumer that starts `ast-mcp-server` without persistence variables should receive restart reuse from SQLite. Storage failure must remain a performance/observability degradation, never a correctness or mutation-authority failure.

## Current evidence

- ADR 0009 selects native `node:sqlite` only for explicit `canary`; absent policy and reserved `enabled` remain memory-only.
- `IDX-INTEGRATION-101..503` closed compiler authority, bounded SQLite work, schema-v2 integrity, atomic migration, contention, corruption quarantine, same-operation fallback, observability, mutation isolation and immediate `disabled` rollback.
- The archived integration verification records 15/15 gates on exact Node `22.5.0` with `--experimental-sqlite` and Node `24.16.0`.
- The later production-readiness cohort covered `ast-mcp-server` and `x-scraper` across both runtime lines with 20 warm reads, three restarts and 40/40 gates per report.
- Those retained persistence reports are historical evidence for package `0.6.0` and their immutable tree. `docs/support.md` explicitly forbids reattributing them to `0.8.1`.
- A local Hermes canary on 2026-08-14 used Node `24.16.0`: the first process reported `policy=canary`, `backend=sqlite`, `operation=rebuild`, `fallback_count=0`; a second process reported `operation=hit`, `loaded_entries=64`, `cache_hits=1`, `fallback_count=0`. This is a useful local observation, not promotion evidence for a future candidate tree.

## Gaps that block a default flip

1. **Runtime contract:** the declared floor is Node `22.5.0`, where SQLite requires `--experimental-sqlite`. Official Node 22 documentation records that the flag stopped being required in `22.13.0`, while SQLite remained experimental. A package-wide SQLite default should not silently become memory-only at the exact supported floor.
2. **Default root:** `canary` requires an explicit absolute cache root. An implicit default needs a deterministic XDG/home path with no source-tree writes.
3. **Permissions:** the current adapter creates missing directories with the process umask. A package-created default cache needs a private dedicated subtree and owner-only database artifacts on the supported Linux target.
4. **Storage ownership:** opt-in users can remove a chosen root manually. A default-created root needs supported inspection and clear/prune semantics; repeated quarantines and obsolete project/config identities cannot be hand-waved away.
5. **Default-path tests:** unit, MCP, lifecycle, package and registry-consumer smokes currently assert that the absent policy creates no cache. Those assertions must be inverted without letting tests write into the developer's real home.
6. **Current-tree evidence:** the representative-repository canary and package-consumer matrix must run again against the exact promotion candidate in default-enabled mode. Historical report bytes remain historical.
7. **Public contract/docs:** `enabled_not_released`, README, support policy, bundled guidance, ADR 0009 and ADR 0010 all state that default activation is forbidden.

## Options considered

| Option                                                                                                                            | Benefit                                                               | Cost/risk                                                                                                               | Decision                   |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Keep `>=22.5.0`, make absent policy attempt SQLite, and fall back without the flag                                                | Small metadata change                                                 | “Default SQLite” is not true at the exact floor; users get different backends from the same package contract            | Rejected                   |
| Raise floor to `>=22.13.0`; absent policy resolves to `enabled`; derive a private XDG/home cache root; retain explicit `disabled` | Uniform default capability, no third-party dependency, clear rollback | Breaking runtime-floor change; SQLite remains active-development; new disk lifecycle must be supported                  | Selected for specification |
| Keep package default memory-only but make setup tools inject `canary`/`enabled`                                                   | Avoids package-wide disk side effects                                 | Client-specific pseudo-default, configuration drift, no benefit for unmanaged consumers                                 | Rejected                   |
| Raise floor to Node 24                                                                                                            | Simplest SQLite surface                                               | Unnecessarily drops supported Node 22 consumers; no correctness gain over `22.13+` with current bounded `.all()` paging | Rejected                   |

## Selected boundary

- Absent policy and explicit `enabled` select SQLite.
- Explicit `disabled` remains memory-only and must not create/open the default root.
- Explicit `canary` remains supported for isolated experiments and continues to require an explicit root.
- `AST_SYMBOL_INDEX_CACHE_ROOT` remains an absolute override. Without it, `enabled` resolves under `XDG_CACHE_HOME`, otherwise the invoking user's home cache.
- `createFreshProject` stays side-effect free. Capability and path validation precede directory creation; compiler synchronization precedes storage adoption.
- Compiler/project evidence remains authoritative. SQLite remains disposable and body-free.
- The first default release includes bounded local cache inspection and explicit clear/prune behavior. Automatic background deletion is out of scope unless measurements justify it.

## Scope

### In scope

- Node floor and CI/runtime matrix amendment.
- Enabled/default policy and safe root resolution.
- Linux-private cache permissions and ownership checks.
- Explicit cache inspection/cleanup surface for the invoking user.
- Existing failure/fallback behavior under the implicit default.
- Default-mode deterministic, representative-repository and packed-consumer evidence.
- ADR/support/guidance/release updates.

### Out of scope

- Making persisted rows semantic authority.
- Persisting source bodies, references, diagnostics, compiler objects or mutation plans.
- Removing `InMemorySymbolIndex` or `disabled` rollback.
- Portable/WASM SQLite, Windows/macOS support or remote/multi-tenant operation.
- Automatic telemetry or background watchdogs.
- Publishing, dist-tag mutation, Git tagging or hosted release without separate authorization.

## Open evidence to collect before implementation closure

- Current exact-tree cache bytes for `ast-mcp-server` and `x-scraper` under Node `22.13.0` and current Node 24.
- Default-root first build, restart hit, source change, config change, corruption, write failure and explicit disabled rollback.
- Private-mode behavior under an intentionally permissive process umask.
- Cache inspection/clear behavior with regular files, WAL/SHM, quarantine files, symlinks, hard links, unreadable entries and concurrent open stores.
