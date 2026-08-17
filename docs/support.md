# Support policy

This document defines the supported platform, runtime, persistence, and operational boundary for published `ast-mcp-server` v0.8.1 and the local `0.9.1` release candidate.

## Supported release target

| Environment                                                                   | Status      | Contract                                                                                       |
| ----------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| Linux x64 with required GNU coreutils and procfs, Node.js 22.5.0              | Published   | Immutable v0.8.1 release matrix; not the runtime floor of the current development tree.        |
| Linux x64 with required GNU coreutils and procfs, exact Node.js 22.13.0       | Supported   | Local 0.9.1 candidate package, persistence, MCP/CLI/package, lifecycle and mutation matrix.    |
| Linux x64 with required GNU coreutils and procfs, current Node.js 24 line     | Supported   | Published v0.8.1 and local 0.9.1 candidate matrices, each bound to its own package/tree bytes. |
| Other Linux architectures or systems without the required filesystem features | Unverified  | Not supported until equivalent architecture, mutation, and filesystem-publication gates pass.  |
| macOS                                                                         | Unverified  | Not supported until equivalent filesystem, process, package, mutation, and canary gates pass.  |
| Windows                                                                       | Unverified  | Not supported until equivalent filesystem, process, package, mutation, and canary gates pass.  |
| Remote, untrusted, or multi-tenant service use                                | Unsupported | No network authentication, sandbox, or tenant-isolation boundary is provided.                  |

The local `0.9.1` candidate requires Node.js `>=22.13.0`; its matrix targets exact Node.js 22.13.0 and the governed Node.js 24 major. Published v0.8.1 retains its immutable `>=22.5.0` metadata and exact Node.js 22.5.0/24 release evidence. A future runtime satisfying an engine range is not automatically a verified release target.

The checked-evidence freezer requires GNU coreutils 9.7 `mv` with `--update=none-fail`, `--no-copy`, and `--no-target-directory`. Managed setup-file mutation additionally requires that same `mv` with `--exchange`, GNU coreutils `ln -L -T`, procfs descriptor paths at `/proc/self/fd`, `O_DIRECTORY`, and `O_NOFOLLOW`. It fails closed when any verified Linux primitive is unavailable. Equivalent publication, exchange, descriptor-link, and descriptor-relative mutation semantics have not been verified on other operating systems or architectures.

## Local stdio trust boundary

`ast-mcp-server` is a local stdio process. It inherits the invoking user's filesystem authority, and an MCP client may request any `project_root` or `tsconfig.json` that user can access.

The server does not provide:

- HTTP or network authentication;
- filesystem or process sandboxing;
- privilege separation;
- tenant isolation;
- protection from a malicious process running with the same filesystem authority.

Operation locks coordinate cooperating same-user processes. They do not stop editors, network filesystems, or hostile same-user writers. Report-set freezer coordination likewise assumes cooperating same-UID processes and cannot defend checked evidence against a malicious process with the same filesystem authority. The freezer guarantees no-replace atomic visibility of the checked directory; it does not claim persistence across sudden power loss because parent-directory `fsync` durability is not established.

## Symbol-index persistence

Published v0.8.1 remains memory-default. In the local `0.9.1` candidate, absence and explicit `enabled` select native SQLite; operators requiring no persistent index state must set `disabled` explicitly:

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

Both commands are bounded and path-free. Clear preflights the tree, refuses unsafe or active SQLite artifacts, rechecks identity before unlink and preserves unknown regular files/directories. There is no automatic garbage collection in this candidate.

## Production-readiness acceptance

The four retained Linux x64 production-readiness reports cover `ast-mcp-server` and `x-scraper` under Node.js 22.5.0 and Node.js 24 for package version 0.6.0, commit `2d0b21bbb80fae1acfca6a85d5891d87e68b59c1`, and tree `af931d49769fabdf06f623965a6cfe1f9afb8a81`. They are historical integration evidence only: they are not reattributed to v0.8.1, published-next v0.9.0, or the local 0.9.1 candidate. The exact 0.9.0 release matrix remains historical evidence for its immutable published-next bytes. A separate exact 0.9.1 release matrix is the candidate-specific gate for current repository bytes under both supported runtime lines, including managed setup; neither matrix rebinds the older retained reports. MCP-PROD-404 remains normative for admission:

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
