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
// The pinned harness is resolved from DSH_HARNESS_SOURCE (a checkout at
// cd5ef814) or, when unset, provisioned by cloning + building it at the exact
// revision. Teardown always runs via `finally`.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile, spawn } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { promisify } from "node:util";
import yaml from "yaml";

const execFileAsync = promisify(execFile);
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

function fail(message) {
  throw new Error(`dsh-adapter-smoke: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    killSignal: "SIGKILL",
    ...options,
  });
}

async function sha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
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
  const source = process.env.DSH_HARNESS_SOURCE
    ? path.resolve(process.env.DSH_HARNESS_SOURCE)
    : await provisionPinnedHarness(nodeBinDir);
  const head = (await run("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
  assert(head === PINNED_REVISION, `harness HEAD ${head} != pinned ${PINNED_REVISION}`);
  const dirty = (await run("git", ["-C", source, "status", "--porcelain=v1"])).stdout.trim();
  assert(dirty === "", "pinned harness source must be a clean checkout");
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
      cliSha256: await sha256(cliBin),
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
  await run("pnpm", ["pack", "--pack-destination", temporaryRoot], { cwd, env: environment });
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

/** Clone, install, and build the harness at the exact pinned revision. */
async function provisionPinnedHarness(nodeBinDir) {
  const root = path.join(temporaryRoot, "pinned-harness");
  await run("git", ["clone", "--filter=blob:none", "--no-checkout", HARNESS_REPOSITORY, root], {
    cwd: temporaryRoot,
  });
  await run("git", ["-C", root, "checkout", PINNED_REVISION]);
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
  await run("corepack", ["enable"], { cwd: root, env: provisionEnvironment });
  await run("pnpm", ["install"], { cwd: root, env: provisionEnvironment });
  await run("pnpm", ["build"], { cwd: root, env: provisionEnvironment });
  return root;
}

/** Boot the profile with the probe plugin and return its DSH_PROBE_RESULT marker. */
async function bootWithProbe(cliBin, nodeBin, environment, fixtureProject, dshHome) {
  const detached = process.platform !== "win32";
  const child = spawn(nodeBin, [cliBin, "--profile", "smoke", "probe"], {
    cwd: temporaryRoot,
    env: { ...environment, AST_PROBE_PROJECT_ROOT: fixtureProject, DSH_HOME: dshHome },
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
  });
  async function signalTree(signal) {
    if (process.platform === "win32" && child.pid !== undefined) {
      try {
        await run("taskkill", ["/pid", String(child.pid), "/t", "/f"], { timeout: 5_000 });
        return;
      } catch {
        // Fall through to the child handle when taskkill cannot observe the PID.
      }
    }
    if (detached && child.pid !== undefined) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // The process group may already be gone; fall through to the child handle.
      }
    }
    child.kill(signal);
  }
  function waitForExit(timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      child.once("exit", onExit);
    });
  }
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
        const match = /DSH_PROBE_RESULT:(\{.*\})\n/u.exec(stderr);
        if (match) finish(JSON.parse(match[1]));
      }
      const deadline = setTimeout(() => finish(undefined), 45_000);
      const interval = setInterval(check, 250);
      child.on("exit", () => {
        const match = /DSH_PROBE_RESULT:(\{.*\})\n/u.exec(stderr);
        finish(match ? JSON.parse(match[1]) : undefined);
      });
    });
    assert(marker !== undefined, "harness probe produced no DSH_PROBE_RESULT marker");
    return marker;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      await signalTree("SIGTERM");
      const stopped = await waitForExit(5_000);
      if (!stopped && child.exitCode === null && child.signalCode === null) {
        // Keep the direct child kill as a platform fallback, then kill the POSIX
        // process group so the Harness-owned stdio MCP child cannot be orphaned.
        child.kill("SIGKILL");
        await signalTree("SIGKILL");
        assert(await waitForExit(5_000), "harness probe process tree did not terminate");
      }
    }
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
              ok: rejected.isError === true,
              kind: rejected.isError === true ? "registry-error" : "unexpected-success",
            };
          } catch (error) {
            marker.applyRejected = {
              ok: true,
              kind: "registry-exception",
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

const packageDirectory = path.join(temporaryRoot, "package");
const archivePath = path.join(packageDirectory, "ast-mcp-server.tgz");
const consumerDirectory = path.join(temporaryRoot, "consumer");
const fixtureProject = path.join(temporaryRoot, "fixture-project");
const dshHome = path.join(temporaryRoot, "dsh-home");
const summary = { version: packageMetadata.version, phases: {} };

try {
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
  summary.tarballSha256 = await sha256(archivePath);
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
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolvedEntrypoint],
      env: childEnvironment,
      cwd: consumerDirectory,
    });
    const client = new Client({ name: "ast-dsh-adapter-smoke", version: "1.0.0" });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      return listed.tools.map((tool) => tool.name).sort();
    } finally {
      await client.close().catch(() => undefined);
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

  const guardedTransport = new StdioClientTransport({
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
  try {
    await guardedClient.connect(guardedTransport);
    const call = async (name, arguments_) => {
      const result = await guardedClient.callTool({ name, arguments: arguments_ });
      if (result.isError === true) {
        fail(`guarded call ${name} failed`);
      }
      return result.structuredContent;
    };
    await call("ast_get_project_status", { project_root: fixtureProject });
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
    await guardedClient.close().catch(() => undefined);
  }
  summary.phases.b = "ok";

  // ── Phase C: pinned-Harness proof (mandatory) ──────────────────────────────
  const { source, cliBin, nodeBin, identity } = await resolvePinnedHarness();
  const mcpClientArchive = await packPinnedMcpClient(source);
  summary.harness = { ...identity, mcpClientTarballSha256: await sha256(mcpClientArchive) };
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

  console.log(`DSH_ADAPTER_SMOKE_OK:${JSON.stringify(summary)}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
