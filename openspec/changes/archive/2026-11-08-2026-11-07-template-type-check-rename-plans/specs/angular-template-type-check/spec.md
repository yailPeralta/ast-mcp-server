# Angular Template Type Check Specification (delta)

## Purpose

Tell agents, at prepare time, whether a rename plan makes Angular template diagnostics worse, with an honest typed status. A check that did not run MUST never be reported as `completed`.

## ADDED Requirements

### Requirement: Typed template_diagnostics result

A rename plan that edits Angular templates MUST report an optional `template_diagnostics` object `{ status, reason?, added, removed, added_errors }`. `status` MUST be one of `completed`, `unavailable`, `unfinished`. The field MUST be absent when no check runs (see "Field absent when no check runs"). `added`, `removed` and `added_errors` MUST reuse the normalized diagnostic shape. `reason` MUST be present for `unavailable` and `unfinished` and absent otherwise. `reason` MUST be one of `compiler_cli_missing`, `compiler_unsupported`, `typescript_incompatible`, `work_exhausted`, `deadline`, `check_failed`. `status: completed` MUST mean that a before check and an after check both ran to the end over the whole scope. Any other outcome MUST NOT be reported as `completed`, and `added`, `removed` and `added_errors` MUST then be empty.

#### Scenario: Seeded template break is reported

- GIVEN an Angular project whose rename leaves a template binding that no longer type-checks
- WHEN the rename is prepared
- THEN `template_diagnostics.status` is `completed` and `added_errors` contains the new template error

#### Scenario: Clean rename

- GIVEN a rename whose templates type-check the same before and after
- WHEN the rename is prepared
- THEN `status` is `completed` and `added`, `removed` and `added_errors` are empty

#### Scenario: No empty completed on failure

- GIVEN the check cannot finish for any reason
- WHEN the rename is prepared
- THEN `status` is not `completed` and a typed `reason` is present

### Requirement: Typed unavailable and unfinished reasons

The check MUST map each failure to exactly one typed reason. `compiler_cli_missing`: `@angular/compiler-cli` does not resolve from the project (status `unavailable`). `compiler_unsupported`: the resolved major is outside 18 to 22, or its public `.` entry lacks `NgtscProgram` or `readConfiguration`, or `NgtscProgram.prototype.getNgSemanticDiagnostics` is not a function, or `program.compiler.getComponentsWithTemplateFile` is not a function (`unavailable`). `typescript_incompatible`: the `typescript` resolved from the project's `@angular/compiler-cli` package directory is outside the peer range of that compiler-cli (or no `typescript` resolves from that directory), or ngtsc throws its TypeScript version check ("The Angular Compiler requires TypeScript ...") (`unavailable`). `work_exhausted`: a scope or work bound is exceeded, or the worker ran out of V8 heap (exit signal `SIGABRT` or exit code 134) (`unfinished`). `deadline`: the deadline elapsed (`unfinished`). `check_failed`: the worker crashed or exited non-zero for any other reason, returned malformed output, or ngtsc threw any other error (`unfinished`). Renames with inline template usages are refused with `MUTATION_BLOCKED` by the existing rule before the check runs; the check never observes inline templates.

#### Scenario: Compiler-cli missing

- GIVEN an Angular project without `@angular/compiler-cli`
- WHEN the rename is prepared
- THEN `status` is `unavailable` with reason `compiler_cli_missing` and the rename plan is otherwise unchanged

#### Scenario: Unsupported major

- GIVEN a resolved `@angular/compiler-cli` of major 17 or 23
- WHEN the rename is prepared
- THEN `status` is `unavailable` with reason `compiler_unsupported`

#### Scenario: Required public API absent

- GIVEN a supported major whose `.` entry does not export `NgtscProgram` or `readConfiguration`, or whose `NgtscProgram` lacks `getNgSemanticDiagnostics`, or whose `program.compiler` lacks `getComponentsWithTemplateFile`
- WHEN the rename is prepared
- THEN `status` is `unavailable` with reason `compiler_unsupported` and no `private/*` subpath is imported

#### Scenario: TypeScript outside peer range

- GIVEN a compiler-cli whose peer range excludes the `typescript` resolved from its package directory
- WHEN the rename is prepared
- THEN `status` is `unavailable` with reason `typescript_incompatible`

#### Scenario: Work bound exceeded

- GIVEN a scope larger than the configured work bound
- WHEN the rename is prepared
- THEN `status` is `unfinished` with reason `work_exhausted`

#### Scenario: Worker failure

- GIVEN the worker crashes, exits non-zero or emits unparsable output
- WHEN the rename is prepared
- THEN `status` is `unfinished` with reason `check_failed` and prepare still returns

#### Scenario: Inline template usage is refused, not checked

- GIVEN a rename with a usage in an inline template
- WHEN the rename is prepared
- THEN it returns `MUTATION_BLOCKED` before the check runs and no worker is spawned

### Requirement: Field absent when no check runs

When the plan edits no Angular template (own or consumer), or the project is not Angular, `template_diagnostics` MUST be absent (there is no `not_applicable` status), and no compiler-cli resolution or worker MUST be started. Non-Angular output MUST be unchanged.

#### Scenario: Plan edits no template

- GIVEN a rename of a member with no template usages
- WHEN the rename is prepared
- THEN `template_diagnostics` is absent and no worker is spawned

#### Scenario: Non-Angular project

- GIVEN a project without Angular
- WHEN a rename is prepared
- THEN no worker is spawned and the plan, hash and result equal the previous behavior

### Requirement: Scope covers edited components only

The check MUST cover the own and consumer templates of the components whose templates the plan edits (scope B). It MUST NOT check templates of unedited components, whole-project templates, or external library templates. The scope MUST be derived from the plan's template edits and component set, not from a project scan.

#### Scenario: Consumer template in scope

- GIVEN a rename of a child `@Input` that rewrites a parent template
- WHEN the check runs
- THEN the parent's template diagnostics are included in the delta

#### Scenario: Unedited component excluded

- GIVEN a component with a pre-existing template error whose template the plan does not edit
- WHEN the check runs
- THEN that component's diagnostics are not part of the delta

#### Scenario: External library excluded

- GIVEN a template shipped inside a library under `node_modules`
- WHEN the check runs
- THEN it is not checked and not reported

### Requirement: Before and after delta matched by identity

The check MUST compute template diagnostics for the pre-rename state and for the post-rename state of the same scope, and MUST match them by diagnostic code, message and mapped position. A diagnostic present before and after at an equivalent mapped position MUST NOT appear in `added`. A diagnostic absent after MUST appear in `removed`. `added_errors` MUST be the error-category subset of `added`. Matching MUST NOT use counts. Positions in edited templates MUST be mapped through the plan's template edit hunks, and a diagnostic whose span touches an edited region MUST be treated as added (fail closed).

#### Scenario: Pre-existing error is not added

- GIVEN a template error present before the rename and unchanged after, at a shifted but mapped position
- WHEN the delta is computed
- THEN it is in neither `added` nor `removed`

#### Scenario: Same count, different error

- GIVEN one error removed and a different error introduced
- WHEN the delta is computed
- THEN the new one is in `added` and `added_errors`, and the old one is in `removed`

#### Scenario: Error touching an edit

- GIVEN a pre-existing error whose span overlaps a rewritten binding
- WHEN the delta is computed
- THEN the after-state diagnostic is treated as added

#### Scenario: Warnings do not populate added_errors

- GIVEN a new template diagnostic of warning category
- WHEN the delta is computed
- THEN it is in `added` and not in `added_errors`

### Requirement: Check is on by default and warns

For Angular renames that edit templates, the check MUST run by default without any input. By default a non-empty `added_errors` MUST NOT block the plan. The plan MUST remain applicable and the result MUST expose `template_diagnostics` as a warning.

#### Scenario: Default run

- GIVEN a rename that edits a template and no extra inputs
- WHEN it is prepared
- THEN the check runs and a worsened delta is reported without setting `blocked`

### Requirement: Opt-in blocking on a completed worsened delta

The prepare input MUST accept an optional boolean `block_on_template_errors`, default `false`. When `true`, the plan MUST be `blocked` with a `block_reason` naming template errors if and only if `template_diagnostics.status` is `completed` and `added_errors` is non-empty. When `status` is `unavailable` or `unfinished`, the plan MUST NOT be blocked by this input and the status MUST remain visible as a warning. `allow_new_errors=true` MUST waive this blocking as it waives TypeScript blocking. The meaning of `allow_new_errors` for TypeScript diagnostics MUST be unchanged, and the existing `diagnostics` field MUST remain TypeScript-only.

#### Scenario: Opt-in blocks a completed worsened delta

- GIVEN `block_on_template_errors=true` and a completed check with non-empty `added_errors`
- WHEN the rename is prepared
- THEN the plan is `blocked` and `block_reason` names template errors

#### Scenario: Opt-in does not fail closed

- GIVEN `block_on_template_errors=true` and status `unfinished` with reason `deadline`
- WHEN the rename is prepared
- THEN the plan is not blocked by template diagnostics and the `unfinished` status is reported

#### Scenario: Opt-in with clean completed delta

- GIVEN `block_on_template_errors=true` and a completed check with empty `added_errors`
- WHEN the rename is prepared
- THEN the plan is not blocked by this input

#### Scenario: allow_new_errors waives template blocking

- GIVEN `block_on_template_errors=true`, `allow_new_errors=true` and a completed worsened delta
- WHEN the rename is prepared
- THEN the plan is not blocked and `added_errors` is still reported

#### Scenario: allow_new_errors alone does not enable the check blocking

- GIVEN `block_on_template_errors` unset and a TypeScript error added
- WHEN `allow_new_errors` is false
- THEN blocking follows the TypeScript delta only, exactly as before

### Requirement: Supervised worker with an enforced deadline

The check MUST run in a supervised child process or worker separate from the server process, using its own TypeScript program and an in-memory overlay host that serves the post-rename TypeScript and template text. The worker MUST be killed when the deadline elapses, and prepare MUST then return `unfinished` with reason `deadline` within the deadline plus a bounded grace period, without stalling the server or requests for other projects; same-project operations queue behind the check in the per-project lock. The worker MUST also be terminated when the request is cancelled. While the server process is alive, no worker process MUST outlive its prepare (after a parent SIGKILL the child exits when ngtsc returns).

#### Scenario: Deadline kills the worker

- GIVEN a check that runs longer than the deadline
- WHEN the rename is prepared
- THEN the worker is killed, `status` is `unfinished` with reason `deadline`, and prepare returns within the deadline plus grace

#### Scenario: Cancellation

- GIVEN the request is cancelled while the worker runs and the server process is alive
- WHEN cancellation is observed
- THEN the worker is terminated and no process remains

#### Scenario: Server stays responsive

- GIVEN a long-running check
- WHEN a request for a different project arrives
- THEN it is served without waiting for the check, while same-project operations queue behind it

### Requirement: Project-resolved compiler-cli, nothing bundled

`@angular/compiler-cli` MUST be resolved from the project the way the project's `@angular/compiler` is resolved (through the tsconfig directory, realpath under an ancestor `node_modules`). Only the package's public `.` entry MAY be used. The package MUST NOT be bundled or added as a dependency of this server, and `private/*` subpaths MUST NOT be used.

#### Scenario: Resolved from project

- GIVEN two projects with different compiler-cli majors
- WHEN each is prepared
- THEN each uses its own project's compiler-cli

### Requirement: Check writes no files

Preparing the check MUST NOT write, create or modify any file in the workspace or its `node_modules`. The overlay MUST be in memory. Rollback, `affected_files` and receipt hashes MUST be unaffected by the check.

#### Scenario: Workspace unchanged

- GIVEN a prepare with the check enabled
- WHEN it completes, with any status
- THEN the workspace hash is identical to before prepare and no file was created

### Requirement: Spike gate is a stop criterion, not product behavior

Before the loader, worker and wiring are delivered, a spike MUST show on majors 18 to 22 with real `@angular/core` and `@angular/compiler-cli`: the public API (`NgtscProgram` and `readConfiguration` from `.`, with template diagnostics reachable through the public `NgtscProgram#getNgSemanticDiagnostics()` and scope mapping through `program.compiler.getComponentsWithTemplateFile`), that an in-memory overlay host detects a seeded template error after a rename, that every major/TypeScript pair works or yields `typescript_incompatible`, and that on a generated 100-component / 300-template fixture the added prepare latency is p95 <= 10 s and worker RSS <= 1 GiB. If any gate fails, the change MUST shrink to documenting the limitation and the product requirements above MUST NOT ship. This requirement is a delivery constraint recorded here for traceability; it is not verified at runtime. Status: satisfied by `docs/spikes/0421-template-type-check.md` (PR #431), verdict "proceed", every gate PASS on majors 18 to 22.

#### Scenario: Spike fails

- GIVEN the spike misses the latency or memory ceiling
- WHEN the gate is evaluated
- THEN loader, worker and wiring are not delivered and only the limitation is documented
