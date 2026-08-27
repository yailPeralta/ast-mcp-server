#!/usr/bin/env node
// DeepSeek Harness adapter smoke (roadmap initiative 4, first slice).
//
// Phases:
//   A. Pack the tarball and assert the adapter fixture (dsh.bundle.patch,
//      cordis.patch.yml shipped, exact 0.13.0 version).
//   B. Independent MCP smoke against the package-relative entrypoint exactly as
//      the patch resolves it: guard on -> 15 tools, no ast_apply_operation,
//      reads/prepare/preview work; guard off -> full 16-tool surface.
//   C. Harness composition smoke (only when a dsh CLI is available; otherwise a
//      bounded SKIP marker): install the tarball into a scratch profile, prove
//      dump-config composition, and observe the harness spawn the installed
//      ast-mcp-server over stdio under tools.mode native (the default).
//
// Exit is non-zero only on real assertion failures; a missing dsh CLI/pnpm in
// phase C prints a SKIP marker and succeeds (the tarball fixture and
// independent smoke in phases A/B always run).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile, spawn } from "node:child_process";
import console from "node:console";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function fail(message) {
  throw new Error(`dsh-adapter-smoke: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return result;
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ast-dsh-adapter-"));
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
  if (packageMetadata.dsh?.bundle?.patch !== "./cordis.patch.yml") {
    fail(`package.json must declare exactly "dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`);
  }
  if (!packageMetadata.files.includes("cordis.patch.yml")) {
    fail("cordis.patch.yml must be listed in package.json files");
  }
  await mkdir(packageDirectory, { recursive: true });
  await run(yarnExecutable, ["pack", "--out", archivePath], { cwd: repositoryRoot });
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

  // ── Phase B: independent MCP smoke at the resolved entrypoint ──────────────
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

  // The patch resolves the entrypoint relative to the profile directory
  // (`baseUrl`, a trailing-slash file URL); the consumer directory is the
  // analogous install anchor.
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

  async function probeTools(environment) {
    const childEnvironment = {
      ...process.env,
      HOME: path.join(temporaryRoot, environment.label),
      XDG_CACHE_HOME: path.join(temporaryRoot, environment.label, "cache"),
    };
    if (environment.guard === undefined) {
      delete childEnvironment.AST_MCP_APPLY_GUARD;
    } else {
      childEnvironment.AST_MCP_APPLY_GUARD = environment.guard;
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
      await client.close();
    }
  }

  const guarded = await probeTools({ label: "guarded", guard: "deny" });
  assert(guarded.length === 15, `guarded tool count ${guarded.length}, expected 15`);
  assert(
    !guarded.includes("ast_apply_operation"),
    "guarded surface still exposes ast_apply_operation",
  );
  const unguarded = await probeTools({ label: "unguarded", guard: undefined });
  assert(unguarded.length === 16, `unguarded tool count ${unguarded.length}, expected 16`);
  assert(unguarded.includes("ast_apply_operation"), "unguarded surface lost ast_apply_operation");

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
  await guardedClient.connect(guardedTransport);
  const call = async (name, arguments_) => {
    const result = await guardedClient.callTool({ name, arguments: arguments_ });
    if (result.isError === true) {
      fail(`guarded call ${name} failed: ${JSON.stringify(result.content)}`);
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
  await guardedClient.close();
  summary.phases.b = "ok";

  // ── Phase C: harness composition smoke (dsh CLI optional) ───────────────────
  const dshBin = process.env.DSH_BIN || "dsh";
  try {
    await run(dshBin, ["--version"], { cwd: temporaryRoot });
    await run("pnpm", ["--version"], { cwd: temporaryRoot });
  } catch {
    summary.phases.c = { skipped: "dsh CLI and/or pnpm unavailable" };
    console.log(`DSH_ADAPTER_SMOKE_SKIP:dsh-cli:${JSON.stringify(summary.phases.c)}`);
    process.exitCode = 0;
    process.exit(0);
  }

  await mkdir(dshHome, { recursive: true });
  const dshEnvironment = { ...process.env, DSH_HOME: dshHome };
  await run(dshBin, ["plugin", "--profile", "smoke", "add", archiveReference], {
    cwd: temporaryRoot,
    env: dshEnvironment,
  });
  const { stdout: dumpConfig } = await run(dshBin, ["--profile", "smoke", "--dump-config"], {
    cwd: temporaryRoot,
    env: dshEnvironment,
  });
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

  const child = spawn(dshBin, ["--profile", "smoke", "probe"], {
    cwd: temporaryRoot,
    env: dshEnvironment,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let bootStderr = "";
  child.stderr.on("data", (chunk) => {
    bootStderr += chunk.toString();
  });
  const observedStartup = await new Promise((resolve) => {
    const deadline = setTimeout(() => resolve(false), 30_000);
    const interval = setInterval(() => {
      if (bootStderr.includes("ast-mcp-server running over stdio.")) {
        clearTimeout(deadline);
        clearInterval(interval);
        resolve(true);
      }
    }, 250);
    child.on("exit", () => {
      clearTimeout(deadline);
      clearInterval(interval);
      resolve(bootStderr.includes("ast-mcp-server running over stdio."));
    });
  });
  assert(observedStartup, "harness boot never observed the installed ast-mcp-server stdio startup");
  child.kill("SIGTERM");
  await new Promise((resolve) => child.on("exit", resolve));
  summary.phases.c = "ok";

  console.log(`DSH_ADAPTER_SMOKE_OK:${JSON.stringify(summary)}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
