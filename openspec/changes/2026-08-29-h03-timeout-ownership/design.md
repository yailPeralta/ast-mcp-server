# Design: H-03 Timeout Ownership

## Technical Approach

Make one package-owned budget tuple authoritative, have the packaged Cordis patch derive the bridge deadline from it, and prove the strict ordering both statically and through the pinned native Harness. Exact-host evidence uses compressed budgets and a closed test-only gate around the existing project scheduler; normal scheduling, tools, apply policy, and worker mode remain unchanged.

## Architecture Decisions

| Decision        | Alternatives / tradeoff                                                                                                                                   | Choice and rationale                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget source   | Duplicated YAML/test literals are simpler but can drift.                                                                                                  | Add `deepseekHarness.timeoutBudget` to `package.json`: `{queueWaitMs:30000, executionDeadlineMs:120000, marginMs:15000, outerToolCallMs:180000}`. Validation requires integers, positive margin, and `outerToolCallMs > queueWaitMs + executionDeadlineMs + marginMs`. `cordis.patch.yml` sets `config.toolCallTimeoutMs` through a `!!js` read of the installed package metadata, making this tuple the sole machine-readable source. |
| Runtime fixture | Large projects or fixed sleeps are nondeterministic. Existing public seams cannot hold an operation, observe queue admission, or signal recycle causally. | Phase 2 exposes an `AST_H03_FIXTURE`-gated hook that Phase 3 calls inside an existing tool's `withProjectOperation` callback, avoiding scheduler re-entry and registration. Its consumer validates the control directory and retains nonce/generation in drained events; exact-host wiring remains Phase 3.                                                                                                                            |
| Classification  | Exact prose is brittle; Harness timeout can mask AST.                                                                                                     | Parse AST’s bounded JSON error envelope and assert existing class/code pairs: `ProjectOperationSchedulerError/QUEUE_WAIT_TIMEOUT`, `ProjectOperationSchedulerError/OPERATION_DEADLINE_EXCEEDED`, and cancellation as `ProjectOperationSchedulerError` or `RequestContextError` with `REQUEST_CANCELLED`. Explicitly reject Harness `ToolTimeoutError`/`TOOL_TIMEOUT` and unrelated `AbortError` tool classifications.                  |

## Data Flow

```text
package.json tuple -> Cordis !!js -> bridge toolCallTimeoutMs
Harness callId -> bridge request -> fixture -> project scheduler -> AST error envelope
      |                              |             |
      +-> capture plugin             +-> JSONL event (nonce, fixtureId, generation)
                    -> join callId + fixtureId + correlation_id -> cleanup readback
```

The exact-host profile overrides the same fields to queue `100 ms`, execution `1000 ms`, margin `100 ms`, outer `1500 ms`; the same validator proves `1500 > 100 + 1000 + 100`. Timers enforce budgets, while readiness/release uses fixture events, never delay-based sleeps.

Cold starts with no child, holds after scheduler admission, and ends `OPERATION_DEADLINE_EXCEEDED`. Queued starts a blocker, waits for `started`, submits a second same-project call, and requires `QUEUE_WAIT_TIMEOUT` plus no later `started`. Recycle completes a warm call, waits for the existing `compiler_worker kind=idle` event, then starts generation N+1 and aborts only after its `started` event, requiring `REQUEST_CANCELLED`; stale-generation settlement is rejected.

## File Changes

Phase 2 adds `src/services/h03-timeout-fixture.ts`, descriptor forwarding in `src/services/runtime-policy.ts`, and focused tests. Phase 3 owns existing-tool/exact-host wiring and smoke changes.

## Interfaces / Contracts

Evidence authenticates Harness revision/tag/CLI version and hashes, bridge version plus source revision/tarball hash, AST version/tarball and entrypoint hashes, adapter hash/effective dump-config, Node version/binary hash, and native mode. Missing/mismatched identity returns `BLOCKED` before fixtures.

Phase 2 events are drainable and contain nonce, fixture ID, phase, and generation; Phase 3 adds `correlation_id`/Harness `callId` joins and bounded persistence. Phase 2 proves scheduler/listener/event cleanup only. Phase 3 must prove process and disposable-state cleanup in `finally`.

## Testing Strategy

RED: `yarn vitest run test/dsh-adapter.test.ts test/runtime-process.test.ts`; `yarn build && yarn test:dsh-adapter`. GREEN uses the same commands, then `yarn typecheck && yarn lint`. Keep slow pinned-host work only in existing `test:dsh-adapter` CI; ordinary `yarn test` gains fast tuple/helper tests only.

## Threat Matrix

All prescribed rows are N/A: documentation-like path classification, Git repository selection, commit state, push state, and PR commands are untouched. The applicable subprocess boundary is covered by argv/no-shell execution, bounded cancellation, process-tree ownership, and RED cleanup tests above.

## Migration / Rollout

Ship tuple and evidence together. Rollback points: (1) metadata/patch/static test; (2) gated fixture/exact-host phase. Reverting both preserves H-01a/H-02 and deny-by-default apply behavior.

## Open Questions

None. The closed fixture is required because current seams cannot deterministically prove queued non-start or recycle generation correlation.
