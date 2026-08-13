# ADR 0001: Secure Yarn installs and convergent agent setup

- Status: Accepted
- Date: 2026-08-03

## Context

The project currently uses npm and relies on separate manual commands to register the MCP server and install its skill. The desired outcome is:

1. dependency installation must not execute third-party lifecycle scripts;
2. one interactive command must detect supported agents, select all detected agents by default, allow deselection, and configure both MCP and skill integration;
3. existing user configuration must not be overwritten silently.

## Decisions

### Package manager

Use Yarn 4, pinned through the `packageManager` field and Corepack. Commit `.yarnrc.yml` with:

- `enableScripts: false` to disable dependency lifecycle/build scripts during install;
- `nodeLinker: node-modules` for compatibility with the TypeScript and packaging toolchain;
- telemetry disabled.

Commit `yarn.lock` and remove `package-lock.json`. CI uses `yarn install --immutable` and Yarn commands exclusively.

Yarn alone is not the security boundary: `enableScripts: false` is. Workspace scripts remain explicitly runnable by maintainers.

### Setup interface

Expose:

```text
yarn setup
ast-tool setup
ast-tool setup --agents claude,hermes --yes
```

Interactive setup detects exactly Claude Code, Hermes, OpenCode, Codex CLI, Gemini CLI, and GitHub Copilot CLI. It uses a native raw-TTY checkbox reducer with idempotent cleanup. Editor-integrated clients remain excluded.

The non-interactive form exists for CI and automation. It rejects missing agents and requires `--yes`.

### Wizard implementation

Use a pure checkbox reducer and Node's native TTY APIs rather than adding a prompt dependency. One cleanup owner restores raw mode, cursor state, listeners, and signal handlers on every exit.

### Agent configuration

Use each agent's public CLI except for one bounded OpenCode exception:

- Claude Code: `claude mcp add --scope user --transport stdio ...`
- Hermes: `hermes mcp add ...`, accepting its default of enabling every discovered tool, followed by `hermes mcp test ast`.
- Codex and Copilot: structured get/list contracts and public add commands.
- Gemini: connection-aware list and user-scoped add; an untrusted folder blocks setup without writes.
- OpenCode: preserve routed JSON/JSONC and atomically update only `mcp.ast`, because its add command does not honor custom routing. Require version 1.18.18 or newer.

The configured command is the current Node executable plus the absolute packaged `dist/index.js` entrypoint.

Before any writes, setup checks every selected agent for an existing `ast` MCP registration. A healthy registration of this server is idempotently preserved. A conflicting registration fails closed and must be resolved manually; setup does not remove agent configuration automatically.

Skill destinations reuse the existing installer. Different local skill content also fails closed unless `--force-skill` is explicit.
Claude and Hermes retain client-specific destinations. OpenCode, Codex, Gemini, and Copilot share `~/.agents/skills`; setup canonicalizes the nearest existing ancestor, writes a physical destination once, and reports every logical client binding.

### Failure model

Setup is convergent and retry-safe, not transactionally atomic across independent agent CLIs. It performs global preflight before writes, installs skills as one preflighted operation, then configures missing MCP registrations. If an external CLI fails mid-run, the result reports completed steps and a retry preserves completed work.

Machine output is one stable versioned JSON value. Command time and output are bounded. Provider output is never copied into public diagnostics; a correlation ID ties bounded failures to the setup result. Rollback reverts adapters, checkbox control, and planning code while retaining valid user registrations and skill files. Mixed-version rollout fails closed on unknown contracts.

## Alternatives considered

### Keep npm and use `npm ci --ignore-scripts`

Rejected. It can enforce the immediate security requirement, but it depends on every contributor and CI invocation remembering the flag. Repository-level Yarn configuration makes the policy persistent and reviewable.

### Add a checkbox prompt dependency

Rejected. It provides a richer terminal UI but adds dependencies and transitive install surface. A small native wizard is sufficient for two agents.

### Edit Claude and Hermes config files directly

Rejected. It couples this package to private schemas, profile resolution, and migration behavior. Public CLIs own those contracts and perform their own validation.

### Replace conflicting MCP registrations automatically

Rejected. Remove-then-add can destroy a working user configuration if the replacement fails. Conflicts remain fail-closed.

## Verification

- Yarn install is immutable in CI and dependency scripts are disabled by checked-in configuration.
- Unit tests cover agent detection, selection parsing, missing agents, idempotency, and conflicts.
- CLI smoke tests use isolated fake agent executables and config homes.
- Live isolated smoke tests exercise installed Claude Code and Hermes CLIs.
- Tarball smoke installs the packed artifact using Yarn with scripts disabled and runs the setup command from the consumer project.
