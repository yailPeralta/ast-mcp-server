#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import console from "node:console";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ast-package-smoke-"));
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
  if (
    installedMetadata.name !== releaseMetadata.name ||
    installedMetadata.version !== releaseMetadata.version ||
    installedMetadata.engines?.node !== releaseMetadata.engines?.node ||
    installedMetadata.license !== releaseMetadata.license ||
    installedMetadata.repository?.url !== releaseMetadata.repository?.url ||
    installedMetadata.publishConfig?.access !== releaseMetadata.publishConfig?.access ||
    !installedChangelog.includes(`## [${releaseMetadata.version}]`)
  ) {
    throw new Error("installed tarball release metadata is incomplete");
  }

  await mkdir(path.join(mcpFixtureRoot, "src"), { recursive: true });
  await writeFile(
    path.join(mcpFixtureRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*"] }),
  );
  await writeFile(path.join(mcpFixtureRoot, "src/value.ts"), "export const value = 1;\n");

  const mcpClient = new Client({ name: "ast-package-smoke", version: "1.0.0" });
  const mcpTransport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(installedPackageRoot, "dist", "index.js")],
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
    (setupSupported && !firstItems.every((item) => item.mcp === "configured"))
  ) {
    throw new Error(`tarball setup did not configure both agents: ${first.stdout}`);
  }
  if (
    secondItems?.length !== (setupSupported ? 6 : 2) ||
    !secondItems.every((item) => item.skill === "unchanged" || item.status === "unchanged") ||
    (setupSupported && !secondItems.every((item) => item.mcp === "unchanged"))
  ) {
    throw new Error(`tarball setup was not idempotent: ${second.stdout}`);
  }

  const claudeSkill = await readFile(
    path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md"),
    "utf8",
  );
  const hermesSkill = await readFile(
    path.join(hermesRoot, "skills", "software-development", "structural-code-editing", "SKILL.md"),
    "utf8",
  );
  if (!claudeSkill.includes("name: structural-code-editing") || claudeSkill !== hermesSkill) {
    throw new Error("installed tarball skills do not match");
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

  console.log(
    JSON.stringify({
      status: "ok",
      transport: "yarn-tarball",
      lifecycle_scripts: false,
      package_version: installedMetadata.version,
      node_engine: installedMetadata.engines?.node,
      handshake_version: installedMetadata.version,
      packed_error: true,
      stderr_correlation: true,
      global_install: true,
      agent_setup: setupSupported,
      installed_targets: firstItems.length,
      idempotent_targets: secondItems.length,
    }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
