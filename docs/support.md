# Support policy

This document defines the supported platform, runtime, persistence, and operational boundary for published `ast-mcp-server` v0.7.2 and the current `Unreleased` development line.

## Supported release target

| Environment                                                                   | Status      | Contract                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux x64 with required GNU coreutils and procfs, Node.js 22.5.0              | Partial     | Package engine floor and published-v0.7.2 matrix target. Current `Unreleased` managed setup-file mutation has no fresh exact-tree evidence on this runtime. |
| Linux x64 with required GNU coreutils and procfs, current Node.js 24 line     | Supported   | Current-source repository, MCP/CLI/package, lifecycle, mutation, managed setup-file publication, and production-readiness gates.                            |
| Other Linux architectures or systems without the required filesystem features | Unverified  | Not supported until equivalent architecture, mutation, and filesystem-publication gates pass.                                                               |
| macOS                                                                         | Unverified  | Not supported until equivalent filesystem, process, package, mutation, and canary gates pass.                                                               |
| Windows                                                                       | Unverified  | Not supported until equivalent filesystem, process, package, mutation, and canary gates pass.                                                               |
| Remote, untrusted, or multi-tenant service use                                | Unsupported | No network authentication, sandbox, or tenant-isolation boundary is provided.                                                                               |

The package engine floor is Node.js `>=22.5.0`; it is not a claim that every current-source capability was freshly exercised at that floor. Published v0.7.2 evidence covers exact Node.js 22.5.0 and the current Node.js 24 line on Linux. The newer managed setup-file implementation is currently verified only on Node.js 24, and a newer version satisfying the engine range is not automatically a verified release target.

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

The supported default is memory-only indexing. When `AST_SYMBOL_INDEX_PERSISTENCE` is absent, persistence remains disabled and no persistent cache is created.

The only candidate-authorized opt-in persistence policy is `canary`; it is not enabled by default in v0.7.2:

```bash
AST_SYMBOL_INDEX_PERSISTENCE=canary \
AST_SYMBOL_INDEX_CACHE_ROOT=/absolute/isolated/cache/root \
ast-mcp-server
```

The cache root must be explicit and absolute. Use a dedicated local directory with permissions appropriate for the invoking user. Node.js 22.5.0 additionally requires `--experimental-sqlite` for this canary path.

`AST_SYMBOL_INDEX_PERSISTENCE=enabled` is reserved and intentionally fails closed to memory-only with `policy_reason: "enabled_not_released"`. Unknown values and invalid/missing canary cache roots also fail closed. Canary evidence authorizes the opt-in capability; it does not authorize global or default activation.

## Production-readiness acceptance

The checked published-v0.7.2 Linux x64 matrix covers `ast-mcp-server` and `x-scraper` under Node.js 22.5.0 and Node.js 24. It predates the `Unreleased` managed setup-file implementation and does not authenticate those newer bytes on Node.js 22.5.0. MCP-PROD-404 is normative; its complete release gate requires all four reports to pass the following contract:

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
- whether persistence is disabled or running in explicit canary mode;
- the bounded public error code and correlation identifier, if present.

Do not attach source code, absolute project paths, cache contents, credentials, tokens, or private configuration unless they have been intentionally sanitized. Report suspected vulnerabilities through [SECURITY.md](../SECURITY.md), not a public issue.
