# Tasks: Improve Agent Setup

## Review Workload Forecast

| Field                   | Value                |
| ----------------------- | -------------------- |
| Estimated lines         | 2,800–3,600          |
| Budget                  | 800 lines            |
| 800-line budget risk    | High                 |
| Chained PRs recommended | Yes (forecast)       |
| Split                   | PR 1 → 2 → 3 → 4 → 5 |
| Delivery strategy       | approved size exception |
| Chain strategy          | not used             |

Decision before apply: resolved by explicit approval of one `size:exception` delivery
Chained PRs recommended: Yes (historical forecast)
Chain strategy: not used
400-line budget risk: High

### Suggested Work Units

| Unit | Goal          | Likely PR | Focused test command                                                              | Runtime harness                                 | Rollback boundary   |
| ---- | ------------- | --------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------- |
| 1    | Adapters      | PR 1      | `yarn vitest run test/agent-targets.test.ts test/agent-fixture-admission.test.ts` | `node scripts/admit-agent-fixtures.mjs --check` | Adapters/fixtures   |
| 2    | TTY           | PR 2      | `yarn vitest run test/setup-wizard.test.ts test/raw-tty.test.ts`                  | Fixture-TTY setup                               | Wizard/TTY/CLI      |
| 3    | Planning      | PR 3      | `yarn vitest run test/skill-installer.test.ts test/opencode-config.test.ts`       | Routed OpenCode fixture                         | Skills/JSONC        |
| 4    | Orchestration | PR 4      | `yarn vitest run test/agent-setup.test.ts`                                        | All-agent retry fixture                         | Setup/result schema |
| 5    | Release       | PR 5      | `yarn test:cli && yarn test:package`                                              | Release matrices                                | Smokes/docs         |

## Phase 1: Fixture Admission and Adapter Registry

- [x] 1.1 **RED:** Add `test/agent-fixture-admission.test.ts` for Gemini/Copilot capture, normalization, metadata, drift, and secrets.
- [x] 1.2 **GREEN:** Add fixture capture/normalize/admit scripts, `test/fixtures/agent-targets/**`, and package gates.
- [x] 1.3 **RED:** Expand `test/agent-targets.test.ts` for order, contracts, unknown evidence, Gemini trust/current-disconnected, and commands.
- [x] 1.4 **GREEN:** Refactor `src/services/agent-targets.ts`; create six `src/services/agent-target-adapters/*.ts` detect/inspect/mutate/verify adapters.

## Phase 2: Deterministic Selection and Native TTY

- [x] 2.1 **RED:** Extend `test/setup-wizard.test.ts` for detected `all`, deduplication, unusable IDs/no writes, and paired flags.
- [x] 2.2 **GREEN:** Update `src/services/setup-wizard.ts` and `src/cli.ts` with post-detection selection validation.
- [x] 2.3 **RED:** Add checkbox/raw-TTY tests for focus/toggle/submit and once-only cleanup on cancellation, errors, and signals.
- [x] 2.4 **GREEN:** Create `src/services/{checkbox-state,raw-tty}.ts` and wire ordered disabled-reason rendering through `setup-wizard.ts`.

## Phase 3: Skill and OpenCode Planning

- [x] 3.1 **RED:** Extend `test/skill-installer.test.ts` for paths, realpath deduplication, outcomes, conflicts, force, and races.
- [x] 3.2 **GREEN:** Refactor `src/services/skill-installer.ts` into preflighted physical plans and write-once reporting.
- [x] 3.3 **RED:** Add `test/opencode-config.test.ts` for 1.18.18+, routing, preservation, races, no CLI add, and environment reuse.
- [x] 3.4 **GREEN:** Create `src/services/opencode-config.ts`; add `jsonc-parser` to `package.json`/`yarn.lock` for atomic `mcp.ast` edits.

## Phase 4: Safe Orchestration and Reporting

- [x] 4.1 **RED:** Extend `test/agent-setup.test.ts` for preflight, registration, idempotency, bounds/redaction, JSON, partial completion, and retry.
- [x] 4.2 **GREEN:** Refactor `src/services/agent-setup.ts`/`src/cli.ts` for sequential adapters, trust/race failures, ordered outcomes, correlation, and retry reinspection.

## Phase 5: Release Evidence and Documentation

- [x] 5.1 **RED:** Extend CLI/package smoke expectations for six identities, spaces, bounds, JSON, idempotency, retry, and mixed versions.
- [x] 5.2 **GREEN:** Expand `scripts/fixtures/fake-agent.mjs` and matrices; fail closed on unknown mixed output.
- [x] 5.3 Update `README.md`, `CHANGELOG.md`, and the setup ADR with support, trust, routing, diagnostics, rollout, and rollback.
- [x] 5.4 Verify configured format, lint, typecheck, test, build, and smoke commands; map every requirement/scenario to evidence.
