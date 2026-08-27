# ADR 0015: DeepSeek Harness Developer Preview adapter — first slice

## Status

Accepted.

## Context

The macro roadmap (initiative 4) validates DeepSeek Harness Developer Preview interoperability through the official `@deepseek-ai/dsh-mcp-client` bridge over stdio, pinned to Harness `dsh-v0.1.2-alpha.1` at revision `cd5ef8148158c3a752a658978873241fdf8e2bbc`. Harness does not resolve MCP binaries from `PATH`, and the official bridge drops MCP tool `annotations` (including `readOnlyHint` and `destructiveHint`) and launches the stdio child outside the Harness sandbox. The first supported surface is therefore reads + prepare + preview, with every apply path denied by a guard.

Two pinned identities are not publishable as-is: `@deepseek-ai/dsh-mcp-client@0.1.2-alpha.1` and the `@deepseek-ai/dsh` CLI at that version are not on npm (newest published is `0.1.1-rc.2`, whose client config schema is byte-identical to the pinned source). The adapter fixture therefore pins `@deepseek-ai/dsh-mcp-client@0.1.1-rc.2` and the runtime smoke runs against the newest published `dsh` CLI; the roadmap's pinned revision remains the schema authority.

## Decision

Ship a thin adapter inside the `ast-mcp-server` package (target `0.13.0`), not as a separate package:

- `package.json` declares exactly `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` and ships `cordis.patch.yml` in `files`.
- `cordis.patch.yml` inserts one `@deepseek-ai/dsh-mcp-client` row (`serverName: ast`, `transport: stdio`, `failOnStartupError: true`) whose entrypoint resolves package-relatively: `command: !!js process.execPath` and `args: [!!js fileURLToPath(new URL('node_modules/ast-mcp-server/dist/index.js', baseUrl))]`, where `baseUrl` is the profile directory file URL available to loader `!!js` expressions. This avoids ambient `PATH` resolution and works from the packed tarball.
- The row sets `env: { AST_MCP_APPLY_GUARD: 'deny' }`; the server parses it as a new closed runtime-policy key and, when active, does not register any `effect: "apply"` tool (`ast_apply_operation`) — deny-by-default by absence, with reads, prepare, and preview unchanged. An invalid guard value falls back to the default (guard off) with an `invalid_mode` reason and is never retained.
- Verification is two-part: `dsh --profile <name> --dump-config` proves composition only (it does not evaluate `!!js`); `yarn test:dsh-adapter` (phases A/B always, phase C when a `dsh` CLI and `pnpm` exist) proves the packed tarball fixture, entrypoint resolution against an installed consumer, the independent stdio smoke (guard on → 15 tools without `ast_apply_operation`; guard off → 16; prepare/preview work), and — locally — profile install, dump composition, and observing the harness spawn the installed server over stdio under `tools.mode: native` (the default).

## Evidence boundary

- `yarn test:dsh-adapter` passed all three phases against the local dsh CLI: tarball fixture, independent MCP guard/read/prepare/preview, and harness profile install + `--dump-config` composition + observed stdio startup of the installed `dist/index.js`.
- The loader `!!js` mechanics are identical between the local CLI and the pinned revision (vendored loader/include files match byte-for-byte), so the empirical composition proof transfers to the pin.
- These are Developer Preview results: no compatibility promise, no `apply` claim, no `ptc`/Code Mode claim, and no `dsh plugin add` promise beyond the tested `0.13.0` tarball.

## Consequences

- The Harness surface exposes only reads, prepare, and preview; `ast_apply_operation` is not registered when the guard is on.
- Annotations are dropped by the bridge and the stdio child runs unsandboxed; these gaps are documented and never used as safety authority.
- The guard is a closed env vocabulary (`AST_MCP_APPLY_GUARD=deny`); the default surface elsewhere is unchanged (16 tools).
- A later `apply` claim requires explicit proof of root/session binding, review/hash binding, explicit approval, workspace-change rejection, reconnect/restart/HMR/expiry behavior, and zero cross-workspace authorization.
