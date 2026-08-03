# Proposal: Batch CLI orchestration

## Outcome

Ship v0.3.0 with `ast-tool run <pipeline.json>` so Bash-capable agents can execute several existing structural tools in one process and expose only a selected final payload. Preserve reviewed mutations through `ast-tool apply <plan-file> --plan-hash <hash>` in a separate process.

## Success criteria

1. A search-to-source pipeline completes from one Bash invocation.
2. A list-to-outline `foreach` pipeline reuses one project session and preserves input order.
3. Intermediate results do not appear unless selected by `emit`.
4. Invalid refs, unknown/forbidden tools, duplicate ids, excessive expansion and tool errors fail deterministically.
5. Batch execution cannot call `ast_apply_operation`.
6. A CLI prepare emits an exact persisted plan and unavoidable review coordinates; a later apply requires the reviewed hash and revalidates the workspace.
7. Plan files use atomic replacement, mode `0600`, bounded size, version validation and expiry.
8. MCP and CLI apply share one cooperative canonical workspace lock without changing MCP tool contracts.
9. Tests, stdio smoke, CLI smoke, package dry-run and benchmarks pass.

## Compatibility

- Keep all MCP tool names and contracts.
- Add the `ast-tool` package bin; retain `ast-mcp-server`.
- Batch schemas are versioned from `1`.
- This is a v0.x minor release because it adds public CLI contracts without removing APIs.

## Risks

- A declarative DSL can expand into an accidental workload: enforce step, foreach, input and output limits.
- Persisted plans contain exact proposed source: use private files, explicit TTL and no logging of contents.
- Receipt failure after source replacement exits non-zero; exact complete postimages can recover the receipt, while partial state and stale crash locks remain fail-closed.
- In-memory SDK APIs could evolve: isolate them in one adapter and cover it end-to-end.
