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
- OpenCode: preserve routed JSON/JSONC and atomically update only `mcp.ast`, because its add command does not honor custom routing. Require version 1.18.18 or newer. Its diagnostic config command mutates both `OPENCODE_CONFIG` and `$OPENCODE_CONFIG_DIR/opencode.json`; preflight and verification therefore operate on one disposable copied root and never expose the planned destination to that command.

The configured command is the current Node executable plus the absolute packaged `dist/index.js` entrypoint.

Before any writes, setup checks every selected agent for an existing `ast` MCP registration. A healthy registration of this server is idempotently preserved. A conflicting registration fails closed and must be resolved manually; setup does not remove agent configuration automatically.

Skill destinations reuse the existing installer. The package ships a closed SHA-256 manifest whose predecessors are admitted only from downloaded npm tarballs after `dist.integrity` verification. Current bytes remain unchanged, exact admitted predecessor bytes upgrade automatically, and unknown/custom bytes fail closed unless `--force-skill` is explicit. Frontmatter version text is not ownership evidence.
Claude and Hermes retain client-specific destinations. OpenCode, Codex, Gemini, and Copilot share `~/.agents/skills`; setup canonicalizes the nearest existing ancestor, writes a physical destination once, and reports every logical client binding.

Setup separately manages one activation block on verified global instruction surfaces:

- Claude: the effective personal `CLAUDE.md` below `CLAUDE_CONFIG_DIR`;
- OpenCode: its effective native `AGENTS.md`, preserving or sharing an existing Claude fallback when applicable;
- Codex: the active non-empty `AGENTS.override.md`, otherwise `AGENTS.md`, below `CODEX_HOME`;
- Gemini: one safe supported global context filename from settings, otherwise `GEMINI.md`;
- Hermes and Copilot: skill-only because no equivalent personal global destination is part of the verified contract.

Stable begin/end markers own only the managed block. Every byte outside that range belongs to the user. Duplicate, partial, reordered, nested, or unknown markers fail closed. Planning rejects invalid UTF-8, NUL bytes, symlinks, non-regular targets, ambiguous routes, and incompatible physical aliases. The snapshot records parent-chain and destination inode identity in addition to bytes and mode. Apply traverses relative to authenticated Linux directory descriptors, rechecks every plan including `unchanged`, keeps staged and existing preimage inodes open, publishes creation through a descriptor-bound no-clobber link, and replaces an existing file through GNU `mv --exchange --no-copy -T`. Both exchanged identities and the pinned preimage digest/mode are validated; an in-call substitution or same-inode edit triggers rollback only after the exact exchange pair is revalidated.

### Failure model

Setup is convergent and retry-safe, not transactionally atomic across independent agent CLIs. It preflights all selected MCP registrations, skill destinations, and guidance destinations before writes; applies preflighted managed assets; then configures missing MCP registrations. A changed ancestor, destination inode, unchanged asset, or completed postimage stops subsequent mutation and cannot be reported as current. Failures distinguish `completed_writes`, `possibly_committed`, `rolled_back`, `rollback_failed`, and `pending`; only the exact exchange pair is rolled back automatically, while an uncertain post-commit state is preserved for inspection and a fresh replan. This avoids falsely reporting a physical mutation as untouched or overwriting a concurrent human postimage.

Machine output is one stable versioned JSON value. Setup schema v2 reports `mcp`, `skill`, and `guidance` per logical agent plus physically deduplicated writes tagged as `skill`, `guidance`, or `mcp_config`. Command time and output are bounded. Provider output is never copied into public diagnostics; a correlation ID ties bounded failures to the setup result. Code rollback retains valid user registrations, skill files, and standalone managed text blocks; it does not remove or downgrade them automatically. Mixed-version rollout fails closed on unknown contracts.

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
- CLI smoke tests use isolated fake agent executables and config homes, assert effective instruction discovery for four clients, preserve human content, and prove zero-write replay plus skill-only outcomes.
- A host-dependent live smoke builds first and exercises every locally installed supported CLI in disposable homes. The verified cohort was Claude Code, Hermes, OpenCode, Codex, and Copilot; Gemini was unavailable and reported rather than simulated. The smoke proves client-visible MCP discovery, model-visible Codex guidance without a model call, OpenCode routed-config discovery, skill-only outcomes, zero-write replay, and byte-exact preservation of an existing Hermes `SOUL.md`.
- Tarball smoke installs the packed artifact using Yarn with scripts disabled from a path containing spaces, verifies all three managed assets from `node_modules`, and runs setup twice from the consumer project.
