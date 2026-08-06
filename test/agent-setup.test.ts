import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectInstalledAgents,
  runAgentSetup,
  type AgentDetection,
} from "../src/services/agent-setup.js";

const temporaryDirectories: string[] = [];
const bundledSkillPath = path.resolve(
  process.cwd(),
  "skills",
  "structural-code-editing",
  "SKILL.md",
);

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ast-agent-setup-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createFakeAgents(root: string): Promise<{
  bin: string;
  environment: NodeJS.ProcessEnv;
  claudeState: string;
  hermesState: string;
}> {
  const bin = path.join(root, "bin");
  const claudeState = path.join(root, "claude-state.json");
  const hermesState = path.join(root, "hermes-state.json");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "package.json"), '{"type":"module"}\n', "utf8");

  const fakeAgent = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const isClaude = name === "claude";
const statePath = isClaude ? process.env.FAKE_CLAUDE_STATE : process.env.FAKE_HERMES_STATE;
const readState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;
const writeState = (value) => fs.writeFileSync(statePath, JSON.stringify(value));

if (args[0] === "--version") {
  console.log(isClaude ? "2.1.201 (Claude Code)" : "Hermes Agent v0.17.0");
  process.exit(0);
}

if (isClaude && args[0] === "mcp" && args[1] === "get") {
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
  Args: \${state.entry}\`);
  process.exit(0);
}

if (isClaude && args[0] === "mcp" && args[1] === "add") {
  const separator = args.indexOf("--");
  writeState({ command: args[separator + 1], entry: args[separator + 2] });
  console.log("Added stdio MCP server ast");
  process.exit(0);
}

if (!isClaude && args[0] === "mcp" && args[1] === "list") {
  console.log(readState() ? "ast  stdio  all  ✓ enabled" : "No MCP servers configured.");
  process.exit(0);
}

if (!isClaude && args[0] === "mcp" && args[1] === "test") {
  const state = readState();
  if (!state || state.conflict) {
    console.error("Failed to connect");
    process.exit(1);
  }
  console.log(\`Testing 'ast'...
  ✓ Connected
  ✓ Tools discovered: 15
  ast_list_files
  ast_get_project_status
  ast_explore
  ast_get_outline
  ast_get_symbol_source
  ast_search_symbols
  ast_find_references
  ast_get_impact
  ast_get_diagnostics
  ast_get_file
  ast_rename_symbol
  ast_replace_symbol_body
  ast_scaffold_class
  ast_get_operation_preview
  ast_apply_operation\`);
  process.exit(0);
}

if (!isClaude && args[0] === "mcp" && args[1] === "add") {
  const commandIndex = args.indexOf("--command");
  const argsIndex = args.indexOf("--args");
  writeState({ command: args[commandIndex + 1], entry: args[argsIndex + 1] });
  console.log("✓ Saved 'ast' (15/15 tools enabled)");
  process.exit(0);
}

console.error(\`Unsupported fake command: \${name} \${args.join(" ")}\`);
process.exit(2);
`;

  for (const name of ["claude", "hermes"]) {
    const executable = path.join(bin, name);
    await writeFile(executable, fakeAgent, "utf8");
    await chmod(executable, 0o755);
  }

  return {
    bin,
    claudeState,
    hermesState,
    environment: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      CLAUDE_CONFIG_DIR: path.join(root, "claude-home"),
      HERMES_HOME: path.join(root, "hermes-home"),
      FAKE_CLAUDE_STATE: claudeState,
      FAKE_HERMES_STATE: hermesState,
    },
  };
}

function detectionById(detections: AgentDetection[]): Record<string, AgentDetection> {
  return Object.fromEntries(detections.map((item) => [item.id, item]));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("agent setup", () => {
  it("detects installed agents and captures their real executable paths", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const detections = await detectInstalledAgents({ environment: fake.environment });
    const byId = detectionById(detections);

    expect(byId.claude.installed).toBe(true);
    expect(byId.claude.executable).toBe(path.join(fake.bin, "claude"));
    expect(byId.claude.version).toContain("2.1.201");
    expect(byId.hermes.installed).toBe(true);
    expect(byId.hermes.version).toContain("0.17.0");
  });

  it("configures MCP and skills for both agents and is idempotent", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const detections = await detectInstalledAgents({ environment: fake.environment });
    const serverEntryPath = path.join(root, "package", "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "", "utf8");

    const options = {
      agents: ["claude", "hermes"] as const,
      detections,
      environment: fake.environment,
      sourceSkillPath: bundledSkillPath,
      serverEntryPath,
      nodeExecutable: process.execPath,
    };
    const first = await runAgentSetup(options);
    const second = await runAgentSetup(options);

    expect(first.agents.map((item) => [item.agent, item.mcp, item.skill])).toEqual([
      ["claude", "configured", "installed"],
      ["hermes", "configured", "installed"],
    ]);
    expect(second.agents.map((item) => [item.agent, item.mcp, item.skill])).toEqual([
      ["claude", "unchanged", "unchanged"],
      ["hermes", "unchanged", "unchanged"],
    ]);
    await access(fake.claudeState);
    await access(fake.hermesState);

    const claudeSkill = await readFile(
      path.join(
        fake.environment.CLAUDE_CONFIG_DIR!,
        "skills",
        "structural-code-editing",
        "SKILL.md",
      ),
      "utf8",
    );
    const hermesSkill = await readFile(
      path.join(
        fake.environment.HERMES_HOME!,
        "skills",
        "software-development",
        "structural-code-editing",
        "SKILL.md",
      ),
      "utf8",
    );
    expect(claudeSkill).toBe(hermesSkill);
  });

  it("fails preflight on a conflicting MCP registration before any write", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    await writeFile(
      fake.claudeState,
      JSON.stringify({ command: "/wrong/node", entry: "/wrong/server.js" }),
      "utf8",
    );
    const detections = await detectInstalledAgents({ environment: fake.environment });
    const serverEntryPath = path.join(root, "package", "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "", "utf8");

    await expect(
      runAgentSetup({
        agents: ["claude", "hermes"],
        detections,
        environment: fake.environment,
        sourceSkillPath: bundledSkillPath,
        serverEntryPath,
        nodeExecutable: process.execPath,
      }),
    ).rejects.toThrow(/conflicting.*claude/i);

    await expect(access(fake.hermesState)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(
        path.join(
          fake.environment.CLAUDE_CONFIG_DIR!,
          "skills",
          "structural-code-editing",
          "SKILL.md",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports the setup-specific flag for a conflicting skill and updates only when forced", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const detections = await detectInstalledAgents({ environment: fake.environment });
    const serverEntryPath = path.join(root, "package", "dist", "index.js");
    const hermesSkillPath = path.join(
      fake.environment.HERMES_HOME!,
      "skills",
      "software-development",
      "structural-code-editing",
      "SKILL.md",
    );
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "", "utf8");
    await mkdir(path.dirname(hermesSkillPath), { recursive: true });
    await writeFile(hermesSkillPath, "custom skill\n", "utf8");

    const options = {
      agents: ["hermes"] as const,
      detections,
      environment: fake.environment,
      sourceSkillPath: bundledSkillPath,
      serverEntryPath,
      nodeExecutable: process.execPath,
    };

    await expect(runAgentSetup(options)).rejects.toMatchObject({
      code: "AGENT_SKILL_CONFLICT",
      message: expect.stringContaining("--force-skill"),
    });
    await expect(access(fake.hermesState)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(hermesSkillPath, "utf8")).toBe("custom skill\n");

    const result = await runAgentSetup({ ...options, forceSkill: true });
    expect(result.agents[0]).toMatchObject({
      agent: "hermes",
      mcp: "configured",
      skill: "updated",
    });
    expect(await readFile(hermesSkillPath, "utf8")).toBe(await readFile(bundledSkillPath, "utf8"));
  });

  it("rejects a requested unavailable agent before writes", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const detections = await detectInstalledAgents({
      environment: { ...fake.environment, PATH: "" },
    });

    await expect(
      runAgentSetup({
        agents: ["claude"],
        detections,
        environment: fake.environment,
        sourceSkillPath: bundledSkillPath,
        serverEntryPath: path.join(root, "dist", "index.js"),
        nodeExecutable: process.execPath,
      }),
    ).rejects.toThrow(/claude code.*not installed/i);
  });
});
