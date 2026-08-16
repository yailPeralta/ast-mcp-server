# Proposal: promote SQLite symbol-index persistence to default

## Intent

Promote native SQLite from explicit canary to the default derived symbol-index backend on the supported local Linux x64 runtime. Preserve the compiler as semantic authority and keep explicit `disabled` as the immediate, no-migration memory-only rollback.

## User-visible behavior

- With no `AST_SYMBOL_INDEX_PERSISTENCE`, the process reports `policy=enabled` and attempts SQLite under the supported default cache root.
- `AST_SYMBOL_INDEX_PERSISTENCE=enabled` has the same behavior.
- `AST_SYMBOL_INDEX_PERSISTENCE=disabled` uses memory only and does not create or open SQLite storage.
- `AST_SYMBOL_INDEX_PERSISTENCE=canary` remains available for an explicitly isolated absolute root.
- Any capability, path, open, migration, integrity, read, query, write or flush failure returns the canonical compiler result through memory fallback and exposes bounded degraded evidence.

## Goals

1. Make restart reuse available without per-client environment wiring.
2. Preserve exact compiler parity and every prepare/review/apply invariant.
3. Make default disk ownership private, inspectable and removable.
4. Make the default behavior uniform at the exact supported runtime floor.
5. Bind promotion claims to a new immutable candidate tree and fresh two-runtime/two-repository evidence.

## Non-goals

- SQLite does not approve or authorize mutations.
- No source bodies, credentials or host paths enter public status or evidence reports.
- No portable database dependency, daemon, HTTP service or cross-user shared cache.
- No platform support expansion beyond the currently declared supported target.
- No release transition is implied by implementation or local activation.

## Proposed architecture

- Raise `engines.node` and CI floor from `22.5.0` to `22.13.0`, the first Node 22 release where official documentation says `node:sqlite` no longer requires `--experimental-sqlite`.
- Resolve absent policy as `enabled`.
- Resolve an enabled root in this order:
  1. validated absolute `AST_SYMBOL_INDEX_CACHE_ROOT` override;
  2. validated absolute `XDG_CACHE_HOME/ast-mcp-server/symbol-index`;
  3. `<homedir>/.cache/ast-mcp-server/symbol-index`.
- Create the dedicated application subtree lazily with owner-only permissions on Linux; validate physical ancestry and reject symlink/non-directory targets before side effects.
- Keep the existing per-project/config opaque filename and schema in the first promotion slice so canary caches remain compatible. Add supported cache inspection and explicit clear/prune operations rather than silently introducing automatic deletion.
- Reuse the current project-owned SQLite lifecycle and same-operation memory/compiler fallback.

## Success criteria

- A clean, no-policy packed consumer under isolated `HOME`/`XDG_CACHE_HOME` creates exactly one valid SQLite artifact after a read and records a restart `hit` with compiler-equivalent output.
- Explicit `disabled` creates no cache root and returns the existing memory-only status.
- Exact Node `22.13.0` and current Node 24 pass format, lint, typecheck, full tests, build, MCP, lifecycle, public-error, CLI, package, audit and pack gates.
- Fresh candidate-bound reports for `ast-mcp-server` and `x-scraper` pass the existing representative workload with no semantic mismatch, mutation effect, unexpected fallback, path/secret disclosure or repository mutation.
- Default cache directories and database artifacts satisfy the private-mode/ownership contract under a permissive umask.
- Cache inspection and explicit cleanup refuse symlinks, hard links, non-regular files, path escape and concurrent unsafe deletion.
- `disabled` rollback is demonstrated after a populated default cache without opening or migrating existing files.
- Two exact-tree read-only reviews return no unresolved Medium-or-higher findings.

## Risks and mitigations

| Risk                                             | Mitigation                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite remains active-development in Node 22     | Dynamic capability check, exact floor/current runtime matrix, compiler/memory fallback, explicit disabled rollback                                                                                  |
| Default disk side effects surprise consumers     | XDG/home cache only, lazy creation, docs, status, inspect/clear CLI                                                                                                                                 |
| Private source metadata becomes broadly readable | Private subtree, owner-only files, no source bodies, permission tests                                                                                                                               |
| Cache growth across projects/quarantine          | Inspect/clear/prune surface, recursive bounded accounting, documented ownership; automatic GC deferred                                                                                              |
| Historical evidence is overstated                | Fresh exact-tree reports; historical bytes remain labeled and unchanged                                                                                                                             |
| Tests pollute real user caches                   | All default-enabled integration/package tests use isolated `HOME`, `XDG_CACHE_HOME` and temp roots; normal unit harness defaults explicitly to memory except tests dedicated to the package default |
| Failure changes mutation behavior                | Existing scheduler-only prepare/apply path plus direct no-cache-side-effect regression                                                                                                              |

## Rollout

1. Continue local `canary` observation; do not call it promotion evidence.
2. Implement policy/root/runtime changes behind RED/GREEN tests while keeping release unpublished.
3. Run deterministic and packed-consumer default-mode gates.
4. Run fresh representative matrix on the immutable candidate under Node `22.13.0` and Node 24.
5. Record the technical decision for the current `Unreleased` development line in ADR 0011 and mark the superseded clauses in ADR 0009/0010; this does not authorize release.
6. Complete exact-tree gates and Review A, then archive and authenticate only the authorized closure delta and obtain Review B.
7. Commit locally if authorized. Push, npm `next`, `latest`, Git tag and hosted release remain separate explicit transitions.

## Rollback

Operational rollback is `AST_SYMBOL_INDEX_PERSISTENCE=disabled` followed by session invalidation/reopen or process restart. Existing SQLite files remain unopened and disposable. Release rollback is the previous published package; do not republish or mutate tags without registry readback and explicit authorization.
