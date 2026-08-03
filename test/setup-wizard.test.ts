import { describe, expect, it } from "vitest";
import {
  applyAgentDeselections,
  parseAgentsArgument,
  promptForAgentSelection,
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
];

describe("setup wizard selection", () => {
  it("parses explicit agent lists and all", () => {
    expect(parseAgentsArgument("all")).toEqual(["claude", "hermes"]);
    expect(parseAgentsArgument("hermes,claude,hermes")).toEqual(["claude", "hermes"]);
  });

  it("rejects empty and unsupported explicit agent lists", () => {
    expect(() => parseAgentsArgument("")).toThrow(/cannot be empty/i);
    expect(() => parseAgentsArgument("codex")).toThrow(/unsupported agent/i);
  });

  it("keeps every detected agent selected when the answer is empty", () => {
    expect(applyAgentDeselections("", detections)).toEqual(["claude", "hermes"]);
  });

  it("deselects by number or id and permits selecting none", () => {
    expect(applyAgentDeselections("2", detections)).toEqual(["claude"]);
    expect(applyAgentDeselections("claude", detections)).toEqual(["hermes"]);
    expect(applyAgentDeselections("none", detections)).toEqual([]);
  });

  it("rejects unavailable or malformed deselections", () => {
    const onlyClaude = [detections[0], { ...detections[1], installed: false }];
    expect(() => applyAgentDeselections("2", onlyClaude)).toThrow(/not installed/i);
    expect(() => applyAgentDeselections("3", detections)).toThrow(/invalid selection/i);
  });

  it("uses all detected agents by default and asks for confirmation", async () => {
    const answers = ["", ""];
    const questions: string[] = [];
    const selected = await promptForAgentSelection(detections, async (question) => {
      questions.push(question);
      return answers.shift() ?? "";
    });

    expect(selected).toEqual(["claude", "hermes"]);
    expect(questions[0]).toContain("[x] 1. Claude Code");
    expect(questions[0]).toContain("[x] 2. Hermes");
    expect(questions[1]).toMatch(/continue/i);
  });

  it("returns an empty selection when confirmation is declined", async () => {
    const answers = ["2", "n"];
    const selected = await promptForAgentSelection(detections, async () => answers.shift() ?? "");
    expect(selected).toEqual([]);
  });
});
