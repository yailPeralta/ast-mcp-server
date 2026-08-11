#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

export const GNU_MV_SOURCE = Object.freeze({
  version: "9.7",
  url: "https://mirrors.kernel.org/gnu/coreutils/coreutils-9.7.tar.xz",
  sha256: "e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf",
  maximumBytes: 8 * 1024 * 1024,
});

const systemMvPath = "/usr/bin/mv";
const commandTimeoutMs = 10 * 60 * 1000;
const buildTimeoutMs = 25 * 60 * 1000;
const maximumCapturedBytes = 64 * 1024;

function fail(message) {
  throw new Error(`CI GNU mv preparation failed: ${message}`);
}

function childEnvironment() {
  const environment = { ...process.env };
  delete environment.GIT_INDEX_FILE;
  delete environment.NODE_OPTIONS;
  return environment;
}

async function runProcess(binary, args, options = {}) {
  const { cwd, capture = false, allowFailure = false, timeoutMs = commandTimeoutMs } = options;
  const child = spawn(binary, args, {
    cwd,
    env: childEnvironment(),
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });
  const stdout = [];
  const stderr = [];
  let capturedBytes = 0;
  const captureChunk = (destination) => (chunk) => {
    capturedBytes += chunk.length;
    if (capturedBytes > maximumCapturedBytes) {
      child.kill("SIGKILL");
      return;
    }
    destination.push(Buffer.from(chunk));
  };
  if (capture) {
    child.stdout.on("data", captureChunk(stdout));
    child.stderr.on("data", captureChunk(stderr));
  }
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  if (capturedBytes > maximumCapturedBytes) fail(`${binary} exceeded its output bound.`);
  if (!allowFailure && (result.code !== 0 || result.signal !== null)) {
    fail(`${binary} failed (code=${String(result.code)}, signal=${String(result.signal)}).`);
  }
  return {
    ...result,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

async function readRegularFile(filePath) {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1) {
    fail("downloaded coreutils source must be a unique physical regular file.");
  }
  if (fileStat.size <= 0 || fileStat.size > GNU_MV_SOURCE.maximumBytes) {
    fail("downloaded coreutils source violates the byte bound.");
  }
  return readFile(filePath);
}

async function downloadSource(archivePath) {
  await runProcess(
    "/usr/bin/curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--max-redirs",
      "0",
      "--tlsv1.2",
      "--connect-timeout",
      "15",
      "--max-time",
      "120",
      "--max-filesize",
      String(GNU_MV_SOURCE.maximumBytes),
      "--output",
      archivePath,
      GNU_MV_SOURCE.url,
    ],
    { timeoutMs: 150_000 },
  );
  const persisted = await readRegularFile(archivePath);
  if (createHash("sha256").update(persisted).digest("hex") !== GNU_MV_SOURCE.sha256) {
    fail("persisted GNU source SHA-256 does not match the pin.");
  }
}

async function assertFileAbsent(filePath) {
  try {
    await stat(filePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  fail("GNU mv left a source path present after successful publication.");
}

export async function probeGnuMv(binary = systemMvPath, temporaryRoot = process.env.RUNNER_TEMP) {
  if (!path.isAbsolute(binary)) fail("GNU mv binary must be absolute.");
  if (typeof temporaryRoot !== "string" || !path.isAbsolute(temporaryRoot)) {
    fail("probe temporary root must be absolute.");
  }
  await access(binary, fsConstants.X_OK);
  const version = await runProcess(binary, ["--version"], { capture: true });
  const expectedBanner = `mv (GNU coreutils) ${GNU_MV_SOURCE.version}`;
  if (version.stdout.split(/\r?\n/u)[0] !== expectedBanner) {
    fail(`GNU mv version must be exactly ${GNU_MV_SOURCE.version}.`);
  }

  const probeRoot = await mkdtemp(path.join(temporaryRoot, "ast-gnu-mv-probe-"));
  try {
    const successfulSource = path.join(probeRoot, "successful-source");
    const successfulDestination = path.join(probeRoot, "successful-destination");
    await mkdir(successfulSource);
    await writeFile(path.join(successfulSource, "value"), "source\n", "utf8");
    await runProcess(
      binary,
      [
        "--update=none-fail",
        "--no-copy",
        "--no-target-directory",
        "--",
        successfulSource,
        successfulDestination,
      ],
      { capture: true },
    );
    await assertFileAbsent(successfulSource);
    if ((await readFile(path.join(successfulDestination, "value"), "utf8")) !== "source\n") {
      fail("GNU mv successful publication postimage is invalid.");
    }

    const collisionSource = path.join(probeRoot, "collision-source");
    const collisionDestination = path.join(probeRoot, "collision-destination");
    await mkdir(collisionSource);
    await mkdir(collisionDestination);
    await writeFile(path.join(collisionSource, "value"), "source\n", "utf8");
    await writeFile(path.join(collisionDestination, "value"), "destination\n", "utf8");
    const collision = await runProcess(
      binary,
      [
        "--update=none-fail",
        "--no-copy",
        "--no-target-directory",
        "--",
        collisionSource,
        collisionDestination,
      ],
      { capture: true, allowFailure: true },
    );
    if (collision.code !== 1 || collision.signal !== null) {
      fail("GNU mv collision probe did not return the exact expected failure status.");
    }
    if (
      (await readFile(path.join(collisionSource, "value"), "utf8")) !== "source\n" ||
      (await readFile(path.join(collisionDestination, "value"), "utf8")) !== "destination\n"
    ) {
      fail("GNU mv collision probe changed source or destination bytes.");
    }
  } finally {
    await rm(probeRoot, { recursive: true, force: true });
  }
  return Object.freeze({ status: "pass", version: GNU_MV_SOURCE.version });
}

async function physicalRunnerTemp() {
  if (process.env.CI !== "true") fail("prepare mode requires CI=true.");
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("prepare mode supports only Linux x64.");
  }
  const configured = process.env.RUNNER_TEMP;
  if (typeof configured !== "string" || !path.isAbsolute(configured)) {
    fail("RUNNER_TEMP must be an absolute path.");
  }
  const physical = await realpath(configured);
  const physicalStat = await lstat(physical);
  if (!physicalStat.isDirectory() || physicalStat.isSymbolicLink()) {
    fail("RUNNER_TEMP must resolve to a physical directory.");
  }
  return physical;
}

export async function prepareGnuMv() {
  const runnerTemp = await physicalRunnerTemp();
  try {
    const existing = await probeGnuMv(systemMvPath, runnerTemp);
    return Object.freeze({ ...existing, source: "runner" });
  } catch {
    // The hosted image is allowed to lack the exact primitive; the pinned build below is authoritative.
  }

  const buildRoot = await mkdtemp(path.join(runnerTemp, "ast-coreutils-build-"));
  try {
    const archivePath = path.join(buildRoot, `coreutils-${GNU_MV_SOURCE.version}.tar.xz`);
    await downloadSource(archivePath);
    await runProcess("/usr/bin/tar", ["-xJf", archivePath, "-C", buildRoot]);
    const sourceRoot = path.join(buildRoot, `coreutils-${GNU_MV_SOURCE.version}`);
    const sourceStat = await lstat(sourceRoot);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      fail("extracted GNU source root is not a physical directory.");
    }
    await runProcess(path.join(sourceRoot, "configure"), ["--disable-nls", "--without-selinux"], {
      cwd: sourceRoot,
    });
    await runProcess("/usr/bin/make", ["-j2"], { cwd: sourceRoot, timeoutMs: buildTimeoutMs });
    const builtMv = path.join(sourceRoot, "src", "mv");
    await probeGnuMv(builtMv, runnerTemp);
    await runProcess("/usr/bin/sudo", [
      "/usr/bin/install",
      "-o",
      "root",
      "-g",
      "root",
      "-m",
      "0755",
      builtMv,
      systemMvPath,
    ]);
    const installed = await probeGnuMv(systemMvPath, runnerTemp);
    return Object.freeze({ ...installed, source: "pinned-gnu-source" });
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || (mode !== "prepare" && mode !== "probe")) {
    process.stderr.write("Usage: node scripts/ci-prepare-gnu-mv.mjs <prepare|probe>\n");
    process.exitCode = 1;
  } else {
    try {
      const result =
        mode === "prepare" ? await prepareGnuMv() : await probeGnuMv(systemMvPath, "/tmp");
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "CI GNU mv preparation failed.";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  }
}
