import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { UpgradeRuntime } from "./upgrade.js";

interface ExecutionResult {
  stdout: string;
  stderr: string;
}
type Execute = (
  executable: string,
  args: readonly string[],
  options: { encoding: "utf8"; windowsHide: true; env: NodeJS.ProcessEnv },
) => Promise<ExecutionResult>;
interface RuntimeOptions {
  nodeExecutable?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  execute?: Execute;
  temporaryParent?: string;
  removeTree?: (value: string) => Promise<void>;
}
export interface UpgradeRuntimeLease {
  runtime: UpgradeRuntime;
  dispose(): Promise<void>;
}

export class UpgradeCleanupError extends Error {
  readonly code = "UPGRADE_CLEANUP_FAILED";
  constructor(readonly primaryCode?: string) {
    super("Upgrade temporary files could not be removed safely.");
    this.name = "UpgradeCleanupError";
  }
}

const executeFile = promisify(execFile) as unknown as Execute;

async function npmCliFor(node: string, platform: NodeJS.Platform): Promise<string | undefined> {
  const p = platform === "win32" ? path.win32 : path.posix;
  const root = platform === "win32" ? p.dirname(node) : p.resolve(p.dirname(node), "..");
  const candidates =
    platform === "win32"
      ? [p.join(root, "node_modules", "npm", "bin", "npm-cli.js")]
      : [
          p.join(p.dirname(node), "npm"),
          p.join(root, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
        ];
  for (const candidate of candidates) {
    try {
      const resolved = await realpath(candidate);
      if ((await lstat(resolved)).isFile()) return resolved;
    } catch {
      // Try the next layout owned by this Node installation.
    }
  }
  return;
}

async function copyUserConfig(environment: NodeJS.ProcessEnv, destination: string): Promise<void> {
  const source =
    environment.npm_config_userconfig ??
    environment.NPM_CONFIG_USERCONFIG ??
    path.join(environment.HOME ?? os.homedir(), ".npmrc");
  try {
    await copyFile(source, destination);
    await chmod(destination, 0o600);
  } catch {
    await writeFile(destination, "", { encoding: "utf8", mode: 0o600 });
  }
}

async function restoreOwnerAccess(value: string): Promise<void> {
  const info = await lstat(value);
  if (info.isSymbolicLink()) return;
  await chmod(value, info.isDirectory() ? 0o700 : 0o600);
  if (info.isDirectory())
    for (const child of await readdir(value)) await restoreOwnerAccess(path.join(value, child));
}

async function cleanupBoundary(
  boundary: string,
  removeTree = (value: string) => rm(value, { recursive: true, force: true }),
): Promise<void> {
  try {
    await restoreOwnerAccess(boundary);
    await removeTree(boundary);
  } catch {
    throw new UpgradeCleanupError();
  }
  try {
    await lstat(boundary);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new UpgradeCleanupError();
  }
  throw new UpgradeCleanupError();
}

export async function createUpgradeRuntime(
  executable: string,
  options: RuntimeOptions = {},
): Promise<UpgradeRuntimeLease> {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const execute = options.execute ?? executeFile;
  const boundary = await mkdtemp(
    path.join(options.temporaryParent ?? os.tmpdir(), "ast-tool-upgrade-"),
  );
  try {
    const cache = path.join(boundary, "cache");
    const logs = path.join(boundary, "logs");
    const userConfig = path.join(boundary, "npmrc");
    await Promise.all([mkdir(cache), mkdir(logs), copyUserConfig(environment, userConfig)]);
    const npmEnvironment: NodeJS.ProcessEnv = {
      ...environment,
      npm_config_cache: cache,
      npm_config_logs_dir: logs,
      npm_config_userconfig: userConfig,
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
    };
    const run = async (file: string, args: readonly string[]) =>
      (await execute(file, args, { encoding: "utf8", windowsHide: true, env: npmEnvironment }))
        .stdout;
    const cliExecutable = await realpath(executable);
    const packageRoot = path.resolve(path.dirname(cliExecutable), "..");
    const npmCliExecutable = await npmCliFor(nodeExecutable, platform);
    const p = platform === "win32" ? path.win32 : path.posix;
    const voltaExecutable = environment.VOLTA_HOME
      ? p.resolve(environment.VOLTA_HOME, "bin", platform === "win32" ? "volta.exe" : "volta")
      : undefined;
    const runtime: UpgradeRuntime = {
      packageRoot,
      cliExecutable,
      nodeExecutable,
      ...(npmCliExecutable ? { npmCliExecutable } : {}),
      ...(voltaExecutable ? { voltaExecutable } : {}),
      platform,
      realpath,
      directDirectory: async (value) => {
        const info = await lstat(value).catch(() => undefined);
        return info?.isDirectory() === true && info.isSymbolicLink() === false;
      },
      readPackage: async (root) =>
        JSON.parse(await readFile(path.join(root, "package.json"), "utf8")),
      latestVersion: async (provenance) => {
        const stdout =
          provenance === "volta"
            ? await run(voltaExecutable!, [
                "run",
                "npm",
                "view",
                "ast-mcp-server@latest",
                "version",
                "--json",
              ])
            : await run(nodeExecutable, [
                npmCliExecutable!,
                "view",
                "ast-mcp-server@latest",
                "version",
                "--json",
              ]);
        const value: unknown = JSON.parse(stdout);
        if (typeof value !== "string") throw new Error("invalid registry response");
        return value;
      },
      run,
    };
    return {
      runtime,
      dispose: () => cleanupBoundary(boundary, options.removeTree),
    };
  } catch (error) {
    try {
      await cleanupBoundary(boundary, options.removeTree);
    } catch {
      throw new UpgradeCleanupError("UPGRADE_RUNTIME_CREATION_FAILED");
    }
    throw error;
  }
}
