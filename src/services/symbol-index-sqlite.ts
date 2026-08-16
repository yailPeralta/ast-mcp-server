import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ProjectIdentity } from "./project-status.js";
import {
  createSymbolIndexFileEntry,
  createSymbolIndexRefreshPlan,
  createSymbolIndexSymbol,
  MAX_SYMBOL_INDEX_FILE_ENTRIES,
  MAX_SYMBOL_INDEX_QUERY_CANDIDATES,
  MAX_SYMBOL_INDEX_ROW_PAYLOAD_BYTES,
  MAX_SYMBOL_INDEX_SCANNED_SYMBOLS,
  MAX_SYMBOL_INDEX_TOTAL_PAYLOAD_BYTES,
  SYMBOL_INDEX_SCHEMA_VERSION,
  SymbolIndexScanLimitError,
  symbolIndexMatchRank,
  symbolIndexQueryOffset,
  symbolIndexRankWindow,
  symbolProjectionJsonByteLength,
  type SymbolIndexCountQuery,
  type SymbolIndexFileEntry,
  type SymbolIndexQuery,
  type SymbolIndexRefreshInput,
  type SymbolIndexRefreshResult,
  type SymbolIndexStore,
  type SymbolIndexSymbolMatch,
} from "./symbol-index.js";

const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "utf8");
const DEFAULT_BUSY_TIMEOUT_MS = 1_000;
const SQLITE_READ_PAGE_SIZE = 32;
const OWNER_ONLY_DIRECTORY_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;
const STICKY_DIRECTORY_MODE = 0o1000;
const GROUP_OR_OTHER_WRITE_MODE = 0o022;
const GROUP_OR_OTHER_ACCESS_MODE = 0o077;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const LINUX_O_PATH = 0o10000000;
const SUPPORTS_OWNER_ONLY_MODES =
  process.platform === "linux" && typeof process.getuid === "function";
const SUPPORTS_DESCRIPTOR_BOUND_OPEN = process.platform === "linux";

type ArtifactIdentity = Pick<Stats, "dev" | "ino">;

interface PreparedDatabaseArtifact {
  readonly descriptor: number;
  readonly identity: ArtifactIdentity;
  readonly openPath: string;
}

type DatabaseSyncConstructor = new (filePath: string) => DatabaseSync;

function isDescriptorOpenCapabilityFailure(error: unknown): boolean {
  if (!SUPPORTS_DESCRIPTOR_BOUND_OPEN) return false;
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "";
  if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(code)) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return code === "ERR_SQLITE_ERROR" && message.includes("unable to open database file");
}

type SqliteRow = {
  project_id: unknown;
  config_id: unknown;
  file_path: unknown;
  content_hash: unknown;
  config_digest: unknown;
  symbols_json: unknown;
  symbols_digest: unknown;
  last_indexed_at: unknown;
  schema_version: unknown;
};

type MetadataRow = { value: unknown };
type TableInfoRow = {
  cid: unknown;
  name: unknown;
  type: unknown;
  notnull: unknown;
  dflt_value: unknown;
  pk: unknown;
};
type TableColumnSpec = Omit<TableInfoRow, "cid">;

const EXPECTED_TABLE_COLUMNS: {
  readonly metadata: readonly TableColumnSpec[];
  readonly symbol_index: readonly TableColumnSpec[];
} = {
  metadata: [
    { name: "key", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
    { name: "value", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  ],
  symbol_index: [
    { name: "project_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
    { name: "config_id", type: "TEXT", notnull: 1, dflt_value: "''", pk: 2 },
    { name: "file_path", type: "TEXT", notnull: 1, dflt_value: null, pk: 3 },
    { name: "content_hash", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "config_digest", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "symbols_json", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "symbols_digest", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "last_indexed_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "schema_version", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
  ],
} as const;
const LEGACY_SYMBOL_INDEX_COLUMNS = EXPECTED_TABLE_COLUMNS.symbol_index.filter(
  (column) => column.name !== "symbols_digest",
);
const SYMBOL_INDEX_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS symbol_index (
    project_id TEXT NOT NULL,
    config_id TEXT NOT NULL DEFAULT '',
    file_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    config_digest TEXT NOT NULL,
    symbols_json TEXT NOT NULL,
    symbols_digest TEXT NOT NULL,
    last_indexed_at TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    PRIMARY KEY (project_id, config_id, file_path)
  );
`;
export type SymbolIndexStorageFailureCode =
  | "capability_unavailable"
  | "invalid_path"
  | "corrupt_storage"
  | "unsupported_schema"
  | "migration_failed"
  | "contention"
  | "read_failed"
  | "write_failed"
  | "closed";

export class SymbolIndexStorageError extends Error {
  readonly code: SymbolIndexStorageFailureCode;
  readonly cause: unknown;

  constructor(code: SymbolIndexStorageFailureCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SymbolIndexStorageError";
    this.code = code;
    this.cause = cause;
  }
}

export interface SQLiteSymbolIndexStoreOptions {
  readonly busyTimeoutMs?: number;
  readonly DatabaseSync?: DatabaseSyncConstructor | null;
}

function storageErrorCode(
  error: unknown,
  fallback: SymbolIndexStorageFailureCode,
): SymbolIndexStorageFailureCode {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("busy") || message.includes("locked") || message.includes("timeout")) {
    return "contention";
  }
  if (
    message.includes("malformed") ||
    message.includes("not a database") ||
    message.includes("database disk image")
  ) {
    return "corrupt_storage";
  }
  return fallback;
}

function wrapStorageError(
  error: unknown,
  fallback: SymbolIndexStorageFailureCode,
  message: string,
): SymbolIndexStorageError {
  if (error instanceof SymbolIndexStorageError) return error;
  return new SymbolIndexStorageError(storageErrorCode(error, fallback), message, error);
}

function assertSafeDatabasePath(filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    throw new SymbolIndexStorageError("invalid_path", "SQLite cache path must be absolute.");
  }
  const normalized = path.normalize(filePath);
  if (normalized !== filePath || normalized.split(path.sep).includes("..")) {
    throw new SymbolIndexStorageError("invalid_path", "SQLite cache path is not canonical.");
  }
  return normalized;
}

function assertTrustedDirectoryStats(stats: Stats, packageOwned: boolean): void {
  if (!SUPPORTS_OWNER_ONLY_MODES) return;
  const currentUid = process.getuid!();
  const mode = stats.mode & 0o7777;
  if (stats.uid !== currentUid && stats.uid !== 0) {
    throw new SymbolIndexStorageError(
      "invalid_path",
      "SQLite cache directory ancestry is not owned by a trusted principal.",
    );
  }
  if (packageOwned) {
    if (stats.uid !== currentUid || (mode & GROUP_OR_OTHER_ACCESS_MODE) !== 0) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache directory is not private to the invoking owner.",
      );
    }
    return;
  }
  if ((mode & GROUP_OR_OTHER_WRITE_MODE) !== 0 && (mode & STICKY_DIRECTORY_MODE) === 0) {
    throw new SymbolIndexStorageError(
      "invalid_path",
      "SQLite cache directory ancestry is writable by an untrusted principal.",
    );
  }
}

function assertTrustedCanonicalDirectoryChain(directoryPath: string): void {
  const parsed = path.parse(directoryPath);
  const segments = path.relative(parsed.root, directoryPath).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache directory contains a non-canonical ancestor.",
      );
    }
    assertTrustedDirectoryStats(stats, current === directoryPath);
  }
  if (realpathSync(directoryPath) !== directoryPath) {
    throw new SymbolIndexStorageError(
      "invalid_path",
      "SQLite cache directory resolves outside its canonical path.",
    );
  }
}

function sameArtifactIdentity(stats: ArtifactIdentity, expected: ArtifactIdentity): boolean {
  return stats.dev === expected.dev && stats.ino === expected.ino;
}

function assertPrivateArtifactStats(stats: Stats, message: string): void {
  if (!stats.isFile() || stats.nlink !== 1) {
    throw new SymbolIndexStorageError("invalid_path", message);
  }
  if (SUPPORTS_OWNER_ONLY_MODES && stats.uid !== process.getuid!()) {
    throw new SymbolIndexStorageError("invalid_path", message);
  }
}

function assertPreparedArtifactIdentity(filePath: string, expected: ArtifactIdentity): void {
  let stats: Stats;
  try {
    stats = lstatSync(filePath);
    if (
      stats.isSymbolicLink() ||
      !sameArtifactIdentity(stats, expected) ||
      realpathSync(filePath) !== filePath
    ) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache artifact identity changed before use.",
      );
    }
    assertPrivateArtifactStats(stats, "SQLite cache artifact is not a unique owned regular file.");
    if (SUPPORTS_OWNER_ONLY_MODES && (stats.mode & 0o777) !== OWNER_ONLY_FILE_MODE) {
      throw new SymbolIndexStorageError("invalid_path", "SQLite cache artifact is not owner-only.");
    }
  } catch (error) {
    if (error instanceof SymbolIndexStorageError) throw error;
    throw wrapStorageError(error, "read_failed", "SQLite cache artifact could not be verified.");
  }
}

function prepareExistingPrivateArtifact(filePath: string): ArtifactIdentity | null {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, constants.O_RDWR | NO_FOLLOW);
    const before = fstatSync(descriptor);
    assertPrivateArtifactStats(before, "SQLite cache artifact is not a unique owned regular file.");
    if (realpathSync(filePath) !== filePath) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache artifact resolves outside its canonical path.",
      );
    }
    if (SUPPORTS_OWNER_ONLY_MODES) fchmodSync(descriptor, OWNER_ONLY_FILE_MODE);
    const after = fstatSync(descriptor);
    if (!sameArtifactIdentity(before, after)) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache artifact identity changed while securing it.",
      );
    }
    assertPrivateArtifactStats(after, "SQLite cache artifact changed while securing it.");
    const identity = { dev: after.dev, ino: after.ino };
    assertPreparedArtifactIdentity(filePath, identity);
    return identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    if (error instanceof SymbolIndexStorageError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === "ELOOP") {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache artifact must not be a symbolic link.",
        error,
      );
    }
    throw wrapStorageError(error, "write_failed", "SQLite cache artifact could not be secured.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function preparePrivateDatabaseArtifact(filePath: string): PreparedDatabaseArtifact {
  let descriptor: number | undefined;
  try {
    try {
      descriptor = openSync(filePath, constants.O_RDWR | NO_FOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      descriptor = openSync(
        filePath,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | NO_FOLLOW,
        OWNER_ONLY_FILE_MODE,
      );
    }
    const before = fstatSync(descriptor);
    assertPrivateArtifactStats(before, "SQLite cache artifact is not a unique owned regular file.");
    if (realpathSync(filePath) !== filePath) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache artifact resolves outside its canonical path.",
      );
    }
    if (SUPPORTS_OWNER_ONLY_MODES) fchmodSync(descriptor, OWNER_ONLY_FILE_MODE);
    const after = fstatSync(descriptor);
    if (!sameArtifactIdentity(before, after)) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache artifact identity changed while securing it.",
      );
    }
    assertPrivateArtifactStats(after, "SQLite cache artifact changed while securing it.");
    const identity = { dev: after.dev, ino: after.ino };
    assertPreparedArtifactIdentity(filePath, identity);
    const openPath = SUPPORTS_DESCRIPTOR_BOUND_OPEN ? `/proc/self/fd/${descriptor}` : filePath;
    if (SUPPORTS_DESCRIPTOR_BOUND_OPEN) {
      let descriptorTarget: string;
      try {
        descriptorTarget = realpathSync(openPath);
      } catch (error) {
        throw new SymbolIndexStorageError(
          "capability_unavailable",
          "SQLite cache descriptor binding is unavailable on this Linux runtime.",
          error,
        );
      }
      if (descriptorTarget !== filePath) {
        throw new SymbolIndexStorageError(
          "capability_unavailable",
          "SQLite cache descriptor binding is unavailable on this Linux runtime.",
        );
      }
    }
    const prepared = { descriptor, identity, openPath };
    descriptor = undefined;
    return prepared;
  } catch (error) {
    if (error instanceof SymbolIndexStorageError) throw error;
    if (["EEXIST", "ELOOP"].includes((error as NodeJS.ErrnoException)?.code ?? "")) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache artifact changed while it was being prepared.",
        error,
      );
    }
    throw wrapStorageError(error, "write_failed", "SQLite cache artifact could not be prepared.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function normalizeCreatedDirectory(directoryPath: string): Promise<void> {
  if (!SUPPORTS_OWNER_ONLY_MODES) return;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directoryPath, LINUX_O_PATH | (constants.O_DIRECTORY ?? 0) | NO_FOLLOW);
    const opened = await handle.stat();
    if (!opened.isDirectory()) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache directory contains a non-canonical ancestor.",
      );
    }
    await chmod(`/proc/self/fd/${handle.fd}`, OWNER_ONLY_DIRECTORY_MODE);
    const [hardened, named, physicalPath] = await Promise.all([
      handle.stat(),
      lstat(directoryPath),
      realpath(directoryPath),
    ]);
    if (
      !sameArtifactIdentity(hardened, opened) ||
      !sameArtifactIdentity(named, opened) ||
      named.isSymbolicLink() ||
      !named.isDirectory() ||
      physicalPath !== directoryPath ||
      (hardened.mode & 0o777) !== OWNER_ONLY_DIRECTORY_MODE ||
      (named.mode & 0o777) !== OWNER_ONLY_DIRECTORY_MODE
    ) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache directory changed while it was secured.",
      );
    }
  } catch (error) {
    if (error instanceof SymbolIndexStorageError) throw error;
    throw wrapStorageError(error, "write_failed", "SQLite cache directory could not be secured.");
  } finally {
    await handle?.close();
  }
}

async function ensureCanonicalDirectory(directoryPath: string): Promise<void> {
  const parsed = path.parse(directoryPath);
  const segments = path.relative(parsed.root, directoryPath).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let created = false;
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw wrapStorageError(
          error,
          "write_failed",
          "SQLite cache directory could not be inspected.",
        );
      }
      try {
        await mkdir(current, { mode: OWNER_ONLY_DIRECTORY_MODE });
        created = true;
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw wrapStorageError(
            mkdirError,
            "write_failed",
            "SQLite cache directory could not be created.",
          );
        }
      }
      if (created) await normalizeCreatedDirectory(current);
      stats = await lstat(current);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache directory contains a non-canonical ancestor.",
      );
    }
    assertTrustedDirectoryStats(stats, created || current === directoryPath);
  }
  if ((await realpath(directoryPath)) !== directoryPath) {
    throw new SymbolIndexStorageError(
      "invalid_path",
      "SQLite cache directory resolves outside its canonical path.",
    );
  }
}

async function assertDatabaseHeader(filePath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const bytes = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== SQLITE_HEADER.length || !bytes.equals(SQLITE_HEADER)) {
      throw new SymbolIndexStorageError("corrupt_storage", "SQLite cache header is invalid.");
    }
  } catch (error) {
    if (error instanceof SymbolIndexStorageError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw wrapStorageError(error, "read_failed", "SQLite cache header could not be read.");
  } finally {
    await handle?.close();
  }
}

async function assertCanonicalDatabaseTarget(filePath: string): Promise<void> {
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink() || !stats.isFile() || (await realpath(filePath)) !== filePath) {
      throw new SymbolIndexStorageError(
        "invalid_path",
        "SQLite cache file must be a canonical regular file.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    if (error instanceof SymbolIndexStorageError) throw error;
    throw wrapStorageError(error, "read_failed", "SQLite cache target could not be inspected.");
  }
}

async function loadDatabaseSyncConstructor(): Promise<DatabaseSyncConstructor> {
  try {
    const sqlite = await import("node:sqlite");
    return sqlite.DatabaseSync;
  } catch (error) {
    throw new SymbolIndexStorageError(
      "capability_unavailable",
      "The current Node runtime does not expose node:sqlite.",
      error,
    );
  }
}

function projectMatches(left: ProjectIdentity, right: ProjectIdentity): boolean {
  return left.project_id === right.project_id && left.config_id === right.config_id;
}

function configKey(configId: string | null): string {
  return configId ?? "";
}

function projectionDigest(symbolsJson: string): string {
  return createHash("sha256").update(symbolsJson).digest("hex");
}

function countJsonArrayItemsWithinLimit(value: string, limit: number): number {
  let depth = 0;
  let count = 0;
  let inString = false;
  let escaped = false;
  let expectingValue = true;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      if (depth === 1 && expectingValue) {
        count += 1;
        if (count > limit) return count;
        expectingValue = false;
      }
      inString = true;
      continue;
    }
    if (depth === 0) {
      if (/\s/u.test(character)) continue;
      if (character !== "[") return 0;
      depth = 1;
      continue;
    }
    if (depth === 1 && expectingValue && !/\s/u.test(character) && character !== "]") {
      count += 1;
      if (count > limit) return count;
      expectingValue = false;
    }
    if (character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") {
      if (depth === 1) return count;
      depth -= 1;
    } else if (character === "," && depth === 1) {
      expectingValue = true;
    }
  }
  return count;
}

function toEntry(
  row: SqliteRow,
  remainingSymbols = MAX_SYMBOL_INDEX_SCANNED_SYMBOLS,
  symbolLimitError: () => Error = () =>
    new SymbolIndexStorageError("corrupt_storage", "SQLite cache row symbol limit was exceeded."),
): SymbolIndexFileEntry {
  if (
    typeof row.project_id !== "string" ||
    typeof row.config_id !== "string" ||
    typeof row.file_path !== "string" ||
    typeof row.content_hash !== "string" ||
    typeof row.config_digest !== "string" ||
    typeof row.symbols_json !== "string" ||
    typeof row.symbols_digest !== "string" ||
    typeof row.last_indexed_at !== "string" ||
    typeof row.schema_version !== "number"
  ) {
    throw new SymbolIndexStorageError("corrupt_storage", "SQLite cache row shape is invalid.");
  }
  if (row.schema_version !== SYMBOL_INDEX_SCHEMA_VERSION) {
    throw new SymbolIndexStorageError(
      "unsupported_schema",
      "SQLite cache row schema is unsupported.",
    );
  }
  if (
    Buffer.byteLength(row.symbols_json, "utf8") > MAX_SYMBOL_INDEX_ROW_PAYLOAD_BYTES ||
    projectionDigest(row.symbols_json) !== row.symbols_digest
  ) {
    throw new SymbolIndexStorageError(
      "corrupt_storage",
      "SQLite cache symbol projection checksum is invalid.",
    );
  }
  if (countJsonArrayItemsWithinLimit(row.symbols_json, remainingSymbols) > remainingSymbols) {
    throw symbolLimitError();
  }

  let symbols: unknown;
  try {
    symbols = JSON.parse(row.symbols_json);
  } catch (error) {
    throw new SymbolIndexStorageError(
      "corrupt_storage",
      "SQLite cache symbol payload is invalid.",
      error,
    );
  }

  try {
    return createSymbolIndexFileEntry({
      project: {
        project_id: row.project_id,
        config_id: row.config_id === "" ? null : row.config_id,
      },
      file_path: row.file_path,
      content_hash: row.content_hash,
      config_digest: row.config_digest,
      symbols: symbols as SymbolIndexFileEntry["symbols"],
      last_indexed_at: row.last_indexed_at,
    });
  } catch (error) {
    throw wrapStorageError(error, "corrupt_storage", "SQLite cache row validation failed.");
  }
}

function assertEntrySetWithinBudget(
  entries: readonly SymbolIndexFileEntry[],
  failure: SymbolIndexStorageFailureCode,
): void {
  if (entries.length > MAX_SYMBOL_INDEX_FILE_ENTRIES) {
    throw new SymbolIndexStorageError(failure, "SQLite cache file-entry limit was exceeded.");
  }
  let payloadBytes = 0;
  let symbols = 0;
  for (const entry of entries) {
    const entryPayloadBytes = symbolProjectionJsonByteLength(entry.symbols);
    if (entryPayloadBytes > MAX_SYMBOL_INDEX_ROW_PAYLOAD_BYTES) {
      throw new SymbolIndexStorageError(failure, "SQLite cache row payload limit was exceeded.");
    }
    payloadBytes += entryPayloadBytes;
    symbols += entry.symbols.length;
    if (
      payloadBytes > MAX_SYMBOL_INDEX_TOTAL_PAYLOAD_BYTES ||
      symbols > MAX_SYMBOL_INDEX_SCANNED_SYMBOLS
    ) {
      throw new SymbolIndexStorageError(failure, "SQLite cache lifecycle budget was exceeded.");
    }
  }
}

export async function openSQLiteSymbolIndexStore(
  filePath: string,
  options: SQLiteSymbolIndexStoreOptions = {},
): Promise<SQLiteSymbolIndexStore> {
  const safePath = assertSafeDatabasePath(filePath);
  if (options.DatabaseSync === null) {
    throw new SymbolIndexStorageError(
      "capability_unavailable",
      "SQLite capability was disabled by the failure-injection hook.",
    );
  }
  const DatabaseSync = options.DatabaseSync ?? (await loadDatabaseSyncConstructor());
  const databaseDirectory = path.dirname(safePath);
  try {
    await ensureCanonicalDirectory(databaseDirectory);
  } catch (error) {
    throw wrapStorageError(error, "write_failed", "SQLite cache directory creation failed.");
  }
  await assertCanonicalDatabaseTarget(safePath);
  await assertDatabaseHeader(safePath);
  try {
    return new SQLiteSymbolIndexStore(
      safePath,
      DatabaseSync,
      options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    );
  } catch (error) {
    throw wrapStorageError(error, "read_failed", "SQLite cache could not be opened.");
  }
}

export async function quarantineSQLiteSymbolIndexFile(filePath: string): Promise<string | null> {
  const safePath = assertSafeDatabasePath(filePath);
  const databaseIdentity = prepareExistingPrivateArtifact(safePath);
  if (!databaseIdentity) return null;
  const sidecars = ["wal", "shm"].map((suffix) => {
    const sidecarPath = `${safePath}-${suffix}`;
    return {
      path: sidecarPath,
      identity: prepareExistingPrivateArtifact(sidecarPath),
    };
  });
  assertPreparedArtifactIdentity(safePath, databaseIdentity);
  for (const sidecar of sidecars) {
    if (sidecar.identity) assertPreparedArtifactIdentity(sidecar.path, sidecar.identity);
  }
  const quarantinePath = `${safePath}.corrupt-${process.pid}-${Date.now()}`;
  try {
    await rename(safePath, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw wrapStorageError(error, "write_failed", "SQLite cache quarantine failed.");
  }
  assertPreparedArtifactIdentity(quarantinePath, databaseIdentity);
  for (const sidecar of sidecars) {
    if (!sidecar.identity) continue;
    assertPreparedArtifactIdentity(sidecar.path, sidecar.identity);
    await rm(sidecar.path);
  }
  return quarantinePath;
}

export class SQLiteSymbolIndexStore implements SymbolIndexStore {
  private readonly filePath: string;
  private readonly busyTimeoutMs: number;
  private migrationWasPerformed = false;
  private db: DatabaseSync | null;

  constructor(
    filePath: string,
    DatabaseSync: DatabaseSyncConstructor,
    busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS,
  ) {
    this.filePath = assertSafeDatabasePath(filePath);
    assertTrustedCanonicalDirectoryChain(path.dirname(this.filePath));
    this.busyTimeoutMs =
      Number.isInteger(busyTimeoutMs) && busyTimeoutMs > 0
        ? busyTimeoutMs
        : DEFAULT_BUSY_TIMEOUT_MS;
    const preparedDatabase = preparePrivateDatabaseArtifact(this.filePath);
    prepareExistingPrivateArtifact(`${this.filePath}-wal`);
    prepareExistingPrivateArtifact(`${this.filePath}-shm`);
    try {
      this.db = new DatabaseSync(preparedDatabase.openPath);
    } catch (error) {
      closeSync(preparedDatabase.descriptor);
      if (isDescriptorOpenCapabilityFailure(error)) {
        throw new SymbolIndexStorageError(
          "capability_unavailable",
          "SQLite cache descriptor binding is unavailable on this Linux runtime.",
          error,
        );
      }
      throw error;
    }
    try {
      closeSync(preparedDatabase.descriptor);
    } catch (error) {
      this.db.close();
      this.db = null;
      throw wrapStorageError(
        error,
        "write_failed",
        "SQLite cache descriptor could not be released safely.",
      );
    }
    try {
      assertTrustedCanonicalDirectoryChain(path.dirname(this.filePath));
      assertPreparedArtifactIdentity(this.filePath, preparedDatabase.identity);
      this.initialize();
      assertTrustedCanonicalDirectoryChain(path.dirname(this.filePath));
      assertPreparedArtifactIdentity(this.filePath, preparedDatabase.identity);
      prepareExistingPrivateArtifact(`${this.filePath}-wal`);
      prepareExistingPrivateArtifact(`${this.filePath}-shm`);
    } catch (error) {
      this.db.close();
      this.db = null;
      throw error;
    }
  }

  get migrationPerformed(): boolean {
    return this.migrationWasPerformed;
  }

  private requireDatabase(): DatabaseSync {
    if (!this.db) throw new SymbolIndexStorageError("closed", "SQLite cache is closed.");
    return this.db;
  }

  private initialize(): void {
    const db = this.requireDatabase();
    try {
      db.exec(`
        PRAGMA busy_timeout = ${this.busyTimeoutMs};
        PRAGMA journal_mode = WAL;
      `);
      let hasProjectionDigest = false;
      try {
        db.exec("BEGIN IMMEDIATE");
        db.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        `);
        db.exec(SYMBOL_INDEX_TABLE_SQL);
        hasProjectionDigest = this.assertSchemaShape();
        db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', ?)").run(
          String(SYMBOL_INDEX_SCHEMA_VERSION),
        );
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Preserve the schema-creation failure.
        }
        throw wrapStorageError(error, "write_failed", "SQLite cache schema creation failed.");
      }
      this.migrationWasPerformed = this.migrateRowsIfNeeded(hasProjectionDigest);
      this.readRows(null, SYMBOL_INDEX_SCHEMA_VERSION);
      const integrity = db.prepare("PRAGMA integrity_check").get() as
        { integrity_check?: unknown } | undefined;
      if (integrity?.integrity_check !== "ok") {
        throw new SymbolIndexStorageError(
          "corrupt_storage",
          "SQLite cache integrity check failed.",
        );
      }
    } catch (error) {
      throw wrapStorageError(error, "read_failed", "SQLite cache initialization failed.");
    }
  }

  private assertSchemaShape(): boolean {
    const db = this.requireDatabase();
    const metadataColumns = db.prepare("PRAGMA table_info(metadata)").all() as TableInfoRow[];
    const symbolColumns = db.prepare("PRAGMA table_info(symbol_index)").all() as TableInfoRow[];
    const sameColumns = (actual: TableInfoRow[], expected: readonly TableColumnSpec[]) =>
      actual.length === expected.length &&
      actual.every((column, index) => {
        const specification = expected[index];
        return (
          column.cid === index &&
          column.name === specification.name &&
          column.type === specification.type &&
          column.notnull === specification.notnull &&
          column.dflt_value === specification.dflt_value &&
          column.pk === specification.pk
        );
      });
    if (!sameColumns(metadataColumns, EXPECTED_TABLE_COLUMNS.metadata)) {
      throw new SymbolIndexStorageError(
        "unsupported_schema",
        "SQLite cache table schema is unsupported.",
      );
    }
    if (sameColumns(symbolColumns, EXPECTED_TABLE_COLUMNS.symbol_index)) return true;
    if (sameColumns(symbolColumns, LEGACY_SYMBOL_INDEX_COLUMNS)) return false;
    throw new SymbolIndexStorageError(
      "unsupported_schema",
      "SQLite cache table schema is unsupported.",
    );
  }

  private *readSqlitePages(
    sql: string,
    parameters: readonly (string | number)[] = [],
  ): Generator<SqliteRow> {
    const statement = this.requireDatabase().prepare(`${sql}\nLIMIT ? OFFSET ?`);
    let offset = 0;
    while (offset <= MAX_SYMBOL_INDEX_FILE_ENTRIES) {
      const pageLimit = Math.min(SQLITE_READ_PAGE_SIZE, MAX_SYMBOL_INDEX_FILE_ENTRIES + 1 - offset);
      const page = statement.all(...parameters, pageLimit, offset) as SqliteRow[];
      for (const row of page) yield row;
      offset += page.length;
      if (page.length < pageLimit) return;
    }
  }

  private migrateRowsIfNeeded(hasProjectionDigest: boolean): boolean {
    const db = this.requireDatabase();
    try {
      db.exec("BEGIN IMMEDIATE");
      const metadata = db
        .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
        .get() as MetadataRow | undefined;
      const metadataVersion = Number(metadata?.value);
      if (
        !Number.isInteger(metadataVersion) ||
        metadataVersion < 0 ||
        metadataVersion > SYMBOL_INDEX_SCHEMA_VERSION ||
        (metadataVersion === SYMBOL_INDEX_SCHEMA_VERSION && !hasProjectionDigest)
      ) {
        throw new SymbolIndexStorageError(
          "unsupported_schema",
          "SQLite cache schema is unsupported.",
        );
      }
      const rows = this.readSqlitePages(
        `SELECT project_id, config_id, file_path, content_hash, config_digest, symbols_json,
                ${hasProjectionDigest ? "symbols_digest" : "NULL AS symbols_digest"},
                last_indexed_at, schema_version
         FROM symbol_index
         ORDER BY project_id, config_id, file_path`,
      );
      const normalizedRows: Array<{ entry: SymbolIndexFileEntry; digest: string }> = [];
      let payloadBytes = 0;
      let decodedSymbols = 0;
      let hasLegacyRows = false;
      for (const row of rows) {
        if (normalizedRows.length >= MAX_SYMBOL_INDEX_FILE_ENTRIES) {
          throw new SymbolIndexStorageError(
            "migration_failed",
            "SQLite cache migration file-entry limit was exceeded.",
          );
        }
        if (
          typeof row.schema_version !== "number" ||
          ![0, 1, SYMBOL_INDEX_SCHEMA_VERSION].includes(row.schema_version)
        ) {
          throw new SymbolIndexStorageError(
            "unsupported_schema",
            "SQLite cache row schema is unsupported.",
          );
        }
        if (typeof row.symbols_json !== "string") {
          throw new SymbolIndexStorageError(
            "corrupt_storage",
            "SQLite cache row shape is invalid.",
          );
        }
        payloadBytes += Buffer.byteLength(row.symbols_json, "utf8");
        if (payloadBytes > MAX_SYMBOL_INDEX_TOTAL_PAYLOAD_BYTES) {
          throw new SymbolIndexStorageError(
            "migration_failed",
            "SQLite cache migration payload budget was exceeded.",
          );
        }
        const digest = projectionDigest(row.symbols_json);
        const normalized = {
          ...row,
          symbols_digest:
            row.schema_version === SYMBOL_INDEX_SCHEMA_VERSION ? row.symbols_digest : digest,
          schema_version: SYMBOL_INDEX_SCHEMA_VERSION,
        };
        const entry = toEntry(
          normalized,
          MAX_SYMBOL_INDEX_SCANNED_SYMBOLS - decodedSymbols,
          () =>
            new SymbolIndexStorageError(
              "migration_failed",
              "SQLite cache migration decoded-symbol budget was exceeded.",
            ),
        );
        decodedSymbols += entry.symbols.length;
        if (decodedSymbols > MAX_SYMBOL_INDEX_SCANNED_SYMBOLS) {
          throw new SymbolIndexStorageError(
            "migration_failed",
            "SQLite cache migration decoded-symbol budget was exceeded.",
          );
        }
        hasLegacyRows ||= row.schema_version !== SYMBOL_INDEX_SCHEMA_VERSION;
        normalizedRows.push({ entry, digest });
      }
      assertEntrySetWithinBudget(
        normalizedRows.map(({ entry }) => entry),
        "migration_failed",
      );
      const needsMigration =
        metadataVersion !== SYMBOL_INDEX_SCHEMA_VERSION || !hasProjectionDigest || hasLegacyRows;
      if (!needsMigration) {
        db.exec("COMMIT");
        return false;
      }

      if (!hasProjectionDigest) {
        db.exec("ALTER TABLE symbol_index RENAME TO symbol_index_legacy");
        db.exec(SYMBOL_INDEX_TABLE_SQL);
        const insert = db.prepare(
          `INSERT INTO symbol_index
            (project_id, config_id, file_path, content_hash, config_digest, symbols_json, symbols_digest, last_indexed_at, schema_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const { entry } of normalizedRows) {
          const symbolsJson = JSON.stringify(entry.symbols);
          insert.run(
            entry.project.project_id,
            configKey(entry.project.config_id),
            entry.file_path,
            entry.content_hash,
            entry.config_digest,
            symbolsJson,
            projectionDigest(symbolsJson),
            entry.last_indexed_at,
            SYMBOL_INDEX_SCHEMA_VERSION,
          );
        }
        db.exec("DROP TABLE symbol_index_legacy");
      } else {
        const update = db.prepare(
          `UPDATE symbol_index
           SET symbols_digest = ?, schema_version = ?
           WHERE project_id = ? AND config_id = ? AND file_path = ?`,
        );
        for (const { entry, digest } of normalizedRows) {
          update.run(
            digest,
            SYMBOL_INDEX_SCHEMA_VERSION,
            entry.project.project_id,
            configKey(entry.project.config_id),
            entry.file_path,
          );
        }
      }
      db.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run(
        String(SYMBOL_INDEX_SCHEMA_VERSION),
      );
      db.exec("COMMIT");
      this.assertSchemaShape();
      return true;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // The original failure is the useful classification.
      }
      throw wrapStorageError(error, "migration_failed", "SQLite cache migration failed.");
    }
  }

  private readRows(project: ProjectIdentity | null, schemaVersion: number): SymbolIndexFileEntry[] {
    const rows = project
      ? this.readSqlitePages(
          `SELECT project_id, config_id, file_path, content_hash, config_digest, symbols_json,
                    symbols_digest, last_indexed_at, schema_version
             FROM symbol_index
             WHERE project_id = ? AND config_id = ? AND schema_version = ?
             ORDER BY file_path`,
          [project.project_id, configKey(project.config_id), schemaVersion],
        )
      : this.readSqlitePages(
          `SELECT project_id, config_id, file_path, content_hash, config_digest, symbols_json,
                    symbols_digest, last_indexed_at, schema_version
             FROM symbol_index
             WHERE schema_version = ?
             ORDER BY project_id, config_id, file_path`,
          [schemaVersion],
        );
    const entries: SymbolIndexFileEntry[] = [];
    let totalPayloadBytes = 0;
    let decodedSymbols = 0;
    for (const row of rows) {
      if (entries.length >= MAX_SYMBOL_INDEX_FILE_ENTRIES) {
        throw new SymbolIndexStorageError(
          "corrupt_storage",
          "SQLite cache file-entry limit was exceeded.",
        );
      }
      if (typeof row.symbols_json !== "string") {
        throw new SymbolIndexStorageError("corrupt_storage", "SQLite cache row shape is invalid.");
      }
      totalPayloadBytes += Buffer.byteLength(row.symbols_json, "utf8");
      if (totalPayloadBytes > MAX_SYMBOL_INDEX_TOTAL_PAYLOAD_BYTES) {
        throw new SymbolIndexStorageError(
          "corrupt_storage",
          "SQLite cache payload budget was exceeded.",
        );
      }
      const entry = toEntry(
        row,
        MAX_SYMBOL_INDEX_SCANNED_SYMBOLS - decodedSymbols,
        () =>
          new SymbolIndexStorageError(
            "corrupt_storage",
            "SQLite cache decoded-symbol budget was exceeded.",
          ),
      );
      decodedSymbols += entry.symbols.length;
      if (decodedSymbols > MAX_SYMBOL_INDEX_SCANNED_SYMBOLS) {
        throw new SymbolIndexStorageError(
          "corrupt_storage",
          "SQLite cache decoded-symbol budget was exceeded.",
        );
      }
      entries.push(entry);
    }
    return entries;
  }

  private writeEntry(entry: SymbolIndexFileEntry): void {
    const payloadBytes = symbolProjectionJsonByteLength(entry.symbols);
    if (payloadBytes > MAX_SYMBOL_INDEX_ROW_PAYLOAD_BYTES) {
      throw new SymbolIndexStorageError(
        "write_failed",
        "SQLite cache row payload limit was exceeded.",
      );
    }
    const symbolsJson = JSON.stringify(entry.symbols);
    if (Buffer.byteLength(symbolsJson, "utf8") !== payloadBytes) {
      throw new SymbolIndexStorageError(
        "write_failed",
        "SQLite cache row payload accounting was inconsistent.",
      );
    }
    this.requireDatabase()
      .prepare(
        `INSERT INTO symbol_index
          (project_id, config_id, file_path, content_hash, config_digest, symbols_json, symbols_digest, last_indexed_at, schema_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, config_id, file_path) DO UPDATE SET
           content_hash = excluded.content_hash,
           config_digest = excluded.config_digest,
           symbols_json = excluded.symbols_json,
           symbols_digest = excluded.symbols_digest,
           last_indexed_at = excluded.last_indexed_at,
           schema_version = excluded.schema_version`,
      )
      .run(
        entry.project.project_id,
        configKey(entry.project.config_id),
        entry.file_path,
        entry.content_hash,
        entry.config_digest,
        symbolsJson,
        projectionDigest(symbolsJson),
        entry.last_indexed_at,
        entry.index_schema_version,
      );
  }

  private transaction(operation: () => void, failure: SymbolIndexStorageFailureCode): void {
    const db = this.requireDatabase();
    try {
      db.exec("BEGIN IMMEDIATE");
      operation();
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original database failure.
      }
      throw wrapStorageError(error, failure, "SQLite cache transaction failed.");
    }
  }

  async load(
    project: ProjectIdentity,
    schemaVersion: typeof SYMBOL_INDEX_SCHEMA_VERSION,
  ): Promise<readonly SymbolIndexFileEntry[]> {
    if (schemaVersion !== SYMBOL_INDEX_SCHEMA_VERSION) return [];
    try {
      return this.readRows(project, schemaVersion).filter((entry) =>
        projectMatches(entry.project, project),
      );
    } catch (error) {
      throw wrapStorageError(error, "read_failed", "SQLite cache load failed.");
    }
  }

  async upsert(entry: SymbolIndexFileEntry): Promise<void> {
    if (entry.index_schema_version !== SYMBOL_INDEX_SCHEMA_VERSION) {
      throw new Error("Unsupported symbol index schema version.");
    }
    let normalized: SymbolIndexFileEntry;
    try {
      normalized = createSymbolIndexFileEntry(entry);
    } catch (error) {
      throw wrapStorageError(error, "write_failed", "SQLite cache entry validation failed.");
    }
    const finalEntries = new Map(
      (await this.load(normalized.project, SYMBOL_INDEX_SCHEMA_VERSION)).map((current) => [
        current.file_path,
        current,
      ]),
    );
    finalEntries.set(normalized.file_path, normalized);
    assertEntrySetWithinBudget([...finalEntries.values()], "write_failed");
    this.transaction(() => this.writeEntry(normalized), "write_failed");
  }

  async remove(project: ProjectIdentity, filePath: string): Promise<void> {
    this.transaction(
      () =>
        this.requireDatabase()
          .prepare(
            "DELETE FROM symbol_index WHERE project_id = ? AND config_id = ? AND file_path = ?",
          )
          .run(project.project_id, configKey(project.config_id), filePath),
      "write_failed",
    );
  }

  async countSymbols(query: SymbolIndexCountQuery): Promise<number> {
    try {
      const normalizedQuery = query.query.toLowerCase();
      const normalizedFileFilter = query.filters?.file_path?.toLowerCase();
      const sqliteFileFilter =
        normalizedFileFilter && /^[\x20-\x7e]*$/.test(normalizedFileFilter)
          ? normalizedFileFilter
          : undefined;
      const kindSet = query.filters?.kinds ? new Set(query.filters.kinds) : undefined;
      const queryArguments: Array<string | number> = [
        query.project.project_id,
        configKey(query.project.config_id),
        SYMBOL_INDEX_SCHEMA_VERSION,
      ];
      if (sqliteFileFilter) queryArguments.push(sqliteFileFilter);
      const rows = this.readSqlitePages(
        `SELECT project_id, config_id, file_path, content_hash, config_digest, symbols_json,
              symbols_digest, last_indexed_at, schema_version
       FROM symbol_index
       WHERE project_id = ? AND config_id = ? AND schema_version = ?
         ${sqliteFileFilter ? "AND (instr(lower(file_path), ?) > 0 OR file_path GLOB '*[^ -~]*')" : ""}
       ORDER BY file_path`,
        queryArguments,
      );
      let scannedRows = 0;
      let scannedPayloadBytes = 0;
      let scannedSymbols = 0;
      let count = 0;
      for (const row of rows) {
        scannedRows += 1;
        if (scannedRows > MAX_SYMBOL_INDEX_FILE_ENTRIES) {
          throw new SymbolIndexScanLimitError();
        }
        if (typeof row.symbols_json !== "string") {
          throw new SymbolIndexStorageError(
            "corrupt_storage",
            "SQLite cache row shape is invalid.",
          );
        }
        scannedPayloadBytes += Buffer.byteLength(row.symbols_json, "utf8");
        if (scannedPayloadBytes > MAX_SYMBOL_INDEX_TOTAL_PAYLOAD_BYTES) {
          throw new SymbolIndexScanLimitError();
        }
        const entry = toEntry(
          row,
          MAX_SYMBOL_INDEX_SCANNED_SYMBOLS - scannedSymbols,
          () => new SymbolIndexScanLimitError(),
        );
        if (normalizedFileFilter && !entry.file_path.toLowerCase().includes(normalizedFileFilter)) {
          continue;
        }
        for (const symbol of entry.symbols) {
          scannedSymbols += 1;
          if (scannedSymbols > MAX_SYMBOL_INDEX_SCANNED_SYMBOLS) {
            throw new SymbolIndexScanLimitError();
          }
          if (kindSet && !kindSet.has(symbol.kind)) continue;
          if (
            symbol.name.toLowerCase().includes(normalizedQuery) ||
            symbol.symbol_path.toLowerCase().includes(normalizedQuery) ||
            symbol.selector.toLowerCase().includes(normalizedQuery)
          ) {
            count += 1;
          }
        }
      }
      return count;
    } catch (error) {
      if (error instanceof SymbolIndexScanLimitError) throw error;
      throw wrapStorageError(error, "read_failed", "SQLite cache count failed.");
    }
  }

  async querySymbols(query: SymbolIndexQuery): Promise<readonly SymbolIndexSymbolMatch[]> {
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > MAX_SYMBOL_INDEX_QUERY_CANDIDATES
    ) {
      throw new Error(
        `Symbol index query limit must be between 1 and ${MAX_SYMBOL_INDEX_QUERY_CANDIDATES}.`,
      );
    }
    const offset = symbolIndexQueryOffset(query);
    try {
      const normalizedQuery = query.query.toLowerCase();
      const normalizedFileFilter = query.filters?.file_path?.toLowerCase();
      const sqliteFileFilter =
        normalizedFileFilter && /^[\x20-\x7e]*$/.test(normalizedFileFilter)
          ? normalizedFileFilter
          : undefined;
      const kindSet = query.filters?.kinds ? new Set(query.filters.kinds) : undefined;
      const queryArguments: Array<string | number> = [
        query.project.project_id,
        configKey(query.project.config_id),
        SYMBOL_INDEX_SCHEMA_VERSION,
      ];
      if (sqliteFileFilter) queryArguments.push(sqliteFileFilter);
      const scanMatches = (visit: (match: SymbolIndexSymbolMatch) => void): void => {
        const rows = this.readSqlitePages(
          `SELECT project_id, config_id, file_path, content_hash, config_digest, symbols_json,
                symbols_digest, last_indexed_at, schema_version
         FROM symbol_index
         WHERE project_id = ? AND config_id = ? AND schema_version = ?
           ${sqliteFileFilter ? "AND (instr(lower(file_path), ?) > 0 OR file_path GLOB '*[^ -~]*')" : ""}
         ORDER BY file_path`,
          queryArguments,
        );
        let scannedRows = 0;
        let scannedPayloadBytes = 0;
        let scannedSymbols = 0;
        for (const row of rows) {
          scannedRows += 1;
          if (scannedRows > MAX_SYMBOL_INDEX_FILE_ENTRIES) {
            throw new SymbolIndexScanLimitError();
          }
          if (typeof row.symbols_json !== "string") {
            throw new SymbolIndexStorageError(
              "corrupt_storage",
              "SQLite cache row shape is invalid.",
            );
          }
          scannedPayloadBytes += Buffer.byteLength(row.symbols_json, "utf8");
          if (scannedPayloadBytes > MAX_SYMBOL_INDEX_TOTAL_PAYLOAD_BYTES) {
            throw new SymbolIndexScanLimitError();
          }
          const entry = toEntry(
            row,
            MAX_SYMBOL_INDEX_SCANNED_SYMBOLS - scannedSymbols,
            () => new SymbolIndexScanLimitError(),
          );
          if (
            normalizedFileFilter &&
            !entry.file_path.toLowerCase().includes(normalizedFileFilter)
          ) {
            continue;
          }
          for (const [symbolPosition, symbol] of entry.symbols.entries()) {
            scannedSymbols += 1;
            if (scannedSymbols > MAX_SYMBOL_INDEX_SCANNED_SYMBOLS) {
              throw new SymbolIndexScanLimitError();
            }
            if (kindSet && !kindSet.has(symbol.kind)) continue;
            if (
              !symbol.name.toLowerCase().includes(normalizedQuery) &&
              !symbol.symbol_path.toLowerCase().includes(normalizedQuery) &&
              !symbol.selector.toLowerCase().includes(normalizedQuery)
            ) {
              continue;
            }
            visit({
              ...createSymbolIndexSymbol(symbol),
              project: {
                project_id: entry.project.project_id,
                config_id: entry.project.config_id,
              },
              file_path: entry.file_path,
              content_hash: entry.content_hash,
              config_digest: entry.config_digest,
              index_schema_version: entry.index_schema_version,
              symbol_position: symbolPosition,
            });
          }
        }
      };

      const rankCounts = [0, 0, 0, 0, 0];
      scanMatches((match) => {
        rankCounts[symbolIndexMatchRank(query.query, match)] += 1;
      });
      const window = symbolIndexRankWindow(rankCounts, offset, query.limit);
      const seenByRank = [0, 0, 0, 0, 0];
      const selectedByRank: SymbolIndexSymbolMatch[][] = [[], [], [], [], []];
      scanMatches((match) => {
        const rank = symbolIndexMatchRank(query.query, match);
        const position = seenByRank[rank];
        seenByRank[rank] += 1;
        if (position < window.skips[rank] || selectedByRank[rank].length >= window.takes[rank]) {
          return;
        }
        selectedByRank[rank].push(match);
      });
      return selectedByRank.flat();
    } catch (error) {
      if (error instanceof SymbolIndexScanLimitError) throw error;
      throw wrapStorageError(error, "read_failed", "SQLite cache query failed.");
    }
  }

  async queryAllSymbols(query: SymbolIndexCountQuery): Promise<readonly SymbolIndexSymbolMatch[]> {
    return this.querySymbols({ ...query, limit: MAX_SYMBOL_INDEX_QUERY_CANDIDATES });
  }

  async clear(project: ProjectIdentity): Promise<void> {
    this.transaction(
      () =>
        this.requireDatabase()
          .prepare("DELETE FROM symbol_index WHERE project_id = ? AND config_id = ?")
          .run(project.project_id, configKey(project.config_id)),
      "write_failed",
    );
  }

  async flush(): Promise<void> {
    try {
      const checkpoint = this.requireDatabase().prepare("PRAGMA wal_checkpoint(FULL)").get() as
        { busy?: unknown } | undefined;
      if (checkpoint?.busy !== 0) {
        throw new SymbolIndexStorageError("contention", "SQLite cache flush was blocked.");
      }
    } catch (error) {
      throw wrapStorageError(error, "write_failed", "SQLite cache flush failed.");
    }
  }

  async refresh(input: SymbolIndexRefreshInput): Promise<SymbolIndexRefreshResult> {
    const existing = await this.load(input.project, SYMBOL_INDEX_SCHEMA_VERSION);
    const plan = createSymbolIndexRefreshPlan(input, existing);
    const finalEntries = new Map(existing.map((entry) => [entry.file_path, entry]));
    for (const filePath of plan.removed_files) finalEntries.delete(filePath);
    for (const entry of plan.entries_to_rebuild) finalEntries.set(entry.file_path, entry);
    assertEntrySetWithinBudget([...finalEntries.values()], "write_failed");
    this.transaction(() => {
      for (const entry of plan.entries_to_rebuild) this.writeEntry(entry);
      for (const filePath of plan.removed_files) {
        this.requireDatabase()
          .prepare(
            "DELETE FROM symbol_index WHERE project_id = ? AND config_id = ? AND file_path = ?",
          )
          .run(input.project.project_id, configKey(input.project.config_id), filePath);
      }
    }, "write_failed");
    return {
      rebuilt_files: plan.rebuilt_files,
      reused_files: plan.reused_files,
      removed_files: plan.removed_files,
    };
  }

  async quarantine(): Promise<void> {
    const db = this.db;
    this.close();
    if (!db) return;
    await quarantineSQLiteSymbolIndexFile(this.filePath);
  }

  close(): void {
    if (!this.db) return;
    try {
      this.db.close();
    } finally {
      this.db = null;
    }
  }
}
