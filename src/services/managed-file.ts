import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";

export type ManagedFileStatus = "installed" | "updated" | "unchanged";

interface ManagedDirectoryBinding {
  anchorPath: string;
  anchorDev: string;
  anchorIno: string;
  missingDirectories: string[];
}

interface ManagedObjectIdentity {
  dev: string;
  ino: string;
}

export interface ManagedFileApplyContext {
  createdDirectories: Map<string, ManagedObjectIdentity>;
  authenticatedFiles: Map<string, ManagedObjectIdentity>;
}

export type ManagedFileCommitState = "committed" | "possibly_committed";
export type ManagedFileRollbackState = "succeeded" | "failed";

export class ManagedFileApplyError extends Error {
  readonly commitState: ManagedFileCommitState;
  readonly rollbackState: "failed" | undefined;

  constructor(
    message: string,
    commitState: ManagedFileCommitState,
    options?: ErrorOptions,
    rollbackState?: "failed",
  ) {
    super(message, options);
    this.name = "ManagedFileApplyError";
    this.commitState = commitState;
    this.rollbackState = rollbackState;
  }
}

export class ManagedFileRollbackError extends Error {
  readonly rollbackState: "succeeded";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ManagedFileRollbackError";
    this.rollbackState = "succeeded";
  }
}

export interface ManagedFileApplyHooks {
  afterTemporaryReady?: (context: {
    plan: ManagedFilePlan;
    temporaryPath: string;
    destinationPath: string;
  }) => void | Promise<void>;
  afterDestinationRevalidated?: (context: {
    plan: ManagedFilePlan;
    temporaryPath: string;
    destinationPath: string;
  }) => void | Promise<void>;
  afterCommit?: (context: {
    plan: ManagedFilePlan;
    temporaryPath: string;
    destinationPath: string;
  }) => void | Promise<void>;
  beforeCleanup?: (context: {
    plan: ManagedFilePlan;
    temporaryPath: string;
    destinationPath: string;
  }) => void | Promise<void>;
  beforeRollback?: (context: {
    plan: ManagedFilePlan;
    temporaryPath: string;
    destinationPath: string;
  }) => void | Promise<void>;
  afterRollback?: (context: {
    plan: ManagedFilePlan;
    temporaryPath: string;
    destinationPath: string;
  }) => void | Promise<void>;
}

type ManagedFileState =
  | { exists: false; kind: "missing" }
  | {
      exists: true;
      kind: "regular";
      sha256: string;
      mode: number;
      dev: string;
      ino: string;
    };

export type ManagedFileSnapshot = ManagedFileState & {
  directory: ManagedDirectoryBinding;
};

export interface ManagedFilePlan {
  path: string;
  snapshot: ManagedFileSnapshot;
  postimage: Buffer;
  postimageSha256: string;
  status: ManagedFileStatus;
}

const GNU_LN_PATH = "/usr/bin/ln";
const GNU_MV_PATH = "/usr/bin/mv";
const COREUTILS_TIMEOUT_MS = 5_000;
const COREUTILS_STDERR_LIMIT = 4_096;

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function objectIdentity(stats: BigIntStats): ManagedObjectIdentity {
  return { dev: stats.dev.toString(), ino: stats.ino.toString() };
}

function identitiesEqual(
  left: ManagedObjectIdentity | undefined,
  right: ManagedObjectIdentity | undefined,
): boolean {
  return (
    left !== undefined && right !== undefined && left.dev === right.dev && left.ino === right.ino
  );
}

async function runCoreutils(
  executable: string,
  args: string[],
  inheritedDescriptors: number[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      shell: false,
      stdio: ["ignore", "ignore", "pipe", ...inheritedDescriptors],
      windowsHide: true,
    });
    let stderrBytes = 0;
    let settled = false;
    let requestedFailure: Error | undefined;
    const requestFailure = (message: string, cause?: unknown): void => {
      if (settled || requestedFailure !== undefined) return;
      requestedFailure = new Error(message, cause === undefined ? undefined : { cause });
      clearTimeout(timeout);
      child.kill("SIGKILL");
    };
    const timeout = setTimeout(
      () => requestFailure(`Managed Linux primitive timed out: ${path.basename(executable)}`),
      COREUTILS_TIMEOUT_MS,
    );
    child.stderr!.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > COREUTILS_STDERR_LIMIT) {
        requestFailure(
          `Managed Linux primitive exceeded its stderr limit: ${path.basename(executable)}`,
        );
      }
    });
    child.on("error", (error) => {
      requestFailure(`Managed Linux primitive is unavailable: ${path.basename(executable)}`, error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (requestedFailure !== undefined) {
        reject(requestedFailure);
        return;
      }
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Managed Linux primitive failed: ${path.basename(executable)} (${signal ?? code ?? "unknown"})`,
        ),
      );
    });
  });
}

export function hashBytes(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function canonicalizeFuturePath(target: string): Promise<string> {
  const absolute = path.resolve(target);
  const suffix: string[] = [];
  let cursor = path.dirname(absolute);
  for (;;) {
    try {
      return path.join(await realpath(cursor), ...suffix.reverse(), path.basename(absolute));
    } catch (error) {
      if (errno(error) !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function sameIdentity(before: BigIntStats, after: BigIntStats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs &&
    before.mode === after.mode
  );
}

function directoryDescriptorPath(handle: FileHandle): string {
  return `/proc/self/fd/${handle.fd}`;
}

function directoryOpenFlags(): number {
  if (process.platform !== "linux") {
    throw new Error("Managed file mutation is supported only on the verified Linux target.");
  }
  return fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
}

async function captureDirectoryBinding(directory: string): Promise<ManagedDirectoryBinding> {
  const missingDirectories: string[] = [];
  let cursor = path.resolve(directory);

  for (;;) {
    let handle: FileHandle;
    try {
      handle = await open(cursor, directoryOpenFlags());
    } catch (error) {
      if (errno(error) !== "ENOENT") {
        throw new Error(`Managed file parent is not a safe directory: ${cursor}`, {
          cause: error,
        });
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingDirectories.push(path.basename(cursor));
      cursor = parent;
      continue;
    }

    try {
      const directoryStat = await handle.stat({ bigint: true });
      if (!directoryStat.isDirectory()) {
        throw new Error(`Managed file parent is not a directory: ${cursor}`);
      }
      return {
        anchorPath: await realpath(directoryDescriptorPath(handle)),
        anchorDev: directoryStat.dev.toString(),
        anchorIno: directoryStat.ino.toString(),
        missingDirectories: missingDirectories.reverse(),
      };
    } finally {
      await handle.close();
    }
  }
}

function sameDirectoryBinding(
  left: ManagedDirectoryBinding,
  right: ManagedDirectoryBinding,
): boolean {
  return (
    left.anchorPath === right.anchorPath &&
    left.anchorDev === right.anchorDev &&
    left.anchorIno === right.anchorIno &&
    left.missingDirectories.length === right.missingDirectories.length &&
    left.missingDirectories.every((segment, index) => segment === right.missingDirectories[index])
  );
}

export function createManagedFileApplyContext(): ManagedFileApplyContext {
  return { createdDirectories: new Map(), authenticatedFiles: new Map() };
}

function createdDirectoryKey(
  binding: ManagedDirectoryBinding,
  segments: readonly string[],
): string {
  return `${binding.anchorDev}:${binding.anchorIno}:${segments.join("/")}`;
}

function managedFileKey(plan: ManagedFilePlan): string {
  const binding = plan.snapshot.directory;
  return `${binding.anchorDev}:${binding.anchorIno}:${binding.missingDirectories.join("/")}:${path.basename(plan.path)}`;
}

async function openBoundDirectory(
  binding: ManagedDirectoryBinding,
  createMissing: boolean,
  context: ManagedFileApplyContext,
): Promise<FileHandle> {
  let current = await open(binding.anchorPath, directoryOpenFlags());
  try {
    const anchorStat = await current.stat({ bigint: true });
    if (
      !anchorStat.isDirectory() ||
      anchorStat.dev.toString() !== binding.anchorDev ||
      anchorStat.ino.toString() !== binding.anchorIno
    ) {
      throw new Error(`Managed file parent changed after preflight: ${binding.anchorPath}`);
    }

    const traversedSegments: string[] = [];
    for (const segment of binding.missingDirectories) {
      const childPath = path.join(directoryDescriptorPath(current), segment);
      const key = createdDirectoryKey(binding, [...traversedSegments, segment]);
      const expectedIdentity = context.createdDirectories.get(key);
      let child: FileHandle;
      if (expectedIdentity !== undefined) {
        child = await open(childPath, directoryOpenFlags());
      } else {
        if (!createMissing) {
          throw new Error(`Managed file parent changed after preflight: ${childPath}`);
        }
        try {
          await mkdir(childPath);
        } catch (error) {
          if (errno(error) === "EEXIST") {
            throw new Error(`Managed file parent appeared after preflight: ${childPath}`, {
              cause: error,
            });
          }
          throw error;
        }
        const pathIdentity = await lstat(childPath);
        if (!pathIdentity.isDirectory() || pathIdentity.isSymbolicLink()) {
          throw new Error(`Managed file parent changed after preflight: ${childPath}`);
        }
        child = await open(childPath, directoryOpenFlags());
        const openedIdentity = await child.stat();
        if (
          pathIdentity.dev !== openedIdentity.dev ||
          pathIdentity.ino !== openedIdentity.ino ||
          !openedIdentity.isDirectory()
        ) {
          await child.close();
          throw new Error(`Managed file parent changed after preflight: ${childPath}`);
        }
      }
      const childStat = await child.stat({ bigint: true });
      if (!childStat.isDirectory()) {
        await child.close();
        throw new Error(`Managed file parent is not a directory: ${childPath}`);
      }
      const identity = { dev: childStat.dev.toString(), ino: childStat.ino.toString() };
      if (
        expectedIdentity !== undefined &&
        (identity.dev !== expectedIdentity.dev || identity.ino !== expectedIdentity.ino)
      ) {
        await child.close();
        throw new Error(`Managed file parent changed after preflight: ${childPath}`);
      }
      if (expectedIdentity === undefined) context.createdDirectories.set(key, identity);
      await current.close();
      current = child;
      traversedSegments.push(segment);
    }
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

async function captureManagedFileState(
  directory: FileHandle,
  basename: string,
): Promise<{ state: ManagedFileState; content?: Buffer }> {
  const destination = path.join(directoryDescriptorPath(directory), basename);
  let pathBefore: BigIntStats;
  try {
    pathBefore = await lstat(destination, { bigint: true });
  } catch (error) {
    if (errno(error) === "ENOENT") {
      return { state: { exists: false, kind: "missing" } };
    }
    throw error;
  }
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw new Error(`Managed file destination is not a regular file: ${destination}`);
  }

  const handle = await open(destination, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameIdentity(pathBefore, before)) {
      throw new Error(`Managed file changed while it was being inspected: ${destination}`);
    }
    const content = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(destination, { bigint: true }).catch((error: unknown) => {
      if (errno(error) === "ENOENT") {
        throw new Error(`Managed file changed while it was being inspected: ${destination}`);
      }
      throw error;
    });
    if (
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      !sameIdentity(before, after) ||
      !sameIdentity(after, pathAfter)
    ) {
      throw new Error(`Managed file changed while it was being inspected: ${destination}`);
    }
    return {
      state: {
        exists: true,
        kind: "regular",
        sha256: hashBytes(content),
        mode: Number(before.mode & 0o777n),
        dev: before.dev.toString(),
        ino: before.ino.toString(),
      },
      content,
    };
  } finally {
    await handle.close();
  }
}

export async function captureManagedFileSnapshot(
  destination: string,
): Promise<ManagedFileSnapshot> {
  return (await captureManagedFilePreimage(destination)).snapshot;
}

export async function captureManagedFilePreimage(
  destination: string,
): Promise<{ snapshot: ManagedFileSnapshot; content?: Buffer }> {
  const directory = await captureDirectoryBinding(path.dirname(destination));
  if (directory.missingDirectories.length > 0) {
    return { snapshot: { exists: false, kind: "missing", directory } };
  }
  const handle = await openBoundDirectory(directory, false, createManagedFileApplyContext());
  try {
    const captured = await captureManagedFileState(handle, path.basename(destination));
    return {
      snapshot: { ...captured.state, directory },
      ...(captured.content === undefined ? {} : { content: captured.content }),
    };
  } finally {
    await handle.close();
  }
}

export function snapshotsEqual(left: ManagedFileSnapshot, right: ManagedFileSnapshot): boolean {
  if (!sameDirectoryBinding(left.directory, right.directory)) return false;
  if (left.exists !== right.exists) return false;
  if (!left.exists || !right.exists) return true;
  return (
    left.sha256 === right.sha256 &&
    left.mode === right.mode &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function stateMatchesSnapshot(state: ManagedFileState, snapshot: ManagedFileSnapshot): boolean {
  if (state.exists !== snapshot.exists) return false;
  if (!state.exists || !snapshot.exists) return true;
  return (
    state.sha256 === snapshot.sha256 &&
    state.mode === snapshot.mode &&
    state.dev === snapshot.dev &&
    state.ino === snapshot.ino
  );
}

function stateIdentity(state: ManagedFileState): ManagedObjectIdentity | undefined {
  return state.exists ? { dev: state.dev, ino: state.ino } : undefined;
}

async function capturePathIdentity(
  directory: FileHandle,
  basename: string,
): Promise<ManagedObjectIdentity | undefined> {
  try {
    return objectIdentity(
      await lstat(path.join(directoryDescriptorPath(directory), basename), { bigint: true }),
    );
  } catch (error) {
    if (errno(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function openAuthenticatedPreimage(
  directory: FileHandle,
  basename: string,
  snapshot: ManagedFileSnapshot,
): Promise<FileHandle> {
  if (!snapshot.exists) {
    throw new Error("Cannot authenticate a missing managed-file preimage.");
  }
  const destination = path.join(directoryDescriptorPath(directory), basename);
  const handle = await open(destination, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    const currentPath = await lstat(destination, { bigint: true });
    if (
      !opened.isFile() ||
      !currentPath.isFile() ||
      currentPath.isSymbolicLink() ||
      !sameIdentity(opened, currentPath) ||
      opened.dev.toString() !== snapshot.dev ||
      opened.ino.toString() !== snapshot.ino ||
      Number(opened.mode & 0o777n) !== snapshot.mode
    ) {
      throw new Error(`Managed file changed after preflight: ${destination}`);
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function captureHeldFileState(handle: FileHandle): Promise<ManagedFileState> {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile()) {
    throw new Error("Managed file preimage descriptor is not a regular file");
  }
  if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Managed file preimage is too large to authenticate");
  }
  const content = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < content.length) {
    const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
    if (bytesRead === 0) {
      throw new Error("Managed file preimage changed while it was being authenticated");
    }
    offset += bytesRead;
  }
  const after = await handle.stat({ bigint: true });
  if (!after.isFile() || !sameIdentity(before, after)) {
    throw new Error("Managed held preimage changed while it was being inspected.");
  }
  return {
    exists: true,
    kind: "regular",
    sha256: hashBytes(content),
    mode: Number(after.mode & 0o777n),
    dev: after.dev.toString(),
    ino: after.ino.toString(),
  };
}

async function assertTemporaryPathIdentity(
  handle: FileHandle,
  temporaryPath: string,
): Promise<ManagedObjectIdentity> {
  const opened = await handle.stat({ bigint: true });
  const currentPath = await lstat(temporaryPath, { bigint: true });
  if (
    !opened.isFile() ||
    !currentPath.isFile() ||
    currentPath.isSymbolicLink() ||
    !sameIdentity(opened, currentPath)
  ) {
    throw new Error(`Managed temporary file changed before publication: ${temporaryPath}`);
  }
  return objectIdentity(opened);
}

async function removePathIfOwned(
  directory: FileHandle,
  basename: string,
  expectedIdentity: ManagedObjectIdentity,
): Promise<"removed" | "missing" | "changed"> {
  const current = await capturePathIdentity(directory, basename);
  if (current === undefined) return "missing";
  if (!identitiesEqual(current, expectedIdentity)) return "changed";
  await rm(path.join(directoryDescriptorPath(directory), basename));
  return (await capturePathIdentity(directory, basename)) === undefined ? "removed" : "changed";
}

async function linkHeldFile(
  source: FileHandle,
  directory: FileHandle,
  basename: string,
): Promise<void> {
  await runCoreutils(
    GNU_LN_PATH,
    ["-L", "-T", "--", "/proc/self/fd/3", `/proc/self/fd/4/${basename}`],
    [source.fd, directory.fd],
  );
}

async function exchangeDirectoryEntries(
  directory: FileHandle,
  leftBasename: string,
  rightBasename: string,
): Promise<void> {
  await runCoreutils(
    GNU_MV_PATH,
    [
      "--exchange",
      "--no-copy",
      "-T",
      "--",
      `/proc/self/fd/3/${leftBasename}`,
      `/proc/self/fd/3/${rightBasename}`,
    ],
    [directory.fd],
  );
}

function publicationError(
  plan: ManagedFilePlan,
  commitState: ManagedFileCommitState,
  message: string,
  cause?: unknown,
  rollbackState?: "failed",
): ManagedFileApplyError {
  return new ManagedFileApplyError(
    `${message}: ${plan.path}`,
    commitState,
    cause === undefined ? undefined : { cause },
    rollbackState,
  );
}

async function rollbackExchangedPair(
  plan: ManagedFilePlan,
  directory: FileHandle,
  temporaryBasename: string,
  destinationBasename: string,
  exchangedDestination: ManagedObjectIdentity,
  exchangedTemporary: ManagedObjectIdentity,
  hooks: ManagedFileApplyHooks,
  hookContext: {
    plan: ManagedFilePlan;
    temporaryPath: string;
    destinationPath: string;
  },
  cause?: unknown,
): Promise<never> {
  let rollbackError: unknown;
  try {
    await hooks.beforeRollback?.(hookContext);
    const currentDestination = await capturePathIdentity(directory, destinationBasename);
    const currentTemporary = await capturePathIdentity(directory, temporaryBasename);
    if (
      !identitiesEqual(currentDestination, exchangedDestination) ||
      !identitiesEqual(currentTemporary, exchangedTemporary)
    ) {
      throw new Error(`Managed file exchange pair changed before rollback: ${plan.path}`);
    }
    await exchangeDirectoryEntries(directory, temporaryBasename, destinationBasename);
    await hooks.afterRollback?.(hookContext);
  } catch (error) {
    rollbackError = error;
  }

  let rollbackDestination: ManagedObjectIdentity | undefined;
  let rollbackTemporary: ManagedObjectIdentity | undefined;
  try {
    rollbackDestination = await capturePathIdentity(directory, destinationBasename);
    rollbackTemporary = await capturePathIdentity(directory, temporaryBasename);
  } catch (error) {
    throw publicationError(
      plan,
      "possibly_committed",
      "Managed file publication could not inspect rollback after an atomic exchange race",
      error,
      "failed",
    );
  }
  if (
    identitiesEqual(rollbackDestination, exchangedTemporary) &&
    identitiesEqual(rollbackTemporary, exchangedDestination)
  ) {
    throw new ManagedFileRollbackError(
      `Managed file publication race was rolled back: ${plan.path}`,
      rollbackError === undefined ? undefined : { cause: rollbackError },
    );
  }
  throw publicationError(
    plan,
    "possibly_committed",
    "Managed file publication could not prove rollback after an atomic exchange race",
    rollbackError ?? cause,
    "failed",
  );
}

export async function revalidateManagedFilePlan(plan: ManagedFilePlan): Promise<void> {
  const current = await captureManagedFileSnapshot(plan.path);
  if (!snapshotsEqual(current, plan.snapshot)) {
    throw new Error(`Managed file changed after preflight: ${plan.path}`);
  }
  if (plan.status === "unchanged" && (!current.exists || current.sha256 !== plan.postimageSha256)) {
    throw new Error(`Managed file unchanged postimage is not current: ${plan.path}`);
  }
}

export async function verifyManagedFilePostimage(
  plan: ManagedFilePlan,
  context: ManagedFileApplyContext,
): Promise<void> {
  const directory = await openBoundDirectory(plan.snapshot.directory, false, context);
  try {
    const current = (await captureManagedFileState(directory, path.basename(plan.path))).state;
    const expectedMode = plan.snapshot.exists ? plan.snapshot.mode : 0o644;
    const expectedIdentity = context.authenticatedFiles.get(managedFileKey(plan));
    if (
      !current.exists ||
      current.sha256 !== plan.postimageSha256 ||
      current.mode !== expectedMode ||
      expectedIdentity === undefined ||
      current.dev !== expectedIdentity.dev ||
      current.ino !== expectedIdentity.ino
    ) {
      throw new Error(`Managed file postimage is no longer current: ${plan.path}`);
    }
  } finally {
    await directory.close();
  }
}

export async function rollbackManagedFilePlan(
  plan: ManagedFilePlan,
  preimage: { snapshot: ManagedFileSnapshot; content?: Buffer },
  context: ManagedFileApplyContext,
): Promise<void> {
  await verifyManagedFilePostimage(plan, context);
  if (preimage.snapshot.exists) {
    if (preimage.content === undefined) {
      throw new Error(`Managed file rollback preimage is unavailable: ${plan.path}`);
    }
    const current = await captureManagedFileSnapshot(plan.path);
    await applyManagedFilePlan(
      {
        path: plan.path,
        snapshot: current,
        postimage: preimage.content,
        postimageSha256: preimage.snapshot.sha256,
        status: "updated",
      },
      createManagedFileApplyContext(),
    );
    return;
  }
  const directory = await openBoundDirectory(plan.snapshot.directory, false, context);
  try {
    const key = managedFileKey(plan);
    let expected = context.authenticatedFiles.get(key);
    if (expected === undefined) {
      const current = await captureManagedFileSnapshot(plan.path);
      if (!current.exists || current.sha256 !== plan.postimageSha256) {
        throw new Error(`Managed installed file rollback postimage is unavailable: ${plan.path}`);
      }
      expected = { dev: current.dev, ino: current.ino };
      context.authenticatedFiles.set(key, expected);
    }
    if ((await removePathIfOwned(directory, path.basename(plan.path), expected)) !== "removed") {
      throw new Error(`Managed installed file could not be rolled back safely: ${plan.path}`);
    }
    context.authenticatedFiles.delete(key);
  } finally {
    await directory.close();
  }
}

export async function applyManagedFilePlan(
  plan: ManagedFilePlan,
  context: ManagedFileApplyContext = createManagedFileApplyContext(),
  hooks: ManagedFileApplyHooks = {},
): Promise<void> {
  if (plan.status === "unchanged") {
    await revalidateManagedFilePlan(plan);
    if (!plan.snapshot.exists) {
      throw new Error(`Managed unchanged file is missing from its snapshot: ${plan.path}`);
    }
    context.authenticatedFiles.set(managedFileKey(plan), {
      dev: plan.snapshot.dev,
      ino: plan.snapshot.ino,
    });
    return;
  }

  const directory = await openBoundDirectory(plan.snapshot.directory, true, context);
  const basename = path.basename(plan.path);
  const temporaryBasename = `.${basename}.${process.pid}.${randomUUID()}.tmp`;
  const destination = path.join(directoryDescriptorPath(directory), basename);
  const temporary = path.join(directoryDescriptorPath(directory), temporaryBasename);
  const mode = plan.snapshot.exists ? plan.snapshot.mode : 0o644;
  let temporaryHandle: FileHandle | undefined;
  let preimageHandle: FileHandle | undefined;
  let temporaryIdentity: ManagedObjectIdentity | undefined;
  let publicationState: ManagedFileCommitState | undefined;
  let operationError: unknown;
  try {
    const current = (await captureManagedFileState(directory, basename)).state;
    if (!stateMatchesSnapshot(current, plan.snapshot)) {
      throw new Error(`Managed file changed after preflight: ${plan.path}`);
    }
    if (plan.snapshot.exists) {
      preimageHandle = await openAuthenticatedPreimage(directory, basename, plan.snapshot);
    }

    temporaryHandle = await open(temporary, "wx", mode);
    await temporaryHandle.writeFile(plan.postimage);
    await temporaryHandle.chmod(mode);
    await temporaryHandle.sync();
    temporaryIdentity = await assertTemporaryPathIdentity(temporaryHandle, temporary);
    const hookContext = { plan, temporaryPath: temporary, destinationPath: destination };
    await hooks.afterTemporaryReady?.(hookContext);

    if (plan.status === "installed") {
      const beforeLink = (await captureManagedFileState(directory, basename)).state;
      if (!stateMatchesSnapshot(beforeLink, plan.snapshot)) {
        throw new Error(`Managed file changed after preflight: ${plan.path}`);
      }
      await hooks.afterDestinationRevalidated?.(hookContext);
      let linkError: unknown;
      try {
        await linkHeldFile(temporaryHandle, directory, basename);
      } catch (error) {
        linkError = error;
      }
      const linkedIdentity = await capturePathIdentity(directory, basename);
      if (!identitiesEqual(linkedIdentity, temporaryIdentity)) {
        if (linkError === undefined) {
          publicationState = "possibly_committed";
          throw publicationError(
            plan,
            publicationState,
            "Managed file publication became uncertain after descriptor-bound link",
          );
        }
        if (linkedIdentity !== undefined) {
          throw new Error(
            `Managed file appeared concurrently at ${plan.path}; no file was replaced.`,
            { cause: linkError },
          );
        }
        throw linkError;
      }
      publicationState = "committed";
    } else {
      const beforeExchange = (await captureManagedFileState(directory, basename)).state;
      if (!stateMatchesSnapshot(beforeExchange, plan.snapshot)) {
        throw new Error(`Managed file changed after preflight: ${plan.path}`);
      }
      const preimageIdentity = stateIdentity(beforeExchange)!;
      await hooks.afterDestinationRevalidated?.(hookContext);
      let exchangeError: unknown;
      try {
        await exchangeDirectoryEntries(directory, temporaryBasename, basename);
      } catch (error) {
        exchangeError = error;
      }
      const exchangedDestination = await capturePathIdentity(directory, basename);
      const exchangedTemporary = await capturePathIdentity(directory, temporaryBasename);
      if (
        identitiesEqual(exchangedDestination, temporaryIdentity) &&
        identitiesEqual(exchangedTemporary, preimageIdentity)
      ) {
        let preimageValidationError: unknown;
        try {
          const exchangedPreimage = await captureHeldFileState(preimageHandle!);
          if (!stateMatchesSnapshot(exchangedPreimage, plan.snapshot)) {
            preimageValidationError = new Error(
              `Managed file preimage changed during atomic publication: ${plan.path}`,
            );
          }
        } catch (error) {
          preimageValidationError = error;
        }
        if (preimageValidationError !== undefined) {
          await rollbackExchangedPair(
            plan,
            directory,
            temporaryBasename,
            basename,
            temporaryIdentity,
            preimageIdentity,
            hooks,
            hookContext,
            preimageValidationError,
          );
        }
        publicationState = "committed";
      } else if (
        identitiesEqual(exchangedDestination, preimageIdentity) &&
        identitiesEqual(exchangedTemporary, temporaryIdentity)
      ) {
        throw (
          exchangeError ?? new Error(`Managed file atomic exchange did not commit: ${plan.path}`)
        );
      } else if (exchangedDestination !== undefined && exchangedTemporary !== undefined) {
        await rollbackExchangedPair(
          plan,
          directory,
          temporaryBasename,
          basename,
          exchangedDestination,
          exchangedTemporary,
          hooks,
          hookContext,
          exchangeError,
        );
      } else {
        publicationState = "possibly_committed";
        throw publicationError(
          plan,
          publicationState,
          "Managed file publication lost an exchange entry and is possibly committed",
          exchangeError,
        );
      }
    }

    await hooks.afterCommit?.(hookContext);
    let installed: ManagedFileState;
    try {
      installed = (await captureManagedFileState(directory, basename)).state;
    } catch (error) {
      const installedIdentity = await capturePathIdentity(directory, basename);
      publicationState = identitiesEqual(installedIdentity, temporaryIdentity)
        ? "committed"
        : "possibly_committed";
      throw publicationError(
        plan,
        publicationState,
        "Managed file post-commit verification failed",
        error,
      );
    }
    if (
      !installed.exists ||
      installed.sha256 !== plan.postimageSha256 ||
      installed.mode !== mode ||
      !identitiesEqual(stateIdentity(installed), temporaryIdentity)
    ) {
      publicationState = identitiesEqual(stateIdentity(installed), temporaryIdentity)
        ? "committed"
        : "possibly_committed";
      throw publicationError(
        plan,
        publicationState,
        "Managed file post-commit verification found a different postimage",
      );
    }

    await hooks.beforeCleanup?.(hookContext);
    if (plan.snapshot.exists) {
      let cleanupPreimageError: unknown;
      try {
        const cleanupPreimage = await captureHeldFileState(preimageHandle!);
        if (!stateMatchesSnapshot(cleanupPreimage, plan.snapshot)) {
          cleanupPreimageError = new Error(
            `Managed file preimage changed before publication cleanup: ${plan.path}`,
          );
        }
      } catch (error) {
        cleanupPreimageError = error;
      }
      if (cleanupPreimageError !== undefined) {
        publicationState = undefined;
        await rollbackExchangedPair(
          plan,
          directory,
          temporaryBasename,
          basename,
          temporaryIdentity!,
          { dev: plan.snapshot.dev, ino: plan.snapshot.ino },
          hooks,
          hookContext,
          cleanupPreimageError,
        );
      }
    }

    const cleanupIdentity = plan.snapshot.exists
      ? { dev: plan.snapshot.dev, ino: plan.snapshot.ino }
      : temporaryIdentity;
    const cleanupHandle = plan.snapshot.exists ? preimageHandle! : temporaryHandle!;
    const linksBeforeCleanup = (await cleanupHandle.stat({ bigint: true })).nlink;
    const cleanup = await removePathIfOwned(directory, temporaryBasename, cleanupIdentity);
    const linksAfterCleanup = (await cleanupHandle.stat({ bigint: true })).nlink;
    if (cleanup !== "removed" || linksAfterCleanup + 1n !== linksBeforeCleanup) {
      publicationState = "committed";
      throw publicationError(
        plan,
        publicationState,
        `Managed file committed but temporary cleanup was ${cleanup} with an unexpected link count`,
      );
    }
    const finalState = (await captureManagedFileState(directory, basename)).state;
    if (
      !finalState.exists ||
      finalState.sha256 !== plan.postimageSha256 ||
      finalState.mode !== mode ||
      !identitiesEqual(stateIdentity(finalState), temporaryIdentity)
    ) {
      publicationState = identitiesEqual(stateIdentity(finalState), temporaryIdentity)
        ? "committed"
        : "possibly_committed";
      throw publicationError(
        plan,
        publicationState,
        "Managed file postimage changed during publication cleanup",
      );
    }
    context.authenticatedFiles.set(managedFileKey(plan), {
      dev: finalState.dev,
      ino: finalState.ino,
    });
  } catch (error) {
    operationError = error;
    if (error instanceof ManagedFileApplyError) {
      publicationState = error.commitState;
    } else if (error instanceof ManagedFileRollbackError) {
      publicationState = undefined;
    } else if (publicationState !== undefined) {
      operationError = publicationError(
        plan,
        publicationState,
        "Managed file publication failed after commit",
        error,
      );
    }
  } finally {
    if (publicationState === undefined && temporaryIdentity !== undefined) {
      await removePathIfOwned(directory, temporaryBasename, temporaryIdentity).catch(
        () => undefined,
      );
    }
    const closeResults = await Promise.allSettled([
      ...(temporaryHandle === undefined ? [] : [temporaryHandle.close()]),
      ...(preimageHandle === undefined ? [] : [preimageHandle.close()]),
      directory.close(),
    ]);
    const closeFailure = closeResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (closeFailure !== undefined && operationError === undefined) {
      if (publicationState !== undefined) {
        operationError = publicationError(
          plan,
          publicationState,
          "Managed file publication completed but descriptor cleanup failed",
          closeFailure.reason,
        );
      } else {
        operationError = closeFailure.reason;
      }
    }
  }
  if (operationError !== undefined) {
    throw operationError;
  }
}
