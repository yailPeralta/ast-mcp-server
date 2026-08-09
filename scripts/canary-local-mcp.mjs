#!/usr/bin/env node

import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { JSONRPCMessageSchema, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const packageMetadata = createRequire(import.meta.url)("../package.json");
const serverPath = path.join(repositoryRoot, "dist/index.js");
const FIXTURE_SERVER_MODE = "fixture-server";
const REPORT_SCHEMA_VERSION = 1;
const WORKLOAD_SCHEMA_VERSION = 1;
const REQUIRED_ITERATIONS = 20;
const REQUIRED_RESTARTS = 3;
const FIXTURE_WARMUPS = 10;
const FIXTURE_MEASURED_READS = 50;
const MAX_WORKLOAD_BYTES = 256 * 1024;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const CANARY_OPERATION_DEADLINE_MS = 300_000;
const MCP_REQUEST_TIMEOUT_MS = CANARY_OPERATION_DEADLINE_MS + 30_000;
const PROCESS_EXIT_TIMEOUT_MS = 30_000;
const MAX_WORKLOAD_CALLS = 16;
const MAX_QUEUE_COUNTER = 2_147_483_647;
const MAX_QUEUE_DURATION_MS = 86_400_000;
const PHYSICAL_TMP_ROOT = "/tmp";
const EMPTY_GIT_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const activeMcpProcesses = new Set();
const FROZEN_REPORT_RESULTS_DIRECTORY = "benchmark/results";
const FROZEN_REPORT_DIRECTORY_NAME = "production-readiness";
const FROZEN_REPORT_SET_MEMBERS = Object.freeze([
  Object.freeze({
    inputKey: "astNode24",
    option: "--ast-node24",
    fileName: "ast-mcp-server-node24.json",
    relativePath: "benchmark/results/production-readiness/ast-mcp-server-node24.json",
    alias: "[ast-mcp-server]",
    runtime: "24",
  }),
  Object.freeze({
    inputKey: "astNode22_5",
    option: "--ast-node22.5",
    fileName: "ast-mcp-server-node22.5.json",
    relativePath: "benchmark/results/production-readiness/ast-mcp-server-node22.5.json",
    alias: "[ast-mcp-server]",
    runtime: "22.5.0",
  }),
  Object.freeze({
    inputKey: "xScraperNode24",
    option: "--x-scraper-node24",
    fileName: "x-scraper-node24.json",
    relativePath: "benchmark/results/production-readiness/x-scraper-node24.json",
    alias: "[x-scraper]",
    runtime: "24",
  }),
  Object.freeze({
    inputKey: "xScraperNode22_5",
    option: "--x-scraper-node22.5",
    fileName: "x-scraper-node22.5.json",
    relativePath: "benchmark/results/production-readiness/x-scraper-node22.5.json",
    alias: "[x-scraper]",
    runtime: "22.5.0",
  }),
]);
const FROZEN_REPORT_MEMBERS_BY_OPTION = Object.freeze(
  Object.fromEntries(FROZEN_REPORT_SET_MEMBERS.map((member) => [member.option, member])),
);
const FROZEN_REPORT_DESTINATIONS = Object.freeze(
  Object.fromEntries(
    FROZEN_REPORT_SET_MEMBERS.map((member) => [
      member.relativePath,
      Object.freeze({ alias: member.alias, runtime: member.runtime }),
    ]),
  ),
);
const READ_ONLY_TOOLS = new Set([
  "ast_list_files",
  "ast_search_symbols",
  "ast_explore",
  "ast_get_impact",
]);
const VOLATILE_PARITY_FIELDS = new Set(["duration_ms", "checked_at"]);
const TOOL_ARGUMENTS = Object.freeze({
  ast_list_files: new Set(["glob_filter", "offset", "limit"]),
  ast_search_symbols: new Set([
    "query",
    "kinds",
    "file_filter",
    "detail",
    "output_format",
    "offset",
    "limit",
  ]),
  ast_explore: new Set([
    "query",
    "file_path",
    "symbol_path",
    "kinds",
    "file_filter",
    "detail",
    "include_source",
    "include_references",
    "reference_detail",
    "reference_limit",
    "offset",
    "limit",
    "max_bytes",
  ]),
  ast_get_impact: new Set([
    "file_path",
    "symbol_path",
    "direction",
    "max_depth",
    "max_nodes",
    "max_edges",
    "relationship_kinds",
    "output_format",
  ]),
});

function fail(message) {
  throw new Error(message);
}

function emitProgress(phase) {
  process.stderr.write(`${JSON.stringify({ event: "canary_progress", phase })}\n`);
}

function assertGatesPass(gates, label) {
  const failed = Object.entries(gates)
    .filter(([, value]) => value !== true)
    .map(([name]) => name);
  if (failed.length > 0) fail(`${label} gates failed: ${failed.join(", ")}.`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object.`);
  return value;
}

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer in ${minimum}..${maximum}.`);
  }
  return value;
}

function assertString(value, label, maximum = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    fail(`${label} must be a non-empty string of at most ${maximum} characters.`);
  }
  return value;
}

function normalizeSeparators(value) {
  return value.replaceAll("\\", "/");
}

function assertProjectRelativePath(value, label) {
  const candidate = assertString(value, label, 512);
  const normalized = normalizeSeparators(candidate);
  if (
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.startsWith("\\\\") ||
    normalized.split("/").includes("..")
  ) {
    fail(`${label} must be a safe project-relative path.`);
  }
  return candidate;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedJsonValue(value[key])]),
  );
}

function canonicalJson(value) {
  return `${JSON.stringify(sortedJsonValue(value), null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function isPathInsideOrEqual(parent, candidate) {
  return parent === candidate || isPathInside(parent, candidate);
}

async function nearestExistingAncestor(candidate) {
  let current = path.resolve(candidate);
  while (!(await pathExists(current))) {
    const parent = path.dirname(current);
    if (parent === current) fail("No existing ancestor was found for canary output.");
    current = parent;
  }
  return realpath(current);
}

async function assertNewPathWithin(root, candidate, label) {
  const [physicalRoot, physicalAncestor] = await Promise.all([
    realpath(root),
    nearestExistingAncestor(path.dirname(candidate)),
  ]);
  if (!isPathInsideOrEqual(physicalRoot, physicalAncestor)) {
    fail(`${label} escapes its physical root.`);
  }
  if (await pathExists(candidate)) fail(`${label} already exists; refusing to overwrite evidence.`);
}

async function openAnchoredDirectory(root, directory, label, create = false) {
  if (create) await mkdir(directory, { recursive: true });
  const handle = await open(
    directory,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    const [physicalRoot, physicalDirectory] = await Promise.all([
      realpath(root),
      realpath(`/proc/self/fd/${handle.fd}`),
    ]);
    if (!isPathInsideOrEqual(physicalRoot, physicalDirectory)) {
      fail(`${label} escapes its physical root.`);
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function writeExclusiveAt(directoryHandle, fileName, content, mode) {
  if (path.basename(fileName) !== fileName || fileName === "." || fileName === "..") {
    fail("Exclusive evidence filename is invalid.");
  }
  await writeFile(`/proc/self/fd/${directoryHandle.fd}/${fileName}`, content, {
    encoding: "utf8",
    flag: "wx",
    mode,
  });
}

async function writeExclusiveSyncedAt(directoryHandle, fileName, bytes, mode) {
  const handle = await open(
    `/proc/self/fd/${directoryHandle.fd}/${fileName}`,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    mode,
  );
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function validatePublicationFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    fail("Atomic directory publication requires at least one file.");
  }
  const names = new Set();
  return files.map((file) => {
    if (
      file === null ||
      typeof file !== "object" ||
      typeof file.name !== "string" ||
      file.name.length === 0 ||
      path.basename(file.name) !== file.name ||
      typeof file.bytes !== "string"
    ) {
      fail("Atomic directory publication files require a simple name and string bytes.");
    }
    if (names.has(file.name)) fail("Atomic directory publication file names must be unique.");
    names.add(file.name);
    return Object.freeze({ name: file.name, bytes: file.bytes });
  });
}

async function verifyStagedFiles(directoryHandle, files) {
  const directoryPath = `/proc/self/fd/${directoryHandle.fd}`;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const expectedNames = files.map(({ name }) => name).sort();
  if (
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(expectedNames)
  ) {
    fail("Atomic directory staging must contain exactly the prepared regular files.");
  }
  for (const file of files) {
    const handle = await open(
      `${directoryPath}/${file.name}`,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      const [fileStat, bytes] = await Promise.all([handle.stat(), handle.readFile()]);
      if (
        !fileStat.isFile() ||
        fileStat.nlink !== 1 ||
        !bytes.equals(Buffer.from(file.bytes, "utf8"))
      ) {
        fail(`Staged file ${file.name} does not match its prepared bytes.`);
      }
    } finally {
      await handle.close();
    }
  }
}

async function moveDirectoryNoReplace(parentHandle, stageName, finalName) {
  const childParentDescriptor = 3;
  const childParentPath = `/proc/self/fd/${childParentDescriptor}`;
  const child = spawn(
    "/usr/bin/mv",
    [
      "--update=none-fail",
      "--no-copy",
      "--no-target-directory",
      "--",
      `${childParentPath}/${stageName}`,
      `${childParentPath}/${finalName}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe", parentHandle.fd],
    },
  );
  const stderr = [];
  child.stdout.resume();
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const failedToSpawn = new Promise((_resolve, reject) => child.once("error", reject));
  const result = await Promise.race([closed, failedToSpawn]);
  if (result.code !== 0 || result.signal !== null) {
    const diagnostic = Buffer.concat(stderr)
      .toString("utf8")
      .replace(/\p{Cc}+/gu, " ")
      .trim()
      .slice(0, 256);
    fail(
      `Atomic no-replace publication failed (code=${String(result.code)}, signal=${String(result.signal)}).${diagnostic ? ` diagnostic=${JSON.stringify(diagnostic)}` : ""}`,
    );
  }
}

async function assertPinnedStageName(parentHandle, stageHandle, stageName) {
  let namedHandle;
  try {
    namedHandle = await open(
      `/proc/self/fd/${parentHandle.fd}/${stageName}`,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    const [pinnedIdentity, namedIdentity] = await Promise.all([
      stageHandle.stat({ bigint: true }),
      namedHandle.stat({ bigint: true }),
    ]);
    if (pinnedIdentity.dev !== namedIdentity.dev || pinnedIdentity.ino !== namedIdentity.ino) {
      fail("Atomic staging directory identity changed before publication.");
    }
  } finally {
    await namedHandle?.close().catch(() => undefined);
  }
}

async function pinnedDirectoryWasCommitted(parentHandle, stageHandle, stageName, finalName) {
  const parentPath = `/proc/self/fd/${parentHandle.fd}`;
  if (await pathExists(`${parentPath}/${stageName}`)) return false;
  let finalHandle;
  try {
    finalHandle = await open(
      `${parentPath}/${finalName}`,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    const [stagedIdentity, finalIdentity] = await Promise.all([
      stageHandle.stat({ bigint: true }),
      finalHandle.stat({ bigint: true }),
    ]);
    return stagedIdentity.dev === finalIdentity.dev && stagedIdentity.ino === finalIdentity.ino;
  } catch {
    return false;
  } finally {
    await finalHandle?.close().catch(() => undefined);
  }
}

async function findPinnedDirectoryName(parentHandle, pinnedHandle) {
  const parentPath = `/proc/self/fd/${parentHandle.fd}`;
  const pinnedIdentity = await pinnedHandle.stat({ bigint: true });
  const names = (await readdir(parentPath)).sort();
  for (const name of names) {
    let candidateHandle;
    try {
      candidateHandle = await open(
        `${parentPath}/${name}`,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      );
      const candidateIdentity = await candidateHandle.stat({ bigint: true });
      if (
        candidateIdentity.dev === pinnedIdentity.dev &&
        candidateIdentity.ino === pinnedIdentity.ino
      ) {
        return name;
      }
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) throw error;
    } finally {
      await candidateHandle?.close().catch(() => undefined);
    }
  }
  return undefined;
}

async function removePinnedDirectory(parentHandle, pinnedHandle) {
  const ownedName = await findPinnedDirectoryName(parentHandle, pinnedHandle);
  if (ownedName === undefined) return;
  await assertPinnedStageName(parentHandle, pinnedHandle, ownedName);
  await removeTree(`/proc/self/fd/${parentHandle.fd}/${ownedName}`);
}

// Keep the primitive private so freezeCanaryReportSet is the only module publication surface.
async function publishAtomicDirectorySet({
  anchorRoot,
  resultsDirectory,
  finalDirectoryName,
  files,
  beforeVisibility,
}) {
  if (
    typeof finalDirectoryName !== "string" ||
    finalDirectoryName.length === 0 ||
    path.basename(finalDirectoryName) !== finalDirectoryName
  ) {
    fail("Atomic directory publication requires a simple final directory name.");
  }
  const preparedFiles = validatePublicationFiles(files);
  const resultsHandle = await openAnchoredDirectory(
    anchorRoot,
    resultsDirectory,
    "Atomic directory results directory",
  );
  const anchoredResultsPath = `/proc/self/fd/${resultsHandle.fd}`;
  const lockPath = `${anchoredResultsPath}/.${finalDirectoryName}.lock`;
  const finalPath = `${anchoredResultsPath}/${finalDirectoryName}`;
  let lockHandle;
  let stageHandle;
  let published = false;
  try {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        lockHandle = await open(
          lockPath,
          fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
        );
      } catch (error) {
        await removeTree(lockPath);
        throw error;
      }
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail("Another atomic directory publisher holds the exclusive sibling lock.");
      }
      throw error;
    }
    if (await pathExists(finalPath)) {
      fail("Final directory already exists; refusing to overwrite it.");
    }
    const stagePath = await mkdtemp(`${anchoredResultsPath}/.${finalDirectoryName}.stage-`);
    const stageDirectory = await realpath(stagePath);
    const stageName = path.basename(stageDirectory);
    stageHandle = await open(
      stagePath,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    const [pinnedStageDirectory, pinnedResultsDirectory] = await Promise.all([
      realpath(`/proc/self/fd/${stageHandle.fd}`),
      realpath(`/proc/self/fd/${resultsHandle.fd}`),
    ]);
    if (
      pinnedStageDirectory !== stageDirectory ||
      path.dirname(pinnedStageDirectory) !== pinnedResultsDirectory
    ) {
      fail("Atomic directory staging escaped its pinned results parent.");
    }
    for (const file of preparedFiles) {
      await writeExclusiveSyncedAt(stageHandle, file.name, file.bytes, 0o644);
    }
    await beforeVisibility?.({
      stageDirectory,
      fileNames: preparedFiles.map(({ name }) => name),
    });
    await verifyStagedFiles(stageHandle, preparedFiles);
    await assertPinnedStageName(resultsHandle, stageHandle, stageName);
    try {
      await moveDirectoryNoReplace(resultsHandle, stageName, finalDirectoryName);
    } catch (error) {
      if (
        !(await pinnedDirectoryWasCommitted(
          resultsHandle,
          stageHandle,
          stageName,
          finalDirectoryName,
        ))
      ) {
        throw error;
      }
    }
    published = true;
  } finally {
    if (stageHandle && !published) await removePinnedDirectory(resultsHandle, stageHandle);
    if (lockHandle) {
      if (published) await removePinnedDirectory(resultsHandle, lockHandle).catch(() => undefined);
      else await removePinnedDirectory(resultsHandle, lockHandle);
    }
    await stageHandle?.close().catch(() => undefined);
    await lockHandle?.close().catch(() => undefined);
    if (published) await resultsHandle.close().catch(() => undefined);
    else await resultsHandle.close();
  }
}

function reportArgumentVector(options) {
  const argv = [
    "benchmark:production-readiness",
    "--node-bin",
    "[node-bin]",
    "--expected-node",
    options.expectedNode,
  ];
  for (const nodeOption of options.nodeOptions) argv.push(`--node-option=${nodeOption}`);
  argv.push(
    "--project",
    "[project]",
    "--workload",
    "[workload]",
    "--iterations",
    String(options.iterations),
    "--restarts",
    String(options.restarts),
    "--output",
    "[output]",
  );
  if (options.cacheRoot) argv.push("--cache-root", "[cache-root]");
  if (options.candidateTree) argv.push("--candidate-tree", options.candidateTree);
  return argv;
}

function exactArgumentVector(options) {
  const argv = [
    "benchmark:production-readiness",
    "--node-bin",
    options.nodeBin,
    "--expected-node",
    options.expectedNode,
  ];
  for (const nodeOption of options.nodeOptions) argv.push(`--node-option=${nodeOption}`);
  argv.push(
    "--project",
    options.projectRoot,
    "--workload",
    options.workloadPath,
    "--iterations",
    String(options.iterations),
    "--restarts",
    String(options.restarts),
    "--output",
    options.outputPath,
  );
  if (options.cacheRoot) argv.push("--cache-root", options.cacheRoot);
  if (options.candidateTree) argv.push("--candidate-tree", options.candidateTree);
  return argv;
}

function validateFreezeReportSetInputs(value) {
  const inputs = assertExactKeys(
    value,
    FROZEN_REPORT_SET_MEMBERS.map((member) => member.inputKey),
    "freeze-report-set inputs",
  );
  const normalized = {};
  const uniquePaths = new Set();
  for (const member of FROZEN_REPORT_SET_MEMBERS) {
    const inputPath = inputs[member.inputKey];
    if (
      typeof inputPath !== "string" ||
      !path.isAbsolute(inputPath) ||
      path.resolve(inputPath) !== inputPath ||
      path.dirname(inputPath) !== PHYSICAL_TMP_ROOT
    ) {
      fail(`${member.option} must be a canonical absolute direct child of physical /tmp.`);
    }
    if (uniquePaths.has(inputPath)) fail("freeze-report-set input paths must be unique.");
    uniquePaths.add(inputPath);
    normalized[member.inputKey] = inputPath;
  }
  return deepFreeze(normalized);
}

function validateXScraperRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) !== value) {
    fail("--x-scraper-root is required and must be a canonical absolute path.");
  }
  return value;
}

export function parseCanaryArguments(argv) {
  const mode = argv[0];
  if (mode !== "run" && mode !== "freeze-report-set") {
    fail("Expected subcommand run or freeze-report-set.");
  }
  if (mode === "freeze-report-set") {
    const inputs = {};
    let xScraperRoot;
    const seen = new Set();
    for (let index = 1; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === "--x-scraper-root") {
        if (seen.has(argument)) fail(`Duplicate freeze-report-set argument: ${argument}`);
        seen.add(argument);
        xScraperRoot = argv[++index];
        continue;
      }
      const member = FROZEN_REPORT_MEMBERS_BY_OPTION[argument];
      if (!member) fail(`Unknown freeze-report-set argument: ${String(argument)}`);
      if (seen.has(argument)) fail(`Duplicate freeze-report-set argument: ${argument}`);
      seen.add(argument);
      inputs[member.inputKey] = argv[++index];
    }
    const missing = FROZEN_REPORT_SET_MEMBERS.filter((member) => !seen.has(member.option)).map(
      (member) => member.option,
    );
    if (missing.length > 0) {
      fail(`freeze-report-set requires exactly one of each input: ${missing.join(", ")}.`);
    }
    return deepFreeze({
      mode,
      xScraperRoot: validateXScraperRoot(xScraperRoot),
      inputs: validateFreezeReportSetInputs(inputs),
    });
  }

  const options = {
    mode,
    nodeBin: undefined,
    expectedNode: undefined,
    nodeOptions: [],
    projectRoot: undefined,
    workloadPath: undefined,
    iterations: undefined,
    restarts: undefined,
    outputPath: undefined,
    cacheRoot: undefined,
    candidateTree: undefined,
  };
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const optionName = argument.startsWith("--node-option=") ? "--node-option" : argument;
    if (seen.has(optionName)) fail(`Duplicate run argument: ${optionName}`);
    seen.add(optionName);
    if (argument === "--node-bin") options.nodeBin = argv[++index];
    else if (argument === "--expected-node") options.expectedNode = argv[++index];
    else if (argument.startsWith("--node-option=")) {
      options.nodeOptions.push(argument.slice("--node-option=".length));
    } else if (argument === "--node-option") options.nodeOptions.push(argv[++index]);
    else if (argument === "--project") options.projectRoot = argv[++index];
    else if (argument === "--workload") options.workloadPath = argv[++index];
    else if (argument === "--iterations") options.iterations = Number(argv[++index]);
    else if (argument === "--restarts") options.restarts = Number(argv[++index]);
    else if (argument === "--output") options.outputPath = argv[++index];
    else if (argument === "--cache-root") options.cacheRoot = argv[++index];
    else if (argument === "--candidate-tree") options.candidateTree = argv[++index];
    else fail(`Unknown run argument: ${argument}`);
  }

  if (!options.nodeBin || !path.isAbsolute(options.nodeBin)) {
    fail("--node-bin must be an absolute executable path.");
  }
  if (options.expectedNode !== "22.5.0" && options.expectedNode !== "24") {
    fail("--expected-node must be 22.5.0 or 24.");
  }
  if (!options.projectRoot || !path.isAbsolute(options.projectRoot)) {
    fail("--project must be an absolute path.");
  }
  if (!options.workloadPath) {
    fail("--workload is required.");
  }
  if (!options.outputPath || !path.isAbsolute(options.outputPath)) {
    fail("--output must be an absolute path.");
  }
  if (options.iterations !== REQUIRED_ITERATIONS) {
    fail(`--iterations must equal the preregistered value ${REQUIRED_ITERATIONS}.`);
  }
  if (options.restarts !== REQUIRED_RESTARTS) {
    fail(`--restarts must equal the preregistered value ${REQUIRED_RESTARTS}.`);
  }
  if (options.cacheRoot && !path.isAbsolute(options.cacheRoot)) {
    fail("--cache-root must be absolute when provided.");
  }
  if (options.candidateTree && !/^[0-9a-f]{40}$/.test(options.candidateTree)) {
    fail("--candidate-tree must be a lowercase 40-character Git tree hash.");
  }
  if (options.nodeOptions.some((value) => value !== "--experimental-sqlite")) {
    fail("Only --experimental-sqlite is accepted as a canary Node option.");
  }
  if (options.expectedNode === "22.5.0" && !options.nodeOptions.includes("--experimental-sqlite")) {
    fail("Node 22.5.0 canary runs require --experimental-sqlite.");
  }
  const resolvedOutput = path.resolve(options.outputPath);
  if (path.dirname(resolvedOutput) !== PHYSICAL_TMP_ROOT) {
    fail("Raw canary --output must be a direct child of physical /tmp.");
  }
  if (options.cacheRoot && path.dirname(path.resolve(options.cacheRoot)) !== PHYSICAL_TMP_ROOT) {
    fail("Explicit canary --cache-root must be a direct child of physical /tmp.");
  }
  const resolved = {
    ...options,
    nodeBin: path.resolve(options.nodeBin),
    projectRoot: path.resolve(options.projectRoot),
    workloadPath: path.resolve(options.workloadPath),
    outputPath: resolvedOutput,
    cacheRoot: options.cacheRoot ? path.resolve(options.cacheRoot) : undefined,
  };
  resolved.reportArgv = reportArgumentVector(resolved);
  resolved.exactArgv = exactArgumentVector(resolved);
  return deepFreeze(resolved);
}

export function assertExpectedNodeVersion(expected, observed) {
  if (expected !== "22.5.0" && expected !== "24") {
    fail("Expected Node contract must be 22.5.0 or 24.");
  }
  if (expected === "22.5.0" && observed !== "v22.5.0") {
    fail(`Expected exact Node v22.5.0, observed ${String(observed)}.`);
  }
  if (expected === "24" && !/^v24\./.test(String(observed))) {
    fail(`Expected a v24 Node runtime, observed ${String(observed)}.`);
  }
}

function assertAllowedArgumentKeys(tool, args) {
  const allowed = TOOL_ARGUMENTS[tool];
  for (const key of Object.keys(args)) {
    if (key === "project_root") fail("Workloads must not embed project_root.");
    if (!allowed.has(key)) fail(`Unsupported ${tool} workload argument: ${key}.`);
  }
}

function validateOptionalPagination(args, label) {
  if (args.offset !== undefined) assertInteger(args.offset, `${label}.offset`, 0, 1_000_000);
  if (args.limit !== undefined) assertInteger(args.limit, `${label}.limit`, 1, 500);
}

function validateStringArray(value, label, allowed) {
  if (!Array.isArray(value) || value.length > 32)
    fail(`${label} must be an array of at most 32 values.`);
  for (const item of value) {
    assertString(item, `${label} item`, 128);
    if (allowed && !allowed.has(item)) fail(`${label} contains unsupported value ${item}.`);
  }
}

function validateWorkloadCall(call, index) {
  const record = assertPlainObject(call, `calls[${index}]`);
  const id = assertString(record.id, `calls[${index}].id`, 64);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) fail(`calls[${index}].id is not canonical.`);
  const tool = assertString(record.tool, `calls[${index}].tool`, 64);
  if (!READ_ONLY_TOOLS.has(tool)) fail(`${tool} is not an allowed read-only canary tool.`);
  const args = assertPlainObject(record.arguments, `calls[${index}].arguments`);
  assertAllowedArgumentKeys(tool, args);
  validateOptionalPagination(args, `calls[${index}].arguments`);

  if (args.query !== undefined) assertString(args.query, `${id}.query`, 256);
  if (args.glob_filter !== undefined) assertString(args.glob_filter, `${id}.glob_filter`, 256);
  if (args.file_filter !== undefined) assertString(args.file_filter, `${id}.file_filter`, 256);
  if (args.file_path !== undefined) assertProjectRelativePath(args.file_path, `${id}.file_path`);
  if (args.symbol_path !== undefined) assertString(args.symbol_path, `${id}.symbol_path`, 512);
  if (args.kinds !== undefined) validateStringArray(args.kinds, `${id}.kinds`);
  if (args.relationship_kinds !== undefined) {
    validateStringArray(
      args.relationship_kinds,
      `${id}.relationship_kinds`,
      new Set(["reference", "import", "export", "extends", "implements", "call", "contains"]),
    );
  }
  if (args.output_format !== undefined && args.output_format !== "json") {
    fail(`${id}.output_format must be json for parity evidence.`);
  }
  if (args.detail !== undefined) {
    const details =
      tool === "ast_explore"
        ? new Set(["selectors", "summary", "context", "full"])
        : new Set(["selectors", "summary", "full"]);
    if (!details.has(args.detail)) fail(`${id}.detail is invalid.`);
  }
  if (
    args.direction !== undefined &&
    !new Set(["incoming", "outgoing", "both"]).has(args.direction)
  ) {
    fail(`${id}.direction is invalid.`);
  }
  if (args.max_depth !== undefined) assertInteger(args.max_depth, `${id}.max_depth`, 0, 32);
  if (args.max_nodes !== undefined) assertInteger(args.max_nodes, `${id}.max_nodes`, 1, 1000);
  if (args.max_edges !== undefined) assertInteger(args.max_edges, `${id}.max_edges`, 1, 5000);
  if (args.reference_limit !== undefined) {
    assertInteger(args.reference_limit, `${id}.reference_limit`, 1, 100);
  }
  if (args.max_bytes !== undefined)
    assertInteger(args.max_bytes, `${id}.max_bytes`, 1024, 1_048_576);
  if (tool === "ast_get_impact" && (!args.file_path || !args.symbol_path)) {
    fail(`${id} requires file_path and symbol_path.`);
  }
  if (tool === "ast_search_symbols" && !args.query) fail(`${id} requires query.`);
  if (tool === "ast_explore" && !args.query && !args.file_path) {
    fail(`${id} requires query or file_path.`);
  }
  return cloneJson({ id, tool, arguments: args });
}

export function validateWorkloadManifest(value) {
  const manifest = assertPlainObject(value, "Workload manifest");
  const allowedTopLevel = new Set([
    "schema_version",
    "project_alias",
    "description",
    "measurement_call_id",
    "calls",
  ]);
  for (const key of Object.keys(manifest)) {
    if (!allowedTopLevel.has(key)) fail(`Unknown workload field: ${key}.`);
  }
  if (manifest.schema_version !== WORKLOAD_SCHEMA_VERSION) {
    fail(`Workload schema_version must equal ${WORKLOAD_SCHEMA_VERSION}.`);
  }
  const projectAlias = assertString(manifest.project_alias, "project_alias", 64);
  if (!/^\[[a-z0-9-]+\]$/.test(projectAlias)) fail("project_alias must be a bracketed alias.");
  if (manifest.description !== undefined) assertString(manifest.description, "description", 512);
  if (
    !Array.isArray(manifest.calls) ||
    manifest.calls.length < 4 ||
    manifest.calls.length > MAX_WORKLOAD_CALLS
  ) {
    fail(`calls must contain 4..${MAX_WORKLOAD_CALLS} read-only operations.`);
  }
  const calls = manifest.calls.map(validateWorkloadCall);
  const ids = new Set();
  for (const call of calls) {
    if (ids.has(call.id)) fail(`Duplicate workload call id: ${call.id}.`);
    ids.add(call.id);
  }
  const tools = new Set(calls.map((call) => call.tool));
  for (const required of READ_ONLY_TOOLS) {
    if (!tools.has(required)) fail(`Workload must include ${required}.`);
  }
  const searchCount = calls.filter((call) => call.tool === "ast_search_symbols").length;
  if (searchCount < 2) fail("Workload must include exact and broad symbol searches.");
  const measurementCallId = assertString(manifest.measurement_call_id, "measurement_call_id", 64);
  const measurementCall = calls.find((call) => call.id === measurementCallId);
  if (!measurementCall || measurementCall.tool !== "ast_search_symbols") {
    fail("measurement_call_id must select one ast_search_symbols call.");
  }
  const normalized = {
    schema_version: WORKLOAD_SCHEMA_VERSION,
    project_alias: projectAlias,
    ...(manifest.description ? { description: manifest.description } : {}),
    measurement_call_id: measurementCallId,
    calls,
  };
  assertNoSensitiveText(JSON.stringify(normalized), "Workload manifest");
  return deepFreeze(normalized);
}

export function canonicalizeToolResult(value) {
  if (Array.isArray(value)) return value.map(canonicalizeToolResult);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !VOLATILE_PARITY_FIELDS.has(key))
      .map(([key, child]) => [key, canonicalizeToolResult(child)]),
  );
}

export function assertRepositoryStatusUnchanged(before, after) {
  if (!Buffer.isBuffer(before) || !Buffer.isBuffer(after) || !before.equals(after)) {
    fail("Repository status changed during canary execution.");
  }
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function removeTree(root) {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

export async function inspectCacheTree(root) {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) fail("Cache root must not be a symbolic link.");
  if (!rootStat.isDirectory()) fail("Cache root must be a directory.");
  const files = [];

  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const entryStat = await lstat(absolute);
      if (entryStat.isSymbolicLink()) fail(`Cache contains a symbolic link: ${relative}.`);
      if (entryStat.isDirectory()) {
        await visit(absolute, relative);
      } else if (entryStat.isFile()) {
        await access(absolute, fsConstants.R_OK);
        files.push({ file: relative, bytes: entryStat.size });
      } else {
        fail(`Cache contains a non-regular entry: ${relative}.`);
      }
    }
  }

  await visit(root, "");
  files.sort((left, right) => left.file.localeCompare(right.file));
  return {
    total_bytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  };
}

function sensitiveFinding(text, allowAbsolutePaths = false) {
  const patterns = [
    {
      name: "absolute POSIX path",
      pattern: /(?:^|[\s"'=:(])\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/m,
      pathOnly: true,
    },
    {
      name: "Windows path",
      pattern: /(?:^|[\s"'=:(])[A-Za-z]:[\\/]/m,
      pathOnly: true,
    },
    { name: "UNC path", pattern: /\\\\[^\\\s]+[\\/][^\\\s]+/m, pathOnly: true },
    {
      name: "traversal path",
      pattern: /(?:^|[\\/])\.\.(?:[\\/]|$)/m,
      pathOnly: true,
    },
    { name: "MongoDB URI", pattern: /mongodb(?:\+srv)?:\/\//i },
    { name: "Redis URI", pattern: /redis:\/\//i },
    {
      name: "credential-bearing URI",
      pattern: /(?:https?|postgres(?:ql)?|mysql|mariadb|amqp|nats|kafka):\/\/[^\s/:@]+:[^\s/@]+@/i,
    },
    {
      name: "authorization credential",
      pattern: /Authorization\s*:\s*(?:Bearer|Basic|Digest)\s+/i,
    },
    {
      name: "secret assignment",
      pattern:
        /(?:\b(?:api[_-]?key|password|secret|token)\b\s*[:=]\s*[^\s,}]+|\\?["'](?:api[_-]?key|password|secret|token)\\?["']\s*:\s*\\?["'][^"'\\]+\\?["'])/i,
    },
  ];
  return patterns.find(
    ({ pattern, pathOnly }) => (!pathOnly || !allowAbsolutePaths) && pattern.test(text),
  )?.name;
}

function assertNoSensitiveText(text, label) {
  const finding = sensitiveFinding(text);
  if (finding) fail(`${label} contains sensitive or absolute-path material (${finding}).`);
}

function assertNoCredentialText(text, label) {
  const finding = sensitiveFinding(text, true);
  if (finding) fail(`${label} contains credential material (${finding}).`);
}

function assertExactArgumentCredentials(exactArgv, label) {
  if (!Array.isArray(exactArgv)) fail(`${label} must be an argument vector.`);
  for (const argument of exactArgv) {
    if (typeof argument !== "string") fail(`${label} contains a non-string argument.`);
    assertNoCredentialText(argument, label);
  }
}

function assertHash(value, length, label) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    fail(`${label} must be a lowercase ${length}-character hash.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  const object = assertPlainObject(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
  return object;
}

function assertPassingGates(value, required, label) {
  const gates = assertExactKeys(value, required, label);
  for (const name of required) {
    if (gates[name] !== true) fail(`${label}.${name} must pass.`);
  }
  if (Object.values(gates).some((gate) => gate !== true)) {
    fail(`${label} contains a non-passing gate.`);
  }
  return gates;
}

function assertCacheEvidence(value, label) {
  const cache = assertExactKeys(value, ["files", "total_bytes"], label);
  if (!Number.isSafeInteger(cache.total_bytes) || cache.total_bytes < 0) {
    fail(`${label}.total_bytes is invalid.`);
  }
  if (!Array.isArray(cache.files)) fail(`${label}.files must be an array.`);
  let previous = "";
  let total = 0;
  for (const entry of cache.files) {
    const file = assertExactKeys(entry, ["bytes", "file"], `${label}.files entry`);
    assertProjectRelativePath(file.file, `${label}.files.file`);
    if (file.file <= previous) fail(`${label}.files must be uniquely sorted.`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      fail(`${label}.files.bytes is invalid.`);
    }
    previous = file.file;
    total += file.bytes;
  }
  if (total !== cache.total_bytes) fail(`${label}.total_bytes does not match its manifest.`);
}

function assertStatusDigestEvidence(value, label) {
  const status = assertExactKeys(value, ["bytes", "dirty", "sha256"], label);
  assertHash(status.sha256, 64, `${label}.sha256`);
  if (!Number.isSafeInteger(status.bytes) || status.bytes < 0) fail(`${label}.bytes is invalid.`);
  if (typeof status.dirty !== "boolean" || status.dirty !== status.bytes > 0) {
    fail(`${label}.dirty is inconsistent.`);
  }
}

function assertIndexCounters(value, label) {
  const observation = assertExactKeys(
    value,
    [
      "accepted_entries",
      "backend",
      "cache_hits",
      "cache_misses",
      "corruption_count",
      "fallback_count",
      "last_error",
      "last_operation",
      "loaded_entries",
      "migration_count",
      "operation",
      "policy",
      "policy_reason",
      "rebuilt_files",
      "rejected_entries",
      "removed_files",
      "reused_files",
      "state",
      "write_failure_count",
    ],
    label,
  );
  for (const field of [
    "accepted_entries",
    "loaded_entries",
    "rejected_entries",
    "cache_hits",
    "cache_misses",
    "rebuilt_files",
    "reused_files",
    "fallback_count",
    "migration_count",
    "removed_files",
    "corruption_count",
    "write_failure_count",
  ]) {
    if (!Number.isSafeInteger(observation[field]) || observation[field] < 0) {
      fail(`${label}.${field} is invalid.`);
    }
  }
  for (const [field, allowed] of [
    ["policy", new Set(["disabled", "canary", "enabled"])],
    [
      "policy_reason",
      new Set([
        "default",
        "invalid_mode",
        "enabled_not_released",
        "cache_root_missing",
        "cache_root_invalid",
      ]),
    ],
    ["backend", new Set(["memory", "sqlite"])],
    ["state", new Set(["disabled", "ready", "rebuilding", "failed"])],
    [
      "operation",
      new Set([
        "disabled",
        "hit",
        "miss",
        "rebuild",
        "fallback",
        "migration",
        "corruption",
        "read_failure",
        "write_failure",
      ]),
    ],
    [
      "last_operation",
      new Set([
        "disabled",
        "hit",
        "miss",
        "rebuild",
        "fallback",
        "migration",
        "corruption",
        "read_failure",
        "write_failure",
      ]),
    ],
  ]) {
    if (!allowed.has(observation[field])) fail(`${label}.${field} is invalid.`);
  }
  if (observation.last_error !== null && observation.last_error !== "[observed]") {
    fail(`${label}.last_error is invalid.`);
  }
  return observation;
}

function assertRunEvidence(value, label) {
  const run = assertExactKeys(value, ["calls", "iteration", "total_duration_ms"], label);
  assertInteger(run.iteration, `${label}.iteration`, 0, REQUIRED_ITERATIONS);
  if (typeof run.total_duration_ms !== "number" || run.total_duration_ms < 0) {
    fail(`${label}.total_duration_ms is invalid.`);
  }
  if (!Array.isArray(run.calls) || run.calls.length < 1 || run.calls.length > MAX_WORKLOAD_CALLS) {
    fail(`${label}.calls is invalid.`);
  }
  for (const call of run.calls) {
    const item = assertExactKeys(call, ["duration_ms", "id", "result_sha256"], `${label}.call`);
    assertString(item.id, `${label}.call.id`, 64);
    if (typeof item.duration_ms !== "number" || item.duration_ms < 0) {
      fail(`${label}.call.duration_ms is invalid.`);
    }
    assertHash(item.result_sha256, 64, `${label}.call.result_sha256`);
  }
  return run;
}

function assertRunSequence(run, expectedIteration, expectedCallIds, expectedHashes, label) {
  if (run.iteration !== expectedIteration) fail(`${label}.iteration is inconsistent.`);
  const actualCallIds = run.calls.map((call) => call.id);
  if (JSON.stringify(actualCallIds) !== JSON.stringify(expectedCallIds)) {
    fail(`${label}.calls do not match the preregistered workload sequence.`);
  }
  const hashes = Object.fromEntries(run.calls.map((call) => [call.id, call.result_sha256]));
  if (expectedHashes) {
    for (const id of expectedCallIds) {
      if (hashes[id] !== expectedHashes[id]) {
        fail(`${label}.${id} does not match compiler-authoritative parity evidence.`);
      }
    }
  }
  return hashes;
}

function assertRssEvidence(value, label) {
  assertInteger(value.peak_rss_bytes, `${label}.peak_rss_bytes`, 0, Number.MAX_SAFE_INTEGER);
  assertInteger(value.sample_count, `${label}.sample_count`, 0, Number.MAX_SAFE_INTEGER);
}

function assertRunWithRss(value, extraKeys, label) {
  const item = assertExactKeys(
    value,
    ["calls", "iteration", "peak_rss_bytes", "sample_count", "total_duration_ms", ...extraKeys],
    label,
  );
  assertRunEvidence(
    {
      calls: item.calls,
      iteration: item.iteration,
      total_duration_ms: item.total_duration_ms,
    },
    label,
  );
  assertRssEvidence(item, label);
  return item;
}

function assertQueueEvidence(value, label) {
  const queue = assertExactKeys(
    value,
    [
      "active_operations",
      "admission",
      "cancelled_operations",
      "deadline_exceeded_operations",
      "last_outcome",
      "max_execution_ms",
      "max_queue_wait_ms",
      "queue_capacity",
      "queue_timeout_operations",
      "queued_operations",
      "rejected_operations",
      "state",
    ],
    label,
  );
  for (const field of [
    "cancelled_operations",
    "deadline_exceeded_operations",
    "queue_timeout_operations",
    "rejected_operations",
  ]) {
    assertInteger(queue[field], `${label}.${field}`, 0, MAX_QUEUE_COUNTER);
  }
  for (const field of ["max_execution_ms", "max_queue_wait_ms"]) {
    assertInteger(queue[field], `${label}.${field}`, 0, MAX_QUEUE_DURATION_MS);
  }
  assertInteger(queue.queue_capacity, `${label}.queue_capacity`, 1, 256);
  assertInteger(queue.active_operations, `${label}.active_operations`, 0, 1);
  assertInteger(queue.queued_operations, `${label}.queued_operations`, 0, queue.queue_capacity);
  if (!new Set(["open", "closed"]).has(queue.admission)) {
    fail(`${label}.admission is invalid.`);
  }
  if (!new Set(["idle", "queued", "running"]).has(queue.state)) {
    fail(`${label}.state is invalid.`);
  }
  if (
    !new Set([
      "none",
      "succeeded",
      "failed",
      "rejected",
      "cancelled",
      "queue_timeout",
      "deadline_exceeded",
      "internal_error",
    ]).has(queue.last_outcome)
  ) {
    fail(`${label}.last_outcome is invalid.`);
  }
  const expectedState =
    queue.active_operations > 0 ? "running" : queue.queued_operations > 0 ? "queued" : "idle";
  if (queue.state !== expectedState) {
    fail(`${label}.state does not match its active and queued operation counts.`);
  }
  return queue;
}

function validateFreezeReport(report, destination, rawSha256) {
  const value = assertExactKeys(
    report,
    [
      "command",
      "deterministic_fixture",
      "gates",
      "generated_at",
      "identity",
      "overall_pass",
      "parameters",
      "real_repository",
      "schema_version",
      "status",
    ],
    "Canary report",
  );
  if (value.schema_version !== REPORT_SCHEMA_VERSION) fail("Unsupported canary report schema.");
  if (value.status !== "pass" || value.overall_pass !== true) {
    fail("freeze-report-set requires every member to be an overall PASS report.");
  }
  if (
    typeof value.generated_at !== "string" ||
    new Date(value.generated_at).toISOString() !== value.generated_at
  ) {
    fail("Canary report generated_at is invalid.");
  }
  assertHash(rawSha256, 64, "Raw report SHA-256");
  const identity = assertExactKeys(
    value.identity,
    ["harness", "os", "package", "project", "runtime", "workload"],
    "Canary report identity",
  );
  const packageIdentity = assertExactKeys(
    identity.package,
    ["commit", "head_tree", "name", "status", "tree", "version"],
    "Canary package identity",
  );
  if (
    packageIdentity.name !== packageMetadata.name ||
    packageIdentity.version !== packageMetadata.version
  ) {
    fail("Canary package identity does not match this package.");
  }
  assertHash(packageIdentity.commit, 40, "Canary package commit");
  assertHash(packageIdentity.head_tree, 40, "Canary package head_tree");
  assertHash(packageIdentity.tree, 40, "Canary package tree");
  assertStatusDigestEvidence(packageIdentity.status, "Canary package status");
  if (packageIdentity.status.dirty || packageIdentity.tree !== packageIdentity.head_tree) {
    fail("Checked canary evidence must come from a clean committed package tree.");
  }
  const runtime = assertExactKeys(
    identity.runtime,
    ["binary_sha256", "expected", "observed"],
    "Canary runtime identity",
  );
  assertExpectedNodeVersion(runtime.expected, runtime.observed);
  assertHash(runtime.binary_sha256, 64, "Canary runtime binary_sha256");
  const operatingSystem = assertExactKeys(
    identity.os,
    ["arch", "platform", "release"],
    "Canary operating-system identity",
  );
  if (
    operatingSystem.platform !== "linux" ||
    typeof operatingSystem.release !== "string" ||
    operatingSystem.release.length === 0 ||
    typeof operatingSystem.arch !== "string" ||
    operatingSystem.arch.length === 0
  ) {
    fail("Canary operating-system identity is invalid.");
  }
  const project = assertExactKeys(
    identity.project,
    ["alias", "commit", "head_tree", "status", "tree"],
    "Canary project identity",
  );
  if (typeof project.alias !== "string" || !/^\[[a-z0-9-]+\]$/.test(project.alias)) {
    fail("Canary project alias is invalid.");
  }
  assertHash(project.commit, 40, "Canary project commit");
  assertHash(project.head_tree, 40, "Canary project head_tree");
  assertHash(project.tree, 40, "Canary project tree");
  assertStatusDigestEvidence(project.status, "Canary project status");
  if (project.status.dirty || project.tree !== project.head_tree) {
    fail("Checked canary evidence must come from a clean committed project tree.");
  }
  if (project.alias !== destination.alias || runtime.expected !== destination.runtime) {
    fail("Canary identity does not match its checked-report destination.");
  }
  const workload = assertExactKeys(
    identity.workload,
    [
      "call_count",
      "call_ids",
      "measurement_call_id",
      "schema_version",
      "sha256",
      "source_file_count",
    ],
    "Canary workload identity",
  );
  assertHash(workload.sha256, 64, "Canary workload sha256");
  if (
    workload.schema_version !== WORKLOAD_SCHEMA_VERSION ||
    !Number.isSafeInteger(workload.source_file_count) ||
    workload.source_file_count < 1 ||
    !Number.isSafeInteger(workload.call_count) ||
    workload.call_count < 4 ||
    !Array.isArray(workload.call_ids) ||
    workload.call_ids.length !== workload.call_count ||
    workload.call_ids.some((id) => typeof id !== "string" || id.length === 0 || id.length > 64) ||
    new Set(workload.call_ids).size !== workload.call_ids.length ||
    typeof workload.measurement_call_id !== "string" ||
    !workload.call_ids.includes(workload.measurement_call_id)
  ) {
    fail("Canary workload identity is incomplete.");
  }
  const harness = assertExactKeys(identity.harness, ["sha256"], "Canary harness identity");
  assertHash(harness.sha256, 64, "Canary harness SHA-256");
  const parameters = assertExactKeys(
    value.parameters,
    ["iterations", "node_options", "real_repository_measurements_are_observational", "restarts"],
    "Canary parameters",
  );
  if (parameters.iterations !== REQUIRED_ITERATIONS || parameters.restarts !== REQUIRED_RESTARTS) {
    fail("Canary parameters do not match the preregistered contract.");
  }
  if (
    !Array.isArray(parameters.node_options) ||
    parameters.real_repository_measurements_are_observational !== true
  ) {
    fail("Canary execution parameters are incomplete.");
  }

  const realRepository = assertExactKeys(
    value.real_repository,
    ["canary", "disabled", "rollback", "semantic_mismatches", "source_file_count"],
    "Canary real_repository",
  );
  if (realRepository.source_file_count !== workload.source_file_count) {
    fail("Canary source-file count does not match workload identity.");
  }
  const disabled = assertExactKeys(
    realRepository.disabled,
    [
      "cache_created",
      "index_observability",
      "operation_queue",
      "peak_rss_bytes",
      "policy_variable",
      "run",
      "sample_count",
    ],
    "Canary disabled evidence",
  );
  const canary = assertExactKeys(
    realRepository.canary,
    [
      "cold",
      "final_cache",
      "final_index_observability",
      "first_complete_cache",
      "initial_index_observability",
      "operation_queue",
      "restarts",
      "warm",
    ],
    "Canary enabled evidence",
  );
  const rollback = assertExactKeys(
    realRepository.rollback,
    ["cache_unchanged", "index_observability", "peak_rss_bytes", "run", "sample_count"],
    "Canary rollback evidence",
  );
  if (
    disabled.cache_created !== false ||
    disabled.policy_variable !== "absent" ||
    rollback.cache_unchanged !== true
  ) {
    fail("Canary disabled/rollback cache evidence is invalid.");
  }
  if (!Array.isArray(canary.warm) || canary.warm.length !== REQUIRED_ITERATIONS) {
    fail("Canary warm latency evidence is incomplete.");
  }
  if (!Array.isArray(canary.restarts) || canary.restarts.length !== REQUIRED_RESTARTS) {
    fail("Canary restart evidence is incomplete.");
  }
  if (
    !Array.isArray(realRepository.semantic_mismatches) ||
    realRepository.semantic_mismatches.length !== 0
  ) {
    fail("Canary semantic parity evidence is not clean.");
  }
  const disabledRun = assertRunEvidence(disabled.run, "Canary disabled run");
  assertRssEvidence(disabled, "Canary disabled process");
  const baselineHashes = assertRunSequence(
    disabledRun,
    0,
    workload.call_ids,
    undefined,
    "Canary disabled run",
  );
  const coldRun = assertRunWithRss(canary.cold, [], "Canary cold run");
  assertRunSequence(coldRun, 0, workload.call_ids, baselineHashes, "Canary cold run");
  for (const [index, warm] of canary.warm.entries()) {
    const run = assertRunEvidence(warm, `Canary warm run ${index}`);
    assertRunSequence(
      run,
      index + 1,
      [workload.measurement_call_id],
      baselineHashes,
      `Canary warm run ${index}`,
    );
  }
  for (const [index, restart] of canary.restarts.entries()) {
    const item = assertRunWithRss(
      restart,
      ["index_observability", "restart"],
      `Canary restart ${index}`,
    );
    if (item.restart !== index + 1) fail(`Canary restart ${index}.restart is inconsistent.`);
    assertRunSequence(
      item,
      index + 1,
      workload.call_ids,
      baselineHashes,
      `Canary restart ${index}`,
    );
    assertIndexCounters(item.index_observability, `Canary restart ${index} counters`);
  }
  const rollbackRun = assertRunEvidence(rollback.run, "Canary rollback run");
  assertRunSequence(rollbackRun, 0, workload.call_ids, baselineHashes, "Canary rollback run");
  assertRssEvidence(rollback, "Canary rollback process");
  assertCacheEvidence(canary.first_complete_cache, "Canary first cache");
  assertCacheEvidence(canary.final_cache, "Canary final cache");
  assertIndexCounters(disabled.index_observability, "Canary disabled counters");
  assertIndexCounters(canary.initial_index_observability, "Canary initial enabled counters");
  assertIndexCounters(canary.final_index_observability, "Canary enabled counters");
  assertIndexCounters(rollback.index_observability, "Canary rollback counters");
  assertQueueEvidence(disabled.operation_queue, "Canary disabled queue");
  assertQueueEvidence(canary.operation_queue, "Canary enabled queue");
  if (
    disabled.index_observability.policy !== "disabled" ||
    disabled.index_observability.policy_reason !== "default" ||
    disabled.index_observability.backend !== "memory" ||
    disabled.index_observability.operation !== "disabled" ||
    disabled.index_observability.last_operation !== "disabled" ||
    !hasHealthyPersistentIndex(canary.initial_index_observability, false) ||
    !hasHealthyPersistentIndex(canary.final_index_observability, true) ||
    !canary.restarts.every((restart) =>
      hasHealthyPersistentIndex(restart.index_observability, true),
    ) ||
    rollback.index_observability.policy !== "disabled" ||
    rollback.index_observability.backend !== "memory" ||
    rollback.index_observability.operation !== "disabled" ||
    rollback.index_observability.last_operation !== "disabled"
  ) {
    fail("Canary compiler/index/rollback evidence is inconsistent with PASS.");
  }

  const fixture = assertExactKeys(
    value.deterministic_fixture,
    ["gates", "mutation", "persistence", "resources", "runtime"],
    "Canary deterministic_fixture",
  );
  const persistence = assertExactKeys(
    fixture.persistence,
    [
      "cache",
      "changed_file",
      "config_invalidation",
      "corruption_compiler_baseline_sha256",
      "corruption_fallback",
      "corruption_recovery",
      "corruption_result_sha256",
      "gates",
      "initial",
      "rollback",
      "write_failure_fallback",
      "write_failure_compiler_baseline_sha256",
      "write_failure_recovery",
      "write_failure_result_sha256",
    ],
    "Canary persistence fixture",
  );
  const mutation = assertExactKeys(
    fixture.mutation,
    ["failure_outcome", "gates", "originals_restored"],
    "Canary mutation fixture",
  );
  const scheduler = assertExactKeys(
    fixture.runtime,
    ["cache_created", "gates", "operation_queue", "outcomes"],
    "Canary runtime fixture",
  );
  const resources = assertExactKeys(
    fixture.resources,
    [
      "cache_allowed_growth_bytes",
      "final_index_observability",
      "final_restart_cache",
      "first_complete_cache",
      "gates",
      "initial_index_observability",
      "latency_samples_ms",
      "manual_gc_count",
      "measured_count",
      "restarts",
      "rss_allowed_growth_bytes",
      "rss_final_five_median_bytes",
      "rss_first_five_median_bytes",
      "rss_samples_bytes",
      "warmup_count",
    ],
    "Canary resource fixture",
  );
  const persistenceGates = assertPassingGates(
    persistence.gates,
    [
      "initial_canary_ready",
      "changed_only_rebuild",
      "config_invalidation",
      "corruption_fallback_counted",
      "corruption_recovered_in_session",
      "corruption_compiler_result",
      "corruption_recovered",
      "write_failure_fallback_counted",
      "write_failure_compiler_result",
      "write_failure_recovered",
      "disabled_rollback",
    ],
    "Canary persistence gates",
  );
  const mutationGates = assertPassingGates(
    mutation.gates,
    ["applied", "exact_postimage", "no_cache_side_effect", "replay", "rollback_original_bytes"],
    "Canary mutation gates",
  );
  const runtimeGates = assertPassingGates(
    scheduler.gates,
    [
      "queue_saturation",
      "queued_cancellation",
      "active_cancellation",
      "public_cancellation",
      "session_capacity",
      "queue_drained",
      "disabled_no_cache",
    ],
    "Canary runtime gates",
  );
  const resourceGates = assertPassingGates(
    resources.gates,
    [
      "exact_warmup_count",
      "exact_measured_count",
      "exact_manual_gc_count",
      "rss_growth_bounded",
      "cache_growth_bounded",
      "cache_manifest_stable",
      "final_restart_ready",
    ],
    "Canary resource gates",
  );
  if (
    resources.warmup_count !== FIXTURE_WARMUPS ||
    resources.measured_count !== FIXTURE_MEASURED_READS ||
    resources.manual_gc_count !== FIXTURE_MEASURED_READS ||
    !Array.isArray(resources.latency_samples_ms) ||
    resources.latency_samples_ms.length !== FIXTURE_MEASURED_READS ||
    !Array.isArray(resources.rss_samples_bytes) ||
    resources.rss_samples_bytes.length !== FIXTURE_MEASURED_READS ||
    !Array.isArray(resources.restarts) ||
    resources.restarts.length !== REQUIRED_RESTARTS
  ) {
    fail("Canary resource measurements are incomplete.");
  }
  assertCacheEvidence(resources.first_complete_cache, "Canary resource first cache");
  assertCacheEvidence(resources.final_restart_cache, "Canary resource final cache");
  for (const [name, observation] of [
    ["initial", persistence.initial],
    ["changed_file", persistence.changed_file],
    ["config_invalidation", persistence.config_invalidation],
    ["corruption_fallback", persistence.corruption_fallback],
    ["corruption_recovery", persistence.corruption_recovery],
    ["write_failure_fallback", persistence.write_failure_fallback],
    ["write_failure_recovery", persistence.write_failure_recovery],
    ["rollback", persistence.rollback],
  ]) {
    assertIndexCounters(observation, `Canary persistence ${name} counters`);
  }
  for (const field of [
    "corruption_compiler_baseline_sha256",
    "corruption_result_sha256",
    "write_failure_compiler_baseline_sha256",
    "write_failure_result_sha256",
  ]) {
    assertHash(persistence[field], 64, `Canary persistence ${field}`);
  }
  if (
    persistence.corruption_compiler_baseline_sha256 !== persistence.corruption_result_sha256 ||
    persistence.write_failure_compiler_baseline_sha256 !==
      persistence.write_failure_result_sha256 ||
    persistence.corruption_fallback.fallback_count < 1 ||
    persistence.corruption_fallback.corruption_count < 1 ||
    persistence.corruption_recovery.backend !== "sqlite" ||
    persistence.corruption_recovery.state !== "ready" ||
    persistence.write_failure_fallback.fallback_count < 1 ||
    persistence.write_failure_fallback.write_failure_count < 1 ||
    persistence.write_failure_recovery.backend !== "sqlite" ||
    persistence.write_failure_recovery.state !== "ready"
  ) {
    fail("Canary persistence fallback/recovery counters are incomplete.");
  }
  if (
    persistence.rollback.policy !== "disabled" ||
    persistence.rollback.policy_reason !== "default" ||
    persistence.rollback.backend !== "memory" ||
    persistence.rollback.operation !== "disabled" ||
    persistence.rollback.last_operation !== "disabled"
  ) {
    fail("Canary persistence rollback evidence is inconsistent.");
  }
  assertCacheEvidence(persistence.cache, "Canary persistence cache");
  if (mutation.failure_outcome !== "INTERNAL_ERROR" || mutation.originals_restored !== true) {
    fail("Canary mutation rollback evidence is invalid.");
  }
  const outcomes = assertExactKeys(
    scheduler.outcomes,
    [
      "active_cancellation",
      "overflow",
      "public_cancellation",
      "queued_cancellation",
      "session_capacity",
    ],
    "Canary runtime outcomes",
  );
  const queue = assertQueueEvidence(scheduler.operation_queue, "Canary operation queue evidence");
  const expectedRuntimeGates = {
    queue_saturation: outcomes.overflow === "PROJECT_QUEUE_FULL",
    queued_cancellation: outcomes.queued_cancellation === "protocol_cancelled",
    active_cancellation: outcomes.active_cancellation === "protocol_cancelled",
    public_cancellation: outcomes.public_cancellation === "REQUEST_CANCELLED",
    session_capacity: outcomes.session_capacity === "PROJECT_CAPACITY_EXCEEDED",
    queue_drained:
      queue.state === "idle" &&
      queue.active_operations === 0 &&
      queue.queued_operations === 0 &&
      queue.cancelled_operations >= 2 &&
      queue.rejected_operations >= 1,
    disabled_no_cache: scheduler.cache_created === false,
  };
  if (
    Object.entries(expectedRuntimeGates).some(([gate, expected]) => runtimeGates[gate] !== expected)
  ) {
    fail("Canary runtime gates do not match their retained outcome and queue evidence.");
  }
  if (Object.values(expectedRuntimeGates).some((passed) => !passed)) {
    fail("Canary cancellation/queue counters are incomplete.");
  }
  for (const field of ["latency_samples_ms", "rss_samples_bytes"]) {
    if (resources[field].some((sample) => typeof sample !== "number" || sample < 0)) {
      fail(`Canary resource ${field} contains an invalid sample.`);
    }
  }
  const expectedFirstRssMedian = median(resources.rss_samples_bytes.slice(0, 5));
  const expectedFinalRssMedian = median(resources.rss_samples_bytes.slice(-5));
  const expectedRssAllowance = Math.max(32 * 1024 * 1024, expectedFirstRssMedian * 0.2);
  const expectedCacheAllowance = Math.max(
    1024 * 1024,
    resources.first_complete_cache.total_bytes * 0.05,
  );
  if (
    resources.rss_first_five_median_bytes !== expectedFirstRssMedian ||
    resources.rss_final_five_median_bytes !== expectedFinalRssMedian ||
    resources.rss_allowed_growth_bytes !== expectedRssAllowance ||
    resources.cache_allowed_growth_bytes !== expectedCacheAllowance ||
    expectedFinalRssMedian - expectedFirstRssMedian > expectedRssAllowance ||
    resources.final_restart_cache.total_bytes - resources.first_complete_cache.total_bytes >
      expectedCacheAllowance ||
    JSON.stringify(resources.first_complete_cache.files.map((file) => file.file)) !==
      JSON.stringify(resources.final_restart_cache.files.map((file) => file.file))
  ) {
    fail("Canary deterministic resource thresholds are inconsistent.");
  }
  assertIndexCounters(resources.initial_index_observability, "Canary resource initial counters");
  assertIndexCounters(resources.final_index_observability, "Canary resource final counters");
  for (const [index, restart] of resources.restarts.entries()) {
    const item = assertExactKeys(
      restart,
      ["duration_ms", "index_observability", "peak_rss_bytes", "restart", "sample_count"],
      `Canary resource restart ${index}`,
    );
    assertRssEvidence(item, `Canary resource restart ${index}`);
    assertIndexCounters(item.index_observability, `Canary resource restart ${index} counters`);
  }
  if (
    !hasHealthyPersistentIndex(resources.initial_index_observability, false) ||
    !hasHealthyPersistentIndex(resources.final_index_observability, true) ||
    !resources.restarts.every((restart) =>
      hasHealthyPersistentIndex(restart.index_observability, true),
    )
  ) {
    fail("Canary resource restart index evidence is incomplete.");
  }

  const requiredTopLevelGates = [
    "runtime_identity",
    "package_tree_identity",
    "repository_immutable",
    "package_repository_immutable",
    "disabled_default",
    "explicit_canary",
    "semantic_parity",
    "restart_count",
    "restart_reuse",
    "policy_rollback_memory_only",
    ...Object.keys(persistenceGates).map((name) => `persistence_${name}`),
    ...Object.keys(mutationGates).map((name) => `mutation_${name}`),
    ...Object.keys(runtimeGates).map((name) => `runtime_${name}`),
    ...Object.keys(resourceGates).map((name) => `resources_${name}`),
  ];
  assertPassingGates(value.gates, requiredTopLevelGates, "Canary report gates");
  const requiredFixtureGates = [
    ...Object.keys(persistenceGates).map((name) => `persistence_${name}`),
    ...Object.keys(mutationGates).map((name) => `mutation_${name}`),
    ...Object.keys(runtimeGates).map((name) => `runtime_${name}`),
    ...Object.keys(resourceGates).map((name) => `resources_${name}`),
  ];
  assertPassingGates(fixture.gates, requiredFixtureGates, "Canary fixture gates");
  const command = assertExactKeys(value.command, ["argv", "exact_argv"], "Canary command");
  if (
    !Array.isArray(command.argv) ||
    command.argv[0] !== "benchmark:production-readiness" ||
    command.argv.length < 15 ||
    !Array.isArray(command.exact_argv) ||
    command.exact_argv.length !== command.argv.length
  ) {
    fail("Canary command evidence is incomplete.");
  }
  for (const alias of ["[node-bin]", "[project]", "[workload]", "[output]"]) {
    if (!command.argv.includes(alias)) fail(`Canary command is missing ${alias}.`);
  }
  const pathAliases = new Set([
    "[node-bin]",
    "[project]",
    "[workload]",
    "[output]",
    "[cache-root]",
  ]);
  for (const [index, argument] of command.argv.entries()) {
    const exact = command.exact_argv[index];
    if (pathAliases.has(argument)) {
      if (typeof exact !== "string" || !path.isAbsolute(exact)) {
        fail("Canary exact command contains an invalid path argument.");
      }
    } else if (argument !== exact) {
      fail("Canary exact command does not match its checked argument template.");
    }
  }
  for (const [option, expected] of [
    ["--expected-node", runtime.expected],
    ["--iterations", String(REQUIRED_ITERATIONS)],
    ["--restarts", String(REQUIRED_RESTARTS)],
  ]) {
    const index = command.argv.indexOf(option);
    if (index < 0 || command.argv[index + 1] !== expected) {
      fail(`Canary command has invalid ${option} evidence.`);
    }
  }
  const frozen = cloneJson(value);
  delete frozen.command.exact_argv;
  frozen.command.raw_report_sha256 = rawSha256;
  const text = canonicalJson(frozen);
  if (Buffer.byteLength(text, "utf8") > MAX_REPORT_BYTES)
    fail("Canonical canary report exceeds its byte bound.");
  assertNoSensitiveText(text, "Canary checked report");
  return sortedJsonValue(frozen);
}

function canonicalizeCanaryReport(report, checkedRelativePath, rawSha256) {
  const destination = FROZEN_REPORT_DESTINATIONS[normalizeSeparators(checkedRelativePath)];
  if (!destination) fail("Checked report path is not allowlisted.");
  return validateFreezeReport(report, destination, rawSha256);
}

async function verifyLiveFreezeIdentity(report, destination, exactArgv, xScraperRoot) {
  const options = parseCanaryArguments(["run", ...exactArgv.slice(1)]);
  if (options.mode !== "run") fail("Raw report exact command is not a canary run.");
  const expectedProjectRoot =
    destination.alias === "[ast-mcp-server]" ? repositoryRoot : validateXScraperRoot(xScraperRoot);
  const expectedWorkloadPath = path.join(
    repositoryRoot,
    "benchmark",
    "canary-workloads",
    `${destination.alias.slice(1, -1)}.json`,
  );
  const [
    physicalProjectRoot,
    physicalExpectedProjectRoot,
    physicalWorkloadPath,
    physicalExpectedWorkloadPath,
  ] = await Promise.all([
    realpath(options.projectRoot),
    realpath(expectedProjectRoot),
    realpath(options.workloadPath),
    realpath(expectedWorkloadPath),
  ]);
  const physicalRepositoryRoot = await realpath(repositoryRoot);
  const sameRepository = physicalProjectRoot === physicalRepositoryRoot;
  const packageRepositoryPromise = repositoryIdentity(repositoryRoot);
  const projectRepositoryPromise = sameRepository
    ? packageRepositoryPromise
    : repositoryIdentity(options.projectRoot);
  const packageTreePromise = currentWorktreeTree(repositoryRoot);
  const projectTreePromise = sameRepository
    ? packageTreePromise
    : currentWorktreeTree(options.projectRoot);
  const packageStatusPromise = repositoryStatus(repositoryRoot);
  const projectStatusPromise = sameRepository
    ? packageStatusPromise
    : repositoryStatus(options.projectRoot);
  const [
    runtimeSelection,
    workloadSelection,
    packageRepository,
    projectRepository,
    packageTree,
    projectTree,
    packageStatus,
    projectStatus,
    harnessSha256,
  ] = await Promise.all([
    validateRuntimeBinary(options),
    loadWorkload(options.workloadPath),
    packageRepositoryPromise,
    projectRepositoryPromise,
    packageTreePromise,
    projectTreePromise,
    packageStatusPromise,
    projectStatusPromise,
    sha256File(scriptPath),
  ]);
  if (
    physicalProjectRoot !== physicalExpectedProjectRoot ||
    (destination.alias === "[x-scraper]" &&
      (physicalExpectedProjectRoot !== expectedProjectRoot || sameRepository)) ||
    physicalWorkloadPath !== physicalExpectedWorkloadPath ||
    workloadSelection.manifest.project_alias !== destination.alias
  ) {
    fail("Raw report project/workload identity does not match its checked destination.");
  }
  const identity = report?.identity;
  const runtime = identity?.runtime;
  const workload = identity?.workload;
  const packageIdentity = identity?.package;
  const projectIdentity = identity?.project;
  if (
    runtime?.observed !== runtimeSelection.evidence.observed ||
    runtime?.binary_sha256 !== runtimeSelection.evidence.binary_sha256 ||
    JSON.stringify(identity?.os) !== JSON.stringify(runtimeSelection.os) ||
    workload?.sha256 !== sha256(workloadSelection.bytes) ||
    workload?.call_count !== workloadSelection.manifest.calls.length ||
    JSON.stringify(workload?.call_ids) !==
      JSON.stringify(workloadSelection.manifest.calls.map((call) => call.id)) ||
    workload?.measurement_call_id !== workloadSelection.manifest.measurement_call_id ||
    identity?.harness?.sha256 !== harnessSha256 ||
    packageIdentity?.commit !== packageRepository.commit ||
    packageIdentity?.head_tree !== packageRepository.tree ||
    packageIdentity?.tree !== packageTree ||
    packageIdentity?.status?.sha256 !== statusDigest(packageStatus).sha256 ||
    projectIdentity?.commit !== projectRepository.commit ||
    projectIdentity?.head_tree !== projectRepository.tree ||
    projectIdentity?.tree !== projectTree ||
    projectIdentity?.status?.sha256 !== statusDigest(projectStatus).sha256 ||
    packageStatus.length !== 0 ||
    projectStatus.length !== 0
  ) {
    fail("Raw report identity does not match the live clean repositories and selected runtime.");
  }
  if (options.candidateTree && options.candidateTree !== packageTree) {
    fail("Raw report candidate tree does not match the live package tree.");
  }
  return Object.freeze({ options, physicalProjectRoot, sameRepository });
}

async function readRawCanaryReportSet(inputPaths) {
  const inputs = validateFreezeReportSetInputs(inputPaths);
  const physicalTemporaryRoot = await realpath(PHYSICAL_TMP_ROOT);
  const opened = [];
  const physicalPaths = new Set();
  const fileIdentities = new Set();
  try {
    for (const member of FROZEN_REPORT_SET_MEMBERS) {
      const inputPath = inputs[member.inputKey];
      let handle;
      try {
        handle = await open(inputPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      } catch (error) {
        if (error?.code === "ELOOP" || error?.code === "ENOENT") {
          fail(`Raw canary report ${member.option} is missing, symbolic, or non-regular.`);
        }
        throw error;
      }
      opened.push({ member, inputPath, handle });
      const [inputStat, physicalInput] = await Promise.all([
        handle.stat({ bigint: true }),
        realpath(`/proc/self/fd/${handle.fd}`),
      ]);
      if (
        !inputStat.isFile() ||
        inputStat.nlink !== 1n ||
        inputStat.size > BigInt(MAX_REPORT_BYTES) ||
        path.dirname(physicalInput) !== physicalTemporaryRoot
      ) {
        fail(
          `Raw canary report ${member.option} must be a bounded, non-aliased physical regular direct child of /tmp.`,
        );
      }
      const fileIdentity = `${String(inputStat.dev)}:${String(inputStat.ino)}`;
      if (physicalPaths.has(physicalInput) || fileIdentities.has(fileIdentity)) {
        fail("Raw canary report inputs must not be duplicated, hard-linked, or otherwise aliased.");
      }
      physicalPaths.add(physicalInput);
      fileIdentities.add(fileIdentity);
      opened.at(-1).inputStat = inputStat;
      opened.at(-1).physicalInput = physicalInput;
    }

    for (const item of opened) {
      item.rawBytes = await item.handle.readFile();
      const after = await item.handle.stat({ bigint: true });
      if (
        after.dev !== item.inputStat.dev ||
        after.ino !== item.inputStat.ino ||
        after.size !== item.inputStat.size ||
        after.mtimeNs !== item.inputStat.mtimeNs ||
        after.ctimeNs !== item.inputStat.ctimeNs ||
        item.rawBytes.length > MAX_REPORT_BYTES
      ) {
        fail(`Raw canary report ${item.member.option} changed while it was pinned and read.`);
      }
    }
    return opened.map(({ member, inputPath, physicalInput, rawBytes }) => ({
      member,
      inputPath,
      physicalInput,
      rawBytes,
    }));
  } finally {
    await Promise.all(opened.map(({ handle }) => handle.close()));
  }
}

function exactOutputPath(exactArgv, inputPath) {
  assertExactArgumentCredentials(exactArgv, "Raw report exact command");
  if (!Array.isArray(exactArgv)) fail("Raw report exact command must be an argument array.");
  const outputIndexes = exactArgv.flatMap((argument, index) =>
    argument === "--output" ? [index] : [],
  );
  if (
    outputIndexes.length !== 1 ||
    typeof exactArgv[outputIndexes[0] + 1] !== "string" ||
    path.resolve(exactArgv[outputIndexes[0] + 1]) !== inputPath
  ) {
    fail("Raw report path does not match its unique exact command evidence.");
  }
  return exactArgv;
}

async function prepareCanaryReportMember(rawInput, xScraperRoot) {
  let parsed;
  try {
    parsed = JSON.parse(rawInput.rawBytes.toString("utf8"));
  } catch {
    fail(`Raw canary report ${rawInput.member.option} is not valid JSON.`);
  }
  const exactArgv = exactOutputPath(parsed?.command?.exact_argv, rawInput.inputPath);
  const canonical = canonicalizeCanaryReport(
    parsed,
    rawInput.member.relativePath,
    sha256(rawInput.rawBytes),
  );
  const destination = FROZEN_REPORT_DESTINATIONS[rawInput.member.relativePath];
  const liveIdentity = await verifyLiveFreezeIdentity(parsed, destination, exactArgv, xScraperRoot);
  const output = canonicalJson(canonical);
  if (Buffer.byteLength(output, "utf8") > MAX_REPORT_BYTES) {
    fail(`Frozen canary report ${rawInput.member.fileName} exceeds its byte bound.`);
  }
  assertNoSensitiveText(output, `Frozen canary report ${rawInput.member.fileName}`);
  return Object.freeze({
    member: rawInput.member,
    canonical,
    output,
    verification: Object.freeze({
      report: parsed,
      destination,
      exactArgv,
      xScraperRoot,
      liveIdentity,
    }),
  });
}

function assertPreparedCanaryReportSet(preparedReports) {
  if (
    !Array.isArray(preparedReports) ||
    preparedReports.length !== FROZEN_REPORT_SET_MEMBERS.length
  ) {
    fail("The frozen canary report set must contain exactly four prepared members.");
  }
  const seenDestinations = new Set();
  const cohortIdentityByAlias = new Map();
  let sharedPackageIdentity;
  let sharedHarnessSha256;
  for (const [index, prepared] of preparedReports.entries()) {
    const expected = FROZEN_REPORT_SET_MEMBERS[index];
    const preparedRawSha256 = prepared?.canonical?.command?.raw_report_sha256;
    const revalidatedCanonical = canonicalizeCanaryReport(
      prepared?.verification?.report,
      expected.relativePath,
      preparedRawSha256,
    );
    if (canonicalJson(revalidatedCanonical) !== prepared?.output) {
      fail("Prepared canonical bytes do not match the revalidated raw report.");
    }
    if (
      prepared?.member?.inputKey !== expected.inputKey ||
      prepared.member.option !== expected.option ||
      prepared.member.relativePath !== expected.relativePath ||
      prepared.member.fileName !== expected.fileName ||
      prepared.member.alias !== expected.alias ||
      prepared.member.runtime !== expected.runtime ||
      prepared?.canonical?.identity?.project?.alias !== expected.alias ||
      prepared?.canonical?.identity?.runtime?.expected !== expected.runtime
    ) {
      fail(
        "Prepared canary report members do not form the preregistered identity/destination set.",
      );
    }
    if (seenDestinations.has(expected.relativePath)) {
      fail("Prepared canary report destinations must be unique.");
    }
    seenDestinations.add(expected.relativePath);
    const cohortIdentity = canonicalJson({
      project: prepared.canonical.identity.project,
      workload: prepared.canonical.identity.workload,
    });
    const existingCohortIdentity = cohortIdentityByAlias.get(expected.alias);
    if (existingCohortIdentity === undefined) {
      cohortIdentityByAlias.set(expected.alias, cohortIdentity);
    } else if (existingCohortIdentity !== cohortIdentity) {
      fail(
        "Both runtime reports for each project alias must share one project/workload cohort identity.",
      );
    }
    const packageIdentity = canonicalJson(prepared.canonical.identity.package);
    const harnessSha256 = prepared.canonical.identity.harness?.sha256;
    assertHash(harnessSha256, 64, "Prepared canary harness SHA-256");
    if (sharedPackageIdentity === undefined) {
      sharedPackageIdentity = packageIdentity;
      sharedHarnessSha256 = harnessSha256;
    } else if (packageIdentity !== sharedPackageIdentity || harnessSha256 !== sharedHarnessSha256) {
      fail("All four canary reports must share one clean package identity and harness hash.");
    }
    if (
      typeof prepared.output !== "string" ||
      Buffer.byteLength(prepared.output, "utf8") > MAX_REPORT_BYTES ||
      prepared.output !== canonicalJson(prepared.canonical)
    ) {
      fail("A prepared canary report has invalid or mismatched canonical output bytes.");
    }
    assertNoSensitiveText(prepared.output, `Prepared canary report ${expected.fileName}`);
  }
  return {
    packageIdentity: preparedReports[0].canonical.identity.package,
    harnessSha256: sharedHarnessSha256,
  };
}

async function assertCleanLivePackageIdentity(expectedPackageIdentity, expectedHarnessSha256) {
  const [repository, status, tree, harnessSha256] = await Promise.all([
    repositoryIdentity(repositoryRoot),
    repositoryStatus(repositoryRoot),
    currentWorktreeTree(repositoryRoot),
    sha256File(scriptPath),
  ]);
  const digest = statusDigest(status);
  if (
    repository.commit !== expectedPackageIdentity.commit ||
    repository.tree !== expectedPackageIdentity.head_tree ||
    tree !== expectedPackageIdentity.tree ||
    tree !== repository.tree ||
    status.length !== 0 ||
    digest.sha256 !== expectedPackageIdentity.status.sha256 ||
    digest.bytes !== expectedPackageIdentity.status.bytes ||
    digest.dirty !== expectedPackageIdentity.status.dirty ||
    harnessSha256 !== expectedHarnessSha256
  ) {
    fail("The live package identity changed before the four-report publication transaction.");
  }
}

function exactOwnedStagingStatus(status, stageDirectory, fileNames) {
  const stageRelative = normalizeSeparators(path.relative(repositoryRoot, stageDirectory));
  const expected = fileNames.map((fileName) => `?? ${stageRelative}/${fileName}`).sort();
  const observed = status
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry.length > 0)
    .sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    fail("The live package status contains changes beyond the process-owned report staging set.");
  }
}

async function assertLivePackageIdentityBeforeVisibility(
  expectedPackageIdentity,
  expectedHarnessSha256,
  stageDirectory,
  fileNames,
) {
  const [repository, status, harnessSha256] = await Promise.all([
    repositoryIdentity(repositoryRoot),
    repositoryStatus(repositoryRoot),
    sha256File(scriptPath),
  ]);
  exactOwnedStagingStatus(status, stageDirectory, fileNames);
  if (
    repository.commit !== expectedPackageIdentity.commit ||
    repository.tree !== expectedPackageIdentity.head_tree ||
    expectedPackageIdentity.tree !== expectedPackageIdentity.head_tree ||
    expectedPackageIdentity.status.dirty !== false ||
    harnessSha256 !== expectedHarnessSha256
  ) {
    fail("The live package identity changed immediately before report-set publication.");
  }
}

async function publishPreparedCanaryReportSet(
  preparedReports,
  { anchorRoot, resultsDirectory, beforeVisibility },
) {
  assertPreparedCanaryReportSet(preparedReports);
  await publishAtomicDirectorySet({
    anchorRoot,
    resultsDirectory,
    finalDirectoryName: FROZEN_REPORT_DIRECTORY_NAME,
    files: preparedReports.map(({ member, output }) => ({ name: member.fileName, bytes: output })),
    beforeVisibility,
  });
}

async function revalidatePreparedCanaryReportSet(preparedReports) {
  for (const prepared of preparedReports) {
    const verification = prepared?.verification;
    if (!verification) fail("A prepared canary report is missing its live verification authority.");
    await verifyLiveFreezeIdentity(
      verification.report,
      verification.destination,
      verification.exactArgv,
      verification.xScraperRoot,
    );
  }
}

async function assertLiveExternalProjectsAndRuntimes(preparedReports) {
  const externalProjects = new Map();
  for (const prepared of preparedReports) {
    const verification = prepared?.verification;
    if (!verification) fail("A prepared canary report is missing its live verification authority.");
    const runtimeSelection = await validateRuntimeBinary(verification.liveIdentity.options);
    if (
      prepared.canonical.identity.runtime.observed !== runtimeSelection.evidence.observed ||
      prepared.canonical.identity.runtime.binary_sha256 !==
        runtimeSelection.evidence.binary_sha256 ||
      canonicalJson(prepared.canonical.identity.os) !== canonicalJson(runtimeSelection.os)
    ) {
      fail("A canary runtime identity changed before report-set publication.");
    }
    if (verification.liveIdentity.sameRepository) continue;
    const physicalProjectRoot = await realpath(verification.liveIdentity.options.projectRoot);
    if (physicalProjectRoot !== verification.liveIdentity.physicalProjectRoot) {
      fail("A canary project root changed before report-set publication.");
    }
    const expectedProjectIdentity = canonicalJson(prepared.canonical.identity.project);
    const existing = externalProjects.get(physicalProjectRoot);
    if (existing && existing !== expectedProjectIdentity) {
      fail("Runtime reports bound one external project root to different cohort identities.");
    }
    externalProjects.set(physicalProjectRoot, expectedProjectIdentity);
  }

  for (const [projectRoot, expectedText] of externalProjects) {
    const expected = JSON.parse(expectedText);
    const [repository, tree, status] = await Promise.all([
      repositoryIdentity(projectRoot),
      currentWorktreeTree(projectRoot),
      repositoryStatus(projectRoot),
    ]);
    const digest = statusDigest(status);
    if (
      repository.commit !== expected.commit ||
      repository.tree !== expected.head_tree ||
      tree !== expected.tree ||
      status.length !== 0 ||
      digest.sha256 !== expected.status.sha256 ||
      digest.bytes !== expected.status.bytes ||
      digest.dirty !== expected.status.dirty
    ) {
      fail("A canary project identity changed before report-set publication.");
    }
  }
}

async function orchestrateCanaryReportSet(
  inputPaths,
  prepareMember,
  publishSet,
  revalidateSet = async () => undefined,
) {
  const inputs = validateFreezeReportSetInputs(inputPaths);
  const preparedReports = [];
  for (const member of FROZEN_REPORT_SET_MEMBERS) {
    preparedReports.push(await prepareMember(member, inputs[member.inputKey]));
  }
  const sharedIdentity = assertPreparedCanaryReportSet(preparedReports);
  const result = deepFreeze(
    Object.fromEntries(
      preparedReports.map(({ member, canonical }) => [member.inputKey, cloneJson(canonical)]),
    ),
  );
  await revalidateSet(preparedReports, sharedIdentity);
  await publishSet(preparedReports, sharedIdentity);
  return result;
}

export async function freezeCanaryReportSet(inputPaths, xScraperRoot) {
  const expectedXScraperRoot = validateXScraperRoot(xScraperRoot);
  const rawInputs = await readRawCanaryReportSet(inputPaths);
  const rawInputsByKey = new Map(rawInputs.map((input) => [input.member.inputKey, input]));
  return orchestrateCanaryReportSet(
    inputPaths,
    async (member) =>
      prepareCanaryReportMember(rawInputsByKey.get(member.inputKey), expectedXScraperRoot),
    async (preparedReports, sharedIdentity) => {
      await assertCleanLivePackageIdentity(
        sharedIdentity.packageIdentity,
        sharedIdentity.harnessSha256,
      );
      await publishPreparedCanaryReportSet(preparedReports, {
        anchorRoot: repositoryRoot,
        resultsDirectory: path.join(repositoryRoot, FROZEN_REPORT_RESULTS_DIRECTORY),
        beforeVisibility: ({ stageDirectory, fileNames }) =>
          Promise.all([
            assertLivePackageIdentityBeforeVisibility(
              sharedIdentity.packageIdentity,
              sharedIdentity.harnessSha256,
              stageDirectory,
              fileNames,
            ),
            assertLiveExternalProjectsAndRuntimes(preparedReports),
          ]),
      });
    },
    revalidatePreparedCanaryReportSet,
  );
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function safeProcessDiagnostic(buffer) {
  const text = buffer
    .toString("utf8")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, "[path]")
    .trim()
    .slice(0, 512);
  if (!text || sensitiveFinding(text, true)) return "";
  return ` diagnostic=${JSON.stringify(text)}`;
}

async function spawnCapture(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) =>
      resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }),
    );
  });
  const failedToSpawn = new Promise((_resolve, reject) => child.once("error", reject));
  let result;
  try {
    result = await withTimeout(
      Promise.race([closed, failedToSpawn]),
      options.timeoutMs ?? 30_000,
      `Timed out executing ${path.basename(command)}.`,
    );
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await withTimeout(
      closed,
      PROCESS_EXIT_TIMEOUT_MS,
      `Timed out reaping ${path.basename(command)}.`,
    ).catch(() => undefined);
    throw error;
  }
  if (result.code !== 0 || result.signal !== null) {
    const operation =
      args[0] === "-C" && typeof args[2] === "string"
        ? args[2]
        : typeof args[0] === "string"
          ? args[0]
          : "process";
    const diagnostic = safeProcessDiagnostic(result.stderr);
    fail(
      `${path.basename(command)} ${operation} exited unsuccessfully (code=${String(result.code)}, signal=${String(result.signal)}).${diagnostic}`,
    );
  }
  return result;
}

async function gitOutput(root, args, binary = false, environment = undefined) {
  const result = await spawnCapture("git", ["-C", root, ...args], {
    env: environment,
    timeoutMs: 30_000,
  });
  return binary ? result.stdout : result.stdout.toString("utf8").trim();
}

async function repositoryStatus(root) {
  return gitOutput(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], true);
}

async function repositoryIdentity(root) {
  const [commit, tree] = await Promise.all([
    gitOutput(root, ["rev-parse", "HEAD"]),
    gitOutput(root, ["rev-parse", "HEAD^{tree}"]),
  ]);
  return { commit, tree };
}

async function currentWorktreeTreeAttempt(root) {
  const temporaryRoot = await mkdtemp(path.join(PHYSICAL_TMP_ROOT, "ast-canary-git-index-"));
  try {
    const cloneRoot = path.join(temporaryRoot, "clone");
    const gitDirectory = path.join(cloneRoot, ".git");
    const indexPath = path.join(temporaryRoot, "index");
    const [commonDirectory, headTree] = await Promise.all([
      gitOutput(root, ["rev-parse", "--git-common-dir"]),
      gitOutput(root, ["rev-parse", "HEAD^{tree}"]),
    ]);
    const physicalCommonDirectory = path.resolve(root, commonDirectory);
    await spawnCapture(
      "git",
      ["clone", "--shared", "--no-checkout", "--quiet", "--", root, cloneRoot],
      { timeoutMs: 30_000 },
    );
    const sourceExcludePath = path.join(physicalCommonDirectory, "info", "exclude");
    const sourceExcludes = (await pathExists(sourceExcludePath))
      ? await readFile(sourceExcludePath, "utf8")
      : "";
    await writeFile(
      path.join(gitDirectory, "info", "exclude"),
      `${sourceExcludes}\n.git\n`,
      "utf8",
    );
    const environment = {
      ...process.env,
      GIT_DIR: gitDirectory,
      GIT_WORK_TREE: root,
      GIT_INDEX_FILE: indexPath,
      GIT_OPTIONAL_LOCKS: "0",
    };
    await gitOutput(root, ["read-tree", "HEAD"], false, environment);
    await gitOutput(root, ["add", "-A", "--", ":/"], false, environment);
    const tree = await gitOutput(root, ["write-tree"], false, environment);
    if (tree === EMPTY_GIT_TREE && headTree !== EMPTY_GIT_TREE) {
      fail("Temporary Git index unexpectedly produced an empty candidate tree.");
    }
    return tree;
  } finally {
    await removeTree(temporaryRoot);
  }
}

async function currentWorktreeTree(root) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await currentWorktreeTreeAttempt(root);
    } catch (error) {
      lastError = error;
      if (attempt < 3) emitProgress(`git_tree_retry_${attempt}`);
    }
  }
  throw lastError;
}

function statusDigest(status) {
  return {
    sha256: sha256(status),
    bytes: status.length,
    dirty: status.length > 0,
  };
}

function childEnvironment(overrides = {}) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? os.homedir(),
    TMPDIR: PHYSICAL_TMP_ROOT,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    ...overrides,
  };
}

class LinuxRssMonitor {
  constructor(pid) {
    this.pid = pid;
    this.peakBytes = 0;
    this.samples = [];
    this.reading = false;
    this.closed = false;
    this.failure = undefined;
    this.timer = setInterval(() => void this.sample(), 25);
  }

  async sample() {
    if (this.reading || this.closed) return;
    this.reading = true;
    try {
      const status = await readFile(`/proc/${this.pid}/status`, "utf8");
      const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
      if (match) {
        const bytes = Number(match[1]) * 1024;
        this.peakBytes = Math.max(this.peakBytes, bytes);
        this.samples.push(bytes);
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ESRCH") {
        this.failure = error;
        this.closed = true;
        clearInterval(this.timer);
      }
    } finally {
      this.reading = false;
    }
  }

  async stop() {
    this.closed = true;
    clearInterval(this.timer);
    while (this.reading) await new Promise((resolve) => setTimeout(resolve, 0));
    if (this.failure) fail("Canary RSS monitor failed.");
    return { peak_rss_bytes: this.peakBytes, sample_count: this.samples.length };
  }
}

class CanaryMcpProcess {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.protocolCorruption = 0;
    this.stderrEvents = [];
    this.stderrWaiters = [];
    this.closed = false;
    this.monitor = new LinuxRssMonitor(child.pid);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk) => this.consumeStderr(chunk));
    this.exit = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        this.closed = true;
        const error = new Error("Canary MCP child closed before completing a pending request.");
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
        resolve({ code, signal });
      });
    });
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length > 0) this.handleProtocolLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  handleProtocolLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.protocolCorruption += 1;
      return;
    }
    const message = JSONRPCMessageSchema.safeParse(parsed);
    if (!message.success) {
      this.protocolCorruption += 1;
      return;
    }
    if ("method" in message.data) return;
    const pending = this.pending.get(message.data.id);
    if (!pending) {
      this.protocolCorruption += 1;
      return;
    }
    this.pending.delete(message.data.id);
    clearTimeout(pending.timer);
    if ("error" in message.data) {
      pending.reject(
        new Error(`JSON-RPC ${message.data.error.code}: ${message.data.error.message}`),
      );
    } else {
      pending.resolve(message.data.result);
    }
  }

  consumeStderr(chunk) {
    this.stderrBuffer += chunk;
    let newline = this.stderrBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stderrBuffer.slice(0, newline);
      this.stderrBuffer = this.stderrBuffer.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        if (typeof event?.event === "string") {
          this.stderrEvents.push(event);
          const waiters = this.stderrWaiters;
          this.stderrWaiters = [];
          for (const waiter of waiters) waiter();
        }
      } catch {
        // Runtime diagnostics are permitted on stderr. Reports never retain raw stderr.
      }
      newline = this.stderrBuffer.indexOf("\n");
    }
  }

  beginRequest(method, params) {
    if (this.closed) fail("Canary MCP child is already closed.");
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for MCP method ${method}.`));
      }, MCP_REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
    void promise.catch(() => undefined);
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return { id, promise };
  }

  request(method, params) {
    return this.beginRequest(method, params).promise;
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "ast-production-readiness-canary", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
  }

  beginToolCall(name, args) {
    return this.beginRequest("tools/call", { name, arguments: args });
  }

  callTool(name, args) {
    return this.beginToolCall(name, args).promise;
  }

  cancel(requestId, reason = "canary cancellation gate") {
    const pending = this.pending.get(requestId);
    if (!pending) fail("Cannot cancel an unknown canary request.");
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    this.notify("notifications/cancelled", { requestId, reason });
    pending.resolve({ canary_protocol_cancelled: true });
  }

  async waitForEvent(eventName) {
    const existing = this.stderrEvents.find((event) => event.event === eventName);
    if (existing) return existing;
    let inspect;
    try {
      return await withTimeout(
        new Promise((resolve) => {
          inspect = () => {
            const event = this.stderrEvents.find((candidate) => candidate.event === eventName);
            if (event) resolve(event);
            else this.stderrWaiters.push(inspect);
          };
          this.stderrWaiters.push(inspect);
        }),
        30_000,
        `Timed out waiting for fixture event ${eventName}.`,
      );
    } finally {
      this.stderrWaiters = this.stderrWaiters.filter((waiter) => waiter !== inspect);
    }
  }

  async closeGracefully() {
    if (!this.closed) this.child.stdin.end();
    const exit = await withTimeout(
      this.exit,
      PROCESS_EXIT_TIMEOUT_MS,
      "Canary MCP child did not exit after stdin closure.",
    );
    let rss;
    try {
      rss = await this.monitor.stop();
    } finally {
      activeMcpProcesses.delete(this);
    }
    if (exit.code !== 0 || exit.signal !== null) fail("Canary MCP child did not exit cleanly.");
    if (this.protocolCorruption !== 0 || this.stdoutBuffer !== "") {
      fail("Canary MCP child emitted non-protocol stdout.");
    }
    return rss;
  }

  async terminate() {
    if (!this.closed) {
      this.child.kill("SIGKILL");
      await this.exit;
    }
    try {
      return await this.monitor.stop();
    } finally {
      activeMcpProcesses.delete(this);
    }
  }
}

async function terminateActiveMcpProcesses() {
  await Promise.allSettled([...activeMcpProcesses].map((client) => client.terminate()));
}

async function spawnMcp(options) {
  const args = [...options.nodeOptions];
  if (options.fixtureServer) args.push("--expose-gc", scriptPath, FIXTURE_SERVER_MODE);
  else args.push(serverPath);
  const child = spawn(options.nodeBin, args, {
    cwd: repositoryRoot,
    env: childEnvironment(options.environment),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = new CanaryMcpProcess(child);
  activeMcpProcesses.add(client);
  try {
    if (options.fixtureServer) await client.waitForEvent("canary_fixture_ready");
    await client.initialize();
    return client;
  } catch (error) {
    await client.terminate();
    throw error;
  }
}

function toolError(result) {
  if (result?.isError !== true || !Array.isArray(result.content) || result.content.length !== 1) {
    return undefined;
  }
  try {
    return JSON.parse(result.content[0].text).error;
  } catch {
    return undefined;
  }
}

function structuredToolResult(result, toolName) {
  if (result?.isError === true) {
    const error = toolError(result);
    fail(`${toolName} failed with ${error?.code ?? "an invalid public error"}.`);
  }
  if (!isPlainObject(result?.structuredContent))
    fail(`${toolName} returned no structured content.`);
  return result.structuredContent;
}

function projectEnvironment(policy, cacheRoot, extra = {}) {
  return {
    ...(policy === undefined ? {} : { AST_SYMBOL_INDEX_PERSISTENCE: policy }),
    AST_SYMBOL_INDEX_CACHE_ROOT: cacheRoot,
    ...extra,
    AST_OPERATION_DEADLINE_MS: String(CANARY_OPERATION_DEADLINE_MS),
  };
}

async function runWorkload(
  client,
  projectRoot,
  workload,
  iteration,
  selectedCalls = workload.calls,
) {
  const canonical = {};
  const calls = [];
  const startedAt = performance.now();
  for (const call of selectedCalls) {
    const callStartedAt = performance.now();
    const result = structuredToolResult(
      await client.callTool(call.tool, { project_root: projectRoot, ...call.arguments }),
      call.tool,
    );
    const durationMs = roundMilliseconds(performance.now() - callStartedAt);
    const normalized = canonicalizeToolResult(result);
    canonical[call.id] = normalized;
    calls.push({
      id: call.id,
      duration_ms: durationMs,
      result_sha256: sha256(JSON.stringify(normalized)),
    });
    await client.monitor.sample();
  }
  return {
    iteration,
    total_duration_ms: roundMilliseconds(performance.now() - startedAt),
    calls,
    canonical,
  };
}

async function sourceFileCount(client, projectRoot) {
  const result = assertPlainObject(
    structuredToolResult(
      await client.callTool("ast_list_files", { project_root: projectRoot, offset: 0, limit: 1 }),
      "ast_list_files",
    ),
    "Complete source-file inventory result",
  );
  return assertInteger(result.total, "Canonical source-file count", 1, 10_000_000);
}

function parityMismatches(baseline, candidate, phase) {
  const mismatches = [];
  for (const [id, expected] of Object.entries(baseline)) {
    if (JSON.stringify(expected) !== JSON.stringify(candidate[id]))
      mismatches.push({ phase, call_id: id });
  }
  return mismatches;
}

function indexObservability(status) {
  const source = assertPlainObject(status.index_observability, "index_observability");
  const fields = [
    "policy",
    "policy_reason",
    "backend",
    "state",
    "operation",
    "last_operation",
    "loaded_entries",
    "accepted_entries",
    "rejected_entries",
    "cache_hits",
    "cache_misses",
    "rebuilt_files",
    "reused_files",
    "removed_files",
    "fallback_count",
    "migration_count",
    "corruption_count",
    "write_failure_count",
    "last_error",
  ];
  return Object.fromEntries(
    fields.map((field) => [
      field,
      field === "last_error"
        ? source[field] === null || source[field] === undefined
          ? null
          : "[observed]"
        : (source[field] ?? null),
    ]),
  );
}

function hasHealthyPersistentIndex(observation, requireLoaded) {
  return (
    observation.policy === "canary" &&
    observation.policy_reason === "default" &&
    observation.backend === "sqlite" &&
    observation.state === "ready" &&
    observation.accepted_entries > 0 &&
    observation.reused_files > 0 &&
    (!requireLoaded || (observation.loaded_entries > 0 && observation.cache_hits > 0)) &&
    observation.fallback_count === 0 &&
    observation.corruption_count === 0 &&
    observation.write_failure_count === 0
  );
}

function queueObservability(status) {
  const source = assertPlainObject(status.operation_queue, "operation_queue");
  return cloneJson(source);
}

async function closeClient(client) {
  try {
    return await client.closeGracefully();
  } catch (error) {
    await client.terminate().catch(() => undefined);
    throw error;
  }
}

async function executeRealRepository(options, workload, cacheRoot) {
  const disabledCacheRoot = path.join(
    path.dirname(cacheRoot),
    `${path.basename(cacheRoot)}-disabled`,
  );
  await removeTree(disabledCacheRoot);
  const mismatches = [];

  const disabledClient = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    environment: projectEnvironment(undefined, disabledCacheRoot),
  });
  const disabledRun = await runWorkload(disabledClient, options.projectRoot, workload, 0);
  const observedSourceFileCount = await sourceFileCount(disabledClient, options.projectRoot);
  const disabledStatus = structuredToolResult(
    await disabledClient.callTool("ast_get_project_status", { project_root: options.projectRoot }),
    "ast_get_project_status",
  );
  const disabledRss = await closeClient(disabledClient);
  const disabledCacheCreated = await pathExists(disabledCacheRoot);
  emitProgress("real_disabled_complete");

  const canaryClient = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    environment: projectEnvironment("canary", cacheRoot),
  });
  const coldRun = await runWorkload(canaryClient, options.projectRoot, workload, 0);
  mismatches.push(...parityMismatches(disabledRun.canonical, coldRun.canonical, "canary_cold"));
  const warmRuns = [];
  const measurementCall = workload.calls.find((call) => call.id === workload.measurement_call_id);
  const measurementBaseline = {
    [workload.measurement_call_id]: disabledRun.canonical[workload.measurement_call_id],
  };
  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const run = await runWorkload(canaryClient, options.projectRoot, workload, iteration, [
      measurementCall,
    ]);
    mismatches.push(
      ...parityMismatches(measurementBaseline, run.canonical, `canary_warm_${iteration}`),
    );
    warmRuns.push(run);
  }
  const canaryStatus = structuredToolResult(
    await canaryClient.callTool("ast_get_project_status", { project_root: options.projectRoot }),
    "ast_get_project_status",
  );
  const canaryRss = await closeClient(canaryClient);
  const firstCache = await inspectCacheTree(cacheRoot);
  emitProgress("real_canary_warm_complete");

  const restartRuns = [];
  let finalStatus = canaryStatus;
  for (let restart = 1; restart <= options.restarts; restart += 1) {
    const restartClient = await spawnMcp({
      nodeBin: options.nodeBin,
      nodeOptions: options.nodeOptions,
      environment: projectEnvironment("canary", cacheRoot),
    });
    const run = await runWorkload(restartClient, options.projectRoot, workload, restart);
    mismatches.push(
      ...parityMismatches(disabledRun.canonical, run.canonical, `restart_${restart}`),
    );
    finalStatus = structuredToolResult(
      await restartClient.callTool("ast_get_project_status", { project_root: options.projectRoot }),
      "ast_get_project_status",
    );
    const rss = await closeClient(restartClient);
    restartRuns.push({
      restart,
      ...withoutCanonical(run),
      ...rss,
      index_observability: indexObservability(finalStatus),
    });
    emitProgress(`real_restart_${restart}_complete`);
  }
  const finalCache = await inspectCacheTree(cacheRoot);

  const rollbackCacheBefore = canonicalJson(firstCache === undefined ? {} : finalCache);
  const rollbackClient = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    environment: projectEnvironment("disabled", cacheRoot),
  });
  const rollbackRun = await runWorkload(rollbackClient, options.projectRoot, workload, 0);
  mismatches.push(
    ...parityMismatches(disabledRun.canonical, rollbackRun.canonical, "disabled_rollback"),
  );
  const rollbackStatus = structuredToolResult(
    await rollbackClient.callTool("ast_get_project_status", { project_root: options.projectRoot }),
    "ast_get_project_status",
  );
  const rollbackRss = await closeClient(rollbackClient);
  const rollbackCacheAfter = canonicalJson(await inspectCacheTree(cacheRoot));
  emitProgress("real_rollback_complete");

  return {
    source_file_count: observedSourceFileCount,
    disabled: {
      run: withoutCanonical(disabledRun),
      ...disabledRss,
      policy_variable: "absent",
      cache_created: disabledCacheCreated,
      index_observability: indexObservability(disabledStatus),
      operation_queue: queueObservability(disabledStatus),
    },
    canary: {
      cold: { ...withoutCanonical(coldRun), ...canaryRss },
      warm: warmRuns.map(withoutCanonical),
      first_complete_cache: firstCache,
      final_cache: finalCache,
      restarts: restartRuns,
      initial_index_observability: indexObservability(canaryStatus),
      final_index_observability: indexObservability(finalStatus),
      operation_queue: queueObservability(finalStatus),
    },
    rollback: {
      run: withoutCanonical(rollbackRun),
      ...rollbackRss,
      index_observability: indexObservability(rollbackStatus),
      cache_unchanged: rollbackCacheBefore === rollbackCacheAfter,
    },
    semantic_mismatches: mismatches,
  };
}

function withoutCanonical(run) {
  return Object.fromEntries(Object.entries(run).filter(([key]) => key !== "canonical"));
}

async function createFixtureProject(root, name, valid = true) {
  const projectRoot = path.join(root, name);
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    valid
      ? JSON.stringify({
          compilerOptions: {
            strict: true,
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
          include: ["src/**/*.ts"],
        })
      : "{ invalid json",
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "src/value.ts"),
    "export function canaryValue(value: number): number { return value + 1; }\n",
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "src/use.ts"),
    'import { canaryValue } from "./value.js";\nexport const canaryResult = canaryValue(1);\n',
    "utf8",
  );
  return projectRoot;
}

async function fixtureStatus(options, projectRoot, cacheRoot, beforeStatus) {
  const client = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    environment: projectEnvironment("canary", cacheRoot),
  });
  let search;
  if (beforeStatus) {
    search = structuredToolResult(
      await client.callTool("ast_search_symbols", {
        project_root: projectRoot,
        query: "canaryValue",
        detail: "summary",
        offset: 0,
        limit: 20,
      }),
      "ast_search_symbols",
    );
  }
  const status = structuredToolResult(
    await client.callTool("ast_get_project_status", { project_root: projectRoot }),
    "ast_get_project_status",
  );
  await closeClient(client);
  return { status, search };
}

async function fixtureCompilerSearch(options, projectRoot, cacheRoot) {
  const client = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    environment: projectEnvironment("disabled", cacheRoot),
  });
  try {
    const result = structuredToolResult(
      await client.callTool("ast_search_symbols", {
        project_root: projectRoot,
        query: "canaryValue",
        detail: "summary",
        offset: 0,
        limit: 20,
      }),
      "ast_search_symbols",
    );
    return canonicalizeToolResult(result);
  } finally {
    await closeClient(client);
  }
}

async function newestSQLiteFile(cacheRoot) {
  const files = (await readdir(cacheRoot)).filter((file) => file.endsWith(".sqlite"));
  if (files.length === 0) fail("Fixture canary did not create a SQLite cache file.");
  const candidates = await Promise.all(
    files.map(async (file) => ({ file, mtime: (await lstat(path.join(cacheRoot, file))).mtimeMs })),
  );
  candidates.sort((left, right) => right.mtime - left.mtime || left.file.localeCompare(right.file));
  return path.join(cacheRoot, candidates[0].file);
}

async function exercisePersistenceFixture(options, fixtureRoot) {
  const projectRoot = await createFixtureProject(fixtureRoot, "persistence");
  const cacheRoot = path.join(fixtureRoot, "persistence-cache");
  const initial = await fixtureStatus(options, projectRoot, cacheRoot, false);
  const initialObservation = indexObservability(initial.status);

  await writeFile(
    path.join(projectRoot, "src/value.ts"),
    "export function canaryValue(value: number): number { return value + 2; }\n",
    "utf8",
  );
  const changed = await fixtureStatus(options, projectRoot, cacheRoot, false);
  const changedObservation = indexObservability(changed.status);

  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
      },
      include: ["src/**/*.ts"],
    }),
    "utf8",
  );
  const configChanged = await fixtureStatus(options, projectRoot, cacheRoot, false);
  const configObservation = indexObservability(configChanged.status);
  const corruptionCompilerBaseline = await fixtureCompilerSearch(
    options,
    projectRoot,
    path.join(fixtureRoot, "corruption-compiler-disabled-cache"),
  );

  const activeCache = await newestSQLiteFile(cacheRoot);
  await writeFile(activeCache, "corrupt", "utf8");
  const corrupt = await fixtureStatus(options, projectRoot, cacheRoot, true);
  const corruptObservation = indexObservability(corrupt.status);
  const corruptionCanonicalResult = canonicalizeToolResult(corrupt.search);
  const compilerFallbackFound = corruptionCanonicalResult?.symbols?.some(
    (symbol) => symbol.selector === "canaryValue@1",
  );
  const recovered = await fixtureStatus(options, projectRoot, cacheRoot, true);
  const recoveredObservation = indexObservability(recovered.status);

  const writeFailureProject = await createFixtureProject(fixtureRoot, "write-failure");
  const writeFailureCache = path.join(fixtureRoot, "write-failure-cache");
  const writeFailureClient = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    fixtureServer: true,
    environment: projectEnvironment("canary", writeFailureCache),
  });
  structuredToolResult(
    await writeFailureClient.callTool("ast_get_project_status", {
      project_root: writeFailureProject,
    }),
    "ast_get_project_status",
  );
  await writeFile(
    path.join(writeFailureProject, "src/value.ts"),
    "export function canaryValue(value: number): number { return value + 3; }\n",
    "utf8",
  );
  const writeFailureCompilerBaseline = await fixtureCompilerSearch(
    options,
    writeFailureProject,
    path.join(fixtureRoot, "write-failure-compiler-disabled-cache"),
  );
  structuredToolResult(
    await writeFailureClient.callTool("ast_canary_arm_index_write_failure", {}),
    "ast_canary_arm_index_write_failure",
  );
  const writeFailureSearch = structuredToolResult(
    await writeFailureClient.callTool("ast_search_symbols", {
      project_root: writeFailureProject,
      query: "canaryValue",
      detail: "summary",
      offset: 0,
      limit: 20,
    }),
    "ast_search_symbols",
  );
  const writeFailureStatus = structuredToolResult(
    await writeFailureClient.callTool("ast_get_project_status", {
      project_root: writeFailureProject,
    }),
    "ast_get_project_status",
  );
  await closeClient(writeFailureClient);
  const writeFailureObservation = indexObservability(writeFailureStatus);
  const writeFailureCanonicalResult = canonicalizeToolResult(writeFailureSearch);
  const writeFailureCompilerFound = writeFailureCanonicalResult.symbols?.some(
    (symbol) => symbol.selector === "canaryValue@1",
  );
  const writeFailureRecovered = await fixtureStatus(
    options,
    writeFailureProject,
    writeFailureCache,
    true,
  );
  const writeFailureRecoveryObservation = indexObservability(writeFailureRecovered.status);

  const cacheBeforeRollback = canonicalJson(await inspectCacheTree(cacheRoot));
  const rollbackClient = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    environment: projectEnvironment("disabled", cacheRoot),
  });
  const rollbackStatus = structuredToolResult(
    await rollbackClient.callTool("ast_get_project_status", { project_root: projectRoot }),
    "ast_get_project_status",
  );
  await closeClient(rollbackClient);
  const cacheAfterRollback = canonicalJson(await inspectCacheTree(cacheRoot));
  const rollbackObservation = indexObservability(rollbackStatus);

  const gates = {
    initial_canary_ready:
      initialObservation.backend === "sqlite" &&
      initialObservation.state === "ready" &&
      initial.status.indexed_count === 2,
    changed_only_rebuild:
      changedObservation.backend === "sqlite" &&
      changedObservation.rebuilt_files === 1 &&
      changedObservation.reused_files >= 1,
    config_invalidation:
      configObservation.backend === "sqlite" &&
      configObservation.state === "ready" &&
      configObservation.rebuilt_files >= 2,
    corruption_fallback_counted:
      corruptObservation.fallback_count >= 1 && corruptObservation.corruption_count >= 1,
    corruption_recovered_in_session:
      corruptObservation.backend === "sqlite" && corruptObservation.state === "ready",
    corruption_compiler_result:
      compilerFallbackFound === true &&
      JSON.stringify(corruptionCanonicalResult) === JSON.stringify(corruptionCompilerBaseline),
    corruption_recovered:
      recoveredObservation.backend === "sqlite" &&
      recoveredObservation.state === "ready" &&
      recovered.status.indexed_count === 2,
    write_failure_fallback_counted:
      writeFailureObservation.fallback_count >= 1 &&
      writeFailureObservation.write_failure_count >= 1,
    write_failure_compiler_result:
      writeFailureCompilerFound === true &&
      JSON.stringify(writeFailureCanonicalResult) === JSON.stringify(writeFailureCompilerBaseline),
    write_failure_recovered:
      writeFailureRecoveryObservation.backend === "sqlite" &&
      writeFailureRecoveryObservation.state === "ready" &&
      writeFailureRecovered.status.indexed_count === 2,
    disabled_rollback:
      rollbackObservation.backend === "memory" &&
      rollbackObservation.policy === "disabled" &&
      rollbackStatus.indexed_count === 0 &&
      cacheBeforeRollback === cacheAfterRollback,
  };
  assertGatesPass(gates, "Persistence fixture");
  return {
    gates,
    initial: initialObservation,
    changed_file: changedObservation,
    config_invalidation: configObservation,
    corruption_fallback: corruptObservation,
    corruption_recovery: recoveredObservation,
    corruption_compiler_baseline_sha256: sha256(JSON.stringify(corruptionCompilerBaseline)),
    corruption_result_sha256: sha256(JSON.stringify(corruptionCanonicalResult)),
    write_failure_fallback: writeFailureObservation,
    write_failure_recovery: writeFailureRecoveryObservation,
    write_failure_compiler_baseline_sha256: sha256(JSON.stringify(writeFailureCompilerBaseline)),
    write_failure_result_sha256: sha256(JSON.stringify(writeFailureCanonicalResult)),
    rollback: rollbackObservation,
    cache: await inspectCacheTree(cacheRoot),
  };
}

async function exerciseMutationIsolation(options, fixtureRoot) {
  const projectRoot = await createFixtureProject(fixtureRoot, "mutation");
  const cacheRoot = path.join(fixtureRoot, "mutation-cache-must-not-exist");
  const sourcePath = path.join(projectRoot, "src/value.ts");
  const usePath = path.join(projectRoot, "src/use.ts");
  const originalSource = await readFile(sourcePath);
  const originalUse = await readFile(usePath);
  const client = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    fixtureServer: true,
    environment: projectEnvironment("canary", cacheRoot),
  });
  const prepared = structuredToolResult(
    await client.callTool("ast_rename_symbol", {
      project_root: projectRoot,
      file_path: "src/value.ts",
      symbol_path: "canaryValue",
      new_name: "renamedCanaryValue",
      dry_run: true,
      allow_new_errors: false,
    }),
    "ast_rename_symbol",
  );
  structuredToolResult(
    await client.callTool("ast_canary_arm_apply_failure", { before_replace_index: 1 }),
    "ast_canary_arm_apply_failure",
  );
  const failedApply = await client.callTool("ast_apply_operation", {
    operation_id: prepared.operation_id,
    plan_hash: prepared.plan_hash,
  });
  const failedApplyCode = toolError(failedApply)?.code;
  const originalsRestored =
    (await readFile(sourcePath)).equals(originalSource) &&
    (await readFile(usePath)).equals(originalUse);
  const applied = structuredToolResult(
    await client.callTool("ast_apply_operation", {
      operation_id: prepared.operation_id,
      plan_hash: prepared.plan_hash,
    }),
    "ast_apply_operation",
  );
  const replay = structuredToolResult(
    await client.callTool("ast_apply_operation", {
      operation_id: prepared.operation_id,
      plan_hash: prepared.plan_hash,
    }),
    "ast_apply_operation",
  );
  await closeClient(client);
  const source = await readFile(sourcePath, "utf8");
  const use = await readFile(usePath, "utf8");
  const gates = {
    rollback_original_bytes: failedApplyCode === "INTERNAL_ERROR" && originalsRestored,
    applied: applied.status === "applied" && applied.idempotent_replay === false,
    replay: replay.status === "applied" && replay.idempotent_replay === true,
    exact_postimage: source.includes("renamedCanaryValue") && use.includes("renamedCanaryValue"),
    no_cache_side_effect: !(await pathExists(cacheRoot)),
  };
  assertGatesPass(gates, "Mutation-isolation fixture");
  return {
    gates,
    failure_outcome: failedApplyCode,
    originals_restored: originalsRestored,
  };
}

async function pollQueueSnapshot(client, projectRoot, predicate) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 30_000) {
    const snapshot = structuredToolResult(
      await client.callTool("ast_canary_queue_snapshot", { project_root: projectRoot }),
      "ast_canary_queue_snapshot",
    );
    if (predicate(snapshot)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  fail("Timed out waiting for deterministic scheduler state.");
}

async function exerciseRuntimeBounds(options, fixtureRoot) {
  const projectRoot = await createFixtureProject(fixtureRoot, "runtime-a");
  const rejectedProjectRoot = await createFixtureProject(fixtureRoot, "runtime-b", false);
  const cacheRoot = path.join(fixtureRoot, "runtime-disabled-cache");
  const client = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    fixtureServer: true,
    environment: projectEnvironment("disabled", cacheRoot, {
      AST_MAX_PROJECT_SESSIONS: "1",
      AST_MAX_QUEUED_OPERATIONS_PER_PROJECT: "1",
      AST_QUEUE_WAIT_TIMEOUT_MS: "30000",
    }),
  });

  const active = client.beginToolCall("ast_canary_hold", { project_root: projectRoot });
  await client.waitForEvent("canary_hold_active");
  const queued = client.beginToolCall("ast_list_files", {
    project_root: projectRoot,
    offset: 0,
    limit: 10,
  });
  await pollQueueSnapshot(client, projectRoot, (snapshot) => snapshot.queued_operations === 1);

  const overflowResult = await client.callTool("ast_list_files", {
    project_root: projectRoot,
    offset: 0,
    limit: 10,
  });
  const overflowCode = toolError(overflowResult)?.code;
  const capacityResult = await client.callTool("ast_list_files", {
    project_root: rejectedProjectRoot,
    offset: 0,
    limit: 10,
  });
  const capacityCode = toolError(capacityResult)?.code;

  client.cancel(queued.id);
  const queuedResult = await queued.promise;
  const queuedProtocolCancelled = queuedResult?.canary_protocol_cancelled === true;
  await pollQueueSnapshot(client, projectRoot, (snapshot) => snapshot.queued_operations === 0);
  client.cancel(active.id);
  const activeResult = await active.promise;
  const activeProtocolCancelled = activeResult?.canary_protocol_cancelled === true;
  const finalSnapshot = await pollQueueSnapshot(
    client,
    projectRoot,
    (snapshot) => snapshot.active_operations === 0 && snapshot.queued_operations === 0,
  );
  const publicCancellationResult = await client.callTool("ast_canary_pre_cancelled", {
    project_root: projectRoot,
  });
  const publicCancellationCode = toolError(publicCancellationResult)?.code;
  await closeClient(client);
  const cacheCreated = await pathExists(cacheRoot);

  const gates = {
    queue_saturation: overflowCode === "PROJECT_QUEUE_FULL",
    queued_cancellation: queuedProtocolCancelled,
    active_cancellation: activeProtocolCancelled,
    public_cancellation: publicCancellationCode === "REQUEST_CANCELLED",
    session_capacity: capacityCode === "PROJECT_CAPACITY_EXCEEDED",
    queue_drained:
      finalSnapshot.active_operations === 0 &&
      finalSnapshot.queued_operations === 0 &&
      finalSnapshot.cancelled_operations >= 2 &&
      finalSnapshot.rejected_operations >= 1,
    disabled_no_cache: !cacheCreated,
  };
  assertGatesPass(gates, "Runtime-bounds fixture");
  return {
    gates,
    cache_created: cacheCreated,
    outcomes: {
      overflow: overflowCode,
      queued_cancellation: queuedProtocolCancelled ? "protocol_cancelled" : "failed",
      active_cancellation: activeProtocolCancelled ? "protocol_cancelled" : "failed",
      public_cancellation: publicCancellationCode,
      session_capacity: capacityCode,
    },
    operation_queue: finalSnapshot,
  };
}

async function exerciseResourceGate(options, fixtureRoot) {
  const projectRoot = await createFixtureProject(fixtureRoot, "resources");
  const cacheRoot = path.join(fixtureRoot, "resources-cache");
  const environment = projectEnvironment("canary", cacheRoot);
  const client = await spawnMcp({
    nodeBin: options.nodeBin,
    nodeOptions: options.nodeOptions,
    fixtureServer: true,
    environment,
  });
  const readArguments = {
    project_root: projectRoot,
    query: "canaryValue",
    detail: "summary",
    offset: 0,
    limit: 20,
  };
  for (let warmup = 0; warmup < FIXTURE_WARMUPS; warmup += 1) {
    structuredToolResult(
      await client.callTool("ast_search_symbols", readArguments),
      "ast_search_symbols",
    );
  }
  const rssSamples = [];
  const latencySamples = [];
  let manualGcCount = 0;
  for (let iteration = 0; iteration < FIXTURE_MEASURED_READS; iteration += 1) {
    const startedAt = performance.now();
    structuredToolResult(
      await client.callTool("ast_search_symbols", readArguments),
      "ast_search_symbols",
    );
    latencySamples.push(roundMilliseconds(performance.now() - startedAt));
    const sample = structuredToolResult(
      await client.callTool("ast_canary_gc_sample", {}),
      "ast_canary_gc_sample",
    );
    manualGcCount += 1;
    rssSamples.push(sample.rss_bytes);
  }
  const initialStatus = structuredToolResult(
    await client.callTool("ast_get_project_status", { project_root: projectRoot }),
    "ast_get_project_status",
  );
  await closeClient(client);
  const firstCache = await inspectCacheTree(cacheRoot);

  const restartObservations = [];
  let finalStatus = initialStatus;
  for (let restart = 1; restart <= REQUIRED_RESTARTS; restart += 1) {
    const restartClient = await spawnMcp({
      nodeBin: options.nodeBin,
      nodeOptions: options.nodeOptions,
      environment,
    });
    const startedAt = performance.now();
    structuredToolResult(
      await restartClient.callTool("ast_search_symbols", readArguments),
      "ast_search_symbols",
    );
    finalStatus = structuredToolResult(
      await restartClient.callTool("ast_get_project_status", { project_root: projectRoot }),
      "ast_get_project_status",
    );
    const rss = await closeClient(restartClient);
    restartObservations.push({
      restart,
      duration_ms: roundMilliseconds(performance.now() - startedAt),
      ...rss,
      index_observability: indexObservability(finalStatus),
    });
  }
  const finalCache = await inspectCacheTree(cacheRoot);
  const firstRssMedian = median(rssSamples.slice(0, 5));
  const finalRssMedian = median(rssSamples.slice(-5));
  const rssAllowance = Math.max(32 * 1024 * 1024, firstRssMedian * 0.2);
  const cacheAllowance = Math.max(1024 * 1024, firstCache.total_bytes * 0.05);
  const firstFiles = firstCache.files.map((file) => file.file);
  const finalFiles = finalCache.files.map((file) => file.file);
  const gates = {
    exact_warmup_count: FIXTURE_WARMUPS === 10,
    exact_measured_count:
      rssSamples.length === FIXTURE_MEASURED_READS &&
      latencySamples.length === FIXTURE_MEASURED_READS,
    exact_manual_gc_count: manualGcCount === FIXTURE_MEASURED_READS,
    rss_growth_bounded: finalRssMedian - firstRssMedian <= rssAllowance,
    cache_growth_bounded: finalCache.total_bytes - firstCache.total_bytes <= cacheAllowance,
    cache_manifest_stable: JSON.stringify(firstFiles) === JSON.stringify(finalFiles),
    final_restart_ready:
      restartObservations.length === REQUIRED_RESTARTS &&
      restartObservations.every((restart) =>
        hasHealthyPersistentIndex(restart.index_observability, true),
      ),
  };
  assertGatesPass(gates, "Deterministic resource fixture");
  return {
    gates,
    warmup_count: FIXTURE_WARMUPS,
    measured_count: FIXTURE_MEASURED_READS,
    manual_gc_count: manualGcCount,
    latency_samples_ms: latencySamples,
    rss_samples_bytes: rssSamples,
    rss_first_five_median_bytes: firstRssMedian,
    rss_final_five_median_bytes: finalRssMedian,
    rss_allowed_growth_bytes: rssAllowance,
    cache_allowed_growth_bytes: cacheAllowance,
    first_complete_cache: firstCache,
    final_restart_cache: finalCache,
    restarts: restartObservations,
    initial_index_observability: indexObservability(initialStatus),
    final_index_observability: indexObservability(finalStatus),
  };
}

async function exerciseDisposableFixture(options) {
  const fixtureRoot = await mkdtemp(
    path.join(PHYSICAL_TMP_ROOT, "ast-production-readiness-fixture-"),
  );
  try {
    const persistence = await exercisePersistenceFixture(options, fixtureRoot);
    emitProgress("fixture_persistence_complete");
    const mutation = await exerciseMutationIsolation(options, fixtureRoot);
    emitProgress("fixture_mutation_complete");
    const runtime = await exerciseRuntimeBounds(options, fixtureRoot);
    emitProgress("fixture_runtime_complete");
    const resources = await exerciseResourceGate(options, fixtureRoot);
    emitProgress("fixture_resources_complete");
    const gates = {
      ...Object.fromEntries(
        Object.entries(persistence.gates).map(([name, value]) => [`persistence_${name}`, value]),
      ),
      ...Object.fromEntries(
        Object.entries(mutation.gates).map(([name, value]) => [`mutation_${name}`, value]),
      ),
      ...Object.fromEntries(
        Object.entries(runtime.gates).map(([name, value]) => [`runtime_${name}`, value]),
      ),
      ...Object.fromEntries(
        Object.entries(resources.gates).map(([name, value]) => [`resources_${name}`, value]),
      ),
    };
    return { gates, persistence, mutation, runtime, resources };
  } finally {
    await removeTree(fixtureRoot);
  }
}

export async function runDeterministicFixture(options) {
  if (!(await pathExists(serverPath)))
    fail("Built server artifact is missing; run yarn build first.");
  const runtime = await validateRuntimeBinary(options);
  try {
    return await exerciseDisposableFixture({ ...options, nodeBin: runtime.executable });
  } catch (error) {
    await terminateActiveMcpProcesses();
    throw error;
  }
}

async function validateRuntimeBinary(options) {
  const binaryStat = await stat(options.nodeBin);
  if (!binaryStat.isFile()) fail("--node-bin is not a regular file.");
  await access(options.nodeBin, fsConstants.X_OK);
  const canonicalBinary = await realpath(options.nodeBin);
  const authorityName = options.expectedNode === "22.5.0" ? "AST_NODE_22_BIN" : "AST_NODE_24_BIN";
  const authorityValue = process.env[authorityName];
  if (!authorityValue || !path.isAbsolute(authorityValue)) {
    fail(`${authorityName} must identify the selected release-evidence runtime.`);
  }
  const canonicalAuthority = await realpath(authorityValue);
  if (canonicalAuthority !== canonicalBinary) {
    fail(`--node-bin must physically equal ${authorityName}.`);
  }
  const versionResult = await spawnCapture(canonicalBinary, ["--version"], {
    env: childEnvironment(),
    timeoutMs: 10_000,
  });
  const observed = versionResult.stdout.toString("utf8").trim();
  assertExpectedNodeVersion(options.expectedNode, observed);
  const systemResult = await spawnCapture(
    canonicalBinary,
    ["-p", "JSON.stringify({platform:process.platform,arch:process.arch})"],
    { env: childEnvironment(), timeoutMs: 10_000 },
  );
  const selectedSystem = assertPlainObject(
    JSON.parse(systemResult.stdout.toString("utf8")),
    "Selected runtime system identity",
  );
  return {
    executable: canonicalBinary,
    evidence: {
      expected: options.expectedNode,
      observed,
      binary_sha256: await sha256File(canonicalBinary),
    },
    os: {
      platform: selectedSystem.platform,
      release: os.release(),
      arch: selectedSystem.arch,
    },
  };
}

async function loadWorkload(workloadPath) {
  const workloadStat = await stat(workloadPath);
  if (!workloadStat.isFile() || workloadStat.size > MAX_WORKLOAD_BYTES) {
    fail("Workload manifest is missing, non-regular, or oversized.");
  }
  const bytes = await readFile(workloadPath);
  return {
    bytes,
    manifest: validateWorkloadManifest(JSON.parse(bytes.toString("utf8"))),
  };
}

async function prepareCacheRoot(options) {
  if (!options.cacheRoot) {
    return mkdtemp(path.join(PHYSICAL_TMP_ROOT, "ast-production-readiness-cache-"));
  }
  if (
    isPathInside(options.projectRoot, options.cacheRoot) ||
    isPathInside(repositoryRoot, options.cacheRoot)
  ) {
    fail("Canary cache root must be outside source repositories.");
  }
  await assertNewPathWithin(PHYSICAL_TMP_ROOT, options.cacheRoot, "Explicit canary cache root");
  await mkdir(options.cacheRoot, { mode: 0o700 });
  const [physicalCacheRoot, physicalTemporaryRoot] = await Promise.all([
    realpath(options.cacheRoot),
    realpath(PHYSICAL_TMP_ROOT),
  ]);
  if (!isPathInside(physicalTemporaryRoot, physicalCacheRoot)) {
    fail("Explicit canary cache root escapes physical /tmp.");
  }
  return physicalCacheRoot;
}

async function executeCanary(options) {
  if (process.platform !== "linux")
    fail("Production-readiness canary currently supports Linux only.");
  if (!(await pathExists(serverPath)))
    fail("Built server artifact is missing; run yarn build first.");
  const [physicalPackageRoot, physicalProjectRoot] = await Promise.all([
    realpath(repositoryRoot),
    realpath(options.projectRoot),
  ]);
  const sameRepository = physicalPackageRoot === physicalProjectRoot;
  const packageTreePromise = currentWorktreeTree(repositoryRoot);
  const projectTreePromise = sameRepository
    ? packageTreePromise
    : currentWorktreeTree(options.projectRoot);
  const [
    runtimeSelection,
    workloadSelection,
    packageRepositoryIdentity,
    projectRepositoryIdentity,
    packageCandidateTree,
    projectCandidateTree,
  ] = await Promise.all([
    validateRuntimeBinary(options),
    loadWorkload(options.workloadPath),
    repositoryIdentity(repositoryRoot),
    repositoryIdentity(options.projectRoot),
    packageTreePromise,
    projectTreePromise,
  ]);
  const executionOptions = { ...options, nodeBin: runtimeSelection.executable };
  const workload = workloadSelection.manifest;
  if (options.candidateTree && packageCandidateTree !== options.candidateTree) {
    fail("Current package tree does not match --candidate-tree.");
  }
  if (
    isPathInside(options.projectRoot, options.outputPath) ||
    isPathInside(repositoryRoot, options.outputPath)
  ) {
    fail("Raw canary output must remain outside both source repositories.");
  }
  await assertNewPathWithin(PHYSICAL_TMP_ROOT, options.outputPath, "Raw canary output");
  const workloadBytes = workloadSelection.bytes;
  const harnessSha256 = await sha256File(scriptPath);
  const projectStatusBeforePromise = repositoryStatus(options.projectRoot);
  const packageStatusBeforePromise = sameRepository
    ? projectStatusBeforePromise
    : repositoryStatus(repositoryRoot);
  const [projectStatusBefore, packageStatusBefore] = await Promise.all([
    projectStatusBeforePromise,
    packageStatusBeforePromise,
  ]);
  const cacheRoot = await prepareCacheRoot(executionOptions);
  try {
    const [physicalCacheRoot, physicalOutputAncestor] = await Promise.all([
      realpath(cacheRoot),
      nearestExistingAncestor(path.dirname(options.outputPath)),
    ]);
    if (
      path.resolve(options.outputPath) === physicalCacheRoot ||
      isPathInsideOrEqual(physicalCacheRoot, physicalOutputAncestor)
    ) {
      fail("Raw canary output must remain outside the isolated cache root.");
    }
    const realRepository = await executeRealRepository(executionOptions, workload, cacheRoot);
    const fixture = await exerciseDisposableFixture(executionOptions);
    const projectStatusAfterPromise = repositoryStatus(options.projectRoot);
    const packageStatusAfterPromise = sameRepository
      ? projectStatusAfterPromise
      : repositoryStatus(repositoryRoot);
    const projectTreeAfterPromise = currentWorktreeTree(options.projectRoot);
    const packageTreeAfterPromise = sameRepository
      ? projectTreeAfterPromise
      : currentWorktreeTree(repositoryRoot);
    const [
      projectStatusAfter,
      packageStatusAfter,
      projectCandidateTreeAfter,
      packageCandidateTreeAfter,
    ] = await Promise.all([
      projectStatusAfterPromise,
      packageStatusAfterPromise,
      projectTreeAfterPromise,
      packageTreeAfterPromise,
    ]);
    assertRepositoryStatusUnchanged(projectStatusBefore, projectStatusAfter);
    assertRepositoryStatusUnchanged(packageStatusBefore, packageStatusAfter);
    if (projectCandidateTreeAfter !== projectCandidateTree) {
      fail(
        `Project worktree content changed during canary execution (${projectCandidateTree} -> ${projectCandidateTreeAfter}).`,
      );
    }
    if (packageCandidateTreeAfter !== packageCandidateTree) {
      fail(
        `Package worktree content changed during canary execution (${packageCandidateTree} -> ${packageCandidateTreeAfter}).`,
      );
    }
    const runtimeAfter = await validateRuntimeBinary(options);
    if (
      runtimeAfter.executable !== runtimeSelection.executable ||
      runtimeAfter.evidence.binary_sha256 !== runtimeSelection.evidence.binary_sha256
    ) {
      fail("Selected Node runtime changed during canary execution.");
    }
    if (sha256(await readFile(options.workloadPath)) !== sha256(workloadBytes)) {
      fail("Workload bytes changed during canary execution.");
    }
    if ((await sha256File(scriptPath)) !== harnessSha256) {
      fail("Canary harness bytes changed during execution.");
    }

    const gates = {
      runtime_identity: true,
      package_tree_identity:
        options.candidateTree === undefined || packageCandidateTree === options.candidateTree,
      repository_immutable:
        projectStatusBefore.equals(projectStatusAfter) &&
        projectCandidateTreeAfter === projectCandidateTree,
      package_repository_immutable:
        packageStatusBefore.equals(packageStatusAfter) &&
        packageCandidateTreeAfter === packageCandidateTree,
      disabled_default:
        realRepository.disabled.cache_created === false &&
        realRepository.disabled.policy_variable === "absent" &&
        realRepository.disabled.index_observability.backend === "memory" &&
        realRepository.disabled.index_observability.policy === "disabled" &&
        realRepository.disabled.index_observability.policy_reason === "default",
      explicit_canary: hasHealthyPersistentIndex(
        realRepository.canary.initial_index_observability,
        false,
      ),
      semantic_parity: realRepository.semantic_mismatches.length === 0,
      restart_count: realRepository.canary.restarts.length === REQUIRED_RESTARTS,
      restart_reuse: realRepository.canary.restarts.every((restart) =>
        hasHealthyPersistentIndex(restart.index_observability, true),
      ),
      policy_rollback_memory_only:
        realRepository.rollback.index_observability.backend === "memory" &&
        realRepository.rollback.index_observability.policy === "disabled" &&
        realRepository.rollback.cache_unchanged === true,
      ...fixture.gates,
    };
    const overallPass = Object.values(gates).every((gate) => gate === true);
    const report = {
      schema_version: REPORT_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      status: overallPass ? "pass" : "fail",
      command: { argv: options.reportArgv, exact_argv: options.exactArgv },
      identity: {
        package: {
          name: packageMetadata.name,
          version: packageMetadata.version,
          commit: packageRepositoryIdentity.commit,
          head_tree: packageRepositoryIdentity.tree,
          tree: packageCandidateTree,
          status: statusDigest(packageStatusBefore),
        },
        runtime: runtimeSelection.evidence,
        os: runtimeSelection.os,
        project: {
          alias: workload.project_alias,
          commit: projectRepositoryIdentity.commit,
          head_tree: projectRepositoryIdentity.tree,
          tree: projectCandidateTree,
          status: statusDigest(projectStatusBefore),
        },
        workload: {
          schema_version: WORKLOAD_SCHEMA_VERSION,
          sha256: sha256(workloadBytes),
          source_file_count: realRepository.source_file_count,
          call_count: workload.calls.length,
          call_ids: workload.calls.map((call) => call.id),
          measurement_call_id: workload.measurement_call_id,
        },
        harness: {
          sha256: harnessSha256,
        },
      },
      parameters: {
        iterations: options.iterations,
        restarts: options.restarts,
        node_options: options.nodeOptions,
        real_repository_measurements_are_observational: true,
      },
      real_repository: realRepository,
      deterministic_fixture: fixture,
      gates,
      overall_pass: overallPass,
    };
    const output = canonicalJson(report);
    if (Buffer.byteLength(output, "utf8") > MAX_REPORT_BYTES)
      fail("Generated canary report is oversized.");
    assertExactArgumentCredentials(report.command.exact_argv, "Generated canary exact command");
    const sanitizedRawReport = cloneJson(report);
    sanitizedRawReport.command.exact_argv = sanitizedRawReport.command.exact_argv.map((argument) =>
      path.isAbsolute(argument) ? "[path]" : argument,
    );
    assertNoSensitiveText(canonicalJson(sanitizedRawReport), "Generated canary report");
    const outputDirectory = await openAnchoredDirectory(
      PHYSICAL_TMP_ROOT,
      path.dirname(options.outputPath),
      "Raw canary output",
    );
    try {
      await writeExclusiveAt(outputDirectory, path.basename(options.outputPath), output, 0o600);
    } finally {
      await outputDirectory.close();
    }
    if (!overallPass) fail("Production-readiness canary gates failed.");
    return report;
  } finally {
    await removeTree(cacheRoot);
  }
}

export async function runCanary(options) {
  try {
    return await executeCanary(options);
  } catch (error) {
    await terminateActiveMcpProcesses();
    throw error;
  }
}

async function runFixtureServer() {
  if (typeof globalThis.gc !== "function") fail("Fixture server requires --expose-gc.");
  const [
    { z },
    { createServer },
    { runStdioServer },
    projectModule,
    requestModule,
    resultModule,
    activityModule,
    operationModule,
    symbolIndexModule,
  ] = await Promise.all([
    import("zod"),
    import("../dist/server.js"),
    import("../dist/index.js"),
    import("../dist/services/project.js"),
    import("../dist/services/request-context.js"),
    import("../dist/tools/result.js"),
    import("../dist/services/runtime-activity.js"),
    import("../dist/services/operations.js"),
    import("../dist/services/symbol-index-sqlite.js"),
  ]);
  const { getProjectOperationQueueSnapshot, withProject } = projectModule;
  const { createRequestContext } = requestModule;
  const { createToolErrorContext, errorResult, structuredResult } = resultModule;
  const { RuntimeActivityTracker } = activityModule;
  const { setOperationTestHooksForTests } = operationModule;
  const { SQLiteSymbolIndexStore } = symbolIndexModule;
  const runtimeActivity = new RuntimeActivityTracker();
  const server = createServer({ runtimeActivity });
  const originalIndexRefresh = SQLiteSymbolIndexStore.prototype.refresh;
  let failNextIndexRefresh = false;
  SQLiteSymbolIndexStore.prototype.refresh = async function (...args) {
    if (!failNextIndexRefresh) return originalIndexRefresh.apply(this, args);
    failNextIndexRefresh = false;
    throw Object.assign(new Error("canary injected symbol-index write failure"), {
      code: "write_failed",
    });
  };

  server.registerTool(
    "ast_canary_arm_index_write_failure",
    { inputSchema: z.object({}) },
    async () => {
      failNextIndexRefresh = true;
      return structuredResult({ armed: true });
    },
  );

  server.registerTool(
    "ast_canary_arm_apply_failure",
    {
      inputSchema: z.object({ before_replace_index: z.number().int().min(1).max(16) }),
    },
    async ({ before_replace_index }) => {
      setOperationTestHooksForTests({
        beforeReplace: (_file, index) => {
          if (index !== before_replace_index) return;
          setOperationTestHooksForTests({});
          throw new Error("canary injected apply failure");
        },
      });
      return structuredResult({ armed: true });
    },
  );
  server.registerTool(
    "ast_canary_hold",
    { inputSchema: z.object({ project_root: z.string() }) },
    async ({ project_root }, extra) => {
      try {
        const held = await withProject(
          project_root,
          async (_context, operationContext) => {
            process.stderr.write(
              `${JSON.stringify({ event: "canary_hold_active", version: 1 })}\n`,
            );
            if (!operationContext.signal.aborted) {
              await new Promise((resolve) => {
                operationContext.signal.addEventListener("abort", resolve, { once: true });
              });
            }
            operationContext.checkpoint();
            return true;
          },
          createRequestContext(extra.signal),
        );
        return structuredResult({ held });
      } catch (error) {
        return errorResult(error, createToolErrorContext("ast_canary_hold", project_root));
      }
    },
  );
  server.registerTool(
    "ast_canary_queue_snapshot",
    { inputSchema: z.object({ project_root: z.string() }) },
    async ({ project_root }) => {
      try {
        return structuredResult(getProjectOperationQueueSnapshot(project_root));
      } catch (error) {
        return errorResult(
          error,
          createToolErrorContext("ast_canary_queue_snapshot", project_root),
        );
      }
    },
  );
  server.registerTool(
    "ast_canary_pre_cancelled",
    { inputSchema: z.object({ project_root: z.string() }) },
    async ({ project_root }) => {
      const controller = new globalThis.AbortController();
      controller.abort();
      try {
        await withProject(project_root, () => true, createRequestContext(controller.signal));
        return structuredResult({ cancelled: false });
      } catch (error) {
        return errorResult(error, createToolErrorContext("ast_canary_pre_cancelled", project_root));
      }
    },
  );
  server.registerTool("ast_canary_gc_sample", { inputSchema: z.object({}) }, async () => {
    globalThis.gc();
    const rssBytes = process.memoryUsage().rss;
    return structuredResult({ rss_bytes: rssBytes });
  });

  await runStdioServer({ server, runtimeActivity, logStartup: false });
  process.stderr.write(`${JSON.stringify({ event: "canary_fixture_ready", version: 1 })}\n`);
}

async function main() {
  if (process.argv[2] === FIXTURE_SERVER_MODE) {
    await runFixtureServer();
    return;
  }
  const options = parseCanaryArguments(process.argv.slice(2));
  if (options.mode === "freeze-report-set") {
    const reports = await freezeCanaryReportSet(options.inputs, options.xScraperRoot);
    process.stdout.write(
      `${JSON.stringify({ status: "ok", mode: "freeze-report-set", report_count: Object.keys(reports).length })}\n`,
    );
    return;
  }
  const report = await runCanary(options);
  process.stdout.write(
    `${JSON.stringify({ status: "ok", mode: "run", project: report.identity.project.alias, overall_pass: true })}\n`,
  );
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(scriptPath);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch(async (error) => {
    await terminateActiveMcpProcesses();
    const message = error instanceof Error ? error.message : "Unknown canary failure.";
    process.stderr.write(`Production-readiness canary failed: ${message}\n`);
    process.exitCode = 1;
  });
}
