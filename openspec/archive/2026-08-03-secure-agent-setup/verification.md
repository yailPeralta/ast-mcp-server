# Verification: secure agent setup

Date: 2026-08-03
Status: PASS

## Environment

- Repository: `ast-mcp-server`, branch `main`.
- Canonical local runtime: Node.js v24.16.0.
- Package manager: Yarn 4.15.0 through Corepack.
- Real clients: Claude Code 2.1.201 and Hermes Agent 0.17.0.

## Yarn and supply-chain policy

- `.yarnrc.yml` commits `nodeLinker: node-modules`, `enableScripts: false`, and `enableTelemetry: false`.
- `package.json` pins `yarn@4.15.0`; `yarn.lock` replaces `package-lock.json`.
- `yarn install --immutable`: PASS.
- `yarn config get enableScripts`: `false`.
- `yarn audit`: PASS, no audit suggestions.
- The tarball consumer independently commits `enableScripts: false`, installs through Yarn, repeats with `--immutable`, and checks the resolved policy before invoking the package.

## Canonical gates

- `yarn format:check`: PASS.
- `yarn lint`: PASS.
- `yarn typecheck`: PASS for source and test configs.
- `yarn test`: PASS, 13 files / 59 tests.
- `yarn build`: PASS.
- `yarn test:mcp`: PASS; stdio connected, 10 tools exposed, one fixture source listed.
- `yarn test:cli`: PASS; existing batch/apply coverage plus two-agent setup and replay.
- `yarn test:package`: PASS with `transport: yarn-tarball`, lifecycle scripts disabled, both agents configured, both skills installed, and both targets idempotent on replay.
- `yarn pack --dry-run`: PASS; both executables, runtime setup modules, README, and bundled skill are present.
- `ast_get_diagnostics`: 0 errors and 0 warnings.
- `git diff --check`: PASS.

## Setup behavior

- RED evidence: the isolated Claude adapter test failed when its missing-server response changed to the real `No MCP server named "ast"` wording.
- Regression result: the adapter now recognizes semantic missing-server variants while unrelated command failures remain fail-closed.
- Agent discovery resolves executables from `PATH`, captures version/path, and reports unavailable selections before writes.
- Interactive tests cover the default selection of every detected agent, numeric/name deselection, deselect-all, confirmation, and cancellation.
- Non-interactive setup requires an explicit agent set and `--yes`.
- Existing MCP registrations are preflighted for every selected agent before any skill or MCP write.
- Existing matching registrations and skills return `unchanged`; MCP or skill conflicts fail closed.
- Agent subprocesses run without a shell and enforce time and aggregate-output bounds.
- A post-preflight client failure reports completed MCP steps and all skill outcomes so retry can converge.

## Real-client isolation smoke

The complete setup was executed with real client binaries while `CLAUDE_CONFIG_DIR` and `HERMES_HOME` pointed to temporary directories:

- first run: both agents reported MCP `configured` and skill `installed`;
- Claude: `claude mcp get ast` reported `Status: Connected`, stdio, the expected Node executable, and this package's `dist/index.js`;
- Hermes: `hermes mcp test ast` connected and discovered all 10 expected tools;
- replay: both agents reported MCP `unchanged` and skill `unchanged`;
- `hermes skills list` discovered `structural-code-editing` as an enabled local skill;
- both temporary roots were deleted after each smoke; personal client configuration and skills were not touched.

## Packaging and CI

- The package smoke builds a tarball, installs it in a fresh Yarn consumer, invokes the installed `node_modules/.bin/ast-tool`, and proves server/skill asset resolution from the package rather than the checkout.
- CI uses Corepack plus `yarn install --immutable` on Node 20.19 and Node 22, then runs format, lint, typecheck, tests, build, MCP/CLI/package smokes, audit, and pack inspection.

## Residual limits

- Setup is convergent, not transactional across independent clients. A later client can fail after skills or an earlier client were configured; the structured error reports completed work and replay is safe.
- Claude exposes command and args through its inspection command and both are checked exactly. Hermes does not expose configured args through `mcp list/test`; the adapter therefore requires successful connection and the complete expected tool set.
- Native Windows agent setup was not exercised locally. The package smoke retains its prior skill-only fallback on Windows; Linux is the verified setup platform.
