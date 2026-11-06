# Proposal: Cross-component Angular template usages

Issue: #408. Stopgap: #407 (4cb2cc7). Exploration: Engram `sdd/2026-11-05-cross-component-template-usages/explore`.

## Intent

Selector-bound members and pipes are used in consumer templates, which are never read. They report `unfinished/cross_component` and rename is blocked. Agents need those usages listed, with fail-closed completeness.

## Scope

### In Scope

- Consumer discovery through component scope (standalone `imports`, NgModule `declarations`/`exports`/`imports`), by symbol identity, and selector matching with the user's `@angular/compiler`.
- Bindings for `@Input`, `input()`, `input.required()`, `@Output`, `output()`, later `model()` and literal aliases.
- `| name` usages for the pipe class and its `transform`. Pipe class rename is unblocked.
- Hash-bound rewrite of consumer bindings in the final rename slice.

### Out of Scope

- Template type checking of rename plans (separate follow-up issue). Diagnostics stay TypeScript-only.
- Renaming a pipe `name`. `@angular/language-service` and ngtsc. New dependencies.
- Non-literal scope, alias, selector or name, `hostDirectives`, and consumers outside the ts-morph Project. These stay `unfinished`.

## Capabilities

### New Capabilities

- `angular-template-scope`: consumer resolution, selector and pipe-name matching, fail-closed reasons.

### Modified Capabilities

- `angular-template-references`: the cross-component requirement now lists consumer usages, and `completed` is possible.
- `angular-template-rename`: a cross-component member stays blocked even when coverage is `completed`, until slice 4. The pipe class is no longer blocked.
- `declared-tool-contracts`: the description is re-baselined in slice 5.

## Approach

Extend `src/services/angular-templates.ts` with a scope index (exploration approach 2). Use `CssSelector`, `SelectorMatcher` and `createCssSelectorFromNode` for matching. Use binding `keySpan` and `BindingPipe.nameSpan` for spans.

## Slice plan (each PR under 400 lines, one `type:*` label)

| PR | Scope | Refs |
| -- | ----- | ---- |
| 1 | Read-only: standalone components with literal `imports` and `selector`. Lists input/output bindings. `completed` only if the scope is fully resolved and every candidate template was read. Rename stays blocked. | #408 |
| 2 | NgModule scope, the Angular 18 standalone default, `model()`, literal aliases | #408 |
| 3 | Pipe `| name` usages. Unblock pipe class rename (no template edit). | #408 |
| 4 | Rename rewrite with per-usage `newText` (`model()` maps to `xChange`). Inline consumer is `MUTATION_BLOCKED`. | #408 |
| 5 | Docs, skill, inventory, follow-up issue | Closes #408 |

## Affected Areas

| Area | Impact |
| ---- | ------ |
| `src/services/angular-templates.ts` | Modified |
| `src/services/{references,operations}.ts` | Modified |
| `src/tools/find_references.ts`, inventory, skill | Modified |

## Risks

| Risk | Likelihood | Mitigation |
| ---- | ---------- | ---------- |
| `completed` overclaims: runtime bindings (`setInput`, router) are not visible | Med | The verdict covers templates only. This is stated in docs. |
| Selector API drift across 18 to 22 | Med | Capability check, fixture matrix |
| A slice exceeds 400 lines | Med | Split a PR before apply |

## Rollback Plan

Revert PRs in reverse order. Fields are additive. Without PR 1, the behavior is #407 again (fail-closed).

## Success Criteria

- [ ] PR 1 lists exact consumer binding spans and does not match same-named selectors outside scope.
- [ ] Any opaque scope keeps `cross_component` `unfinished`.
- [ ] Rename is blocked for cross-component members until PR 4. Pipe class rename applies.
- [ ] Non-Angular output is unchanged.

## Proposal question round

Run as a subagent, so these were not asked. Assumptions for review:

1. `transform` rename stays blocked. Only the class is unblocked.
2. `completed` means template evidence within the Project. It does not cover runtime bindings or external library consumers.
3. Inputs and outputs declared on `@Directive` classes stay `unfinished` (a later slice).
