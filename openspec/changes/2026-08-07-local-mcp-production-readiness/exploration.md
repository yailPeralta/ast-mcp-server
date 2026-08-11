# Exploration: local MCP production readiness

## Problem

The compiler-first core is verified, but the published product does not yet contain the approved tree and the local stdio runtime still lacks strict overload, cancellation, shutdown and uniform public-error boundaries. Calling the package production-ready before those boundaries are explicit would conflate semantic correctness with release and operational readiness.

The target user is a developer or coding agent running one trusted local `ast-mcp-server` process over stdio against TypeScript/JavaScript projects available to that operating-system user. The outcome is a bounded, observable, releasable local tool; it is not a remote multi-tenant code service.

## Current evidence

### Semantic and mutation core

- Fifteen MCP tools expose bounded compiler-backed reads and hash-bound `prepare -> review -> apply` mutations.
- The project/session contract keeps the active TypeScript compiler authoritative for source, selectors, diagnostics, relationships and mutations.
- SQLite schema v2 is available only through explicit `canary`; `disabled`/memory remains default and rollback; `enabled` remains fail-closed.
- The frozen persistence candidate passed 271 tests, 33 SQLite/conformance tests, MCP/CLI/package smokes and 15/15 failure gates under Node 24 and Node 22.5 with the SQLite experimental flag.
- The persistence SDD is archived and ADR 0009 authorizes only explicit canary operation.

### Release mismatch

- Local `main` is six commits ahead of `origin/main`.
- The public npm package is still `0.6.0` and declares Node `>=20.19`.
- The local package declares Node `>=22.5.0` and includes changes absent from the registry package.
- Remote CI has not run on the current local SHA.
- `CHANGELOG.md` has no entry for the persistence/runtime-floor work.

A local green tree is therefore not a released product.

### Runtime resource boundary

`src/services/project.ts` uses a per-project promise chain and tracks queue state. `MAX_PROJECT_SESSIONS = 8`, but eviction is conditional on an idle session. When all eight sessions are active, `getOrCreateSession()` continues and creates another session. The limit is observational rather than strict.

The per-project queue has no admission cap or wait deadline. Requests retain their closures until previous work completes. The MCP SDK provides `extra.signal: AbortSignal` to every tool callback, but current adapters ignore it. Long synchronous compiler sections cannot be forcibly preempted in-process; any design must distinguish cooperative cancellation from hard execution preemption.

### Lifecycle boundary

`src/index.ts` connects a stdio transport and reports startup failure. Tests close client/server explicitly, while the executable does not coordinate stdin closure, `SIGINT`, `SIGTERM`, server closure, project watcher cleanup and SQLite closure as one idempotent shutdown sequence.

### Error boundary

`src/tools/result.ts:errorResult()` bounds error text to 64 KiB but returns raw `error.message`. Project-status errors have stronger path/credential redaction than generic tool failures. Public tool errors have no stable code or correlation identifier.

### Platform and supply-chain boundary

- CI runs only `ubuntu-latest` on Node 22.5 and 24.
- Symlink, hardlink, permission and atomic-write guarantees are platform-sensitive; some tests skip Windows behavior.
- The repository has one CI workflow, no explicit security policy, hosted release workflow, provenance/attestation gate or automated dependency review.
- The package currently makes no explicit Linux-only support statement.

### Real-repository evidence

`benchmark/results/x-scraper.json` is a 2026-08-03 outline benchmark. It reports roughly 3.95 s fresh project load, 2.72 s cold cached-session outline and 180 ms warm cached-session outline, but predates the final persistence integration and does not measure current queue saturation, restart reuse, RSS, fallback rates or prolonged canary behavior.

## Decisions to make

### Decision 1: in-process governance or worker isolation?

| Option                                                     | Strength                                                                  | Cost/risk                                                                                           | Disposition                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Bound the existing in-process session queue                | Small change; preserves compiler/session ownership and mutation semantics | Cancellation is cooperative during synchronous compiler work                                        | Selected for v0.7.0                    |
| Move projects/tools into worker threads or child processes | Hard termination and stronger isolation                                   | Large topology rewrite; project state and mutation lifecycle cross IPC; new crash/recovery protocol | Defer until measured stalls justify it |

The selected design must not claim hard preemption. It rejects overload before retention, removes cancelled queue nodes in O(1), settles cancelled waiters immediately, checks deadlines at safe synchronization/operation checkpoints and lets an apply that crossed its write boundary finish receipt/rollback handling. The queue cap counts waiting nodes; one running operation is tracked separately.

### Decision 2: raw local errors or stable sanitized errors?

| Option                                                  | Strength                                       | Cost/risk                                                           | Disposition |
| ------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | ----------- |
| Keep raw bounded messages                               | Maximum local debug detail                     | Leaks host paths/secrets and has no machine-stable classification   | Rejected    |
| Stable public error + sanitized correlated stderr event | Safe client contract and operator traceability | Requires centralized classification/redaction and regression matrix | Selected    |

### Decision 3: broad cross-platform claim or explicit support policy?

| Option                                                                                 | Strength                        | Cost/risk                                                      | Disposition |
| -------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------- | ----------- |
| Claim Linux, macOS and Windows now                                                     | Broad audience                  | Existing filesystem guarantees are not proven on all platforms | Rejected    |
| Support Linux for v0.7.0 and label other platforms unverified until CI evidence exists | Honest and immediately testable | Smaller initial support promise                                | Selected    |

macOS/Windows may be added later through platform-specific SDDs; they are not silently treated as working or broken.

### Decision 4: release automation or manual publish?

| Option                                                                                                         | Strength                                                                                          | Cost/risk                                                                                          | Disposition                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Manual local publish                                                                                           | Simple first step                                                                                 | Weak SHA/CI/registry traceability and credential handling                                          | Rejected for release closure           |
| Exact-SHA, manually authorized CI publication to npm `next`, followed by consumer proof and `latest` promotion | Reproducible artifact and auditable transitions without requiring a Git tag before registry proof | Requires external trusted-publisher configuration and separate approvals for publication/promotion | Selected, fail-closed until configured |

The release sequence is fixed: push release-candidate SHA -> exact-SHA CI -> publish that SHA/version once under npm dist-tag `next` -> idempotent `verify-next` registry/provenance/consumer proof -> promote the same version to `latest` -> create annotated Git tag and GitHub Release. A Git tag is not the publication trigger. The dispatch authenticates `refs/heads/main` and the requested SHA against trusted `GITHUB_REF`/`GITHUB_SHA` before any checkout, then all jobs check out only `github.sha`; input-selected code never supplies its own validator. Release concurrency serializes the whole workflow without cancellation because npm dist-tags are package-global: grouping by SHA or version would still permit a different candidate to move `next` between promotion readback and mutation. If publication succeeds but the workflow loses its evidence, `verify-next` reconstructs SHA/version-bound evidence without publishing. A deterministic package or verifier failure abandons that version under `next`; it is never promoted and a new patch version is prepared.

Current npm trusted-publisher configuration authorizes only `npm publish`, `npm stage publish`, or both; it does not authorize `npm dist-tag add`. Therefore the initial `next` publication uses OIDC behind a dedicated `npm-publish` Environment that is named in npm's publisher configuration, after separate OIDC-scrubbed GitHub authorization and credential-free build/pack phases have bound the exact CI run and a physical tarball whose packed manifest embeds the release SHA as `gitHead`; the OIDC-only subprocess publishes that tarball with lifecycle scripts disabled, while `latest` promotion uses a separately protected GitHub `production` Environment and its least-privilege granular npm token. Both Environments restrict deployments to `main`, providing the external trust root that an alternate-ref copy of the workflow cannot rewrite. GitHub run/artifact validation and npm mutation are separate steps: the former receives only `GITHUB_TOKEN`, writes a bounded authorization record tied to the numeric artifact ID and verification-evidence hash, and the latter receives only `NODE_AUTH_TOKEN`. No step receives both credentials, and no repository or home-directory credential file is read or committed. A no-dependency boundary runs immediately after setup-node and before Corepack/Yarn so ambient package-manager aliases, every unexpected `COREPACK_*` control, or unreviewed userconfig bytes fail before package-manager activity; Corepack/dependency installation use empty environments rebuilt only from explicit allowlists, dependency lifecycle builds are disabled, and each later npm child receives a separate allowlisted environment. This split is explicit rather than silently assuming OIDC covers package-setting mutations.

The verification artifact is a closed set of physical regular files: registry metadata, signature audit, consumer report and SHA/version/run-bound verification evidence, each with recorded SHA-256 and byte length. Promotion rejects extra entries, symlinks, hardlinks, expired or duplicate artifact identity and live-registry integrity drift before creating its local authorization record. The clean consumer additionally proves exact `engines.node`, official-registry lockfile URL/integrity, lifecycle-script disablement, installed-version handshake, JSON/TOON reads, disabled-default no-cache filesystem behavior, explicit SQLite canary persistence and hash-bound prepare/preview/apply/replay/conflict behavior. It snapshots expected postimages before prepare and proves prepare, preview and a rejected wrong-hash apply cannot mutate them; focused mocks include mutate-then-error responses so an error code cannot hide a write. Preview diffs must reconstruct independently specified exact postimages, marker-only previews/applies fail, and authorized apply/replay bytes and receipts remain bound to the reviewed operation.

### Decision 5: bounded process exit or completion-critical mutation safety?

| Option                                                                                                      | Strength                       | Cost/risk                                                                                | Disposition |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- | ----------- |
| Force termination at one universal shutdown deadline                                                        | Predictable process exit       | Can interrupt rollback/postimage/receipt work after source replacement                   | Rejected    |
| Bounded graceful drain for cancellable work, but preserve completion-critical apply until terminal recovery | Preserves mutation correctness | Graceful shutdown can exceed its nominal drain window while apply is completion-critical | Selected    |

Shutdown stops admission and cancels queued/cancellable work. If the graceful drain expires with no completion-critical apply, the executable may terminate non-zero without closing resources still in use; the OS reclaims process resources and no source write has begun. If apply has crossed the first-source-write boundary, transport/session resources remain open and shutdown waits for rollback, verification and receipt persistence. That completion-critical wait is intentionally not advertised as bounded. External `SIGKILL` remains outside graceful guarantees and uses the existing stale-lock/postimage recovery protocol on restart.

## Scope boundary

### In scope

- Strict session and queue capacity.
- Queue wait deadlines and cooperative request cancellation through the SDK `AbortSignal`.
- Mutation-safe cancellation semantics.
- Idempotent process shutdown and resource cleanup.
- Stable sanitized MCP error responses with correlated bounded stderr events.
- Queue/runtime observability and a read-only canary harness.
- Current-repository and `x-scraper` canary evidence with disabled-default rollback.
- Explicit Linux support policy and current Node matrix.
- Security/release documentation, CI hardening, version/changelog closure and public consumer smoke.
- Archival/supersession of stale persistence evidence documents.

### Out of scope

- Streamable HTTP, authentication, authorization, tenant isolation or sandboxing.
- Worker-thread/process isolation and hard preemption of synchronous compiler calls.
- New mutation operations or broader language support.
- Changing compiler authority, mutation plan hashes or apply eligibility.
- Promoting `AST_SYMBOL_INDEX_PERSISTENCE=enabled`; canary remains the maximum policy.
- Publishing, pushing or creating external release objects without an explicit operator authorization at that boundary.

## Risks

1. A naive timeout races with mutation apply and reports cancellation after source changes. Mitigation: explicit pre-commit and completion-critical phases; cancellation cannot interrupt receipt/rollback completion after write starts.
2. A rejected queued request can break the promise chain or leak counters/listeners. Mitigation: scheduler invariants and cancellation/timeout stress tests.
3. Sanitization can remove useful diagnostics or remain non-idempotent. Mitigation: stable error codes, correlation IDs, compiled-runtime hostile fixtures and preservation tests.
4. Shutdown can race with an active operation. Mitigation: stop admission first, bound only the non-critical grace, never close resources under active work, and preserve completion-critical apply without claiming a universal exit bound.
5. Canary timings can become marketing claims. Mitigation: raw measurements, exact workload/runtime identity and no universal SLA until multiple representative repositories exist.
6. Release automation can publish an unverified artifact. Mitigation: final-SHA CI, exact version preflight, provenance, registry readback and fresh-consumer smoke before tag/release closure.
