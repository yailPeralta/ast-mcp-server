import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  admitAgentFixture,
  normalizeAgentFixture,
  verifyAgentFixtureDirectory,
} from "../scripts/lib/agent-fixtures.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("agent fixture admission", () => {
  it("normalizes volatile paths and records immutable Gemini metadata", async () => {
    const normalized = normalizeAgentFixture({
      agent: "gemini",
      operation: "mcp-list-missing",
      version: "0.39.1",
      command: ["gemini", "mcp", "list"],
      cwd: "/tmp/private-project",
      stdout: "No MCP servers configured in /home/alice/.gemini/settings.json\n",
      stderr: "",
      exitCode: 0,
    });

    expect(normalized).toMatchObject({
      schemaVersion: 1,
      agent: "gemini",
      version: "0.39.1",
      cwd: "<WORKING_DIRECTORY>",
      stdout: "No MCP servers configured in <HOME>/.gemini/settings.json\n",
    });
    expect(normalized.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects secrets and detects admitted Copilot fixture drift", async () => {
    expect(() =>
      normalizeAgentFixture({
        agent: "copilot",
        operation: "mcp-list",
        version: "0.0.356",
        command: ["copilot", "mcp", "list", "--json"],
        cwd: "/tmp/project",
        stdout: '{"token":"ghp_abcdefghijklmnopqrstuvwxyz123456"}',
        stderr: "",
        exitCode: 0,
      }),
    ).toThrow(/secret/i);

    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-fixtures-"));
    temporaryDirectories.push(directory);
    const admitted = await admitAgentFixture(directory, {
      agent: "copilot",
      operation: "mcp-list-missing",
      version: "0.0.356",
      command: ["copilot", "mcp", "list", "--json"],
      cwd: directory,
      stdout: '{"servers":[]}\n',
      stderr: "",
      exitCode: 0,
    });
    await expect(verifyAgentFixtureDirectory(directory)).resolves.toEqual({ checked: 1 });

    const fixturePath = path.join(directory, admitted.fileName);
    const drifted = JSON.parse(await readFile(fixturePath, "utf8"));
    drifted.stdout = '{"servers":[{"name":"unexpected"}]}\n';
    await writeFile(fixturePath, `${JSON.stringify(drifted, null, 2)}\n`, "utf8");
    await expect(verifyAgentFixtureDirectory(directory)).rejects.toThrow(/drift/i);
  });

  it("rejects token-like command arguments without exposing them", () => {
    expect(() =>
      normalizeAgentFixture({
        agent: "copilot",
        operation: "mcp-list",
        version: "0.0.356",
        command: ["copilot", "token=super-secret-command-value"],
        cwd: "/tmp/project",
        stdout: '{"servers":[]}',
        stderr: "",
        exitCode: 0,
      }),
    ).toThrow("Fixture output contains a possible secret and cannot be admitted.");
  });
});
