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

If template coverage is `unfinished` or `unsupported` (including `inherited_member`), rename MUST be blocked with `INCOMPLETE_EVIDENCE` and MUST NOT edit any file. Coverage `not_applicable` and `completed` MUST NOT block.

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

Rename in non-Angular projects (including projects with `.html` files and a fake `@Component` but no `@angular/core`) MUST behave identically to before the change.

#### Scenario: Plain TypeScript project

- GIVEN a non-Angular project
- WHEN rename runs
- THEN plans, hashes, and results are unchanged

### Requirement: Out-of-scope targets are not renamed

Pipe names, `#ref`/`let-` targets, child `@Input`/`@Output`, host bindings, and `styleUrls` MUST NOT be edited by this capability.

#### Scenario: Pipe name

- GIVEN a rename targeting a pipe name
- WHEN prepared
- THEN no template edit is planned for it

### Requirement: Rename states TypeScript-only diagnostics

The `rename_symbol` tool description MUST state that template writes occur and that post-apply diagnostics are TypeScript-only. The requirement is met by the declared contract for `ast_rename_symbol` (see `declared-tool-contracts`).

#### Scenario: Tool description

- GIVEN the tool inventory
- WHEN the `ast_rename_symbol` description is read
- THEN it is exactly: `Prepares an exact hash-bound rename plan without writing. Review the preview and apply its operation_id with ast_apply_operation. The plan also rewrites external Angular templates hash-bound to the workspace snapshot; diagnostics stay TypeScript-only.`
- AND this string is digest-sensitive: it MUST match the fixture declaration and the re-baselined inventory pins byte for byte
