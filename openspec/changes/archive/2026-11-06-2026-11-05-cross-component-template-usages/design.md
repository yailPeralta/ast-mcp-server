# Design: Cross-component Angular template usages

Issue #408. Inputs: proposal (Engram `sdd/2026-11-05-cross-component-template-usages/proposal`), exploration (`.../explore`).

## Technical Approach

Selector matching is a necessary condition for a consumer usage. Scope only filters matches. So the engine scans every component template in the ts-morph Project. It parses only templates that pass a cheap text prefilter. It matches elements against the target selector with the user's `SelectorMatcher`. Then it asks a scope resolver whether the target is in the consumer's compilation scope:

| Element matches target selector | Scope verdict | Result |
|---|---|---|
| yes | `includes` | list the binding usages |
| yes | `excludes` | ignore (decoy with the same selector) |
| yes | `opaque` | `unfinished/cross_component` |
| no | any | nothing (an opaque scope is harmless) |

The prefilter skips a template only when the element name or first attribute name of every selector alternative (or the pipe name) is absent from it, compared case-insensitively. When that holds, the selector cannot match. A consumer template that cannot be read before the prefilter (unresolved, unsafe, or over size) makes coverage `unfinished` with that reason.

`completed` means that every component template in the Project was examined and that every match resolved. Runtime bindings and consumers outside the Project are not covered.

## Architecture Decisions

| Decision | Choice | Rejected alternatives | Rationale |
|---|---|---|---|
| D1 Module layout | New `angular-decorators.ts` holds the predicates moved out of `angular-templates.ts` (`isAngularCoreExport`, `isCoreDecorator`, `componentDecorator`, `isPipeClass`, `isSelectorPublic`, literal helpers, `angularCoreMajor`). New `angular-template-scope.ts` (ts-morph only, no compiler). New `angular-template-bindings.ts` (pure visitor, no I/O, type-only import of `CompilerModule`). `angular-templates.ts` stays the single orchestrator. | Grow `angular-templates.ts` past 900 lines. Mutual imports between modules. | Deep modules, an acyclic graph, and each one testable alone. |
| D2 Scan strategy | Scan all components with a prefilter, then match, then check scope. | Walk the scope graph forward from the target. | Forward resolution cannot prove that opaque consumers are absent. The match-first order fails closed only where it matters. |
| D3 Coverage reasons | No new reason. An opaque scope, non-literal metadata, or a span mismatch maps to `cross_component`. Consumer read failures reuse `template_unresolved`, `template_unsafe`, `template_parse_error`, `size_exceeded`, and `work_exhausted`. | Add `scope_unresolved`. | This needs no schema or `tools/list` hash churn before slice 5. Existing reasons already describe consumer template failures. |
| D4 Selector capability | `loadCompiler` probes `CssSelector.parse`, `SelectorMatcher`, and `createCssSelectorFromNode` as an optional capability `selectors: boolean`. | Add them to the global `complete` check. | A missing selector API must not degrade own-template coverage. Selector-public members then get `unfinished/compiler_unsupported`. |
| D5 Span drift | Runtime invariant: `text.slice(keySpan) === bindingName`. Any violation gives `unfinished/cross_component`. Per-alias tests characterize each syntax. | Trust typings. | Five majors. Typings do not prove runtime span semantics. |
| D6 Rename block (slice 1) | `collectTemplateUsages` returns `crossComponent: boolean`. `assertTemplateRenameAllowed` throws `INCOMPLETE_EVIDENCE` when it is true, even when coverage is `completed`. | Rely on today's `unfinished` coverage. | Slice 1 makes `completed` reachable, so it would otherwise pass the gate. |
| D7 Pipe class rename | Skip the template gate for an `@Pipe` class. It gets no template edits. | Require `completed`. | Templates bind the `name` literal, not the class. `transform` stays `MUTATION_BLOCKED`: it is the pipe contract. |
| D8 Directive members | `@Directive` selector-public members and `inputs:`/`outputs:` metadata arrays return `unfinished/cross_component` (PR 1b). | Keep `not_applicable`. | Bug found: today these return `not_applicable`, so rename passes the gate and breaks consumer templates without warning. |

## Scope Resolution Algorithm

`createScopeResolver(context, target, {coreMajor, budget}) => (consumer) => ScopeVerdict`. It is memoized per request.

1. **Standalone check**. `standalone: true` makes the consumer standalone. `false` makes it module-declared. When the flag is absent, the consumer is standalone if `coreMajor >= 19` and module-declared if `coreMajor` is 18. An unknown major makes the verdict `opaque`.
2. **Standalone consumer**. A consumer equal to the target gives `includes` (self-reference). Otherwise it reads the literal `imports` array. An absent array means an empty scope.
3. **Module-declared consumer**. Find the NgModules whose literal `declarations` contain the consumer, by symbol identity. Zero modules gives `opaque`. The scope is the union of each module's declarations and the exported scope of each of its imports.
4. **Elements of `imports`, `declarations`, and `exports`**.
   - An identifier goes through `getSymbol`, then `getAliasedSymbol`, to a class declaration.
   - `forwardRef(() => X)` is unwrapped only when `forwardRef` comes from `@angular/core`.
   - A declaration in an external library gives `excludes`: a library cannot export project classes. A call whose callee is external, such as `RouterModule.forChild()`, also gives `excludes`.
   - Spreads, variables, in-project calls, and in-project `.d.ts` files give `opaque`.
5. **Exported scope of a module**. Its `exports` are flattened transitively through re-exported modules. A visited set handles cycles. Depth is capped at 32.

The scope check applies to the target class for members. It applies to the pipe class in slice 3.

## Binding Names

| Member | Input name(s) | Output name(s) |
|---|---|---|
| `@Input()` / `@Input('a')` / `@Input({alias:'a'})` | `x` / `a` | none |
| `input()`, `input(v,{alias})`, `input.required({alias})` | `x` / `a` | none |
| `@Output()` / `output({alias})` | none | `x` / `a` |
| `model()` (slice 2b) | `x` | `xChange` |

A non-literal alias gives `cross_component`. Bindings that are matched:

- `BoundAttribute` of type Property (0) and TwoWay (5).
- A `TextAttribute` with the input name.
- A `BoundEvent` of type Regular (0).
- TwoWay events (2) are deduplicated by span, as today.

Skipped:

- `attr.`, `class.`, `style.`, and animation bindings.
- Subtrees under `ngNonBindable`.
- `Template` nodes: components never match them, but their children are visited.

Selectorless nodes (`visitComponent` or `visitDirective`) fail closed.

**Verify per major (v18 to v22) in RED characterization tests**: the BindingType and ParsedEventType numbers (including the v20 animation renumbering); that `keySpan` excludes `[`, `(`, `[(`, `bind-`, `on-`, and `bindon-`; the TwoWay `BoundEvent` name `xChange` and its keySpan; that `TextAttribute.keySpan` is defined; and that `createCssSelectorFromNode` includes bound input and output names.

## Data Flow

```
find_references / prepareRename
  └─ collectTemplateUsages(node)
       ├─ own template (existing extractUsages)
       └─ if selector-public or @Pipe:
            ├─ for each componentClasses(): locate, read, prefilter, parse
            │    └─ extractConsumerUsages(nodes, BindingTarget) → matches
            │         └─ scopeResolver(consumer) → includes/excludes/opaque
            └─ merge: worst coverage wins; templates = examined count
```

## Interfaces

```ts
type ScopeVerdict = "includes" | "excludes" | "opaque";
interface BindingTarget { selector: string; inputs: string[]; outputs: string[]; pipe?: string }
// TemplateUsage additions (kind stays a string in the schema):
role: "own" | "consumer";
binding?: "input" | "static_input" | "two_way" | "output" | "pipe";
bindingName?: string;
// kind adds TemplateInputBinding | TemplateAttribute | TemplateTwoWayBinding | TemplateOutputBinding | TemplatePipe
```

**Work budget** (one object per request): 2,000 templates, 32 MiB of bytes, 1,000,000 nodes, and 10,000 scope visits. The existing per-template caps still apply. `rc.checkpoint()` runs once per template, every 1,000 nodes, and once per scope visit. Exhausting the budget gives `work_exhausted`.

## Rename (slice 4)

- Each consumer usage gets its own `newText`. Unaliased inputs and outputs get `newName`. For `model()`, the output gets `${newName}Change` and `[(x)]` gets `newName`. Aliased members get no consumer edit.
- `expectedHash` is the hash of the consumer template's bytes. Consumer templates are already in the snapshot through `listTemplateFiles`.
- `MUTATION_BLOCKED` covers these cases:
  - an inline consumer;
  - `[(x)]` on a non-`model` input/output pair;
  - `newName` collides with another binding name of the target;
  - `newName` collides with an input or output of another directive in scope matched on the same element, or that directive's names cannot be listed;
  - the input name is part of the target selector.

## Testing Strategy (Strict TDD)

`CORE_DECLARATIONS` in `test/helpers/angular-fixture.ts` gains `NgModule`, `Directive`, `forwardRef`, and the `imports`, `standalone`, `inputs`, and `outputs` metadata.

| Layer | Fixture / assertion |
|---|---|
| Unit: scope | Standalone import; `forwardRef`; external module gives `excludes`; spread gives `opaque`; module re-export chain; cycle; v18 core with an absent flag |
| Unit: bindings | Span table per syntax via `describe.each(v18..v22)` with `it.skipIf(!compilerMajorSupportedByNode)` |
| Integration | Target `app-card`. Importing consumer: listed. **Decoy** with the same selector and no import: ignored. Opaque consumer that matches: `unfinished`. Opaque consumer with no match: still `completed`. Non-Angular output: byte-identical |
| Rename | Slice 1 completed and cross-component gives `INCOMPLETE_EVIDENCE`; pipe class applies; `transform` blocked; slice 4 multi-file plan with hash mismatch rejected |

## PR Cut Lines (additions + deletions)

| PR | Content | Forecast |
|---|---|---|
| 1a | Move code into `angular-decorators.ts` (pure move). Scope module (standalone, `forwardRef`, external exclusion) and its unit tests | ~290 |
| 1b | Bindings visitor (unaliased inputs and outputs), capability probe, merge, the D6 gate, the D8 fix, fixture and integration tests | ~360 |
| 2a | NgModule scope, v18 default | ~280 |
| 2b | Literal aliases, `model()` | ~240 |
| 3 | Pipe usages, pipe class unblock, `transform` block | ~250 |
| 4 | Rename rewrite and collision checks | ~330 |
| 5 | Docs, skill, inventory, description re-baseline, follow-up issue | ~150 |

## Threat Matrix

N/A. There is no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The compiler import path already exists and does not change.

## Migration / Rollout

No migration is required. The fields are additive. Revert the PRs in reverse order.

## Open Questions

- [ ] Should the D8 directive fix ship as a separate `type:bug` PR before 1a? It is a safety hole that exists today.
