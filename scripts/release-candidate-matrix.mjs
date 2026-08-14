#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import {
  TRUSTED_GIT_BINARY,
  TRUSTED_SYSTEM_PATH,
  assertNoAmbientGitControls as assertNoAmbientGitAuthorityControls,
  assertTrustedGitVersion,
  createGitEnvironment as createClosedGitEnvironment,
  inspectTrustedGitFile,
} from "./git-evidence-authority.mjs";

export { TRUSTED_GIT_BINARY };

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const commandTimeoutMs = 20 * 60 * 1000;
const outputTailBytes = 64 * 1024;
const candidateTreePattern = /^[0-9a-f]{40}$/u;
const nodeVersionPattern = /^v(\d+)\.(\d+)\.(\d+)$/u;
let terminalContext;
let terminalPhase = "preflight";

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
  const home = ambientEnvironment.HOME;
  const temporaryDirectory = ambientEnvironment.TMPDIR ?? "/tmp";
  if (!path.isAbsolute(home ?? "") || !path.isAbsolute(temporaryDirectory)) {
    fail("runtime HOME and TMPDIR must be absolute paths.");
  }
  if (runtimeId !== "node22.5" && runtimeId !== "node24") {
    fail(`Unknown runtime identity: ${runtimeId}`);
  }
  return Object.freeze({
    CI: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NODE_OPTIONS: runtimeId === "node22.5" ? "--experimental-sqlite" : "",
    PATH: `${path.dirname(nodeBinary)}${path.delimiter}${TRUSTED_SYSTEM_PATH}`,
    TMPDIR: temporaryDirectory,
  });
}

export function createRuntimeCommandPlan(
  runtime,
  yarnEntry,
  packageManager = { nodeBinary: runtime.nodeBinary, yarnEntry },
  workspaceRoot = repositoryRoot,
) {
  const yarnPlan = yarnCommands.map(([id, args]) => {
    const authority =
      id === "install" ? packageManager : { nodeBinary: runtime.nodeBinary, yarnEntry };
    return Object.freeze({
      id,
      file: authority.nodeBinary,
      args: Object.freeze([authority.yarnEntry, ...args]),
    });
  });
  return Object.freeze([
    ...yarnPlan,
    Object.freeze({
      id: "workflow-policy",
      file: runtime.nodeBinary,
      args: Object.freeze([path.join(workspaceRoot, "scripts", "workflow-policy-check.mjs")]),
    }),
    Object.freeze({
      id: "diff-check",
      file: TRUSTED_GIT_BINARY,
      args: Object.freeze(["diff", "--no-ext-diff", "--check", "HEAD^", "HEAD"]),
    }),
  ]);
}

export function assertNoAmbientGitControls(ambientEnvironment = process.env) {
  try {
    assertNoAmbientGitAuthorityControls(ambientEnvironment);
  } catch (error) {
    fail(error instanceof Error ? error.message : "ambient Git controls are invalid.");
  }
}

export function createGitEnvironment(identity = {}, workTree = undefined) {
  try {
    return createClosedGitEnvironment({ identity, workTree });
  } catch (error) {
    fail(error instanceof Error ? error.message : "Git environment is invalid.");
  }
}

export function createCommandEnvironment(
  runtimeEnvironment,
  commandId,
  packageManagerEnvironment = runtimeEnvironment,
  workTree = undefined,
) {
  if (commandId === "diff-check") return createGitEnvironment({}, workTree);
  if (commandId !== "install") return runtimeEnvironment;
  if (packageManagerEnvironment.NODE_OPTIONS !== "") {
    fail("package-manager NODE_OPTIONS must be explicitly empty.");
  }
  return packageManagerEnvironment;
}

export function createRuntimeGateEnvironment(
  runtimeEnvironment,
  privateHome,
  privateTemporaryDirectory,
) {
  if (!path.isAbsolute(privateHome) || !path.isAbsolute(privateTemporaryDirectory)) {
    fail("runtime-gate HOME and TMPDIR must be absolute private paths.");
  }
  return Object.freeze({
    ...runtimeEnvironment,
    HOME: privateHome,
    TMPDIR: privateTemporaryDirectory,
  });
}

export function createPackageManagerEnvironment(
  runtimeEnvironment,
  privateHome,
  privateTemporaryDirectory,
) {
  if (!path.isAbsolute(privateHome) || !path.isAbsolute(privateTemporaryDirectory)) {
    fail("package-manager HOME and TMPDIR must be absolute private paths.");
  }
  if (typeof runtimeEnvironment.PATH !== "string" || runtimeEnvironment.PATH === "") {
    fail("package-manager runtime PATH is required.");
  }
  return Object.freeze({
    CI: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    HOME: privateHome,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NODE_OPTIONS: "",
    PATH: runtimeEnvironment.PATH,
    TMPDIR: privateTemporaryDirectory,
  });
}

export async function assertFreshCandidateWorkspace(workspaceRoot) {
  for (const relativePath of ["node_modules", path.join(".yarn", "install-state.gz"), "dist"]) {
    const existing = await lstat(path.join(workspaceRoot, relativePath)).catch(() => undefined);
    if (existing !== undefined) {
      fail(`fresh candidate workspace unexpectedly contains ${relativePath}.`);
    }
  }
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
    const ownsProcessGroup = process.platform !== "win32";
    const child = spawn(file, args, {
      cwd: options.cwd ?? repositoryRoot,
      detached: ownsProcessGroup,
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

    const signalChildTree = (signal) => {
      if (child.pid === undefined) return;
      try {
        if (ownsProcessGroup) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (!(error && typeof error === "object" && error.code === "ESRCH")) child.kill(signal);
      }
    };

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
      signalChildTree("SIGTERM");
      forceTimer = setTimeout(() => signalChildTree("SIGKILL"), 5000);
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
    child.once("close", (exitCode, signal) => {
      if (timedOut && forceTimer !== undefined) signalChildTree("SIGKILL");
      finish({ exitCode, signal });
    });
  });
}

export async function executeCommandOnce(command, options, executor = runBoundedProcess) {
  return executor(command.file, [...command.args], options);
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

async function runGitProcess(args, options = {}) {
  const executor = options.executor ?? runBoundedProcess;
  const cwd = options.cwd ?? repositoryRoot;
  return executor(TRUSTED_GIT_BINARY, args, {
    timeoutMs: options.timeoutMs ?? 30_000,
    cwd,
    env: createGitEnvironment(options.identity, cwd),
  });
}

async function runGit(args, options = {}) {
  const result = await runGitProcess(args, options);
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut) {
    fail(`git ${args.join(" ")} failed.`);
  }
  return result.stdoutTail.trim();
}

async function inspectTrustedGitBinary() {
  let fileAuthority;
  try {
    fileAuthority = await inspectTrustedGitFile();
  } catch (error) {
    fail(error instanceof Error ? error.message : "trusted Git file inspection failed.");
  }
  const versionResult = await runGitProcess(["--version"]);
  if (versionResult.exitCode !== 0 || versionResult.signal !== null || versionResult.timedOut) {
    fail("trusted Git binary could not report a valid version.");
  }
  let version;
  try {
    version = assertTrustedGitVersion(versionResult.stdoutTail);
  } catch (error) {
    fail(error instanceof Error ? error.message : "trusted Git version inspection failed.");
  }
  return Object.freeze({
    ...fileAuthority,
    version,
    environment_keys: Object.keys(createGitEnvironment({}, repositoryRoot)).sort(),
  });
}

export async function createCandidateWorktree(candidateTree, outputDir, options = {}) {
  const temporaryRoot = await mkdtemp(
    path.join(path.dirname(outputDir), ".ast-release-candidate-worktree-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "worktree");
  try {
    const parent = await runGit(["rev-parse", "HEAD"], options);
    const syntheticCommit = await runGit(
      [
        "commit-tree",
        candidateTree,
        "-p",
        parent,
        "-m",
        "chore(ci): materialize release candidate matrix",
      ],
      {
        executor: options.executor,
        identity: {
          GIT_AUTHOR_NAME: "AST release matrix",
          GIT_AUTHOR_EMAIL: "release-matrix@invalid.local",
          GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
          GIT_COMMITTER_NAME: "AST release matrix",
          GIT_COMMITTER_EMAIL: "release-matrix@invalid.local",
          GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
        },
      },
    );
    await runGit(["worktree", "add", "--detach", workspaceRoot, syntheticCommit], options);
    const materializedTree = await runGit(["rev-parse", "HEAD^{tree}"], {
      cwd: workspaceRoot,
      executor: options.executor,
    });
    if (materializedTree !== candidateTree) {
      fail(`materialized tree mismatch: expected ${candidateTree}, received ${materializedTree}.`);
    }
    await assertFreshCandidateWorkspace(workspaceRoot);
    const packageManagerHome = path.join(temporaryRoot, "package-manager-home");
    const packageManagerTemporaryDirectory = path.join(temporaryRoot, "package-manager-tmp");
    await mkdir(packageManagerHome, { mode: 0o700 });
    await mkdir(packageManagerTemporaryDirectory, { mode: 0o700 });
    return Object.freeze({
      temporaryRoot,
      workspaceRoot,
      syntheticCommit,
      packageManagerHome,
      packageManagerTemporaryDirectory,
    });
  } catch (error) {
    let cleanupError;
    try {
      const registered = (await runGit(["worktree", "list", "--porcelain"], options))
        .split("\n")
        .some((line) => line === `worktree ${workspaceRoot}`);
      if (registered) {
        const cleanup = await runGitProcess(["worktree", "remove", "--force", workspaceRoot], {
          executor: options.executor,
        });
        if (cleanup.exitCode !== 0 || cleanup.signal !== null || cleanup.timedOut) {
          fail("failed materialization cleanup could not remove its worktree registration.");
        }
      }
      await rm(temporaryRoot, { recursive: true, force: true });
    } catch (caughtCleanupError) {
      cleanupError = caughtCleanupError;
    }
    if (cleanupError !== undefined) {
      throw new CombinedOperationCleanupError(
        error,
        cleanupError,
        "materialization and cleanup both failed",
      );
    }
    throw error;
  }
}

async function assertCandidateWorktreeState(workspaceRoot, candidateTree) {
  const status = await runGit(["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: workspaceRoot,
  });
  if (status !== "") fail("candidate worktree has tracked or untracked mutations.");
  const finalTree = await runGit(["rev-parse", "HEAD^{tree}"], { cwd: workspaceRoot });
  if (finalTree !== candidateTree) {
    fail(`candidate worktree tree changed: expected ${candidateTree}, received ${finalTree}.`);
  }
  return finalTree;
}

export async function removeCandidateWorktree(materialization) {
  const result = await runGitProcess(
    ["worktree", "remove", "--force", materialization.workspaceRoot],
    {
      timeoutMs: 2 * 60 * 1000,
    },
  );
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut) {
    fail("candidate worktree cleanup failed.");
  }
  await rm(materialization.temporaryRoot, { recursive: true, force: false });
}

export async function assertRepositoryState(candidateTree, root = repositoryRoot) {
  const unstaged = await runGitProcess(["diff", "--quiet"], { cwd: root });
  if (unstaged.exitCode !== 0 || unstaged.signal !== null || unstaged.timedOut) {
    fail("the repository has unstaged tracked changes.");
  }
  const untracked = await runGit(["ls-files", "--others", "--exclude-standard"], { cwd: root });
  if (untracked !== "") fail("the repository has untracked files.");
  const indexTree = await runGit(["write-tree"], { cwd: root });
  if (candidateTree === undefined) {
    const headTree = await runGit(["rev-parse", "HEAD^{tree}"], { cwd: root });
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

function safeErrorMessage(error) {
  return safeFailureTail(error instanceof Error ? error.message : String(error));
}

class CombinedOperationCleanupError extends AggregateError {
  constructor(primaryError, cleanupError, message) {
    super([primaryError, cleanupError], message, { cause: primaryError });
    this.name = "CombinedOperationCleanupError";
    this.primaryError = primaryError;
    this.cleanupError = cleanupError;
  }
}

function splitTerminalFailures(runtimeError, cleanupError) {
  if (cleanupError === undefined && runtimeError instanceof CombinedOperationCleanupError) {
    return Object.freeze({
      runtimeError: runtimeError.primaryError,
      cleanupError: runtimeError.cleanupError,
    });
  }
  return Object.freeze({ runtimeError, cleanupError });
}

export function buildRuntimeTerminalReport({
  fallbackReport,
  runtimeReport,
  runtimeError,
  cleanupError,
}) {
  const failures = splitTerminalFailures(runtimeError, cleanupError);
  if (failures.runtimeError === undefined && failures.cleanupError === undefined) {
    if (runtimeReport?.status !== "pass") fail("successful runtime is missing PASS evidence.");
    return Object.freeze({ ...runtimeReport, cleanup_status: "pass" });
  }
  const evidence =
    runtimeError?.matrixReport ??
    failures.runtimeError?.matrixReport ??
    runtimeReport ??
    fallbackReport;
  if (evidence === undefined) fail("failed runtime is missing terminal report context.");
  return Object.freeze({
    ...evidence,
    status: "fail",
    failed_phase:
      evidence.failed_phase ??
      (failures.runtimeError === undefined ? "cleanup" : "materialization"),
    cleanup_status: failures.cleanupError === undefined ? "pass" : "fail",
    ...(failures.runtimeError === undefined
      ? {}
      : { runtime_error: safeErrorMessage(failures.runtimeError) }),
    ...(failures.cleanupError === undefined
      ? {}
      : { cleanup_error: safeErrorMessage(failures.cleanupError) }),
  });
}

async function runRuntime(
  runtime,
  packageManager,
  materialization,
  candidateTree,
  packageVersion,
  identity,
) {
  const commandReports = [];
  const packageManagerEnvironment = createPackageManagerEnvironment(
    packageManager.environment,
    materialization.packageManagerHome,
    materialization.packageManagerTemporaryDirectory,
  );
  const packageManagerEnvironmentKeys = Object.freeze(
    Object.keys(packageManagerEnvironment).sort(),
  );
  const runtimeGateEnvironment = createRuntimeGateEnvironment(
    runtime.environment,
    materialization.packageManagerHome,
    materialization.packageManagerTemporaryDirectory,
  );
  const reportBase = Object.freeze({
    runtime: runtime.id,
    node_version: runtime.version.raw,
    node_binary: runtime.nodeBinary,
    node_options: runtime.environment.NODE_OPTIONS,
    runtime_environment_keys: Object.keys(runtimeGateEnvironment).sort(),
    runtime_home_private: true,
    runtime_tmpdir_private: true,
    package_manager_node_version: packageManager.version.raw,
    package_manager_node_binary: packageManager.nodeBinary,
    package_manager_node_options: "",
    package_manager_environment_keys: packageManagerEnvironmentKeys,
    cold_workspace: true,
    workspace_tree: candidateTree,
    workspace_commit: materialization.syntheticCommit,
    package_version: packageVersion,
    candidate_tree: candidateTree ?? null,
    identity,
    command_order: RELEASE_CANDIDATE_COMMAND_IDS,
  });
  let failedPhase = "command-plan";
  try {
    const plan = createRuntimeCommandPlan(
      runtime,
      runtime.yarnEntry,
      packageManager,
      materialization.workspaceRoot,
    );
    for (const command of plan) {
      failedPhase = command.id;
      process.stderr.write(`[${runtime.id}] ${command.id}\n`);
      const result = await executeCommandOnce(command, {
        cwd: materialization.workspaceRoot,
        env: createCommandEnvironment(
          runtimeGateEnvironment,
          command.id,
          packageManagerEnvironment,
          materialization.workspaceRoot,
        ),
      });
      commandReports.push(publicCommandResult(command, result));
      if (result.exitCode !== 0 || result.signal !== null || result.timedOut) {
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
    failedPhase = "worktree-postcondition";
    const workspaceTree = await assertCandidateWorktreeState(
      materialization.workspaceRoot,
      candidateTree,
    );
    failedPhase = "index-postcondition";
    const finalIndexTree = await assertRepositoryState(candidateTree);
    return Object.freeze({
      ...reportBase,
      status: "pass",
      workspace_tree: workspaceTree,
      index_tree: finalIndexTree,
      commands: commandReports,
    });
  } catch (error) {
    const wrapped = new Error(`${runtime.id} failed during ${failedPhase}.`, { cause: error });
    wrapped.matrixReport = Object.freeze({
      ...reportBase,
      status: "fail",
      failed_phase: failedPhase,
      commands: commandReports,
      error: safeErrorMessage(error),
    });
    throw wrapped;
  }
}

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("the verified release matrix is limited to Linux x64.");
  }
  const options = parseReleaseCandidateMatrixArgs(process.argv.slice(2));
  const node22Binary = process.env.AST_NODE_22_BIN;
  const node24Binary = process.env.AST_NODE_24_BIN;
  if (node22Binary === undefined || node24Binary === undefined) {
    fail("AST_NODE_22_BIN and AST_NODE_24_BIN are required.");
  }
  assertNoAmbientGitControls();
  await mkdir(path.dirname(options.outputDir), { recursive: true });
  await mkdir(options.outputDir, { mode: 0o700 });
  terminalContext = Object.freeze({
    outputDir: options.outputDir,
    candidateTree: options.candidateTree ?? null,
  });

  const gitAuthority = await inspectTrustedGitBinary();

  const initialIndexTree = await assertRepositoryState(options.candidateTree);
  const [head, headTree] = (await runGit(["rev-parse", "HEAD", "HEAD^{tree}"])).split("\n");
  const packageMetadata = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  if (packageMetadata.version !== "0.8.1") fail("package version must be exactly 0.8.1.");
  const identity = Object.freeze({
    head,
    head_tree: headTree,
    initial_index_tree: initialIndexTree,
    git_authority: gitAuthority,
  });

  const runtimes = [
    await inspectRuntime("node22.5", node22Binary),
    await inspectRuntime("node24", node24Binary),
  ];
  const packageManager = runtimes.find(({ id }) => id === "node24");
  if (packageManager === undefined) fail("the Node 24 package-manager runtime is missing.");
  const materializedTree = options.candidateTree ?? initialIndexTree;
  const reports = [];
  for (const runtime of runtimes) {
    const fallbackReport = Object.freeze({
      runtime: runtime.id,
      node_version: runtime.version.raw,
      node_binary: runtime.nodeBinary,
      node_options: runtime.environment.NODE_OPTIONS,
      runtime_environment_keys: Object.keys(runtime.environment).sort(),
      runtime_home_private: null,
      runtime_tmpdir_private: null,
      package_manager_node_version: packageManager.version.raw,
      package_manager_node_binary: packageManager.nodeBinary,
      package_manager_node_options: "",
      package_manager_environment_keys: [],
      cold_workspace: true,
      workspace_tree: materializedTree,
      workspace_commit: null,
      package_version: packageMetadata.version,
      candidate_tree: options.candidateTree ?? null,
      identity,
      command_order: RELEASE_CANDIDATE_COMMAND_IDS,
      commands: [],
    });
    let materialization;
    let runtimeReport;
    let runtimeError;
    try {
      materialization = await createCandidateWorktree(materializedTree, options.outputDir);
      runtimeReport = await runRuntime(
        runtime,
        packageManager,
        materialization,
        materializedTree,
        packageMetadata.version,
        identity,
      );
    } catch (error) {
      runtimeError = error;
    }
    let cleanupError;
    if (materialization !== undefined) {
      try {
        await removeCandidateWorktree(materialization);
      } catch (error) {
        cleanupError = error;
      }
    }
    const terminalReport = buildRuntimeTerminalReport({
      fallbackReport,
      runtimeReport,
      runtimeError,
      cleanupError,
    });
    await writeJsonExclusive(path.join(options.outputDir, `${runtime.id}.json`), terminalReport);
    if (terminalReport.status === "fail") {
      const summary = {
        status: "fail",
        package_version: packageMetadata.version,
        candidate_tree: options.candidateTree ?? null,
        initial_index_tree: initialIndexTree,
        package_manager_node_version: packageManager.version.raw,
        failed_runtime: runtime.id,
        failed_phase: terminalReport.failed_phase,
        cleanup_status: terminalReport.cleanup_status,
        runtimes: [
          ...reports.map((report) => ({
            id: report.runtime,
            node_version: report.node_version,
            report: `${report.runtime}.json`,
            status: report.status,
            command_count: report.commands.length,
          })),
          {
            id: terminalReport.runtime,
            node_version: terminalReport.node_version,
            report: `${terminalReport.runtime}.json`,
            status: "fail",
            command_count: terminalReport.commands.length,
          },
        ],
      };
      await writeJsonExclusive(path.join(options.outputDir, "summary.json"), summary);
      if (runtimeError !== undefined && cleanupError !== undefined) {
        throw new CombinedOperationCleanupError(
          runtimeError,
          cleanupError,
          "runtime and cleanup both failed",
        );
      }
      throw runtimeError ?? cleanupError;
    }
    reports.push(terminalReport);
  }
  terminalPhase = "final-index-postcondition";
  const finalIndexTree = await assertRepositoryState(options.candidateTree);
  const summary = {
    status: "pass",
    package_version: packageMetadata.version,
    candidate_tree: options.candidateTree ?? null,
    initial_index_tree: initialIndexTree,
    final_index_tree: finalIndexTree,
    package_manager_node_version: packageManager.version.raw,
    package_manager_environment_keys: reports[0]?.package_manager_environment_keys ?? [],
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
  main().catch(async (error) => {
    let terminalWriteError;
    if (terminalContext !== undefined) {
      try {
        await writeJsonExclusive(path.join(terminalContext.outputDir, "summary.json"), {
          status: "fail",
          candidate_tree: terminalContext.candidateTree,
          failed_phase: terminalPhase,
          error: safeErrorMessage(error),
        });
      } catch (caughtWriteError) {
        if (!(
          caughtWriteError &&
          typeof caughtWriteError === "object" &&
          caughtWriteError.code === "EEXIST"
        )) {
          terminalWriteError = caughtWriteError;
        }
      }
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (terminalWriteError !== undefined) {
      process.stderr.write(
        `terminal report write failed: ${safeErrorMessage(terminalWriteError)}\n`,
      );
    }
    process.exitCode = 1;
  });
}
