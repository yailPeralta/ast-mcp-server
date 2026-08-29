#!/usr/bin/env node
// DeepSeek Harness adapter smoke (roadmap initiative 4, first slice).
//
// Mandatory evidence against the PINNED Harness revision — never a green-skip:
//   A. Packed tarball fixture: exact dsh.bundle.patch + deepseekHarness identity, shipped
//      cordis.patch.yml, exact 0.13.0 version.
//   B. Guard matrix against the resolved entrypoint (independent MCP client):
//      unset/deny/invalid deny ast_apply_operation; only `allow` enables it;
//      reads + prepare + preview work while apply is denied.
//   C. Pinned-Harness proof (HARD FAIL when the harness is missing or the
//      revision/version mismatches): install the exact tarball into an isolated
//      profile, prove --dump-config composition, then discover mcp__ast__* and
//      invoke read, prepare, and preview tools THROUGH the harness tool registry
//      via a probe plugin, asserting apply is absent and direct invocation is rejected.
//
// DSH_HARNESS_SOURCE, when provided, is Git object evidence only. The smoke
// always materializes, installs, and builds a fresh checkout at the exact
// revision. Teardown always runs via `finally`.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Buffer } from "node:buffer";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import yaml from "yaml";
import { parseProbeMarker, runBoundedCommand, terminateProcessTree } from "./runtime-process.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageMetadata = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const expectedVersion = "0.13.0";
const yarnExecutable = process.platform === "win32" ? "yarn.cmd" : "yarn";
const PINNED_REVISION = "cd5ef8148158c3a752a658978873241fdf8e2bbc";
const PINNED_TAG = "dsh-v0.1.2-alpha.1";
const PINNED_VERSION = "0.1.2-alpha.1";
const HARNESS_REPOSITORY = "https://github.com/deepseek-ai/deepseek-harness.git";
const PUBLIC_PACKAGE_INTEGRITY =
  "sha512-vbna6hhjX+VlayTnrgWQ/EitxkBmhVza0az6J/MCpE14M4Yn50D4yTQZrrcjfCi05sVhJhWFGPnzv6VE3V9KIw==";
const PUBLIC_PACKAGE_SHASUM = "166f95121a72f0b03c325cef586a211cd9107a24";
const H01_TOOL_NAME = "mcp__ast__ast_get_project_status";
const PUBLIC_EMPTY_RESULT_MARKER = "(ast_get_project_status returned no model-visible content)";
let ownedTransportSequence = 0;

class OwnedStdioClientTransport extends StdioClientTransport {
  constructor(parameters) {
    const ownerToken = `${process.pid}-${Date.now()}-${++ownedTransportSequence}`;
    super({
      ...parameters,
      env: { ...parameters.env, AST_H01_PROCESS_OWNER: ownerToken },
    });
    this.ownerToken = ownerToken;
    this.ownedPid = null;
  }

  start() {
    const started = super.start();
    this.ownedPid = this.pid;
    return started;
  }
}

function fail(message) {
  throw new Error(`dsh-adapter-smoke: ${message}`);
}

function blocked(message) {
  throw new Error(`dsh-adapter-smoke: BLOCKED: ${message}`);
}

async function requirePrerequisite(label, operation) {
  try {
    return await operation();
  } catch (error) {
    blocked(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function run(command, args, options = {}) {
  return runBoundedCommand(command, args, {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    ...options,
  });
}

async function preflightRequiredExecutables() {
  for (const [command, args] of [
    [process.execPath, ["--version"]],
    [yarnExecutable, ["--version"]],
    ["npm", ["--version"]],
    ["corepack", ["--version"]],
    ["git", ["--version"]],
    ["tar", ["--version"]],
  ]) {
    await run(command, args, { timeout: 30_000 });
  }
}

async function sha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function digestFile(filePath, algorithm, encoding) {
  return createHash(algorithm)
    .update(await readFile(filePath))
    .digest(encoding);
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function classifyText(text) {
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: createHash("sha256").update(text).digest("hex"),
    useful: text.length > 0 && !text.includes("returned no model-visible content"),
  };
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, timeoutMs = 7_000) {
  const deadline = Date.now() + timeoutMs;
  while (pidExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !pidExists(pid);
}

async function collectOwnedProcessTree(rootPid) {
  const owned = new Set([rootPid]);
  if (process.platform !== "linux") return [...owned];
  const pending = [rootPid];
  while (pending.length > 0) {
    const parent = pending.pop();
    const children = await readFile(`/proc/${parent}/task/${parent}/children`, "utf8").catch(
      (error) => {
        if (error?.code === "ENOENT") return "";
        throw error;
      },
    );
    for (const token of children.trim().split(/\s+/u).filter(Boolean)) {
      const child = Number(token);
      if (!Number.isSafeInteger(child) || child <= 0 || owned.has(child)) continue;
      owned.add(child);
      pending.push(child);
    }
  }
  return [...owned];
}

async function collectOwnerTokenPids(ownerToken) {
  if (process.platform !== "linux") return [];
  const entries = await readdir("/proc", { withFileTypes: true });
  const matches = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
      .map(async (entry) => {
        const environment = await readFile(`/proc/${entry.name}/environ`, "utf8").catch(() => "");
        return environment.split("\0").includes(`AST_H01_PROCESS_OWNER=${ownerToken}`)
          ? Number(entry.name)
          : null;
      }),
  );
  return matches.filter((pid) => Number.isSafeInteger(pid));
}

async function terminateOwnedPids(ownedPids) {
  let survivors = ownedPids.filter(pidExists);
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const ownedPid of [...survivors].reverse()) {
      try {
        process.kill(ownedPid, signal);
      } catch {
        // Already exited between observation and containment.
      }
    }
    await Promise.all(survivors.map((ownedPid) => waitForPidExit(ownedPid, 2_000)));
    survivors = survivors.filter(pidExists);
    if (survivors.length === 0) return true;
  }
  return false;
}

async function closeMcpSession(client, transport, connected) {
  const pid = transport.ownedPid ?? transport.pid;
  const beforeClose =
    Number.isSafeInteger(pid) && pid > 0 ? await collectOwnedProcessTree(pid) : [];
  let closeError;
  try {
    if (connected) await client.close();
    else await transport.close();
  } catch (error) {
    closeError = error;
  }
  if (connected) {
    assert(Number.isSafeInteger(pid) && pid > 0, "connected MCP transport exposed no child pid");
  }
  const ownedPids = [
    ...new Set([...beforeClose, ...(await collectOwnerTokenPids(transport.ownerToken))]),
  ];
  const exited = await Promise.all(ownedPids.map((ownedPid) => waitForPidExit(ownedPid, 500)));
  if (!exited.every(Boolean)) {
    assert(await terminateOwnedPids(ownedPids), "MCP process tree survived bounded termination");
  }
  assert(
    (await collectOwnerTokenPids(transport.ownerToken)).length === 0,
    "MCP owner-token process survived transport close",
  );
  if (closeError !== undefined) throw closeError;
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ast-dsh-adapter-"));

/** True when a Node version satisfies the pinned harness engine (`^22.19.0 || >=24.0.0`). */
function satisfiesHarnessEngine(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version.trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major >= 24 || (major === 22 && minor >= 19);
}

/**
 * Resolve a Node binary that can build/run the pinned harness. The ast-mcp-server
 * CI matrix includes Node 22.13.0, which is below the harness engine floor; when
 * the current node is too old, reuse the Node 24 already cached in the CI
 * toolcache by the earlier setup-node step.
 */
async function resolveHarnessNode() {
  if (satisfiesHarnessEngine(process.version)) {
    return { nodeBin: process.execPath, nodeBinDir: path.dirname(process.execPath) };
  }
  const toolcacheRoot = process.env.RUNNER_TOOL_CACHE
    ? path.join(process.env.RUNNER_TOOL_CACHE, "node")
    : "/opt/hostedtoolcache/node";
  const names = await readdir(toolcacheRoot).catch(() => []);
  for (const name of names) {
    const candidate = path.join(toolcacheRoot, name, "x64", "bin", "node");
    const version = await run(candidate, ["--version"])
      .then((result) => result.stdout.trim())
      .catch(() => "");
    if (satisfiesHarnessEngine(version)) {
      return { nodeBin: candidate, nodeBinDir: path.dirname(candidate) };
    }
  }
  fail(
    `node ${process.version} cannot build the pinned harness (requires ^22.19.0 || >=24.0.0) and no qualifying node was found under ${toolcacheRoot}`,
  );
}

/** Resolve the pinned harness source and return its runnable CLI bin, verifying identity. */
async function resolvePinnedHarness() {
  const { nodeBin, nodeBinDir } = await resolveHarnessNode();
  const source = await materializePinnedHarness(nodeBinDir);
  const nodeVersion = (await run(nodeBin, ["--version"])).stdout.trim();
  assert(
    satisfiesHarnessEngine(nodeVersion),
    "resolved Harness Node no longer satisfies its engine",
  );
  const head = (await run("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
  assert(head === PINNED_REVISION, `harness HEAD ${head} != pinned ${PINNED_REVISION}`);
  const taggedRevision = (
    await run("git", ["-C", source, "rev-list", "-n", "1", PINNED_TAG])
  ).stdout.trim();
  assert(taggedRevision === head, `harness tag ${PINNED_TAG} does not resolve to pinned HEAD`);
  const cliBin = path.join(source, "apps", "cli", "lib", "bin.js");
  const cliVersion = (await run(nodeBin, [cliBin, "--version"])).stdout.trim();
  assert(cliVersion === PINNED_VERSION, `harness CLI ${cliVersion} != pinned ${PINNED_VERSION}`);
  const mcpClientVersion = (
    await run(nodeBin, [
      "-p",
      `require(${JSON.stringify(
        path.join(source, "packages", "mcp", "mcp-client", "package.json"),
      )}).version`,
    ])
  ).stdout.trim();
  assert(
    mcpClientVersion === PINNED_VERSION,
    `mcp-client ${mcpClientVersion} != pinned ${PINNED_VERSION}`,
  );
  return {
    source,
    cliBin,
    nodeBin,
    identity: {
      revision: head,
      tag: PINNED_TAG,
      cliVersion,
      mcpClientVersion,
      nodeVersion,
      observedNodeSha256: await sha256(nodeBin),
      observedCliSha256: await sha256(cliBin),
    },
  };
}

/** Pack @deepseek-ai/dsh-mcp-client from the pinned source into an installable tarball. */
async function packPinnedMcpClient(source) {
  const cwd = path.join(source, "packages", "mcp", "mcp-client");
  const environment = {
    ...process.env,
    NODE_OPTIONS: "",
    CI: "true",
    COREPACK_INTEGRITY_KEYS: "0",
    COREPACK_USE_LATEST: "0",
  };
  await run("corepack", ["pnpm", "pack", "--pack-destination", temporaryRoot], {
    cwd,
    env: environment,
  });
  const archive = path.join(temporaryRoot, `deepseek-ai-dsh-mcp-client-${PINNED_VERSION}.tgz`);
  assert(
    await readFile(archive, "utf8").then(
      () => true,
      () => false,
    ),
    `pinned mcp-client tarball missing at ${archive}`,
  );
  return archive;
}

/** Fetch and verify the immutable public v0.13.0 tarball used for the RED baseline. */
async function fetchPublicPackage() {
  const destination = path.join(temporaryRoot, "public-package");
  await mkdir(destination, { recursive: true });
  const packed = await run(
    "npm",
    ["pack", `ast-mcp-server@${expectedVersion}`, "--pack-destination", destination, "--json"],
    { cwd: temporaryRoot },
  );
  const records = JSON.parse(packed.stdout);
  const record = records[0];
  assert(record?.integrity === PUBLIC_PACKAGE_INTEGRITY, "public package integrity mismatch");
  assert(record?.shasum === PUBLIC_PACKAGE_SHASUM, "public package shasum mismatch");
  const archive = path.join(destination, record.filename);
  const observedIntegrity = `sha512-${await digestFile(archive, "sha512", "base64")}`;
  const observedShasum = await digestFile(archive, "sha1", "hex");
  assert(
    observedIntegrity === PUBLIC_PACKAGE_INTEGRITY,
    "downloaded public package integrity mismatch",
  );
  assert(observedShasum === PUBLIC_PACKAGE_SHASUM, "downloaded public package shasum mismatch");
  return archive;
}

/** Materialize, install, and build a fresh harness tree at the pinned revision. */
async function materializePinnedHarness(nodeBinDir) {
  const root = path.join(temporaryRoot, "pinned-harness");
  const suppliedEvidence = process.env.DSH_HARNESS_SOURCE
    ? path.resolve(process.env.DSH_HARNESS_SOURCE)
    : undefined;
  const objectSource = suppliedEvidence ?? HARNESS_REPOSITORY;
  if (suppliedEvidence) {
    await run("git", ["-C", suppliedEvidence, "cat-file", "-e", `${PINNED_REVISION}^{commit}`]);
    const tag = (
      await run("git", ["-C", suppliedEvidence, "rev-parse", `${PINNED_TAG}^{commit}`])
    ).stdout.trim();
    assert(tag === PINNED_REVISION, `supplied harness tag ${PINNED_TAG} is not pinned`);
  }
  await run(
    "git",
    [
      "clone",
      "--no-hardlinks",
      "--no-checkout",
      ...(suppliedEvidence ? [] : ["--filter=blob:none"]),
      objectSource,
      root,
    ],
    { cwd: temporaryRoot },
  );
  await run("git", ["-C", root, "checkout", "--detach", PINNED_REVISION]);
  // The git commit is the authoritative identity (verified via rev-parse HEAD);
  // corepack verifies the pnpm download signature, which fails when the registry
  // rotates its signing key, so disable that check for the pinned source build.
  // A qualifying node's bin directory leads PATH so pnpm/tsx/tsc/tsdown run under
  // a Node that meets the harness engine floor.
  const provisionEnvironment = {
    ...process.env,
    PATH: `${nodeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
    NODE_OPTIONS: "",
    CI: "true",
    COREPACK_INTEGRITY_KEYS: "0",
    COREPACK_USE_LATEST: "0",
  };
  await run("corepack", ["pnpm", "--version"], { cwd: root, env: provisionEnvironment });
  await run("corepack", ["pnpm", "install"], { cwd: root, env: provisionEnvironment });
  await run("corepack", ["pnpm", "build"], { cwd: root, env: provisionEnvironment });
  return root;
}

/** Boot the profile with the probe plugin and return its DSH_PROBE_RESULT marker. */
async function bootWithProbe(cliBin, nodeBin, environment, fixtureProject, dshHome) {
  const child = spawn(nodeBin, [cliBin, "--profile", "smoke", "probe"], {
    cwd: temporaryRoot,
    env: { ...environment, AST_PROBE_PROJECT_ROOT: fixtureProject, DSH_HOME: dshHome },
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    const marker = await new Promise((resolve) => {
      let settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        clearInterval(interval);
        resolve(value);
      }
      function check() {
        const parsed = parseProbeMarker(stderr);
        if (parsed.status === "found") finish(parsed.value);
        if (parsed.status === "invalid") finish({ parseError: parsed.detail });
      }
      const deadline = setTimeout(() => finish(undefined), 90_000);
      const interval = setInterval(check, 250);
      child.on("exit", () => {
        const parsed = parseProbeMarker(stderr);
        finish(
          parsed.status === "found"
            ? parsed.value
            : parsed.status === "invalid"
              ? { parseError: parsed.detail }
              : undefined,
        );
      });
    });
    assert(marker !== undefined, "harness probe produced no DSH_PROBE_RESULT marker");
    assert(marker.parseError === undefined, marker.parseError ?? "invalid probe marker");
    return marker;
  } finally {
    await terminateProcessTree(child);
  }
}

/** The probe plugin: exercises every promised tool class through the Harness registry. */
function probeSource() {
  return `export default function apply(ctx) {
  const projectRoot = process.env.AST_PROBE_PROJECT_ROOT;
  const deadline = Date.now() + 30000;
  const marker = { discovered: [], applyAbsent: null, calls: {}, applyRejected: null, error: null };
  async function execute(name, arguments_, callId) {
    const result = await ctx.tools.execute({
      callId,
      name,
      arguments: arguments_,
      signal: AbortSignal.timeout(10000),
    });
    if (result.isError) throw new Error(String(result.error).slice(0, 240));
    return result.value && result.value.structuredContent;
  }
  async function run() {
    while (Date.now() < deadline) {
      const names = ctx.tools.schemas().map((s) => s.name);
      const ast = names.filter((n) => n.startsWith("mcp__ast__")).sort();
      if (ast.length > 0) {
        marker.discovered = ast;
        marker.applyAbsent = !ast.includes("mcp__ast__ast_apply_operation");
        try {
          const status = await execute(
            "mcp__ast__ast_get_project_status",
            { project_root: projectRoot },
            "probe-read",
          );
          marker.calls.read = { ok: status && typeof status === "object" };
          const prepared = await execute(
            "mcp__ast__ast_rename_symbol",
            {
              project_root: projectRoot,
              file_path: "src/value.ts",
              symbol_path: "value",
              new_name: "renamedValue",
              dry_run: true,
            },
            "probe-prepare",
          );
          marker.calls.prepare = {
            ok: typeof prepared?.operation_id === "string",
            operationId: prepared?.operation_id,
          };
          const preview = await execute(
            "mcp__ast__ast_get_operation_preview",
            { operation_id: prepared?.operation_id, file: "src/value.ts" },
            "probe-preview",
          );
          marker.calls.preview = { ok: typeof preview?.plan_hash === "string" };
          try {
            const rejected = await ctx.tools.execute({
              callId: "probe-apply-rejection",
              name: "mcp__ast__ast_apply_operation",
              arguments: { operation_id: prepared?.operation_id, plan_hash: preview?.plan_hash },
              signal: AbortSignal.timeout(10000),
            });
            marker.applyRejected = {
              ok: rejected.isError === true && rejected.error?.info?.code === "UNKNOWN_TOOL",
              kind: rejected.error?.info?.code ?? "unexpected-success",
            };
          } catch (error) {
            marker.applyRejected = {
              ok: false,
              kind: "unexpected-exception",
              detail: String(error).slice(0, 240),
            };
          }
        } catch (error) {
          marker.error = String(error).slice(0, 240);
        }
        process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    marker.error = "timeout waiting for mcp__ast tools";
    process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n");
  }
  void run().catch((error) => {
    marker.error = String(error).slice(0, 240);
    process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n");
  });
}
`;
}

function captureSource() {
  return `import { writeFileSync } from "node:fs";
export default function apply(ctx) {
  ctx.on("tools/result", (exec, result) => {
    if (exec.name !== ${JSON.stringify(H01_TOOL_NAME)}) return;
    writeFileSync(process.env.AST_H01_CAPTURE_PATH, JSON.stringify({
      callId: exec.callId,
      arguments: exec.arguments,
      value: result.value,
      content: result.content,
      isError: result.isError,
    }), "utf8");
  });
}
`;
}

function replaySource() {
  return `export default function apply(ctx) {
  const marker = { callId: null, content: null, isError: null, matches: 0, error: null };
  async function run() {
    await ctx.get("loader")?.await();
    const handle = await ctx.agents.resume({
      resumeSessionId: process.env.AST_H01_SESSION_ID,
    });
    try {
      const messages = handle.agent.session
        .deriveMessages()
        .filter((entry) => entry.source?.kind === "tool" && entry.source.callId === process.env.AST_H01_CALL_ID);
      const message = messages[0];
      marker.matches = messages.length;
      marker.callId = message?.source?.callId ?? null;
      marker.content = message?.content?.[0]?.content ?? null;
      marker.isError = message?.content?.[0]?.isError ?? null;
    } finally {
      await handle.dispose();
    }
    process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n");
    ctx.get("appExit")?.(0);
  }
  void run().catch((error) => {
    marker.error = String(error).slice(0, 240);
    process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n");
    ctx.get("appExit")?.(1);
  });
}
`;
}

function profilePatch({ replay = false } = {}) {
  return `- id: tools
  config:
    mode: native
- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('sessions')
    compression: none
    packChunks: false
${replay ? "- id: headless-runner\n  disabled: true\n" : ""}- insert:
    - id: h01-capture
      name: '@ast-mcp/h01-capture'
${
  replay
    ? "    - id: h01-replay\n      name: './h01-replay.mjs'\n      inject: ['agents', 'sessionPersistence']\n"
    : ""
}`;
}

function textFromCoreContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function normalizedStatusHash(status) {
  const value = JSON.parse(JSON.stringify(status));
  value.last_successful_sync_at = null;
  value.last_successful_index_at = null;
  value.operation_queue.max_queue_wait_ms = 0;
  value.operation_queue.max_execution_ms = 0;
  value.index_observability.last_successful_persistence_at = null;
  return hashJson(value);
}

async function fixtureSha256(root) {
  return hashJson(
    await Promise.all(
      ["tsconfig.json", "src/escaped.ts", "src/value.ts"].map((file) =>
        readFile(path.join(root, file), "utf8"),
      ),
    ),
  );
}

async function findSingleSessionLog(root) {
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      if (entry.isFile() && entry.name === "session.jsonl") found.push(target);
    }
  }
  await visit(root);
  assert(found.length === 1, `expected one durable session log, found ${found.length}`);
  return found[0];
}

async function installJourneyProfile({ cliBin, nodeBin, environment, archive, mcpClientArchive }) {
  for (const dependency of [archive, mcpClientArchive]) {
    await run(nodeBin, [cliBin, "plugin", "--profile", "headless", "add", `file:${dependency}`], {
      cwd: temporaryRoot,
      env: environment,
    });
  }
  const profileDir = path.join(environment.DSH_HOME, "profiles", "headless");
  const capturePackageDir = path.join(profileDir, "node_modules", "@ast-mcp", "h01-capture");
  await mkdir(capturePackageDir, { recursive: true });
  await writeFile(
    path.join(capturePackageDir, "package.json"),
    JSON.stringify({
      name: "@ast-mcp/h01-capture",
      version: "1.0.0",
      type: "module",
      exports: "./index.mjs",
    }),
    "utf8",
  );
  await writeFile(path.join(capturePackageDir, "index.mjs"), captureSource(), "utf8");
  await writeFile(path.join(profileDir, "cordis.patch.yml"), profilePatch(), "utf8");
  return profileDir;
}

async function replayDurableSession({
  cliBin,
  nodeBin,
  environment,
  profileDir,
  sessionId,
  callId,
}) {
  await writeFile(path.join(profileDir, "h01-replay.mjs"), replaySource(), "utf8");
  await writeFile(
    path.join(profileDir, "cordis.patch.yml"),
    profilePatch({ replay: true }),
    "utf8",
  );
  const replayed = await run(nodeBin, [cliBin, "--profile", "headless", "replay"], {
    cwd: temporaryRoot,
    env: { ...environment, AST_H01_SESSION_ID: sessionId, AST_H01_CALL_ID: callId },
  });
  const parsed = parseProbeMarker(replayed.stderr);
  assert(parsed.status === "found", "cold replay produced no result marker");
  assert(parsed.value.error === null, `cold replay failed: ${parsed.value.error}`);
  assert(parsed.value.matches === 1, "cold replay did not resolve exactly one correlated result");
  return {
    callId: parsed.value.callId,
    content: parsed.value.content,
    isError: parsed.value.isError,
    text: textFromCoreContent(parsed.value.content),
  };
}

async function runNativeAgentJourney({
  label,
  archive,
  mcpClientArchive,
  harness,
  fixtureProject,
  expectedWorkspaceSha256,
  expectUseful,
}) {
  const home = path.join(temporaryRoot, `h01-${label}-home`);
  const capturePath = path.join(temporaryRoot, `h01-${label}-capture.json`);
  await mkdir(home, { recursive: true });
  const environment = {
    ...process.env,
    DSH_HOME: home,
    DSH_TOOLS_MODE: "native",
    DSH_TELEMETRY_DISABLED: "1",
    COREPACK_INTEGRITY_KEYS: "0",
    COREPACK_USE_LATEST: "0",
  };
  const profileDir = await installJourneyProfile({
    cliBin: harness.cliBin,
    nodeBin: harness.nodeBin,
    environment,
    archive,
    mcpClientArchive,
  });
  const mockModulePath = path.join(
    harness.source,
    "packages",
    "test-support",
    "llm-mock-server",
    "lib",
    "index.js",
  );
  const { startMockLlmServer } = await import(pathToFileURL(mockModulePath).href);
  const apiKey = `h01-${label}-key`;
  const mock = await startMockLlmServer({
    sequence: ["tool_call_success", "success"],
    repeatLast: true,
    apiKey,
    toolName: H01_TOOL_NAME,
    toolArguments: JSON.stringify({ project_root: fixtureProject }),
    successText: `H01_${label.toUpperCase()}_DONE`,
  });
  try {
    const runResult = await run(
      harness.nodeBin,
      [harness.cliBin, "--profile", "headless", "Inspect the project status with the AST tool."],
      {
        cwd: fixtureProject,
        env: {
          ...environment,
          AST_H01_CAPTURE_PATH: capturePath,
          DEEPSEEK_API_KEY: apiKey,
          DEEPSEEK_BASE_URL: mock.baseURL,
        },
      },
    );
    assert(
      runResult.stdout.trim() === `H01_${label.toUpperCase()}_DONE`,
      `${label} agent did not finish`,
    );
    assert(
      mock.requests.length >= 2 && mock.requests.length <= 3,
      `${label} journey expected the tool turn and at most one auxiliary request`,
    );

    const firstBody = mock.requests[0]?.body;
    const tools = Array.isArray(firstBody?.tools) ? firstBody.tools : [];
    const toolNames = tools
      .map((tool) => tool?.function?.name)
      .filter((name) => typeof name === "string");
    const astNames = toolNames.filter((name) => name.startsWith("mcp__ast__")).sort();
    assert(astNames.length === 15, `${label} model catalog exposed ${astNames.length} AST tools`);
    assert(
      !astNames.includes("mcp__ast__ast_apply_operation"),
      `${label} model catalog exposed apply`,
    );

    const modelRequest = mock.requests.find((request) =>
      request.body?.messages?.some((message) => message?.role === "tool"),
    );
    const secondMessages = Array.isArray(modelRequest?.body?.messages)
      ? modelRequest.body.messages
      : [];
    const modelToolMessage = secondMessages.findLast((message) => message?.role === "tool");
    const modelText = typeof modelToolMessage?.content === "string" ? modelToolMessage.content : "";
    const capture = JSON.parse(await readFile(capturePath, "utf8"));
    assert(capture.isError === false, `${label} native tool call failed`);
    assert(
      typeof capture.callId === "string" && modelToolMessage?.tool_call_id === capture.callId,
      `${label} native and provider call IDs differ`,
    );
    assert(
      isDeepStrictEqual(capture.arguments, { project_root: fixtureProject }),
      `${label} captured tool arguments differ`,
    );
    const rawStructured = capture.value?.structuredContent;
    assert(
      rawStructured && typeof rawStructured === "object",
      `${label} raw structured value is missing`,
    );
    const nativeText = textFromCoreContent(capture.content);
    assert(nativeText === modelText, `${label} native and next-request tool results differ`);
    let projectedStructured;
    if (expectUseful) {
      projectedStructured = JSON.parse(modelText);
      assert(
        isDeepStrictEqual(projectedStructured, rawStructured),
        `${label} model projection differs from its exact raw structured value`,
      );
      assert(
        /^project_[0-9a-f]{20}$/u.test(projectedStructured?.project?.project_id) &&
          typeof projectedStructured?.compiler?.state === "string" &&
          typeof projectedStructured?.source_count === "number",
        `${label} model projection is not a project-status result`,
      );
    } else {
      assert(
        modelText === PUBLIC_EMPTY_RESULT_MARKER &&
          capture.content?.length === 1 &&
          capture.content[0]?.type === "text",
        `${label} public baseline did not reproduce the exact H-01 marker`,
      );
    }
    assert(
      classifyText(modelText).useful === expectUseful,
      `${label} visibility classification mismatch`,
    );

    const logPath = await findSingleSessionLog(path.join(home, "sessions"));
    const rows = (await readFile(logPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const header = rows[0];
    const durableEvents = rows.filter(
      (row) => row.type === "tool/result" && row.data?.message?.source?.callId === capture.callId,
    );
    assert(durableEvents.length === 1, `${label} durable correlated tool/result is not unique`);
    const durableBlock = durableEvents[0].data.message.content[0];
    const durableText = textFromCoreContent(durableBlock.content);
    assert(
      durableBlock.isError === false &&
        durableText === modelText &&
        isDeepStrictEqual(durableBlock.content, capture.content),
      `${label} durable result differs from the correlated native result`,
    );
    const replay = await replayDurableSession({
      cliBin: harness.cliBin,
      nodeBin: harness.nodeBin,
      environment,
      profileDir,
      sessionId: header.id,
      callId: capture.callId,
    });
    assert(
      replay.callId === capture.callId &&
        replay.isError === false &&
        replay.text === durableText &&
        isDeepStrictEqual(replay.content, durableBlock.content),
      `${label} cold replay differs from its correlated durable result`,
    );

    const workspaceSha256 = await fixtureSha256(fixtureProject);
    assert(workspaceSha256 === expectedWorkspaceSha256, `${label} journey mutated the fixture`);
    return {
      projectedStructured:
        projectedStructured === undefined
          ? null
          : {
              bytes: Buffer.byteLength(JSON.stringify(projectedStructured)),
              sha256: hashJson(projectedStructured),
            },
      rawStructured: {
        bytes: Buffer.byteLength(JSON.stringify(rawStructured)),
        sha256: hashJson(rawStructured),
        normalizedSha256: normalizedStatusHash(rawStructured),
      },
      native: classifyText(nativeText),
      model: classifyText(modelText),
      durable: classifyText(durableText),
      replay: classifyText(replay.text),
      scopedCatalogSha256: hashJson(astNames),
      workspaceSha256,
    };
  } finally {
    await mock.close();
  }
}

const packageDirectory = path.join(temporaryRoot, "package");
const archivePath = path.join(packageDirectory, "ast-mcp-server.tgz");
const consumerDirectory = path.join(temporaryRoot, "consumer");
const fixtureProject = path.join(temporaryRoot, "fixture-project");
const dshHome = path.join(temporaryRoot, "dsh-home");
const summary = { version: packageMetadata.version, phases: {} };

try {
  await requirePrerequisite("required executable preflight", preflightRequiredExecutables);
  // ── Phase A: packed artifact fixture ────────────────────────────────────────
  if (packageMetadata.version !== expectedVersion) {
    fail(
      `package.json version ${packageMetadata.version} does not match the pinned adapter fixture ${expectedVersion}`,
    );
  }
  if (JSON.stringify(packageMetadata.dsh) !== '{"bundle":{"patch":"./cordis.patch.yml"}}') {
    fail(`package.json must declare exactly "dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`);
  }
  const pinned = packageMetadata.deepseekHarness;
  assert(
    pinned?.revision === PINNED_REVISION,
    "deepseekHarness.revision must equal the pinned revision",
  );
  assert(pinned?.tag === PINNED_TAG, "deepseekHarness.tag must equal the pinned tag");
  assert(
    pinned?.mcpClientVersion === PINNED_VERSION,
    "deepseekHarness.mcpClientVersion must equal the pinned mcp-client version",
  );
  if (!packageMetadata.files.includes("cordis.patch.yml")) {
    fail("cordis.patch.yml must be listed in package.json files");
  }
  await mkdir(packageDirectory, { recursive: true });
  await run(yarnExecutable, ["pack", "--out", archivePath], { cwd: repositoryRoot });
  summary.observedTarballSha256 = await sha256(archivePath);
  const publicArchivePath = await requirePrerequisite(
    "public v0.13.0 package identity",
    fetchPublicPackage,
  );
  summary.publicPackage = {
    integrity: PUBLIC_PACKAGE_INTEGRITY,
    shasum: PUBLIC_PACKAGE_SHASUM,
    observedSha256: await sha256(publicArchivePath),
  };
  const { stdout: archiveListing } = await run("tar", ["-tzf", archivePath]);
  const archiveFiles = archiveListing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\.\//u, "").replace(/^package\//u, ""));
  for (const required of ["package.json", "cordis.patch.yml", "dist/index.js", "README.md"]) {
    assert(archiveFiles.includes(required), `tarball is missing ${required}`);
  }
  const patchContent = await readFile(path.join(repositoryRoot, "cordis.patch.yml"), "utf8");
  const patchRows = yaml.parse(patchContent, {
    customTags: [{ tag: "tag:yaml.org,2002:js", resolve: (value) => ({ __jsExpr: value }) }],
  });
  const mcpRow = patchRows?.[0]?.insert?.[0];
  assert(
    mcpRow?.name === "@deepseek-ai/dsh-mcp-client",
    "patch must mount @deepseek-ai/dsh-mcp-client",
  );
  assert(mcpRow?.id === "mcp-ast", "patch row id must be mcp-ast");
  const rowConfig = mcpRow?.config;
  assert(rowConfig?.serverName === "ast", "patch serverName must be ast");
  assert(rowConfig?.transport === "stdio", "patch transport must be stdio");
  assert(rowConfig?.failOnStartupError === true, "patch must fail loud on startup errors");
  assert(rowConfig?.env?.AST_MCP_APPLY_GUARD === "deny", "patch must set AST_MCP_APPLY_GUARD=deny");
  assert(
    rowConfig?.env?.AST_MCP_TEXT_PROJECTION === "canonical_json",
    "patch must request the canonical JSON text projection",
  );
  const entrypointExpression = rowConfig?.args?.[0]?.__jsExpr ?? "";
  assert(
    entrypointExpression.includes("node_modules/ast-mcp-server/dist/index.js") &&
      entrypointExpression.includes("baseUrl"),
    "patch must resolve the entrypoint relative to baseUrl",
  );
  summary.phases.a = "ok";

  // ── Phase B: guard matrix + flow at the resolved entrypoint ────────────────
  await mkdir(consumerDirectory, { recursive: true });
  const archiveReference = `file:${archivePath.replaceAll("\\", "/")}`;
  await writeFile(
    path.join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        packageManager: "yarn@4.15.0",
        dependencies: { "ast-mcp-server": archiveReference },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(consumerDirectory, ".yarnrc.yml"),
    "nodeLinker: node-modules\nenableScripts: false\nenableTelemetry: false\n",
    "utf8",
  );
  await run(yarnExecutable, ["install", "--no-immutable"], { cwd: consumerDirectory });
  await run(yarnExecutable, ["install", "--immutable"], { cwd: consumerDirectory });

  const installedPackageRoot = path.join(consumerDirectory, "node_modules", "ast-mcp-server");
  const installedMetadata = JSON.parse(
    await readFile(path.join(installedPackageRoot, "package.json"), "utf8"),
  );
  assert(
    installedMetadata.dsh?.bundle?.patch === "./cordis.patch.yml",
    "installed dsh.bundle.patch lost",
  );
  await readFile(path.join(installedPackageRoot, "cordis.patch.yml"), "utf8");

  const resolvedEntrypoint = fileURLToPath(
    new URL(
      "node_modules/ast-mcp-server/dist/index.js",
      pathToFileURL(
        consumerDirectory.endsWith(path.sep)
          ? consumerDirectory
          : `${consumerDirectory}${path.sep}`,
      ).href,
    ),
  );
  assert(
    path.resolve(resolvedEntrypoint) ===
      path.resolve(path.join(installedPackageRoot, "dist", "index.js")),
    `entrypoint resolution mismatch: ${resolvedEntrypoint}`,
  );
  await readFile(resolvedEntrypoint, "utf8");

  await mkdir(fixtureProject, { recursive: true });
  await mkdir(path.join(fixtureProject, "src"), { recursive: true });
  await writeFile(path.join(fixtureProject, "tsconfig.json"), "{}\n", "utf8");
  await writeFile(path.join(fixtureProject, "src/value.ts"), "export const value = 1;\n", "utf8");
  await writeFile(
    path.join(fixtureProject, "src/escaped.ts"),
    `// ${'"\\'.repeat(25 * 1024)}\nexport const escaped = true;\n`,
    "utf8",
  );

  async function listTools(guardValue) {
    const childEnvironment = {
      ...process.env,
      HOME: path.join(temporaryRoot, `home-${guardValue ?? "unset"}`),
      XDG_CACHE_HOME: path.join(temporaryRoot, `cache-${guardValue ?? "unset"}`),
    };
    if (guardValue === undefined) {
      delete childEnvironment.AST_MCP_APPLY_GUARD;
    } else {
      childEnvironment.AST_MCP_APPLY_GUARD = guardValue;
    }
    const transport = new OwnedStdioClientTransport({
      command: process.execPath,
      args: [resolvedEntrypoint],
      env: childEnvironment,
      cwd: consumerDirectory,
    });
    const client = new Client({ name: "ast-dsh-adapter-smoke", version: "1.0.0" });
    let connected = false;
    try {
      await client.connect(transport);
      connected = true;
      const listed = await client.listTools();
      return listed.tools.map((tool) => tool.name).sort();
    } finally {
      await closeMcpSession(client, transport, connected);
    }
  }

  for (const guardValue of [undefined, "deny", "bogus-value"]) {
    const names = await listTools(guardValue);
    assert(
      names.length === 15,
      `guard ${String(guardValue)}: expected 15 tools, got ${names.length}`,
    );
    assert(
      !names.includes("ast_apply_operation"),
      `guard ${String(guardValue)}: ast_apply_operation must be denied`,
    );
  }
  const allowed = await listTools("allow");
  assert(allowed.length === 16, `guard allow: expected 16 tools, got ${allowed.length}`);
  assert(
    allowed.includes("ast_apply_operation"),
    "guard allow: ast_apply_operation must be present",
  );

  const failedPidPath = path.join(temporaryRoot, "failed-connect-child.pid");
  const failedSource = `const{spawn}=require("node:child_process"),{writeFileSync}=require("node:fs"),child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});child.unref();writeFileSync(process.argv[1],String(child.pid));setTimeout(()=>process.kill(process.pid,"SIGKILL"),25);`;
  const failedTransport = new OwnedStdioClientTransport({
    command: process.execPath,
    args: ["-e", failedSource, failedPidPath],
  });
  const failedClient = new Client({ name: "ast-failed-connect", version: "1.0.0" });
  const connectFailure = await failedClient.connect(failedTransport).catch((error) => error);
  assert(connectFailure instanceof Error, "failed-connect fixture unexpectedly initialized");
  await closeMcpSession(failedClient, failedTransport, false);
  assert(
    !pidExists(Number(await readFile(failedPidPath, "utf8"))),
    "failed-connect child survived",
  );

  const guardedTransport = new OwnedStdioClientTransport({
    command: process.execPath,
    args: [resolvedEntrypoint],
    env: {
      ...process.env,
      AST_MCP_APPLY_GUARD: "deny",
      HOME: path.join(temporaryRoot, "flow"),
      XDG_CACHE_HOME: path.join(temporaryRoot, "flow", "cache"),
    },
    cwd: consumerDirectory,
  });
  const guardedClient = new Client({ name: "ast-dsh-adapter-flow", version: "1.0.0" });
  let guardedConnected = false;
  try {
    await guardedClient.connect(guardedTransport);
    guardedConnected = true;
    const call = async (name, arguments_) => {
      const result = await guardedClient.callTool({ name, arguments: arguments_ });
      if (result.isError === true) {
        fail(`guarded call ${name} failed`);
      }
      return result.structuredContent;
    };
    const rawStatus = await guardedClient.callTool({
      name: "ast_get_project_status",
      arguments: { project_root: fixtureProject },
    });
    assert(rawStatus.isError !== true, "raw project-status call failed");
    assert(
      Array.isArray(rawStatus.content) && rawStatus.content.length === 0,
      "raw status text changed",
    );
    summary.rawResult = {
      structuredBytes: Buffer.byteLength(JSON.stringify(rawStatus.structuredContent)),
      structuredSha256: hashJson(rawStatus.structuredContent),
      textBlocks: rawStatus.content.length,
    };
    const prepared = await call("ast_rename_symbol", {
      project_root: fixtureProject,
      file_path: "src/value.ts",
      symbol_path: "value",
      new_name: "renamedValue",
      dry_run: true,
    });
    assert(typeof prepared.operation_id === "string", "prepare returned no operation_id");
    const preview = await call("ast_get_operation_preview", {
      operation_id: prepared.operation_id,
      file: "src/value.ts",
    });
    assert(typeof preview.plan_hash === "string", "preview returned no plan_hash");
  } finally {
    await closeMcpSession(guardedClient, guardedTransport, guardedConnected);
  }

  const supervisedTransport = new OwnedStdioClientTransport({
    command: process.execPath,
    args: [resolvedEntrypoint],
    env: {
      ...process.env,
      AST_COMPILER_WORKER_MODE: "supervised",
      AST_MCP_APPLY_GUARD: "deny",
      AST_MCP_TEXT_PROJECTION: "canonical_json",
      HOME: path.join(temporaryRoot, "supervised-flow"),
      XDG_CACHE_HOME: path.join(temporaryRoot, "supervised-flow", "cache"),
    },
    cwd: consumerDirectory,
  });
  const supervisedClient = new Client({
    name: "ast-dsh-adapter-supervised-frame",
    version: "1.0.0",
  });
  let supervisedConnected = false;
  try {
    await supervisedClient.connect(supervisedTransport);
    supervisedConnected = true;
    const supervisedNames = (await supervisedClient.listTools()).tools
      .map((tool) => tool.name)
      .sort();
    assert(supervisedNames.length === 15, "supervised deny guard did not preserve 15 tools");
    assert(
      !supervisedNames.includes("ast_apply_operation"),
      "supervised deny guard exposed ast_apply_operation",
    );
    const result = await supervisedClient.callTool({
      name: "ast_get_file",
      arguments: {
        project_root: fixtureProject,
        file_path: "src/escaped.ts",
        limit: 2,
      },
    });
    assert(result.isError !== true, "supervised projected result exceeded the worker frame");
    const marker = result.content?.[0]?.text;
    assert(
      typeof marker === "string" && marker.includes("complete projection limit"),
      "supervised projection did not exercise escape-aware frame fallback",
    );
    summary.supervisedProjection = {
      resultBytes: Buffer.byteLength(JSON.stringify(result)),
      markerSha256: createHash("sha256").update(marker).digest("hex"),
    };
  } finally {
    await closeMcpSession(supervisedClient, supervisedTransport, supervisedConnected);
  }
  summary.phases.b = "ok";

  // ── Phase C: pinned-Harness proof (mandatory) ──────────────────────────────
  const { source, cliBin, nodeBin, identity } = await requirePrerequisite(
    "pinned Harness identity",
    resolvePinnedHarness,
  );
  const mcpClientArchive = await requirePrerequisite("pinned MCP bridge artifact", () =>
    packPinnedMcpClient(source),
  );
  summary.harness = {
    ...identity,
    observedMcpClientTarballSha256: await sha256(mcpClientArchive),
  };
  await mkdir(dshHome, { recursive: true });
  const dshEnvironment = {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_TOOLS_MODE: "native",
    COREPACK_INTEGRITY_KEYS: "0",
    COREPACK_USE_LATEST: "0",
  };
  await run(nodeBin, [cliBin, "plugin", "--profile", "smoke", "add", archiveReference], {
    cwd: temporaryRoot,
    env: dshEnvironment,
  });
  // Pin the bridge itself: install the pinned mcp-client tarball so the mcp row
  // resolves the exact revision rather than an ambient package.
  await run(nodeBin, [cliBin, "plugin", "--profile", "smoke", "add", `file:${mcpClientArchive}`], {
    cwd: temporaryRoot,
    env: dshEnvironment,
  });
  const profileDir = path.join(dshHome, "profiles", "smoke");
  const nativeModePatch = "- id: tools\n  config:\n    mode: native\n";
  await writeFile(path.join(profileDir, "cordis.patch.yml"), nativeModePatch, "utf8");
  const { stdout: dumpConfig } = await run(
    nodeBin,
    [cliBin, "--profile", "smoke", "--dump-config"],
    {
      cwd: temporaryRoot,
      env: dshEnvironment,
    },
  );
  for (const required of [
    "mcp-ast",
    "name: '@deepseek-ai/dsh-mcp-client'",
    "serverName: ast",
    "transport: stdio",
    "AST_MCP_APPLY_GUARD",
    "AST_MCP_TEXT_PROJECTION",
    "node_modules/ast-mcp-server/dist/index.js",
  ]) {
    assert(dumpConfig.includes(required), `dump-config is missing ${required}`);
  }
  assert(
    /- id:\s*tools\s*\n(?:[ \t].*\n)*?[ \t]+mode:\s*native\b/mu.test(dumpConfig),
    'dump-config must contain tools.mode: "native"',
  );
  summary.effectiveToolsMode = "native";

  await writeFile(path.join(profileDir, "probe.mjs"), probeSource(), "utf8");
  await writeFile(
    path.join(profileDir, "cordis.patch.yml"),
    `${nativeModePatch}- insert:\n    - id: ast-probe\n      name: './probe.mjs'\n      inject: ['tools']\n`,
    "utf8",
  );

  const probe = await bootWithProbe(cliBin, nodeBin, dshEnvironment, fixtureProject, dshHome);
  const astNames = (probe.discovered ?? []).filter((name) => name.startsWith("mcp__ast__"));
  assert(
    astNames.length === 15,
    `harness discovered ${astNames.length} mcp__ast__ tools, expected 15`,
  );
  assert(
    probe.applyAbsent === true,
    "harness registry still exposes mcp__ast__ast_apply_operation",
  );
  assert(probe.calls?.read?.ok === true, "harness read invocation failed");
  assert(probe.calls?.prepare?.ok === true, "harness prepare invocation failed");
  assert(probe.calls?.preview?.ok === true, "harness preview invocation failed");
  assert(probe.applyRejected?.ok === true, "harness accepted a denied apply invocation");
  assert(probe.error === null, `harness probe failed: ${probe.error ?? "unknown"}`);
  summary.phases.c = "ok";

  // ── Phase D: native agent/session visibility + durable cold replay (H-01a) ──
  const harness = { source, cliBin, nodeBin };
  const expectedWorkspaceSha256 = await fixtureSha256(fixtureProject);
  const publicBaseline = await runNativeAgentJourney({
    label: "public",
    archive: publicArchivePath,
    mcpClientArchive,
    harness,
    fixtureProject,
    expectedWorkspaceSha256,
    expectUseful: false,
  });
  const correctedCandidate = await runNativeAgentJourney({
    label: "candidate",
    archive: archivePath,
    mcpClientArchive,
    harness,
    fixtureProject,
    expectedWorkspaceSha256,
    expectUseful: true,
  });
  assert(
    publicBaseline.rawStructured.normalizedSha256 ===
      correctedCandidate.rawStructured.normalizedSha256 &&
      publicBaseline.scopedCatalogSha256 === correctedCandidate.scopedCatalogSha256,
    "public and candidate journeys differ beyond the projection correction",
  );
  summary.h01a = { publicBaseline, correctedCandidate };
  summary.phases.d = "ok";
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  const remains = await lstat(temporaryRoot).then(
    () => true,
    (error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    },
  );
  assert(!remains, "temporary Harness profile/workspace state survived teardown");
}

console.log(`DSH_ADAPTER_SMOKE_OK:${JSON.stringify({ ...summary, cleanup: "ok" })}`);
