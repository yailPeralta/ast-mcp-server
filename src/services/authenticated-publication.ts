import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
export type PublicationIdentity = { dev: string; ino: string; sha256: string; mode: number };
interface CommitBase {
  directory: FileHandle;
  destinationBasename: string;
  destinationIdentity: PublicationIdentity;
}
export type CommitToken =
  | (CommitBase & { kind: "creation" })
  | (CommitBase & {
      kind: "replacement";
      displacedBasename: string;
      displacedIdentity: PublicationIdentity;
    });
export type PublicationResult =
  | { state: "pre_effect"; reason: "conflict" | "unsupported" }
  | { state: "committed"; token: CommitToken }
  | { state: "rolled_back"; reason: "conflict" }
  | { state: "ambiguous"; phase: "commit" | "rollback" };
export interface PublicationPlan {
  kind: "creation" | "replacement";
  directory: FileHandle;
  destinationBasename: string;
  stage: FileHandle;
  stageBasename: string;
  stageIdentity: PublicationIdentity;
  preimage?: FileHandle;
  preimageIdentity?: PublicationIdentity;
  beforePublish?: () => void | Promise<void>;
  beforeRollback?: () => void | Promise<void>;
}
function sameStat(left: BigIntStats, right: BigIntStats): boolean {
  const fields = ["dev", "ino", "size", "mode", "mtimeNs", "ctimeNs"] as const;
  return fields.every((field) => left[field] === right[field]);
}
export async function snapshotHeldFile(handle: FileHandle): Promise<PublicationIdentity> {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.size > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Publication descriptor cannot be authenticated");
  const bytes = await readFile(`/proc/self/fd/${handle.fd}`);
  const after = await handle.stat({ bigint: true });
  if (!after.isFile() || !sameStat(before, after))
    throw new Error("Publication descriptor changed during read");
  return {
    dev: after.dev.toString(),
    ino: after.ino.toString(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mode: Number(after.mode & 0o777n),
  };
}
function equal(left: PublicationIdentity | undefined, right: PublicationIdentity | undefined) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.sha256 === right.sha256 &&
    left.mode === right.mode
  );
}
async function entry(directory: FileHandle, basename: string) {
  const target = `/proc/self/fd/${directory.fd}/${basename}`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const snapshot = await snapshotHeldFile(handle);
    const current = await lstat(target, { bigint: true });
    return current.dev.toString() === snapshot.dev && current.ino.toString() === snapshot.ino
      ? snapshot
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally {
    await handle?.close();
  }
}
export async function runPublicationPrimitive(
  executable: "/usr/bin/ln" | "/usr/bin/mv",
  args: string[],
  fds: number[],
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      shell: false,
      stdio: ["ignore", "ignore", "pipe", ...fds],
      windowsHide: true,
    });
    let failure: Error | undefined;
    let stderrBytes = 0;
    const fail = (message: string, cause?: unknown) => {
      if (failure) return;
      failure = new Error(message, cause === undefined ? undefined : { cause });
      child.kill("SIGKILL");
    };
    const timeout = setTimeout(() => fail("Publication primitive timed out"), 5_000);
    child.stderr!.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 4_096) fail("Publication primitive stderr exceeded limit");
    });
    child.on("error", (error) => fail("Publication primitive unavailable", error));
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (failure) reject(failure);
      else if (code === 0 && signal === null) resolve();
      else reject(new Error(`Publication primitive failed (${signal ?? code ?? "unknown"})`));
    });
  });
}
export const exchangeDirectoryEntries = (directory: FileHandle, left: string, right: string) =>
  runPublicationPrimitive(
    "/usr/bin/mv",
    ["--exchange", "--no-copy", "-T", "--", `/proc/self/fd/3/${left}`, `/proc/self/fd/3/${right}`],
    [directory.fd],
  );
export const linkHeldFile = (source: FileHandle, directory: FileHandle, basename: string) =>
  runPublicationPrimitive(
    "/usr/bin/ln",
    ["-L", "-T", "--", "/proc/self/fd/3", `/proc/self/fd/4/${basename}`],
    [source.fd, directory.fd],
  );
export async function rollbackOwnedCommit(
  token: CommitToken,
  hooks: Pick<PublicationPlan, "beforeRollback"> = {},
): Promise<PublicationResult> {
  if (token.kind === "creation") return { state: "ambiguous", phase: "rollback" };
  await hooks.beforeRollback?.();
  if (
    !equal(await entry(token.directory, token.destinationBasename), token.destinationIdentity) ||
    !equal(await entry(token.directory, token.displacedBasename), token.displacedIdentity)
  )
    return { state: "ambiguous", phase: "rollback" };
  try {
    await exchangeDirectoryEntries(
      token.directory,
      token.displacedBasename,
      token.destinationBasename,
    );
  } catch {}
  const restored =
    equal(await entry(token.directory, token.destinationBasename), token.displacedIdentity) &&
    equal(await entry(token.directory, token.displacedBasename), token.destinationIdentity);
  if (!restored) return { state: "ambiguous", phase: "rollback" };
  return { state: "rolled_back", reason: "conflict" };
}
export async function publishAuthenticated(plan: PublicationPlan): Promise<PublicationResult> {
  if (process.platform !== "linux") return { state: "pre_effect", reason: "unsupported" };
  await plan.beforePublish?.();
  if (plan.kind === "creation") {
    try {
      await linkHeldFile(plan.stage, plan.directory, plan.destinationBasename);
    } catch {}
    const destination = await entry(plan.directory, plan.destinationBasename);
    if (equal(destination, plan.stageIdentity))
      return {
        state: "committed",
        token: {
          kind: "creation",
          directory: plan.directory,
          destinationBasename: plan.destinationBasename,
          destinationIdentity: plan.stageIdentity,
        },
      };
    if (destination?.dev === plan.stageIdentity.dev && destination.ino === plan.stageIdentity.ino)
      return { state: "ambiguous", phase: "commit" };
    return { state: "pre_effect", reason: destination ? "conflict" : "unsupported" };
  }
  try {
    await exchangeDirectoryEntries(plan.directory, plan.stageBasename, plan.destinationBasename);
  } catch {}
  const destination = await entry(plan.directory, plan.destinationBasename);
  const displaced = await entry(plan.directory, plan.stageBasename);
  if (equal(destination, plan.stageIdentity) && displaced) {
    const token: CommitToken = {
      kind: "replacement",
      directory: plan.directory,
      destinationBasename: plan.destinationBasename,
      displacedBasename: plan.stageBasename,
      destinationIdentity: destination!,
      displacedIdentity: displaced,
    };
    const held = plan.preimage && (await snapshotHeldFile(plan.preimage));
    if (equal(displaced, plan.preimageIdentity) && equal(held, plan.preimageIdentity))
      return { state: "committed", token };
    return rollbackOwnedCommit(token, plan);
  }
  if (equal(destination, plan.preimageIdentity) && equal(displaced, plan.stageIdentity))
    return { state: "pre_effect", reason: "unsupported" };
  return { state: "ambiguous", phase: "commit" };
}
export async function probePublicationCapability(parent: string): Promise<void> {
  const probe = path.join(parent, `.ast-publication-probe-${randomUUID()}`);
  const handles: FileHandle[] = [];
  try {
    await mkdir(probe);
    const directory = await open(probe, "r");
    handles.push(directory);
    for (const [name, bytes] of [
      ["stage", "stage"],
      ["replacement", "replacement"],
    ] as const)
      await writeFile(path.join(probe, name), bytes);
    const stage = await open(path.join(probe, "stage"), "r");
    handles.push(stage);
    const replacement = await open(path.join(probe, "replacement"), "r");
    handles.push(replacement);
    const stageIdentity = await snapshotHeldFile(stage);
    const replacementIdentity = await snapshotHeldFile(replacement);
    await linkHeldFile(stage, directory, "created");
    if (!equal(await entry(directory, "created"), stageIdentity))
      throw new Error("Link unsupported");
    await exchangeDirectoryEntries(directory, "replacement", "created");
    if (
      !equal(await entry(directory, "created"), replacementIdentity) ||
      !equal(await entry(directory, "replacement"), stageIdentity)
    )
      throw new Error("Publication exchange unsupported");
  } finally {
    await Promise.allSettled(handles.map((handle) => handle.close()));
    await rm(probe, { recursive: true, force: true });
  }
}
