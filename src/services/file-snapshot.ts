import { TextDecoder } from "node:util";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { Project } from "ts-morph";
import { getSourceFileOrThrow } from "./project.js";
import { NO_REQUEST_CONTEXT, type RequestContext } from "./request-context.js";
import { hashBytes } from "./workspace.js";

export const DEFAULT_FILE_LINE_LIMIT = 200;
export const MAX_FILE_LINE_LIMIT = 500;

export interface FileSnapshotOptions {
  readonly offset: number;
  readonly limit: number;
}

export interface FileSnapshotLine {
  readonly line: number;
  readonly text: string;
}

export interface FileSnapshot {
  readonly file: string;
  readonly range: {
    readonly offset: number;
    readonly limit: number;
    readonly total_lines: number;
  };
  readonly lines: readonly FileSnapshotLine[];
  readonly file_hash: string;
  readonly snapshot_state: "fresh" | "stale";
}

function assertBoundedRange({ offset, limit }: FileSnapshotOptions): void {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("File offset must be a non-negative integer.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FILE_LINE_LIMIT) {
    throw new Error(`File limit must be an integer between 1 and ${MAX_FILE_LINE_LIMIT}.`);
  }
}

function rejectTraversalPath(filePath: string): void {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const isWindowsAbsolute = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//");
  if (segments.includes("..")) {
    throw new Error("File path traversal is not allowed.");
  }
  if (isWindowsAbsolute && !path.isAbsolute(filePath)) {
    throw new Error("Windows absolute paths are not valid on this host.");
  }
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function projectRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function decodeUtf8(bytes: Buffer, filePath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`Source file "${filePath}" is not valid UTF-8.`);
  }
}

function splitLines(source: string): string[] {
  if (source.length === 0) return [];
  const lines = source.split(/\r\n|\n|\r/);
  if (source.endsWith("\n") || source.endsWith("\r")) lines.pop();
  return lines;
}

function compilerSnapshotHashes(sourceText: string): string[] {
  const sourceBytes = Buffer.from(sourceText, "utf8");
  const hashes = [hashBytes(sourceBytes)];
  if (sourceText.charCodeAt(0) !== 0xfeff) {
    hashes.push(hashBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), sourceBytes])));
  }
  return hashes;
}

export async function readFileSnapshot(
  project: Project,
  projectRoot: string,
  filePath: string,
  options: FileSnapshotOptions,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<FileSnapshot> {
  requestContext.checkpoint();
  assertBoundedRange(options);
  rejectTraversalPath(filePath);

  const sourceFile = getSourceFileOrThrow(project, filePath);
  requestContext.checkpoint();
  const canonicalRoot = await realpath(projectRoot);
  const sourcePath = sourceFile.getFilePath();
  const canonicalFile = await realpath(sourcePath);
  requestContext.checkpoint();

  if (!isContained(canonicalRoot, canonicalFile)) {
    throw new Error("Source file resolves outside the configured project root.");
  }

  const stat = await lstat(canonicalFile);
  requestContext.checkpoint();
  if (!stat.isFile()) {
    throw new Error("Source file is not a regular file.");
  }

  const bytes = await readFile(canonicalFile);
  requestContext.checkpoint();
  const source = decodeUtf8(bytes, projectRelative(canonicalRoot, canonicalFile));
  const fileHash = hashBytes(bytes);
  const compilerHashes = compilerSnapshotHashes(sourceFile.getFullText());
  const snapshotState = compilerHashes.includes(fileHash) ? "fresh" : "stale";
  const allLines = splitLines(source);
  const selectedLines = allLines.slice(options.offset, options.offset + options.limit);

  requestContext.checkpoint();
  return {
    file: projectRelative(canonicalRoot, canonicalFile),
    range: {
      offset: options.offset,
      limit: options.limit,
      total_lines: allLines.length,
    },
    lines: selectedLines.map((text, index) => ({
      line: options.offset + index + 1,
      text,
    })),
    file_hash: fileHash,
    snapshot_state: snapshotState,
  };
}
