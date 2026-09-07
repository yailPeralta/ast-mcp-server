import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runBoundedCommand } from "./runtime-process.mjs";

export const PNPM_VERSION = "11.7.0";
export const PNPM_SHA512_HEX =
  "19cc852c120c7125760f2443ee6be0ca5b40f9f50598de1a09a1f177503e010e57c23c77646e01e761de59bf874fb22a3398c33ab9691fc13eb946b6f0f4d620";
export const PNPM_DESCRIPTOR = `pnpm@${PNPM_VERSION}+sha512.${PNPM_SHA512_HEX}`;
export const PNPM_REGISTRY_INTEGRITY =
  "sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==";
const REGISTRY = "https://registry.npmjs.org";

function blocked(message) {
  throw new Error(`BLOCKED: private pnpm authority: ${message}`);
}

export async function createPrivatePnpmEnvironment({
  temporaryRoot,
  nodeBin = process.execPath,
  nodeBinDir = path.dirname(nodeBin),
  baseEnvironment = process.env,
}) {
  const stateRoot = path.join(temporaryRoot, "package-manager");
  const binDirectory = path.join(stateRoot, "bin");
  const paths = {
    COREPACK_HOME: path.join(stateRoot, "corepack"),
    PNPM_HOME: path.join(stateRoot, "pnpm"),
    HOME: path.join(stateRoot, "home"),
    XDG_CACHE_HOME: path.join(stateRoot, "xdg-cache"),
    XDG_CONFIG_HOME: path.join(stateRoot, "xdg-config"),
    XDG_DATA_HOME: path.join(stateRoot, "xdg-data"),
    XDG_STATE_HOME: path.join(stateRoot, "xdg-state"),
    npm_config_cache: path.join(stateRoot, "npm-cache"),
    npm_config_userconfig: path.join(stateRoot, "npmrc"),
  };
  await Promise.all([
    mkdir(binDirectory, { recursive: true }),
    ...Object.entries(paths)
      .filter(([key]) => key !== "npm_config_userconfig")
      .map(([, directory]) => mkdir(directory, { recursive: true })),
  ]);
  await writeFile(paths.npm_config_userconfig, "", { mode: 0o600 });
  return {
    binDirectory,
    nodeBin,
    environment: {
      ...baseEnvironment,
      ...paths,
      PATH: [binDirectory, nodeBinDir, baseEnvironment.PATH ?? ""]
        .filter(Boolean)
        .join(path.delimiter),
      COREPACK_DEFAULT_TO_LATEST: "0",
      COREPACK_ENABLE_AUTO_PIN: "0",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      COREPACK_INTEGRITY_KEYS: "0",
      npm_config_registry: REGISTRY,
      NODE_OPTIONS: "",
      CI: "true",
    },
  };
}

export function isCorepackCompatibilityFailure(error) {
  const message = `${error instanceof Error ? error.message : String(error)} ${error?.stderr ?? ""}`;
  return /unsupported package manager specification|unsupported locator|not supported by this corepack|invalid package manager specification/iu.test(
    message,
  );
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export async function createPnpmExecLauncher({ binDirectory, nodeBin, entrypoint }) {
  if (process.platform === "win32") blocked("fallback launcher is unsupported on win32");
  const launcher = path.join(binDirectory, "pnpm");
  await writeFile(
    launcher,
    `#!/bin/sh\nexec ${shellQuote(nodeBin)} ${shellQuote(entrypoint)} "$@"\n`,
    "utf8",
  );
  await chmod(launcher, 0o700);
  return launcher;
}

async function installVerifiedFallback({ environment, binDirectory, nodeBin, cwd, runCommand }) {
  const fallbackRoot = path.join(environment.COREPACK_HOME, "fallback");
  await mkdir(fallbackRoot, { recursive: true });
  const packed = await runCommand(
    "npm",
    ["pack", "--json", `pnpm@${PNPM_VERSION}`, "--pack-destination", fallbackRoot],
    { cwd, env: environment, timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  let record;
  try {
    [record] = JSON.parse(packed.stdout);
  } catch {
    blocked("fallback registry metadata was not valid JSON");
  }
  if (record?.integrity !== PNPM_REGISTRY_INTEGRITY || typeof record?.filename !== "string")
    blocked("fallback registry identity differs from the pin");
  const archive = path.join(fallbackRoot, path.basename(record.filename));
  const observed = `sha512-${createHash("sha512")
    .update(await readFile(archive))
    .digest("base64")}`;
  if (observed !== PNPM_REGISTRY_INTEGRITY)
    blocked("fallback archive integrity differs from the pin");
  const extracted = path.join(fallbackRoot, "extracted");
  await mkdir(extracted, { recursive: true });
  await runCommand("tar", ["-xzf", archive, "-C", extracted], {
    cwd,
    env: environment,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  const entrypoint = path.join(extracted, "package", "bin", "pnpm.cjs");
  await readFile(entrypoint);
  await createPnpmExecLauncher({ binDirectory, nodeBin, entrypoint });
  return "verified-archive-launcher";
}

export async function provisionPrivatePnpm({
  environment,
  binDirectory,
  nodeBin,
  cwd,
  runCommand = runBoundedCommand,
}) {
  await runCommand("corepack", ["enable", "pnpm", "--install-directory", binDirectory], {
    cwd,
    env: environment,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  let source = "corepack";
  try {
    await runCommand("corepack", ["prepare", PNPM_DESCRIPTOR, "--activate"], {
      cwd,
      env: environment,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    if (!isCorepackCompatibilityFailure(error)) throw error;
    source = await installVerifiedFallback({ environment, binDirectory, nodeBin, cwd, runCommand });
  }
  const launcher = path.join(binDirectory, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  const observed = (
    await runCommand(launcher, ["--version"], {
      cwd,
      env: environment,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout.trim();
  if (observed !== PNPM_VERSION) blocked("pnpm version differs from the pin");
  return { version: observed, descriptor: PNPM_DESCRIPTOR, sha512: PNPM_SHA512_HEX, source };
}
