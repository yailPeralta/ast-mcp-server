# Specification: secure agent setup

## Dependency installation

1. The repository SHALL pin Yarn 4 through `packageManager`.
2. The repository SHALL commit `enableScripts: false` so dependency lifecycle/build scripts do not execute during install.
3. CI SHALL use `yarn install --immutable` and Yarn commands only.
4. The npm lockfile SHALL be replaced by `yarn.lock`.

## Agent detection and selection

1. Setup SHALL detect Claude Code and Hermes executables from `PATH` without using a shell.
2. Interactive setup SHALL select all detected agents by default.
3. Interactive setup SHALL allow any detected agent to be deselected.
4. Interactive setup SHALL display its plan and require confirmation.
5. Non-interactive setup SHALL require both `--agents` and `--yes`.
6. Selecting an unavailable agent SHALL fail before writes.

## MCP configuration

1. Setup SHALL configure the MCP server as `ast`, using the current Node executable and the packaged absolute `dist/index.js` path.
2. Setup SHALL use each agent's public MCP CLI.
3. Setup SHALL preflight every selected agent before writes.
4. An existing healthy AST registration SHALL be unchanged.
5. An existing conflicting `ast` registration SHALL fail closed.
6. A newly added registration SHALL be verified through the agent CLI.
7. External commands SHALL have bounded timeouts and output limits.

## Skill installation

1. Setup SHALL install the bundled skill for exactly the selected agents.
2. Identical skill content SHALL be unchanged.
3. Different skill content SHALL fail closed unless `--force-skill` is explicit.
4. Multi-agent skill preflight SHALL complete before MCP writes.

## Failure and output

1. Setup SHALL be retry-safe and convergent.
2. If a later agent CLI fails, setup SHALL report the failure without rolling back valid configuration owned by another agent.
3. Machine-invoked setup SHALL return one JSON result and a non-zero exit code on failure.

## Scenarios

- Both agents detected, Enter pressed: configure both.
- Both detected, Hermes deselected: configure Claude only.
- Requested agent missing: no files or MCP config changed.
- Both MCP registrations current and both skills current: all results unchanged.
- One MCP name conflicts: setup fails before any skill write or MCP mutation.
- Skill conflict without force: setup fails before MCP mutation.
- Packaged tarball installed in another project: setup resolves its own server and skill paths.
