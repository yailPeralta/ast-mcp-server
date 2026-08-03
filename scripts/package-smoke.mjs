#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ast-tool-package-"));
const packageDirectory = path.join(temporaryRoot, "package");
const installPrefix = path.join(temporaryRoot, "prefix");
const claudeConfigDirectory = path.join(temporaryRoot, "claude");
const hermesHome = path.join(temporaryRoot, "hermes");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  await mkdir(packageDirectory, { recursive: true });
  const packed = await executeFile(
    npmExecutable,
    ["pack", "--silent", "--pack-destination", packageDirectory],
    { cwd: repositoryRoot },
  );
  const archiveName = packed.stdout.trim().split(/\r?\n/).at(-1);
  if (!archiveName?.endsWith(".tgz")) {
    throw new Error(`npm pack did not return an archive name: ${packed.stdout}`);
  }
  const archivePath = path.join(packageDirectory, archiveName);

  await executeFile(
    npmExecutable,
    ["install", "--global", "--prefix", installPrefix, "--ignore-scripts", archivePath],
    { cwd: temporaryRoot },
  );

  const executable =
    process.platform === "win32"
      ? path.join(installPrefix, "ast-tool.cmd")
      : path.join(installPrefix, "bin", "ast-tool");
  const environment = {
    ...process.env,
    CLAUDE_CONFIG_DIR: claudeConfigDirectory,
    HERMES_HOME: hermesHome,
  };
  const firstRun = await executeFile(executable, ["install-skill", "all"], {
    cwd: temporaryRoot,
    env: environment,
  });
  if (firstRun.stderr !== "") {
    throw new Error(`Packaged ast-tool wrote unexpected stderr: ${firstRun.stderr}`);
  }
  const installed = JSON.parse(firstRun.stdout);
  if (
    installed.installations?.length !== 2 ||
    !installed.installations.every((item) => item.status === "installed")
  ) {
    throw new Error(`Unexpected packaged install result: ${firstRun.stdout}`);
  }

  const expectedFiles = [
    path.join(claudeConfigDirectory, "skills", "structural-code-editing", "SKILL.md"),
    path.join(hermesHome, "skills", "software-development", "structural-code-editing", "SKILL.md"),
  ];
  const installedFiles = await Promise.all(expectedFiles.map((file) => readFile(file, "utf8")));
  if (!installedFiles.every((content) => content.includes('version: "3.2.0"'))) {
    throw new Error("The packaged installer did not write the bundled skill version.");
  }

  const replayRun = await executeFile(executable, ["install-skill", "all"], {
    cwd: temporaryRoot,
    env: environment,
  });
  const replay = JSON.parse(replayRun.stdout);
  if (!replay.installations.every((item) => item.status === "unchanged")) {
    throw new Error(`Packaged install was not idempotent: ${replayRun.stdout}`);
  }

  process.stdout.write(
    `${JSON.stringify({ status: "ok", transport: "installed-tarball", skill_targets: 2, idempotent: true })}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
