import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyManagedAssetPlans,
  detectInstalledAgents,
  runAgentSetup,
  type AgentDetection,
} from "../src/services/agent-setup.js";
import {
  createManagedFileApplyContext,
  verifyManagedFilePostimage,
} from "../src/services/managed-file.js";
import { planManagedGuidance } from "../src/services/managed-guidance.js";
import { planBundledSkillInstallation } from "../src/services/skill-installer.js";

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

async function writeCurrentSkillBundle(skillPath: string): Promise<void> {
  const root = path.dirname(bundledSkillPath);
  const manifest = JSON.parse(await readFile(bundledAssets.releaseManifestPath, "utf8"));
  for (const file of manifest.current.files) {
    const destination = path.join(path.dirname(skillPath), file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(path.join(root, file.path)));
  }
}

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
    if (process.env.FAKE_CONCURRENT_AFTER_MISSING_INSPECTION === "1") {
      writeState({ command: "/concurrent/node", entry: "/concurrent/server.js", guard: "deny" });
    }
    console.error('No MCP server named "ast".');
    process.exit(1);
  }
  console.log(\`ast:
  Scope: User config (available in all your projects)
  Status: ✔ Connected
  Type: stdio
  Command: \${state.command}
  Args: \${state.entry}\${state.guard ? "\\n  Environment:\\n    AST_MCP_APPLY_GUARD=" + state.guard : ""}\`);
  process.exit(0);
}

if (isClaude && args[0] === "mcp" && args[1] === "add") {
  if (readState()) {
    console.error("MCP server ast already exists in user config");
    process.exit(1);
  }
  const separator = args.indexOf("--");
  const environmentIndex = args.indexOf("--env");
  const guard = environmentIndex >= 0 ? args[environmentIndex + 1]?.split("=")[1] : undefined;
  if (guard === "allow" && process.env.FAKE_FAIL_GUARDED_ADD === "1") {
    console.error("simulated guarded registration failure");
    process.exit(1);
  }
  writeState({ command: args[separator + 1], entry: args[separator + 2], guard });
  if (guard === "allow" && process.env.FAKE_GUARDED_ADD_MUTATE_THEN_HANG === "1") {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  console.log("Added stdio MCP server ast");
  process.exit(0);
}

if (isClaude && args[0] === "mcp" && args[1] === "remove") {
  if (process.env.FAKE_UNREGISTER_MUTATE_THEN_HANG === "1") {
    fs.rmSync(statePath, { force: true });
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  if (process.env.FAKE_UNREGISTER_NO_MUTATION_THEN_HANG === "1") {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  if (!readState() && process.env.FAKE_FAIL_EMPTY_REMOVE === "1") {
    console.error("simulated cleanup failure");
    process.exit(1);
  }
  fs.rmSync(statePath, { force: true });
  console.log("Removed MCP server ast");
  process.exit(0);
}

if (!isClaude && args[0] === "mcp" && args[1] === "list") {
  console.log(readState() ? "ast  stdio  all  ✓ enabled" : "No MCP servers configured.");
  process.exit(0);
}

if (!isClaude && args[0] === "config" && args[1] === "get") {
  const state = readState();
  if (!state) process.exit(1);
  console.log(JSON.stringify({
    command: state.command,
    args: [state.entry],
    ...(state.guard ? { env: { AST_MCP_APPLY_GUARD: state.guard } } : {}),
  }));
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
  ✓ Tools discovered: \${state.guard === "allow" ? 16 : 15}
  ast_list_files
  ast_get_project_status
  ast_explore
  ast_get_outline
  ast_get_symbol_source
  ast_search_symbols
  ast_find_references
  ast_get_impact
  ast_find_test_candidates
  ast_get_diagnostics
  ast_get_file
  ast_rename_symbol
  ast_replace_symbol_body
  ast_scaffold_class
  ast_get_operation_preview\${state.guard === "allow" ? "\\n  ast_apply_operation" : ""}\`);
  process.exit(0);
}

if (!isClaude && args[0] === "mcp" && args[1] === "add") {
  if (readState()) {
    console.error("MCP server ast already exists");
    process.exit(1);
  }
  const commandIndex = args.indexOf("--command");
  const argsIndex = args.indexOf("--args");
  const environmentIndex = args.indexOf("--env");
  const guard = environmentIndex >= 0 ? args[environmentIndex + 1]?.split("=")[1] : undefined;
  if (guard === "allow" && process.env.FAKE_FAIL_GUARDED_ADD === "1") {
    console.error("simulated guarded registration failure");
    process.exit(1);
  }
  writeState({ command: args[commandIndex + 1], entry: args[argsIndex + 1], guard });
  console.log("✓ Saved 'ast' (16/16 tools enabled)");
  process.exit(0);
}

if (!isClaude && args[0] === "mcp" && args[1] === "remove") {
  fs.rmSync(statePath, { force: true });
  console.log("Removed MCP server ast");
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
      PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
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
    expect(detections.map((item) => item.id)).toEqual([
      "claude",
      "hermes",
      "opencode",
      "codex",
      "gemini",
      "copilot",
    ]);
    expect(byId.claude.compatibility).toMatchObject({ status: "compatible" });
    expect(byId.opencode.compatibility).toMatchObject({ status: "unavailable" });
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
      ...bundledAssets,
      serverEntryPath,
      nodeExecutable: process.execPath,
    };
    const first = await runAgentSetup(options);
    const second = await runAgentSetup(options);

    expect(first.agents.map((item) => [item.agent, item.mcp, item.skill, item.guidance])).toEqual([
      ["claude", "configured", "installed", "installed"],
      ["hermes", "configured", "installed", "skill_only"],
    ]);
    expect(second.agents.map((item) => [item.agent, item.mcp, item.skill, item.guidance])).toEqual([
      ["claude", "unchanged", "unchanged", "unchanged"],
      ["hermes", "unchanged", "unchanged", "skill_only"],
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
    expect(first).toMatchObject({
      version: 2,
      status: "ok",
      command: "setup",
      correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(first.physical_writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ asset: "skill", status: "installed" }),
        expect.objectContaining({ asset: "guidance", status: "installed" }),
      ]),
    );
    expect(first.physical_writes).toHaveLength(5);
    expect(second.physical_writes).toEqual([]);
    expect(
      await readFile(path.join(fake.environment.CLAUDE_CONFIG_DIR!, "CLAUDE.md"), "utf8"),
    ).toContain("ast-tool:structural-code-editing guidance v1 begin");
  });

  it("repairs exact legacy registrations that predate the explicit apply opt-in", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const serverEntryPath = path.join(root, "package", "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "", "utf8");
    const legacy = { command: process.execPath, entry: serverEntryPath };
    await writeFile(fake.claudeState, JSON.stringify(legacy), "utf8");
    await writeFile(fake.hermesState, JSON.stringify(legacy), "utf8");
    const detections = await detectInstalledAgents({ environment: fake.environment });

    const result = await runAgentSetup({
      agents: ["claude", "hermes"],
      detections,
      environment: fake.environment,
      ...bundledAssets,
      serverEntryPath,
      nodeExecutable: process.execPath,
    });

    expect(result.agents.map((item) => [item.agent, item.mcp])).toEqual([
      ["claude", "configured"],
      ["hermes", "configured"],
    ]);
    expect(JSON.parse(await readFile(fake.claudeState, "utf8"))).toEqual({
      ...legacy,
      guard: "allow",
    });
    expect(JSON.parse(await readFile(fake.hermesState, "utf8"))).toEqual({
      ...legacy,
      guard: "allow",
    });
  });

  it("restores an exact legacy registration when guarded re-registration fails", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const serverEntryPath = path.join(root, "package", "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "", "utf8");
    const legacy = { command: process.execPath, entry: serverEntryPath };
    await writeFile(fake.claudeState, JSON.stringify(legacy), "utf8");
    const detections = await detectInstalledAgents({ environment: fake.environment });

    await expect(
      runAgentSetup({
        agents: ["claude"],
        detections,
        environment: { ...fake.environment, FAKE_FAIL_GUARDED_ADD: "1" },
        ...bundledAssets,
        serverEntryPath,
        nodeExecutable: process.execPath,
      }),
    ).rejects.toMatchObject({ code: "AGENT_COMMAND_FAILED" });

    expect(JSON.parse(await readFile(fake.claudeState, "utf8"))).toEqual(legacy);
  });

  it("attempts and verifies rollback even when failed-repair cleanup also fails", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const serverEntryPath = path.join(root, "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "");
    const legacy = { command: process.execPath, entry: serverEntryPath };
    await writeFile(fake.claudeState, JSON.stringify(legacy));
    const detections = await detectInstalledAgents({ environment: fake.environment });

    await expect(
      runAgentSetup({
        agents: ["claude"],
        detections,
        environment: {
          ...fake.environment,
          FAKE_FAIL_GUARDED_ADD: "1",
          FAKE_FAIL_EMPTY_REMOVE: "1",
        },
        ...bundledAssets,
        serverEntryPath,
        nodeExecutable: process.execPath,
      }),
    ).rejects.toMatchObject({ code: "AGENT_COMMAND_FAILED" });
    expect(JSON.parse(await readFile(fake.claudeState, "utf8"))).toEqual(legacy);
  });

  it.each([
    ["FAKE_UNREGISTER_MUTATE_THEN_HANG", true],
    ["FAKE_UNREGISTER_NO_MUTATION_THEN_HANG", false],
  ] as const)(
    "inspects ambiguous unregister outcome %s before deciding whether to restore",
    async (failureFlag, mutated) => {
      const root = await makeTemporaryDirectory();
      const fake = await createFakeAgents(root);
      const serverEntryPath = path.join(root, "dist", "index.js");
      await mkdir(path.dirname(serverEntryPath), { recursive: true });
      await writeFile(serverEntryPath, "");
      const legacy = { command: process.execPath, entry: serverEntryPath };
      await writeFile(fake.claudeState, JSON.stringify(legacy));
      const detections = await detectInstalledAgents({ environment: fake.environment });

      await expect(
        runAgentSetup({
          agents: ["claude"],
          detections,
          environment: { ...fake.environment, [failureFlag]: "1" },
          commandTimeoutMs: 150,
          ...bundledAssets,
          serverEntryPath,
          nodeExecutable: process.execPath,
        }),
      ).rejects.toMatchObject({ code: "AGENT_COMMAND_TIMEOUT" });

      expect(JSON.parse(await readFile(fake.claudeState, "utf8"))).toEqual(legacy);
      if (!mutated) {
        // A duplicate legacy add would fail because the authenticated preimage still exists,
        // replacing the original timeout with AGENT_VERIFICATION_FAILED.
        expect(await readFile(fake.claudeState, "utf8")).toBe(JSON.stringify(legacy));
      }
    },
  );

  it("preserves a concurrent replacement installed after missing recovery classification", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const serverEntryPath = path.join(root, "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "");
    await writeFile(
      fake.claudeState,
      JSON.stringify({ command: process.execPath, entry: serverEntryPath }),
    );
    const detections = await detectInstalledAgents({ environment: fake.environment });

    await expect(
      runAgentSetup({
        agents: ["claude"],
        detections,
        environment: {
          ...fake.environment,
          FAKE_UNREGISTER_MUTATE_THEN_HANG: "1",
          FAKE_CONCURRENT_AFTER_MISSING_INSPECTION: "1",
        },
        commandTimeoutMs: 150,
        ...bundledAssets,
        serverEntryPath,
        nodeExecutable: process.execPath,
      }),
    ).rejects.toMatchObject({ code: "AGENT_MCP_CONFLICT" });
    expect(JSON.parse(await readFile(fake.claudeState, "utf8"))).toEqual({
      command: "/concurrent/node",
      entry: "/concurrent/server.js",
      guard: "deny",
    });
  });

  it("treats an exact modern postimage as committed after guarded-add acknowledgement is lost", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const serverEntryPath = path.join(root, "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "");
    await writeFile(
      fake.claudeState,
      JSON.stringify({ command: process.execPath, entry: serverEntryPath }),
    );
    const detections = await detectInstalledAgents({ environment: fake.environment });

    const result = await runAgentSetup({
      agents: ["claude"],
      detections,
      environment: { ...fake.environment, FAKE_GUARDED_ADD_MUTATE_THEN_HANG: "1" },
      commandTimeoutMs: 150,
      ...bundledAssets,
      serverEntryPath,
      nodeExecutable: process.execPath,
    });

    expect(result.agents[0]?.mcp).toBe("configured");
    expect(JSON.parse(await readFile(fake.claudeState, "utf8"))).toEqual({
      command: process.execPath,
      entry: serverEntryPath,
      guard: "allow",
    });
  });

  it.each(["codex", "gemini", "copilot"] as const)(
    "restores an authenticated legacy %s registration after guarded add fails",
    async (agent) => {
      const root = await makeTemporaryDirectory();
      const bin = path.join(root, "bin");
      const executable = path.join(bin, agent);
      const state = path.join(root, `${agent}-state.json`);
      const serverEntryPath = path.join(root, "dist", "index.js");
      await mkdir(bin, { recursive: true });
      await mkdir(path.dirname(serverEntryPath), { recursive: true });
      await writeFile(serverEntryPath, "");
      await writeFile(state, JSON.stringify({ command: process.execPath, entry: serverEntryPath }));
      await writeFile(executable, await readFile(path.resolve("scripts/fixtures/fake-agent.mjs")));
      await chmod(executable, 0o755);
      const environment = {
        ...process.env,
        HOME: root,
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
        [`FAKE_${agent.toUpperCase()}_STATE`]: state,
        FAKE_FAIL_GUARDED_ADD: "1",
      };

      await expect(
        runAgentSetup({
          agents: [agent],
          detections: [
            {
              id: agent,
              label: agent,
              installed: true,
              executable,
              compatibility: {
                status: "compatible",
                contract: `${agent}-mcp-v1`,
                version: "1.0.0",
              },
            },
          ],
          environment,
          ...bundledAssets,
          serverEntryPath,
          nodeExecutable: process.execPath,
        }),
      ).rejects.toMatchObject({ code: "AGENT_COMMAND_FAILED" });

      expect(JSON.parse(await readFile(state, "utf8"))).toEqual({
        command: process.execPath,
        entry: serverEntryPath,
      });
    },
  );

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
        ...bundledAssets,
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
      ...bundledAssets,
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
        ...bundledAssets,
        serverEntryPath: path.join(root, "dist", "index.js"),
        nodeExecutable: process.execPath,
      }),
    ).rejects.toThrow(/claude code.*not installed/i);
  });

  it("rejects incompatible detected evidence before artifact or skill writes", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const serverEntryPath = path.join(root, "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "", "utf8");
    const detections: AgentDetection[] = [
      {
        id: "codex",
        label: "Codex CLI",
        installed: true,
        executable: path.join(fake.bin, "hermes"),
        version: "unknown",
        compatibility: { status: "incompatible", reason: "Unknown version contract." },
      },
    ];
    await expect(
      runAgentSetup({
        agents: ["codex"],
        detections,
        environment: fake.environment,
        ...bundledAssets,
        serverEntryPath,
      }),
    ).rejects.toMatchObject({ code: "AGENT_INCOMPATIBLE" });
    await expect(access(path.join(root, ".agents", "skills"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("bounds and redacts command failures while retaining completed outcomes for retry", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const failing = path.join(fake.bin, "codex");
    await writeFile(
      failing,
      `#!/usr/bin/env node\nif (process.argv[2] === "get") { console.error("secret=ghp_abcdefghijklmnopqrstuvwxyz123456 /private/path"); process.exit(9); } console.log("codex-cli 0.144.0");\n`,
    );
    await chmod(failing, 0o755);
    const detections = await detectInstalledAgents({ environment: fake.environment });
    const serverEntryPath = path.join(root, "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "", "utf8");
    await expect(
      runAgentSetup({
        agents: ["claude", "codex"],
        detections,
        environment: fake.environment,
        ...bundledAssets,
        serverEntryPath,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      const serialized = JSON.stringify(error);
      return (
        serialized.length < 4000 &&
        !serialized.includes("ghp_") &&
        !serialized.includes("/private/path")
      );
    });
    await expect(access(fake.claudeState)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("migrates an exact legacy OpenCode registration through the setup flow", async () => {
    const root = await makeTemporaryDirectory();
    const selectedConfig = path.join(root, "config", "opencode.json");
    const serverEntryPath = path.join(root, "dist", "index.js");
    const executable = path.join(root, "opencode");
    await mkdir(path.dirname(selectedConfig), { recursive: true });
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "");
    await writeFile(
      selectedConfig,
      `${JSON.stringify({
        theme: "dark",
        mcp: {
          ast: { type: "local", command: [process.execPath, serverEntryPath], enabled: true },
        },
      })}\n`,
    );
    await writeFile(
      executable,
      `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv[2] === "debug" && process.argv[3] === "config") {
  console.log(fs.readFileSync(process.env.OPENCODE_CONFIG, "utf8"));
} else if (process.argv[2] === "mcp" && process.argv[3] === "list") {
  console.log("ast connected");
} else console.log("1.18.18");
`,
    );
    await chmod(executable, 0o755);
    const environment = {
      ...process.env,
      HOME: root,
      OPENCODE_CONFIG: selectedConfig,
      OPENCODE_CONFIG_DIR: path.dirname(selectedConfig),
    };

    const result = await runAgentSetup({
      agents: ["opencode"],
      detections: [
        {
          id: "opencode",
          label: "OpenCode",
          installed: true,
          executable,
          compatibility: {
            status: "compatible",
            contract: "opencode-mcp-v1",
            version: "1.18.18",
          },
        },
      ],
      environment,
      ...bundledAssets,
      serverEntryPath,
      nodeExecutable: process.execPath,
    });

    expect(result.agents[0]?.mcp).toBe("configured");
    const updated = JSON.parse(await readFile(selectedConfig, "utf8"));
    expect(updated.theme).toBe("dark");
    expect(updated.mcp.ast.environment).toEqual({ AST_MCP_APPLY_GUARD: "allow" });
  });

  it("keeps an exact committed OpenCode postimage when acknowledgement verification fails", async () => {
    const root = await makeTemporaryDirectory();
    const selectedConfig = path.join(root, "config", "opencode.json");
    const serverEntryPath = path.join(root, "dist", "index.js");
    const executable = path.join(root, "opencode");
    const counter = path.join(root, "debug-count");
    const original = `${JSON.stringify({
      marker: "preserve",
      mcp: { ast: { type: "local", command: [process.execPath, serverEntryPath], enabled: true } },
    })}\n`;
    await mkdir(path.dirname(selectedConfig), { recursive: true });
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "");
    await writeFile(selectedConfig, original);
    await writeFile(
      executable,
      `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv[2] === "debug" && process.argv[3] === "config") {
  const count = fs.existsSync(process.env.FAKE_COUNTER) ? Number(fs.readFileSync(process.env.FAKE_COUNTER, "utf8")) : 0;
  fs.writeFileSync(process.env.FAKE_COUNTER, String(count + 1));
  if (count === 0) console.log(fs.readFileSync(process.env.OPENCODE_CONFIG, "utf8"));
  else console.log(JSON.stringify({mcp:{ast:{type:"local",command:["/wrong"],enabled:true}}}));
} else if (process.argv[2] === "mcp") console.log("ast connected");
else console.log("1.18.18");
`,
    );
    await chmod(executable, 0o755);
    const environment = {
      ...process.env,
      HOME: root,
      OPENCODE_CONFIG: selectedConfig,
      OPENCODE_CONFIG_DIR: path.dirname(selectedConfig),
      FAKE_COUNTER: counter,
    };

    const result = await runAgentSetup({
      agents: ["opencode"],
      detections: [
        {
          id: "opencode",
          label: "OpenCode",
          installed: true,
          executable,
          compatibility: {
            status: "compatible",
            contract: "opencode-mcp-v1",
            version: "1.18.18",
          },
        },
      ],
      environment,
      ...bundledAssets,
      serverEntryPath,
      nodeExecutable: process.execPath,
    });
    expect(result.agents[0]?.mcp).toBe("configured");
    expect(await readFile(selectedConfig, "utf8")).not.toBe(original);
    expect(await readFile(selectedConfig, "utf8")).toContain("AST_MCP_APPLY_GUARD");
  });

  it("rejects an effective OpenCode conflict before skill or config writes", async () => {
    const root = await makeTemporaryDirectory();
    const selectedConfig = path.join(root, "selected.json");
    const serverEntryPath = path.join(root, "dist", "index.js");
    const executable = path.join(root, "opencode");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(selectedConfig, "{}\n");
    await writeFile(serverEntryPath, "");
    await writeFile(
      executable,
      '#!/usr/bin/env node\nif (process.argv[3] === "config") console.log(JSON.stringify({mcp:{ast:{command:["/wrong"]}}})); else console.log("1.18.18");\n',
    );
    await chmod(executable, 0o755);
    const environment = {
      ...process.env,
      HOME: root,
      OPENCODE_CONFIG: selectedConfig,
      OPENCODE_CONFIG_DIR: path.join(root, "config-dir"),
    };

    await expect(
      runAgentSetup({
        agents: ["opencode"],
        detections: [
          {
            id: "opencode",
            label: "OpenCode",
            installed: true,
            executable,
            compatibility: {
              status: "compatible",
              contract: "opencode-mcp-v1",
              version: "1.18.18",
            },
          },
        ],
        environment,
        ...bundledAssets,
        serverEntryPath,
        nodeExecutable: process.execPath,
      }),
    ).rejects.toMatchObject({ code: "AGENT_MCP_CONFLICT" });
    expect(await readFile(selectedConfig, "utf8")).toBe("{}\n");
    await expect(access(path.join(root, ".agents", "skills"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("isolates mutating OpenCode effective-config discovery from the real config", async () => {
    const root = await makeTemporaryDirectory();
    const selectedConfig = path.join(root, "config", "opencode.json");
    const serverEntryPath = path.join(root, "dist", "index.js");
    const executable = path.join(root, "opencode");
    const invalidManifestPath = path.join(root, "releases.json");
    await mkdir(path.dirname(selectedConfig), { recursive: true });
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(selectedConfig, "{}\n");
    await writeFile(serverEntryPath, "");
    await writeFile(invalidManifestPath, "{}\n");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.argv[2] === "debug" && process.argv[3] === "config") {
  fs.writeFileSync(process.env.OPENCODE_CONFIG, '{"$schema":"mutated"}\\n');
  fs.writeFileSync(path.join(process.env.OPENCODE_CONFIG_DIR, "opencode.json"), '{"$schema":"mutated"}\\n');
  console.log(JSON.stringify({}));
} else console.log("1.18.18");
`,
    );
    await chmod(executable, 0o755);
    const environment = {
      ...process.env,
      HOME: root,
      OPENCODE_CONFIG: selectedConfig,
      OPENCODE_CONFIG_DIR: path.dirname(selectedConfig),
    };

    let rejection: unknown;
    try {
      await runAgentSetup({
        agents: ["opencode"],
        detections: [
          {
            id: "opencode",
            label: "OpenCode",
            installed: true,
            executable,
            compatibility: {
              status: "compatible",
              contract: "opencode-mcp-v1",
              version: "1.18.18",
            },
          },
        ],
        environment,
        ...bundledAssets,
        releaseManifestPath: invalidManifestPath,
        serverEntryPath,
        nodeExecutable: process.execPath,
      });
    } catch (error) {
      rejection = error;
    }

    expect(await readFile(selectedConfig, "utf8")).toBe("{}\n");
    expect(rejection).toMatchObject({ code: "SETUP_ASSET_INVALID" });
    await expect(access(path.join(root, ".agents", "skills"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stops a post-preflight race before the first managed write", async () => {
    const root = await makeTemporaryDirectory();
    const claudeRoot = path.join(root, "claude");
    const guidancePath = path.join(claudeRoot, "CLAUDE.md");
    const skillPlan = await planBundledSkillInstallation({
      target: ["claude"],
      scope: "user",
      force: false,
      sourceSkillPath: bundledAssets.sourceSkillPath,
      releaseManifestPath: bundledAssets.releaseManifestPath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });
    const guidancePlan = await planManagedGuidance({
      agents: ["claude"],
      sourceGuidancePath: bundledAssets.sourceGuidancePath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });
    await mkdir(path.dirname(guidancePath), { recursive: true });
    await writeFile(guidancePath, "concurrent human policy\n", "utf8");

    let rejection: unknown;
    try {
      await applyManagedAssetPlans(skillPlan, guidancePlan);
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toMatchObject({
      code: "AGENT_ASSET_APPLY_FAILED",
      details: {
        completed_writes: [],
        pending: [
          expect.objectContaining({ asset: "skill", status: "installed" }),
          expect.objectContaining({ asset: "skill", status: "installed" }),
          expect.objectContaining({ path: guidancePath, asset: "guidance" }),
        ],
      },
    });
    expect(await readFile(guidancePath, "utf8")).toBe("concurrent human policy\n");
    await expect(
      access(path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("revalidates unchanged assets before applying any later managed write", async () => {
    const root = await makeTemporaryDirectory();
    const claudeRoot = path.join(root, "claude");
    const skillPath = path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md");
    const guidancePath = path.join(claudeRoot, "CLAUDE.md");
    await writeCurrentSkillBundle(skillPath);

    const skillPlan = await planBundledSkillInstallation({
      target: ["claude"],
      scope: "user",
      force: false,
      sourceSkillPath: bundledAssets.sourceSkillPath,
      releaseManifestPath: bundledAssets.releaseManifestPath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });
    const guidancePlan = await planManagedGuidance({
      agents: ["claude"],
      sourceGuidancePath: bundledAssets.sourceGuidancePath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });
    expect(skillPlan.files[0]?.status).toBe("unchanged");
    await writeFile(skillPath, "concurrent custom skill\n");

    await expect(applyManagedAssetPlans(skillPlan, guidancePlan)).rejects.toMatchObject({
      code: "AGENT_ASSET_APPLY_FAILED",
      details: {
        completed_writes: [],
        pending: [expect.objectContaining({ path: guidancePath, asset: "guidance" })],
      },
    });
    expect(await readFile(skillPath, "utf8")).toBe("concurrent custom skill\n");
    await expect(access(guidancePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an identical-byte unchanged asset inode replaced before a later setup phase", async () => {
    const root = await makeTemporaryDirectory();
    const claudeRoot = path.join(root, "claude");
    const skillPath = path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md");
    await writeCurrentSkillBundle(skillPath);

    const skillPlan = await planBundledSkillInstallation({
      target: ["claude"],
      scope: "user",
      force: false,
      sourceSkillPath: bundledAssets.sourceSkillPath,
      releaseManifestPath: bundledAssets.releaseManifestPath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });
    const guidancePlan = await planManagedGuidance({
      agents: [],
      sourceGuidancePath: bundledAssets.sourceGuidancePath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });
    const context = createManagedFileApplyContext();
    await applyManagedAssetPlans(skillPlan, guidancePlan, context);
    const replacement = path.join(path.dirname(skillPath), ".replacement");
    await writeFile(replacement, await readFile(skillPath));
    await rename(replacement, skillPath);

    await expect(verifyManagedFilePostimage(skillPlan.files[0]!, context)).rejects.toThrow(
      /postimage.*no longer current/i,
    );
  });

  it.runIf(process.platform === "linux")(
    "reports a committed write when post-commit verification fails",
    async () => {
      const root = await makeTemporaryDirectory();
      const claudeRoot = path.join(root, "claude");
      const guidancePath = path.join(claudeRoot, "CLAUDE.md");
      await mkdir(claudeRoot);
      await writeFile(guidancePath, "before\n");
      await chmod(guidancePath, 0o640);
      const skillPlan = await planBundledSkillInstallation({
        target: [],
        scope: "user",
        force: false,
        sourceSkillPath: bundledAssets.sourceSkillPath,
        releaseManifestPath: bundledAssets.releaseManifestPath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });
      const guidancePlan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath: bundledAssets.sourceGuidancePath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });

      await expect(
        applyManagedAssetPlans(skillPlan, guidancePlan, createManagedFileApplyContext(), {
          afterCommit: async () => chmod(guidancePath, 0o600),
        }),
      ).rejects.toMatchObject({
        code: "AGENT_ASSET_APPLY_FAILED",
        details: {
          completed_writes: [{ path: guidancePath, asset: "guidance", status: "updated" }],
          possibly_committed: [],
          pending: [],
        },
      });
      expect(await readFile(guidancePath, "utf8")).toContain("guidance v1 begin");
    },
  );

  it.runIf(process.platform === "linux")(
    "reports a replaced post-commit destination as possibly committed instead of pending",
    async () => {
      const root = await makeTemporaryDirectory();
      const claudeRoot = path.join(root, "claude");
      const guidancePath = path.join(claudeRoot, "CLAUDE.md");
      const replacement = path.join(claudeRoot, ".replacement");
      await mkdir(claudeRoot);
      await writeFile(guidancePath, "before\n");
      const skillPlan = await planBundledSkillInstallation({
        target: [],
        scope: "user",
        force: false,
        sourceSkillPath: bundledAssets.sourceSkillPath,
        releaseManifestPath: bundledAssets.releaseManifestPath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });
      const guidancePlan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath: bundledAssets.sourceGuidancePath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });

      await expect(
        applyManagedAssetPlans(skillPlan, guidancePlan, createManagedFileApplyContext(), {
          afterCommit: async () => {
            await writeFile(replacement, "concurrent post-commit content\n");
            await rename(replacement, guidancePath);
          },
        }),
      ).rejects.toMatchObject({
        code: "AGENT_ASSET_APPLY_FAILED",
        details: {
          completed_writes: [],
          possibly_committed: [{ path: guidancePath, asset: "guidance", status: "updated" }],
          pending: [],
        },
      });
      expect(await readFile(guidancePath, "utf8")).toBe("concurrent post-commit content\n");
    },
  );

  it.runIf(process.platform === "linux")(
    "classifies a post-commit hook failure as committed instead of pending",
    async () => {
      const root = await makeTemporaryDirectory();
      const claudeRoot = path.join(root, "claude");
      const guidancePath = path.join(claudeRoot, "CLAUDE.md");
      await mkdir(claudeRoot);
      await writeFile(guidancePath, "before\n");
      const skillPlan = await planBundledSkillInstallation({
        target: [],
        scope: "user",
        force: false,
        sourceSkillPath: bundledAssets.sourceSkillPath,
        releaseManifestPath: bundledAssets.releaseManifestPath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });
      const guidancePlan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath: bundledAssets.sourceGuidancePath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });

      await expect(
        applyManagedAssetPlans(skillPlan, guidancePlan, createManagedFileApplyContext(), {
          afterCommit: () => {
            throw new Error("injected post-commit failure");
          },
        }),
      ).rejects.toMatchObject({
        code: "AGENT_ASSET_APPLY_FAILED",
        details: {
          completed_writes: [{ path: guidancePath, asset: "guidance", status: "updated" }],
          possibly_committed: [],
          pending: [],
        },
      });
      expect(await readFile(guidancePath, "utf8")).toContain("guidance v1 begin");
    },
  );

  it.runIf(process.platform === "linux")(
    "reports a successful exact-pair rollback separately while keeping the asset pending",
    async () => {
      const root = await makeTemporaryDirectory();
      const claudeRoot = path.join(root, "claude");
      const guidancePath = path.join(claudeRoot, "CLAUDE.md");
      const replacement = path.join(claudeRoot, ".replacement");
      await mkdir(claudeRoot);
      await writeFile(guidancePath, "before\n");
      const skillPlan = await planBundledSkillInstallation({
        target: [],
        scope: "user",
        force: false,
        sourceSkillPath: bundledAssets.sourceSkillPath,
        releaseManifestPath: bundledAssets.releaseManifestPath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });
      const guidancePlan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath: bundledAssets.sourceGuidancePath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });
      const write = { path: guidancePath, asset: "guidance", status: "updated" };

      await expect(
        applyManagedAssetPlans(skillPlan, guidancePlan, createManagedFileApplyContext(), {
          afterDestinationRevalidated: async () => {
            await writeFile(replacement, "before\n");
            await rename(replacement, guidancePath);
          },
        }),
      ).rejects.toMatchObject({
        code: "AGENT_ASSET_APPLY_FAILED",
        details: {
          completed_writes: [],
          possibly_committed: [],
          rolled_back: [write],
          rollback_failed: [],
          pending: [write],
        },
      });
      expect(await readFile(guidancePath, "utf8")).toBe("before\n");
    },
  );

  it.runIf(process.platform === "linux")(
    "reports a same-inode concurrent edit as rolled back and pending",
    async () => {
      const root = await makeTemporaryDirectory();
      const claudeRoot = path.join(root, "claude");
      const guidancePath = path.join(claudeRoot, "CLAUDE.md");
      await mkdir(claudeRoot);
      await writeFile(guidancePath, "before\n");
      const skillPlan = await planBundledSkillInstallation({
        target: [],
        scope: "user",
        force: false,
        sourceSkillPath: bundledAssets.sourceSkillPath,
        releaseManifestPath: bundledAssets.releaseManifestPath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });
      const guidancePlan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath: bundledAssets.sourceGuidancePath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });
      const write = { path: guidancePath, asset: "guidance", status: "updated" };

      await expect(
        applyManagedAssetPlans(skillPlan, guidancePlan, createManagedFileApplyContext(), {
          afterDestinationRevalidated: async () => {
            await writeFile(guidancePath, "concurrent human policy\n");
          },
        }),
      ).rejects.toMatchObject({
        code: "AGENT_ASSET_APPLY_FAILED",
        details: {
          completed_writes: [],
          possibly_committed: [],
          rolled_back: [write],
          rollback_failed: [],
          pending: [write],
        },
      });
      expect(await readFile(guidancePath, "utf8")).toBe("concurrent human policy\n");
    },
  );

  it.runIf(process.platform === "linux")(
    "reports failed rollback separately from a possibly committed operation",
    async () => {
      const root = await makeTemporaryDirectory();
      const claudeRoot = path.join(root, "claude");
      const guidancePath = path.join(claudeRoot, "CLAUDE.md");
      const replacement = path.join(claudeRoot, ".replacement");
      await mkdir(claudeRoot);
      await writeFile(guidancePath, "before\n");
      const skillPlan = await planBundledSkillInstallation({
        target: [],
        scope: "user",
        force: false,
        sourceSkillPath: bundledAssets.sourceSkillPath,
        releaseManifestPath: bundledAssets.releaseManifestPath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });
      const guidancePlan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath: bundledAssets.sourceGuidancePath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      });
      const write = { path: guidancePath, asset: "guidance", status: "updated" };

      await expect(
        applyManagedAssetPlans(skillPlan, guidancePlan, createManagedFileApplyContext(), {
          afterDestinationRevalidated: async () => {
            await writeFile(replacement, "before\n");
            await rename(replacement, guidancePath);
          },
          beforeRollback: () => {
            throw new Error("injected rollback failure");
          },
        }),
      ).rejects.toMatchObject({
        code: "AGENT_ASSET_APPLY_FAILED",
        details: {
          completed_writes: [],
          possibly_committed: [write],
          rolled_back: [],
          rollback_failed: [write],
          pending: [],
        },
      });
      expect(await readFile(guidancePath, "utf8")).toContain("guidance v1 begin");
    },
  );

  it("rejects a guidance conflict before any skill or MCP write", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const claudeGuidance = path.join(fake.environment.CLAUDE_CONFIG_DIR!, "CLAUDE.md");
    const serverEntryPath = path.join(root, "dist", "index.js");
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await mkdir(path.dirname(claudeGuidance), { recursive: true });
    await writeFile(serverEntryPath, "", "utf8");
    await writeFile(
      claudeGuidance,
      "human\n<!-- ast-tool:structural-code-editing guidance v2 begin -->\nunknown\n",
      "utf8",
    );
    const detections = await detectInstalledAgents({ environment: fake.environment });

    await expect(
      runAgentSetup({
        agents: ["claude", "hermes"],
        detections,
        environment: fake.environment,
        ...bundledAssets,
        serverEntryPath,
        nodeExecutable: process.execPath,
        forceSkill: true,
      }),
    ).rejects.toMatchObject({ code: "AGENT_GUIDANCE_CONFLICT" });

    expect(await readFile(claudeGuidance, "utf8")).toContain("guidance v2 begin");
    await expect(access(fake.claudeState)).rejects.toMatchObject({ code: "ENOENT" });
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

  it("rejects a source and release-manifest mismatch before any write", async () => {
    const root = await makeTemporaryDirectory();
    const fake = await createFakeAgents(root);
    const serverEntryPath = path.join(root, "dist", "index.js");
    const releaseManifestPath = path.join(root, "releases.json");
    const manifest = JSON.parse(await readFile(bundledAssets.releaseManifestPath, "utf8"));
    manifest.current.sha256 = "0".repeat(64);
    await mkdir(path.dirname(serverEntryPath), { recursive: true });
    await writeFile(serverEntryPath, "", "utf8");
    await writeFile(releaseManifestPath, JSON.stringify(manifest), "utf8");
    const detections = await detectInstalledAgents({ environment: fake.environment });

    await expect(
      runAgentSetup({
        agents: ["claude", "hermes"],
        detections,
        environment: fake.environment,
        ...bundledAssets,
        releaseManifestPath,
        serverEntryPath,
        nodeExecutable: process.execPath,
      }),
    ).rejects.toMatchObject({ code: "SETUP_ASSET_INVALID" });

    await expect(access(fake.claudeState)).rejects.toMatchObject({ code: "ENOENT" });
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
    await expect(
      access(path.join(fake.environment.CLAUDE_CONFIG_DIR!, "CLAUDE.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
