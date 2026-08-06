import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface FileFingerprint {
  readonly file_path: string;
  readonly size_bytes: number;
  readonly mtime_ns: string;
  readonly device: string;
  readonly inode: string;
  readonly content_hash: string;
}

export interface CollectFileFingerprintsOptions {
  readonly verifyContentHash?: boolean;
}

export interface FileFingerprintCollection {
  readonly files: ReadonlyMap<string, FileFingerprint>;
  readonly missing: readonly string[];
}

export interface FileFingerprintChanges {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly deleted: readonly string[];
  readonly unchanged: readonly string[];
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function resolveCandidatePath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return path.resolve(filePath);
  }
}

function assertRegularFile(filePath: string): fs.BigIntStats {
  const stats = fs.statSync(filePath, { bigint: true });
  if (!stats.isFile()) {
    throw new Error(`Cannot fingerprint non-file path: ${filePath}`);
  }
  return stats;
}

function metadataMatches(
  previous: FileFingerprint,
  current: Pick<FileFingerprint, "size_bytes" | "mtime_ns" | "device" | "inode">,
): boolean {
  return (
    previous.size_bytes === current.size_bytes &&
    previous.mtime_ns === current.mtime_ns &&
    previous.device === current.device &&
    previous.inode === current.inode
  );
}

export function hashBytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function captureFileFingerprint(
  filePath: string,
  previous?: FileFingerprint,
  options: CollectFileFingerprintsOptions = {},
): FileFingerprint {
  const canonicalPath = fs.realpathSync(filePath);
  const stats = assertRegularFile(canonicalPath);
  const metadata = {
    size_bytes: Number(stats.size),
    mtime_ns: stats.mtimeNs.toString(),
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
  };
  if (!Number.isSafeInteger(metadata.size_bytes)) {
    throw new Error(`File size is outside the safe integer range: ${canonicalPath}`);
  }

  if (previous && metadataMatches(previous, metadata) && !options.verifyContentHash) {
    return {
      ...previous,
      file_path: canonicalPath,
    };
  }

  return {
    file_path: canonicalPath,
    ...metadata,
    content_hash: hashBytes(fs.readFileSync(canonicalPath)),
  };
}

export function collectFileFingerprints(
  filePaths: readonly string[],
  previous: ReadonlyMap<string, FileFingerprint> = new Map(),
  options: CollectFileFingerprintsOptions = {},
): FileFingerprintCollection {
  const files = new Map<string, FileFingerprint>();
  const missing = new Set<string>();

  for (const filePath of new Set(filePaths)) {
    const candidatePath = resolveCandidatePath(filePath);
    try {
      const previousFingerprint = previous.get(candidatePath);
      const fingerprint = captureFileFingerprint(candidatePath, previousFingerprint, options);
      files.set(fingerprint.file_path, fingerprint);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      missing.add(candidatePath);
    }
  }

  return {
    files,
    missing: [...missing].sort(),
  };
}

export function compareFileFingerprints(
  previous: ReadonlyMap<string, FileFingerprint>,
  current: ReadonlyMap<string, FileFingerprint>,
): FileFingerprintChanges {
  const added: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];
  const paths = [...new Set([...previous.keys(), ...current.keys()])].sort();

  for (const filePath of paths) {
    const before = previous.get(filePath);
    const after = current.get(filePath);
    if (!before && after) {
      added.push(filePath);
    } else if (before && !after) {
      deleted.push(filePath);
    } else if (before && after && before.content_hash !== after.content_hash) {
      changed.push(filePath);
    } else {
      unchanged.push(filePath);
    }
  }

  return { added, changed, deleted, unchanged };
}
