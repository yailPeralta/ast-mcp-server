import { describe, expect, it } from "vitest";
import {
  AGENT_IDS,
  AGENT_TARGETS,
  classifyAgentVersion,
  getAgentTarget,
  inspectAgentFixture,
  type AgentTargetId,
  type AgentTargetRuntime,
} from "../src/services/agent-targets.js";

describe("agent target registry", () => {
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
    const codex = await inspectAgentFixture(
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
              source: "user",
              enabled: true,
            },
          }),
          stderr: "",
        },
      ],
      context,
    );

    expect(codex).toEqual({ status: "current" });
    expect(copilot).toEqual({ status: "current" });
    expect(copilotUnknown).toMatchObject({ status: "error", operation: "MCP inspection" });
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
      ["mcp", "add", "ast", "/node", "/package/dist/index.js", "--scope", "user"],
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

    expect(calls).toEqual([["mcp", "add", "ast", "--", "/node", "/package/dist/index.js"]]);
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
        stdout: "✓ Saved 'ast' (15/15 tools enabled)",
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
