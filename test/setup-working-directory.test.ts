import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectInstalledAgents, runAgentSetup } from "../src/services/agent-setup.js";

const temporaryDirectories: string[] = [];
const bundledSkillPath = path.resolve(
  process.cwd(),
  "skills",
  "structural-code-editing",
  "SKILL.md",
);
const bundledAssets = {
  sourceSkillPath: bundledSkillPath,
  sourceGuidancePath: path.join(path.dirname(bundledSkillPath), "guidance.md"),
  releaseManifestPath: path.join(path.dirname(bundledSkillPath), "releases.json"),
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

// Mirrors the real Claude CLI: inside a directory that has its own "ast" entry, `mcp get` reports
// that entry and hides the user-scoped one.
const fakeClaude = `#!/usr/bin/env node
import fs from "node:fs";

const args = process.argv.slice(2);
const statePath = process.env.FAKE_CLAUDE_STATE;
const readState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;

if (args[0] === "--version") {
  console.log("2.1.201 (Claude Code)");
  process.exit(0);
}

fs.appendFileSync(process.env.FAKE_CLAUDE_CWD_LOG, process.cwd() + "\\n");

if (args[0] === "mcp" && args[1] === "get") {
  if (process.cwd() === process.env.FAKE_SHADOWED_DIRECTORY) {
    console.log(\`ast:
  Scope: Local config (private to you in this project)
  Status: ✔ Connected
  Type: stdio
  Command: /another/node
  Args: /another/server.js\`);
    process.exit(0);
  }
  const state = readState();
  if (!state) {
    console.error('No MCP server named "ast".');
    process.exit(1);
  }
  console.log(\`ast:
  Scope: User config (available in all your projects)
  Status: ✔ Connected
  Type: stdio
  Command: \${state.command}
  Args: \${state.entry}
  Environment:
    AST_MCP_APPLY_GUARD=\${state.guard}\`);
  process.exit(0);
}

if (args[0] === "mcp" && args[1] === "add") {
  const separator = args.indexOf("--");
  const guard = args[args.indexOf("--env") + 1].split("=")[1];
  fs.writeFileSync(statePath, JSON.stringify({ command: args[separator + 1], entry: args[separator + 2], guard }));
  console.log("Added stdio MCP server ast");
  process.exit(0);
}

console.error("Unsupported fake command: " + args.join(" "));
process.exit(2);
`;

async function createShadowedProject(): Promise<{
  options: Parameters<typeof runAgentSetup>[0];
  workingDirectoryLog: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-setup-cwd-test-"));
  temporaryDirectories.push(root);
  const bin = path.join(root, "bin");
  await mkdir(bin);
  await writeFile(path.join(bin, "package.json"), '{"type":"module"}\n', "utf8");
  await writeFile(path.join(bin, "claude"), fakeClaude, "utf8");
  await chmod(path.join(bin, "claude"), 0o755);
  const serverEntryPath = path.join(root, "package", "dist", "index.js");
  await mkdir(path.dirname(serverEntryPath), { recursive: true });
  await writeFile(serverEntryPath, "", "utf8");
  const workingDirectoryLog = path.join(root, "cwd.log");
  const environment = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
    CLAUDE_CONFIG_DIR: path.join(root, "claude-home"),
    FAKE_CLAUDE_STATE: path.join(root, "claude-state.json"),
    FAKE_CLAUDE_CWD_LOG: workingDirectoryLog,
    // Setup inherits the working directory of this process, so that is the shadowed project.
    FAKE_SHADOWED_DIRECTORY: process.cwd(),
  };
  const detections = await detectInstalledAgents({ environment });
  return {
    options: {
      agents: ["claude"],
      detections,
      environment,
      ...bundledAssets,
      serverEntryPath,
      nodeExecutable: process.execPath,
    },
    workingDirectoryLog,
  };
}

describe("setup working directory", () => {
  it("registers at user scope when another scope shadows ast in the working directory", async () => {
    const { options } = await createShadowedProject();

    const first = await runAgentSetup(options);
    const second = await runAgentSetup(options);

    expect(first.agents.map((item) => [item.agent, item.mcp])).toEqual([["claude", "configured"]]);
    expect(second.agents.map((item) => [item.agent, item.mcp])).toEqual([["claude", "unchanged"]]);
  });

  it("runs Claude from one neutral directory and removes it afterwards", async () => {
    const { options, workingDirectoryLog } = await createShadowedProject();

    await runAgentSetup(options);

    const directories = [
      ...new Set((await readFile(workingDirectoryLog, "utf8")).split("\n").filter(Boolean)),
    ];
    expect(directories).toHaveLength(1);
    expect(directories[0]).not.toBe(process.cwd());
    await expect(access(directories[0]!)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
