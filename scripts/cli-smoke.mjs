#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { decode } from "@toon-format/toon";

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "dist/cli.js");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ast-tool-cli-"));
const stateDirectory = path.join(fixtureRoot, "state");
const claudeConfigDirectory = path.join(fixtureRoot, "claude");
const hermesHome = path.join(fixtureRoot, "hermes");
const fakeBin = path.join(fixtureRoot, "bin");
const fakeClaudeState = path.join(fixtureRoot, "fake-claude-state.json");
const fakeHermesState = path.join(fixtureRoot, "fake-hermes-state.json");
const environment = {
  ...process.env,
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
  AST_TOOL_STATE_DIR: stateDirectory,
  CLAUDE_CONFIG_DIR: claudeConfigDirectory,
  HERMES_HOME: hermesHome,
  FAKE_CLAUDE_STATE: fakeClaudeState,
  FAKE_HERMES_STATE: fakeHermesState,
};

async function invoke(args) {
  const { stdout, stderr } = await executeFile(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    env: environment,
    maxBuffer: 12 * 1024 * 1024,
  });
  if (stderr !== "") throw new Error(`Expected empty stderr, received: ${stderr}`);
  return JSON.parse(stdout);
}

async function invokeRaw(args) {
  const { stdout, stderr } = await executeFile(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    env: environment,
    maxBuffer: 12 * 1024 * 1024,
  });
  if (stderr !== "") throw new Error(`Expected empty stderr, received: ${stderr}`);
  return stdout.trimEnd();
}

async function invokeFailure(args) {
  try {
    await executeFile(process.execPath, [cliPath, ...args], {
      cwd: repositoryRoot,
      env: environment,
      maxBuffer: 12 * 1024 * 1024,
    });
    throw new Error(`CLI unexpectedly succeeded: ${args.join(" ")}`);
  } catch (error) {
    if (typeof error?.code !== "number") throw error;
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function invokeWithStdin(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`CLI exited ${code}: ${stderr}`));
      } else if (stderr !== "") {
        reject(new Error(`Expected empty stderr, received: ${stderr}`));
      } else {
        resolve(JSON.parse(stdout));
      }
    });
    child.stdin.end(input);
  });
}

async function holdWorkspaceLock(workspaceKey) {
  const source = `
    import { withWorkspaceFileLock } from "./dist/services/runtime-state.js";
    await withWorkspaceFileLock(process.argv[1], {}, async () => {
      process.stdout.write("locked\\n");
      await new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.once("end", resolve);
      });
    });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source, workspaceKey], {
    cwd: repositoryRoot,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  await new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Lock holder exited ${code}: ${stderr}`)));
    child.stdout.once("data", (chunk) => {
      if (!chunk.includes("locked")) reject(new Error(`Unexpected lock holder output: ${chunk}`));
      else resolve();
    });
  });
  return async () => {
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`Lock holder exited ${code}.`)),
      );
    });
    child.stdin.end();
    await closed;
  };
}

async function installFakeAgents() {
  await mkdir(fakeBin, { recursive: true });
  const fixture = path.join(repositoryRoot, "scripts", "fixtures", "fake-agent.mjs");
  for (const agent of ["claude", "hermes"]) {
    const executable = path.join(fakeBin, agent);
    await copyFile(fixture, executable);
    await chmod(executable, 0o755);
  }
}

try {
  await installFakeAgents();
  await mkdir(path.join(fixtureRoot, "src"), { recursive: true });
  await writeFile(
    path.join(fixtureRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
      },
      include: ["src/**/*"],
    }),
  );
  await writeFile(
    path.join(fixtureRoot, "src/value.ts"),
    "export function formatValue(value: number): string { return String(value); }\n",
  );
  await writeFile(
    path.join(fixtureRoot, "src/use.ts"),
    'import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n',
  );

  const readPipelineFile = path.join(fixtureRoot, "read-pipeline.json");
  await writeFile(
    readPipelineFile,
    JSON.stringify({
      version: 1,
      project_root: fixtureRoot,
      steps: [
        {
          id: "search",
          tool: "ast_search_symbols",
          input: { query: "formatValue" },
        },
        {
          id: "source",
          tool: "ast_get_symbol_source",
          input: {
            file_path: { $ref: "#/steps/search/symbols/0/file" },
            symbol_path: { $ref: "#/steps/search/symbols/0/selector" },
          },
        },
      ],
      emit: { $ref: "#/steps/source" },
    }),
  );
  const readResult = await invokeWithStdin(["run", "-"], await readFile(readPipelineFile, "utf8"));
  if (readResult.invocation_count !== 2 || !readResult.result?.text?.includes("formatValue")) {
    throw new Error(`Unexpected read pipeline output: ${JSON.stringify(readResult)}`);
  }
  const toonReadResult = decode(
    await invokeRaw(["run", "--output-format", "toon", readPipelineFile]),
  );
  if (
    toonReadResult.invocation_count !== 2 ||
    !toonReadResult.result?.text?.includes("formatValue")
  ) {
    throw new Error(`Unexpected TOON read pipeline output: ${JSON.stringify(toonReadResult)}`);
  }

  const explicitJson = await invoke(["run", readPipelineFile, "--output-format", "json"]);
  if (explicitJson.invocation_count !== 2 || !explicitJson.result?.text?.includes("formatValue")) {
    throw new Error(`Unexpected explicit JSON output: ${JSON.stringify(explicitJson)}`);
  }

  for (const invalidArgs of [
    ["run", readPipelineFile, "--output-format"],
    ["run", readPipelineFile, "--output-format", "yaml"],
    ["run", readPipelineFile, "--output-format", "toon", "--output-format", "json"],
    ["validate", readPipelineFile, "--output-format", "toon"],
  ]) {
    const failed = await invokeFailure(invalidArgs);
    const error = JSON.parse(failed.stderr);
    if (failed.code !== 2 || failed.stdout !== "" || error.code !== "USAGE") {
      throw new Error(`Unexpected invalid-format failure: ${JSON.stringify(failed)}`);
    }
  }

  const failingPipelineFile = path.join(fixtureRoot, "failing-read-pipeline.json");
  await writeFile(
    failingPipelineFile,
    JSON.stringify({
      version: 1,
      project_root: fixtureRoot,
      steps: [
        {
          id: "missing",
          tool: "ast_get_symbol_source",
          input: { file_path: "src/missing.ts", symbol_path: "missing" },
        },
      ],
    }),
  );
  const failedRead = await invokeFailure(["run", failingPipelineFile, "--output-format", "toon"]);
  if (
    failedRead.code !== 1 ||
    failedRead.stdout !== "" ||
    JSON.parse(failedRead.stderr).status !== "error"
  ) {
    throw new Error(`Unexpected TOON tool failure: ${JSON.stringify(failedRead)}`);
  }

  const deepChain = (prefix, depth) => {
    let value = "leaf";
    for (let index = depth - 1; index >= 0; index -= 1) value = { [`${prefix}_${index}`]: value };
    return value;
  };
  const oversizedEmit = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`chain_${index}`, deepChain(`key_${index}`, 330)]),
  );
  const oversizedPipelineFile = path.join(fixtureRoot, "oversized-toon-pipeline.json");
  await writeFile(
    oversizedPipelineFile,
    JSON.stringify({
      version: 1,
      project_root: fixtureRoot,
      steps: [{ id: "files", tool: "ast_list_files", input: { limit: 1 } }],
      emit: oversizedEmit,
    }),
  );
  const oversizedFailure = await invokeFailure([
    "run",
    oversizedPipelineFile,
    "--output-format",
    "toon",
  ]);
  const oversizedError = JSON.parse(oversizedFailure.stderr);
  if (
    oversizedFailure.code !== 1 ||
    oversizedFailure.stdout !== "" ||
    oversizedError.code !== "OUTPUT_LIMIT"
  ) {
    throw new Error(`Unexpected TOON overflow failure: ${JSON.stringify(oversizedFailure)}`);
  }

  const forbiddenPipelineFile = path.join(fixtureRoot, "forbidden-pipeline.json");
  await writeFile(
    forbiddenPipelineFile,
    JSON.stringify({
      version: 1,
      project_root: fixtureRoot,
      steps: [
        {
          id: "apply",
          tool: "ast_apply_operation",
          input: {
            operation_id: "00000000-0000-4000-8000-000000000000",
            plan_hash: "0".repeat(64),
          },
        },
      ],
    }),
  );
  try {
    await invoke(["validate", forbiddenPipelineFile]);
    throw new Error("Forbidden apply unexpectedly passed batch validation.");
  } catch (error) {
    const stderr = error?.stderr ?? "";
    if (error?.code !== 2 || !stderr.includes('"code":"INVALID_BATCH"')) throw error;
  }

  const preparePipelineFile = path.join(fixtureRoot, "prepare-pipeline.json");
  await writeFile(
    preparePipelineFile,
    JSON.stringify({
      version: 1,
      project_root: fixtureRoot,
      steps: [
        {
          id: "prepare",
          tool: "ast_rename_symbol",
          input: {
            file_path: "src/value.ts",
            symbol_path: "formatValue",
            new_name: "renderValue",
          },
        },
      ],
      emit: { summary: "prepared" },
    }),
  );
  try {
    await invoke(["run", preparePipelineFile, "--output-format", "toon"]);
    throw new Error("Prepare unexpectedly allowed TOON output.");
  } catch (error) {
    const stderr = error?.stderr ?? "";
    if (error?.code !== 2 || !stderr.includes('"code":"INVALID_BATCH"')) throw error;
  }
  if (!(await readFile(path.join(fixtureRoot, "src/value.ts"), "utf8")).includes("formatValue")) {
    throw new Error("Rejected TOON prepare modified source files.");
  }
  const prepared = await invoke(["run", preparePipelineFile]);
  if (
    prepared.result?.summary !== "prepared" ||
    !prepared.operation_id ||
    !prepared.plan_file ||
    !prepared.plan_hash
  ) {
    throw new Error(
      `Prepare did not expose persisted review coordinates: ${JSON.stringify(prepared)}`,
    );
  }
  if (!(await readFile(path.join(fixtureRoot, "src/value.ts"), "utf8")).includes("formatValue")) {
    throw new Error("Prepare unexpectedly modified source files.");
  }

  const releaseLock = await holdWorkspaceLock(path.join(fixtureRoot, "tsconfig.json"));
  try {
    await invoke(["apply", prepared.plan_file, "--plan-hash", prepared.plan_hash]);
    throw new Error("Apply unexpectedly bypassed the cross-process workspace lock.");
  } catch (error) {
    const stderr = error?.stderr ?? "";
    if (error?.code !== 1 || !stderr.includes("workspace lock")) throw error;
  } finally {
    await releaseLock();
  }

  const applied = await invoke(["apply", prepared.plan_file, "--plan-hash", prepared.plan_hash]);
  if (applied.status !== "applied" || applied.idempotent_replay !== false) {
    throw new Error(`Unexpected apply output: ${JSON.stringify(applied)}`);
  }
  const changedFiles = await Promise.all([
    readFile(path.join(fixtureRoot, "src/value.ts"), "utf8"),
    readFile(path.join(fixtureRoot, "src/use.ts"), "utf8"),
  ]);
  if (!changedFiles.every((content) => content.includes("renderValue"))) {
    throw new Error("Cross-process apply did not update every exact rename target.");
  }

  const replay = await invoke(["apply", prepared.plan_file, "--plan-hash", prepared.plan_hash]);
  if (replay.idempotent_replay !== true) {
    throw new Error(`Expected persisted receipt replay: ${JSON.stringify(replay)}`);
  }

  const installedSkill = await invoke(["install-skill", "all"]);
  if (
    installedSkill.installations?.length !== 2 ||
    !installedSkill.installations.every((installation) => installation.status === "installed")
  ) {
    throw new Error(`Unexpected skill installation output: ${JSON.stringify(installedSkill)}`);
  }
  const installedSkillFiles = await Promise.all([
    readFile(
      path.join(claudeConfigDirectory, "skills", "structural-code-editing", "SKILL.md"),
      "utf8",
    ),
    readFile(
      path.join(
        hermesHome,
        "skills",
        "software-development",
        "structural-code-editing",
        "SKILL.md",
      ),
      "utf8",
    ),
  ]);
  if (!installedSkillFiles.every((content) => content.includes("name: structural-code-editing"))) {
    throw new Error("Installed skill files do not contain the bundled skill.");
  }
  const skillReplay = await invoke(["install-skill", "all"]);
  if (!skillReplay.installations.every((installation) => installation.status === "unchanged")) {
    throw new Error(`Skill installation was not idempotent: ${JSON.stringify(skillReplay)}`);
  }

  const agentSetup = await invoke(["setup", "--agents", "all", "--yes"]);
  if (
    agentSetup.agents?.length !== 2 ||
    !agentSetup.agents.every((agent) => agent.mcp === "configured" && agent.skill === "unchanged")
  ) {
    throw new Error(`Unexpected agent setup output: ${JSON.stringify(agentSetup)}`);
  }
  const agentSetupReplay = await invoke(["setup", "--agents", "all", "--yes"]);
  if (
    !agentSetupReplay.agents.every(
      (agent) => agent.mcp === "unchanged" && agent.skill === "unchanged",
    )
  ) {
    throw new Error(`Agent setup was not idempotent: ${JSON.stringify(agentSetupReplay)}`);
  }

  const claudeProject = path.join(fixtureRoot, "claude-project");
  await mkdir(claudeProject);
  const projectSkill = await invoke([
    "install-skill",
    "claude",
    "--scope",
    "project",
    "--project-root",
    claudeProject,
  ]);
  const expectedProjectSkillPath = path.join(
    claudeProject,
    ".claude",
    "skills",
    "structural-code-editing",
    "SKILL.md",
  );
  if (
    projectSkill.installations?.length !== 1 ||
    projectSkill.installations[0]?.path !== expectedProjectSkillPath ||
    projectSkill.installations[0]?.status !== "installed"
  ) {
    throw new Error(`Unexpected project skill installation: ${JSON.stringify(projectSkill)}`);
  }

  process.stdout.write(
    `${JSON.stringify({ status: "ok", transport: "bash-cli", read_invocations: 2, toon_output: true, persisted_apply: true, lock_contention: true, replay: true, skill_installation: true, agent_setup: true })}\n`,
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
