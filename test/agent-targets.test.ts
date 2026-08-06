import { describe, expect, it } from "vitest";
import {
  AGENT_IDS,
  AGENT_TARGETS,
  getAgentTarget,
  type AgentTargetId,
} from "../src/services/agent-targets.js";

describe("agent target registry", () => {
  it("keeps the supported targets ordered and uniquely addressable", () => {
    expect(AGENT_IDS).toEqual(["claude", "hermes"]);
    expect(new Set(AGENT_TARGETS.map((target) => target.id)).size).toBe(AGENT_TARGETS.length);
    expect(AGENT_TARGETS.map((target) => target.skillTarget)).toEqual(["claude", "hermes"]);
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
