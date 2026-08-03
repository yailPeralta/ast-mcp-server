# Proposal: secure Yarn workflow and agent setup wizard

## Outcome

Provide a repository-enforced dependency installation policy and one setup workflow that configures every detected supported agent by default.

## Scope

- Migrate development and CI from npm to pinned Yarn 4.
- Disable dependency lifecycle scripts in checked-in Yarn configuration.
- Add `ast-tool setup` and `yarn setup`.
- Detect Claude Code and Hermes from `PATH`.
- Let interactive users deselect detected agents; default to all.
- Register the MCP server and install the bundled skill for selected agents.
- Add non-interactive flags for tests and automation.
- Keep existing user configuration fail-closed.

## Out of scope

- Publishing the package to npm.
- Supporting agents other than Claude Code and Hermes.
- Automatically removing or replacing conflicting MCP registrations.
- Editing private agent configuration files directly.
