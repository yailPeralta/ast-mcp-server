# Design: secure agent setup

The lasting decisions and alternatives are recorded in `docs/adr/0001-secure-yarn-and-agent-setup.md`.

## Modules

- `agent-setup.ts`: executable discovery, MCP inspection, configuration, verification, and orchestration.
- `setup-wizard.ts`: native readline prompts plus pure selection parsers.
- `skill-installer.ts`: existing skill preflight/write implementation reused by setup.
- `cli.ts`: argument validation and JSON/error boundary.

IO is injected at module boundaries so tests can use isolated fake agent executables and homes.

## Flow

1. Resolve the packaged server and skill paths from the real CLI executable.
2. Detect supported agents and collect versions.
3. Resolve selection interactively or from explicit flags.
4. Inspect all selected MCP registrations.
5. Abort on any conflict or unavailable dependency.
6. Install selected skills with one preflighted operation.
7. Configure missing MCP registrations through official CLIs.
8. Verify each registration and return per-agent MCP and skill statuses.

## CLI

```text
ast-tool setup
ast-tool setup --agents claude,hermes --yes
ast-tool setup --agents claude --yes --force-skill
```

`--force-skill` never authorizes removing an MCP registration.

## Packaging

`dist/cli.js` resolves its real path, then derives package root, `dist/index.js`, and `skills/structural-code-editing/SKILL.md`. The Yarn tarball smoke installs into a temporary consumer with `enableScripts: false` and invokes the packaged binary.
