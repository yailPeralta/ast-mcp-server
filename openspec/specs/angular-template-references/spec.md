# Angular Template References Specification

## Purpose

Surface Angular component-member usages located in templates through `find_references`, with fail-closed completeness. Template diagnostics are out of scope.

## Requirements

### Requirement: Angular detection and compiler gate

Angular MUST be considered present only when `@angular/core/package.json` resolves from the tsconfig directory. When it does not resolve, the feature MUST be off and output MUST be byte-identical to the pre-change behavior, with no template fields. When core is present, the user's `@angular/compiler` MUST resolve from the same directory, MUST satisfy the supported range `>=18.0.0 <23.0.0`, and MUST expose every required capability (`parseTemplate`, the template and expression recursive visitors, `ImplicitReceiver`, `ThisReceiver`, `PropertyRead`, `Call`, and a write node as either `PropertyWrite` or assignment `Binary`). When core is present and the compiler is missing, out of range, or lacks a required capability, template coverage MUST be `unfinished` (reason `compiler_missing` or `compiler_unsupported`), never `completed` and never silently off. The server MUST NOT bundle its own compiler; `@angular/compiler` is an optional peer only.

#### Scenario: Compiler absent in an Angular project

- GIVEN `@angular/core/package.json` resolves and `@angular/compiler` does not
- WHEN `find_references` targets a component member
- THEN TypeScript references are returned and `template_coverage` is `{ status: "unfinished", reason: "compiler_missing" }`

#### Scenario: Compiler out of range

- GIVEN `@angular/compiler` resolves to a version outside `>=18.0.0 <23.0.0`
- WHEN `find_references` runs
- THEN no template is parsed and `template_coverage` is `unfinished` with reason `compiler_unsupported`

#### Scenario: Supported majors

- GIVEN `@angular/compiler` resolves to a v18, v19, v20, v21, or v22 release
- WHEN `find_references` runs
- THEN templates are parsed and usages are reported identically across those majors

#### Scenario: Core absent

- GIVEN no resolvable `@angular/core/package.json`, even if files contain a fake `@Component` and `.html` files
- WHEN `find_references` runs
- THEN the output and workspace hash are byte-identical to the pre-change behavior, `template_coverage` is not emitted, and no template fields appear

### Requirement: Owning component and template resolution

(Previously: only the template of the declaring class was searched.) For a plain member, only the template of the declaring class that carries a resolved `@Component` MUST be searched, and name matching across the project MUST NOT be used. For a selector-bound member (`@Input`, `@Output`, `input()`, `input.required()`, `output()`, `model()`, `model.required()`) or a `@Pipe` class, the templates searched MUST be the declaring class's own template plus the templates of the consumers found by scope resolution (see `angular-template-scope`), never by name matching. A template MUST be located only from a string-literal (or no-substitution template literal) `templateUrl`, or from an inline `template`. A resolved external path MUST be resolved relative to the component file and MUST pass the same safety rules as other operation files (no symlink, a single hard link, correct owner, inside the project root after real-path resolution). A computed or non-literal `templateUrl` MUST NOT be resolved. A member inherited from a base class by a derived class that is itself a component MUST yield coverage `unsupported` with reason `inherited_member`.

#### Scenario: Same member name in another component

- GIVEN two unrelated plain components that each declare `title`
- WHEN references to the first component's `title` are collected
- THEN only the first component's template usages are reported

#### Scenario: Consumer template is read

- GIVEN a child `@Input() x` and an in-scope parent with a literal `templateUrl`
- WHEN references to `x` are collected
- THEN the parent's template is read under the same safety rules and its binding usages are reported with project-relative file and exact span

#### Scenario: Consumer template unsafe

- GIVEN an in-scope consumer whose `templateUrl` resolves outside the project root
- WHEN references are collected
- THEN that file is not read and coverage is `unfinished` with reason `template_unsafe`

#### Scenario: Computed consumer templateUrl

- GIVEN an in-scope consumer with a non-literal `templateUrl`
- WHEN references are collected
- THEN coverage is `unfinished` with reason `template_unresolved`

#### Scenario: Inherited member

- GIVEN a derived component class using a member declared on its base class
- WHEN references to that member are collected
- THEN `template_coverage` is `unsupported` with reason `inherited_member`

#### Scenario: Literal templateUrl resolves

- GIVEN a component with `templateUrl: './a.component.html'` beside it
- WHEN references are collected
- THEN that file is read and its usages are attributed to the declaring class's members

#### Scenario: Symlink or hardlink template

- GIVEN the target `.html` is a symlink or has multiple hard links
- WHEN references are collected
- THEN it is not read and `template_coverage` is `unfinished` with reason `template_unsafe`

#### Scenario: Computed templateUrl

- GIVEN `templateUrl` is a non-literal expression
- WHEN references are collected
- THEN `template_coverage` is `unfinished` with reason `template_unresolved` and no absence is claimed

### Requirement: Cross-component usages are reported

(Previously: cross-component members were always `unfinished/cross_component`.) A member bound through the component selector (declared with `@Input` or `@Output` imported from `@angular/core`, or initialized with `input()`, `input.required()`, `output()`, `model()` or `model.required()` from `@angular/core`) MUST report its own-template usages and the in-scope consumer usages. Coverage MUST be `completed` only when the fail-closed conditions of `angular-template-scope` hold; otherwise it MUST be `unfinished` with `cross_component` (opaque scope) or a more specific reason. A decorator or factory of the same name imported from another module MUST NOT trigger this rule. A class decorated with `@Pipe` from `@angular/core`, and every member of it, MUST yield `unfinished/cross_component` with no consumer usages until S3, and from S3 MUST list `| name` usages with the same completeness rule. Slice gating: S1 covers standalone components with literal `imports` and `selector`, inputs and outputs; S2 adds NgModule scope, the Angular 18 default, `model()` and literal aliases; S3 adds pipes. Before the slice that supports a construct, it MUST keep `unfinished/cross_component`. Directive-declared inputs and outputs MUST stay `unfinished`. A failure to read any template MUST keep its own reason. `completed` MUST NOT claim runtime-binding or out-of-Project coverage.

#### Scenario: Input with consumers, scope fully resolved (S1)

- GIVEN a standalone child with `@Input() x` used in its own template and a standalone parent with literal `imports` using `[x]`
- WHEN references to `x` are collected
- THEN own and consumer usages are reported and `template_coverage` is `{ status: "completed", templates: 2 }`

#### Scenario: Scope not fully resolved (S1)

- GIVEN a candidate component with a non-literal `imports`
- WHEN references to `x` are collected
- THEN own and resolvable consumer usages are reported and coverage is `unfinished` with reason `cross_component`

#### Scenario: NgModule construct before S2

- GIVEN the S1 build and a consumer declared in an NgModule
- WHEN references to `x` are collected
- THEN coverage is `unfinished` with reason `cross_component`

#### Scenario: Same-named decorator from another module

- GIVEN a member decorated with an `Input` imported from a module other than `@angular/core`
- WHEN references to that member are collected
- THEN the member is treated as a plain member and coverage is `completed`

#### Scenario: Pipe before S3

- GIVEN a class decorated with `@Pipe` from `@angular/core` and the S1 or S2 build
- WHEN references to the class or its `transform` are collected
- THEN `template_coverage` is `{ status: "unfinished", reason: "cross_component", templates: 0 }`

#### Scenario: Pipe from S3

- GIVEN a `@Pipe({ name: 'fmt' })` class imported by a parent that uses `| fmt`
- WHEN references to the class or `transform` are collected
- THEN the `| fmt` usages are reported and coverage is `completed` when scope is fully resolved

### Requirement: Member usage extraction

The system MUST report declaring-component member usages in templates (properties, methods, accessors, signals), including control flow, structural directives, `@let` values, and pipe arguments, each with exact source span, project-relative file, and a usage `kind`. Own-template usages keep kinds `TemplatePropertyRead`, `TemplatePropertyWrite` and `TemplateCall`; a signal call MUST be `TemplateCall`. Consumer usages MUST carry kinds `TemplateInputBinding` for `[x]`, `TemplateAttribute` for `x="lit"`, `TemplateTwoWayBinding` for `[(x)]` and `TemplateOutputBinding` for `(y)` and `(xChange)`, with the span of the bound name only (not the value). Pipe name usages (S3) MUST carry the kind `TemplatePipeName` with the `nameSpan`. The reported `context` MUST be the template line text. Usages in inline templates MUST be reported with their spans but MUST NOT be writable. Existing items for non-Angular or plain-member outputs MUST NOT change.

#### Scenario: Consumer binding kinds

- GIVEN a consumer template with `[x]`, `x="lit"`, `[(x)]` and `(y)`
- WHEN references are collected
- THEN each is reported with its consumer binding kind (`TemplateInputBinding`, `TemplateAttribute`, `TemplateTwoWayBinding` or `TemplateOutputBinding`), a span covering only the bound name, and `context` equal to the template line

#### Scenario: Consumer in an inline template

- GIVEN an in-scope consumer with a literal inline `template:`
- WHEN references are collected
- THEN the usage is reported with `origin: "template_inline"` and is not writable

#### Scenario: Usage kinds

- GIVEN a template with `{{ title }}`, `(click)="title = 'x'"`, `(click)="save()"` and `{{ count() }}` where `count` is a signal
- WHEN references are collected
- THEN the usages are reported as `TemplatePropertyRead`, `TemplatePropertyWrite`, `TemplateCall`, and `TemplateCall` respectively, with exact spans

#### Scenario: Control flow and pipes

- GIVEN `@if (user) { {{ items | slice: limit }} }`
- WHEN references are collected
- THEN `user`, `items`, and `limit` are reported as component usages

#### Scenario: Inline template usage

- GIVEN a literal inline `template:` using `title`
- WHEN `find_references` runs
- THEN the usage is reported with `origin: "template_inline"` and an exact span

### Requirement: Shadowing exclusions

Matching MUST be scope-aware. Names in scope from `@for` (item alias and implicit variables such as `$index`), `@let`, `#ref`, `let-x`, `@if ... as`, and `$event` MUST shadow component members, so reads of those names MUST NOT be reported as component member usages. Each usage MUST record the set of template-local names in scope at that usage.

#### Scenario: Local shadows member

- GIVEN a component member `item` and `@for (item of items; track item)` in the template
- WHEN references to the member are collected
- THEN usages of `item` inside the loop are excluded

#### Scenario: Event variable

- GIVEN `(click)="onClick($event)"`
- WHEN references to a member named `event` are collected
- THEN `$event` is not reported

#### Scenario: Member read outside the shadowing scope

- GIVEN `item` is shadowed inside an `@for` block and also read after the block
- WHEN references to the member are collected
- THEN only the read outside the loop scope is reported

### Requirement: Completeness and fail-closed coverage

Template coverage MUST be `completed` (carrying the number of templates examined) only when every template that the member's contract requires (declaring class, and, for selector-bound members and pipes, every in-scope consumer) was resolved and parsed within bounds. An unresolvable (`template_unresolved`), unsafe (`template_unsafe`), unparseable (`template_parse_error`), oversized (`size_exceeded`), or work-exhausted (`work_exhausted`, including the project-level budget) template MUST set coverage `unfinished` with that reason. An opaque scope, an unsupported selector-bound construct, `hostDirectives`, or a directive-declared input or output MUST set coverage `unfinished` with reason `cross_component`. Coverage MUST be `not_applicable` when Angular is absent. The system MUST NOT claim proven absence when coverage is not `completed`. TypeScript references MUST still be returned in every case.

#### Scenario: Unparseable template

- GIVEN a template that fails to parse
- WHEN `find_references` runs
- THEN TypeScript references are still returned, coverage is `unfinished` with reason `template_parse_error`, and no absence claim is made

#### Scenario: Fully covered

- GIVEN all required templates resolve and parse
- WHEN `find_references` runs
- THEN coverage is `completed` with the count of templates examined

#### Scenario: Project-level budget (S1)

- GIVEN the consumer discovery exceeds the project-level work budget
- WHEN `find_references` runs
- THEN coverage is `unfinished` with reason `work_exhausted`

### Requirement: Bounded work and pagination

Each template MUST be limited to 512 KiB and 100,000 visited nodes, with cancellation checkpoints between templates and every 1,000 nodes. Exceeding the size limit MUST set coverage `unfinished` with reason `size_exceeded`; exceeding the node limit MUST set reason `work_exhausted`. Template usages MUST be merged with TypeScript items, ordered deterministically, and paginated together under the existing cursor contract so `total` and `has_more` stay truthful.

#### Scenario: Many usages

- GIVEN more combined TypeScript and template usages than the page limit
- WHEN `find_references` runs
- THEN a bounded page and a continuation cursor are returned in deterministic order

#### Scenario: Template over size bound

- GIVEN a template larger than 512 KiB
- WHEN `find_references` runs
- THEN it is not parsed and coverage is `unfinished` with reason `size_exceeded`

#### Scenario: Node bound exhausted

- GIVEN a template whose visit exceeds 100,000 nodes
- WHEN `find_references` runs
- THEN coverage is `unfinished` with reason `work_exhausted`

### Requirement: Additive schema and TOON parity

When coverage is not `not_applicable`, the response MUST add top-level `template_coverage` and `template_reference_count`, and every item MUST carry a uniform `origin` of `compiler`, `template_external`, or `template_inline`. `reference_count` MUST remain TypeScript-only, `total` MUST count both kinds, and `affected_files` MUST include template `.html` files, including consumer templates. New usage kinds (`TemplateInputBinding`, `TemplateAttribute`, `TemplateTwoWayBinding`, `TemplateOutputBinding`, `TemplatePipeName`) are additive. No new tool inputs are introduced. TOON output MUST carry the same information as JSON. The inventory MUST be re-baselined only when the tool description changes (S5).

#### Scenario: Counts with consumers

- GIVEN 3 TypeScript references, 1 own-template usage and 2 consumer usages
- WHEN `find_references` runs
- THEN `reference_count` is 3, `template_reference_count` is 3, and `total` is 6

#### Scenario: Format parity

- GIVEN the same request in JSON and TOON
- WHEN both are decoded
- THEN consumer usages, `origin` values, kinds, `template_coverage`, and `template_reference_count` are identical

#### Scenario: Counts

- GIVEN 3 TypeScript references and 2 template usages
- WHEN `find_references` runs
- THEN `reference_count` is 3, `template_reference_count` is 2, and `total` is 5

### Requirement: Diagnostics remain TypeScript-only

(Unchanged in substance, restated.) Edit-aware diagnostic delta MUST remain TypeScript-only, including after consumer-template rewrites. Template type checking of rename plans is out of scope. Tool descriptions and docs MUST state that template errors are not detected.

#### Scenario: Consumer breakage not diagnosed

- GIVEN a rename that rewrites a consumer binding incorrectly
- WHEN diagnostics delta is evaluated
- THEN no template diagnostic is produced and the limitation is stated

#### Scenario: find_references tool description before S5

- GIVEN S1 to S4
- WHEN the `ast_find_references` description is read
- THEN it is unchanged from the current declared string

#### Scenario: Template breakage not diagnosed

- GIVEN an edit that breaks only a template binding
- WHEN diagnostics delta is evaluated
- THEN no template diagnostic is produced and the limitation is stated

#### Scenario: find_references tool description

- GIVEN the tool inventory
- WHEN the `ast_find_references` description is read
- THEN it is exactly: `Finds type-resolved references and returns bounded project-relative locations, including declaration impact by default. When @angular/compiler resolves, it also reports Angular template usages, including consumer templates, tagged by origin with a template_coverage verdict; completed covers templates inside the Project only, incomplete coverage does not prove absence, and template errors are not diagnosed.`
- AND this string is digest-sensitive: it MUST match the fixture declaration and the re-baselined inventory pins byte for byte

### Requirement: Template evidence stays out of impact analysis

Template and consumer usages MUST NOT enter `ast_get_impact` or `ast_find_test_candidates` evidence, edges or coverage.

#### Scenario: Impact unchanged

- GIVEN a member with consumer template usages
- WHEN `ast_get_impact` and `ast_find_test_candidates` run
- THEN their output is identical to the previous behavior

### Requirement: Docs and skill state the cross-component contract

The structural-code-editing skill and operation docs MUST describe consumer usages, the meaning of `completed` for cross-component (templates inside the Project only), the constructs that stay `unfinished` (`setInput`, router input binding, `createComponent`, `hostDirectives`, directive inputs/outputs, consumers outside the Project), and the pipe and `transform` rules.

#### Scenario: Skill text

- GIVEN the skill and operations reference after S5
- WHEN they are read
- THEN each listed limitation and the follow-up issue for template type checking are stated
