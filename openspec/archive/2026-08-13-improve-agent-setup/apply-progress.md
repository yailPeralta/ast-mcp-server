# Apply Progress: Improve Agent Setup

## Status

- Mode: Strict TDD
- Delivery: single approved `size:exception`
- Work unit: `full-approved-size-exception`
- Correction work unit: `critical-review-fixes-unmanaged` (`disabled/unmanaged`, <=200 changed lines)
- Final remediation work unit: `remediate-process-test-race-unmanaged` (`disabled/unmanaged`, <=40 changed lines)
- Completed: 18/18 tasks
- All tasks complete: Yes

## Completed Tasks

- [x] 1.1–1.4 Fixture admission and six-client adapter registry
- [x] 2.1–2.4 Post-detection selection and native raw-TTY checkbox flow
- [x] 3.1–3.4 Physical skill planning and routed OpenCode JSONC updates
- [x] 4.1–4.2 Safe orchestration, bounded reporting, and retry evidence
- [x] 5.1–5.4 Release smokes, documentation, and verification mapping

## TDD Cycle Evidence

| Tasks   | Test files                                                           | Layer            | Safety net                                         | RED                                                                                    | GREEN                                          | TRIANGULATE                                                                   | REFACTOR                  |
| ------- | -------------------------------------------------------------------- | ---------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------- |
| 1.1–1.4 | `test/agent-fixture-admission.test.ts`, `test/agent-targets.test.ts` | Unit/contract    | 20/20 baseline tests passed                        | `yarn vitest run ...`: 2 files failed; missing fixture module plus 4 registry failures | 8/8 passed                                     | Normalization/secret/drift and compatible/incompatible/trust/structured cases | 8/8 remained green        |
| 2.1–2.4 | `test/setup-wizard.test.ts`, `test/raw-tty.test.ts`                  | Unit/integration | 20/20 baseline tests passed                        | 2 files failed; missing TTY modules plus 3 selection failures                          | 10/10 passed                                   | Enabled/disabled toggle, empty/non-empty submit, four cleanup exits           | 10/10 remained green      |
| 3.1–3.4 | `test/skill-installer.test.ts`, `test/opencode-config.test.ts`       | Unit/integration | 5/5 existing skill tests passed                    | 2 files failed; missing OpenCode module and 2 physical-plan failures                   | 10/10 passed                                   | Shared/aliased paths, preservation/conflict/race/routing                      | 10/10 remained green      |
| 4.1–4.2 | `test/agent-setup.test.ts`                                           | Integration      | 5/5 existing setup tests passed                    | 3 failures for compatibility, physical outcomes, and stable result contract            | 7/7 passed                                     | Detection, idempotency, conflicts, force, unavailable/incompatible, redaction | 7/7 remained green        |
| 5.1–5.4 | `scripts/cli-smoke.mjs`, `scripts/package-smoke.mjs`                 | Built runtime    | Existing two-client smoke was green before changes | Six-client CLI smoke failed on outdated two-client/skill expectation                   | CLI and package smokes passed with six clients | First run + replay, physical shared skill, packed consumer                    | Full gates remained green |

### Post-Apply Correction TDD Evidence

| Defect                           | Test file                              | Layer        | Safety net                  | RED                                                           | GREEN                  | TRIANGULATE                                                          | REFACTOR                                              |
| -------------------------------- | -------------------------------------- | ------------ | --------------------------- | ------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| Fixture command secret admission | `test/agent-fixture-admission.test.ts` | Unit         | 2/2 baseline                | Token-like command argument was admitted                      | 3/3 passed             | Output-secret case plus command-argument case                        | Full persisted input scanned without value disclosure |
| Copilot add syntax               | `test/agent-targets.test.ts`           | Unit/runtime | 6/6 baseline                | Expected separator argv received unsupported flags            | 7/7 passed             | Exact adapter argv plus CLI/package runtime fixture enforcement      | Fake contract tightened                               |
| Effective OpenCode conflict      | `test/agent-setup.test.ts`             | Integration  | 13/13 target/setup baseline | Conflict surfaced only after mutation as verification failure | 8/8 setup tests passed | Both routing variables set; config and skill remain absent/unchanged | Effective evidence checked before writes              |
| Synchronous TTY render failure   | `test/raw-tty.test.ts`                 | Unit         | 6/6 baseline                | Raw mode remained enabled after write throw                   | 7/7 passed             | Existing four cleanup exits plus synchronous render failure          | Cleanup shared by setup and data-render failures      |
| Malformed JSONC                  | `test/opencode-config.test.ts`         | Unit         | 3/3 baseline                | Partial parse produced an edit                                | 4/4 passed             | Existing valid JSONC plus malformed input                            | Parse errors collected before modify                  |

## Work Unit Evidence

| Unit                 | Focused test command and exact result                                                                               | Runtime harness and exact result                                                                                                                | Rollback boundary                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Adapters             | `yarn vitest run test/agent-targets.test.ts test/agent-fixture-admission.test.ts` → exit 0, 2 files/10 tests passed | `node scripts/admit-agent-fixtures.mjs --check` → exit 0, `checked: 2`                                                                          | Adapter registry, fixture admission scripts, and `test/fixtures/agent-targets/**` |
| TTY                  | `yarn vitest run test/setup-wizard.test.ts test/raw-tty.test.ts` → exit 0, 2 files/11 tests passed                  | `yarn test:cli` exercises non-interactive runtime; raw TTY itself uses deterministic EventEmitter harness → 6-client smoke passed               | `setup-wizard.ts`, `checkbox-state.ts`, `raw-tty.ts`, and CLI setup wiring        |
| Planning             | `yarn vitest run test/skill-installer.test.ts test/opencode-config.test.ts` → exit 0, 2 files/10 tests passed       | `yarn test:cli` routed OpenCode fixture and shared skill path passed                                                                            | `skill-installer.ts`, `opencode-config.ts`, `jsonc-parser` dependency             |
| Orchestration        | `yarn vitest run test/agent-setup.test.ts` → exit 0, 1 file/8 tests passed                                          | `yarn test:cli` first run/replay passed with all six agents                                                                                     | `agent-setup.ts`, adapter orchestration, stable setup result fields               |
| Release              | `yarn test` → exit 0, 47 files/576 tests passed                                                                     | `yarn test:mcp`, `test:lifecycle`, `test:cli`, `test:errors`, `test:package` → all exit 0; package reports 6 installed and 6 idempotent targets | Fake-agent matrix, package/CLI smokes, README, changelog, ADR                     |
| Critical corrections | Focused suites → exit 0: adapters/fixtures 2 files/10 tests; OpenCode/setup 2/12; TTY/wizard 2/11                   | Fixture gate checked 2; CLI/package smokes passed with 6 installed and 6 idempotent targets                                                     | Revert only the eleven correction source/test files listed below                  |

## Final Verification

| Command                    | Exact result                                            |
| -------------------------- | ------------------------------------------------------- |
| `yarn format:check`        | Exit 0; all matched files formatted                     |
| `yarn lint`                | Exit 0; no findings                                     |
| `yarn typecheck`           | Exit 0                                                  |
| `yarn test`                | Exit 0; 47 files, 575 tests passed                      |
| `yarn build`               | Exit 0                                                  |
| `yarn test:mcp`            | Exit 0; 15 tools, stdio smoke passed                    |
| `yarn test:lifecycle`      | Exit 0; lifecycle/signal matrix passed                  |
| `yarn test:cli`            | Exit 0; six-client setup and replay passed              |
| `yarn test:errors`         | Exit 0; bounded error smoke passed                      |
| `yarn test:package`        | Exit 0; packed setup installed 6 and replayed 6 targets |
| `yarn test:agent-fixtures` | Exit 0; 2 admitted fixtures checked                     |

## Post-Apply Correction Details

- Fixture admission scans the complete serialized candidate, including command arguments, and emits only a fixed rejection message.
- Copilot registration now uses `copilot mcp add ast -- <node> <entry>`; the runtime fixture exits 2 for legacy `--command/--args`.
- OpenCode invokes and parses same-environment `debug config --pure` before any skill/config write, rejecting conflicting effective `mcp.ast` even when both routing variables are set.
- Raw TTY setup and render writes share idempotent cleanup on synchronous exceptions.
- JSONC planning collects `jsonc-parser` parse errors and rejects malformed partial values before `modify`.
- Rollback boundary: `scripts/lib/agent-fixtures.mjs`, `scripts/fixtures/fake-agent.mjs`, `src/services/{agent-setup,agent-targets,opencode-config,raw-tty}.ts`, and their five focused test files.

## Requirement and Scenario Mapping

| Requirement/scenario                                             | Evidence                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Detection and compatibility / Mixed detection                    | `agent-targets.test.ts`, `agent-setup.test.ts`; ordered six-client classifications              |
| Deterministic selection / Detected all / Strict explicit request | `setup-wizard.test.ts`; post-detection all and strict unusable rejection                        |
| Native checkbox / Keyboard state / Cleanup                       | `raw-tty.test.ts`; focus/toggle/submit plus cancellation/error/signal cleanup                   |
| Safe client MCP setup / Register and verify / Preflight conflict | `agent-targets.test.ts`, `agent-setup.test.ts`, six-client CLI/package smokes                   |
| OpenCode routing / Routed JSONC                                  | `opencode-config.test.ts`, CLI smoke; precedence, preservation, mode, race, same environment    |
| Shared skill planning / Deduplicated path                        | `skill-installer.test.ts`; one physical write and four logical outcomes                         |
| Stable bounded reporting / Bounded failure                       | `agent-setup.test.ts`, CLI/error smokes; version, correlation, redaction, finite process bounds |
| Idempotency and partial retry / Partial retry                    | `agent-setup.test.ts`, CLI/package first-run/replay matrices                                    |

## Changed Paths

- `src/services/agent-targets.ts`, `agent-setup.ts`, `setup-wizard.ts`, `skill-installer.ts`
- `src/services/checkbox-state.ts`, `raw-tty.ts`, `opencode-config.ts`, `src/cli.ts`
- `scripts/admit-agent-fixtures.mjs`, `scripts/lib/agent-fixtures.*`, `scripts/fixtures/fake-agent.mjs`
- `test/agent-*.test.ts`, `test/setup-wizard.test.ts`, `test/raw-tty.test.ts`, `test/skill-installer.test.ts`, `test/opencode-config.test.ts`, fixture JSON
- `scripts/cli-smoke.mjs`, `scripts/package-smoke.mjs`
- `package.json`, `yarn.lock`, `README.md`, `CHANGELOG.md`, setup ADR

## Deviations and Residual Risks

- Adapter contracts remain centralized in `agent-targets.ts` rather than one source file per adapter; the registry still presents six isolated adapter objects behind the designed interface.
- Gemini and Copilot binaries were unavailable locally. Admitted fixtures are normalized contract fixtures derived from official documented commands; parsers fail closed on unknown output. A release candidate should recapture both fixtures against installed target versions before publication.
- `size:exception` was explicitly approved; review load remains high despite staying below the authorized 3,600-line ceiling.

## Final Unmanaged Remediation

- Remediates evidence revision: `sha256:df75a6c68d047ef417c74e13db3ac725a1325af21d2ff1067ffcdaf6d1755e9b`.
- Root cause: the process-group test read `grandchild.pid` immediately after the timed command returned, racing delayed readiness evidence under full-suite load; production timeout behavior was not implicated.
- Correction: `readPidWhenReady` retries only `ENOENT` until a finite deadline, preserves all other failures, and reports the unreadable path and deadline. Production code is unchanged.

### Remediation TDD Cycle Evidence

| Task                                  | Test file                               | Layer       | Safety net                        | RED                                                                                 | GREEN                                                | TRIANGULATE                                                  | REFACTOR                                                 |
| ------------------------------------- | --------------------------------------- | ----------- | --------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| Stabilize process readiness assertion | `test/release-candidate-matrix.test.ts` | Integration | Isolated original test passed 1/1 | Delayed-ready and never-ready cases failed because `readPidWhenReady` did not exist | Focused cases passed 2/2; complete file passed 23/23 | Delayed creation succeeds; missing file times out actionably | Helper remains test-local; production behavior unchanged |

### Remediation Work Unit Evidence

| Evidence           | Exact result                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused repetition | Process readiness and process-group tests passed 25/25 invocations, 50/50 selected tests                                                                                                                                      |
| Runtime harness    | `yarn test` exactly once after correction → exit 0, 47 files/576 tests passed                                                                                                                                                 |
| Quality gates      | `yarn build`, `yarn lint`, and `yarn typecheck` exited 0; final format check is blocked only by the pre-existing admitted `verify-report.md`, which policy forbids rewriting; touched artifacts pass targeted Prettier checks |
| Rollback boundary  | Revert only `readPidWhenReady`, its two-case test, and its use in `test/release-candidate-matrix.test.ts`                                                                                                                     |

These facts supersede the stale failed runtime snapshot in `verify-report.md` for archive final-state handoff. The admitted FAIL verify report remains unchanged by policy.

Residual remediation risk: the repository-wide format check remains non-zero solely because the admitted FAIL `verify-report.md` is not Prettier-formatted and cannot be overwritten in this remediation.
