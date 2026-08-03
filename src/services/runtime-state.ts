import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface RuntimeStateOptions {
  stateDirectory?: string;
}

export function resolveRuntimeStateDirectory(options: RuntimeStateOptions = {}): string {
  if (options.stateDirectory) return path.resolve(options.stateDirectory);
  if (process.env.AST_TOOL_STATE_DIR) return path.resolve(process.env.AST_TOOL_STATE_DIR);
  const base = process.env.XDG_STATE_HOME
    ? path.resolve(process.env.XDG_STATE_HOME)
    : path.join(os.homedir(), ".local", "state");
  return path.join(base, "ast-tool");
}

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    const root = path.parse(directory).root;
    let current = root;
    for (const segment of path.relative(root, directory).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const currentStat = await lstat(current);
      if (currentStat.isSymbolicLink()) {
        throw new Error(`Runtime state path must not traverse symbolic links: ${current}`);
      }
    }
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory()) {
      throw new Error(`Runtime state path is not a directory: ${directory}`);
    }
    const uid = process.getuid?.();
    if (uid !== undefined && directoryStat.uid !== uid) {
      throw new Error(`Runtime state directory is not owned by the current user: ${directory}`);
    }
    await chmod(directory, 0o700);
  }
}

export async function withWorkspaceFileLock<T>(
  workspaceKey: string,
  options: RuntimeStateOptions,
  callback: () => Promise<T>,
): Promise<T> {
  const locksDirectory = path.join(resolveRuntimeStateDirectory(options), "locks");
  await ensurePrivateDirectory(locksDirectory);
  const key = createHash("sha256").update(workspaceKey).digest("hex");
  const lockPath = path.join(locksDirectory, `${key}.lock`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        workspace_key: workspaceKey,
        phase: "applying",
        created_at: new Date().toISOString(),
      }),
      "utf8",
    );
    await handle.sync();
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Another AST apply holds the workspace lock. Inspect and remove a stale lock only if no apply is running: ${lockPath}`,
        { cause: error },
      );
    }
    throw error;
  }

  try {
    return await callback();
  } finally {
    try {
      await handle.close();
    } finally {
      await unlink(lockPath);
    }
  }
}
