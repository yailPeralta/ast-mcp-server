# Tasks: Cross-component Angular template usages (#408)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,900 total across 7 PRs, each 150-380 |
| 400-line budget risk | High as one PR, Low per slice |
| Chained PRs recommended | Yes |
| Suggested split | 1a -> 1b -> 2a -> 2b -> 3 -> 4 -> 5 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Changes since design: #410 (bb99b01) already ships the directive-member `unfinished/cross_component` report and rename block, so D8 and the 1b directive work are dropped. 1b falls from ~360 to ~300. It cannot merge into 1a (~290 + ~300 > 400). Spec wins on `transform`: `INCOMPLETE_EVIDENCE`, not `MUTATION_BLOCKED`. Open question on D8 ordering is closed.

Conventions: branch `feat/408-<slice>`; one `type:*` label per PR (`type:feature`; PR 5 `type:docs`); `Refs #408` on PRs 1a-4, `Closes #408` on PR 5 only. Every PR runs: `yarn format:check && yarn lint && yarn typecheck && yarn test`, plus `yarn test:dsh-adapter` and `yarn test:agent-fixtures` when tool output or fixtures change. Template suites run across compiler aliases v18-v22 (`it.skipIf(!compilerMajorSupportedByNode)`). Order within a PR is RED -> GREEN -> REFACTOR. Spec sync: tick the matching `[Sn]` scenarios.

### Suggested Work Units

| Unit | Goal | PR (base) | Focused test | Runtime harness | Rollback boundary |
|------|------|-----------|--------------|-----------------|-------------------|
| 1 | Decorator move + scope resolver (standalone) | 1a (main) | `yarn vitest run test/angular-template-scope.test.ts test/angular-templates.test.ts` | N/A: no behavior change | revert module files |
| 2 | Consumer bindings, `completed` reachable, rename gate | 1b (1a) | `yarn vitest run test/angular-template-bindings.test.ts test/angular-templates.test.ts` | `yarn test:agent-fixtures` | revert 1b; 1a stays inert |
| 3 | NgModule scope, v18 default | 2a (1b) | `yarn vitest run test/angular-template-scope.test.ts` | `yarn test:agent-fixtures` | scope file only |
| 4 | Aliases, `model()` | 2b (2a) | `yarn vitest run test/angular-templates.test.ts -t alias` | `yarn test:agent-fixtures` | binding-name code |
| 5 | Pipe usages, pipe class unblock | 3 (2b) | `yarn vitest run test/angular-templates.test.ts -t pipe` | `yarn test:agent-fixtures` | pipe branch |
| 6 | Consumer rename rewrite | 4 (3) | `yarn vitest run test/angular-templates.test.ts -t rename` | `yarn test:mcp && yarn test:lifecycle` | rewrite + gate swap |
| 7 | Docs, skill, inventory | 5 (4) | `yarn vitest run test/angular-docs.test.ts` | `yarn test:dsh-adapter && yarn test:package` | docs only |

## PR 1a: feat/408-scope-foundation (~290, Refs #408)

- [x] 1a.1 RED `test/helpers/angular-fixture.ts`: extend `CORE_DECLARATIONS` with `NgModule`, `Directive`, `forwardRef`, `imports`, `standalone`, `inputs`, `outputs`; `test/angular-fixture.test.ts` asserts them.
- [x] 1a.2 Move predicates (`isAngularCoreExport`, `isCoreDecorator`, `componentDecorator`, `isPipeClass`, `isDirectiveClass`, `isSelectorPublic`, `isMetadataPublic`, literal helpers, `angularCoreMajor`) from `src/services/angular-templates.ts` to new `src/services/angular-decorators.ts`. Pure move; existing `test/angular-templates.test.ts` stays green untouched (GREEN gate).
- [x] 1a.3 RED `test/angular-template-scope.test.ts`: standalone import, self-reference, decoy same selector without import -> `excludes`, import via alias, `forwardRef` from core, `forwardRef` from another module -> `opaque`, external-library import -> `excludes`, `RouterModule.forChild()` -> `excludes`, spread / variable / in-project call -> `opaque`, absent `imports` -> empty scope, `standalone` non-literal -> `opaque`, absent flag with major >= 19 -> standalone, unknown major -> `opaque`.
- [x] 1a.4 GREEN `src/services/angular-template-scope.ts`: `createScopeResolver(context, target, {coreMajor, budget})`, memoized; ts-morph only. Budget caps: 10,000 scope visits -> `work_exhausted`; `rc.checkpoint()` per visit (RED: tiny budget).
- [x] 1a.5 Verify: lint, typecheck, test. No tool output changes.

## PR 1b: feat/408-consumer-bindings (~300, Refs #408; needs 1a)

Split decided during apply (1b exceeded 400 lines): 1b-pre = branch `feat/408-consumer-bindings` (visitor + extraction refactor; 1b.1-1b.3, 346 lines); 1b = branch `feat/408-consumer-wiring` stacked on it (1b.4-1b.9, 396 lines). Neither pushed yet. Deviations: 1b.5 impact/test-candidates unchanged test and `@for` locals case not added separately (traversal covered in bindings tests); 1b.8 no schema change, so no parity test edit; 1b.9 releases.json untouched (digests unchanged by the dsh check).

- [x] 1b.1 RED `test/angular-template-bindings.test.ts` per-version characterization (`describe.each(v18..v22)`): BindingType and ParsedEventType numbers (incl. v20 animation renumbering); `keySpan` slice equals the name for `[x]`, `(y)`, `[(x)]`, `bind-x`, `on-y`, `bindon-x`; TwoWay `BoundEvent` name `xChange` and its keySpan; `TextAttribute.keySpan` defined; `createCssSelectorFromNode` includes bound input and output names.
- [x] 1b.2 RED selector matching: element, `[attr]`, class, `:not()`; `ngNonBindable` subtree skipped; `attr.`/`class.`/`style.` and animation skipped; `Template` children visited; selectorless nodes fail closed; TwoWay events deduplicated.
- [x] 1b.3 GREEN `src/services/angular-template-bindings.ts`: pure visitor `extractConsumerUsages(nodes, BindingTarget)`; runtime invariant `text.slice(keySpan) === name`, violation -> `cross_component`.
- [x] 1b.4 RED `loadCompiler` capability `selectors: boolean` (missing API -> member `unfinished/compiler_unsupported`, own-template coverage unaffected).
- [x] 1b.5 RED integration in `test/angular-templates.test.ts`: target `app-card`; importing consumer listed (`[x]`, `x="lit"`, `[(x)]`, `(y)`, kinds `TemplateBinding`, `origin`, counts 3 TS + 1 own + 2 consumer = total 6); decoy (same selector, no import) ignored; opaque scope consumer that matches -> `unfinished/cross_component`; opaque scope with no match -> still `completed`; non-literal `imports` -> `unfinished`; hostDirectives -> `unfinished`; `@Input` from non-core module -> plain member `completed`; control-flow `@for` locals include `r`; unsafe `templateUrl` -> `template_unsafe`; computed -> `template_unresolved`; parse error -> `template_parse_error` and other consumers still returned; project budget -> `work_exhausted`; no `@angular/core` -> byte-identical output; impact and test-candidates outputs unchanged.
- [x] 1b.6 RED rename gate: `completed` + cross-component `@Input`/`@Output`/`input()`/`output()` -> `INCOMPLETE_EVIDENCE`, zero edits (D6 `crossComponent: boolean`).
- [x] 1b.7 GREEN `src/services/angular-templates.ts`: prefilter (case-insensitive), project scan with one work budget (2,000 templates, 32 MiB, 1,000,000 nodes), merge worst-coverage-wins, `role`/`binding`/`bindingName` additions, D6 gate in `assertTemplateRenameAllowed`.
- [x] 1b.8 Update schema/TOON parity test; run `yarn test:dsh-adapter`, `yarn test:agent-fixtures`. Declared tool descriptions unchanged (no hash churn).
- [x] 1b.9 CHANGELOG Unreleased entry; releases.json digest rotation with version kept, if source digests change.

## PR 2a: feat/408-ngmodule-scope (~280, Refs #408; needs 1b)

- [x] 2a.1 RED scope tests: same-module declarations; re-export chain A -> B -> C; imported-not-exported excluded; cycle terminates; depth cap 32; spread/call in `declarations`/`imports`/`exports` -> `opaque`; non-standalone with no module -> `opaque`; v18 absent flag -> module scope; v19+ absent flag -> standalone.
- [x] 2a.2 RED integration: NgModule consumer was `unfinished` before, now listed; NgModule decoy ignored.
- [x] 2a.3 GREEN `angular-template-scope.ts`: module lookup by declarations symbol identity, exported-scope flattening with visited set.
- [x] 2a.4 Spec sync, CHANGELOG; verify as above.

## PR 2b: feat/408-aliases-model (~240, Refs #408; needs 2a)

- [x] 2b.1 RED: `@Input('a')`, `@Input({alias})`, `input(v,{alias})`, `input.required({alias})`, `@Output('a')`, `output({alias})` map consumer `a` to member; non-literal alias -> `unfinished`.
- [x] 2b.2 RED `model()`/`model.required()` per version v18-v22: `[x]`, `[(x)]` and `(xChange)` all reported; Angular 18 compiler behaviour for `xChange` verified.
- [x] 2b.3 GREEN binding-name table (design Binding Names) in `angular-templates.ts`; verify, spec sync, CHANGELOG.

## PR 3: feat/408-pipe-usages (~250, Refs #408; needs 2b)

- [x] 3.1 RED per version: `BindingPipe.nameSpan` equals the name for `{{ a | fmt | fmt: 2 }}` and pipes in args/control flow.
- [x] 3.2 RED integration: in-scope pipe usages listed for class and `transform`; out-of-scope same name ignored; non-literal `name` -> `unfinished`; opaque scope -> `unfinished`; kind `TemplatePipeName`.
- [x] 3.3 RED rename: pipe class rename applies with TS edits only, no template edit, `name:'fmt'` and `| fmt` unchanged; `transform` rename -> `INCOMPLETE_EVIDENCE` (spec wins over design D7); pipe-name target no template edit.
- [x] 3.4 GREEN pipe branch in bindings/orchestrator; skip template gate for `@Pipe` class; keep `transform` gate. Verify, spec sync, CHANGELOG.

## PR 4: feat/408-consumer-rename (~330, Refs #408; needs 3)

- [x] 4.1 RED rename: `[x]`->`[y]`, `x="lit"`->`y="lit"`, `[(x)]`, `(y)`, `bind-`/`on-`/`bindon-` preserved; `model()` `[(x)]`->`[(v)]` and `(xChange)`->`(vChange)`; aliased member leaves `[label]`; `affected_files` and receipt list `.html`.
- [x] 4.2 RED safety: inline consumer -> `MUTATION_BLOCKED`, zero edits; `[(x)]` on non-model pair -> `MUTATION_BLOCKED`; new name equals another input/output/alias, `vChange` collision, collision with a directive on the same element, `$any`, name in target selector -> `MUTATION_BLOCKED`; opaque scope, hostDirectives, `@Directive` member -> `INCOMPLETE_EVIDENCE`.
- [x] 4.3 RED apply: stale consumer `.html` -> `CONFLICT`, bytes kept; rollback after consumer commit restores owned postimage else `AMBIGUOUS_APPLY`; prepared-operation schema unchanged.
- [x] 4.4 GREEN per-usage `newText`, consumer `expectedHash`, replace the D6 gate; verify including `yarn test:mcp`, `yarn test:lifecycle`; CHANGELOG, spec sync.

## PR 5: feat/408-docs-contract (~150, Closes #408; needs 4)

Deviations: skill version kept at 4.6.0 (digest rotation only, matching PRs 1a-4 and 5.4; bundle versions change at release). Description strings authored here (design did not fix them) and synced byte for byte into `openspec/specs/angular-template-{references,rename}/spec.md`. Canary pin computed from a guard=allow `tools/list` run of the built server.

- [x] 5.1 RED `test/angular-docs.test.ts`: skill and `references/operations.md` state consumer usages, `completed` = in-Project only, unfinished constructs (`setInput`, router input binding, `createComponent`, `hostDirectives`, directive inputs/outputs, outside-Project consumers), pipe/`transform` rules, TS-only diagnostics, follow-up issue link.
- [x] 5.2 GREEN update `skills/structural-code-editing/SKILL.md` (bump version), `references/operations.md`, `README.md`.
- [x] 5.3 Re-baseline `ast_find_references` and `ast_rename_symbol` descriptions per `declared-tool-contracts`: update inventory and `tools/list` hash; run `yarn test:dsh-adapter`, `yarn test:agent-fixtures`, `yarn test:package`, `yarn build`.
- [x] 5.4 (reconciled at archive: issue part done via #421 (opened 2026-11-06); placeholder replaced on main in README, CHANGELOG, skill and operations.md and asserted in test/angular-docs.test.ts; remaining parts done per this parenthetical: digest rotation, CHANGELOG, spec sync) Open follow-up issue for template type checking; releases.json digest rotation with version kept; CHANGELOG Unreleased; archive-ready spec sync.
