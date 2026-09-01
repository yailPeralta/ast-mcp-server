# Exploration: H-05 Harness lifecycle ownership

## Baseline

- Approved tracker #116 and docs child #117 target Harness `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc` with `@deepseek-ai/dsh-mcp-client@0.1.2-alpha.1`.
- The existing smoke authenticates host/CLI/bridge/AST/config/Node identity, installs an isolated profile, proves 15 guarded tools, and preserves H-01a/H-02/H-03. H-01a joins raw, model, durable, replay, and teardown evidence; H-03 owns cancellation, bounded errors, worker generations, and cleanup through a private environment-gated fixture.
- The bridge disposer stops reconnect, closes the client, waits for connect/sync, and unregisters tools; re-enable creates a fresh client and atomic catalog swap. Raw transport loss deliberately retains the last-good catalog, so deterministic removal is Cordis config-HMR disable, not first-edge disconnect.
- The Session user-cancel path aborts the Agent signal forwarded by ToolRuntime/bridge. The GUI has no MCP status endpoint, but Trajectory → Tools renders each durable `request/header` catalog.
- PR #115 merged at `7ab04c29a274156c78c470eb7bc3488ce057b928`; H-03 is archived with final main CI/Security green but remains unreleased as v0.13.1. Phase 0 corrects stale roadmap/annex claims.

## Unknowns requiring RED evidence

1. Whether Session cancellation yields AST `REQUEST_CANCELLED` rather than generic bridge abort.
2. Whether disposal suppresses in-flight success/late durable effects and the Loader exposes a stable HMR barrier.
3. Whether pinned Playwright can prove rendered `15 → 0 → 15` without an AST dependency or host edit.
4. Whether shutdown proves listener/timer/process/profile/socket/lock/temp absence rather than masking residue with final deletion.
5. Immediate raw-disconnect removal conflicts with the pinned bridge and would require out-of-scope upstream work.

## Evidence plan

| RED               | Required boundary                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 truth     | Reject open/unmerged #115 claims; require merged-but-unreleased, archived H-03.                                                                          |
| Removal/reconnect | Atomic config-HMR disable/re-enable; loader barrier; `15→0→15`; old owner exits; stale `UNKNOWN_TOOL`; fresh schemas match once.                         |
| User cancel       | Native Session cancel of held `ast_get_project_status`; one bounded correlated `REQUEST_CANCELLED`, native result, durable result, zero fixture residue. |
| Late generation   | Dispose held generation, release late producers, reject success/duplicate/durable/re-registration; only fresh generation publishes.                      |
| Shutdown          | Join Agent/MCP/AST/worker/owner identities; close admission and prove all owned state absent.                                                            |
| GUI               | Browser-inspect three Trajectory Tools headers; rendered unique AST counts `15→0→15`; JSONL/probe only correlate.                                        |
| Sanitization      | Closed codes/keys, UUID and byte bounds; no stack, paths, args, environment, credentials, nonce, or owner token.                                         |

## Approach and scope

Extend `scripts/dsh-adapter-smoke.mjs` with bounded helpers and one stable overlay probe; reuse `scripts/runtime-process.mjs`, the private fixture, scheduler/worker/public-error seams, focused tests, and the pinned Web/Playwright runtime. A separate gate duplicates identity/setup; raw transport reconnect cannot prove removal. Use one authenticated run with native Agent/Session and browser lanes, event barriers rather than sleeps, exact schema/result/header/process cardinality, and no public fixture tool.

In scope: Phase 0 docs, authenticated Web/probe identity, config-HMR removal/re-add, real user cancel, late-generation/shutdown cleanup, rendered GUI evidence, and all predecessor/apply-denial gates. Excluded: apply/H-04, UI features, Code Mode/PTC, #103, generic executors/pools, canaries, newer Harness, and host edits.

## Risks and decision

Cancellation/late-settlement races may expose upstream ownership gaps; GUI data may be indirect; HMR may flake; non-AST tools create catalog noise; expensive exact-host setup and cleanup can hide leaks. Fail rather than filter/skip: count exact `mcp__ast__*` names, correlate rendered rows, use event barriers and owner/readback evidence, and keep production unchanged until the smallest RED fails. Proceed with config-HMR as removal and Trajectory Tools as the GUI witness; a separate connection indicator is out of scope.
