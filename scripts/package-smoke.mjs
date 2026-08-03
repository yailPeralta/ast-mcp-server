#!/usr/bin/env node

import { execFile } from "node:child_process";
import console from "node:console";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const yarnExecutable = process.platform === "win32" ? "yarn.cmd" : "yarn";
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ast-package-smoke-"));
const packageDirectory = path.join(temporaryRoot, "package");
const consumerDirectory = path.join(temporaryRoot, "consumer");
const archivePath = path.join(packageDirectory, "ast-mcp-server.tgz");
const claudeRoot = path.join(temporaryRoot, "claude");
const hermesRoot = path.join(temporaryRoot, "hermes");
const fakeBin = path.join(temporaryRoot, "bin");
const fakeClaudeState = path.join(temporaryRoot, "fake-claude-state.json");
const fakeHermesState = path.join(temporaryRoot, "fake-hermes-state.json");

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

async function installFakeAgents() {
  await mkdir(fakeBin, { recursive: true });
  const fixture = path.join(repositoryRoot, "scripts", "fixtures", "fake-agent.mjs");
  for (const agent of ["claude", "hermes"]) {
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
  const scriptPolicy = await executeFile(yarnExecutable, ["config", "get", "enableScripts"], {
    cwd: consumerDirectory,
  });
  if (scriptPolicy.stdout.trim() !== "false") {
    throw new Error(`consumer lifecycle scripts are enabled: ${scriptPolicy.stdout}`);
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
        }
      : {}),
    CLAUDE_CONFIG_DIR: claudeRoot,
    HERMES_HOME: hermesRoot,
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
    firstItems?.length !== 2 ||
    !firstItems.every((item) => item.skill === "installed" || item.status === "installed") ||
    (setupSupported && !firstItems.every((item) => item.mcp === "configured"))
  ) {
    throw new Error(`tarball setup did not configure both agents: ${first.stdout}`);
  }
  if (
    secondItems?.length !== 2 ||
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

  console.log(
    JSON.stringify({
      status: "ok",
      transport: "yarn-tarball",
      lifecycle_scripts: false,
      agent_setup: setupSupported,
      installed_targets: firstItems.length,
      idempotent_targets: secondItems.length,
    }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
