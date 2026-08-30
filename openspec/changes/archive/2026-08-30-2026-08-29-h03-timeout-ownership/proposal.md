# Proposal: H-03 Timeout Ownership

## Intent

Ensure DeepSeek Harness does not terminate an AST call before AST's queue-plus-execution budget. Against pinned Harness `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc`, slow work must expose AST's bounded operational error and cancellation instead of the bridge's generic timeout.

## Scope

### In Scope

- Configure the packaged MCP bridge timeout above AST's default 30-second queue wait plus 120-second execution deadline, with bounded margin.
- Add exact-host slow-fixture evidence for cold, queued, and recycled supervised-worker paths.
- Assert cancellation reaches AST and produces bounded, classified evidence without leaked processes or temporary state.

### Out of Scope

- Remaining H-05 reconnect, removal, shutdown, public-error, or GUI lifecycle work.
- UI, Code Mode/PTC, apply, workspace authorization, and output-vocabulary issue #103.
- Changes to AST scheduling semantics or default promotion of supervised mode.

## Capabilities

### New Capabilities

- `harness-timeout-ownership`: Defines adapter timeout ordering, AST-owned slow-failure behavior, and cancellation evidence at the pinned native Harness boundary.

### Modified Capabilities

- None.

## Approach

Set `toolCallTimeoutMs` in `cordis.patch.yml` above shipped AST queue and execution defaults. Enforce the inequality in adapter tests and extend the pinned-Harness smoke with shortened test-only AST budgets preserving that ordering. Drive deterministic slow operations through cold startup, queue contention, and worker recycle; classify AST error, cancellation, cleanup, and immutable host/bridge identities.

## Affected Areas

| Area                            | Impact   | Description                                      |
| ------------------------------- | -------- | ------------------------------------------------ |
| `cordis.patch.yml`              | Modified | Own outer timeout configuration.                 |
| `test/dsh-adapter.test.ts`      | Modified | Lock adapter budget ordering and smoke contract. |
| `scripts/dsh-adapter-smoke.mjs` | Modified | Add exact-host slow and cancellation evidence.   |
| `test/runtime-process.test.ts`  | Modified | Cover bounded teardown helpers if extended.      |

## Risks

| Risk                                         | Likelihood | Mitigation                                                     |
| -------------------------------------------- | ---------- | -------------------------------------------------------------- |
| Slow evidence becomes flaky or costly        | Med        | Use deterministic gates and reduced test-only budgets.         |
| Cancellation is mistaken for timeout success | Med        | Assert distinct error class, correlation, and process cleanup. |
| Pinned-host drift masks compatibility        | Low        | Fail blocked on every identity mismatch.                       |

## Rollback Plan

Revert the adapter timeout and H-03 fixtures together; retain prior H-01a/H-02 gates and deny-by-default apply behavior.

## Dependencies

- Source-built pinned Harness and MCP bridge, qualifying Node runtime, and isolated profile.

## Proposal Question Round

Assumptions for review: compatibility remains native-mode and pinned-host only; tests may compress AST budgets while separately proving shipped-default ordering; bounded error classification is contractual, exact prose is not.

## Success Criteria

- [ ] The bridge deadline exceeds the complete shipped AST queue-plus-execution budget.
- [ ] Every slow fixture ends in an AST operational error, never a generic bridge timeout.
- [ ] Cold, queued, and recycled-worker cancellation leaves no owned process or temporary state.
