# Support policy

This document defines the supported platform, runtime, persistence, and operational boundary for published `ast-mcp-server` v0.12.0.

## Supported release target

| Environment                                                                   | Status      | Contract                                                                                      |
| ----------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| Linux x64 with required GNU coreutils and procfs, Node.js 22.5.0              | Historical  | Immutable v0.8.1 release evidence; not the runtime floor of the published or candidate lines. |
| Linux x64 with required GNU coreutils and procfs, exact Node.js 22.13.0       | Supported   | Published v0.12.0 matrix bound to its immutable package and tree bytes.                       |
| Linux x64 with required GNU coreutils and procfs, current Node.js 24 line     | Supported   | Published v0.12.0 matrix bound to its immutable package and tree bytes.                       |
| Other Linux architectures or systems without the required filesystem features | Unverified  | Not supported until equivalent architecture, mutation, and filesystem-publication gates pass. |
| macOS                                                                         | Unverified  | Not supported until equivalent filesystem, process, package, mutation, and canary gates pass. |
| Windows                                                                       | Unverified  | Not supported until equivalent filesystem, process, package, mutation, and canary gates pass. |
| Remote, untrusted, or multi-tenant service use                                | Unsupported | No network authentication, sandbox, or tenant-isolation boundary is provided.                 |

Published v0.12.0 requires Node.js `>=22.13.0`; its immutable matrix targets exact Node.js 22.13.0 and the governed Node.js 24 major. The earlier v0.8.1 Node.js 22.5.0/24 matrix remains historical evidence for those bytes only. A future runtime satisfying an engine range is not automatically a verified release target.

The checked-evidence freezer requires GNU coreutils 9.7 `mv` with `--update=none-fail`, `--no-copy`, and `--no-target-directory`. Structural apply and managed setup-file mutation additionally require that same `mv` with `--exchange`, GNU coreutils `ln -L -T`, procfs descriptor paths at `/proc/self/fd`, `O_DIRECTORY`/`O_NOFOLLOW`, and successful owned link/exchange identity probes on each destination parent filesystem before source effects. Missing, denied, or behaviorally incompatible primitives fail closed; there is no rename, copy/delete, or pathname-only fallback. Equivalent semantics have not been verified on other operating systems, architectures, or filesystems.

## Local stdio trust boundary

`ast-mcp-server` is a local stdio process. It inherits the invoking user's filesystem authority, and an MCP client may request any `project_root` or `tsconfig.json` that user can access.

The server does not provide:

- HTTP or network authentication;
- filesystem or process sandboxing;
- privilege separation;
- tenant isolation;
- protection from a malicious process running with the same filesystem authority.

Operation locks coordinate cooperating processes using the same configuration identity; they do not authorize writes against editors, overlapping configurations, network filesystems, continuously mutating writers, or hostile same-user processes. Structural replacement authenticates one exchanged pair at a time, and multi-file apply is sequential rather than globally atomic. Reverse rollback restores only exact owned pairs. Creation is no-clobber, but if a later failure follows its first publication, unlink ownership is not inferred: the destination and hidden stage are preserved and the outcome is `AMBIGUOUS_APPLY`. Deterministic promise barriers prove only the named publication and rollback interleavings, not arbitrary-writer atomicity.

Report-set freezer coordination likewise assumes cooperating same-UID processes and cannot defend checked evidence against a malicious process with the same filesystem authority. The freezer guarantees no-replace atomic visibility of the checked directory; it does not claim persistence across sudden power loss because parent-directory `fsync` durability is not established.

## Optional supervised compiler worker

The default and rollback remain `AST_COMPILER_WORKER_MODE=in_process`. Explicit `supervised` mode keeps one lightweight stdio parent connected to one disposable compiler child per connection:

```bash
AST_COMPILER_WORKER_MODE=supervised \
AST_COMPILER_WORKER_IDLE_TTL_MS=60000 \
ast-mcp-server
```

The parent waits for `ready` before replaying bounded initialization state. Generation-affine forwarding and cancellation reject stale settlements and do not retry forwarded calls. Recycling requires stable parent and child quiescence; mutation history, live leases, and completion-critical work keep the child pinned. Parent death closes admission and permits only completion-critical drain before exit.

Set the TTL to `0` to disable recycling without removing the relay, or select `in_process` to remove the worker boundary. No shared daemon, pool, cross-client deduplication, default promotion, or automatic mutation-plan repair is provided.

The scoped Linux evidence passed on exact Node.js 22.13.0 and the governed Node.js 24 line: three parents each completed three load/idle/respawn cycles with at least 80% PSS-delta reclamation and no upward trend. Respawns retained the compiler fingerprint, recorded six SQLite hits, reused exactly 400 files, rebuilt zero, and returned equivalent reads. Diagnostics remained bounded and redacted, and parent-death inspection found zero orphan processes. These results do not establish support for macOS, Windows, or other Linux environments.

## Symbol-index persistence

Published v0.12.0 selects native SQLite when the persistence setting is absent or explicitly `enabled`; operators requiring no persistent index state must set `disabled` explicitly:

```bash
AST_SYMBOL_INDEX_PERSISTENCE=disabled \
ast-mcp-server
```

`disabled` selects memory before consulting HOME, XDG or a cache-root override and does not open existing SQLite files. Removing the variable is not rollback in the current line.

Default `enabled` resolves a root from a valid explicit `AST_SYMBOL_INDEX_CACHE_ROOT`, then `${XDG_CACHE_HOME}/ast-mcp-server/symbol-index`, then `${HOME}/.cache/ast-mcp-server/symbol-index`. A present invalid override fails closed; it is not ignored in favor of XDG/HOME. `canary` still requires an explicit absolute normalized root:

```bash
AST_SYMBOL_INDEX_PERSISTENCE=canary \
AST_SYMBOL_INDEX_CACHE_ROOT=/absolute/isolated/cache/root \
ast-mcp-server
```

On supported Linux x64, package-created cache directories are `0700`; SQLite main, WAL, SHM and quarantine files are `0600`. The implementation does not chmod pre-existing external parents and fails closed on symbolic, non-regular, multiply linked, wrong-owner, escaped or identity-substituted artifacts. SQLite remains derived data; compiler and synchronized source state remain authority.

Inspect or remove only canonical derived artifacts through:

```bash
ast-tool cache inspect
ast-tool cache clear --yes
```

Both commands are bounded and path-free. Clear preflights the tree, refuses unsafe or active SQLite artifacts, rechecks identity before unlink and preserves unknown regular files/directories. There is no automatic garbage collection in this release.

## Production-readiness acceptance

The four retained Linux x64 production-readiness reports cover `ast-mcp-server` and `x-scraper` under Node.js 22.5.0 and Node.js 24 for package version 0.6.0, commit `2d0b21bbb80fae1acfca6a85d5891d87e68b59c1`, and tree `af931d49769fabdf06f623965a6cfe1f9afb8a81`. They are historical integration evidence only: they are not reattributed to v0.8.1, published-next v0.9.0 or v0.9.1, the local 0.9.2 candidate, published v0.10.0, published-next v0.11.0 or v0.11.1, published v0.11.2, or published v0.12.0. The exact 0.9.0 and 0.9.1 release matrices remain historical evidence for their immutable published-next bytes, the exact 0.9.2 matrix remains historical local-candidate evidence, the exact 0.10.0 matrix remains historical published-release evidence, the exact 0.11.0 and 0.11.1 matrices remain historical evidence for their immutable published-next bytes before public-registry verification exposed their distinct verifier defects, and the exact 0.11.2 matrix remains historical published-release evidence. The exact 0.12.0 matrix is current published-release evidence under both supported runtime lines, including bounded diagnostic aggregates, catalog-derived tool capability projections, and their independent release oracles; none of these matrices rebinds the older retained reports. MCP-PROD-404 remains normative for admission:

- zero semantic mismatches across disabled, cold, warm, restart, and rollback reads;
- byte-identical real-repository status and worktree trees;
- compiler-equivalent corruption and write-failure fallback with explicit recovery;
- exact mutation postimages, replay, byte-exact rollback, and no cache side effect in disposable fixtures;
- bounded queue/session behavior and cancellation;
- one process running identical deterministic-fixture reads under Node.js launched with `--expose-gc`;
- exactly 10 warmups, 50 measured reads, and one explicit `global.gc()` immediately before every measured RSS sample;
- deterministic-fixture final-five median RSS no more than `max(32 MiB, 20%)` above the first-five median;
- immutable-cache growth from the first complete build to the third unchanged restart no more than `max(1 MiB, 5%)`;
- recursive cache accounting through `lstat` without following symlinks, including SQLite main, WAL, SHM, quarantine, and temporary files in a stable sorted relative-file manifest; any unreadable, symbolic, or non-regular entry fails the gate.

Any semantic mismatch, mutation-boundary effect, unrecovered fallback, repository mutation, path/secret disclosure, unexpected or accepted invalid cache entry, or failed runtime/identity check fails the gate. Deliberately injected corruption is valid only when it is rejected, falls back to the exact compiler baseline, and then recovers explicitly.

Real-repository latency and RSS are retained as observations only. They are not capacity guarantees, SLAs, or PASS/FAIL criteria for this release.

## Compatibility and issue handling

Before reporting a compatibility problem, capture:

- operating system and architecture;
- exact `node --version` output and Node binary path;
- package version;
- MCP client and transport configuration;
- the requested persistence policy and effective backend (`enabled`, `canary`, or `disabled`; SQLite or memory);
- the bounded public error code and correlation identifier, if present.

Do not attach source code, absolute project paths, cache contents, credentials, tokens, or private configuration unless they have been intentionally sanitized. Report suspected vulnerabilities through [SECURITY.md](../SECURITY.md), not a public issue.
