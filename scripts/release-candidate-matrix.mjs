#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const commandTimeoutMs = 20 * 60 * 1000;
const outputTailBytes = 64 * 1024;
const candidateTreePattern = /^[0-9a-f]{40}$/u;
const nodeVersionPattern = /^v(\d+)\.(\d+)\.(\d+)$/u;

export const RELEASE_CANDIDATE_COMMAND_IDS = Object.freeze([
  "install",
  "format",
  "lint",
  "typecheck",
  "test",
  "build",
  "mcp",
  "errors",
  "lifecycle",
  "cli",
  "package",
  "audit",
  "pack",
  "workflow-policy",
  "diff-check",
]);

const yarnCommands = Object.freeze([
  ["install", ["install", "--immutable"]],
  ["format", ["format:check"]],
  ["lint", ["lint"]],
  ["typecheck", ["typecheck"]],
  ["test", ["test"]],
  ["build", ["build"]],
  ["mcp", ["test:mcp"]],
  ["errors", ["test:errors"]],
  ["lifecycle", ["test:lifecycle"]],
  ["cli", ["test:cli"]],
  ["package", ["test:package"]],
  ["audit", ["audit"]],
  ["pack", ["pack", "--dry-run", "--json"]],
]);

function fail(message) {
  throw new Error(`Release candidate matrix failed: ${message}`);
}

function takeOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${option} requires a value.`);
  return value;
}

export function parseReleaseCandidateMatrixArgs(argv) {
  const options = { outputDir: undefined, candidateTree: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output-dir") {
      if (options.outputDir !== undefined) fail("--output-dir may be provided only once.");
      options.outputDir = takeOptionValue(argv, index, argument);
      index += 1;
    } else if (argument === "--candidate-tree") {
      if (options.candidateTree !== undefined) fail("--candidate-tree may be provided only once.");
      options.candidateTree = takeOptionValue(argv, index, argument);
      index += 1;
    } else {
      fail(`Unknown argument: ${argument}`);
    }
  }
  if (options.outputDir === undefined) fail("--output-dir is required.");
  if (!path.isAbsolute(options.outputDir)) fail("--output-dir must be absolute.");
  if (options.candidateTree !== undefined && !candidateTreePattern.test(options.candidateTree)) {
    fail("--candidate-tree must be a lowercase 40-character Git tree hash.");
  }
  return Object.freeze({
    outputDir: path.normalize(options.outputDir),
    candidateTree: options.candidateTree,
  });
}

export function validateRuntimeVersion(runtimeId, rawVersion) {
  const match = nodeVersionPattern.exec(rawVersion.trim());
  if (match === null) fail(`${runtimeId} returned an invalid Node version.`);
  const version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
  const expected =
    runtimeId === "node22.5"
      ? { major: 22, minimumMinor: 5 }
      : runtimeId === "node24"
        ? { major: 24, minimumMinor: 0 }
        : undefined;
  if (expected === undefined) fail(`Unknown runtime identity: ${runtimeId}`);
  if (version.major !== expected.major || version.minor < expected.minimumMinor) {
    fail(
      `${runtimeId} requires Node ${expected.major}.${expected.minimumMinor}.0 or newer within major ${expected.major}; received ${rawVersion.trim()}.`,
    );
  }
  return Object.freeze({ raw: rawVersion.trim(), ...version });
}

export function createRuntimeEnvironment(runtimeId, nodeBinary, ambientEnvironment = process.env) {
  const environment = {
    ...ambientEnvironment,
    PATH: `${path.dirname(nodeBinary)}${path.delimiter}${ambientEnvironment.PATH ?? ""}`,
  };
  delete environment.GIT_INDEX_FILE;
  if (runtimeId === "node22.5") environment.NODE_OPTIONS = "--experimental-sqlite";
  else delete environment.NODE_OPTIONS;
  return environment;
}

export function createRuntimeCommandPlan(runtime, yarnEntry) {
  const yarnPlan = yarnCommands.map(([id, args]) =>
    Object.freeze({ id, file: runtime.nodeBinary, args: Object.freeze([yarnEntry, ...args]) }),
  );
  return Object.freeze([
    ...yarnPlan,
    Object.freeze({
      id: "workflow-policy",
      file: runtime.nodeBinary,
      args: Object.freeze([path.join(repositoryRoot, "scripts", "workflow-policy-check.mjs")]),
    }),
    Object.freeze({ id: "diff-check", file: "git", args: Object.freeze(["diff", "--check"]) }),
  ]);
}

export function createCommandEnvironment(runtimeEnvironment, commandId) {
  if (commandId !== "install") return runtimeEnvironment;
  return { ...runtimeEnvironment, NODE_OPTIONS: "" };
}

function appendTail(current, chunk) {
  const combined = Buffer.concat([current, chunk]);
  return combined.length <= outputTailBytes
    ? combined
    : combined.subarray(combined.length - outputTailBytes);
}

export async function runBoundedProcess(file, args, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? commandTimeoutMs;
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutHash = createHash("sha256");
    const stderrHash = createHash("sha256");
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTail = Buffer.alloc(0);
    let stderrTail = Buffer.alloc(0);
    let timedOut = false;
    let forceTimer;
    let settled = false;

    child.stdout.on("data", (chunk) => {
      stdoutHash.update(chunk);
      stdoutBytes += chunk.length;
      stdoutTail = appendTail(stdoutTail, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrHash.update(chunk);
      stderrBytes += chunk.length;
      stderrTail = appendTail(stderrTail, chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      forceTimer.unref();
    }, timeoutMs);
    timer.unref();

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      resolve({
        ...result,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdoutBytes,
        stderrBytes,
        stdoutSha256: stdoutHash.digest("hex"),
        stderrSha256: stderrHash.digest("hex"),
        stdoutTail: stdoutTail.toString("utf8"),
        stderrTail: stderrTail.toString("utf8"),
      });
    };

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      reject(error);
    });
    child.once("close", (exitCode, signal) => finish({ exitCode, signal }));
  });
}

function publicCommandResult(command, result) {
  return Object.freeze({
    id: command.id,
    exit_code: result.exitCode,
    signal: result.signal,
    timed_out: result.timedOut,
    duration_ms: result.durationMs,
    stdout_bytes: result.stdoutBytes,
    stderr_bytes: result.stderrBytes,
    stdout_sha256: result.stdoutSha256,
    stderr_sha256: result.stderrSha256,
  });
}

async function runGit(args) {
  const result = await runBoundedProcess("git", args, { timeoutMs: 30_000 });
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut) {
    fail(`git ${args.join(" ")} failed.`);
  }
  return result.stdoutTail.trim();
}

async function assertRepositoryState(candidateTree) {
  const unstaged = await runBoundedProcess("git", ["diff", "--quiet"], { timeoutMs: 30_000 });
  if (unstaged.exitCode !== 0 || unstaged.signal !== null || unstaged.timedOut) {
    fail("the repository has unstaged tracked changes.");
  }
  const untracked = await runGit(["ls-files", "--others", "--exclude-standard"]);
  if (untracked !== "") fail("the repository has untracked files.");
  const indexTree = await runGit(["write-tree"]);
  if (candidateTree === undefined) {
    const headTree = await runGit(["rev-parse", "HEAD^{tree}"]);
    if (indexTree !== headTree) fail("preliminary evidence requires a clean index.");
  } else if (indexTree !== candidateTree) {
    fail(`the staged tree changed: expected ${candidateTree}, received ${indexTree}.`);
  }
  return indexTree;
}

async function inspectRuntime(runtimeId, nodeBinary) {
  if (!path.isAbsolute(nodeBinary)) fail(`${runtimeId} binary must be absolute.`);
  const nodeStats = await lstat(nodeBinary).catch(() => undefined);
  if (nodeStats === undefined || !nodeStats.isFile())
    fail(`${runtimeId} binary must be a regular file.`);
  await access(nodeBinary, fsConstants.X_OK).catch(() =>
    fail(`${runtimeId} binary is not executable.`),
  );
  const versionResult = await runBoundedProcess(nodeBinary, ["--version"], { timeoutMs: 30_000 });
  if (versionResult.exitCode !== 0 || versionResult.signal !== null || versionResult.timedOut) {
    fail(`${runtimeId} binary could not report its version.`);
  }
  const version = validateRuntimeVersion(runtimeId, versionResult.stdoutTail);
  const yarnLauncher = path.join(
    path.dirname(nodeBinary),
    process.platform === "win32" ? "yarn.cmd" : "yarn",
  );
  const yarnStats = await lstat(yarnLauncher).catch(() => undefined);
  if (yarnStats === undefined || (!yarnStats.isFile() && !yarnStats.isSymbolicLink())) {
    fail(`${runtimeId} requires a sibling Yarn launcher.`);
  }
  const yarnEntry = await realpath(yarnLauncher);
  const yarnEntryStats = await lstat(yarnEntry);
  if (!yarnEntryStats.isFile()) fail(`${runtimeId} Yarn entry must resolve to a regular file.`);
  return Object.freeze({
    id: runtimeId,
    nodeBinary,
    yarnEntry,
    version,
    environment: createRuntimeEnvironment(runtimeId, nodeBinary),
  });
}

async function writeJsonExclusive(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function safeFailureTail(value) {
  return value
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/(token|password|secret|api[_-]?key)=\S+/giu, "$1=[REDACTED]")
    .slice(-2000);
}

async function runRuntime(runtime, outputDir, candidateTree, packageVersion, identity) {
  const reportPath = path.join(outputDir, `${runtime.id}.json`);
  const commandReports = [];
  const plan = createRuntimeCommandPlan(runtime, runtime.yarnEntry);
  for (const command of plan) {
    process.stderr.write(`[${runtime.id}] ${command.id}\n`);
    const result = await runBoundedProcess(command.file, [...command.args], {
      env: createCommandEnvironment(runtime.environment, command.id),
    });
    commandReports.push(publicCommandResult(command, result));
    if (result.exitCode !== 0 || result.signal !== null || result.timedOut) {
      const report = {
        status: "fail",
        runtime: runtime.id,
        node_version: runtime.version.raw,
        package_version: packageVersion,
        candidate_tree: candidateTree ?? null,
        identity,
        commands: commandReports,
        failed_command: command.id,
      };
      await writeJsonExclusive(reportPath, report);
      const detail = safeFailureTail(result.stderrTail || result.stdoutTail);
      fail(`${runtime.id} command ${command.id} failed.${detail === "" ? "" : ` ${detail}`}`);
    }
    if (command.id === "workflow-policy") {
      let policy;
      try {
        policy = JSON.parse(result.stdoutTail.trim().split("\n").at(-1));
      } catch {
        fail(`${runtime.id} workflow policy output was not valid JSON.`);
      }
      if (policy?.status !== "pass") fail(`${runtime.id} workflow policy did not report PASS.`);
    }
  }
  const finalIndexTree = await assertRepositoryState(candidateTree);
  const report = {
    status: "pass",
    runtime: runtime.id,
    node_version: runtime.version.raw,
    node_binary: runtime.nodeBinary,
    node_options: runtime.environment.NODE_OPTIONS ?? null,
    package_version: packageVersion,
    candidate_tree: candidateTree ?? null,
    index_tree: finalIndexTree,
    identity,
    command_order: RELEASE_CANDIDATE_COMMAND_IDS,
    commands: commandReports,
  };
  await writeJsonExclusive(reportPath, report);
  return report;
}

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("the verified release matrix is limited to Linux x64.");
  }
  if (process.env.GIT_INDEX_FILE !== undefined) fail("GIT_INDEX_FILE must be unset.");
  const options = parseReleaseCandidateMatrixArgs(process.argv.slice(2));
  const node22Binary = process.env.AST_NODE_22_BIN;
  const node24Binary = process.env.AST_NODE_24_BIN;
  if (node22Binary === undefined || node24Binary === undefined) {
    fail("AST_NODE_22_BIN and AST_NODE_24_BIN are required.");
  }
  await mkdir(path.dirname(options.outputDir), { recursive: true });
  await mkdir(options.outputDir, { mode: 0o700 });

  const initialIndexTree = await assertRepositoryState(options.candidateTree);
  const [head, headTree] = (await runGit(["rev-parse", "HEAD", "HEAD^{tree}"])).split("\n");
  const packageMetadata = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  if (packageMetadata.version !== "0.7.0") fail("package version must be exactly 0.7.0.");
  const identity = Object.freeze({
    head,
    head_tree: headTree,
    initial_index_tree: initialIndexTree,
  });

  const runtimes = [
    await inspectRuntime("node22.5", node22Binary),
    await inspectRuntime("node24", node24Binary),
  ];
  const reports = [];
  for (const runtime of runtimes) {
    reports.push(
      await runRuntime(
        runtime,
        options.outputDir,
        options.candidateTree,
        packageMetadata.version,
        identity,
      ),
    );
  }
  const finalIndexTree = await assertRepositoryState(options.candidateTree);
  const summary = {
    status: "pass",
    package_version: packageMetadata.version,
    candidate_tree: options.candidateTree ?? null,
    initial_index_tree: initialIndexTree,
    final_index_tree: finalIndexTree,
    runtimes: reports.map((report) => ({
      id: report.runtime,
      node_version: report.node_version,
      report: `${report.runtime}.json`,
      command_count: report.commands.length,
    })),
  };
  await writeJsonExclusive(path.join(options.outputDir, "summary.json"), summary);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

const entryPath = process.argv[1] === undefined ? undefined : path.resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
