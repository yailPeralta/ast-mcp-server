# Angular Template Rename Specification (delta)

## MODIFIED Requirements

### Requirement: Incomplete or unsupported coverage blocks rename [S1]

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

### Requirement: Out-of-scope targets are not renamed [S3]

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

## ADDED Requirements

### Requirement: Cross-component rewrite with per-usage newText [S4]

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

### Requirement: Inline consumer template blocks rename [S4]

If a selector-bound member has a usage in an inline consumer template, rename MUST return `MUTATION_BLOCKED` and MUST NOT edit any file.

#### Scenario: Inline consumer present

- GIVEN a child `@Input() x` used by a consumer with an inline `template:`
- WHEN rename is prepared in S4 or later
- THEN it returns `MUTATION_BLOCKED` and zero edits are planned

### Requirement: Consumer new-name collisions block rename [S4]

If the new name, or `<newName>Change` for `model()`, is in the template-local scope at any consumer usage where the rewrite would change meaning, or is `$any`, the whole rename MUST be blocked with `MUTATION_BLOCKED`. A new name that duplicates another input, output or alias of the same declaring directive, or of another directive matched on the same consumer element, MUST be blocked with `MUTATION_BLOCKED`.

#### Scenario: New name equals another input

- GIVEN a child with `@Input() x` and `@Input() y`
- WHEN rename `x` to `y` is prepared
- THEN it returns `MUTATION_BLOCKED`

#### Scenario: model() change name collides

- GIVEN `x = model()` and an existing `vChange` output
- WHEN rename `x` to `v` is prepared
- THEN it returns `MUTATION_BLOCKED`

### Requirement: Unsupported cross-component rename constructs stay blocked [S4]

Rename of a selector-bound member MUST remain `INCOMPLETE_EVIDENCE` when coverage is not `completed`, when `hostDirectives` references the declaring directive, when the member is on a `@Directive`, or when a runtime binding is detectable. `completed` is limited to template evidence in the Project; the post-apply diagnostics remain TypeScript-only, so docs MUST direct users to run the project's build or tests.

#### Scenario: Opaque scope blocks rename

- GIVEN a consumer scope with a non-literal `imports`
- WHEN rename of a child input is prepared
- THEN it returns `INCOMPLETE_EVIDENCE`

#### Scenario: hostDirectives blocks rename

- GIVEN a component using the declaring directive in `hostDirectives`
- WHEN rename of its input is prepared
- THEN it returns `INCOMPLETE_EVIDENCE`

### Requirement: Rename states TypeScript-only diagnostics [S5]

The `rename_symbol` description MUST continue to state that template writes occur and that diagnostics are TypeScript-only, and from S5 MAY be re-baselined to mention consumer templates. Any change MUST follow `declared-tool-contracts`.

#### Scenario: Tool description before S5

- GIVEN S1 to S4
- WHEN the `ast_rename_symbol` description is read
- THEN it is unchanged from the current declared string

### Requirement: Non-Angular rename unchanged [S1]

Rename in non-Angular projects MUST behave identically to before the change.

#### Scenario: Plain TypeScript project

- GIVEN a non-Angular project
- WHEN rename runs
- THEN plans, hashes, and results are unchanged
