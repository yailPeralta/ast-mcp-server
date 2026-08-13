# Proposal: Improve Agent Setup

## Intent

Make `ast-tool setup` safely discover and configure the supported CLI agents through a clear interactive flow and deterministic automation. Expand support without weakening the existing fail-closed preflight, confirmation, JSON output, or explicit-ID guarantees.

## Scope

### In Scope

- Support Claude Code, Hermes, OpenCode, Codex CLI, Gemini CLI, and GitHub Copilot CLI.
- Show native checkboxes in registry order; detected compatible clients start selected, unavailable or incompatible clients are disabled with reasons, and Space toggles enabled choices.
- Resolve `--agents all` after detection to every detected client; any compatibility failure aborts before writes. Keep explicit IDs strict for unavailable or incompatible clients.
- Honor `OPENCODE_CONFIG`, then `OPENCODE_CONFIG_DIR/opencode.json`, then the standard OpenCode config. Require tested OpenCode 1.18.18+ contracts and fail closed on older, unparseable, or unknown outputs.
- Preserve confirmation/cancellation, non-interactive `--agents ... --yes`, stable JSON, bounded command execution, preflight-before-mutation, verification, and convergent retry reporting.

### Out of Scope

- Cursor, Windsurf, Cline, and other editor-integrated clients.
- Transactional rollback across independent client tools or generalized direct mutation of every client config.

## Capabilities

### New Capabilities

- `setup-agent-support`: Six-client detection, compatibility, selection, preflight, registration, skill placement, verification, diagnostics, and automation semantics.

### Modified Capabilities

- None; no existing canonical specs are present.

## Approach

Use versioned registry adapters plus explicit, physically deduplicated skill destination plans. Keep public CLI registration for all clients except OpenCode, whose CLI ignores custom routing; update its selected JSON/JSONC config atomically and verify resolved config and connection under the same environment. Prefer this bounded exception over generalized config mutation to reduce schema coupling.

## Affected Areas

| Area                                                                        | Impact   | Description                                                     |
| --------------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `src/services/agent-targets.ts`, `src/services/agent-setup.ts`              | Modified | Six adapters, compatibility, detected-`all`, safe orchestration |
| `src/services/skill-installer.ts`                                           | Modified | Explicit shared-destination planning and deduplication          |
| `src/services/setup-wizard.ts`, `src/cli.ts`                                | Modified | Native checkbox UI and CLI contract                             |
| `test/`, `scripts/`                                                         | Modified | Contract fixtures, matrices, smoke coverage                     |
| `README.md`, `CHANGELOG.md`, `docs/adr/0001-secure-yarn-and-agent-setup.md` | Modified | Support policy and OpenCode exception                           |

## Risks

| Risk                                                | Likelihood | Mitigation                                                           |
| --------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| Volatile client outputs cause unsafe classification | High       | Versioned fixtures and fail-closed diagnostics                       |
| OpenCode JSONC update loses unrelated data          | Medium     | Bounded atomic no-clobber update plus resolved verification          |
| Raw terminal state leaks                            | Medium     | Central cleanup across completion, cancellation, errors, and signals |
| Change exceeds 800 review lines                     | High       | Forecast and request sliced delivery before apply                    |

## Rollback Plan

Revert adapters, checkbox controller, and destination planner together; restore the two-client registry and prior `all` parsing. Existing user configurations and skills remain untouched.

## Dependencies

- Capture installed Gemini and Copilot help/version/add/get/list fixtures before admitting their output contracts.

## Success Criteria

- [x] All six CLI clients satisfy tested detection, selection, preflight, setup, verification, idempotency, and JSON scenarios.
- [x] OpenCode custom routing and 1.18.18 minimum fail closed without unintended writes.
- [x] Interactive Space toggling and terminal cleanup pass; editor clients remain unsupported.
