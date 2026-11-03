# Chain: Angular template references

Strategy: `feature-branch-chain` (delivery `auto-chain`). One draft/no-merge tracker PR; PR 1 targets the tracker; each later PR targets the immediately previous PR branch. Only the tracker merges to main. Review budget: 800 changed lines per PR (additions + deletions).

## Branches and PR order

| Order | PR | Branch | Base | Est. lines |
|---|---|---|---|---|
| T | Tracker (draft, no-merge) | `feat/angular-template-references` | `main` | 0 |
| 1 | U1 service | `feat/angular-template-references-u1-service` | tracker | ~600 |
| 2 | U2 find_references | `feat/angular-template-references-u2-find-references` | U1 branch | ~350 |
| 3 | U3 hash-bound rename | `feat/angular-template-references-u3-rename` | U2 branch | ~550 |
| 4 | U4 docs and metadata | `feat/angular-template-references-u4-docs` | U3 branch | ~200 |

## Dependency diagram

```
main <- tracker <- U1 <- U2 <- U3 <- U4
```
Every child PR body marks its own position with the pointer marker and states start, end, prior dependencies, follow-up and out-of-scope.

## Merge order

Review and merge children bottom-up into their bases: U1 into tracker, then U2 into U1 (after U1 lands, retarget U2 to tracker), U3 likewise, then U4. When all children are integrated, undraft the tracker and merge it to main. Retarget or rebase any PR whose diff shows unrelated units (polluted diff is a base bug).

## Per-unit boundaries

- U1: start = main; end = service + fixtures + deps; out of scope = tool output, rename, docs.
- U2: start = U1; end = find_references additive output; out of scope = rename, hash, ast_explore.
- U3: start = U2; end = rename writes hash-bound `.html`; out of scope = docs.
- U4: start = U3; end = docs/package smoke; nothing after.

## Native attempt ledger request-id labels (unique per unit)

| Unit | Acquire | Settle |
|---|---|---|
| U1 | `atr-u1-acquire` | `atr-u1-settle` |
| U2 | `atr-u2-acquire` | `atr-u2-settle` |
| U3 | `atr-u3-acquire` | `atr-u3-settle` |
| U4 | `atr-u4-acquire` | `atr-u4-settle` |

Labels are prefixes; append the attempt number (for example `atr-u1-acquire-1`) on retry so request ids never collide.

## Per-PR verification

`yarn typecheck`, `yarn lint`, `yarn format:check`, `yarn build`, `yarn test`; U2 adds `yarn test:mcp` and `yarn test:cli`; U3 and the tracker run all four smokes. Rollback scope: revert the PR; U1-U2 are additive, U3 reverts the async `mutate` refactor together with the `.html` channel.
