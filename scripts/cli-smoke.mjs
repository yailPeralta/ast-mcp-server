#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "dist/cli.js");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ast-tool-cli-"));
const stateDirectory = path.join(fixtureRoot, "state");
const claudeConfigDirectory = path.join(fixtureRoot, "claude");
const hermesHome = path.join(fixtureRoot, "hermes");
const environment = {
  ...process.env,
  AST_TOOL_STATE_DIR: stateDirectory,
  CLAUDE_CONFIG_DIR: claudeConfigDirectory,
  HERMES_HOME: hermesHome,
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

try {
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
            symbol_path: { $ref: "#/steps/search/symbols/0/symbol_path" },
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
    `${JSON.stringify({ status: "ok", transport: "bash-cli", read_invocations: 2, persisted_apply: true, lock_contention: true, replay: true, skill_installation: true })}\n`,
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
