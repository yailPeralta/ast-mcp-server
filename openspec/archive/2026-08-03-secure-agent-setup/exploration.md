# Exploration: secure agent setup

## Current state

- The repository uses npm commands and `package-lock.json`.
- Yarn 4.15.0 is available through Corepack.
- Yarn does not provide the requested lifecycle-script protection merely by being Yarn; the repository must commit `enableScripts: false`.
- Claude Code 2.1.201 exposes `claude mcp add/get/remove` and supports user-scoped stdio servers.
- Hermes 0.17.0 exposes `hermes mcp add/list/test/remove`. `hermes mcp add` connects to the server, discovers tools, then prompts whether to enable all tools.
- The existing `install-skill` command already provides atomic preflight, idempotency, and fail-closed conflicts for skill files.

## Verified integration commands

Claude Code accepts:

```text
claude mcp add --scope user --transport stdio ast -- <node> <absolute-dist-index>
```

`claude mcp get ast` reports scope, connection status, command, and args.

Hermes accepts:

```text
hermes mcp add ast --command <node> --args <absolute-dist-index>
```

Sending an empty answer selects all discovered tools. `hermes mcp test ast` reports all ten expected AST tools.

## Risks

- Agent config is user-owned and must not be overwritten silently.
- Multi-agent setup cannot be transactionally atomic across independent CLIs.
- A dependency-based prompt UI would increase supply-chain surface.
- Non-TTY execution must not hang waiting for input.
- Packaged execution must resolve `dist/index.js` from the installed tarball rather than the caller's working directory.
