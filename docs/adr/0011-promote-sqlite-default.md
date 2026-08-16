# ADR 0011: Promote native SQLite to the default symbol-index backend

- Status: Accepted for the current `Unreleased` development line; release verification remains separate
- Date: 2026-08-14
- Decision owners: ast-mcp-server maintainers
- Scope: derived symbol-index policy, private cache storage, operations and supported runtime floor
- Supersedes: ADR 0008 runtime-floor clause, ADR 0009 default-policy clause and ADR 0010 persistence/runtime clauses

## Decision

Make native `node:sqlite` the default backend for the derived symbol index while preserving the existing three-state policy:

| `AST_SYMBOL_INDEX_PERSISTENCE` | Effective policy | Requested backend                             |
| ------------------------------ | ---------------- | --------------------------------------------- |
| absent                         | `enabled`        | SQLite                                        |
| `enabled`                      | `enabled`        | SQLite                                        |
| `canary`                       | `canary`         | SQLite, only with an explicit safe cache root |
| `disabled`                     | `disabled`       | memory                                        |
| unknown or invalid             | fail closed      | memory with a bounded policy reason           |

`disabled` is the immediate rollback and must return memory without reading `AST_SYMBOL_INDEX_CACHE_ROOT`, `XDG_CACHE_HOME` or `HOME`. An invalid explicit cache-root override fails closed to memory; it is never hidden by falling back to another root.

SQLite remains a body-free, replaceable read projection. TypeScript source, compiler project state, synchronized snapshots and mutation workspace hashes remain semantic authority. A cache hit cannot authorize exact selection, diagnostics, references, operation preparation or apply.

## Question

Should the accepted SQLite canary remain opt-in, or should supported local processes persist the derived symbol index by default?

## Context and forces

ADR 0009 selected native SQLite only for explicit canary evaluation and left `enabled` reserved. Subsequent lifecycle, corruption, write-failure, restart, package and dual-runtime work removed the known blockers to default use. Rebuilding the complete index in every process now has a measurable operational cost, while the compiler-first fallback remains available.

The decision must preserve:

- immediate memory-only rollback;
- compiler-authoritative results under every cache failure;
- private same-user cache storage without changing external parent directories;
- bounded, path-free observability and operator administration;
- no cache side effect from mutation preparation alone;
- exact Node.js `22.13.0` floor evidence and the governed Node.js 24 line;
- compatibility with valid existing canary databases.

## Options considered

### A. Keep memory as the default

This has the smallest filesystem surface and no persistent-cache operations. It also discards accepted restart reuse and makes every process pay the complete rebuild cost. Rejected for the current development line because the failure and rollback boundary no longer requires memory to be the ordinary path.

### B. Keep SQLite canary-only

This preserves the ADR 0009 rollout boundary and requires explicit operator configuration. It avoids changing default behavior, but leaves `enabled` permanently reserved after its promotion criteria have been implemented and verified locally. Rejected as the steady state; `canary` remains available for an explicit-root rollout cohort.

### C. Make SQLite default with explicit memory rollback — selected

This provides restart reuse without making persistence authoritative. It adds a default local filesystem effect and therefore requires private storage, bounded administration, observable fallback and a stricter runtime floor. Those costs are accepted with the controls below.

## Cache-root policy

For `enabled`, resolve the cache root in this order:

1. `AST_SYMBOL_INDEX_CACHE_ROOT`, when present and valid;
2. `${XDG_CACHE_HOME}/ast-mcp-server/symbol-index`;
3. `${HOME}/.cache/ast-mcp-server/symbol-index`.

`canary` requires `AST_SYMBOL_INDEX_CACHE_ROOT` to be present, absolute, normalized and physically safe. `enabled` may use the implicit XDG/HOME roots, but a present invalid override fails closed instead of being ignored.

Missing environment authority, unsupported runtime capability, unsafe storage, open/read/write/migration/corruption/contention failure or an exhausted bounded operation switches the effective backend to a fresh memory store while retaining the requested policy in status. The public reason and last error are bounded and contain no host path.

## Private storage boundary

On supported Linux x64:

- package-created directory suffixes use mode `0700`;
- SQLite main, WAL, SHM and quarantine files use mode `0600`;
- pre-existing external parent directories are not chmodded;
- symlinks, non-regular files, multiply linked files, wrong-owner artifacts, physical escapes and identity substitutions fail closed;
- device/inode identity is checked around database construction and immediately before destructive cache administration;
- valid existing canary databases remain readable after permissions are tightened;
- corrupt bytes are quarantined without becoming compiler authority.

The same-UID trust boundary still applies: this is not protection from a malicious process with the invoking user's full filesystem authority.

## Lifecycle and observability

The first authoritative read opens or rebuilds the store. A fresh project constructor and mutation-only preparation remain cache-side-effect free. Reopen may report `hit`; changed source/config/schema evidence rebuilds only what the shared reconciliation plan requires.

`ast_get_project_status.index_observability` reports the requested policy, effective backend, state, operation, counters and bounded failure reason. Falling back from `enabled` or `canary` to memory increments fallback evidence without relabeling the requested policy as `disabled`.

Project invalidation, eviction and shutdown close SQLite only after active users finish. SQLite files are derived data and never contain source bodies, compiler objects, credentials or operation plans.

## Operator surface

Cache administration is CLI-only:

```bash
ast-tool cache inspect
ast-tool cache clear --yes
```

Inspection is bounded, recursively uses `lstat`, never follows symbolic links and reports aggregate counts without host paths. Clear requires exact confirmation, preflights the selected tree, refuses unsafe or active databases, revalidates artifact identity before unlink and removes only canonical derived artifacts. Unknown regular files and directories are preserved. Partial or unsafe cleanup exits non-zero with bounded aggregate reasons.

No MCP cache-management tool and no automatic garbage collection are introduced. Pruning remains deferred until real cache-age, size and failure metrics justify a policy.

## Runtime and support

The package engine floor is Node.js `>=22.13.0`. Release evidence executes exact `v22.13.0` and the governed Node.js 24 major. The active harness forbids `--experimental-sqlite`; Node `v22.13.0` loads `node:sqlite` without that flag, although the runtime may still emit its Stability 1.1 warning.

Historical Node `v22.5.0` reports and their experimental flag remain valid only for the older package/tree identities embedded in those reports. They are not evidence for this decision and are not rewritten.

## Rollback and failure handling

Set:

```bash
AST_SYMBOL_INDEX_PERSISTENCE=disabled
```

and reopen the project session or restart the process. The memory backend is selected before environment/root resolution and existing SQLite files are not opened or modified. Removing the variable is no longer rollback because absence now means `enabled`.

Cache files may be inspected or cleared later with the CLI. Source and reviewed mutation state require no migration because SQLite is not authoritative.

## Consequences

- Default local reads may create a private cache under XDG/HOME.
- A process can continue compiler-authoritative work when persistence fails, with explicit degraded evidence.
- Operators who require zero persistent index state must set `disabled` explicitly.
- Existing valid canary databases remain usable; unsafe legacy artifacts fail closed.
- Node versions below `22.13.0` are outside the current development-line package contract.
- Portable/WASM SQLite, remote/multi-tenant cache isolation and automatic GC remain out of scope.

## Evidence and release boundary

The active SDD is `openspec/changes/2026-08-14-promote-sqlite-default/`. It owns requirement-to-test traceability, dual-runtime commands, package/consumer evidence and exact-tree reviews for this decision.

Acceptance of this ADR changes the current development contract; it does not claim that these bytes were published. `CHANGELOG.md` records the work under `Unreleased`. Commit, push, npm publication, dist-tag promotion, tag and hosted release remain separately authorized transitions.
