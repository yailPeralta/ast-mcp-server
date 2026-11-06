# Angular Template References Specification (delta)

## MODIFIED Requirements

### Requirement: Owning component and template resolution [S1]

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

### Requirement: Cross-component usages are reported [S1]

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

### Requirement: Member usage extraction [S1]

The system MUST report declaring-component member usages in templates (properties, methods, accessors, signals), including control flow, structural directives, `@let` values, and pipe arguments, each with exact source span, project-relative file, and a usage `kind`. Own-template usages keep kinds `TemplatePropertyRead`, `TemplatePropertyWrite` and `TemplateCall`; a signal call MUST be `TemplateCall`. Consumer usages MUST carry the kind `TemplateBinding`, covering `[x]`, `x="lit"`, `[(x)]`, `(y)` and `(xChange)`, with the span of the bound name only (not the value). Pipe name usages (S3) MUST carry the kind `TemplatePipeName` with the `nameSpan`. The reported `context` MUST be the template line text. Usages in inline templates MUST be reported with their spans but MUST NOT be writable. Existing items for non-Angular or plain-member outputs MUST NOT change.

#### Scenario: Consumer binding kinds

- GIVEN a consumer template with `[x]`, `x="lit"`, `[(x)]` and `(y)`
- WHEN references are collected
- THEN each is reported with kind `TemplateBinding`, a span covering only the bound name, and `context` equal to the template line

#### Scenario: Consumer in an inline template

- GIVEN an in-scope consumer with a literal inline `template:`
- WHEN references are collected
- THEN the usage is reported with `origin: "template_inline"` and is not writable

### Requirement: Completeness and fail-closed coverage [S1]

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

### Requirement: Additive schema and TOON parity [S1]

When coverage is not `not_applicable`, the response MUST add top-level `template_coverage` and `template_reference_count`, and every item MUST carry a uniform `origin` of `compiler`, `template_external`, or `template_inline`. `reference_count` MUST remain TypeScript-only, `total` MUST count both kinds, and `affected_files` MUST include template `.html` files, including consumer templates. New usage kinds (`TemplateBinding`, `TemplatePipeName`) are additive. No new tool inputs are introduced. TOON output MUST carry the same information as JSON. The inventory MUST be re-baselined only when the tool description changes (S5).

#### Scenario: Counts with consumers

- GIVEN 3 TypeScript references, 1 own-template usage and 2 consumer usages
- WHEN `find_references` runs
- THEN `reference_count` is 3, `template_reference_count` is 3, and `total` is 6

#### Scenario: Format parity

- GIVEN the same request in JSON and TOON
- WHEN both are decoded
- THEN consumer usages, `origin` values, kinds, `template_coverage`, and `template_reference_count` are identical

### Requirement: Template evidence stays out of impact analysis [S1]

Template and consumer usages MUST NOT enter `ast_get_impact` or `ast_find_test_candidates` evidence, edges or coverage.

#### Scenario: Impact unchanged

- GIVEN a member with consumer template usages
- WHEN `ast_get_impact` and `ast_find_test_candidates` run
- THEN their output is identical to the previous behavior

### Requirement: Diagnostics remain TypeScript-only [S1]

(Unchanged in substance, restated.) Edit-aware diagnostic delta MUST remain TypeScript-only, including after consumer-template rewrites. Template type checking of rename plans is out of scope. Tool descriptions and docs MUST state that template errors are not detected.

#### Scenario: Consumer breakage not diagnosed

- GIVEN a rename that rewrites a consumer binding incorrectly
- WHEN diagnostics delta is evaluated
- THEN no template diagnostic is produced and the limitation is stated

#### Scenario: find_references tool description before S5

- GIVEN S1 to S4
- WHEN the `ast_find_references` description is read
- THEN it is unchanged from the current declared string

### Requirement: Docs and skill state the cross-component contract [S5]

The structural-code-editing skill and operation docs MUST describe consumer usages, the meaning of `completed` for cross-component (templates inside the Project only), the constructs that stay `unfinished` (`setInput`, router input binding, `createComponent`, `hostDirectives`, directive inputs/outputs, consumers outside the Project), and the pipe and `transform` rules.

#### Scenario: Skill text

- GIVEN the skill and operations reference after S5
- WHEN they are read
- THEN each listed limitation and the follow-up issue for template type checking are stated

## REMOVED Requirements

### Requirement: Cross-component usages are reported as unfinished

(Superseded by "Cross-component usages are reported" above; the #407 stopgap behavior remains only for constructs not yet supported by the delivering slice.)
