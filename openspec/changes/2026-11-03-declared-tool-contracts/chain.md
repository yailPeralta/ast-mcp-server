# Chain: Declared tool contracts

Strategy: `feature-branch-chain` (delivery `auto-chain`). One draft/no-merge tracker PR; PR 1 targets the tracker; PR 2 targets the PR 1 branch. Only the tracker merges to main. Review budget: 800 changed lines per PR (repo budget 400; above it needs `size:exception`). Issue: #383 (needs `status:approved` before apply).

## Branches and PR order

| Order | PR                                                                  | Branch                                         | Base       | Est. lines (design / realistic) |
| ----- | ------------------------------------------------------------------- | ---------------------------------------------- | ---------- | ------------------------------- |
| T     | Tracker (draft, no-merge)                                           | `feat/declared-tool-contracts`                 | `main`     | 0                               |
| 1a    | U1a fixture, pure module, comparison rules, target validation       | `feat/declared-tool-contracts-u1a-module`      | tracker    | 625 (`size:exception`)          |
| 1b    | U1b strictness, ordered evidence, smoke wiring (behavior identical) | `feat/declared-tool-contracts-u1b-wiring`      | U1a branch | 334                             |
| 2     | U2 descriptions, fixture entries, three pins, docs                  | `feat/declared-tool-contracts-u2-descriptions` | U1b branch | ~260-300 / 520-700              |

## Dependency diagram

```
main <- tracker <- U1a <- U1b <- U2
```

Every child PR body marks its own position with the pointer marker and states start, end, prior dependencies, follow-up and out-of-scope.

## Merge order

Review and merge bottom-up: U1 into tracker, then retarget U2 to tracker and merge it. When both are integrated, undraft the tracker and merge it to main. A child PR whose diff shows unrelated units is a base bug: retarget or rebase it.

## Per-unit boundaries

- U1: start = tracker; end = `scripts/lib/declared-tool-contracts.mjs` and `.d.mts`, fixture with `tools: {}`, smoke wiring, `test/declared-tool-contracts.test.ts`, `test/dsh-adapter.test.ts` source-text checks; out of scope = tool descriptions, pins, docs. Behavior identical to the current blanket freeze.
- U2: start = U1; end = the two descriptions, fixture entries, oracle and pin-equality tests, three re-baselined pins (tool-inventory, registry-consumer, canary), CHANGELOG, README paragraph, ADR 0015 addendum, `test/angular-docs.test.ts` adjustments; nothing after.

## Native attempt ledger request-id labels (unique per unit)

| Unit | Acquire          | Settle          |
| ---- | ---------------- | --------------- |
| U1   | `dtc-u1-acquire` | `dtc-u1-settle` |
| U2   | `dtc-u2-acquire` | `dtc-u2-settle` |

Labels are prefixes; append the attempt number (for example `dtc-u1-acquire-1`) on retry so request ids never collide. The ledger is unavailable in this build; record the labels anyway.

## Per-PR verification

- Each PR: `yarn typecheck && yarn lint && yarn format:check && yarn build`, `env -u GIT_EDITOR yarn test` (includes the canary pin check), `yarn test:package`, `env -u GIT_EDITOR yarn test:dsh-adapter` (exit 0, no green-skip).
- U2 additionally: `yarn test:local-registry` once (only run that exercises the registry-consumer pin locally).
- Rollback: revert U2 (descriptions, pins, entries, docs return together; U1 with `tools: {}` equals today's freeze); revert U1 (inline equality and local `semanticSchema` return).
