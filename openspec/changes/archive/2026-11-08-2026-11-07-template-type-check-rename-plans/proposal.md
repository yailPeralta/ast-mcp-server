# Proposal: Template type checking for rename plans

Issue: #421. Follow-up of #408. Exploration: `explore.md` / Engram `sdd/2026-11-07-template-type-check-rename-plans/explore`.

## Intent

The rename plan rewrites `.html` templates (own and consumer, #408), but its diagnostics come only from TypeScript. A rename that breaks a template binding is reported as clean. Agents need to know when a plan makes template diagnostics worse. The answer must be honest: never report `completed` for a check that did not run.

## Scope

### In Scope

- A gating spike on majors 18–22 with real `@angular/core` and `@angular/compiler-cli`.
- Resolving `compiler-cli` from the project, the way `loadCompiler` does. Nothing is bundled.
- Running ngtsc in a supervised child process that is killed at the deadline. It uses a separate TS program and an in-memory overlay host.
- Scope B: the own and consumer templates of the edited components. They are checked before and after the rename, and diagnostics are matched by code, message and mapped position.
- A new optional `template_diagnostics {status, reason?, added, removed, added_errors}`, included in the plan hash. Typed reasons: `compiler_cli_missing`, `compiler_unsupported`, `typescript_incompatible`, `work_exhausted`, `deadline`, `check_failed`.
- Warning by default, with blocking only on an explicit opt-in.
- Re-baselining the tool descriptions, `declared-tool-contracts.json`, specs, README, skill and CHANGELOG.

### Out of Scope

- External library templates and whole-project template checks.
- Inline consumer templates: refused with MUTATION_BLOCKED by the existing rule; never checked.
- `@angular/language-service`. Changing `diagnostics` or the meaning of `allow_new_errors`.

## Capabilities

### New Capabilities

- `angular-template-type-check`: compiler-cli loading, the worker, the scope B diff, typed statuses and the opt-in blocking.

### Modified Capabilities

- `angular-template-rename`: rename plans report `template_diagnostics`.
- `edit-aware-diagnostic-delta`: the plan hash includes the template delta.
- `declared-tool-contracts`: `rename_symbol` and `find_references` drop the "TypeScript-only" wording.

## Approach

Use exploration approach 2. Add one optional input, `block_on_template_errors` (default `false`), which blocks only when status is `completed` and `added_errors` is non-empty. `allow_new_errors` still waives all blocking.

A dedicated flag keeps the meaning of `allow_new_errors` unchanged. It also keeps false positives (version skew, partial analysis) from blocking valid renames by default.

## Spike gate (PR 1, stop criteria)

The spike passes only if all of these hold:

- **Public API.** For each supported major, the `.` entry exposes `NgtscProgram` and `readConfiguration`. Template diagnostics come from the public `NgtscProgram#getNgSemanticDiagnostics()`, and scope mapping from `program.compiler.getComponentsWithTemplateFile`. `private/*` is not used. (Corrected after the spike, PR #431: `getTemplateTypeChecker` is not an export of `.`.)
- **Overlay host.** An in-memory overlay host detects a seeded template error after a rename.
- **TS peer matrix.** Every major/TS combination either works or yields `typescript_incompatible`.
- **Timing.** On a generated fixture of 100 components and 300 templates, the added prepare latency is at p95 ≤ 10 s and the worker uses ≤ 1 GiB RSS.

If the spike fails, the change shrinks to documenting the limitation: PRs 2a, 2b and 3 are dropped; PR 4 shrinks to the limitation doc.

## Slices (stacked to main, each ≤ 800 lines)

| PR  | Scope                                                          |
| --- | -------------------------------------------------------------- |
| 1   | Spike harness, per-major dev dependencies, findings            |
| 2a  | Resolution, preflight, protocol (~330, base main). Not wired.  |
| 2b  | Core, entry, supervisor (~490, on 2a). Read-only, not wired.   |
| 3   | `createPlan` wiring, diff, output field, hash, opt-in blocking |
| 4   | Docs and contract re-baseline. Closes #421.                    |

## Affected Areas

| Area                                                                         | Impact   |
| ---------------------------------------------------------------------------- | -------- |
| `src/services/angular-template-typecheck*.ts`                                | New      |
| `src/services/operations.ts`, `src/tools/operation-schema.ts`                | Modified |
| `src/tools/{rename_symbol,find_references}.ts`                               | Modified |
| `package.json` devDependencies, `test/fixtures/declared-tool-contracts.json` | Modified |

## Risks

| Risk                                                             | Likelihood | Mitigation                                    |
| ---------------------------------------------------------------- | ---------- | --------------------------------------------- |
| Narrow TS peer ranges lead to frequent `typescript_incompatible` | High       | Typed status. Documented.                     |
| Latency or memory per prepare                                    | Med        | Spike ceiling, worker kill, `deadline` status |
| False positives                                                  | Med        | Warning by default, positional matching       |
| Heavier CI matrix                                                | Med        | Measured in the spike                         |

## Rollback Plan

Revert the PRs in reverse order. The field and the flag are additive. Without PR 3, plans behave exactly as they do today.

## Success Criteria

- [ ] A seeded template-breaking rename reports `added_errors` with status `completed`.
- [ ] Every failure path reports a typed non-`completed` status.
- [ ] A prepare that hits its deadline returns `deadline` within the deadline.
- [ ] Non-Angular and default output are unchanged, apart from the added field.

## Decisions (accepted by the user on 2026-11-07)

1. **Default-on vs opt-in check.** Running the check on every Angular rename costs seconds. Keeping it off by default saves that cost, but agents may not ask for it. The proposal assumes **on by default**.
2. **Opt-in blocking when status ≠ `completed`.** The question is whether `block_on_template_errors` should also fail closed when the check could not run. The proposal assumes **no**: it warns only.
3. **Spike ceiling.** The proposal assumes ≤ 10 s p95 and ≤ 1 GiB.

## Proposal question round

The proposal was written by a subagent, so these questions were not asked. Assumptions to review:

1. The users are agents who run `rename_symbol` on Angular apps.
2. The priority is honesty over completeness.
3. No support for TS outside the compiler-cli peer range.
