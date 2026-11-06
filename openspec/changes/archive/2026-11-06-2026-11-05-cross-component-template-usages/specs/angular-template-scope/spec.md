# Angular Template Scope Specification

## Purpose

Resolve which templates consume a selector-bound member or a pipe, by component scope and symbol identity, with fail-closed reasons. Slice tags `[S1]`..`[S5]` mark the delivering PR (see proposal slice plan).

## ADDED Requirements

### Requirement: Consumer discovery by scope and symbol identity [S1]

The system MUST find the consumers of a selector-bound member by resolving, for each candidate component in the ts-morph Project, whether the declaring directive or component is in that component's template scope. Scope MUST be established by symbol identity (resolved declarations), and MUST NOT be established by matching selector strings, class names or file names across the project. A template whose component does not have the declaring class in scope MUST NOT be reported, even when its selector text matches.

#### Scenario: Standalone parent and child with property binding

- GIVEN a standalone child with selector `app-child` declaring `@Input() x`, and a standalone parent whose literal `imports` contains the child and whose template has `<app-child [x]="v" />`
- WHEN references to `x` are collected
- THEN the parent's `[x]` binding key is reported with an exact span, an `origin` of the parent's template origin, and the consumer template is counted in `templates`

#### Scenario: Literal attribute binding

- GIVEN the parent template has `<app-child x="lit" />`
- WHEN references to `x` are collected
- THEN the `x` attribute name is reported as a usage with an exact span

#### Scenario: Two-way binding

- GIVEN the parent template has `<app-child [(x)]="v" />` and `x` is an `@Input` with an `xChange` `@Output`
- WHEN references to `x` are collected
- THEN the `[(x)]` key is reported as a usage of `x`, with an exact span covering the bound name

#### Scenario: Output binding

- GIVEN the child declares `@Output() y` and the parent template has `<app-child (y)="onY($event)" />`
- WHEN references to `y` are collected
- THEN the `(y)` event key is reported as a usage of `y` with an exact span

#### Scenario: Decoy with same selector out of scope

- GIVEN a second component with selector `app-child` declaring its own `x`, and a parent that does not import the first child but imports a different module
- WHEN references to the first child's `x` are collected
- THEN the decoy's usages and the parent's out-of-scope `<app-child [x]>` are not reported

#### Scenario: Same-selector sibling in scope of another component

- GIVEN two components with selector `app-child`, each imported by a different parent
- WHEN references to the first child's `x` are collected
- THEN only the parent that imports the first child is reported

### Requirement: Selector matching with the user's compiler [S1]

Selector matching MUST use the user's own `@angular/compiler` selector matcher (`CssSelector`, `SelectorMatcher`, `createCssSelectorFromNode`) over the consumer element. A required matcher capability that is missing MUST yield coverage `unfinished` with reason `compiler_unsupported`. A non-literal selector MUST yield `unfinished`. Matching MUST include element, attribute, class and `:not()` forms the matcher supports. The server MUST NOT bundle a compiler.

#### Scenario: Attribute selector directive

- GIVEN a directive with selector `[appHighlight]` declaring `@Input() appHighlight`, in scope of a parent whose template has `<p [appHighlight]="c">`
- WHEN references are collected
- THEN the binding is reported

#### Scenario: Non-literal selector

- GIVEN a component whose `selector` is a non-literal expression and which is in scope of a consumer
- WHEN references to its inputs are collected
- THEN coverage is `unfinished` and no absence is claimed

#### Scenario: Matcher capability missing

- GIVEN a supported-range `@angular/compiler` lacking a required selector API
- WHEN references to a selector-bound member are collected
- THEN coverage is `unfinished` with reason `compiler_unsupported`

### Requirement: Alias and signal-API members [S2]

Inputs and outputs MUST be matched by their public binding name. A literal alias (`@Input('a') x`, `input<T>({ alias: 'a' })`, `@Output('a') y`, `output({ alias: 'a' })`) MUST map consumer bindings of `a` to the declaring member. A non-literal alias MUST yield coverage `unfinished`. `model()` and `model.required()` MUST be matched for both `[x]`/`[(x)]` and the derived `(xChange)` output.

#### Scenario: Literal input alias

- GIVEN `@Input('label') text` on the child and a parent template with `<app-child [label]="v" />`
- WHEN references to `text` are collected
- THEN the `[label]` key is reported as a usage of `text`

#### Scenario: Non-literal alias

- GIVEN `@Input(ALIAS) text` where `ALIAS` is not a literal
- WHEN references to `text` are collected
- THEN coverage is `unfinished` and no consumer usage is claimed as complete

#### Scenario: model() reports value and change binding

- GIVEN `x = model<string>()` on the child and a parent template with `<app-child [(x)]="v" (xChange)="h($event)" />`
- WHEN references to `x` are collected
- THEN both the `[(x)]` key and the `(xChange)` key are reported as usages of `x`

#### Scenario: Required signal input

- GIVEN `x = input.required<string>()` on the child and a consumer with `[x]`
- WHEN references to `x` are collected
- THEN the consumer binding is reported

### Requirement: NgModule scope [S2]

For a non-standalone component, scope MUST be computed from the declaring `NgModule`'s literal `declarations`, `imports` and `exports`, including the transitive `exports` of imported modules and re-exported modules. A directive or component is in scope of a template only when it is declared in, or exported (directly or through a re-exported module) to, the module that declares the consuming component. A non-literal, spread or unresolvable entry in any of these arrays MUST yield `unfinished` for the affected scope. A component declared in no `NgModule` and not standalone MUST yield `unfinished`.

#### Scenario: Declared in the same module

- GIVEN a child and a parent both in `declarations` of one `NgModule`
- WHEN references to the child's `x` are collected
- THEN the parent's binding is reported

#### Scenario: Re-exported module

- GIVEN module A exports a child; module B `exports: [A]`; module C imports B and declares a parent using `<app-child [x]>`
- WHEN references to `x` are collected
- THEN the parent's binding is reported through the re-export chain

#### Scenario: Imported but not exported

- GIVEN module A declares a child but does not export it; module B imports A and declares a parent using `<app-child [x]>`
- WHEN references to `x` are collected
- THEN the parent's usage is not reported as an in-scope consumer

#### Scenario: Non-literal NgModule entry

- GIVEN an `imports` array containing a spread or a call expression
- WHEN references to a member of a possibly in-scope child are collected
- THEN coverage is `unfinished`

### Requirement: Standalone scope and the Angular 18 default [S1, S2]

A component MUST be treated as standalone when `standalone: true` is a literal, or, for a resolved `@angular/core` major greater than or equal to 19, when `standalone` is absent. For a resolved `@angular/core` major equal to 18, an absent `standalone` MUST be treated as `false`. A non-literal `standalone` value MUST yield `unfinished`. A standalone component's scope MUST be its literal `imports`, including standalone children, NgModules (through their `exports`) and bare arrays of literal identifiers. A non-literal `imports` (spread, call expression, identifier bound to a non-array initializer) MUST keep coverage `unfinished` with a scope reason and MUST NOT be treated as an empty scope. S1 MUST support literal `standalone: true` only; the version default is S2.

#### Scenario: Non-literal imports stays unfinished

- GIVEN a parent with `imports: [...SHARED, ChildComponent]`
- WHEN references to the child's `x` are collected
- THEN coverage is `unfinished` and the child's usage list is not claimed complete

#### Scenario: Angular 18 default is not standalone

- GIVEN `@angular/core` 18 and a component with no `standalone` property
- WHEN scope is resolved
- THEN the component is treated as `standalone: false` and its scope comes from its `NgModule`

#### Scenario: Angular 19 default is standalone

- GIVEN `@angular/core` 19 and a component with no `standalone` property and a literal `imports`
- WHEN scope is resolved
- THEN the component is treated as standalone and its scope comes from `imports`

#### Scenario: Non-literal standalone

- GIVEN `standalone: FLAG` where `FLAG` is not a literal
- WHEN scope is resolved
- THEN coverage is `unfinished`

### Requirement: Shadowing and scope of consumer bindings [S1]

A consumer binding MUST be reported only when its element is matched by the declaring selector in the consuming template. Binding keys MUST be reported using the compiler's binding `keySpan`. A binding on an element inside `@for`/`@if`/`@let` blocks MUST be reported with the locals in scope at that usage.

#### Scenario: Binding inside control flow

- GIVEN a parent template with `@for (r of rows; track r) { <app-child [x]="r" /> }`
- WHEN references to the child's `x` are collected
- THEN the `[x]` key is reported and the recorded locals include `r`

### Requirement: Fail-closed completeness for cross-component [S1]

For a selector-bound member, coverage MAY be `completed` only when all of the following hold: the declaring class's own templates were read; the scope of every candidate component in the Project was resolved from literal data; every in-scope consumer template was resolved, parsed and within bounds; and no unsupported construct below applies. Otherwise coverage MUST be `unfinished` with the most specific reason (`cross_component` for an unresolved scope, or the template-read reason). `completed` for cross-component MUST mean template evidence inside the ts-morph Project only. The following MUST keep coverage `unfinished` and MUST NOT be claimed as covered: runtime bindings (`setInput`, router input binding, `createComponent`, dynamic component APIs), `hostDirectives`, inputs and outputs declared on `@Directive` classes (until a later slice), inline consumer templates for rename purposes, and consumers outside the Project.

#### Scenario: Fully resolved scope completes

- GIVEN all candidate components have literal `selector`, `standalone` and `imports`, and every in-scope consumer template resolved and parsed
- WHEN references to a child `@Input` are collected
- THEN coverage is `completed` with the count of templates examined (own plus consumers)

#### Scenario: hostDirectives

- GIVEN a component with a `hostDirectives` array that includes the directive declaring the member
- WHEN references to a member of that directive are collected
- THEN coverage is `unfinished`

#### Scenario: Directive-declared input

- GIVEN `@Directive({ selector: '[appX]' })` declaring `@Input() appX`
- WHEN references to `appX` are collected (S1 to S3)
- THEN coverage is `unfinished`

#### Scenario: Runtime binding is not covered

- GIVEN a component whose input is also set through `componentRef.setInput('x', v)`
- WHEN references are collected and coverage is `completed`
- THEN docs and the response contract state that runtime bindings are outside `completed`

#### Scenario: Consumer template failed to parse

- GIVEN one in-scope consumer template fails to parse
- WHEN references are collected
- THEN coverage is `unfinished` with reason `template_parse_error` and the other consumers' usages are still returned

### Requirement: Project-level work bound [S1]

Consumer discovery MUST be bounded by a project-level work budget in addition to the per-template bounds. Exhausting the budget MUST set coverage `unfinished` with reason `work_exhausted`, MUST return the usages found so far, and MUST NOT claim absence. Cancellation checkpoints MUST occur between candidate components and consumer templates.

#### Scenario: Budget exhausted

- GIVEN a project with more candidate consumer templates than the project-level budget allows
- WHEN references are collected
- THEN coverage is `unfinished` with reason `work_exhausted`

### Requirement: Pipe usages [S3]

For a class decorated with `@Pipe` from `@angular/core` that has a literal `name`, the system MUST list `| name` usages in templates of components that have the pipe class in scope (same scope rules as directives), with the exact `BindingPipe.nameSpan`. The same usages MUST be reported for the pipe class and for its `transform` member. A non-literal `name` or an out-of-scope or unresolved scope MUST keep coverage `unfinished`. A pipe name MUST NOT be matched by name across the project.

#### Scenario: Pipe usage listed

- GIVEN `@Pipe({ name: 'fmt' }) class FmtPipe` imported by a standalone parent whose template has `{{ v | fmt: a }}`
- WHEN references to `FmtPipe` are collected
- THEN the `fmt` name span is reported as a usage and the same usage is reported for `FmtPipe.transform`

#### Scenario: Same pipe name out of scope

- GIVEN another pipe with `name: 'fmt'` in a component that does not import `FmtPipe`
- WHEN references to `FmtPipe` are collected
- THEN that usage is not reported

#### Scenario: Pipe argument and nested usage

- GIVEN `{{ a | fmt | fmt: 2 }}`
- WHEN references are collected
- THEN both name spans are reported

#### Scenario: Non-literal pipe name

- GIVEN `@Pipe({ name: NAME })` with a non-literal `NAME`
- WHEN references are collected
- THEN coverage is `unfinished`

### Requirement: Non-Angular output unchanged [S1]

When `@angular/core` does not resolve, consumer discovery MUST NOT run and output MUST stay byte-identical to the previous behavior.

#### Scenario: No Angular core

- GIVEN a project with fake `@Component` classes and no `@angular/core`
- WHEN references are collected
- THEN no scope work is performed and output is unchanged
