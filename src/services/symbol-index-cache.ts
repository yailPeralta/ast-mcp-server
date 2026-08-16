import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  type Stats,
  unlinkSync,
} from "node:fs";
import { access, lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  readSymbolIndexPersistencePolicy,
  type SymbolIndexPersistenceMode,
  type SymbolIndexPersistencePolicy,
} from "./symbol-index-policy.js";

const DEFAULT_MAX_RECORDS = 4_096;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const MAX_REASON_COUNT = 1_000_000;
const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "utf8");
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const SUPPORTS_OWNER_CHECK = process.platform === "linux" && typeof process.getuid === "function";
const STICKY_DIRECTORY_MODE = 0o1000;
const GROUP_OR_OTHER_WRITE_MODE = 0o022;
const GROUP_OR_OTHER_ACCESS_MODE = 0o077;

export type SymbolIndexCacheFailureCode =
  "CACHE_LIMIT" | "CACHE_UNSAFE_ROOT" | "CACHE_UNSAFE" | "CACHE_ACTIVE" | "CACHE_PARTIAL";

type CacheArtifactKind = "active_database" | "wal" | "shm" | "quarantine";
type CacheReason =
  | "record_limit"
  | "byte_limit"
  | "symlink"
  | "non_regular"
  | "multiple_links"
  | "wrong_owner"
  | "unsafe_permissions"
  | "unreadable"
  | "changed"
  | "active_database"
  | "lock_check_failed"
  | "delete_failed"
  | "not_attempted";

type CacheReasonCounts = Partial<Record<CacheReason, number>>;

export interface SymbolIndexCacheFailureDetails {
  readonly removed_artifact_count: number;
  readonly not_removed_artifact_count: number;
  readonly unrecognized_regular_file_count: number;
  readonly reason_counts: CacheReasonCounts;
}

export class SymbolIndexCacheError extends Error {
  constructor(
    readonly code: SymbolIndexCacheFailureCode,
    message: string,
    readonly details: SymbolIndexCacheFailureDetails,
  ) {
    super(message);
    this.name = "SymbolIndexCacheError";
  }
}

interface CacheLimits {
  readonly maxRecords?: number;
  readonly maxBytes?: number;
}

interface CacheTestHookTarget {
  readonly artifact: CacheArtifactKind;
  readonly name: string;
  readonly ordinal: number;
}

interface CacheTestHooks {
  readonly beforeUnlink?: (target: CacheTestHookTarget) => void | Promise<void>;
}

export interface SymbolIndexCacheOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly resolveHomeDirectory?: () => string;
  readonly limits?: CacheLimits;
  readonly DatabaseSync?: typeof DatabaseSync;
  readonly testHooks?: CacheTestHooks;
}

export interface SymbolIndexCacheInspectResult {
  readonly status: "ok";
  readonly command: "cache inspect";
  readonly policy: SymbolIndexPersistenceMode;
  readonly backend: "memory" | "sqlite";
  readonly state: "disabled" | "missing" | "ready";
  readonly regular_file_count: number;
  readonly total_bytes: number;
  readonly active_database_count: number;
  readonly sidecar_count: number;
  readonly quarantine_count: number;
  readonly unrecognized_regular_file_count: number;
  readonly unsafe_entry_count: number;
}

export interface SymbolIndexCacheClearResult {
  readonly status: "ok";
  readonly command: "cache clear";
  readonly policy: SymbolIndexPersistenceMode;
  readonly backend: "memory" | "sqlite";
  readonly state: "disabled" | "missing" | "cleared";
  readonly deleted_artifact_count: number;
  readonly deleted_active_database_count: number;
  readonly deleted_sidecar_count: number;
  readonly deleted_quarantine_count: number;
  readonly unrecognized_regular_file_count: number;
  readonly not_removed_artifact_count: number;
  readonly reason_counts: CacheReasonCounts;
}

interface IdentitySnapshot {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly nlink: number;
  readonly mode: number;
  readonly uid: number;
}

interface InventoryEntry {
  readonly absolutePath: string;
  readonly relativeName: string;
  readonly name: string;
  readonly identity: IdentitySnapshot;
  readonly artifact: CacheArtifactKind | null;
  readonly nodeType: "directory" | "regular" | "symlink" | "other";
}

interface CacheInventory {
  readonly root: string;
  readonly rootIdentity: IdentitySnapshot;
  readonly entries: readonly InventoryEntry[];
  readonly regularFileCount: number;
  readonly totalBytes: number;
  readonly activeDatabaseCount: number;
  readonly sidecarCount: number;
  readonly quarantineCount: number;
  readonly unrecognizedRegularFileCount: number;
  readonly unsafeEntryCount: number;
  readonly reasonCounts: CacheReasonCounts;
}

interface MutableInventoryState {
  recordCount: number;
  totalBytes: number;
  regularFileCount: number;
  activeDatabaseCount: number;
  sidecarCount: number;
  quarantineCount: number;
  unrecognizedRegularFileCount: number;
  readonly entries: InventoryEntry[];
  readonly unsafeEntries: Set<string>;
  readonly reasonCounts: CacheReasonCounts;
}

function boundedIncrement(value: number, increment = 1): number {
  return Math.min(MAX_REASON_COUNT, value + increment);
}

function incrementReason(counts: CacheReasonCounts, reason: CacheReason): void {
  counts[reason] = boundedIncrement(counts[reason] ?? 0);
}

function effectiveLimit(candidate: number | undefined, maximum: number): number {
  return Number.isSafeInteger(candidate) && candidate !== undefined && candidate > 0
    ? Math.min(candidate, maximum)
    : maximum;
}

function limitsFrom(options: SymbolIndexCacheOptions): { maxRecords: number; maxBytes: number } {
  return {
    maxRecords: effectiveLimit(options.limits?.maxRecords, DEFAULT_MAX_RECORDS),
    maxBytes: effectiveLimit(options.limits?.maxBytes, DEFAULT_MAX_BYTES),
  };
}

function snapshot(stats: Stats): IdentitySnapshot {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    nlink: stats.nlink,
    mode: stats.mode,
    uid: stats.uid,
  };
}

function sameIdentity(left: IdentitySnapshot, right: IdentitySnapshot): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.nlink === right.nlink &&
    left.mode === right.mode &&
    left.uid === right.uid
  );
}

function sameDirectoryIdentity(left: IdentitySnapshot, right: IdentitySnapshot): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.mode === right.mode &&
    left.uid === right.uid
  );
}

function classifyArtifact(name: string): CacheArtifactKind | null {
  if (/^symbol-index-[0-9a-f]{64}\.sqlite$/u.test(name)) return "active_database";
  if (/^symbol-index-[0-9a-f]{64}\.sqlite-wal$/u.test(name)) return "wal";
  if (/^symbol-index-[0-9a-f]{64}\.sqlite-shm$/u.test(name)) return "shm";
  if (/^symbol-index-[0-9a-f]{64}\.sqlite\.corrupt-[0-9]+-[0-9]+$/u.test(name)) {
    return "quarantine";
  }
  return null;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function artifactGroup(entry: InventoryEntry): string {
  if (entry.artifact === "wal" || entry.artifact === "shm") {
    return entry.relativeName.slice(0, -4);
  }
  if (entry.artifact === "quarantine") {
    return entry.relativeName.replace(/\.corrupt-[0-9]+-[0-9]+$/u, "");
  }
  return entry.relativeName;
}

function deletionCompare(left: InventoryEntry, right: InventoryEntry): number {
  const groupOrder = lexicalCompare(artifactGroup(left), artifactGroup(right));
  if (groupOrder !== 0) return groupOrder;
  if (left.artifact === "active_database" && right.artifact !== "active_database") return 1;
  if (right.artifact === "active_database" && left.artifact !== "active_database") return -1;
  return lexicalCompare(left.relativeName, right.relativeName);
}

function emptyFailureDetails(reasonCounts: CacheReasonCounts = {}): SymbolIndexCacheFailureDetails {
  return {
    removed_artifact_count: 0,
    not_removed_artifact_count: 0,
    unrecognized_regular_file_count: 0,
    reason_counts: reasonCounts,
  };
}

function cacheError(
  code: SymbolIndexCacheFailureCode,
  message: string,
  details: SymbolIndexCacheFailureDetails = emptyFailureDetails(),
): SymbolIndexCacheError {
  return new SymbolIndexCacheError(code, message, details);
}

function rootSafetyError(
  reason: "changed" | "non_regular" | "wrong_owner" | "unsafe_permissions" = "non_regular",
): SymbolIndexCacheError {
  return cacheError("CACHE_UNSAFE_ROOT", "Cache root failed physical safety validation.", {
    ...emptyFailureDetails(),
    reason_counts: { [reason]: 1 },
  });
}

function directoryTrustReason(
  stats: Stats,
  selectedRoot: boolean,
): "wrong_owner" | "unsafe_permissions" | null {
  if (!SUPPORTS_OWNER_CHECK) return null;
  const currentUid = process.getuid!();
  if (selectedRoot) {
    if (stats.uid !== currentUid) return "wrong_owner";
    return (stats.mode & GROUP_OR_OTHER_ACCESS_MODE) === 0 ? null : "unsafe_permissions";
  }
  if (stats.uid !== currentUid && stats.uid !== 0) return "wrong_owner";
  if (
    (stats.mode & GROUP_OR_OTHER_WRITE_MODE) !== 0 &&
    (stats.mode & STICKY_DIRECTORY_MODE) === 0
  ) {
    return "unsafe_permissions";
  }
  return null;
}

async function validateRoot(root: string): Promise<"missing" | "ready"> {
  const parsed = path.parse(root);
  const relative = path.relative(parsed.root, root);
  const segments = relative === "" ? [] : relative.split(path.sep);
  let candidate = parsed.root;
  for (const segment of segments) {
    candidate = path.join(candidate, segment);
    let stats: Stats;
    try {
      stats = await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw rootSafetyError();
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw rootSafetyError();
    const trustReason = directoryTrustReason(stats, candidate === root);
    if (trustReason) throw rootSafetyError(trustReason);
    try {
      if ((await realpath(candidate)) !== candidate) throw rootSafetyError();
    } catch (error) {
      if (error instanceof SymbolIndexCacheError) throw error;
      throw rootSafetyError();
    }
  }
  return "ready";
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw rootSafetyError("changed");
  }
}

function markUnsafe(state: MutableInventoryState, relativeName: string, reason: CacheReason): void {
  state.unsafeEntries.add(relativeName);
  incrementReason(state.reasonCounts, reason);
}

function ownerIsUnsafe(stats: Stats): boolean {
  return SUPPORTS_OWNER_CHECK && stats.uid !== process.getuid!();
}

async function isReadable(filePath: string, directory: boolean): Promise<boolean> {
  try {
    await access(filePath, directory ? constants.R_OK | constants.X_OK : constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function classifyNode(stats: Stats): InventoryEntry["nodeType"] {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "regular";
  return "other";
}

function inventoryFailureDetails(
  inventory: CacheInventory,
  removedArtifactCount = 0,
  reasonCounts: CacheReasonCounts = inventory.reasonCounts,
): SymbolIndexCacheFailureDetails {
  const recognizedCount = inventory.entries.filter((entry) => entry.artifact !== null).length;
  return {
    removed_artifact_count: removedArtifactCount,
    not_removed_artifact_count: Math.max(0, recognizedCount - removedArtifactCount),
    unrecognized_regular_file_count: inventory.unrecognizedRegularFileCount,
    reason_counts: reasonCounts,
  };
}

async function inventoryRoot(
  root: string,
  limits: { maxRecords: number; maxBytes: number },
): Promise<CacheInventory> {
  let rootStats: Stats;
  try {
    rootStats = await lstat(root);
  } catch {
    throw rootSafetyError("changed");
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw rootSafetyError();
  const rootTrustReason = directoryTrustReason(rootStats, true);
  if (rootTrustReason) throw rootSafetyError(rootTrustReason);
  try {
    if ((await realpath(root)) !== root) throw rootSafetyError();
  } catch (error) {
    if (error instanceof SymbolIndexCacheError) throw error;
    throw rootSafetyError();
  }

  const state: MutableInventoryState = {
    recordCount: 0,
    totalBytes: 0,
    regularFileCount: 0,
    activeDatabaseCount: 0,
    sidecarCount: 0,
    quarantineCount: 0,
    unrecognizedRegularFileCount: 0,
    entries: [],
    unsafeEntries: new Set<string>(),
    reasonCounts: {},
  };
  if (ownerIsUnsafe(rootStats)) markUnsafe(state, "", "wrong_owner");
  if (!(await isReadable(root, true))) throw rootSafetyError();

  const visit = async (directoryPath: string): Promise<void> => {
    let directoryRealPath: string;
    try {
      directoryRealPath = await realpath(directoryPath);
    } catch {
      throw rootSafetyError("changed");
    }
    if (directoryRealPath !== directoryPath) throw rootSafetyError("changed");

    const names: string[] = [];
    try {
      const directory = await opendir(directoryPath);
      for await (const directoryEntry of directory) {
        state.recordCount += 1;
        if (state.recordCount > limits.maxRecords) {
          throw cacheError("CACHE_LIMIT", "Cache inventory exceeded its bounded safety limits.", {
            ...emptyFailureDetails(),
            reason_counts: { record_limit: 1 },
          });
        }
        names.push(directoryEntry.name);
      }
    } catch (error) {
      if (error instanceof SymbolIndexCacheError) throw error;
      throw cacheError("CACHE_UNSAFE", "Cache inventory could not safely read the selected tree.", {
        ...emptyFailureDetails(),
        reason_counts: { unreadable: 1 },
      });
    }
    names.sort(lexicalCompare);

    for (const name of names) {
      const absolutePath = path.join(directoryPath, name);
      assertContained(root, absolutePath);
      const relativeName = path.relative(root, absolutePath);
      let stats: Stats;
      try {
        stats = await lstat(absolutePath);
      } catch {
        throw cacheError("CACHE_UNSAFE", "Cache inventory changed during inspection.", {
          ...emptyFailureDetails(),
          reason_counts: { changed: 1 },
        });
      }
      const artifact = classifyArtifact(name);
      const nodeType = classifyNode(stats);
      const entry: InventoryEntry = {
        absolutePath,
        relativeName,
        name,
        identity: snapshot(stats),
        artifact,
        nodeType,
      };

      if (nodeType === "regular") {
        if (
          !Number.isSafeInteger(stats.size) ||
          stats.size < 0 ||
          state.totalBytes > limits.maxBytes - stats.size
        ) {
          throw cacheError("CACHE_LIMIT", "Cache inventory exceeded its bounded safety limits.", {
            ...emptyFailureDetails(),
            reason_counts: { byte_limit: 1 },
          });
        }
        state.totalBytes += stats.size;
        state.regularFileCount += 1;
        if (artifact === "active_database") state.activeDatabaseCount += 1;
        else if (artifact === "wal" || artifact === "shm") state.sidecarCount += 1;
        else if (artifact === "quarantine") state.quarantineCount += 1;
        else state.unrecognizedRegularFileCount += 1;
        if (stats.nlink !== 1) markUnsafe(state, relativeName, "multiple_links");
        if (ownerIsUnsafe(stats)) markUnsafe(state, relativeName, "wrong_owner");
        if (!(await isReadable(absolutePath, false))) markUnsafe(state, relativeName, "unreadable");
        state.entries.push(entry);
        continue;
      }

      if (nodeType === "symlink") {
        markUnsafe(state, relativeName, "symlink");
        state.entries.push(entry);
        continue;
      }

      if (nodeType === "directory") {
        if (artifact !== null) markUnsafe(state, relativeName, "non_regular");
        if (ownerIsUnsafe(stats)) markUnsafe(state, relativeName, "wrong_owner");
        if ((stats.mode & GROUP_OR_OTHER_ACCESS_MODE) !== 0) {
          markUnsafe(state, relativeName, "unsafe_permissions");
        }
        if (!(await isReadable(absolutePath, true))) {
          markUnsafe(state, relativeName, "unreadable");
          state.entries.push(entry);
          continue;
        }
        state.entries.push(entry);
        await visit(absolutePath);
        continue;
      }

      markUnsafe(state, relativeName, "non_regular");
      if (ownerIsUnsafe(stats)) markUnsafe(state, relativeName, "wrong_owner");
      state.entries.push(entry);
    }
  };

  await visit(root);
  return {
    root,
    rootIdentity: snapshot(rootStats),
    entries: state.entries,
    regularFileCount: state.regularFileCount,
    totalBytes: state.totalBytes,
    activeDatabaseCount: state.activeDatabaseCount,
    sidecarCount: state.sidecarCount,
    quarantineCount: state.quarantineCount,
    unrecognizedRegularFileCount: state.unrecognizedRegularFileCount,
    unsafeEntryCount: state.unsafeEntries.size,
    reasonCounts: state.reasonCounts,
  };
}

async function identityIsCurrent(filePath: string, expected: IdentitySnapshot): Promise<boolean> {
  try {
    return sameIdentity(snapshot(await lstat(filePath)), expected);
  } catch {
    return false;
  }
}

async function rootIsCurrent(inventory: CacheInventory): Promise<boolean> {
  let stats: Stats;
  try {
    stats = await lstat(inventory.root);
  } catch {
    return false;
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    stats.dev !== inventory.rootIdentity.dev ||
    stats.ino !== inventory.rootIdentity.ino ||
    stats.mode !== inventory.rootIdentity.mode
  ) {
    return false;
  }
  try {
    return (await realpath(inventory.root)) === inventory.root;
  } catch {
    return false;
  }
}

async function inventoryIsCurrent(inventory: CacheInventory): Promise<boolean> {
  if (!(await rootIsCurrent(inventory))) return false;
  for (const entry of inventory.entries) {
    if (!(await identityIsCurrent(entry.absolutePath, entry.identity))) return false;
  }
  return true;
}

function identityIsCurrentSync(filePath: string, expected: IdentitySnapshot): boolean {
  try {
    return sameIdentity(snapshot(lstatSync(filePath)), expected);
  } catch {
    return false;
  }
}

function directoryChainIsCurrentSync(inventory: CacheInventory, targetPath: string): boolean {
  let directory = path.dirname(targetPath);
  for (;;) {
    const expected =
      directory === inventory.root
        ? inventory.rootIdentity
        : inventory.entries.find(
            (entry) => entry.absolutePath === directory && entry.nodeType === "directory",
          )?.identity;
    if (!expected) return false;
    try {
      const stats = lstatSync(directory);
      if (
        stats.isSymbolicLink() ||
        !stats.isDirectory() ||
        !sameDirectoryIdentity(snapshot(stats), expected) ||
        realpathSync(directory) !== directory
      ) {
        return false;
      }
    } catch {
      return false;
    }
    if (directory === inventory.root) return true;
    directory = path.dirname(directory);
  }
}

async function hasSQLiteHeader(entry: InventoryEntry): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(entry.absolutePath, constants.O_RDONLY | NO_FOLLOW);
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!(await identityIsCurrent(entry.absolutePath, entry.identity))) {
      throw cacheError("CACHE_UNSAFE", "Cache inventory changed during preflight.", {
        ...emptyFailureDetails(),
        reason_counts: { changed: 1 },
      });
    }
    return bytesRead === SQLITE_HEADER.length && header.equals(SQLITE_HEADER);
  } catch (error) {
    if (error instanceof SymbolIndexCacheError) throw error;
    throw cacheError("CACHE_UNSAFE", "Cache database could not be checked safely.", {
      ...emptyFailureDetails(),
      reason_counts: { lock_check_failed: 1 },
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isLockError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("busy") || message.includes("locked");
}

function isCorruptDatabaseError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("malformed") ||
    message.includes("not a database") ||
    message.includes("database disk image")
  );
}

interface DatabaseActivityProbe {
  readonly Database: typeof DatabaseSync;
  readonly sqlitePaths: ReadonlySet<string>;
}

interface DatabaseActivityGuard {
  readonly database: DatabaseSync;
  transactionStarted: boolean;
  released: boolean;
}

interface BoundDatabaseArtifact {
  readonly descriptor: number;
  readonly openPath: string;
}

function changedDatabaseArtifactError(
  inventory: CacheInventory,
  removedArtifactCount: number,
): SymbolIndexCacheError {
  return cacheError(
    "CACHE_UNSAFE",
    "Cache database identity changed before activity guarding.",
    inventoryFailureDetails(inventory, removedArtifactCount, { changed: 1 }),
  );
}

function openBoundDatabaseArtifact(
  entry: InventoryEntry,
  inventory: CacheInventory,
  removedArtifactCount: number,
): BoundDatabaseArtifact {
  let descriptor: number;
  try {
    descriptor = openSync(entry.absolutePath, constants.O_RDWR | NO_FOLLOW);
  } catch {
    throw changedDatabaseArtifactError(inventory, removedArtifactCount);
  }
  let transferred = false;
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || !sameIdentity(snapshot(stats), entry.identity)) {
      throw changedDatabaseArtifactError(inventory, removedArtifactCount);
    }
    const openPath = `/proc/self/fd/${descriptor}`;
    let resolvedPath: string;
    try {
      resolvedPath = realpathSync(openPath);
    } catch {
      throw cacheError(
        "CACHE_UNSAFE",
        "Cache database descriptor binding is unavailable.",
        inventoryFailureDetails(inventory, removedArtifactCount, { lock_check_failed: 1 }),
      );
    }
    if (resolvedPath !== entry.absolutePath) {
      throw changedDatabaseArtifactError(inventory, removedArtifactCount);
    }
    transferred = true;
    return { descriptor, openPath };
  } finally {
    if (!transferred) closeSync(descriptor);
  }
}

function openBoundDatabase(
  Database: typeof DatabaseSync,
  entry: InventoryEntry,
  inventory: CacheInventory,
  removedArtifactCount: number,
): DatabaseSync {
  const artifact = openBoundDatabaseArtifact(entry, inventory, removedArtifactCount);
  try {
    return new Database(artifact.openPath);
  } finally {
    closeSync(artifact.descriptor);
  }
}

function assertDatabaseInactive(
  Database: typeof DatabaseSync,
  entry: InventoryEntry,
  inventory: CacheInventory,
): void {
  let database: DatabaseSync | undefined;
  let transactionStarted = false;
  try {
    database = openBoundDatabase(Database, entry, inventory, 0);
    database.exec("PRAGMA busy_timeout = 0");
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    database.exec("ROLLBACK");
    transactionStarted = false;
  } catch (error) {
    if (error instanceof SymbolIndexCacheError) throw error;
    if (isLockError(error)) {
      throw cacheError(
        "CACHE_ACTIVE",
        "Cache clear refused a concurrently active database.",
        inventoryFailureDetails(inventory, 0, { active_database: 1 }),
      );
    }
    if (!isCorruptDatabaseError(error)) {
      throw cacheError(
        "CACHE_UNSAFE",
        "Cache database activity could not be checked safely.",
        inventoryFailureDetails(inventory, 0, { lock_check_failed: 1 }),
      );
    }
  } finally {
    if (transactionStarted) {
      try {
        database?.exec("ROLLBACK");
      } catch {
        // Closing the private probe remains the fail-closed cleanup path.
      }
    }
    try {
      database?.close();
    } catch {
      // The clear operation has already failed closed if this probe did not complete.
    }
  }
}

function acquireExclusiveDatabaseGuard(
  Database: typeof DatabaseSync,
  entry: InventoryEntry,
  inventory: CacheInventory,
  removedArtifactCount: number,
): DatabaseActivityGuard {
  let database: DatabaseSync | undefined;
  let transactionStarted = false;
  try {
    database = openBoundDatabase(Database, entry, inventory, removedArtifactCount);
    database.exec("PRAGMA busy_timeout = 0");
    database.exec("PRAGMA locking_mode = EXCLUSIVE");
    database.exec("BEGIN EXCLUSIVE");
    transactionStarted = true;
    return { database, transactionStarted, released: false };
  } catch (error) {
    if (transactionStarted) {
      try {
        database?.exec("ROLLBACK");
      } catch {
        // Closing the failed private guard remains the cleanup path.
      }
    }
    try {
      database?.close();
    } catch {
      // The group remains untouched when guard acquisition fails.
    }
    if (error instanceof SymbolIndexCacheError) throw error;
    if (isLockError(error)) {
      throw cacheError(
        "CACHE_ACTIVE",
        "Cache clear refused a concurrently active database.",
        inventoryFailureDetails(inventory, removedArtifactCount, { active_database: 1 }),
      );
    }
    throw cacheError(
      "CACHE_UNSAFE",
      "Cache database activity could not be guarded safely.",
      inventoryFailureDetails(inventory, removedArtifactCount, { lock_check_failed: 1 }),
    );
  }
}

function releaseExclusiveDatabaseGuard(guard: DatabaseActivityGuard): boolean {
  if (guard.released) return true;
  guard.released = true;
  let released = true;
  if (guard.transactionStarted) {
    try {
      guard.database.exec("ROLLBACK");
      guard.transactionStarted = false;
    } catch {
      released = false;
    }
  }
  try {
    guard.database.close();
  } catch {
    released = false;
  }
  return released;
}

async function assertDatabasesInactive(
  inventory: CacheInventory,
  DatabaseOverride?: typeof DatabaseSync,
): Promise<DatabaseActivityProbe | null> {
  const databases = inventory.entries.filter(
    (entry) => entry.nodeType === "regular" && entry.artifact === "active_database",
  );
  if (databases.length === 0) return null;

  let Database = DatabaseOverride;
  if (!Database) {
    try {
      ({ DatabaseSync: Database } = await import("node:sqlite"));
    } catch {
      throw cacheError(
        "CACHE_UNSAFE",
        "Cache database activity could not be checked on this runtime.",
        inventoryFailureDetails(inventory, 0, { lock_check_failed: databases.length }),
      );
    }
  }

  const sqlitePaths = new Set<string>();
  for (const entry of databases) {
    if (!(await hasSQLiteHeader(entry))) continue;
    assertDatabaseInactive(Database, entry, inventory);
    sqlitePaths.add(entry.absolutePath);
  }
  return { Database, sqlitePaths };
}

function policyFrom(options: SymbolIndexCacheOptions): SymbolIndexPersistencePolicy {
  return readSymbolIndexPersistencePolicy(options.environment, options.resolveHomeDirectory);
}

function emptyInspectResult(
  policy: SymbolIndexPersistencePolicy,
  state: "disabled" | "missing",
): SymbolIndexCacheInspectResult {
  return {
    status: "ok",
    command: "cache inspect",
    policy: policy.mode,
    backend: policy.backend,
    state,
    regular_file_count: 0,
    total_bytes: 0,
    active_database_count: 0,
    sidecar_count: 0,
    quarantine_count: 0,
    unrecognized_regular_file_count: 0,
    unsafe_entry_count: 0,
  };
}

function emptyClearResult(
  policy: SymbolIndexPersistencePolicy,
  state: "disabled" | "missing",
): SymbolIndexCacheClearResult {
  return {
    status: "ok",
    command: "cache clear",
    policy: policy.mode,
    backend: policy.backend,
    state,
    deleted_artifact_count: 0,
    deleted_active_database_count: 0,
    deleted_sidecar_count: 0,
    deleted_quarantine_count: 0,
    unrecognized_regular_file_count: 0,
    not_removed_artifact_count: 0,
    reason_counts: {},
  };
}

export async function inspectSymbolIndexCache(
  options: SymbolIndexCacheOptions = {},
): Promise<SymbolIndexCacheInspectResult> {
  const policy = policyFrom(options);
  if (policy.backend !== "sqlite" || !policy.cache_root)
    return emptyInspectResult(policy, "disabled");
  if ((await validateRoot(policy.cache_root)) === "missing")
    return emptyInspectResult(policy, "missing");

  const inventory = await inventoryRoot(policy.cache_root, limitsFrom(options));
  return {
    status: "ok",
    command: "cache inspect",
    policy: policy.mode,
    backend: policy.backend,
    state: "ready",
    regular_file_count: inventory.regularFileCount,
    total_bytes: inventory.totalBytes,
    active_database_count: inventory.activeDatabaseCount,
    sidecar_count: inventory.sidecarCount,
    quarantine_count: inventory.quarantineCount,
    unrecognized_regular_file_count: inventory.unrecognizedRegularFileCount,
    unsafe_entry_count: inventory.unsafeEntryCount,
  };
}

export async function clearSymbolIndexCache(
  options: SymbolIndexCacheOptions = {},
): Promise<SymbolIndexCacheClearResult> {
  const policy = policyFrom(options);
  if (policy.backend !== "sqlite" || !policy.cache_root)
    return emptyClearResult(policy, "disabled");
  if ((await validateRoot(policy.cache_root)) === "missing")
    return emptyClearResult(policy, "missing");

  const limits = limitsFrom(options);
  const initialInventory = await inventoryRoot(policy.cache_root, limits);
  if (initialInventory.unsafeEntryCount > 0) {
    throw cacheError(
      "CACHE_UNSAFE",
      "Cache clear refused unsafe selected-tree entries.",
      inventoryFailureDetails(initialInventory),
    );
  }
  if (!(await inventoryIsCurrent(initialInventory))) {
    throw cacheError(
      "CACHE_UNSAFE",
      "Cache inventory changed during preflight.",
      inventoryFailureDetails(initialInventory, 0, { changed: 1 }),
    );
  }
  const inventory = await inventoryRoot(policy.cache_root, limits);
  if (inventory.unsafeEntryCount > 0) {
    throw cacheError(
      "CACHE_UNSAFE",
      "Cache clear refused unsafe selected-tree entries.",
      inventoryFailureDetails(inventory),
    );
  }
  if (!(await inventoryIsCurrent(inventory))) {
    throw cacheError(
      "CACHE_UNSAFE",
      "Cache inventory changed during preflight.",
      inventoryFailureDetails(inventory, 0, { changed: 1 }),
    );
  }
  const activityProbe = await assertDatabasesInactive(inventory, options.DatabaseSync);

  const targets = inventory.entries
    .filter(
      (entry): entry is InventoryEntry & { artifact: CacheArtifactKind } =>
        entry.nodeType === "regular" && entry.artifact !== null,
    )
    .sort(deletionCompare);
  const deleted = {
    active_database: 0,
    wal: 0,
    shm: 0,
    quarantine: 0,
  } satisfies Record<CacheArtifactKind, number>;

  const guardedGroups = new Map<
    string,
    { readonly main: InventoryEntry; readonly indexes: number[] }
  >();
  if (activityProbe) {
    for (const target of targets) {
      if (
        target.artifact === "active_database" &&
        activityProbe.sqlitePaths.has(target.absolutePath)
      ) {
        guardedGroups.set(artifactGroup(target), { main: target, indexes: [] });
      }
    }
    for (const [index, target] of targets.entries()) {
      const group = guardedGroups.get(artifactGroup(target));
      if (group) group.indexes.push(index);
    }
  }
  const preflightedHooks = new Set<number>();
  let activeGuard: DatabaseActivityGuard | undefined;

  const partialFailure = (reason: CacheReason): SymbolIndexCacheError => {
    const removedArtifactCount = Object.values(deleted).reduce((total, count) => total + count, 0);
    const reasonCounts: CacheReasonCounts = { [reason]: 1 };
    const notAttempted = targets.length - removedArtifactCount - 1;
    if (notAttempted > 0) reasonCounts.not_attempted = notAttempted;
    return cacheError("CACHE_PARTIAL", "Cache clear stopped before every target was removed.", {
      removed_artifact_count: removedArtifactCount,
      not_removed_artifact_count: targets.length - removedArtifactCount,
      unrecognized_regular_file_count: inventory.unrecognizedRegularFileCount,
      reason_counts: reasonCounts,
    });
  };

  try {
    for (const [index, target] of targets.entries()) {
      const guardedGroup = guardedGroups.get(artifactGroup(target));
      if (guardedGroup?.indexes[0] === index) {
        for (const hookIndex of guardedGroup.indexes) {
          const hookTarget = targets[hookIndex];
          try {
            await options.testHooks?.beforeUnlink?.({
              artifact: hookTarget.artifact,
              name: hookTarget.name,
              ordinal: hookIndex,
            });
            preflightedHooks.add(hookIndex);
          } catch {
            throw partialFailure("delete_failed");
          }
        }
        const removedArtifactCount = Object.values(deleted).reduce(
          (total, count) => total + count,
          0,
        );
        activeGuard = acquireExclusiveDatabaseGuard(
          activityProbe!.Database,
          guardedGroup.main,
          inventory,
          removedArtifactCount,
        );
      }

      let reason: CacheReason | null = null;
      if (!preflightedHooks.has(index)) {
        try {
          await options.testHooks?.beforeUnlink?.({
            artifact: target.artifact,
            name: target.name,
            ordinal: index,
          });
        } catch {
          reason = "delete_failed";
        }
      }
      if (reason === null) {
        if (
          !directoryChainIsCurrentSync(inventory, target.absolutePath) ||
          !identityIsCurrentSync(target.absolutePath, target.identity)
        ) {
          reason = "changed";
        }
      }
      if (reason === null) {
        try {
          unlinkSync(target.absolutePath);
          deleted[target.artifact] += 1;
        } catch {
          reason = "delete_failed";
        }
      }
      if (reason !== null) throw partialFailure(reason);

      if (
        guardedGroup &&
        guardedGroup.indexes[guardedGroup.indexes.length - 1] === index &&
        activeGuard
      ) {
        const released = releaseExclusiveDatabaseGuard(activeGuard);
        activeGuard = undefined;
        if (!released) throw partialFailure("lock_check_failed");
      }
    }
  } finally {
    if (activeGuard) releaseExclusiveDatabaseGuard(activeGuard);
  }

  const deletedArtifactCount = Object.values(deleted).reduce((total, count) => total + count, 0);
  return {
    status: "ok",
    command: "cache clear",
    policy: policy.mode,
    backend: policy.backend,
    state: "cleared",
    deleted_artifact_count: deletedArtifactCount,
    deleted_active_database_count: deleted.active_database,
    deleted_sidecar_count: deleted.wal + deleted.shm,
    deleted_quarantine_count: deleted.quarantine,
    unrecognized_regular_file_count: inventory.unrecognizedRegularFileCount,
    not_removed_artifact_count: 0,
    reason_counts: {},
  };
}
