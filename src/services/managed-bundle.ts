import path from "node:path";
import {
  applyManagedFilePlan,
  canonicalizeFuturePath,
  captureManagedFilePreimage,
  captureManagedFileSnapshot,
  createManagedFileApplyContext,
  hashBytes,
  ManagedFileApplyError,
  rollbackManagedFilePlan,
  snapshotsEqual,
  verifyManagedFilePostimage,
  type ManagedFileApplyContext,
  type ManagedFileApplyHooks,
  type ManagedFilePlan,
  type ManagedFileStatus,
} from "./managed-file.js";

export interface ManagedBundleFile {
  path: string;
  sha256: string;
}

export interface ManagedBundleSourceFile extends ManagedBundleFile {
  content: Buffer;
}

export interface ManagedBundleRelease {
  files: readonly ManagedBundleFile[];
}

export interface ManagedBundlePlan {
  status: ManagedFileStatus;
  files: ManagedFilePlan[];
}

export class ManagedBundleConflictError extends Error {
  constructor(readonly destination: string) {
    super(`Managed bundle destination already exists with different content: ${destination}`);
    this.name = "ManagedBundleConflictError";
  }
}

function validateRelease(release: ManagedBundleRelease): void {
  const paths = new Set<string>();
  for (const file of release.files) {
    if (
      file.path.includes("\\") ||
      path.posix.isAbsolute(file.path) ||
      path.win32.isAbsolute(file.path) ||
      path.posix.normalize(file.path) !== file.path ||
      file.path.startsWith("../") ||
      file.path === "."
    ) {
      throw new Error(`Managed bundle contains an unsafe path: ${file.path}`);
    }
    if (paths.has(file.path))
      throw new Error(`Managed bundle contains a duplicate path: ${file.path}`);
    paths.add(file.path);
  }
}

export async function planManagedBundle(options: {
  destinationRoot: string;
  current: { files: readonly ManagedBundleSourceFile[] };
  predecessors: readonly ManagedBundleRelease[];
  force?: boolean;
}): Promise<ManagedBundlePlan> {
  validateRelease(options.current);
  for (const predecessor of options.predecessors) validateRelease(predecessor);
  const signatures = [options.current, ...options.predecessors].map((release) =>
    release.files
      .map((file) => `${file.path}:${file.sha256}`)
      .sort()
      .join("\n"),
  );
  if (new Set(signatures).size !== signatures.length) {
    throw new Error("Managed bundle contains a duplicate release digest.");
  }
  const currentPaths = new Set(options.current.files.map((file) => file.path));
  if (
    options.predecessors.some((release) =>
      release.files.some((file) => !currentPaths.has(file.path)),
    )
  ) {
    throw new Error("Managed bundle predecessor contains an unmanaged current path.");
  }
  for (const file of options.current.files) {
    if (hashBytes(file.content) !== file.sha256) {
      throw new Error(`Managed bundle digest does not match source asset: ${file.path}`);
    }
  }
  const canonicalRoot = path.dirname(
    await canonicalizeFuturePath(path.join(options.destinationRoot, ".managed-bundle-root")),
  );
  const destinations = await Promise.all(
    options.current.files.map(async (file) => ({
      file,
      destination: await canonicalizeFuturePath(path.join(options.destinationRoot, file.path)),
    })),
  );
  for (const { destination } of destinations) {
    const relative = path.relative(canonicalRoot, destination);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Managed bundle destination is outside the bundle root: ${destination}`);
    }
  }
  if (new Set(destinations.map((entry) => entry.destination)).size !== destinations.length) {
    throw new Error("Managed bundle contains a duplicate canonical destination.");
  }
  const entries = await Promise.all(
    destinations.map(async ({ file, destination }) => ({
      file,
      destination,
      snapshot: await captureManagedFileSnapshot(destination),
    })),
  );
  const exactCurrent = entries.every(
    ({ file, snapshot }) => snapshot.exists && snapshot.sha256 === file.sha256,
  );
  const empty = entries.every(({ snapshot }) => !snapshot.exists);
  const exactPredecessor = options.predecessors.some((release) =>
    entries.every(({ file, snapshot }) => {
      const predecessor = release.files.find((candidate) => candidate.path === file.path);
      return predecessor === undefined
        ? !snapshot.exists
        : snapshot.exists && snapshot.sha256 === predecessor.sha256;
    }),
  );
  if (!exactCurrent && !empty && !exactPredecessor && options.force !== true) {
    throw new ManagedBundleConflictError(
      entries.find(({ snapshot }) => snapshot.exists)?.destination ?? options.destinationRoot,
    );
  }
  return {
    status: exactCurrent ? "unchanged" : empty ? "installed" : "updated",
    files: entries.map(({ file, destination, snapshot }) => ({
      path: destination,
      snapshot,
      postimage: file.content,
      postimageSha256: file.sha256,
      status:
        snapshot.exists && snapshot.sha256 === file.sha256
          ? "unchanged"
          : snapshot.exists
            ? "updated"
            : "installed",
    })),
  };
}

export async function applyManagedBundle(
  plan: { files: readonly ManagedFilePlan[] },
  onApplied?: (file: ManagedFilePlan) => void | Promise<void>,
  context: ManagedFileApplyContext = createManagedFileApplyContext(),
  hooks: ManagedFileApplyHooks = {},
): Promise<void> {
  const preimages = new Map<
    ManagedFilePlan,
    Awaited<ReturnType<typeof captureManagedFilePreimage>>
  >();
  for (const file of plan.files) {
    const preimage = await captureManagedFilePreimage(file.path);
    if (!snapshotsEqual(preimage.snapshot, file.snapshot)) {
      throw new Error(`Managed file changed after preflight: ${file.path}`);
    }
    preimages.set(file, preimage);
  }
  const authenticated: ManagedFilePlan[] = [];
  const mutated: ManagedFilePlan[] = [];
  let active: ManagedFilePlan | undefined;
  try {
    for (const file of plan.files) {
      active = file;
      for (const current of authenticated) await verifyManagedFilePostimage(current, context);
      await applyManagedFilePlan(file, context, hooks);
      authenticated.push(file);
      if (file.status !== "unchanged") mutated.push(file);
      await onApplied?.(file);
      active = undefined;
    }
    for (const current of authenticated) await verifyManagedFilePostimage(current, context);
  } catch (error) {
    if (
      active !== undefined &&
      active.status !== "unchanged" &&
      error instanceof ManagedFileApplyError &&
      !mutated.includes(active)
    ) {
      mutated.push(active);
    }
    const failures: unknown[] = [];
    for (const file of mutated.reverse()) {
      try {
        await rollbackManagedFilePlan(file, preimages.get(file)!, context);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length) {
      throw new AggregateError([error, ...failures], "Managed bundle rollback was incomplete.", {
        cause: error,
      });
    }
    throw error;
  }
}
