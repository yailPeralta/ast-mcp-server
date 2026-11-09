# Angular Template Rename Specification (delta)

## MODIFIED Requirements

### Requirement: Rename reports template diagnostics

`rename_symbol` prepare MUST add the optional `template_diagnostics` object defined by `angular-template-type-check` whenever the plan edits Angular templates, and MUST NOT otherwise change the prepared-operation shape. The existing `diagnostics` field MUST remain TypeScript-only. The `rename_symbol` description MUST state that template writes occur, that diagnostics in `diagnostics` are TypeScript-only, and that template diagnostics are reported separately in `template_diagnostics` with a typed status, and MUST NOT claim that template errors are never diagnosed. The description MUST NOT be changed outside `declared-tool-contracts`. Apply MUST remain unchanged: it does not run the template check.

(Replaces "Rename states TypeScript-only diagnostics".)

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
