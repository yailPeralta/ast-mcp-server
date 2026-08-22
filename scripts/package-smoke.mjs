#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import console from "node:console";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const releaseMetadata = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const yarnExecutable = process.platform === "win32" ? "yarn.cmd" : "yarn";
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ast package smoke-"));
const packageDirectory = path.join(temporaryRoot, "package");
const consumerDirectory = path.join(temporaryRoot, "consumer");
const archivePath = path.join(packageDirectory, "ast-mcp-server.tgz");
const claudeRoot = path.join(temporaryRoot, "claude");
const hermesRoot = path.join(temporaryRoot, "hermes");
const fakeBin = path.join(temporaryRoot, "bin");
const fakeClaudeState = path.join(temporaryRoot, "fake-claude-state.json");
const fakeHermesState = path.join(temporaryRoot, "fake-hermes-state.json");
const sharedHome = path.join(temporaryRoot, "home");
const openCodeConfig = path.join(temporaryRoot, "opencode.json");
const globalPrefix = path.join(temporaryRoot, "global");
const globalClaudeRoot = path.join(temporaryRoot, "global-claude");
const globalHermesRoot = path.join(temporaryRoot, "global-hermes");
const mcpFixtureRoot = path.join(temporaryRoot, "mcp-fixture");
const mcpXdgCacheHome = path.join(temporaryRoot, "mcp-xdg-cache");
const mcpTemp = path.join(temporaryRoot, "mcp-tmp");
const mcpCacheRoot = path.join(mcpXdgCacheHome, "ast-mcp-server", "symbol-index");
const upgradeTemp = path.join(temporaryRoot, "upgrade-tmp");
const upgradeHome = path.join(temporaryRoot, "upgrade-home");

function isolatedMcpEnvironment() {
  const environment = {
    ...process.env,
    HOME: sharedHome,
    XDG_CACHE_HOME: mcpXdgCacheHome,
    TMPDIR: mcpTemp,
  };
  delete environment.AST_SYMBOL_INDEX_PERSISTENCE;
  delete environment.AST_SYMBOL_INDEX_CACHE_ROOT;
  return environment;
}

async function executeFile(file, args, options = {}) {
  return execFileAsync(file, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 180_000,
    ...options,
  });
}

function parseJsonOutput(stdout) {
  const lines = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return JSON.parse(lines.at(-1));
}

function nextToolFailureEvent(stream, timeoutMs = 5000) {
  let buffer = "";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      stream.off("data", onData);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for packed MCP stderr correlation"));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
        try {
          const event = JSON.parse(line);
          if (event?.event === "tool_failure") {
            cleanup();
            resolve({ event, line });
            return;
          }
        } catch {
          // Ignore non-JSON startup diagnostics on stderr.
        }
      }
    };
    stream.on("data", onData);
  });
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
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(consumerDirectory, { recursive: true });
  await mkdir(upgradeTemp);
  await mkdir(upgradeHome);
  await writeFile(path.join(upgradeHome, ".npmrc"), "token=smoke-sentinel\n");

  await executeFile(yarnExecutable, ["pack", "--out", archivePath], {
    cwd: repositoryRoot,
  });

  const archiveReference = `file:${archivePath.replaceAll("\\", "/")}`;
  await writeFile(
    path.join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        packageManager: "yarn@4.15.0",
        dependencies: {
          "ast-mcp-server": archiveReference,
        },
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

  await executeFile(yarnExecutable, ["install", "--no-immutable"], {
    cwd: consumerDirectory,
  });
  await executeFile(yarnExecutable, ["install", "--immutable"], {
    cwd: consumerDirectory,
  });
  const scriptPolicy = await executeFile(
    yarnExecutable,
    ["config", "get", "enableScripts", "--json"],
    {
      cwd: consumerDirectory,
    },
  );
  if (scriptPolicy.stdout.trim() !== "false") {
    throw new Error(`consumer lifecycle scripts are enabled: ${scriptPolicy.stdout}`);
  }

  const installedPackageRoot = path.join(consumerDirectory, "node_modules", "ast-mcp-server");
  const installedMetadata = JSON.parse(
    await readFile(path.join(installedPackageRoot, "package.json"), "utf8"),
  );
  const installedChangelog = await readFile(
    path.join(installedPackageRoot, "CHANGELOG.md"),
    "utf8",
  );
  const [packagedSkill, packagedGuidance, packagedReleases] = await Promise.all([
    readFile(
      path.join(installedPackageRoot, "skills", "structural-code-editing", "SKILL.md"),
      "utf8",
    ),
    readFile(
      path.join(installedPackageRoot, "skills", "structural-code-editing", "guidance.md"),
      "utf8",
    ),
    readFile(
      path.join(installedPackageRoot, "skills", "structural-code-editing", "releases.json"),
      "utf8",
    ),
  ]);
  const packagedManifest = JSON.parse(packagedReleases);
  const packagedAssets = new Map(
    await Promise.all(
      packagedManifest.current.files.map(async (file) => {
        const content = await readFile(
          path.join(installedPackageRoot, "skills", "structural-code-editing", file.path),
        );
        return [file.path, [content, createHash("sha256").update(content).digest("hex")]];
      }),
    ),
  );
  if (
    releaseMetadata.engines?.node !== ">=22.13.0" ||
    installedMetadata.name !== releaseMetadata.name ||
    installedMetadata.version !== releaseMetadata.version ||
    installedMetadata.engines?.node !== releaseMetadata.engines?.node ||
    installedMetadata.license !== releaseMetadata.license ||
    installedMetadata.repository?.url !== releaseMetadata.repository?.url ||
    installedMetadata.publishConfig?.access !== releaseMetadata.publishConfig?.access ||
    !installedChangelog.includes("## [Unreleased]") ||
    !installedChangelog.includes(`## [${releaseMetadata.version}]`) ||
    !packagedSkill.includes("name: structural-code-editing") ||
    packagedGuidance.includes("ast-tool:structural-code-editing guidance") ||
    packagedManifest.current?.version !== "4.5.0" ||
    [...packagedAssets.keys()].sort().join() !== "SKILL.md,references/operations.md" ||
    packagedManifest.current.files.some(
      (file) => packagedAssets.get(file.path)?.[1] !== file.sha256,
    )
  ) {
    throw new Error("installed tarball release metadata is incomplete");
  }

  await Promise.all([
    mkdir(path.join(mcpFixtureRoot, "src"), { recursive: true }),
    mkdir(sharedHome, { recursive: true, mode: 0o700 }),
    mkdir(mcpXdgCacheHome, { recursive: true, mode: 0o700 }),
    mkdir(mcpTemp, { recursive: true, mode: 0o700 }),
  ]);
  await writeFile(
    path.join(mcpFixtureRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*"] }),
  );
  await writeFile(path.join(mcpFixtureRoot, "src/value.ts"), "export const value = 1;\n");

  const mcpClient = new Client({ name: "ast-package-smoke", version: "1.0.0" });
  const mcpTransport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(installedPackageRoot, "dist", "index.js")],
    env: isolatedMcpEnvironment(),
    stderr: "pipe",
  });
  try {
    await mcpClient.connect(mcpTransport);
    const serverVersion = mcpClient.getServerVersion()?.version;
    if (serverVersion !== installedMetadata.version) {
      throw new Error(
        `packed MCP handshake version mismatch: ${String(serverVersion)} != ${installedMetadata.version}`,
      );
    }
    const firstStatus = await mcpClient.callTool({
      name: "ast_get_project_status",
      arguments: { project_root: mcpFixtureRoot },
    });
    const firstObservability = firstStatus.structuredContent?.index_observability;
    if (
      firstStatus.isError === true ||
      firstObservability?.policy !== "enabled" ||
      firstObservability.backend !== "sqlite" ||
      firstObservability.state !== "ready" ||
      firstObservability.operation !== "rebuild" ||
      firstObservability.fallback_count !== 0 ||
      JSON.stringify(firstStatus).includes(mcpXdgCacheHome)
    ) {
      throw new Error("packed MCP default persistence did not rebuild privately in SQLite");
    }
    const serverStderr = mcpTransport.stderr;
    if (serverStderr === null) {
      throw new Error("packed MCP transport did not expose piped stderr");
    }
    serverStderr.setEncoding("utf8");
    const failureEventPromise = nextToolFailureEvent(serverStderr);
    const [failureResult, { event: failureEvent, line: failureEventLine }] = await Promise.all([
      mcpClient.callTool({
        name: "ast_get_file",
        arguments: { project_root: mcpFixtureRoot, file_path: "src/missing.ts" },
      }),
      failureEventPromise,
    ]);
    const errorText = failureResult.content?.[0]?.text;
    if (
      failureResult.isError !== true ||
      failureResult.structuredContent !== undefined ||
      failureResult.content?.length !== 1 ||
      failureResult.content?.[0]?.type !== "text" ||
      typeof errorText !== "string" ||
      Buffer.byteLength(errorText, "utf8") > 4096
    ) {
      throw new Error(`packed MCP error envelope is invalid: ${JSON.stringify(failureResult)}`);
    }
    const publicError = JSON.parse(errorText).error;
    if (
      publicError?.code !== "NOT_FOUND" ||
      publicError?.message !== "The requested target was not found." ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        publicError?.correlation_id,
      ) ||
      Buffer.byteLength(`${failureEventLine}\n`, "utf8") > 8192 ||
      failureEvent.correlation_id !== publicError.correlation_id ||
      failureEvent.tool !== "ast_get_file" ||
      failureEvent.code !== publicError.code ||
      failureEvent.message !== publicError.message ||
      !/^project_[0-9a-f]{20}$/.test(failureEvent.project_id) ||
      `${errorText}\n${failureEventLine}`.includes(mcpFixtureRoot)
    ) {
      throw new Error("packed MCP error boundary or stderr correlation is invalid");
    }
  } finally {
    await mcpClient.close();
  }

  const restartClient = new Client({ name: "ast-package-smoke-restart", version: "1.0.0" });
  const restartTransport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(installedPackageRoot, "dist", "index.js")],
    env: isolatedMcpEnvironment(),
    stderr: "pipe",
  });
  try {
    await restartClient.connect(restartTransport);
    const restartStatus = await restartClient.callTool({
      name: "ast_get_project_status",
      arguments: { project_root: mcpFixtureRoot },
    });
    const observability = restartStatus.structuredContent?.index_observability;
    if (
      restartStatus.isError === true ||
      observability?.policy !== "enabled" ||
      observability.backend !== "sqlite" ||
      observability.state !== "ready" ||
      observability.operation !== "hit" ||
      observability.fallback_count !== 0 ||
      JSON.stringify(restartStatus).includes(mcpXdgCacheHome)
    ) {
      throw new Error("packed MCP default persistence did not reuse the SQLite cache on restart");
    }
  } finally {
    await restartClient.close();
  }
  const cacheEntries = await readdir(mcpCacheRoot, { withFileTypes: true });
  const cacheDatabases = cacheEntries.filter(
    (entry) => entry.isFile() && /^symbol-index-[0-9a-f]{64}\.sqlite$/u.test(entry.name),
  );
  if (cacheDatabases.length !== 1 || cacheEntries.some((entry) => entry.isSymbolicLink())) {
    throw new Error("packed MCP default persistence did not create one physical SQLite cache");
  }
  const cacheMetadata = await lstat(path.join(mcpCacheRoot, cacheDatabases[0].name));
  if (
    !cacheMetadata.isFile() ||
    cacheMetadata.isSymbolicLink() ||
    cacheMetadata.nlink !== 1 ||
    cacheMetadata.size < 1 ||
    (process.platform === "linux" && (cacheMetadata.mode & 0o077) !== 0)
  ) {
    throw new Error("packed MCP default SQLite cache is not a private unique regular file");
  }

  const executable =
    process.platform === "win32"
      ? path.join(consumerDirectory, "node_modules", ".bin", "ast-tool.cmd")
      : path.join(consumerDirectory, "node_modules", ".bin", "ast-tool");
  const setupSupported = process.platform !== "win32";
  if (setupSupported) {
    await installFakeAgents();
  }
  const environment = {
    ...process.env,
    ...(setupSupported
      ? {
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          FAKE_CLAUDE_STATE: fakeClaudeState,
          FAKE_HERMES_STATE: fakeHermesState,
          FAKE_OPENCODE_STATE: path.join(temporaryRoot, "fake-opencode-state.json"),
          FAKE_CODEX_STATE: path.join(temporaryRoot, "fake-codex-state.json"),
          FAKE_GEMINI_STATE: path.join(temporaryRoot, "fake-gemini-state.json"),
          FAKE_COPILOT_STATE: path.join(temporaryRoot, "fake-copilot-state.json"),
          OPENCODE_CONFIG: openCodeConfig,
        }
      : {}),
    CLAUDE_CONFIG_DIR: claudeRoot,
    HERMES_HOME: hermesRoot,
    HOME: sharedHome,
  };
  const setupArgs = setupSupported
    ? ["setup", "--agents", "all", "--yes"]
    : ["install-skill", "all"];
  const humanClaudeGuidance = "# Consumer-owned rules\n\nPreserve these bytes.\n";
  if (setupSupported) {
    await mkdir(claudeRoot, { recursive: true });
    await writeFile(path.join(claudeRoot, "CLAUDE.md"), humanClaudeGuidance, "utf8");
  }
  const first = await executeFile(executable, setupArgs, {
    cwd: consumerDirectory,
    env: environment,
  });
  const second = await executeFile(executable, setupArgs, {
    cwd: consumerDirectory,
    env: environment,
  });
  const firstResult = parseJsonOutput(first.stdout);
  const secondResult = parseJsonOutput(second.stdout);

  const firstItems = setupSupported ? firstResult.agents : firstResult.installations;
  const secondItems = setupSupported ? secondResult.agents : secondResult.installations;
  if (
    firstItems?.length !== (setupSupported ? 6 : 2) ||
    !firstItems.every((item) => item.skill === "installed" || item.status === "installed") ||
    (setupSupported &&
      (!firstItems.every((item) => item.mcp === "configured") ||
        firstResult.version !== 2 ||
        firstItems.find((item) => item.agent === "claude")?.guidance !== "updated" ||
        firstItems.find((item) => item.agent === "opencode")?.guidance !== "updated" ||
        firstItems.find((item) => item.agent === "codex")?.guidance !== "installed" ||
        firstItems.find((item) => item.agent === "gemini")?.guidance !== "installed" ||
        firstItems.find((item) => item.agent === "hermes")?.guidance !== "skill_only" ||
        firstItems.find((item) => item.agent === "copilot")?.guidance !== "skill_only"))
  ) {
    throw new Error(`tarball setup did not configure both agents: ${first.stdout}`);
  }
  if (
    secondItems?.length !== (setupSupported ? 6 : 2) ||
    !secondItems.every((item) => item.skill === "unchanged" || item.status === "unchanged") ||
    (setupSupported &&
      (!secondItems.every(
        (item) =>
          item.mcp === "unchanged" &&
          (item.guidance === "unchanged" || item.guidance === "skill_only"),
      ) ||
        secondResult.physical_writes?.length !== 0))
  ) {
    throw new Error(`tarball setup was not idempotent: ${second.stdout}`);
  }

  for (const [relative, [expected]] of packagedAssets) {
    const [claudeAsset, hermesAsset] = await Promise.all([
      readFile(path.join(claudeRoot, "skills", "structural-code-editing", relative)),
      readFile(
        path.join(
          hermesRoot,
          "skills",
          "software-development",
          "structural-code-editing",
          relative,
        ),
      ),
    ]);
    if (!claudeAsset.equals(expected) || !hermesAsset.equals(expected)) {
      throw new Error(`installed tarball skill asset does not match: ${relative}`);
    }
  }
  if (setupSupported) {
    const [claudeGuidance, codexGuidance, geminiGuidance] = await Promise.all([
      readFile(path.join(claudeRoot, "CLAUDE.md"), "utf8"),
      readFile(path.join(sharedHome, ".codex", "AGENTS.md"), "utf8"),
      readFile(path.join(sharedHome, ".gemini", "GEMINI.md"), "utf8"),
    ]);
    const discoveredInstructions = new Map(
      await Promise.all(
        ["claude", "opencode", "codex", "gemini"].map(async (agent) => {
          const discovery = await executeFile(
            path.join(fakeBin, agent),
            ["debug", "instructions"],
            { cwd: consumerDirectory, env: environment },
          );
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
      throw new Error("packed setup did not preserve and discover managed guidance exactly once");
    }
  }

  await executeFile(
    npmExecutable,
    ["install", "--global", "--prefix", globalPrefix, "--ignore-scripts", archivePath],
    { cwd: temporaryRoot },
  );
  const globalExecutable =
    process.platform === "win32"
      ? path.join(globalPrefix, "ast-tool.cmd")
      : path.join(globalPrefix, "bin", "ast-tool");
  const globalInstall = await executeFile(globalExecutable, ["install-skill", "all"], {
    cwd: temporaryRoot,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: globalClaudeRoot,
      HERMES_HOME: globalHermesRoot,
    },
  });
  const globalInstallResult = parseJsonOutput(globalInstall.stdout);
  if (
    globalInstallResult.installations?.length !== 2 ||
    !globalInstallResult.installations.every((item) => item.status === "installed")
  ) {
    throw new Error(`global tarball install did not expose ast-tool: ${globalInstall.stdout}`);
  }
  try {
    await executeFile(globalExecutable, ["upgrade", "--check"], {
      cwd: temporaryRoot,
      env: {
        ...process.env,
        HOME: upgradeHome,
        TMPDIR: upgradeTemp,
        NPM_CONFIG_PREFIX: globalPrefix,
        NPM_CONFIG_REGISTRY: "http://127.0.0.1:1",
        NPM_CONFIG_FETCH_RETRIES: "0",
        NPM_CONFIG_FETCH_TIMEOUT: "1000",
      },
    });
    throw new Error("packed upgrade check unexpectedly reached a registry");
  } catch (error) {
    const failure = JSON.parse(error?.stderr ?? "{}");
    if (
      failure.code !== "UPGRADE_INSPECTION_FAILED" ||
      String(error?.stderr).includes(temporaryRoot)
    ) {
      throw error;
    }
  }
  if (
    (await readFile(path.join(upgradeHome, ".npmrc"), "utf8")) !== "token=smoke-sentinel\n" ||
    (await readdir(upgradeTemp)).some((entry) => entry.startsWith("ast-tool-upgrade-"))
  ) {
    throw new Error("packed upgrade check mutated config or retained temporary state");
  }
  const jsProject = path.join(temporaryRoot, "packed-js-project");
  const jsNested = path.join(jsProject, "nested");
  const jsPipeline = path.join(jsProject, "pipeline.json");
  await mkdir(path.join(jsProject, "src"), { recursive: true });
  await mkdir(jsNested);
  await writeFile(
    path.join(jsProject, "jsconfig.json"),
    JSON.stringify({ compilerOptions: { allowJs: true }, include: ["src/**/*.js"] }),
  );
  await writeFile(path.join(jsProject, "src", "value.js"), "export function packedJsValue() {}\n");
  await writeFile(
    jsPipeline,
    JSON.stringify({
      version: 1,
      steps: [{ id: "search", tool: "ast_search_symbols", input: { query: "packedJsValue" } }],
      emit: { $ref: "#/steps/search" },
    }),
  );
  const discovered = parseJsonOutput(
    (
      await executeFile(globalExecutable, ["run", jsPipeline], {
        cwd: jsNested,
        env: { ...process.env, AST_SYMBOL_INDEX_PERSISTENCE: "disabled" },
      })
    ).stdout,
  );
  if (!discovered.result?.symbols?.some((symbol) => symbol.selector?.includes("packedJsValue"))) {
    throw new Error(`packed CLI did not discover jsconfig: ${JSON.stringify(discovered)}`);
  }

  console.log(
    JSON.stringify({
      status: "ok",
      transport: "yarn-tarball",
      lifecycle_scripts: false,
      package_version: installedMetadata.version,
      node_engine: installedMetadata.engines?.node,
      handshake_version: installedMetadata.version,
      default_sqlite_rebuild: true,
      default_sqlite_restart_hit: true,
      private_cache_artifact: true,
      packed_error: true,
      stderr_correlation: true,
      global_install: true,
      project_discovery: true,
      upgrade_check: true,
      agent_setup: setupSupported,
      installed_targets: firstItems.length,
      idempotent_targets: secondItems.length,
    }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
