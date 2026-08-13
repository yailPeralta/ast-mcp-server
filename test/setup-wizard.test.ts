import { describe, expect, it } from "vitest";
import {
  parseAgentsArgument,
  resolveAgentSelection,
  type AgentDetection,
} from "../src/services/setup-wizard.js";

const detections: AgentDetection[] = [
  {
    id: "claude",
    label: "Claude Code",
    installed: true,
    executable: "/usr/bin/claude",
    version: "2.1.201",
  },
  {
    id: "hermes",
    label: "Hermes",
    installed: true,
    executable: "/usr/bin/hermes",
    version: "0.17.0",
  },
  {
    id: "opencode",
    label: "OpenCode",
    installed: false,
    compatibility: { status: "unavailable", reason: "Not found in PATH." },
  },
  {
    id: "codex",
    label: "Codex CLI",
    installed: true,
    executable: "/usr/bin/codex",
    version: "0.144.0",
    compatibility: { status: "compatible", contract: "codex-mcp-v1", version: "0.144.0" },
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    installed: false,
    compatibility: { status: "unavailable", reason: "Not found in PATH." },
  },
  {
    id: "copilot",
    label: "GitHub Copilot CLI",
    installed: false,
    compatibility: { status: "unavailable", reason: "Not found in PATH." },
  },
];

describe("setup wizard selection", () => {
  it("parses explicit agent lists and all", () => {
    expect(parseAgentsArgument("all")).toEqual({ mode: "all" });
    expect(parseAgentsArgument("hermes,claude,hermes")).toEqual(["claude", "hermes"]);
  });

  it("rejects empty and unsupported explicit agent lists", () => {
    expect(() => parseAgentsArgument("")).toThrow(/cannot be empty/i);
    expect(() => parseAgentsArgument("cursor")).toThrow(/unsupported agent/i);
  });

  it("resolves all after detection and rejects explicit unusable clients", () => {
    expect(resolveAgentSelection({ mode: "all" }, detections)).toEqual([
      "claude",
      "hermes",
      "codex",
    ]);
    expect(() => resolveAgentSelection(["opencode"], detections)).toThrow(/not found in path/i);
    expect(() => resolveAgentSelection(["gemini"], detections)).toThrow(/not found in path/i);
  });

  it("aborts detected all when any detected client is incompatible", () => {
    const incompatible = detections.map((item) =>
      item.id === "codex"
        ? { ...item, compatibility: { status: "incompatible" as const, reason: "Unknown output." } }
        : item,
    );
    expect(() => resolveAgentSelection({ mode: "all" }, incompatible)).toThrow(
      /codex.*unknown output/i,
    );
  });
});
