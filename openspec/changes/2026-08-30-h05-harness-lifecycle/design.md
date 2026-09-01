# Design: H-05 user-visible Harness lifecycle

## Architecture decisions

Extend the authenticated `scripts/dsh-adapter-smoke.mjs`; do not create another gate. Phase 0 is docs-only. Production changes require a failing smallest RED. H-01a/H-02/H-03, 15 guarded tools, and apply denial remain mandatory.

| Seam        | Decision                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | Hash/authenticate pinned host, CLI, bridge/source/tarball, AST/config, Node, profile, Agent/Session, Web/Playwright/Chromium before control state; drift is `BLOCKED`.                                                                                  |
| HMR         | Keep a stable probe in an immutable overlay; atomically replace disposable `cordis.patch.yml`; subscribe before change, await expected catalog plus `ctx.loader.await()`, then recheck owner state. Raw transport loss and sleeps are invalid evidence. |
| Convergence | Removal = zero AST schemas, old PID exit, stale `UNKNOWN_TOOL`; reconnect = 15 unique baseline hashes, new PID, one successful call.                                                                                                                    |
| Correlation | Join `{journey,bridgeGeneration,callId,fixtureId,workerGeneration,ownerToken}`, AST `correlation_id`, durable `message.source.callId`, and header session/sequence/catalog hash; reject wrong generation and duplicate/post-retirement effects.         |
| Fixture     | Generalize the private environment-gated H-03 event/readback seam around public `ast_get_project_status`; add no public tool.                                                                                                                           |
| GUI         | Resolve Playwright from pinned `apps/web/package.json`, launch its Chromium against actual `dsh web`, and inspect Trajectory request rows/Tools names; JSONL only correlates. Missing package/browser/auth/rows is `BLOCKED`.                           |

## State and sequence

```text
HMR: subscribe → atomic disable → disposer/client close/child exit → tools(0) → loader.await
     → atomic enable → fresh Client/list/swap → tools(15)
Cancel: Session call/hold → cancel(user) → Agent/SDK signal → AST REQUEST_CANCELLED
        → native result → durable result; Abort ACK stays separate
Retire: hold[g1] → disable/dispose → one error → release late producers → reject effects
        → enable/publish[g2]
GUI: three prompts around enable/disable/enable → request/header → Trajectory Tools 15/0/15
Shutdown: held call + warm worker → SIGTERM/root dispose → owners reap → residue absent
```

Generation is `ABSENT→CONNECTING→LIVE→RETIRING→RETIRED`; only `LIVE` publishes. A call is `ADMITTED→HELD→{CANCELLED|RETIRED|SHUTDOWN}→TERMINAL`; `TERMINAL` rejects later effects.

## Slices, cleanup, and threat model

| PR       | Files/evidence                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------- |
| 1 docs   | Roadmap, annex, OpenSpec; merged-but-unreleased truth.                                               |
| 2 seams  | Fixture/runtime/scheduler/worker/error tests; cancellation, generation, sanitization, zero counters. |
| 3 native | Smoke/static contract; HMR, cardinality, retirement, shutdown, preserved gates.                      |
| 4 GUI    | Pinned browser witness, correlation, final cleanup/closure.                                          |

Parent owns Host/browser/mock/temp root; bridge owns client/reconnect/registrations/AST child; AST owns worker/queue timers/listeners/holds; browser owns contexts/pages. `finally` closes in that order, proves process-group exit and zero counters/files, then removes and proves temp-root absence.

Executable classification, Git selection, commit/push, and PR-command threat rows are N/A. No migration or host edit. Roll back PRs 4→1 and rerun `yarn build && yarn test:dsh-adapter`. Forecast 550–850 runtime authored lines, high 400-line risk; four autonomous `stacked-to-main` PRs stay ≤400. Release v0.13.1 is post-merge.
