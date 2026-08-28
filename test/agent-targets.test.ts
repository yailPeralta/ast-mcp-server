import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_IDS,
  AGENT_TARGETS,
  classifyAgentVersion,
  getAgentTarget,
  inspectAgentFixture,
  type AgentTargetId,
  type AgentTargetRuntime,
} from "../src/services/agent-targets.js";
import { toolCatalog } from "../src/tools/catalog.js";

afterEach(() => {
  vi.doUnmock("../src/tools/catalog.js");
  vi.resetModules();
});

describe("agent target registry", () => {
  it("keeps compatibility at 12 required tools and four optional tools", () => {
    expect(toolCatalog.compatibility.required).toHaveLength(12);
    expect(toolCatalog.compatibility.optional).toEqual([
      "ast_get_project_status",
      "ast_explore",
      "ast_get_impact",
      "ast_get_file",
    ]);
  });

  it("derives the Hermes minimum from the catalog required projection", async () => {
    vi.resetModules();
    vi.doMock("../src/tools/catalog.js", () => ({
      toolCatalog: { compatibility: { required: ["ast_catalog_required"] } },
    }));
    const { inspectAgentFixture: inspectCatalogFixture } =
      await import("../src/services/agent-targets.js");

    await expect(
      inspectCatalogFixture(
        "hermes",
        [
          { exitCode: 0, stdout: "ast stdio all enabled", stderr: "" },
          {
            exitCode: 0,
            stdout: JSON.stringify({
              command: "/node",
              args: ["/package/dist/index.js"],
              env: { AST_MCP_APPLY_GUARD: "allow" },
            }),
            stderr: "",
          },
          { exitCode: 0, stdout: "ast_catalog_required", stderr: "" },
        ],
        { nodeExecutable: "/node", serverEntryPath: "/package/dist/index.js" },
      ),
    ).resolves.toEqual({ status: "current" });
  });
  it("keeps the supported targets ordered and uniquely addressable", () => {
    expect(AGENT_IDS).toEqual(["claude", "hermes", "opencode", "codex", "gemini", "copilot"]);
    expect(new Set(AGENT_TARGETS.map((target) => target.id)).size).toBe(AGENT_TARGETS.length);
    expect(AGENT_TARGETS.map((target) => target.skillTarget)).toEqual([
      "claude",
      "hermes",
      "agents",
      "agents",
      "agents",
      "agents",
    ]);
  });

  it("fails closed on unknown versions and enforces the OpenCode minimum", () => {
    expect(classifyAgentVersion("opencode", "1.18.18")).toMatchObject({ status: "compatible" });
    expect(classifyAgentVersion("opencode", "1.18.17")).toMatchObject({
      status: "incompatible",
      reason: expect.stringContaining("1.18.18"),
    });
    expect(classifyAgentVersion("codex", "codex-cli unknown")).toMatchObject({
      status: "incompatible",
    });
    expect(classifyAgentVersion("gemini", "0.39.1")).toMatchObject({ status: "compatible" });
    expect(classifyAgentVersion("copilot", "0.0.356")).toMatchObject({ status: "compatible" });
    expect(classifyAgentVersion("copilot", "GitHub Copilot CLI 1.0.79.")).toEqual({
      status: "compatible",
      contract: "copilot-mcp-v1",
      version: "1.0.79",
    });
  });

  it("uses tested structured contracts and fail-closes unknown evidence", async () => {
    const context = { nodeExecutable: "/node", serverEntryPath: "/package/dist/index.js" };
    const legacyCodex = await inspectAgentFixture(
      "codex",
      [
        {
          exitCode: 0,
          stdout: JSON.stringify({
            name: "ast",
            transport: { type: "stdio", command: "/node", args: ["/package/dist/index.js"] },
          }),
          stderr: "",
        },
      ],
      context,
    );
    const copilotUnknown = await inspectAgentFixture(
      "copilot",
      [{ exitCode: 0, stdout: "ast is probably configured", stderr: "" }],
      context,
    );
    const codex = await inspectAgentFixture(
      "codex",
      [
        {
          exitCode: 0,
          stdout: JSON.stringify({
            name: "ast",
            transport: {
              type: "stdio",
              command: "/node",
              args: ["/package/dist/index.js"],
              env: { AST_MCP_APPLY_GUARD: "allow" },
            },
          }),
          stderr: "",
        },
      ],
      context,
    );
    const topLevelCodex = await inspectAgentFixture(
      "codex",
      [
        {
          exitCode: 0,
          stdout: JSON.stringify({
            name: "ast",
            type: "stdio",
            command: "/node",
            args: ["/package/dist/index.js"],
            env: { AST_MCP_APPLY_GUARD: "allow" },
          }),
          stderr: "",
        },
      ],
      context,
    );
    const legacyCopilot = await inspectAgentFixture(
      "copilot",
      [
        {
          exitCode: 0,
          stdout: JSON.stringify({
            ast: {
              tools: ["*"],
              type: "local",
              command: "/node",
              args: ["/package/dist/index.js"],
              source: "user",
              enabled: true,
            },
          }),
          stderr: "",
        },
      ],
      context,
    );
    const guardedDifferently = await inspectAgentFixture(
      "codex",
      [
        {
          exitCode: 0,
          stdout: JSON.stringify({
            name: "ast",
            transport: {
              command: "/node",
              args: ["/package/dist/index.js"],
              env: { AST_MCP_APPLY_GUARD: "deny" },
            },
          }),
          stderr: "",
        },
      ],
      context,
    );
    const copilot = await inspectAgentFixture(
      "copilot",
      [
        {
          exitCode: 0,
          stdout: JSON.stringify({
            ast: {
              tools: ["*"],
              type: "local",
              command: "/node",
              args: ["/package/dist/index.js"],
              env: { AST_MCP_APPLY_GUARD: "allow" },
              source: "user",
              enabled: true,
            },
          }),
          stderr: "",
        },
      ],
      context,
    );
    const legacyHermes = await inspectAgentFixture(
      "hermes",
      [
        { exitCode: 0, stdout: "ast stdio all enabled", stderr: "" },
        {
          exitCode: 0,
          stdout: JSON.stringify({ command: "/node", args: ["/package/dist/index.js"] }),
          stderr: "",
        },
        {
          exitCode: 0,
          stdout:
            "ast_list_files ast_get_outline ast_get_symbol_source ast_search_symbols ast_find_references ast_find_test_candidates ast_get_diagnostics ast_rename_symbol ast_replace_symbol_body ast_scaffold_class ast_get_operation_preview",
          stderr: "",
        },
      ],
      context,
    );

    expect(legacyCodex).toEqual({ status: "repairable" });
    expect(codex).toEqual({ status: "current" });
    expect(topLevelCodex).toEqual({ status: "current" });
    expect(legacyCopilot).toEqual({ status: "repairable" });
    expect(copilot).toEqual({ status: "current" });
    expect(guardedDifferently).toMatchObject({ status: "conflict" });
    expect(legacyHermes).toEqual({ status: "repairable" });
    expect(copilotUnknown).toMatchObject({ status: "error", operation: "MCP inspection" });
  });

  it("fails closed instead of repairing malformed or unauthenticated registrations", async () => {
    const context = { nodeExecutable: "/node", serverEntryPath: "/package/dist/index.js" };
    const codexFixtures = [
      { transport: { type: "http", command: "/node", args: [context.serverEntryPath] } },
      {
        transport: { type: "stdio", command: "/node", args: [context.serverEntryPath], env: null },
      },
      { transport: { type: "stdio", command: "/node", args: [context.serverEntryPath], env: [] } },
      {
        transport: {
          type: "stdio",
          command: "/node",
          args: [context.serverEntryPath],
          env: "AST_MCP_APPLY_GUARD=allow",
        },
      },
    ];
    for (const fixture of codexFixtures) {
      await expect(
        inspectAgentFixture(
          "codex",
          [{ exitCode: 0, stdout: JSON.stringify({ name: "ast", ...fixture }), stderr: "" }],
          context,
        ),
      ).resolves.toMatchObject({ status: "conflict" });
    }

    await expect(
      inspectAgentFixture(
        "claude",
        [
          {
            exitCode: 0,
            stdout: `ast:\n  Scope: Project config\n  Status: Connected\n  Type: stdio\n  Command: /node\n  Args: ${context.serverEntryPath}`,
            stderr: "",
          },
        ],
        context,
      ),
    ).resolves.toMatchObject({ status: "conflict" });

    await expect(
      inspectAgentFixture(
        "hermes",
        [
          { exitCode: 0, stdout: "ast stdio all enabled", stderr: "" },
          {
            exitCode: 0,
            stdout: JSON.stringify({ command: "/custom/server", args: ["other.js"] }),
            stderr: "",
          },
        ],
        context,
      ),
    ).resolves.toMatchObject({ status: "conflict" });

    await expect(
      inspectAgentFixture(
        "hermes",
        [
          { exitCode: 0, stdout: "ast stdio all enabled", stderr: "" },
          { exitCode: 2, stdout: "", stderr: "config evidence unavailable" },
        ],
        context,
      ),
    ).resolves.toMatchObject({ status: "conflict" });
  });

  it("distinguishes repairable legacy Claude and Gemini registrations from current ones", async () => {
    const context = { nodeExecutable: "/node", serverEntryPath: "/package/dist/index.js" };
    const claudeBase = `ast:
  Scope: User config (available in all your projects)
  Status: ✔ Connected
  Type: stdio
  Command: /node
  Args: /package/dist/index.js`;
    const geminiBase = "ast Connected command: /node, args: [/package/dist/index.js]";

    await expect(
      inspectAgentFixture("claude", [{ exitCode: 0, stdout: claudeBase, stderr: "" }], context),
    ).resolves.toEqual({ status: "repairable" });
    await expect(
      inspectAgentFixture(
        "claude",
        [
          {
            exitCode: 0,
            stdout: `${claudeBase}\n  Environment:\n    AST_MCP_APPLY_GUARD=allow`,
            stderr: "",
          },
        ],
        context,
      ),
    ).resolves.toEqual({ status: "current" });
    await expect(
      inspectAgentFixture("gemini", [{ exitCode: 0, stdout: geminiBase, stderr: "" }], context),
    ).resolves.toEqual({ status: "repairable" });
    await expect(
      inspectAgentFixture(
        "gemini",
        [
          {
            exitCode: 0,
            stdout: `${geminiBase}, env: AST_MCP_APPLY_GUARD=allow`,
            stderr: "",
          },
        ],
        context,
      ),
    ).resolves.toEqual({ status: "current" });
  });

  it("classifies Gemini trust separately and emits exact registration commands", async () => {
    const calls: string[][] = [];
    const runtime: AgentTargetRuntime = {
      async run(args) {
        calls.push([...args]);
        return {
          exitCode: 0,
          stdout: "MCP servers are disabled in untrusted folders. Trust this folder to continue.\n",
          stderr: "",
        };
      },
    };
    const context = { nodeExecutable: "/node", serverEntryPath: "/package/dist/index.js" };
    const inspection = await getAgentTarget("gemini").mcp.inspect(runtime, context);
    await getAgentTarget("gemini").mcp.register(runtime, context);

    expect(inspection).toMatchObject({ status: "blocked_untrusted_folder" });
    expect(calls).toEqual([
      ["mcp", "list"],
      [
        "mcp",
        "add",
        "ast",
        "--env",
        "AST_MCP_APPLY_GUARD=allow",
        "/node",
        "/package/dist/index.js",
        "--scope",
        "user",
      ],
    ]);
  });

  it("uses Copilot's separator-based registration syntax", async () => {
    const calls: string[][] = [];
    await getAgentTarget("copilot").mcp.register(
      {
        async run(args) {
          calls.push([...args]);
          return { exitCode: 0, stdout: "Added MCP server ast", stderr: "" };
        },
      },
      { nodeExecutable: "/node", serverEntryPath: "/package/dist/index.js" },
    );

    expect(calls).toEqual([
      [
        "mcp",
        "add",
        "ast",
        "--env",
        "AST_MCP_APPLY_GUARD=allow",
        "--",
        "/node",
        "/package/dist/index.js",
      ],
    ]);
  });

  it("describes executable discovery and MCP registration per target", () => {
    const claude = getAgentTarget("claude");
    const hermes = getAgentTarget("hermes");

    expect(claude).toMatchObject({ label: "Claude Code", command: "claude" });
    expect(hermes).toMatchObject({ label: "Hermes", command: "hermes" });
    expect(claude.mcp).not.toBe(hermes.mcp);
    expect(claude.mcp.registrationAccepted({ exitCode: 0, stdout: "", stderr: "" })).toBe(true);
    expect(
      hermes.mcp.registrationAccepted({
        exitCode: 0,
        stdout: "✓ Saved 'ast' (16/16 tools enabled)",
        stderr: "",
      }),
    ).toBe(true);
    expect(
      hermes.mcp.registrationAccepted({ exitCode: 0, stdout: "saved another", stderr: "" }),
    ).toBe(false);
  });

  it("keeps AgentTargetId closed over the registry", () => {
    const ids: AgentTargetId[] = [...AGENT_IDS];
    expect(ids.map((id) => getAgentTarget(id).id)).toEqual(ids);
  });
});
