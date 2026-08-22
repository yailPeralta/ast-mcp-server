#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
const sharedAgentsHome = path.join(fixtureRoot, "home");
const openCodeConfig = path.join(fixtureRoot, "opencode.json");
const cacheRoot = path.join(fixtureRoot, "symbol-index-cache");
const upgradeTemp = path.join(fixtureRoot, "upgrade-tmp");
const environment = {
  ...process.env,
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
  AST_TOOL_STATE_DIR: stateDirectory,
  CLAUDE_CONFIG_DIR: claudeConfigDirectory,
  HERMES_HOME: hermesHome,
  FAKE_CLAUDE_STATE: fakeClaudeState,
  FAKE_HERMES_STATE: fakeHermesState,
  FAKE_OPENCODE_STATE: path.join(fixtureRoot, "fake-opencode-state.json"),
  FAKE_CODEX_STATE: path.join(fixtureRoot, "fake-codex-state.json"),
  FAKE_GEMINI_STATE: path.join(fixtureRoot, "fake-gemini-state.json"),
  FAKE_COPILOT_STATE: path.join(fixtureRoot, "fake-copilot-state.json"),
  HOME: sharedAgentsHome,
  TMPDIR: upgradeTemp,
  OPENCODE_CONFIG: openCodeConfig,
  AST_SYMBOL_INDEX_PERSISTENCE: "disabled",
};
const cacheEnvironment = {
  ...environment,
  AST_SYMBOL_INDEX_PERSISTENCE: "enabled",
  AST_SYMBOL_INDEX_CACHE_ROOT: cacheRoot,
};

function isExpectedNode2213SQLiteWarning(stderr) {
  return (
    process.versions.node === "22.13.0" &&
    /^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/u.test(
      stderr.trimEnd(),
    )
  );
}

async function invoke(
  args,
  invocationEnvironment = environment,
  allowNode2213SQLiteWarning = false,
  cwd = repositoryRoot,
) {
  const { stdout, stderr } = await executeFile(process.execPath, [cliPath, ...args], {
    cwd,
    env: invocationEnvironment,
    maxBuffer: 12 * 1024 * 1024,
  });
  if (stderr !== "" && !(allowNode2213SQLiteWarning && isExpectedNode2213SQLiteWarning(stderr))) {
    throw new Error(`Expected empty stderr, received: ${stderr}`);
  }
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

async function invokeFailure(args, invocationEnvironment = environment, cwd = repositoryRoot) {
  try {
    await executeFile(process.execPath, [cliPath, ...args], {
      cwd,
      env: invocationEnvironment,
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
  await writeFile(path.join(fakeBin, "package.json"), '{"type":"module"}\n', "utf8");
  const fixture = path.join(repositoryRoot, "scripts", "fixtures", "fake-agent.mjs");
  for (const agent of ["claude", "hermes", "opencode", "codex", "gemini", "copilot"]) {
    const executable = path.join(fakeBin, agent);
    await copyFile(fixture, executable);
    await chmod(executable, 0o755);
  }
}

try {
  await installFakeAgents();
  await mkdir(upgradeTemp);
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
  await writeFile(
    path.join(fixtureRoot, "src/value.test.ts"),
    'import { formatValue } from "./value.js";\nexport const direct = formatValue(1);\n',
  );
  await writeFile(
    path.join(fixtureRoot, "src/transitive.test.ts"),
    'import { result } from "./use.js";\nexport const transitive = result;\n',
  );

  await mkdir(cacheRoot, { mode: 0o700 });
  const cacheKey = "a".repeat(64);
  const orphanSidecarKey = "b".repeat(64);
  const cacheDatabasePath = path.join(cacheRoot, `symbol-index-${cacheKey}.sqlite`);
  const cacheWalPath = path.join(cacheRoot, `symbol-index-${orphanSidecarKey}.sqlite-wal`);
  const cacheUnknownPath = path.join(cacheRoot, "operator-notes.txt");
  const { DatabaseSync } = await import("node:sqlite");
  const cacheDatabase = new DatabaseSync(cacheDatabasePath);
  cacheDatabase.exec("CREATE TABLE smoke (value TEXT)");
  cacheDatabase.close();
  await writeFile(cacheWalPath, "derived wal", "utf8");
  await writeFile(cacheUnknownPath, "preserve me", "utf8");

  const cacheInspection = await invoke(["cache", "inspect"], cacheEnvironment);
  if (
    cacheInspection.command !== "cache inspect" ||
    cacheInspection.state !== "ready" ||
    cacheInspection.active_database_count !== 1 ||
    cacheInspection.sidecar_count !== 1 ||
    cacheInspection.unrecognized_regular_file_count !== 1 ||
    JSON.stringify(cacheInspection).includes(fixtureRoot)
  ) {
    throw new Error(`Unexpected cache inspection: ${JSON.stringify(cacheInspection)}`);
  }

  for (const invalidArgs of [
    ["cache", "clear"],
    ["cache", "clear", "--yes", "--yes"],
    ["cache", "inspect", "extra"],
  ]) {
    const failed = await invokeFailure(invalidArgs, cacheEnvironment);
    const error = JSON.parse(failed.stderr);
    if (
      failed.code !== 2 ||
      failed.stdout !== "" ||
      error.code !== "USAGE" ||
      failed.stderr.includes(fixtureRoot)
    ) {
      throw new Error(`Unexpected cache confirmation failure: ${JSON.stringify(failed)}`);
    }
  }

  const cacheClear = await invoke(["cache", "clear", "--yes"], cacheEnvironment, true);
  if (
    cacheClear.command !== "cache clear" ||
    cacheClear.state !== "cleared" ||
    cacheClear.deleted_active_database_count !== 1 ||
    cacheClear.deleted_sidecar_count !== 1 ||
    cacheClear.unrecognized_regular_file_count !== 1 ||
    JSON.stringify(cacheClear).includes(fixtureRoot)
  ) {
    throw new Error(`Unexpected cache clear result: ${JSON.stringify(cacheClear)}`);
  }
  await access(cacheDatabasePath).then(
    () => {
      throw new Error("Cache clear left the recognized database in place.");
    },
    (error) => {
      if (error?.code !== "ENOENT") throw error;
    },
  );
  if ((await readFile(cacheUnknownPath, "utf8")) !== "preserve me") {
    throw new Error("Cache clear modified an unrecognized regular file.");
  }
  const cacheAfterClear = await invoke(["cache", "inspect"], cacheEnvironment);
  if (
    cacheAfterClear.active_database_count !== 0 ||
    cacheAfterClear.sidecar_count !== 0 ||
    cacheAfterClear.unrecognized_regular_file_count !== 1
  ) {
    throw new Error(`Unexpected post-clear cache inspection: ${JSON.stringify(cacheAfterClear)}`);
  }
  const unsafeCachePath = path.join(cacheRoot, `symbol-index-${"c".repeat(64)}.sqlite`);
  await symlink(cacheUnknownPath, unsafeCachePath);
  const unsafeCacheFailure = await invokeFailure(["cache", "clear", "--yes"], cacheEnvironment);
  const unsafeCacheError = JSON.parse(unsafeCacheFailure.stderr);
  if (
    unsafeCacheFailure.code !== 1 ||
    unsafeCacheFailure.stdout !== "" ||
    unsafeCacheError.code !== "CACHE_UNSAFE" ||
    unsafeCacheError.details?.removed_artifact_count !== 0 ||
    unsafeCacheFailure.stderr.includes(fixtureRoot) ||
    (await readFile(cacheUnknownPath, "utf8")) !== "preserve me"
  ) {
    throw new Error(`Unexpected unsafe-cache failure: ${JSON.stringify(unsafeCacheFailure)}`);
  }

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
  const jsProject = path.join(fixtureRoot, "js-project");
  const jsNested = path.join(jsProject, "nested", "cwd");
  const jsPipeline = path.join(jsProject, "pipeline.json");
  await mkdir(path.join(jsProject, "src"), { recursive: true });
  await mkdir(jsNested, { recursive: true });
  await writeFile(
    path.join(jsProject, "jsconfig.json"),
    JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true }, include: ["src/**/*.js"] }),
  );
  await writeFile(path.join(jsProject, "src", "value.js"), "export function jsValue() {}\n");
  await writeFile(
    jsPipeline,
    JSON.stringify({
      version: 1,
      steps: [{ id: "search", tool: "ast_search_symbols", input: { query: "jsValue" } }],
      emit: { $ref: "#/steps/search" },
    }),
  );
  const jsResult = await invoke(["run", jsPipeline], environment, false, jsNested);
  if (!jsResult.result?.symbols?.some((symbol) => symbol.selector?.includes("jsValue"))) {
    throw new Error(`Unexpected jsconfig discovery result: ${JSON.stringify(jsResult)}`);
  }
  await writeFile(path.join(jsProject, "tsconfig.json"), "{}");
  const ambiguous = await invokeFailure(["run", jsPipeline], environment, jsNested);
  const ambiguousError = JSON.parse(ambiguous.stderr);
  if (
    ambiguous.code !== 2 ||
    ambiguousError.code !== "PROJECT_CONFIG_AMBIGUOUS" ||
    !ambiguousError.details?.continuation?.includes("ast-tool run '../../pipeline.json'") ||
    ambiguous.stderr.includes(jsProject)
  ) {
    throw new Error(`Unexpected project ambiguity result: ${JSON.stringify(ambiguous)}`);
  }
  const explicitJsDocument = JSON.parse(await readFile(jsPipeline, "utf8"));
  explicitJsDocument.project_root = path.join(jsProject, "jsconfig.json");
  await writeFile(jsPipeline, JSON.stringify(explicitJsDocument));
  const explicitJs = await invoke(["run", jsPipeline], environment, false, jsNested);
  if (!explicitJs.result?.symbols?.some((symbol) => symbol.selector?.includes("jsValue"))) {
    throw new Error(`Unexpected explicit jsconfig result: ${JSON.stringify(explicitJs)}`);
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

  const candidatePipelineFile = path.join(fixtureRoot, "candidate-pipeline.json");
  await writeFile(
    candidatePipelineFile,
    JSON.stringify({
      version: 1,
      project_root: fixtureRoot,
      steps: [
        {
          id: "candidates",
          tool: "ast_find_test_candidates",
          input: {
            file_path: "src/value.ts",
            symbol_path: "formatValue",
            max_depth: 2,
            offset: 0,
            limit: 1,
          },
        },
      ],
      emit: { $ref: "#/steps/candidates" },
    }),
  );
  const candidateJson = await invoke(["run", candidatePipelineFile]);
  const candidateToon = decode(
    await invokeRaw(["run", "--output-format", "toon", candidatePipelineFile]),
  );
  const logicalCandidateJson = JSON.stringify(candidateJson.result, (key, value) =>
    key === "checked_at" ? "<timestamp>" : value,
  );
  const logicalCandidateToon = JSON.stringify(candidateToon.result, (key, value) =>
    key === "checked_at" ? "<timestamp>" : value,
  );
  if (
    candidateJson.result?.total !== 2 ||
    candidateJson.result?.candidates?.[0]?.file !== "src/value.test.ts" ||
    candidateJson.result?.candidates?.[0]?.evidence?.relationships?.length !== 1 ||
    logicalCandidateToon !== logicalCandidateJson
  ) {
    throw new Error(
      `Unexpected candidate batch parity: ${JSON.stringify({ candidateJson, candidateToon })}`,
    );
  }

  const explorePipelineFile = path.join(fixtureRoot, "explore-pipeline.json");
  await writeFile(
    explorePipelineFile,
    JSON.stringify({
      version: 1,
      project_root: fixtureRoot,
      steps: [
        {
          id: "explore",
          tool: "ast_explore",
          input: {
            file_path: "src/value.ts",
            symbol_path: "formatValue",
            call_spines: { direction: "incoming" },
            max_bytes: 4096,
          },
        },
      ],
      emit: { $ref: "#/steps/explore" },
    }),
  );
  const exploreJson = await invoke(["run", explorePipelineFile]);
  const exploreToon = decode(
    await invokeRaw(["run", "--output-format", "toon", explorePipelineFile]),
  );
  const normalizeExplore = (value) =>
    JSON.stringify(value, (key, item) => (key === "checked_at" ? "<timestamp>" : item));
  if (
    exploreJson.result?.route !== "symbol" ||
    exploreJson.result?.call_spines?.authority_state !== "authoritative" ||
    exploreJson.result?.omissions?.total !== 0 ||
    normalizeExplore(exploreToon.result) !== normalizeExplore(exploreJson.result)
  ) {
    throw new Error(
      `Unexpected ast_explore batch parity: ${JSON.stringify({ exploreJson, exploreToon })}`,
    );
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
  const failedReadEvents = failedRead.stderr
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const toolFailure = failedReadEvents.find((event) => event.event === "tool_failure");
  const commandFailure = failedReadEvents.find((event) => event.status === "error");
  if (
    failedRead.code !== 1 ||
    failedRead.stdout !== "" ||
    failedReadEvents.length !== 2 ||
    toolFailure?.tool !== "ast_get_symbol_source" ||
    toolFailure?.code !== "NOT_FOUND" ||
    commandFailure?.code !== "TOOL_ERROR"
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

  const humanClaudeGuidance = "# Personal Claude rules\n\nKeep this exact text.\n";
  await writeFile(path.join(claudeConfigDirectory, "CLAUDE.md"), humanClaudeGuidance, "utf8");
  const agentSetup = await invoke(["setup", "--agents", "all", "--yes"]);
  const guidanceByAgent = new Map(
    agentSetup.agents?.map((agent) => [agent.agent, agent.guidance]) ?? [],
  );
  if (
    agentSetup.agents?.length !== 6 ||
    !agentSetup.agents.every(
      (agent) =>
        agent.mcp === "configured" && (agent.skill === "unchanged" || agent.skill === "installed"),
    ) ||
    guidanceByAgent.get("claude") !== "updated" ||
    guidanceByAgent.get("opencode") !== "updated" ||
    guidanceByAgent.get("codex") !== "installed" ||
    guidanceByAgent.get("gemini") !== "installed" ||
    guidanceByAgent.get("hermes") !== "skill_only" ||
    guidanceByAgent.get("copilot") !== "skill_only"
  ) {
    throw new Error(`Unexpected agent setup output: ${JSON.stringify(agentSetup)}`);
  }
  const [claudeGuidance, codexGuidance, geminiGuidance] = await Promise.all([
    readFile(path.join(claudeConfigDirectory, "CLAUDE.md"), "utf8"),
    readFile(path.join(sharedAgentsHome, ".codex", "AGENTS.md"), "utf8"),
    readFile(path.join(sharedAgentsHome, ".gemini", "GEMINI.md"), "utf8"),
  ]);
  const discoveredInstructions = new Map(
    await Promise.all(
      ["claude", "opencode", "codex", "gemini"].map(async (agent) => {
        const discovery = await executeFile(path.join(fakeBin, agent), ["debug", "instructions"], {
          cwd: repositoryRoot,
          env: environment,
        });
        return [agent, JSON.parse(discovery.stdout)];
      }),
    ),
  );
  const managedBegin = "<!-- ast-tool:structural-code-editing guidance v1 begin -->";
  if (
    !claudeGuidance.startsWith(humanClaudeGuidance) ||
    ![claudeGuidance, codexGuidance, geminiGuidance].every(
      (content) => content.split(managedBegin).length === 2,
    ) ||
    discoveredInstructions.get("claude")?.content !== claudeGuidance ||
    discoveredInstructions.get("opencode")?.content !== claudeGuidance ||
    discoveredInstructions.get("codex")?.content !== codexGuidance ||
    discoveredInstructions.get("gemini")?.content !== geminiGuidance
  ) {
    throw new Error("Managed guidance was not discovered once or did not preserve human content.");
  }
  const agentSetupReplay = await invoke(["setup", "--agents", "all", "--yes"]);
  if (
    !agentSetupReplay.agents.every(
      (agent) =>
        agent.mcp === "unchanged" &&
        agent.skill === "unchanged" &&
        (agent.guidance === "unchanged" || agent.guidance === "skill_only"),
    ) ||
    agentSetupReplay.physical_writes?.length !== 0
  ) {
    throw new Error(`Agent setup was not idempotent: ${JSON.stringify(agentSetupReplay)}`);
  }
  if (
    agentSetup.version !== 2 ||
    !Array.isArray(agentSetup.physical_writes) ||
    !agentSetup.physical_writes.every((write) =>
      ["skill", "guidance", "mcp_config"].includes(write.asset),
    )
  ) {
    throw new Error(
      `Agent setup output is not versioned and stable: ${JSON.stringify(agentSetup)}`,
    );
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

  for (const args of [["upgrade"], ["upgrade", "--check"]]) {
    const failed = await invokeFailure(args);
    const error = JSON.parse(failed.stderr);
    if (
      failed.code !== 1 ||
      failed.stdout !== "" ||
      error.code !== "UPGRADE_PROVENANCE_UNSUPPORTED" ||
      failed.stderr.includes(repositoryRoot) ||
      failed.stderr.includes(fixtureRoot)
    ) {
      throw new Error(`Unexpected source-checkout upgrade result: ${JSON.stringify(failed)}`);
    }
  }
  if ((await readdir(upgradeTemp)).some((entry) => entry.startsWith("ast-tool-upgrade-"))) {
    throw new Error("Upgrade temporary boundary was not removed");
  }
  for (const args of [
    ["upgrade", "--yes"],
    ["upgrade", "--unknown"],
  ]) {
    const failed = await invokeFailure(args);
    const error = JSON.parse(failed.stderr);
    if (failed.code !== 2 || failed.stdout !== "" || error.code !== "USAGE") {
      throw new Error(`Unexpected upgrade usage result: ${JSON.stringify(failed)}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify({ status: "ok", transport: "bash-cli", read_invocations: 2, toon_output: true, persisted_apply: true, lock_contention: true, replay: true, project_discovery: true, skill_installation: true, agent_setup: true, upgrade_preflight: true, cache_inspect: true, cache_clear: true, cache_confirmation: true, cache_unknown_preserved: true, cache_redacted_failure: true })}\n`,
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
