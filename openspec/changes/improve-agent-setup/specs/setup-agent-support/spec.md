# Setup Agent Support Specification

## Requirements

### Requirement: Detection and compatibility

Setup MUST inspect (`claude`, `hermes`, `opencode`, `codex`, `gemini`, `copilot`) in order. Found clients MUST satisfy tested contracts; unknown evidence MUST be incompatible.

#### Scenario: Mixed detection

- GIVEN mixed client availability
- WHEN detection completes
- THEN each has the correct classification

### Requirement: Deterministic selection

`--agents all` MUST resolve post-detection to detected clients and fail before writes if any is incompatible. Explicit IDs MUST deduplicate in order and reject unknown, unavailable, or incompatible IDs. Automation MUST require both flags.

#### Scenario: Detected all

- GIVEN two compatible clients
- WHEN `--agents all --yes` runs
- THEN those clients are selected

#### Scenario: Strict explicit request

- GIVEN an explicit ID is unusable
- WHEN selection is validated
- THEN setup fails without writes

### Requirement: Native checkbox interaction

Interactive setup MUST show ordered clients, check compatible detections, and disable others with reasons. Up/Down MUST move focus; Space MUST toggle enabled choices; Enter MUST submit a non-empty choice. Escape, Ctrl-C, rejection, or empty submission MUST cancel without writes. Raw mode, listeners, and cursor MUST be restored once after any exit or signal.

#### Scenario: Keyboard state

- GIVEN enabled and disabled choices
- WHEN both are toggled and confirmed
- THEN only enabled state changes

#### Scenario: Cleanup

- GIVEN interaction is running
- WHEN cancellation, failure, or termination occurs
- THEN terminal state restores without writes

### Requirement: Safe client MCP setup

Setup MUST preflight artifacts, compatibility, registrations, and skill paths before writes. Conflict, unknown inspection, trust failure, or concurrent change MUST cause no writes. `ast` MUST use Node and packaged server path. Claude SHALL use scoped get/add; Hermes list/test/add; Codex/Copilot structured get/list JSON and add; Gemini connection-aware list and user-scoped add. Missing registrations MUST be verified; current ones MUST remain unchanged.

#### Scenario: Register and verify

- GIVEN a tested client contract reports `ast` missing
- WHEN registration succeeds
- THEN verification proves transport, command, arguments, and health

#### Scenario: Preflight conflict

- GIVEN any MCP or skill target conflicts
- WHEN global preflight runs
- THEN no MCP or skill path changes

### Requirement: OpenCode routing

OpenCode MUST require parseable version 1.18.18+ and tested outputs. Destination MUST be `OPENCODE_CONFIG`, else `OPENCODE_CONFIG_DIR/opencode.json`, else standard config. Setup MUST preflight merged configuration and atomically update that JSON/JSONC file without clobbering, preserving comments, unrelated data, and mode. It MUST NOT use `opencode mcp add`; verification MUST reuse the environment.

#### Scenario: Routed JSONC

- GIVEN routed, non-conflicting commented JSONC
- WHEN OpenCode setup completes
- THEN only `ast` changes and verifies connected

### Requirement: Shared skill planning

Setup MUST plan outcomes before writes, use client-specific paths for Claude/Hermes, and shared user `.agents/skills` for the other four. Identical paths MUST be written once but reported per client. Identical content MUST remain unchanged; differing content MUST block writes unless `--force-skill` authorizes only its replacement.

#### Scenario: Deduplicated path

- GIVEN four clients share one physical path
- WHEN skill setup succeeds
- THEN one write and four outcomes are reported

### Requirement: Stable bounded reporting

Machine mode MUST emit one versioned stable JSON value on stdout with ordered results, physical writes, and partial completion. Commands MUST have finite timeout/output limits. Diagnostics MUST identify client, operation, class, and actionable reason; captured output MUST exclude secrets and truncate at 4,000 characters.

#### Scenario: Bounded failure

- GIVEN a command times out or exceeds output limits
- WHEN setup handles it
- THEN it terminates and emits one bounded stable failure value

### Requirement: Idempotency and partial retry

Repeated setup MUST report current registrations and skills unchanged. After later-client failure, setup MUST retain successes, report completed/pending outcomes, and preflight retained work before retrying unresolved outcomes.

#### Scenario: Partial retry

- GIVEN one client completed before another failed
- WHEN setup retries after correction
- THEN completed work stays unchanged and pending work converges
