# Angular Template Rename Specification

## Purpose

Rename component members across TypeScript and external `.html` templates under hash binding, or fail closed.

## Requirements

### Requirement: Hash-bound external template edits

`rename_symbol` prepare MUST include external `.html` edits for proven usages of the declaring component's member. Template usages MUST be collected before the TypeScript rename runs. Each `.html` file MUST be bound by its per-file hash and by the workspace hash. Apply MUST verify both and write only the planned bytes. The prepared-operation schema MUST NOT change: `.html` files appear in `affected_files` and `preview`, and `reference_count` includes template edits. Edits to one file MUST NOT overlap, and BOM and file mode MUST be preserved.

#### Scenario: Rename updates template

- GIVEN a member used in a component TS file and its external `.html`
- WHEN rename is prepared and applied
- THEN both files are updated, `affected_files` and the receipt list the `.html` file, and `reference_count` includes the template edits

#### Scenario: Stale html after prepare

- GIVEN the `.html` is edited after prepare
- WHEN apply runs
- THEN it returns `CONFLICT` and the external bytes remain

### Requirement: Rollback covers templates

A failure after an `.html` commit MUST roll back under the safe-apply invariants; unproved ownership MUST yield `AMBIGUOUS_APPLY`.

#### Scenario: TS commit fails after html

- GIVEN the `.html` committed and a later file conflicts
- WHEN apply continues
- THEN the `.html` is restored only if its exact postimage is owned

### Requirement: Inline templates block rename

If a member has usages in an inline template, rename MUST be blocked with `MUTATION_BLOCKED` and MUST NOT edit any file.

#### Scenario: Inline usage present

- GIVEN a member used in an inline template
- WHEN rename is prepared
- THEN it returns `MUTATION_BLOCKED` and zero edits are planned

### Requirement: Incomplete or unsupported coverage blocks rename

If template coverage is `unfinished` or `unsupported` (including `inherited_member`), rename MUST be blocked with `INCOMPLETE_EVIDENCE` and MUST NOT edit any file. Coverage `not_applicable` MUST NOT block. Coverage `completed` MUST NOT block a plain member. Coverage `completed` MUST NOT unblock a selector-bound member (`@Input`, `@Output`, `input()`, `input.required()`, `output()`, `model()`, `model.required()`): until S4, rename of such a member MUST return `INCOMPLETE_EVIDENCE` by an explicit cross-component block that is independent of the coverage status, and MUST NOT edit any file.

#### Scenario: Cross-component member blocked even when completed (S1)

- GIVEN a child `@Input() x` whose consumer scope is fully resolved so coverage is `completed`
- WHEN rename of `x` is prepared in S1 to S3
- THEN it returns `INCOMPLETE_EVIDENCE` and zero edits are planned

#### Scenario: Output and model blocked (S1)

- GIVEN `@Output() y` or `model()` member with `completed` coverage
- WHEN rename is prepared in S1 to S3
- THEN it returns `INCOMPLETE_EVIDENCE`

#### Scenario: Unresolvable template

- GIVEN a component whose template cannot be resolved or parsed
- WHEN rename is prepared
- THEN it returns `INCOMPLETE_EVIDENCE`

#### Scenario: Inherited member

- GIVEN a derived component using a member inherited from a base class
- WHEN rename of that member is prepared
- THEN it returns `INCOMPLETE_EVIDENCE` because coverage is `unsupported`

#### Scenario: Compiler missing

- GIVEN Angular core is present and the compiler is missing
- WHEN rename is prepared
- THEN it returns `INCOMPLETE_EVIDENCE`

#### Scenario: Plain member with completed coverage

- GIVEN a plain component member with `completed` coverage
- WHEN rename is prepared
- THEN it is not blocked by this requirement

### Requirement: New-name collisions block rename

If `newName` is in the template-local scope at any usage, or is `$any`, the whole rename MUST be blocked with `MUTATION_BLOCKED` and no edits planned.

#### Scenario: New name collides with a template local

- GIVEN one usage of the member sits inside `@for (row of rows; ...)` among many other proven usages, and `newName` is `row`
- WHEN rename is prepared
- THEN the entire rename returns `MUTATION_BLOCKED` and no edits are planned

#### Scenario: New name is $any

- GIVEN `newName` is `$any`
- WHEN rename is prepared
- THEN it returns `MUTATION_BLOCKED`

### Requirement: Non-Angular rename unchanged

Rename in non-Angular projects MUST behave identically to before the change.

#### Scenario: Plain TypeScript project

- GIVEN a non-Angular project
- WHEN rename runs
- THEN plans, hashes, and results are unchanged

### Requirement: Out-of-scope targets are not renamed

Pipe names (the `name` property of `@Pipe`), the `transform` member of a pipe, `#ref`/`let-` targets, host bindings, and `styleUrls` MUST NOT be edited by this capability. From S4, child `@Input`/`@Output`/`model()` bindings are no longer out of scope when the fail-closed conditions hold (see below). Rename of the pipe class MUST NOT be blocked by this capability from S3, and MUST NOT plan any template edit for the class. Rename of `transform` MUST stay blocked with `INCOMPLETE_EVIDENCE`. A pipe `name` string MUST NOT be changed by renaming the class.

#### Scenario: Pipe class rename allowed (S3)

- GIVEN a `@Pipe({ name: 'fmt' }) class FmtPipe` with `| fmt` usages in templates
- WHEN rename of `FmtPipe` is prepared and applied
- THEN the TypeScript references are renamed, no template is edited, and `name: 'fmt'` and the `| fmt` usages are unchanged

#### Scenario: Pipe transform rename blocked (S3)

- GIVEN the same pipe
- WHEN rename of `transform` is prepared
- THEN it returns `INCOMPLETE_EVIDENCE` and zero edits are planned

#### Scenario: Pipe name

- GIVEN a rename targeting a pipe name
- WHEN prepared
- THEN no template edit is planned for it

#### Scenario: Pipe class before S3

- GIVEN the S1 or S2 build
- WHEN rename of a `@Pipe` class is prepared
- THEN it returns `INCOMPLETE_EVIDENCE`

### Requirement: Rename reports template diagnostics

`rename_symbol` prepare MUST add the optional `template_diagnostics` object defined by `angular-template-type-check` whenever the plan edits Angular templates, and MUST NOT otherwise change the prepared-operation shape. The existing `diagnostics` field MUST remain TypeScript-only. The `rename_symbol` description MUST state that template writes occur, that diagnostics in `diagnostics` are TypeScript-only, and that template diagnostics are reported separately in `template_diagnostics` with a typed status, and MUST NOT claim that template errors are never diagnosed. The description MUST NOT be changed outside `declared-tool-contracts`. Apply MUST remain unchanged: it does not run the template check.

#### Scenario: Prepare includes template_diagnostics

- GIVEN a rename that edits an external template
- WHEN it is prepared
- THEN the result carries `template_diagnostics` and `diagnostics` still covers TypeScript only

#### Scenario: Tool description before the contract change

- GIVEN the spike, loader, worker and wiring slices (PRs 1, 2a, 2b, 3) of this change
- WHEN the `ast_rename_symbol` description is read
- THEN it is unchanged from the current declared string

#### Scenario: Tool description after re-baseline

- GIVEN the docs slice of this change
- WHEN the `ast_rename_symbol` description is read
- THEN it states that template diagnostics are reported with a typed status and no longer says diagnostics are TypeScript-only without qualification
- AND it matches the fixture declaration and the three inventory pins byte for byte

### Requirement: Cross-component rewrite with per-usage newText

From S4, rename of a selector-bound member (`@Input`, `@Output`, `input()`, `input.required()`, `output()`, `model()`, `model.required()`) MUST be allowed only when coverage is `completed` and every consumer usage is in an external template. The plan MUST rewrite each consumer binding with a per-usage `newText` computed from the binding form, MUST preserve the surrounding syntax (`[`, `]`, `(`, `)`, `[(`, `)]`, `bind-`, `on-`), and MUST rewrite only the bound name span. For `model()`, the value binding (`[x]`, `[(x)]`) MUST be rewritten to the new name, and the output binding (`(xChange)`) MUST be rewritten to `<newName>Change`. When the member has a literal alias, the consumer binding uses the alias and the rename of the member MUST NOT rewrite alias-keyed bindings (an alias rename is a separate operation, blocked). Consumer files MUST be bound by per-file hash and by the workspace hash, apply is sequential with rollback under the safe-apply invariants, and the prepared-operation schema MUST NOT change.

#### Scenario: Input rename rewrites consumers

- GIVEN a child `@Input() x`, a parent template with `<app-child [x]="v" x2="a" />`, and completed coverage
- WHEN rename `x` to `y` is prepared and applied
- THEN the TypeScript declaration and references are renamed, the parent's `[x]` becomes `[y]`, and `affected_files` and the receipt list the parent's `.html`

#### Scenario: Two-way and event bindings

- GIVEN `<app-child [(x)]="v" />` and `(y)="h()"` for `@Output() y`
- WHEN each member is renamed
- THEN `[(x)]` becomes `[(newX)]` and `(y)` becomes `(newY)`

#### Scenario: model() maps to xChange

- GIVEN `x = model<string>()`, consumer `[(x)]` and `(xChange)`
- WHEN rename `x` to `v` is prepared
- THEN `[(x)]` becomes `[(v)]` and `(xChange)` becomes `(vChange)`

#### Scenario: Literal attribute binding

- GIVEN a consumer `x="lit"`
- WHEN `x` is renamed to `y`
- THEN the attribute becomes `y="lit"` and the value is unchanged

#### Scenario: Aliased member

- GIVEN `@Input('label') text` with consumers using `[label]`
- WHEN `text` is renamed
- THEN the `[label]` bindings are unchanged

#### Scenario: Stale consumer file

- GIVEN a consumer `.html` edited after prepare
- WHEN apply runs
- THEN it returns `CONFLICT` and the consumer bytes remain

#### Scenario: Rollback after consumer commit

- GIVEN a consumer `.html` committed and a later file conflicts
- WHEN apply continues
- THEN the consumer is restored only if its exact postimage is owned, otherwise `AMBIGUOUS_APPLY`

### Requirement: Inline consumer template blocks rename

If a selector-bound member has a usage in an inline consumer template, rename MUST return `MUTATION_BLOCKED` and MUST NOT edit any file.

#### Scenario: Inline consumer present

- GIVEN a child `@Input() x` used by a consumer with an inline `template:`
- WHEN rename is prepared in S4 or later
- THEN it returns `MUTATION_BLOCKED` and zero edits are planned

### Requirement: Consumer new-name collisions block rename

If the new name, or `<newName>Change` for `model()`, is in the template-local scope at any consumer usage where the rewrite would change meaning, or is `$any`, the whole rename MUST be blocked with `MUTATION_BLOCKED`. A new name that duplicates another input, output or alias of the same declaring directive, or of another directive matched on the same consumer element, MUST be blocked with `MUTATION_BLOCKED`.

#### Scenario: New name equals another input

- GIVEN a child with `@Input() x` and `@Input() y`
- WHEN rename `x` to `y` is prepared
- THEN it returns `MUTATION_BLOCKED`

#### Scenario: model() change name collides

- GIVEN `x = model()` and an existing `vChange` output
- WHEN rename `x` to `v` is prepared
- THEN it returns `MUTATION_BLOCKED`

### Requirement: Unsupported cross-component rename constructs stay blocked

Rename of a selector-bound member MUST remain `INCOMPLETE_EVIDENCE` when coverage is not `completed`, when `hostDirectives` references the declaring directive, when the member is on a `@Directive`, or when a runtime binding is detectable. `completed` is limited to template evidence in the Project. Post-apply diagnostics remain TypeScript-only; prepare-time `template_diagnostics` is a best-effort warning whose status may be non-`completed`, so docs MUST direct users to run the project's build or tests.

#### Scenario: Opaque scope blocks rename

- GIVEN a consumer scope with a non-literal `imports`
- WHEN rename of a child input is prepared
- THEN it returns `INCOMPLETE_EVIDENCE`

#### Scenario: hostDirectives blocks rename

- GIVEN a component using the declaring directive in `hostDirectives`
- WHEN rename of its input is prepared
- THEN it returns `INCOMPLETE_EVIDENCE`

#### Scenario: Docs direct users to build or tests

- GIVEN a rename whose `template_diagnostics` is `unavailable` or `unfinished`
- WHEN the operation docs are read
- THEN they direct users to run the project's build or tests
