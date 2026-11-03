# Chain: Angular template references

Strategy: `feature-branch-chain` (delivery `auto-chain`). One draft/no-merge tracker PR; PR 1 targets the tracker; each later PR targets the immediately previous PR branch. Only the tracker merges to main. Review budget: 800 changed lines per PR (additions + deletions).

## Branches and PR order

| Order | PR                                                 | Branch                                            | Base       | Est. lines |
| ----- | -------------------------------------------------- | ------------------------------------------------- | ---------- | ---------- |
| T     | Tracker (draft, no-merge)                          | `feat/angular-template-references`                | `main`     | 0          |
| 1a    | U1a hygiene (safe-file move, deps, fixture helper) | `feat/angular-template-references-u1a-hygiene`    | tracker    | 356        |
| 1b    | U1b compiler gate and template locator             | `feat/angular-template-references-u1b-loader`     | U1a branch | 619        |
| 1c    | U1c usage extractor and bounds                     | `feat/angular-template-references-u1c-extractor`  | U1b branch | 494        |
| 2a    | U2a references service (helper, templates merge)   | `feat/angular-template-references-u2a-references` | U1c branch | 591        |
| 2b    | U2b find_references tool, guards, digests          | `feat/angular-template-references-u2b-tool`       | U2a branch | 288        |
| 3     | U3 hash-bound rename                               | `feat/angular-template-references-u3-rename`      | U2b branch | ~550       |
| 4     | U4 docs and metadata                               | `feat/angular-template-references-u4-docs`        | U3 branch  | ~200       |

## Dependency diagram

```
main <- tracker <- U1a <- U1b <- U1c <- U2a <- U2b <- U3 <- U4
```

Every child PR body marks its own position with the pointer marker and states start, end, prior dependencies, follow-up and out-of-scope.

## Merge order

Review and merge children bottom-up into their bases: U1a into tracker, U1b into U1a, U1c into U1b, then U2 into U1c (after each lands, retarget the next to tracker), U3 likewise, then U4. When all children are integrated, undraft the tracker and merge it to main. Retarget or rebase any PR whose diff shows unrelated units (polluted diff is a base bug).

## Per-unit boundaries

- U1a: start = tracker; end = safe-file module + deps/aliases + fixture helper; out of scope = service.
- U1b: start = U1a; end = compiler gate, template locator, `listTemplateFiles`; out of scope = extraction, bounds.
- U1c: start = U1b; end = usage extractor, bounds, full `collectTemplateUsages`; out of scope = tool output, rename, docs.
- U2a: start = U1c; end = `collectSymbolReferencesWithTemplates` in the references service; out of scope = tool wiring.
- U2b: start = U2a; end = find_references additive output, explore/diagnostics guards, inventory digests; out of scope = rename, hash, ast_explore.
- U3: start = U2; end = rename writes hash-bound `.html`; out of scope = docs.
- U4: start = U3; end = docs/package smoke; nothing after.

## Native attempt ledger request-id labels (unique per unit)

| Unit | Acquire           | Settle           |
| ---- | ----------------- | ---------------- |
| U1a  | `atr-u1a-acquire` | `atr-u1a-settle` |
| U1b  | `atr-u1b-acquire` | `atr-u1b-settle` |
| U1c  | `atr-u1c-acquire` | `atr-u1c-settle` |
| U2   | `atr-u2-acquire`  | `atr-u2-settle`  |
| U3   | `atr-u3-acquire`  | `atr-u3-settle`  |
| U4   | `atr-u4-acquire`  | `atr-u4-settle`  |

Labels are prefixes; append the attempt number (for example `atr-u1c-acquire-1`) on retry so request ids never collide.

## Per-PR verification

`yarn typecheck`, `yarn lint`, `yarn format:check`, `yarn build`, `yarn test`; U2 adds `yarn test:mcp` and `yarn test:cli`; U3 and the tracker run all four smokes. Rollback scope: revert the PR; U1a-U1c and U2 are additive, U3 reverts the async `mutate` refactor together with the `.html` channel.
