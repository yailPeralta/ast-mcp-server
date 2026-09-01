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
import { watch } from "node:fs";
// prettier-ignore
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import yaml from "yaml";
import { validateTimeoutBudget } from "./harness-timeout-budget.mjs";
// prettier-ignore
import { classifyExactHostToolError, createH03CleanupEvidence, parseProbeMarker, requireExactIdentity, runBoundedCommand, runOrderedCleanup, sanitizeDiagnosticText, terminateProcessTree } from "./runtime-process.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageMetadata = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const expectedVersion = "0.13.0";
const timeoutBudget = validateTimeoutBudget(packageMetadata.deepseekHarness?.timeoutBudget);
const yarnExecutable = process.platform === "win32" ? "yarn.cmd" : "yarn";
const PINNED_REVISION = "cd5ef8148158c3a752a658978873241fdf8e2bbc";
const PINNED_TAG = "dsh-v0.1.2-alpha.1";
const PINNED_VERSION = "0.1.2-alpha.1";
const HARNESS_REPOSITORY = "https://github.com/deepseek-ai/deepseek-harness.git";
const PUBLIC_PACKAGE_INTEGRITY =
  "sha512-vbna6hhjX+VlayTnrgWQ/EitxkBmhVza0az6J/MCpE14M4Yn50D4yTQZrrcjfCi05sVhJhWFGPnzv6VE3V9KIw==";
const PUBLIC_PACKAGE_SHASUM = "166f95121a72f0b03c325cef586a211cd9107a24";
// prettier-ignore
const PINNED_GUI_IDENTITY = Object.freeze({ webPackageSha256: "d73d37377783372f27971b0518b62c9cd1cbf03177e5ac402bb2c4fe1f42a3ec", webEntrypointSha256: "069851c0c35055baa63fbd8bca9b833f1d05a4e96613c618ff1ff0c0595c7db0", playwrightVersion: "1.61.1", playwrightPackageSha256: "6b840268612656f0639fb7d68782e8353bdf11518589d30ddf66f283c2670ed5", playwrightSourceSha256: "a0f5715ea22354f922791a9c53dc012d5d5c067ff9cc4cd35ffb7cd272071a9f", browserManifestSha256: "ee39bc924bc3d1bd895626c2910f1292d109bbfeeb5abd113acb45e1951cc942", chromiumRevision: "1228", chromiumVersion: "149.0.7827.55", chromiumSha256: "2d18db9d8608b052b6a552ee00ec1e830f93692e928b65ecc67d693bd33fe801" });
// prettier-ignore
const PINNED_H05_PROFILE_SHA256 = Object.freeze({ native: "b807c75f27ddebf98a128207177dced8e025aaf78592f0eb951338831fe00600", web: "742f534cac58cbbf9a527fc988cefe4d82b6f0bbc782a03a5377db55e8e2356d", nativeTempRoots: 1, webTempRoots: 2 });
const H01_TOOL_NAME = "mcp__ast__ast_get_project_status";
// prettier-ignore
const H03_COMPRESSED_BUDGET = validateTimeoutBudget({ queueWaitMs: 100, executionDeadlineMs: 1000, marginMs: 100, outerToolCallMs: 1500 });
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

// prettier-ignore
function canonicalH05Profile(content, { controlDirectory, nonce, ownerToken, tempRoot, tempRoots }) { let canonical = content; for (const [value, marker, count] of [[controlDirectory, "<CONTROL>", 1], [nonce, "<NONCE>", 1], [ownerToken, "<OWNER>", 2], [tempRoot, "<TEMP>", tempRoots]]) { const observed = canonical.split(value).length - 1; assert(observed === count, `H-05 profile binding ${marker} diverged (${observed}/${count})`); canonical = canonical.replaceAll(value, marker); } return canonical; }

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
  requireExactIdentity({ hostRevision: head }, { hostRevision: PINNED_REVISION });
  const taggedRevision = (
    await run("git", ["-C", source, "rev-list", "-n", "1", PINNED_TAG])
  ).stdout.trim();
  requireExactIdentity({ hostTagRevision: taggedRevision }, { hostTagRevision: PINNED_REVISION });
  const cliBin = path.join(source, "apps", "cli", "lib", "bin.js");
  const cliVersion = (await run(nodeBin, [cliBin, "--version"])).stdout.trim();
  requireExactIdentity({ hostCliVersion: cliVersion }, { hostCliVersion: PINNED_VERSION });
  const mcpClientVersion = (
    await run(nodeBin, [
      "-p",
      `require(${JSON.stringify(
        path.join(source, "packages", "mcp", "mcp-client", "package.json"),
      )}).version`,
    ])
  ).stdout.trim();
  requireExactIdentity({ bridgeVersion: mcpClientVersion }, { bridgeVersion: PINNED_VERSION });
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
    requireExactIdentity({ hostTagRevision: tag }, { hostTagRevision: PINNED_REVISION });
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

// prettier-ignore
async function awaitChildExit(child, timeoutMs = 30_000) { if (child.exitCode !== null || child.signalCode !== null) return; await new Promise((resolve, reject) => { const deadline = setTimeout(() => reject(new Error("Harness shutdown budget expired")), timeoutMs); child.once("exit", () => { clearTimeout(deadline); resolve(); }); }); }

async function assertNoTransientResidue(...roots) {
  const residue = [];
  const walk = async (root) => {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (
        entry.isSocket() ||
        (/(?:\.sock|\.lock|\.tmp|\.next)$/u.test(entry.name) &&
          !["uv.lock", "yarn.lock"].includes(entry.name))
      )
        residue.push(target);
    }
  };
  for (const root of roots) await walk(root);
  assert(residue.length === 0, `H-05 transient residue survived shutdown: ${residue.join(",")}`);
}

// prettier-ignore
async function waitForJsonLine(filePath, predicate, timeoutMs = 30_000) { return new Promise((resolve, reject) => { let observer; const deadline = setTimeout(() => finish(new Error(`event barrier expired for ${path.basename(filePath)}`)), timeoutMs); const finish = (error, value) => { clearTimeout(deadline); observer?.close(); if (error) reject(error); else resolve(value); }; const check = async () => { const lines = await readFile(filePath, "utf8").then((text) => text.trim().split("\n").filter(Boolean), () => []); for (const line of lines) { const value = JSON.parse(line); if (predicate(value)) return finish(undefined, value); } }; observer = watch(path.dirname(filePath), { persistent: false }, () => void check().catch(finish)); void check().catch(finish); }); }

// prettier-ignore
async function launchPinnedWeb(cliBin, nodeBin, environment) { const child = spawn(nodeBin, [cliBin, "web", "--no-open", "--host", "127.0.0.1", "--port", "0"], { cwd: temporaryRoot, env: environment, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" }); let output = "", readiness = ""; const launchUrl = await new Promise((resolve, reject) => { const deadline = setTimeout(() => reject(new Error("pinned Web readiness deadline expired")), 90_000); const inspect = (chunk) => { const text = String(chunk); output = `${output}${text}`.slice(-100_000); readiness = `${readiness}${text}`.slice(-2048); const match = /dsh web: (http:\/\/[^\s]+)/u.exec(readiness); if (match?.[1]) { readiness = ""; clearTimeout(deadline); resolve(match[1]); } }; child.stdout.on("data", inspect); child.stderr.on("data", inspect); child.once("error", reject); child.once("exit", (code) => reject(new Error(`pinned Web exited before readiness (${String(code)})`))); }).catch(async (error) => { readiness = ""; await terminateProcessTree(child); throw error; }); return { child, launchUrl, output: () => sanitizeDiagnosticText(output) }; }

/** Boot the profile with the probe plugin and return its DSH_PROBE_RESULT marker. */
async function bootWithProbe(
  cliBin,
  nodeBin,
  environment,
  fixtureProject,
  dshHome,
  graceful = false,
) {
  const child = spawn(nodeBin, [cliBin, "--profile", "smoke", "probe"], {
    cwd: temporaryRoot,
    env: { ...environment, AST_PROBE_PROJECT_ROOT: fixtureProject, DSH_HOME: dshHome },
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
  });
  let stderr = "";
  let shutdownRequested = false;
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (graceful && !shutdownRequested && stderr.includes("DSH_SHUTDOWN_ARMED\n")) {
      shutdownRequested = true;
      child.kill("SIGTERM");
    }
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
    const rawMarker = /DSH_PROBE_RESULT:(\{.*\})\n/u.exec(stderr)?.[0] ?? "";
    if (graceful) {
      const ownedPids = await collectOwnedProcessTree(child.pid);
      child.kill("SIGTERM"); // Reject any process still live after its shutdown result.
      await awaitChildExit(child);
      assert(
        child.exitCode === 0 || marker.error !== null,
        "Harness lifecycle probe did not shut down cleanly",
      );
      assert(
        ownedPids.every((pid) => !pidExists(pid)),
        "Harness lifecycle process tree survived shutdown",
      );
    }
    return { ...marker, rawMarkerSha256: createHash("sha256").update(rawMarker).digest("hex") };
  } finally {
    await terminateProcessTree(child);
  }
}

/** The probe plugin: exercises every promised tool class through the Harness registry. */
function probeSource() {
  return `export default function apply(ctx) {
  const projectRoot = process.env.AST_PROBE_PROJECT_ROOT;
  const deadline = Date.now() + 30000;
  const marker = { discovered: [], applyAbsent: null, calls: {}, exploreSchema: null, invalidExplore: [], applyRejected: null, error: null };
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
      const schemas = ctx.tools.schemas();
      const ast = schemas.filter((schema) => schema.name.startsWith("mcp__ast__"));
      if (ast.length > 0) {
        marker.discovered = ast.map((schema) => schema.name).sort();
        marker.exploreSchema = ast.find((schema) => schema.name === "mcp__ast__ast_explore")?.parameters;
        marker.applyAbsent = !marker.discovered.includes("mcp__ast__ast_apply_operation");
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
          for (const [callId, arguments_] of [
            ["probe-invalid-route", { project_root: projectRoot }],
            ["probe-invalid-symbol", { project_root: projectRoot, query: "value", symbol_path: "value" }],
            ["probe-invalid-spines", { project_root: projectRoot, query: "value", call_spines: {} }],
          ]) {
            const invalidExplore = await ctx.tools.execute({
              callId,
              name: "mcp__ast__ast_explore",
              arguments: arguments_,
              signal: AbortSignal.timeout(10000),
            });
            marker.invalidExplore.push(invalidExplore.isError === true);
          }
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

function h05ProbeSource() {
  return `import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, renameSync, watch, writeFileSync } from "node:fs";
import path from "node:path";
export default function apply(ctx) {
  const root = process.env.AST_PROBE_PROJECT_ROOT, control = process.env.AST_H05_CONTROL_DIRECTORY;
  const nonce = process.env.AST_H05_NONCE, ownerToken = process.env.AST_H05_OWNER_TOKEN;
  const patchPath = process.env.AST_H05_PATCH_PATH, enablePatch = Buffer.from(process.env.AST_H05_ENABLE_PATCH, "base64").toString();
  const marker = { scenario: "native-session-cancel/hmr-15-0-15/shutdown", error: null };
  const events = () => { try { return readFileSync(path.join(control, "events.jsonl"), "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse); } catch { return []; } };
  const astSchemas = () => ctx.tools.schemas().filter((tool) => tool.name.startsWith("mcp__ast__")).sort((a, b) => a.name.localeCompare(b.name));
  const fail = (message) => { throw new Error(message); };
  const atomicReplace = (content) => { const next = patchPath + ".next"; writeFileSync(next, content); renameSync(next, patchPath); };
  const refreshPatch = (content) => { atomicReplace(content); const registrations = [...(ctx.get("hmr")?.configs?.values() ?? [])]; if (registrations.length === 0) fail("H-05 HMR registration is absent"); for (const registration of registrations) registration.watcher.emit("change", patchPath); };
  const writeCommand = (callId, fixtureId, mode, correlationId) => { const command = Object.freeze({ callId, correlationId, fixtureId, mode, nonce, ownerToken }); writeFileSync(path.join(control, "command.json"), JSON.stringify(command)); return command; };
  const ownerPids = () => process.platform !== "linux" ? [] : readdirSync("/proc").filter((name) => /^\\d+$/.test(name)).filter((name) => { try { return readFileSync("/proc/" + name + "/environ", "utf8").split("\\0").includes("AST_H01_PROCESS_OWNER=" + ownerToken); } catch { return false; } }).map(Number).sort((a, b) => a - b);
  const awaitOwnerExit = (owned) => new Promise((resolve, reject) => { let deadline; const finish = (error) => { clearTimeout(deadline); process.off("SIGCHLD", check); error ? reject(error) : resolve(); }; const check = () => { if (owned.every((pid) => !ownerPids().includes(pid))) finish(); }; deadline = setTimeout(() => finish(new Error("H-05 owner-exit barrier expired")), 15000); process.on("SIGCHLD", check); check(); });
  const waitEvent = (predicate) => new Promise((resolve, reject) => { let observer; const deadline = setTimeout(() => { observer?.close(); reject(new Error("H-05 event barrier expired")); }, 15000); const check = () => { const found = events().find(predicate); if (!found) return; clearTimeout(deadline); observer?.close(); resolve(found); }; observer = watch(control, { persistent: false }, check); check(); });
  const awaitCatalog = (count) => new Promise((resolve, reject) => { let stop, checking = false; const deadline = setTimeout(() => { stop?.(); reject(new Error("H-05 catalog barrier expired " + count + "/" + astSchemas().length)); }, 30000); const check = async () => { if (checking || astSchemas().length !== count) return; checking = true; try { const refreshes = [...(ctx.get("hmr")?.refreshTasks ?? [])]; if (refreshes.length) await Promise.all(refreshes); await ctx.loader.await(); const schemas = astSchemas(); if (schemas.length !== count) return; clearTimeout(deadline); stop?.(); resolve(schemas); } catch (error) { reject(error); } finally { checking = false; } }; stop = ctx.on("tools/change", () => void check()); void check(); });
  const awaitRetirementStart = () => new Promise((resolve, reject) => { let stop; const deadline = setTimeout(() => { stop?.(); reject(new Error("H-05 retirement-start barrier expired")); }, 15000); const check = () => { if (astSchemas().length >= 15) return; clearTimeout(deadline); stop?.(); resolve(); }; stop = ctx.on("tools/change", check); check(); });
  const execute = (callId, agent) => ctx.tools.execute({ callId, name: ${JSON.stringify(H01_TOOL_NAME)}, arguments: { project_root: agent ? agent.session.header.cwd : root }, signal: new AbortController().signal, ...(agent ? { agent } : {}) });
  const assertSessionIdentity = (handle, sessionId) => { const agent = handle.agent, observed = { sessionId: agent.id === agent.session.id ? agent.session.id : "", provider: agent.options.provider, model: agent.options.model, cwd: agent.session.header.cwd }, expected = { sessionId, provider: "deepseek-official", model: "deepseek-v4-flash", cwd: root }; if (JSON.stringify(observed) !== JSON.stringify(expected)) fail("Agent/Session identity diverged"); };
  const createSession = async (sessionId) => { const handle = await ctx.agents.create({ sessionId, meta: { cwd: root }, agentOptions: { provider: "deepseek-official", model: "deepseek-v4-flash" } }); assertSessionIdentity(handle, sessionId); return handle; };
  const prompt = (handle) => handle.agent.followup(Object.freeze({ id: randomUUID(), role: "user", content: [Object.freeze({ type: "text", text: "Inspect project status." })], source: Object.freeze({ kind: "user" }) }));
  const durableResults = (handle, callId) => handle.agent.session.events.filter((event) => event.type === "tool/result" && event.data.message.source.callId === callId);
  const fixtureErrors = (expected) => events().filter((event) => event.callId === expected.callId && event.fixtureId === expected.fixtureId && event.generation === expected.generation && event.phase === "error");
  const findPublicError = (value) => { if (typeof value === "string") { try { return findPublicError(JSON.parse(value)); } catch { return; } } if (Array.isArray(value)) { for (const item of value) { const found = findPublicError(item); if (found) return found; } } else if (value && typeof value === "object") { if (value.error?.code && typeof value.error.correlation_id === "string") return value.error; for (const key of ["structuredContent", "content", "text", "value", "error", "message"]) { const found = findPublicError(value[key]); if (found) return found; } } };
  const classifyTransport = (result, callId) => { const encoded = JSON.stringify(result), text = result?.content?.[0]?.text ?? result?.[0]?.content?.[0]?.text ?? "", observed = result?.error?.info?.code ?? (/abort/iu.test(text) ? "ABORTED" : /timeout/iu.test(text) ? "TIMEOUT" : "OTHER"), code = typeof observed === "string" && /^[A-Z][A-Z0-9_-]{0,63}$/u.test(observed) ? observed : "OTHER"; return Object.freeze({ surface: "transport", code, bytes: Buffer.byteLength(encoded), callId, authoritativeAstTerminal: false }); };
  const assertTerminalIdentity = (expected, command, evidenceRows, nativeRows, durableRows) => { const evidence = evidenceRows[0], astAuthority = findPublicError(evidence.result), terminalOrigins = [command.callId === expected.callId, command.fixtureId === expected.fixtureId, command.correlationId === expected.correlationId, command.ownerToken === ownerToken, expected.ownerToken === ownerToken, evidence.callId === expected.callId, evidence.fixtureId === expected.fixtureId, evidence.generation === expected.generation, evidence.correlationId === expected.correlationId, evidence.ownerToken === command.ownerToken, evidence.ownerToken === expected.ownerToken, nativeRows[0]?.exec.arguments.project_root === nativeRows[0]?.exec.agent?.session.header.cwd], rejectedAstCodes = ["ABORTED", "ABORTED_BEFORE_DISPATCH", "OPERATION_DEADLINE_EXCEEDED"]; if (evidenceRows.length !== 1 || nativeRows.length !== 1 || nativeRows[0].exec.callId !== expected.callId || nativeRows[0].result.isError !== true || durableRows.length !== 1 || durableRows[0].data.message.source.callId !== expected.callId || !terminalOrigins.every(Boolean) || !astAuthority || astAuthority.code !== "REQUEST_CANCELLED" || astAuthority.correlation_id !== expected.correlationId || rejectedAstCodes.includes(astAuthority.code)) fail("AST authority/join " + JSON.stringify({ e: evidenceRows.length, n: nativeRows.length, d: durableRows.length, origin: terminalOrigins, ast: astAuthority })); const encoded = JSON.stringify({ native: nativeRows[0].result, durable: durableRows[0].data.message.content }); if (Buffer.byteLength(encoded) > 4096 || /Bearer |api-key|token=|ownerToken|nonce|stack|\\/home\\//i.test(encoded)) fail("terminal evidence was unbounded or sensitive"); return Object.freeze({ astAuthority, native: { ...classifyTransport(nativeRows[0].result, nativeRows[0].exec.callId), astCorrelationId: astAuthority.correlation_id }, durable: { ...classifyTransport(durableRows[0].data.message.content, durableRows[0].data.message.source.callId), astCorrelationId: astAuthority.correlation_id } }); };
  const assertNoRetiredEffects = (handle, readNative) => { const retiredEvents = events().filter((event) => event.fixtureId === "retire"), retiredDurable = durableResults(handle, "h05-retire"), retiredNative = readNative(); if (retiredNative.length !== 1 || retiredNative.some((row) => row.result.isError !== true) || retiredDurable.length !== 0 || retiredEvents.some((event) => event.outcome === "succeeded") || retiredEvents.filter((event) => event.phase === "terminal").length !== 1 || new Set(retiredEvents.map(JSON.stringify)).size !== retiredEvents.length) fail("retired generation published a late, duplicate, or durable effect"); };
  if (process.env.AST_H05_GUI_CONTROL === "1") {
    const eventPath = path.join(control, "gui-events.jsonl"), commandPath = path.join(control, "gui-command.json"); let activeId;
    const publish = (id, schemas) => writeFileSync(eventPath, JSON.stringify({ id, count: schemas.length, names: schemas.map((tool) => tool.name) }) + "\\n", { flag: "a" });
    const command = async () => { let value; try { value = JSON.parse(readFileSync(commandPath, "utf8")); } catch { return; } if (value.id === activeId) return; activeId = value.id; const converged = awaitCatalog(value.count); atomicReplace(Buffer.from(value.patch, "base64").toString()); for (const registration of [...(ctx.get("hmr")?.configs?.values() ?? [])]) registration.watcher.emit("change", patchPath); await ctx.loader.await(); publish(value.id, await converged); };
    const observer = watch(control, { persistent: false }, () => void command().catch((error) => writeFileSync(eventPath, JSON.stringify({ error: String(error).slice(0, 240) }) + "\\n", { flag: "a" })));
    ctx.effect(() => () => observer.close()); void ctx.loader.await().then(() => publish("ready", astSchemas())); return;
  }
  const native = [], shutdownNative = [], catalogHistory = [], bridgeToolResults = [], bridgeAbortResults = [];
  const captureBridge = (handle) => { const scoped = handle.agent.scope.ctx, stopNative = scoped.on("tools/result", (exec, result) => native.push({ exec, result })), stopExecute = scoped.on("tools/execute", async (exec, next) => { const result = await next(); if (exec.callId === "mock-call-1") bridgeToolResults.push({ exec, result, signalAborted: exec.signal.aborted }); return result; }), stopPost = scoped.on("tools/post-execute", async (exec, result, next) => { if (exec.callId === "mock-call-1") bridgeAbortResults.push({ exec, result, signalAborted: exec.signal.aborted }); return next(); }); return () => { stopPost(); stopExecute(); stopNative(); }; };
  const stopResult = ctx.on("tools/result", (exec, result) => { if (exec.callId === "h05-fresh") native.push({ exec, result }); });
  const stopCatalog = ctx.on("tools/change", () => catalogHistory.push(astSchemas().map((tool) => tool.name)));
  let shutdownHandle, shutdownExpected, shutdownCommand, shutdownTerminal, shutdownResources, resolveShutdownNative;
  const shutdownResultHooks = ctx.events._hooks["tools/result"] ||= [], shutdownResultObserver = { ctx: ctx.root, global: true, callback: (exec, result) => { if (shutdownExpected && exec.callId === shutdownExpected.callId) { shutdownNative.push({ exec, result }); resolveShutdownNative?.(); } } }; shutdownResultHooks.push(shutdownResultObserver);
  const shutdownStopResult = () => ctx.events.unregister(shutdownResultHooks, shutdownResultObserver.callback);
  const waitShutdownNative = () => new Promise((resolve, reject) => { if (shutdownNative.length) return resolve(); const deadline = setTimeout(() => reject(new Error("H-05 shutdown native-result barrier expired")), 15000); resolveShutdownNative = () => { clearTimeout(deadline); resolve(); }; });
  const shutdownHook = ctx.effect(() => async () => { try {
    if (!shutdownHandle) return;
    await shutdownHandle.dispose();
    await waitEvent((event) => event.callId === shutdownExpected.callId && event.fixtureId === shutdownExpected.fixtureId && event.generation === shutdownExpected.generation && event.phase === "error"); await waitShutdownNative();
    const shutdownErrors = fixtureErrors(shutdownExpected), shutdownDurable = durableResults(shutdownHandle, shutdownExpected.callId);
    assertTerminalIdentity(shutdownExpected, shutdownCommand, shutdownErrors, shutdownNative, shutdownDurable); shutdownTerminal = shutdownErrors[0];
    shutdownResources = shutdownTerminal.resources;
    if (!shutdownResources || [shutdownResources.active, shutdownResources.held, shutdownResources.abortListeners, shutdownResources.staleSettlements, shutdownResources.timers].some((value) => value !== 0)) fail("shutdown fixture resources did not converge to zero");
    Object.assign(marker, { shutdownTerminal: { callId: shutdownTerminal.callId, code: shutdownTerminal.result.error.code, correlationId: shutdownTerminal.result.error.correlation_id }, readback: shutdownResources });
    process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n");
  } catch (error) { marker.error = String(error).slice(0, 240); process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n"); throw error; } finally { shutdownStopResult(); stopResult(); stopCatalog(); } });
  async function run() {
    await ctx.loader.await();
    const baselineSchemas = astSchemas();
    if (baselineSchemas.length !== 15 || new Set(baselineSchemas.map((tool) => tool.name)).size !== 15) fail("baseline catalog is not unique guarded-15"); catalogHistory.length = 0;
    const handle = await createSession("h05-native-cancel"), stopCancelBridge = captureBridge(handle), cancelExpected = Object.freeze({ callId: "mock-call-1", correlationId: "00000000-0000-4000-8000-000000000001", fixtureId: "user-cancel", generation: 1, ownerToken });
    const cancelCommand = writeCommand(cancelExpected.callId, cancelExpected.fixtureId, "hold", cancelExpected.correlationId); prompt(handle);
    await waitEvent((event) => event.callId === cancelExpected.callId && event.phase === "started"); handle.agent.cancel({ kind: "user" }); await handle.agent.whenIdle();
    await waitEvent((event) => event.callId === cancelExpected.callId && event.fixtureId === cancelExpected.fixtureId && event.generation === cancelExpected.generation && event.phase === "error"); const cancelErrors = fixtureErrors(cancelExpected), astCancel = cancelErrors[0], cancelNative = native.filter((row) => row.exec.agent === handle.agent), cancelDurable = durableResults(handle, cancelExpected.callId);
    const agentAbortReason = handle.agent.session.events.findLast((event) => event.type === "turn/end")?.data.reason;
    if (JSON.stringify(agentAbortReason) !== JSON.stringify({ kind: "aborted", reason: { kind: "user" } })) fail("Agent turn/end did not retain user abort reason");
    // Signal rejection and MCP isError text reduction are distinct transport observations.
    const cancelEvidence = assertTerminalIdentity(cancelExpected, cancelCommand, cancelErrors, cancelNative, cancelDurable), bridgeTool = classifyTransport(bridgeToolResults[0]?.result, bridgeToolResults[0]?.exec.callId), bridgeAbort = classifyTransport(bridgeAbortResults[0]?.result, bridgeAbortResults[0]?.exec.callId), transportRows = [bridgeAbort, bridgeTool, cancelEvidence.native, cancelEvidence.durable]; if (bridgeToolResults.length !== 1 || bridgeAbortResults.length !== 1 || bridgeToolResults[0].signalAborted !== true || bridgeAbortResults[0].signalAborted !== true || transportRows.some((row) => !row || row.callId !== cancelExpected.callId || row.bytes < 1 || row.bytes > 4096 || row.authoritativeAstTerminal !== false || !/^[A-Z][A-Z0-9_-]{0,63}$/u.test(row.code)) || /Bearer |api-key|token=|ownerToken|nonce|stack|\\/home\\//i.test(JSON.stringify([bridgeToolResults[0].result, bridgeAbortResults[0].result]))) fail("actual transport evidence diverged"); stopCancelBridge(); await handle.dispose();

    const retireHandle = await createSession("h05-native-retire"), retireCommand = writeCommand("h05-retire", "retire", "hold", "00000000-0000-4000-8000-000000000002"), retirePending = execute("h05-retire", retireHandle.agent);
    await waitEvent((event) => event.fixtureId === retireCommand.fixtureId && event.phase === "started");
    const stopRetireNative = retireHandle.agent.scope.ctx.on("tools/result", (exec, result) => native.push({ exec, result })), oldOwnerPids = ownerPids(), retiring = awaitRetirementStart(), removed = awaitCatalog(0); refreshPatch("- id: mcp-ast\\n  disabled: true\\n"); await retiring; const retireSettled = await retirePending; await removed; await awaitOwnerExit(oldOwnerPids);
    const readNative = () => native.filter((row) => row.exec.callId === retireCommand.callId); assertNoRetiredEffects(retireHandle, readNative);
    if (retireSettled.isError !== true || oldOwnerPids.length === 0 || ownerPids().length !== 0) fail("old producer or owner did not actively settle at retirement");
    const stale = await execute("h05-stale"); if (stale.isError !== true || stale.error?.info?.code !== "UNKNOWN_TOOL") fail("stale invocation was not UNKNOWN_TOOL");

    const reconnected = awaitCatalog(15); refreshPatch(enablePatch); const freshSchemas = await reconnected, freshOwnerPids = ownerPids();
    if (freshSchemas.length !== 15 || new Set(freshSchemas.map((tool) => tool.name)).size !== 15 || JSON.stringify(freshSchemas) !== JSON.stringify(baselineSchemas) || freshOwnerPids.length === 0 || freshOwnerPids.some((pid) => oldOwnerPids.includes(pid))) fail("fresh generation did not publish one unique schema-identical catalog");
    writeCommand("h05-fresh", "fresh", "pass", "00000000-0000-4000-8000-000000000003"); if ((await execute("h05-fresh")).isError === true || native.filter((row) => row.exec.callId === "h05-fresh").length !== 1 || catalogHistory.some((catalog) => new Set(catalog).size !== catalog.length) || catalogHistory.filter((catalog, index) => catalog.length === 0 && catalogHistory[index - 1]?.length !== 0).length !== 1 || catalogHistory.filter((catalog, index) => catalog.length === 15 && catalogHistory[index - 1]?.length !== 15).length !== 1) fail("fresh generation duplicated or re-registered lifecycle surfaces");
    assertNoRetiredEffects(retireHandle, readNative); stopRetireNative(); await retireHandle.dispose();

    shutdownHandle = await createSession("h05-native-shutdown"); shutdownExpected = Object.freeze({ callId: "mock-call-1", correlationId: "00000000-0000-4000-8000-000000000006", fixtureId: "shutdown", generation: 1, ownerToken });
    shutdownCommand = writeCommand(shutdownExpected.callId, shutdownExpected.fixtureId, "hold", shutdownExpected.correlationId); prompt(shutdownHandle);
    await waitEvent((event) => event.fixtureId === shutdownExpected.fixtureId && event.phase === "started");
    Object.assign(marker, { transport: { bridgeAbort: { ...bridgeAbort, acknowledged: bridgeAbortResults[0].signalAborted }, bridgeTool: { ...bridgeTool, acknowledged: bridgeToolResults[0].signalAborted }, native: cancelEvidence.native, durable: cancelEvidence.durable }, agentAbortReason, astTerminal: { callId: astCancel.callId, fixtureId: astCancel.fixtureId, generation: astCancel.generation, ownerObserved: astCancel.ownerToken === ownerToken, code: astCancel.result.error.code, correlationId: astCancel.result.error.correlation_id }, catalogs: [baselineSchemas.length, 0, freshSchemas.length], oldOwnerPids, freshOwnerPids });
    process.stderr.write("DSH_SHUTDOWN_ARMED\\n");
  }
  void run().catch((error) => { marker.error = String(error).slice(0, 240); process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n"); });
}
`;
}

function h03ProbeSource() {
  return `import { readFileSync, watch, writeFileSync } from "node:fs";
import path from "node:path";
export default function apply(ctx) {
  const root = process.env.AST_PROBE_PROJECT_ROOT, control = process.env.AST_H03_CONTROL_DIRECTORY, nonce = process.env.AST_H03_NONCE;
  const eventPath = path.join(control, "events.jsonl"), marker = { scenario: "cold-deadline/queued-no-late-start/recycle-stale-generation", calls: {}, events: [], error: null };
  const events = () => { try { return readFileSync(eventPath, "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse); } catch { return []; } };
  const command = (callId, fixtureId, mode) => writeFileSync(path.join(control, "command.json"), JSON.stringify({ callId, fixtureId, mode, nonce }));
  const waitEvent = (predicate) => new Promise((resolve, reject) => { const check = () => { const found = events().find(predicate); if (found) { clearTimeout(timer); observer.close(); resolve(found); } }; const observer = watch(control, { persistent: false }, check); const timer = setTimeout(() => { observer.close(); reject(new Error("H-03 event budget expired")); }, 10000); check(); });
  const execute = (callId, signal) => ctx.tools.execute({ callId, name: ${JSON.stringify(H01_TOOL_NAME)}, arguments: { project_root: root }, signal });
  const waitTool = () => new Promise((resolve, reject) => { let stop; const timer = setTimeout(() => { stop?.(); reject(new Error("H-03 tool discovery budget expired")); }, 30000); const check = () => { if (!ctx.tools.schemas().some((tool) => tool.name === ${JSON.stringify(H01_TOOL_NAME)})) return; clearTimeout(timer); stop?.(); resolve(); }; stop = ctx.on("tools/change", check); check(); });
  async function run() {
    await waitTool(); command("h03-cold", "cold", "hold"); marker.calls.cold = await execute("h03-cold", new AbortController().signal);
    command("h03-blocker", "blocker", "hold"); const blocker = execute("h03-blocker", new AbortController().signal);
    await waitEvent((event) => event.fixtureId === "blocker" && event.phase === "started"); command("h03-queued", "queued", "hold"); marker.calls.queued = await execute("h03-queued", new AbortController().signal); marker.calls.blocker = await blocker;
    await waitEvent((event) => event.fixtureId === "blocker" && event.phase === "terminal"); command("h03-warm", "warm", "pass"); marker.calls.warm = await execute("h03-warm", new AbortController().signal);
    const warm = await waitEvent((event) => event.fixtureId === "warm" && event.phase === "started"); await waitEvent((event) => event.phase === "recycled" && event.generation === warm.generation);
    const recycleAbort = new AbortController(); command("h03-recycle", "recycle", "hold"); const recycle = execute("h03-recycle", recycleAbort.signal); const recycled = await waitEvent((event) => event.fixtureId === "recycle" && event.phase === "started");
    if (recycled.generation !== warm.generation + 1) throw new Error("stale worker generation started"); recycleAbort.abort(); marker.callerAbortAcknowledged = (await recycle).isError === true;
    await waitEvent((event) => event.fixtureId === "recycle" && event.phase === "terminal"); await waitEvent((event) => event.fixtureId === "recycle" && event.phase === "error");
    command("h03-readback", "readback", "readback"); marker.calls.readback = await execute("h03-readback", new AbortController().signal); marker.events = events();
    process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n"); ctx.get("appExit")?.(0);
  }
  void run().catch((error) => { marker.error = String(error).slice(0, 240); process.stderr.write("DSH_PROBE_RESULT:" + JSON.stringify(marker) + "\\n"); ctx.get("appExit")?.(1); });
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
    const astTools = tools
      .filter((tool) => tool?.function?.name?.startsWith("mcp__ast__"))
      .sort((left, right) => left.function.name.localeCompare(right.function.name));
    const astNames = astTools.map((tool) => tool.function.name);
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
    const exploreParameters = astTools.find(
      (tool) => tool.function.name === "mcp__ast__ast_explore",
    )?.function.parameters;
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
      schemaEvidence: {
        catalogSha256: hashJson(astTools),
        unaffectedSha256: hashJson(
          astTools.filter((tool) => tool.function.name !== "mcp__ast__ast_explore"),
        ),
        exploreSha256: hashJson(exploreParameters),
        exploreRequired: exploreParameters?.required ?? [],
        exploreProperties: Object.keys(exploreParameters?.properties ?? {}).sort(),
      },
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
  requireExactIdentity({ astVersion: packageMetadata.version }, { astVersion: expectedVersion });
  if (JSON.stringify(packageMetadata.dsh) !== '{"bundle":{"patch":"./cordis.patch.yml"}}') {
    fail(`package.json must declare exactly "dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`);
  }
  const pinned = packageMetadata.deepseekHarness;
  requireExactIdentity(
    {
      hostRevision: pinned?.revision,
      hostTag: pinned?.tag,
      bridgeVersion: pinned?.mcpClientVersion,
    },
    {
      hostRevision: PINNED_REVISION,
      hostTag: PINNED_TAG,
      bridgeVersion: PINNED_VERSION,
    },
  );
  assert(timeoutBudget.outerToolCallMs === 180_000, "shipped outer timeout budget changed");
  summary.timeoutBudget = timeoutBudget;
  if (!packageMetadata.files.includes("cordis.patch.yml")) {
    fail("cordis.patch.yml must be listed in package.json files");
  }
  await mkdir(packageDirectory, { recursive: true });
  await run(yarnExecutable, ["pack", "--out", archivePath], { cwd: repositoryRoot });
  summary.observedTarballSha256 = await sha256(archivePath);
  const expectedAstTarballSha256 = summary.observedTarballSha256;
  const expectedAdapterSha256 = await sha256(path.join(repositoryRoot, "cordis.patch.yml"));
  const expectedAstEntrypointSha256 = createHash("sha256")
    .update((await run("tar", ["-xOzf", archivePath, "package/dist/index.js"])).stdout)
    .digest("hex");
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

  let directExploreSchema;
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
    directExploreSchema = (await guardedClient.listTools()).tools.find(
      (tool) => tool.name === "ast_explore",
    )?.inputSchema;
    assert(directExploreSchema !== undefined, "direct MCP omitted ast_explore schema");
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
  const expectedHostCliSha256 = identity.observedCliSha256;
  const expectedBridgeTarballSha256 = await sha256(mcpClientArchive);
  const expectedNodeVersion = identity.nodeVersion;
  const expectedNodeSha256 = identity.observedNodeSha256;
  summary.harness = {
    ...identity,
    observedMcpClientTarballSha256: expectedBridgeTarballSha256,
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
  assert(
    probe.invalidExplore?.length === 3 && probe.invalidExplore.every(Boolean),
    "harness accepted an invalid ast_explore invocation",
  );
  assert(probe.applyRejected?.ok === true, "harness accepted a denied apply invocation");
  assert(probe.error === null, `harness probe failed: ${probe.error ?? "unknown"}`);
  summary.phases.c = "ok";

  // Restore and independently re-resolve the normative pre-fixture configuration.
  await writeFile(path.join(profileDir, "cordis.patch.yml"), nativeModePatch, "utf8");
  const observedDumpConfig = (
    await run(nodeBin, [cliBin, "--profile", "smoke", "--dump-config"], {
      cwd: temporaryRoot,
      env: dshEnvironment,
    })
  ).stdout;
  const observedBridgeMetadata = JSON.parse(
    await readFile(path.join(source, "packages", "mcp", "mcp-client", "package.json"), "utf8"),
  );
  const exactIdentity = {
    hostRevision: (await run("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim(),
    hostTag: (
      await run("git", ["-C", source, "describe", "--tags", "--exact-match", "HEAD"])
    ).stdout.trim(),
    hostCliVersion: (await run(nodeBin, [cliBin, "--version"])).stdout.trim(),
    hostCliSha256: await sha256(cliBin),
    bridgeVersion: observedBridgeMetadata.version,
    bridgeSourceRevision: (await run("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim(),
    bridgeTarballSha256: await sha256(mcpClientArchive),
    astVersion: installedMetadata.version,
    astTarballSha256: await sha256(archivePath),
    astEntrypointSha256: await sha256(resolvedEntrypoint),
    adapterSha256: await sha256(path.join(installedPackageRoot, "cordis.patch.yml")),
    effectiveConfigSha256: createHash("sha256").update(observedDumpConfig).digest("hex"),
    nodeVersion: (await run(nodeBin, ["--version"])).stdout.trim(),
    nodeSha256: await sha256(nodeBin),
    nativeMode: /[ \t]+mode:\s*native\b/mu.test(observedDumpConfig) ? "native" : "",
  };
  const expectedIdentity = {
    hostRevision: PINNED_REVISION,
    hostTag: PINNED_TAG,
    hostCliVersion: PINNED_VERSION,
    hostCliSha256: expectedHostCliSha256,
    bridgeVersion: PINNED_VERSION,
    bridgeSourceRevision: PINNED_REVISION,
    bridgeTarballSha256: expectedBridgeTarballSha256,
    astVersion: expectedVersion,
    astTarballSha256: expectedAstTarballSha256,
    astEntrypointSha256: expectedAstEntrypointSha256,
    adapterSha256: expectedAdapterSha256,
    effectiveConfigSha256: createHash("sha256").update(dumpConfig).digest("hex"),
    nodeVersion: expectedNodeVersion,
    nodeSha256: expectedNodeSha256,
    nativeMode: "native",
  };
  requireExactIdentity(exactIdentity, expectedIdentity);
  summary.h03Identity = { authenticated: exactIdentity };

  // Authenticate the pinned rendered-GUI runtime before any GUI profile or lifecycle state.
  // Browser installation is deliberately forbidden here: a missing executable is BLOCKED.
  const playwrightRoot = path.join(source, "apps", "web", "node_modules", "playwright");
  const playwrightPackagePath = path.join(playwrightRoot, "package.json");
  const playwrightSourcePath = path.join(playwrightRoot, "index.mjs");
  const browserManifestPath = path.resolve(
    await realpath(playwrightRoot),
    "..",
    "playwright-core",
    "browsers.json",
  );
  const playwrightMetadata = JSON.parse(
    await requirePrerequisite("pinned Playwright package", () =>
      readFile(playwrightPackagePath, "utf8"),
    ),
  );
  const browserManifest = JSON.parse(
    await requirePrerequisite("pinned Playwright package", () =>
      readFile(browserManifestPath, "utf8"),
    ),
  );
  const pinnedChromium = browserManifest.browsers?.find((entry) => entry.name === "chromium");
  const playwright = await requirePrerequisite(
    "pinned Playwright package",
    () => import(pathToFileURL(playwrightSourcePath).href),
  );
  if (!playwright?.chromium) blocked("pinned Playwright package");
  const chromiumPath = playwright.chromium.executablePath();
  const chromiumSha256 = await requirePrerequisite("installed Chromium executable", () =>
    sha256(chromiumPath),
  );
  // prettier-ignore
  const exactGuiRuntimeIdentity = { webPackageSha256: await sha256(path.join(source, "apps", "web", "package.json")), webEntrypointSha256: await sha256(path.join(source, "apps", "web", "dist", "index.html")), playwrightVersion: playwrightMetadata.version, playwrightPackageSha256: await sha256(playwrightPackagePath), playwrightSourceSha256: await sha256(playwrightSourcePath), browserManifestSha256: await sha256(browserManifestPath), chromiumRevision: pinnedChromium?.revision, chromiumVersion: pinnedChromium?.browserVersion, chromiumSha256 };
  requireExactIdentity(exactGuiRuntimeIdentity, PINNED_GUI_IDENTITY);
  let identityBrowser;
  // prettier-ignore
  try { identityBrowser = await requirePrerequisite("installed Chromium executable", () => playwright.chromium.launch({ executablePath: chromiumPath, headless: true })); requireExactIdentity({ chromiumVersion: identityBrowser.version() }, { chromiumVersion: PINNED_GUI_IDENTITY.chromiumVersion }); } finally { await identityBrowser?.close(); }

  const h03Control = path.join(temporaryRoot, "h03-control");
  const h03Nonce = `h03-${createHash("sha256").update(archivePath).digest("hex").slice(0, 24)}`;
  await mkdir(h03Control, { recursive: true });
  // prettier-ignore
  const descriptor = JSON.stringify({ controlDirectory: h03Control, nonce: h03Nonce, generation: 1 });
  const h03Patch = `${nativeModePatch}- id: mcp-ast
  config:
    serverName: ast
    transport: stdio
    command: !!js process.execPath
    args:
      - !!js process.getBuiltinModule('node:url').fileURLToPath(new URL('node_modules/ast-mcp-server/dist/index.js', baseUrl))
    cwd: !!js process.cwd()
    failOnStartupError: true
    toolCallTimeoutMs: ${H03_COMPRESSED_BUDGET.outerToolCallMs}
    env:
      AST_MCP_APPLY_GUARD: deny
      AST_MCP_TEXT_PROJECTION: canonical_json
      AST_COMPILER_WORKER_MODE: supervised
      AST_COMPILER_WORKER_IDLE_TTL_MS: '100'
      AST_QUEUE_WAIT_TIMEOUT_MS: '${H03_COMPRESSED_BUDGET.queueWaitMs}'
      AST_OPERATION_DEADLINE_MS: '${H03_COMPRESSED_BUDGET.executionDeadlineMs}'
      AST_H03_FIXTURE: '${descriptor}'
- insert:
    - id: h03-probe
      name: './h03-probe.mjs'
      inject: ['tools']
`;
  await writeFile(path.join(profileDir, "h03-probe.mjs"), h03ProbeSource(), "utf8");
  await writeFile(path.join(profileDir, "cordis.patch.yml"), h03Patch, "utf8");
  const h03 = await bootWithProbe(
    cliBin,
    nodeBin,
    { ...dshEnvironment, AST_H03_CONTROL_DIRECTORY: h03Control, AST_H03_NONCE: h03Nonce },
    fixtureProject,
    dshHome,
  );
  assert(h03.error === null, `H-03 exact-host probe failed: ${h03.error ?? "unknown"}`);
  const rawH03Errors = JSON.stringify({ calls: h03.calls, events: h03.events });
  for (const forbidden of ["ToolTimeoutError", "TOOL_TIMEOUT", "AbortError"]) {
    assert(!rawH03Errors.includes(forbidden), `H-03 observed forbidden ${forbidden} ownership`);
  }
  const cold = classifyExactHostToolError(h03.calls?.cold);
  const queued = classifyExactHostToolError(h03.calls?.queued);
  const blocker = classifyExactHostToolError(h03.calls?.blocker);
  // prettier-ignore
  const queuedError = h03.events.find((event) => event.fixtureId === "queued" && event.phase === "error");
  const queuedTerminal = classifyExactHostToolError(queuedError?.result);
  const recycle = classifyExactHostToolError(
    h03.events.find((event) => event.fixtureId === "recycle" && event.phase === "error")?.result,
  );
  assert(cold.code === "OPERATION_DEADLINE_EXCEEDED", "cold deadline was not AST-owned");
  assert(queued.code === "QUEUE_WAIT_TIMEOUT", "queued timeout was not AST-owned");
  assert(blocker.code === "OPERATION_DEADLINE_EXCEEDED", "blocker did not settle at AST deadline");
  assert(recycle.code === "REQUEST_CANCELLED", "recycled call was not cancelled");
  assert(h03.callerAbortAcknowledged === true, "Harness did not acknowledge caller cancellation");
  assert(
    h03.calls?.warm?.isError === false && h03.calls?.readback?.isError === false,
    "H-03 successful control call failed",
  );
  assert(
    h03.events[0]?.fixtureId === "cold",
    "cold deadline did not run before any warmed generation",
  );
  assert(!h03.events.some((event) => event.phase === "stale"), "exact host accepted a stale phase");
  const eventsFor = (fixtureId, callId) =>
    h03.events.filter((event) => event.fixtureId === fixtureId && event.callId === callId);
  const coldEvents = eventsFor("cold", "h03-cold");
  const recycleEvents = eventsFor("recycle", "h03-recycle");
  const warmStart = eventsFor("warm", "h03-warm").find((event) => event.phase === "started");
  // prettier-ignore
  for (const [name, allEvents] of [["cold", coldEvents], ["recycle", recycleEvents]]) {
    const events_ = allEvents.filter((event) => ["started", "terminal"].includes(event.phase));
    assert(events_.length === 2 && events_[0].phase === "started" && events_[1].phase === "terminal", `${name} did not have one exact terminal path`);
  }
  // prettier-ignore
  const queuedOrigin = queuedError && { callId: queuedError.callId, fixtureId: queuedError.fixtureId, generation: queuedError.generation };
  // prettier-ignore
  assert(eventsFor("queued", "h03-queued").filter((event) => event.phase === "started").length === 0, "queued operation started after timeout");
  // prettier-ignore
  assert(queuedOrigin?.callId === "h03-queued" && queuedOrigin.fixtureId === "queued" && Number.isSafeInteger(queuedOrigin.generation) && queuedTerminal.code === "QUEUE_WAIT_TIMEOUT" && queuedTerminal.correlationId === queued.correlationId, "queued terminal did not retain request-local submission identity");
  assert(
    Number.isSafeInteger(warmStart?.generation) &&
      recycleEvents.every((event) => event.generation === warmStart.generation + 1),
    "recycled call accepted a stale-generation effect",
  );
  const readback = h03.events.find((event) => event.phase === "readback");
  assert(
    readback?.active === 0 &&
      readback.held === 0 &&
      readback.abortListeners === 0 &&
      readback.eventsDrained >= 2,
    "H-03 worker resources were not drained",
  );
  // prettier-ignore
  const join = (origin, terminal) => ({ ...origin, correlationId: terminal.correlationId });
  // prettier-ignore
  summary.h03 = { budget: H03_COMPRESSED_BUDGET, joins: { cold: join({ callId: "h03-cold", fixtureId: "cold", generation: coldEvents[0].generation }, cold), queued: join(queuedOrigin, queued), recycle: join({ callId: "h03-recycle", fixtureId: "recycle", generation: recycleEvents[0].generation }, recycle) }, rawMarkerSha256: h03.rawMarkerSha256, readback };
  summary.phases.h03 = "ok";

  // ── Phase H-05: native Session cancellation + config-HMR retirement ────────
  const h05Control = path.join(temporaryRoot, "h05-control");
  const h05Bundle = path.join(temporaryRoot, "h05-lifecycle-bundle");
  const h05Nonce = `h05-${createHash("sha256").update(mcpClientArchive).digest("hex").slice(0, 24)}`;
  const h05OwnerToken = `h05-owner-${createHash("sha256").update(archivePath).digest("hex").slice(0, 20)}`;
  await mkdir(h05Control, { recursive: true });
  await mkdir(h05Bundle, { recursive: true });
  await writeFile(
    path.join(h05Bundle, "package.json"),
    JSON.stringify({
      name: "@ast-mcp/h05-lifecycle",
      version: "1.0.0",
      type: "module",
      exports: "./probe.mjs",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    }),
  );
  // prettier-ignore
  const h05Probe = h05ProbeSource(), h05ProbePatch = "- insert:\n    - id: h05-lifecycle-probe\n      name: '@ast-mcp/h05-lifecycle'\n      inject: ['tools', 'loader', 'agents']\n";
  await writeFile(path.join(h05Bundle, "probe.mjs"), h05Probe);
  await writeFile(path.join(h05Bundle, "cordis.patch.yml"), h05ProbePatch);
  await run(nodeBin, [cliBin, "plugin", "--profile", "smoke", "add", `file:${h05Bundle}`], {
    cwd: temporaryRoot,
    env: dshEnvironment,
  });
  // prettier-ignore
  const h05Descriptor = JSON.stringify({ controlDirectory: h05Control, nonce: h05Nonce, ownerToken: h05OwnerToken, generation: 1 });
  const h05EnablePatch = `- id: mcp-ast
  disabled: false
  config:
    serverName: ast
    transport: stdio
    command: !!js process.execPath
    args:
      - !!js process.getBuiltinModule('node:url').fileURLToPath(new URL('node_modules/ast-mcp-server/dist/index.js', baseUrl))
    cwd: !!js process.cwd()
    failOnStartupError: true
    toolCallTimeoutMs: ${timeoutBudget.outerToolCallMs}
    env:
      AST_MCP_APPLY_GUARD: deny
      AST_MCP_TEXT_PROJECTION: canonical_json
      AST_COMPILER_WORKER_MODE: supervised
      AST_H05_FIXTURE: '${h05Descriptor}'
      AST_H01_PROCESS_OWNER: '${h05OwnerToken}'
`;
  await writeFile(path.join(profileDir, "cordis.patch.yml"), h05EnablePatch);
  // prettier-ignore
  const h05DumpConfig = (await run(nodeBin, [cliBin, "--profile", "smoke", "--dump-config"], { cwd: temporaryRoot, env: dshEnvironment })).stdout;
  // prettier-ignore
  const h05Bindings = { controlDirectory: h05Control, nonce: h05Nonce, ownerToken: h05OwnerToken, tempRoot: temporaryRoot };
  // prettier-ignore
  const exactH05Profile = { effectiveProfileSha256: hashJson({ effectiveConfig: canonicalH05Profile(h05DumpConfig, { ...h05Bindings, tempRoots: PINNED_H05_PROFILE_SHA256.nativeTempRoots }), probeSourceSha256: createHash("sha256").update(h05Probe).digest("hex"), probePatchSha256: createHash("sha256").update(h05ProbePatch).digest("hex"), adapterSha256: expectedAdapterSha256 }) };
  console.error("H05_NATIVE_IDENTITY", JSON.stringify(exactH05Profile));
  // prettier-ignore
  requireExactIdentity(exactH05Profile, { effectiveProfileSha256: PINNED_H05_PROFILE_SHA256.native });
  const mockModulePath = path.join(
    source,
    "packages",
    "test-support",
    "llm-mock-server",
    "lib",
    "index.js",
  );
  const { startMockLlmServer } = await import(pathToFileURL(mockModulePath).href);
  const h05Mock = await startMockLlmServer({
    sequence: [
      "tool_call_success",
      "success",
      "tool_call_success",
      "success",
      "tool_call_success",
      "success",
    ],
    repeatLast: true,
    apiKey: "h05-native-key",
    toolName: H01_TOOL_NAME,
    toolArguments: JSON.stringify({ project_root: fixtureProject }),
  });
  let h05;
  try {
    h05 = await bootWithProbe(
      cliBin,
      nodeBin,
      {
        ...dshEnvironment,
        AST_H05_CONTROL_DIRECTORY: h05Control,
        AST_H05_NONCE: h05Nonce,
        AST_H05_OWNER_TOKEN: h05OwnerToken,
        AST_H05_PATCH_PATH: path.join(profileDir, "cordis.patch.yml"),
        AST_H05_ENABLE_PATCH: Buffer.from(h05EnablePatch).toString("base64"),
        DEEPSEEK_API_KEY: "h05-native-key",
        DEEPSEEK_BASE_URL: h05Mock.baseURL,
      },
      fixtureProject,
      dshHome,
      true,
    );
  } finally {
    await h05Mock.close();
  }
  await assertNoTransientResidue(temporaryRoot);
  assert(h05.error === null, `H-05 exact-host probe failed: ${h05.error ?? "unknown"}`);
  assert(isDeepStrictEqual(h05.catalogs, [15, 0, 15]), "H-05 catalog sequence diverged");
  const h05TransportRows = Object.entries(h05.transport ?? {});
  // prettier-ignore
  assert(h05.astTerminal?.code === "REQUEST_CANCELLED" && h05.astTerminal.ownerObserved === true && h05.shutdownTerminal?.code === "REQUEST_CANCELLED" && h05.transport?.bridgeAbort?.acknowledged === true && h05.transport.bridgeAbort.surface === "transport" && h05.transport.bridgeTool?.acknowledged === true && isDeepStrictEqual(h05TransportRows.map(([name]) => name).sort(), ["bridgeAbort", "bridgeTool", "durable", "native"]) && h05TransportRows.every(([, evidence]) => evidence.surface === "transport" && evidence.callId === h05.astTerminal.callId && evidence.bytes > 0 && evidence.bytes <= 4096 && /^[A-Z][A-Z0-9_-]{0,63}$/u.test(evidence.code) && evidence.authoritativeAstTerminal === false) && h05.transport.native?.callId === h05.transport.durable?.callId && h05.transport.native.astCorrelationId === h05.astTerminal.correlationId && h05.transport.durable.astCorrelationId === h05.astTerminal.correlationId && !["ABORTED", "ABORTED_BEFORE_DISPATCH", "OPERATION_DEADLINE_EXCEEDED"].includes(h05.astTerminal.code) && isDeepStrictEqual(h05.agentAbortReason, { kind: "aborted", reason: { kind: "user" } }), "H-05 cancellation ownership diverged");
  assert(
    (await collectOwnerTokenPids(h05OwnerToken)).length === 0,
    "H-05 process owner survived Host shutdown",
  );
  summary.h05 = {
    catalogs: h05.catalogs,
    astTerminal: h05.astTerminal,
    transport: h05.transport,
    ownerGenerations: [h05.oldOwnerPids.length, h05.freshOwnerPids.length],
    readback: h05.readback,
    rawMarkerSha256: h05.rawMarkerSha256,
  };
  summary.phases.h05 = "ok";

  // ── Phase H-05 GUI: authenticated pinned Web renders request tool catalogs ──
  const webProfileDir = path.join(dshHome, "profiles", "web");
  for (const plugin of [archiveReference, `file:${mcpClientArchive}`, `file:${h05Bundle}`])
    await run(nodeBin, [cliBin, "plugin", "--profile", "web", "add", plugin], {
      cwd: temporaryRoot,
      env: dshEnvironment,
    });
  const webPatch = `${nativeModePatch}${h05EnablePatch}`;
  await writeFile(path.join(webProfileDir, "cordis.patch.yml"), webPatch);
  // prettier-ignore
  const webDumpConfig = (await run(nodeBin, [cliBin, "--profile", "web", "--dump-config"], { cwd: temporaryRoot, env: dshEnvironment })).stdout;
  // prettier-ignore
  const exactGuiIdentity = { ...exactGuiRuntimeIdentity, effectiveProfileSha256: hashJson({ effectiveConfig: canonicalH05Profile(webDumpConfig, { ...h05Bindings, tempRoots: PINNED_H05_PROFILE_SHA256.webTempRoots }), probeSourceSha256: createHash("sha256").update(h05Probe).digest("hex"), probePatchSha256: createHash("sha256").update(h05ProbePatch).digest("hex"), adapterSha256: expectedAdapterSha256 }) };
  console.error("H05_WEB_IDENTITY", JSON.stringify(exactGuiIdentity));
  // prettier-ignore
  requireExactIdentity(exactGuiIdentity, { ...PINNED_GUI_IDENTITY, effectiveProfileSha256: PINNED_H05_PROFILE_SHA256.web });
  // prettier-ignore
  const guiMock = await startMockLlmServer({ sequence: ["success"], repeatLast: true, apiKey: "h05-gui-key" });
  // prettier-ignore
  const guiEnvironment = { ...dshEnvironment, AST_H05_CONTROL_DIRECTORY: h05Control, AST_H05_NONCE: h05Nonce, AST_H05_OWNER_TOKEN: h05OwnerToken, AST_H05_PATCH_PATH: path.join(webProfileDir, "cordis.patch.yml"), AST_H05_ENABLE_PATCH: Buffer.from(webPatch).toString("base64"), AST_H05_GUI_CONTROL: "1", DEEPSEEK_API_KEY: "h05-gui-key", DEEPSEEK_BASE_URL: guiMock.baseURL };
  let webChild, browser, context, page;
  try {
    const running = await launchPinnedWeb(cliBin, nodeBin, guiEnvironment);
    webChild = running.child;
    const authenticatedUrl = new URL(running.launchUrl);
    if (
      authenticatedUrl.hostname !== "127.0.0.1" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(authenticatedUrl.searchParams.get("token") ?? "")
    )
      blocked("authenticated Web launch URL");
    await waitForJsonLine(
      path.join(h05Control, "gui-events.jsonl"),
      (event) => event.id === "ready" && event.count === 15,
    );
    browser = await playwright.chromium.launch({ executablePath: chromiumPath, headless: true });
    context = await browser.newContext({ locale: "en-US" });
    page = await context.newPage();
    const blockUiDrift = async (label) => {
      const diagnostics = {
        label,
        buttons: (await page.getByRole("button").allTextContents()).slice(0, 40),
        tabs: (await page.getByRole("tab").allTextContents()).slice(0, 20),
        composer: await page
          .locator("[data-composer-input]")
          .first()
          .evaluate((node) => ({
            disabled: node.getAttribute("aria-disabled"),
            editable: node.getAttribute("contenteditable"),
            text: node.textContent,
          }))
          .catch(() => null),
        mockRequests: guiMock.requests.length,
        webOutput: running.output().slice(-1200),
        toolNames: (await page.locator('[class*="toolCatalogName"]').allTextContents()).slice(
          0,
          20,
        ),
        rows: (await page.getByRole("row").allTextContents()).slice(-12),
        body: (await page.locator("body").innerText()).slice(0, 1200),
      };
      blocked(`rendered Trajectory Tools rows: UI drift ${JSON.stringify(diagnostics)}`);
    };
    await page.goto(running.launchUrl);
    const notice = page.getByRole("dialog", { name: "Internal Testing Notice" });
    await notice.waitFor({ timeout: 30_000 }).catch(() => blockUiDrift("testing notice"));
    await notice.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .locator('[data-composer-input][contenteditable="true"]')
      .waitFor({ timeout: 30_000 })
      .catch(() => blockUiDrift("composer"));
    // prettier-ignore
    const { unzipSync, strFromU8 } = await import(pathToFileURL(path.join(source, "node_modules", ".pnpm", "fflate@0.8.3", "node_modules", "fflate", "esm", "index.mjs")).href);
    const catalogs = [],
      prompts = ["H05 rendered baseline", "H05 rendered removal", "H05 rendered reconnect"];
    let renderedSession,
      previousSequence = -1;
    // The rendered Request #N is the session-global request ordinal; each export must contain exactly N headers, making its latest header the selected request's source-backed durable identity.
    // prettier-ignore
    const captureRequestHeader = async (requestNumber) => { const downloadReady = page.waitForEvent("download", { timeout: 30_000 }); await page.getByRole("button", { name: "Session log", exact: true }).click(); const download = await downloadReady, dialog = page.getByRole("dialog", { name: "Session download started" }); await dialog.waitFor({ timeout: 30_000 }); await dialog.getByText("Close", { exact: true }).click(); const files = unzipSync(await readFile(await download.path())), headers = strFromU8(files["session.jsonl"]).trim().split("\n").filter(Boolean).map(JSON.parse).filter((row) => row.type === "request/header"), requestHeader = headers.at(-1), session = download.suggestedFilename(); if (headers.length !== requestNumber || !requestHeader || requestHeader.seq <= previousSequence || (renderedSession && renderedSession !== session)) blocked("rendered Trajectory Tools rows: request/header identity"); renderedSession = session; previousSequence = requestHeader.seq; return { requestHeader, session }; };
    const renderCatalog = async (index, label) => {
      const input = page.locator('[data-composer-input][contenteditable="true"]').first();
      await input
        .waitFor({ state: "visible", timeout: 30_000 })
        .catch(() => blockUiDrift(`composer ${index}`));
      await input.click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type(prompts[index]);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.waitForFunction(
        (element) => element.textContent === "",
        await input.elementHandle(),
        { timeout: 30_000 },
      );
      await page
        .getByText(prompts[index], { exact: true })
        .last()
        .waitFor({ timeout: 30_000 })
        .catch(() => blockUiDrift(`prompt ${index}`));
      await page
        .locator("p")
        .filter({ hasText: "mock response recovered" })
        .last()
        .waitFor({ timeout: 30_000 });
      const trajectory = page.locator("button", { hasText: /^Trajectory$/u }).first();
      await trajectory.waitFor({ timeout: 30_000 }).catch(() => blockUiDrift("Trajectory tab"));
      await trajectory.click();
      await page
        .getByLabel("Trajectory timeline")
        .waitFor({ timeout: 30_000 })
        .catch(() => blockUiDrift("Trajectory timeline"));
      const requests = page.getByRole("button", { name: /Request #/u });
      await requests
        .last()
        .waitFor({ timeout: 30_000 })
        .catch(() => blockUiDrift("request boundary"));
      const requestLabel = await requests.last().getAttribute("aria-label"),
        requestNumber = Number(/^Request #(\d+)$/u.exec(requestLabel ?? "")?.[1]);
      if (requestNumber !== index + 1) blocked("rendered Trajectory Tools rows: request boundary");
      await requests.last().click();
      await page
        .getByRole("tabpanel")
        .getByText("Completed", { exact: true })
        .waitFor({ timeout: 30_000 });
      const row = page.getByRole("row").filter({ hasText: label }).last();
      await row.waitFor({ timeout: 30_000 }).catch(() => blockUiDrift(`row ${label}`));
      await row.click();
      const toolsTab = page.getByRole("tab", { name: "Tools", exact: true });
      await toolsTab.waitFor({ timeout: 30_000 }).catch(() => blockUiDrift("Tools tab"));
      await toolsTab.click();
      const panel = page.getByRole("tabpanel");
      const names = panel.locator('[class*="toolCatalogName"]');
      if (index === 1)
        await page.waitForFunction(
          (element) =>
            [...element.querySelectorAll('[class*="toolCatalogName"]')].every(
              (node) => !node.textContent?.startsWith("mcp__ast__"),
            ),
          await panel.elementHandle(),
          { timeout: 30_000 },
        );
      else await names.filter({ hasText: "mcp__ast__" }).first().waitFor({ timeout: 30_000 });
      const renderedAstNames = (await names.allTextContents())
        .filter((name) => name.startsWith("mcp__ast__"))
        .sort();
      if (
        renderedAstNames.length !== [15, 0, 15][index] ||
        new Set(renderedAstNames).size !== renderedAstNames.length
      )
        blocked("rendered Trajectory Tools rows");
      const { requestHeader, session } = await captureRequestHeader(requestNumber),
        astTools = (requestHeader.data.header.tools ?? []).filter((tool) =>
          tool.name.startsWith("mcp__ast__"),
        ),
        headerNames = astTools.map((tool) => tool.name).sort();
      if (!isDeepStrictEqual(headerNames, renderedAstNames))
        blocked("rendered Trajectory Tools rows");
      catalogs.push({
        session,
        sequence: requestHeader.seq,
        requestLabel,
        headerCatalogSha256: hashJson(astTools),
        renderedAstNames,
      });
      await page.getByRole("tab", { name: "Chat", exact: true }).click();
      await page
        .locator('[data-composer-input][contenteditable="true"]')
        .first()
        .waitFor({ timeout: 30_000 });
    };
    await renderCatalog(0, "Initial System Prompt");
    for (const [id, count, patch, label] of [
      ["removed", 0, `${nativeModePatch}- id: mcp-ast\n  disabled: true\n`, "Tools Updated"],
      ["reconnected", 15, webPatch, "Tools Updated"],
    ]) {
      await writeFile(
        path.join(h05Control, "gui-command.json"),
        JSON.stringify({ id, count, patch: Buffer.from(patch).toString("base64") }),
      );
      await waitForJsonLine(
        path.join(h05Control, "gui-events.jsonl"),
        (event) => event.id === id && event.count === count,
      );
      await renderCatalog(catalogs.length, label);
    }
    const renderedGuiEvidence = catalogs;
    assert(
      renderedGuiEvidence[0].headerCatalogSha256 === renderedGuiEvidence[2].headerCatalogSha256 &&
        new Set(renderedGuiEvidence.map((row) => row.session)).size === 1 &&
        new Set(renderedGuiEvidence.map((row) => row.sequence)).size === 3 &&
        isDeepStrictEqual(
          renderedGuiEvidence.map((row) => row.requestLabel),
          ["Request #1", "Request #2", "Request #3"],
        ) &&
        isDeepStrictEqual(
          renderedGuiEvidence.map((row) => row.renderedAstNames.length),
          [15, 0, 15],
        ),
      "rendered GUI request/header identity or catalog sequence diverged",
    );
    summary.h05Gui = { identity: exactGuiIdentity, rendered: renderedGuiEvidence };
  } finally {
    // prettier-ignore
    await runOrderedCleanup("GUI owner cleanup", [["page", () => page?.close()], ["context", () => context?.close()], ["browser", () => browser?.close()], ["Web process tree", () => webChild && terminateProcessTree(webChild)], ["mock", () => guiMock.close()], ["owner-zero", async () => assert((await collectOwnerTokenPids(h05OwnerToken)).length === 0, "GUI AST owner survived closure")], ["residue", () => assertNoTransientResidue(temporaryRoot)]]);
  }

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
  assert(
    publicBaseline.schemaEvidence.exploreRequired.length === 0 &&
      publicBaseline.schemaEvidence.exploreProperties.length === 0,
    "public baseline did not reproduce the empty ast_explore schema",
  );
  assert(
    isDeepStrictEqual(correctedCandidate.schemaEvidence.exploreRequired, ["project_root"]) &&
      correctedCandidate.schemaEvidence.exploreProperties.includes("call_spines") &&
      correctedCandidate.schemaEvidence.unaffectedSha256 ===
        publicBaseline.schemaEvidence.unaffectedSha256,
    "candidate schema correction changed the wrong model contract",
  );
  const directSpines = directExploreSchema?.properties?.call_spines;
  assert(
    hashJson(directExploreSchema) === hashJson(probe.exploreSchema) &&
      hashJson(probe.exploreSchema) === correctedCandidate.schemaEvidence.exploreSha256 &&
      probe.exploreSchema?.properties?.detail?.default === "summary" &&
      probe.exploreSchema?.properties?.max_bytes?.minimum === 1024 &&
      isDeepStrictEqual(Object.keys(directSpines?.properties ?? {}).sort(), [
        "direction",
        "max_depth",
        "max_edges",
        "max_nodes",
      ]) &&
      isDeepStrictEqual(directSpines.properties.direction.enum, ["incoming", "outgoing"]) &&
      directSpines.properties.max_depth.maximum === 32 &&
      directSpines.properties.max_nodes.default === 100 &&
      directSpines.properties.max_edges.maximum === 5000,
    "direct MCP, Harness registry, and native ast_explore schemas differ",
  );
  summary.h02 = {
    publicExploreSha256: publicBaseline.schemaEvidence.exploreSha256,
    candidateExploreSha256: correctedCandidate.schemaEvidence.exploreSha256,
    unaffectedSha256: correctedCandidate.schemaEvidence.unaffectedSha256,
    registryExploreSha256: hashJson(probe.exploreSchema),
    invalidExploreRejected: probe.invalidExplore.length,
  };
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
  const cleanupEvidence = createH03CleanupEvidence(summary.h03);
  // prettier-ignore
  if (cleanupEvidence) summary.h03Cleanup = { ...cleanupEvidence, cleanupEvidenceSha256: hashJson(cleanupEvidence) };
}

console.log(`DSH_ADAPTER_SMOKE_OK:${JSON.stringify({ ...summary, cleanup: "ok" })}`);
