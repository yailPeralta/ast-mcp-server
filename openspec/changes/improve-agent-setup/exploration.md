## Exploration: Improve agent setup UX and support

### Current State

`ast-tool setup` is registry-driven but supports only Claude Code and Hermes. It detects real executables from `PATH`, captures `--version` best-effort, preflights all selected MCP registrations and skill destinations, fails closed on conflicts, mutates through client CLIs, verifies registration, and emits stable JSON. Interactive selection is a static line-input flow; non-interactive setup requires `--agents` and `--yes`, and `all` currently expands to the complete registry before detection.

The first-delivery product scope is now closed: Claude Code, Hermes, OpenCode, Codex CLI, Gemini CLI, and GitHub Copilot CLI are supported; Cursor, Windsurf, Cline, and other editor-integrated clients are out of scope. `--agents all` changes to all detected supported clients. Explicit agent IDs remain strict: requesting an unavailable or incompatible client fails before writes.

Verified client evidence:

- **OpenCode 1.18.18 (installed and locally exercised):** `opencode mcp list` reports configured servers and connection status, while `opencode debug config` emits resolved JSON. Official configuration supports `OPENCODE_CONFIG` and `OPENCODE_CONFIG_DIR`. Local isolation proved that resolved configuration reads both custom sources, but `opencode mcp add` ignored both destinations and wrote `~/.config/opencode/opencode.json`; therefore that command cannot satisfy custom-routing safety. OpenCode discovers skills from native, Claude-compatible, and `.agents/skills` locations.
- **Codex CLI 0.144.0 (installed and locally exercised):** `codex mcp add ast -- <node> <entry>` writes user configuration; `codex mcp get ast --json` and `codex mcp list --json` expose stable structured fields including stdio command and args. A clean `CODEX_HOME` round trip preserved an entry path containing spaces. Official skill discovery includes user `~/.agents/skills`.
- **Gemini CLI v0.39.1 (official tagged documentation; not installed locally):** `gemini mcp add --scope user ast <node> <entry>` is the documented user-scoped stdio form. `gemini mcp list` displays command, transport, and connection state, but stdio connection is reported as disconnected in untrusted folders. User skills are discovered from `~/.gemini/skills` and `~/.agents/skills`.
- **GitHub Copilot CLI 1.0.79 documentation/changelog (official current evidence; not installed locally):** `copilot mcp add ast -- <node> <entry>` writes `~/.copilot/mcp-config.json`; `copilot mcp get ast --json` and `copilot mcp list --json` are documented inspection commands. Personal skills are discovered from `~/.copilot/skills` and `~/.agents/skills`. Exact JSON fixtures still require a live installed-client capture during implementation; until captured, their field-level shape is a design assumption, not a verified local contract.

The repository's tests and smoke fixtures hard-code two agents. `AgentTargetDefinition.skillTarget`, `SkillTargetSelection`, and `runAgentSetup` also assume that every selected agent maps to either Claude, Hermes, or the installer's two-target `all` value. That model cannot represent six clients or shared destinations safely.

### Affected Areas

- `src/services/agent-targets.ts` — add four target adapters, version/output compatibility policies, and client-specific inspection and registration contracts.
- `src/services/agent-setup.ts` — resolve `all` after detection, run compatibility checks before mutation, and orchestrate destination plans without assuming one skill target per agent.
- `src/services/skill-installer.ts` — replace the closed two-target selector with explicit destination plans and physical-path deduplication; use `~/.agents/skills` for OpenCode, Codex, Gemini, and Copilot where no client-specific routing requirement overrides it.
- `src/services/setup-wizard.ts`, `src/cli.ts` — implement the native checkbox interaction, preserve TTY cleanup and JSON stdout, and update accepted IDs/help text.
- `test/agent-targets.test.ts`, `test/agent-setup.test.ts`, `test/skill-installer.test.ts`, `test/setup-wizard.test.ts` — cover six-client order, detection, compatibility, output-contract failures, shared destinations, checkbox behavior, and new `all` semantics.
- `scripts/fixtures/fake-agent.mjs`, `scripts/cli-smoke.mjs`, `scripts/package-smoke.mjs`, `test/registry-consumer-smoke.test.ts` — expand fake identities, isolated homes/config routing, packaged setup, idempotency, and partial-detection matrices.
- `README.md`, `CHANGELOG.md`, `docs/adr/0001-secure-yarn-and-agent-setup.md` — document the support matrix, exclusions, controls, version policy, config destinations, and the deliberate OpenCode exception to CLI-only mutation.

### Approaches

1. **Registry adapters plus destination planning** — keep generic setup orchestration, give each client a versioned MCP adapter, add a destination planner for skills, and retain a small native raw-key checkbox controller.
   - Pros: isolates volatile client contracts; preserves fail-closed preflight and stable automation; deduplicates the shared `~/.agents/skills` write; remains dependency-free.
   - Cons: six adapters and their fixtures must evolve independently; OpenCode needs a documented config-file adapter because its add command does not honor custom routing.
   - Effort: High

2. **Generalized direct config mutation** — edit every client's configuration format through one generic config layer and use CLIs only for status.
   - Pros: uniform destination control; avoids human-oriented add flows.
   - Cons: couples setup to TOML/JSON/JSONC schemas, bypasses client validation, reverses the established public-CLI boundary for clients whose CLIs already provide structured contracts, and increases migration risk.
   - Effort: High

### Recommendation

Choose registry adapters plus explicit destination planning. Keep public CLI registration for Claude, Hermes, Codex, Gemini, and Copilot. Use each client's strongest inspection contract: structured `get/list --json` for Codex and Copilot, connection-aware `mcp list` for Gemini, and the existing Claude/Hermes checks. Human-oriented or unknown output must fail closed with a client-specific diagnostic rather than be treated as current.

For OpenCode, document **1.18.18 as the minimum tested version**. Reject an older or unparseable version before writes, and reject output that does not match the tested resolved-config/list contract. Resolve the MCP mutation destination as `OPENCODE_CONFIG` when present, otherwise `OPENCODE_CONFIG_DIR/opencode.json` when present, otherwise the standard global config. If both custom sources are present, preflight the merged resolved config and fail on a higher-precedence conflict. Apply a bounded JSON/JSONC-aware update to that chosen file, then run `opencode debug config` and `opencode mcp list` with the same environment; success requires the effective `ast` command/args to match the chosen destination and the server to connect. Do not call `opencode mcp add` for this path because local 1.18.18 evidence proves it writes the standard global file instead.

Change `--agents all` resolution from parse-time registry expansion to post-detection selection. It selects every detected client that passes compatibility preflight; no detected client is silently skipped for being too old or exposing an unknown contract. Explicit lists keep unavailable-client errors. Interactive mode shows every supported client in registry order, starts detected compatible clients checked, leaves unavailable/incompatible entries disabled with reasons, and preserves confirmation/cancellation.

Treat exact Gemini and Copilot output fixtures as implementation validation work, not invented facts: capture help/version and isolated add/get/list behavior from installed clients before admitting each adapter fixture. This does not reopen product scope; an adapter whose documented command exists but whose current output contract cannot be verified must fail closed and report the compatibility diagnostic.

### Risks

- OpenCode direct JSONC mutation is a justified exception but must preserve comments, unrelated keys, file mode, and atomic no-clobber behavior; resolved-config verification must use the identical environment.
- Gemini's connection status depends on folder trust, so setup needs a clear trust diagnostic rather than misclassifying a correct registration as conflict.
- Copilot's official commands are verified, but its exact JSON fields were not locally captured; loose parsing would weaken conflict detection.
- A shared `~/.agents/skills` destination serves four clients, so result reporting must separate one physical write from four logical client outcomes.
- Native raw-mode interaction can corrupt terminal state unless cleanup is centralized and tested on Enter, cancellation, errors, and signals.
- Six-client fake and package matrices can exceed the 800-line review budget; tasks should forecast review size and use ask-on-risk delivery slicing.
- Setup remains convergent rather than transactionally atomic across independent client CLIs; retries must preserve completed work and report partial progress.

### Ready for Proposal

Yes. Product scope, exclusions, `all` semantics, OpenCode routing, and OpenCode compatibility policy are resolved. The proposal should preserve fail-closed preflight, define the six-client matrix and native checkbox outcome, require OpenCode 1.18.18+ with tested-contract diagnostics, and leave exact Gemini/Copilot fixture capture as technical acceptance evidence rather than a product decision.
