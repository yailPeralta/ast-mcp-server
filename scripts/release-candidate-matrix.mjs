#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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
const TRUSTED_MV_BINARY = "/usr/bin/mv";
const trustedMvVersion = "mv (GNU coreutils) 9.7";
const candidateTreePattern = /^[0-9a-f]{40}$/u;
const nodeVersionPattern = /^v(\d+)\.(\d+)\.(\d+)$/u;
const runtimeEvidenceAuthority = new WeakSet();
const runtimeReportAuthority = new WeakSet();
const summaryReportAuthority = new WeakSet();
let terminalContext;
let terminalPublishAttempted = false;

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
  if (runtimeId === "node22.13") {
    if (version.major !== 22) {
      fail(`node22.13 requires Node major 22; received ${rawVersion.trim()}.`);
    }
    if (version.minor !== 13 || version.patch !== 0) {
      fail(`node22.13 requires exact Node 22.13.0; received ${rawVersion.trim()}.`);
    }
  } else if (runtimeId === "node24") {
    if (version.major !== 24) {
      fail(`node24 requires Node major 24; received ${rawVersion.trim()}.`);
    }
  } else {
    fail(`Unknown runtime identity: ${runtimeId}`);
  }
  return Object.freeze({ raw: rawVersion.trim(), ...version });
}

export function createRuntimeEnvironment(runtimeId, nodeBinary, ambientEnvironment = process.env) {
  const home = ambientEnvironment.HOME;
  const temporaryDirectory = ambientEnvironment.TMPDIR ?? "/tmp";
  if (!path.isAbsolute(home ?? "") || !path.isAbsolute(temporaryDirectory)) {
    fail("runtime HOME and TMPDIR must be absolute paths.");
  }
  if (runtimeId !== "node22.13" && runtimeId !== "node24") {
    fail(`Unknown runtime identity: ${runtimeId}`);
  }
  return Object.freeze({
    CI: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NODE_OPTIONS: "",
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
  const passed = result.exitCode === 0 && result.signal === null && !result.timedOut;
  const failureCode = passed
    ? null
    : result.timedOut
      ? "timeout"
      : result.signal === null
        ? "nonzero-exit"
        : "signal";
  return Object.freeze({
    id: command.id,
    status: passed ? "pass" : "fail",
    command_failure_code: failureCode,
    exit_code: result.exitCode,
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

function brandRuntimeEvidence(evidence) {
  const branded = Object.freeze(evidence);
  runtimeEvidenceAuthority.add(branded);
  return branded;
}

function brandRuntimeReport(report) {
  const branded = Object.freeze(report);
  runtimeReportAuthority.add(branded);
  return branded;
}

function brandSummaryReport(report) {
  const branded = Object.freeze(report);
  summaryReportAuthority.add(branded);
  return branded;
}

function createPublicationEnvironment() {
  return Object.freeze({
    HOME: "/nonexistent",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: TRUSTED_SYSTEM_PATH,
  });
}

async function inspectTrustedMoveBinary() {
  const entryMetadata = await lstat(TRUSTED_MV_BINARY).catch(() => undefined);
  const resolved = await realpath(TRUSTED_MV_BINARY).catch(() => undefined);
  const targetMetadata =
    resolved === undefined ? undefined : await lstat(resolved).catch(() => undefined);
  if (
    entryMetadata === undefined ||
    (!entryMetadata.isFile() && !entryMetadata.isSymbolicLink()) ||
    entryMetadata.uid !== 0 ||
    (entryMetadata.isFile() && (entryMetadata.mode & 0o022) !== 0) ||
    targetMetadata === undefined ||
    !targetMetadata.isFile() ||
    targetMetadata.uid !== 0 ||
    (targetMetadata.mode & 0o022) !== 0
  ) {
    fail("trusted move binary authority is invalid.");
  }
  await access(TRUSTED_MV_BINARY, fsConstants.X_OK).catch(() =>
    fail("trusted move binary is not executable."),
  );
  const versionResult = await runBoundedProcess(TRUSTED_MV_BINARY, ["--version"], {
    env: createPublicationEnvironment(),
    timeoutMs: 30_000,
  });
  if (
    versionResult.exitCode !== 0 ||
    versionResult.signal !== null ||
    versionResult.timedOut ||
    versionResult.stdoutTail.split("\n", 1)[0] !== trustedMvVersion
  ) {
    fail("trusted move binary version is invalid.");
  }
}

async function syncDirectory(directoryPath) {
  const handle = await open(
    directoryPath,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeStagedJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const handle = await open(
    filePath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size !== bytes.length
    ) {
      fail("staged report file authority is invalid.");
    }
    return Object.freeze({
      bytes,
      dev: metadata.dev,
      ino: metadata.ino,
      size: metadata.size,
    });
  } finally {
    await handle.close();
  }
}

async function verifyPublishedReportFile(filePath, expected) {
  const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.dev !== expected.dev ||
      metadata.ino !== expected.ino ||
      metadata.size !== expected.size ||
      !Buffer.from(await handle.readFile()).equals(expected.bytes)
    ) {
      fail("published report file verification failed.");
    }
  } finally {
    await handle.close();
  }
  const pathMetadata = await lstat(filePath);
  if (
    !pathMetadata.isFile() ||
    pathMetadata.isSymbolicLink() ||
    pathMetadata.nlink !== 1 ||
    pathMetadata.dev !== expected.dev ||
    pathMetadata.ino !== expected.ino
  ) {
    fail("published report file identity changed during verification.");
  }
}

async function verifyPublishedReportSet(outputDir, stagedDirectory, stagedFiles) {
  const metadata = await lstat(outputDir);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    metadata.dev !== stagedDirectory.dev ||
    metadata.ino !== stagedDirectory.ino
  ) {
    fail("published report directory verification failed.");
  }
  const expectedNames = [...stagedFiles.keys()].sort();
  const actualNames = (await readdir(outputDir)).sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    fail("published report directory members are invalid.");
  }
  for (const [fileName, expected] of stagedFiles) {
    await verifyPublishedReportFile(path.join(outputDir, fileName), expected);
  }
  const finalMetadata = await lstat(outputDir);
  if (
    !finalMetadata.isDirectory() ||
    finalMetadata.isSymbolicLink() ||
    finalMetadata.dev !== stagedDirectory.dev ||
    finalMetadata.ino !== stagedDirectory.ino
  ) {
    fail("published report directory identity changed during verification.");
  }
}

async function publishReportSet(outputDir, runtimeReports, summary) {
  if (
    !path.isAbsolute(outputDir) ||
    path.normalize(outputDir) !== outputDir ||
    !runtimeReports.every((report) => runtimeReportAuthority.has(report)) ||
    !summaryReportAuthority.has(summary)
  ) {
    fail("report-set publication authority is invalid.");
  }
  const runtimeIds = new Set();
  const entries = [];
  for (const report of runtimeReports) {
    if (
      (report.runtime !== "node22.13" && report.runtime !== "node24") ||
      runtimeIds.has(report.runtime)
    ) {
      fail("runtime report publication set is invalid.");
    }
    runtimeIds.add(report.runtime);
    entries.push([`${report.runtime}.json`, report]);
  }
  entries.push(["summary.json", summary]);

  const parentDirectory = path.dirname(outputDir);
  const stagingPrefix = path.join(parentDirectory, `.${path.basename(outputDir)}.stage-`);
  await mkdir(parentDirectory, { recursive: true });
  const stagingDirectory = await mkdtemp(stagingPrefix);
  const stagedFiles = new Map();
  try {
    await chmod(stagingDirectory, 0o700);
    const stagingMetadata = await lstat(stagingDirectory);
    if (
      !stagingMetadata.isDirectory() ||
      stagingMetadata.isSymbolicLink() ||
      (stagingMetadata.mode & 0o777) !== 0o700
    ) {
      fail("staged report directory authority is invalid.");
    }
    for (const [fileName, value] of entries) {
      stagedFiles.set(
        fileName,
        await writeStagedJson(path.join(stagingDirectory, fileName), value),
      );
    }
    await syncDirectory(stagingDirectory);
    await inspectTrustedMoveBinary();
    const moveResult = await runBoundedProcess(
      TRUSTED_MV_BINARY,
      ["--update=none-fail", "--no-copy", "--no-target-directory", stagingDirectory, outputDir],
      {
        cwd: parentDirectory,
        env: createPublicationEnvironment(),
        timeoutMs: 30_000,
      },
    );
    if (moveResult.exitCode !== 0 || moveResult.signal !== null || moveResult.timedOut) {
      fail("atomic report-set publication failed.");
    }
    await verifyPublishedReportSet(outputDir, stagingMetadata, stagedFiles);
    await syncDirectory(parentDirectory);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function createRuntimeCacheSentinel(privateHome) {
  if (!path.isAbsolute(privateHome)) fail("runtime cache sentinel HOME must be absolute.");
  const filePath = path.join(privateHome, "symbol-index-suite-sentinel.txt");
  const bytes = Buffer.from("symbol-index suite sentinel\n", "utf8");
  await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    fail("runtime cache sentinel must be a physical single-link file.");
  }
  return Object.freeze({
    filePath,
    bytes,
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
  });
}

export async function assertRuntimeCacheSentinel(privateHome, sentinel) {
  if (
    !path.isAbsolute(privateHome) ||
    path.dirname(sentinel.filePath) !== privateHome ||
    !Buffer.isBuffer(sentinel.bytes)
  ) {
    fail("runtime cache sentinel authority is invalid.");
  }
  const metadata = await lstat(sentinel.filePath).catch(() => undefined);
  if (
    metadata === undefined ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.dev !== sentinel.dev ||
    metadata.ino !== sentinel.ino ||
    metadata.size !== sentinel.size ||
    !Buffer.from(await readFile(sentinel.filePath)).equals(sentinel.bytes)
  ) {
    fail("runtime cache sentinel changed during candidate gates.");
  }
  const implicitCacheRoot = path.join(privateHome, ".cache", "ast-mcp-server", "symbol-index");
  const cacheMetadata = await lstat(implicitCacheRoot).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (cacheMetadata !== undefined) {
    fail("candidate gates created an implicit symbol-index cache outside owned test roots.");
  }
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

function runtimeFailureCode(failedPhase) {
  if (RELEASE_CANDIDATE_COMMAND_IDS.includes(failedPhase)) return "command-failed";
  if (failedPhase === "materialization") return "materialization-failed";
  if (failedPhase === "command-plan") return "command-plan-failed";
  if (failedPhase.startsWith("runtime-cache-sentinel")) return "runtime-guard-failed";
  if (failedPhase.endsWith("postcondition")) return "postcondition-failed";
  return "runtime-failed";
}

function closedCommandReports(evidence) {
  if (
    !Array.isArray(evidence.commands) ||
    evidence.commands.length > RELEASE_CANDIDATE_COMMAND_IDS.length
  ) {
    fail("runtime command evidence is invalid.");
  }
  return Object.freeze(
    evidence.commands.map((command, index) => {
      if (command.id !== RELEASE_CANDIDATE_COMMAND_IDS[index]) {
        fail("runtime command evidence order is invalid.");
      }
      return Object.freeze({
        id: command.id,
        status: command.status,
        command_failure_code: command.command_failure_code,
        exit_code: command.exit_code,
        timed_out: command.timed_out,
        duration_ms: command.duration_ms,
        stdout_bytes: command.stdout_bytes,
        stderr_bytes: command.stderr_bytes,
        stdout_sha256: command.stdout_sha256,
        stderr_sha256: command.stderr_sha256,
      });
    }),
  );
}

function buildRuntimeTerminalReport({ fallbackReport, runtimeReport, runtimeError, cleanupError }) {
  const failures = splitTerminalFailures(runtimeError, cleanupError);
  const candidateEvidence = [
    failures.runtimeError?.matrixReport,
    runtimeReport,
    fallbackReport,
  ].find((evidence) => runtimeEvidenceAuthority.has(evidence));
  if (candidateEvidence === undefined) fail("runtime terminal evidence authority is invalid.");
  const passed = failures.runtimeError === undefined && failures.cleanupError === undefined;
  if (passed && candidateEvidence.status !== "pass") {
    fail("successful runtime is missing PASS evidence.");
  }
  const failedPhase = passed
    ? null
    : (candidateEvidence.failed_phase ??
      (failures.runtimeError === undefined ? "cleanup" : "materialization"));
  const identity = candidateEvidence.identity;
  return brandRuntimeReport({
    schema_version: 1,
    status: passed ? "pass" : "fail",
    runtime: candidateEvidence.runtime,
    node_version: candidateEvidence.node_version,
    runtime_home_private: candidateEvidence.runtime_home_private,
    runtime_tmpdir_private: candidateEvidence.runtime_tmpdir_private,
    package_manager_node_version: candidateEvidence.package_manager_node_version,
    package_manager_environment_key_count:
      candidateEvidence.package_manager_environment_keys.length,
    cold_workspace: candidateEvidence.cold_workspace,
    workspace_tree: candidateEvidence.workspace_tree,
    workspace_commit: candidateEvidence.workspace_commit,
    package_version: candidateEvidence.package_version,
    candidate_tree: candidateEvidence.candidate_tree,
    head: identity.head,
    head_tree: identity.head_tree,
    initial_index_tree: identity.initial_index_tree,
    git_version: identity.git_authority.version,
    git_sha256: identity.git_authority.sha256,
    command_order: RELEASE_CANDIDATE_COMMAND_IDS,
    commands: closedCommandReports(candidateEvidence),
    failed_phase: failedPhase,
    runtime_failure_code:
      passed || failures.runtimeError === undefined ? null : runtimeFailureCode(failedPhase),
    cleanup_status: failures.cleanupError === undefined ? "pass" : "fail",
    cleanup_failure_code: failures.cleanupError === undefined ? null : "cleanup-failed",
    index_tree: candidateEvidence.index_tree ?? null,
    runtime_cache_sentinel_unchanged: candidateEvidence.runtime_cache_sentinel_unchanged ?? null,
  });
}

function runtimeSummaryEntry(report) {
  if (!runtimeReportAuthority.has(report)) fail("runtime summary evidence authority is invalid.");
  return Object.freeze({
    id: report.runtime,
    node_version: report.node_version,
    report: `${report.runtime}.json`,
    status: report.status,
    command_count: report.commands.length,
  });
}

function buildPassSummary({
  packageVersion,
  candidateTree,
  initialIndexTree,
  finalIndexTree,
  packageManagerNodeVersion,
  reports,
}) {
  return brandSummaryReport({
    schema_version: 1,
    status: "pass",
    package_version: packageVersion,
    candidate_tree: candidateTree,
    initial_index_tree: initialIndexTree,
    final_index_tree: finalIndexTree,
    package_manager_node_version: packageManagerNodeVersion,
    package_manager_environment_key_count: reports[0]?.package_manager_environment_key_count ?? 0,
    runtimes: Object.freeze(reports.map(runtimeSummaryEntry)),
  });
}

function buildFailureSummary({
  packageVersion,
  candidateTree,
  initialIndexTree,
  packageManagerNodeVersion,
  failedReport,
  reports,
}) {
  if (!runtimeReportAuthority.has(failedReport) || failedReport.status !== "fail") {
    fail("failed runtime summary evidence authority is invalid.");
  }
  return brandSummaryReport({
    schema_version: 1,
    status: "fail",
    package_version: packageVersion,
    candidate_tree: candidateTree,
    initial_index_tree: initialIndexTree,
    package_manager_node_version: packageManagerNodeVersion,
    failed_runtime: failedReport.runtime,
    failed_phase: failedReport.failed_phase,
    runtime_failure_code: failedReport.runtime_failure_code,
    cleanup_status: failedReport.cleanup_status,
    cleanup_failure_code: failedReport.cleanup_failure_code,
    runtimes: Object.freeze([...reports, failedReport].map(runtimeSummaryEntry)),
  });
}

function buildPreflightSummary(candidateTree) {
  return brandSummaryReport({
    schema_version: 1,
    status: "fail",
    candidate_tree: candidateTree,
    failed_phase: "preflight",
    failure_code: "preflight-failed",
  });
}

async function publishTerminalReportSet(outputDir, runtimeReports, summary) {
  terminalPublishAttempted = true;
  await publishReportSet(outputDir, runtimeReports, summary);
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
  let runtimeCacheSentinelUnchanged = null;
  try {
    failedPhase = "runtime-cache-sentinel-setup";
    const cacheSentinel = await createRuntimeCacheSentinel(runtimeGateEnvironment.HOME);
    const plan = createRuntimeCommandPlan(
      runtime,
      runtime.yarnEntry,
      packageManager,
      materialization.workspaceRoot,
    );
    for (const command of plan) {
      failedPhase = command.id;
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
        fail(`${runtime.id} command ${command.id} failed.`);
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
    failedPhase = "runtime-cache-sentinel-postcondition";
    await assertRuntimeCacheSentinel(runtimeGateEnvironment.HOME, cacheSentinel);
    runtimeCacheSentinelUnchanged = true;
    failedPhase = "worktree-postcondition";
    const workspaceTree = await assertCandidateWorktreeState(
      materialization.workspaceRoot,
      candidateTree,
    );
    failedPhase = "index-postcondition";
    const finalIndexTree = await assertRepositoryState(candidateTree);
    return brandRuntimeEvidence({
      ...reportBase,
      status: "pass",
      failed_phase: null,
      workspace_tree: workspaceTree,
      index_tree: finalIndexTree,
      runtime_cache_sentinel_unchanged: runtimeCacheSentinelUnchanged,
      commands: Object.freeze(commandReports),
    });
  } catch (error) {
    const wrapped = new Error(`${runtime.id} failed during ${failedPhase}.`, { cause: error });
    wrapped.matrixReport = brandRuntimeEvidence({
      ...reportBase,
      status: "fail",
      failed_phase: failedPhase,
      index_tree: null,
      runtime_cache_sentinel_unchanged: runtimeCacheSentinelUnchanged,
      commands: Object.freeze(commandReports),
    });
    throw wrapped;
  }
}

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("the verified release matrix is limited to Linux x64.");
  }
  const options = parseReleaseCandidateMatrixArgs(process.argv.slice(2));
  terminalContext = Object.freeze({
    outputDir: options.outputDir,
    candidateTree: options.candidateTree ?? null,
  });
  const node22Binary = process.env.AST_NODE_22_13_BIN;
  const node24Binary = process.env.AST_NODE_24_BIN;
  if (node22Binary === undefined || node24Binary === undefined) {
    fail("AST_NODE_22_13_BIN and AST_NODE_24_BIN are required.");
  }
  assertNoAmbientGitControls();
  await mkdir(path.dirname(options.outputDir), { recursive: true });

  const gitAuthority = await inspectTrustedGitBinary();

  const initialIndexTree = await assertRepositoryState(options.candidateTree);
  const [head, headTree] = (await runGit(["rev-parse", "HEAD", "HEAD^{tree}"])).split("\n");
  const packageMetadata = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  if (packageMetadata.version !== "0.10.0") fail("package version must be exactly 0.10.0.");
  const identity = Object.freeze({
    head,
    head_tree: headTree,
    initial_index_tree: initialIndexTree,
    git_authority: gitAuthority,
  });

  const runtimes = [
    await inspectRuntime("node22.13", node22Binary),
    await inspectRuntime("node24", node24Binary),
  ];
  const packageManager = runtimes.find(({ id }) => id === "node24");
  if (packageManager === undefined) fail("the Node 24 package-manager runtime is missing.");
  const materializedTree = options.candidateTree ?? initialIndexTree;
  const reports = [];
  for (const runtime of runtimes) {
    const fallbackReport = brandRuntimeEvidence({
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
      workspace_tree: null,
      workspace_commit: null,
      package_version: packageMetadata.version,
      candidate_tree: options.candidateTree ?? null,
      identity,
      command_order: RELEASE_CANDIDATE_COMMAND_IDS,
      failed_phase: null,
      index_tree: null,
      runtime_cache_sentinel_unchanged: null,
      commands: Object.freeze([]),
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
    if (terminalReport.status === "fail") {
      const summary = buildFailureSummary({
        packageVersion: packageMetadata.version,
        candidateTree: options.candidateTree ?? null,
        initialIndexTree,
        packageManagerNodeVersion: packageManager.version.raw,
        failedReport: terminalReport,
        reports,
      });
      await publishTerminalReportSet(options.outputDir, [...reports, terminalReport], summary);
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
  const finalIndexTree = await assertRepositoryState(options.candidateTree);
  const summary = buildPassSummary({
    packageVersion: packageMetadata.version,
    candidateTree: options.candidateTree ?? null,
    initialIndexTree,
    finalIndexTree,
    packageManagerNodeVersion: packageManager.version.raw,
    reports,
  });
  await publishTerminalReportSet(options.outputDir, reports, summary);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

const entryPath = process.argv[1] === undefined ? undefined : path.resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch(async () => {
    if (terminalContext !== undefined && !terminalPublishAttempted) {
      try {
        await publishTerminalReportSet(
          terminalContext.outputDir,
          [],
          buildPreflightSummary(terminalContext.candidateTree),
        );
      } catch {
        // Terminal publication is best-effort because an existing destination must never be replaced.
      }
    }
    process.stderr.write("Release candidate matrix failed.\n");
    process.exitCode = 1;
  });
}
