import { createSourceLocation, type SourceRange } from "./read-contracts.js";
import type { ProjectIdentity } from "./project-status.js";
import {
  MAX_SYMBOL_INDEX_FILE_ENTRIES,
  MAX_SYMBOL_INDEX_QUERY_CANDIDATES,
  MAX_SYMBOL_INDEX_ROW_PAYLOAD_BYTES,
  MAX_SYMBOL_INDEX_SCANNED_SYMBOLS,
} from "./symbol-index-limits.js";
import { symbolMatchRank } from "./symbols.js";

export const SYMBOL_INDEX_SCHEMA_VERSION = 2 as const;
export {
  MAX_SYMBOL_INDEX_FILE_ENTRIES,
  MAX_SYMBOL_INDEX_QUERY_CANDIDATES,
  MAX_SYMBOL_INDEX_ROW_PAYLOAD_BYTES,
  MAX_SYMBOL_INDEX_SCANNED_SYMBOLS,
  MAX_SYMBOL_INDEX_TOTAL_PAYLOAD_BYTES,
} from "./symbol-index-limits.js";
export type SymbolIndexSchemaVersion = typeof SYMBOL_INDEX_SCHEMA_VERSION;

export class SymbolIndexScanLimitError extends Error {
  readonly code = "scan_limit_exceeded";

  constructor() {
    super("Symbol index scan limit exceeded.");
    this.name = "SymbolIndexScanLimitError";
  }
}

const SHA256_DIGEST = /^[a-f0-9]{64}$/;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface SymbolIndexSymbol {
  readonly name: string;
  readonly symbol_path: string;
  readonly selector: string;
  readonly kind: string;
  readonly signature: string;
  readonly line: number;
  readonly range: SourceRange;
}

export type CreateSymbolIndexSymbolInput = SymbolIndexSymbol;

export interface SymbolIndexFileEntry {
  readonly index_schema_version: SymbolIndexSchemaVersion;
  readonly project: ProjectIdentity;
  readonly file_path: string;
  readonly content_hash: string;
  readonly config_digest: string;
  readonly symbols: readonly SymbolIndexSymbol[];
  readonly last_indexed_at: string;
}

export interface CreateSymbolIndexFileEntryInput {
  readonly project: ProjectIdentity;
  readonly file_path: string;
  readonly content_hash: string;
  readonly config_digest: string;
  readonly symbols: readonly CreateSymbolIndexSymbolInput[];
  readonly last_indexed_at: string;
}

export interface SymbolIndexQueryFilters {
  readonly file_path?: string;
  readonly kinds?: readonly string[];
}

export interface SymbolIndexQuery {
  readonly project: ProjectIdentity;
  readonly query: string;
  readonly filters?: SymbolIndexQueryFilters;
  readonly limit: number;
}

export interface SymbolIndexRefreshFile {
  readonly file_path: string;
  readonly content_hash: string;
  readonly symbols: readonly CreateSymbolIndexSymbolInput[];
}

export interface SymbolIndexCurrentFile {
  readonly file_path: string;
  readonly content_hash: string;
}

export interface SymbolIndexRefreshInput {
  readonly project: ProjectIdentity;
  readonly config_digest: string;
  readonly current_files: readonly SymbolIndexCurrentFile[];
  /** Symbol projections are required only for files that must be rebuilt. */
  readonly files: readonly SymbolIndexRefreshFile[];
  readonly last_indexed_at: string;
}

export interface SymbolIndexRefreshResult {
  readonly rebuilt_files: readonly string[];
  readonly reused_files: readonly string[];
  readonly removed_files: readonly string[];
}

export interface SymbolIndexSymbolMatch extends SymbolIndexSymbol {
  readonly project: ProjectIdentity;
  readonly file_path: string;
  readonly content_hash: string;
  readonly config_digest: string;
  readonly index_schema_version: SymbolIndexSchemaVersion;
}

export interface SymbolIndexStore {
  load(
    project: ProjectIdentity,
    schemaVersion: SymbolIndexSchemaVersion,
  ): Promise<readonly SymbolIndexFileEntry[]>;
  upsert(entry: SymbolIndexFileEntry): Promise<void>;
  remove(project: ProjectIdentity, filePath: string): Promise<void>;
  querySymbols(query: SymbolIndexQuery): Promise<readonly SymbolIndexSymbolMatch[]>;
  queryAllSymbols(
    query: Omit<SymbolIndexQuery, "limit">,
  ): Promise<readonly SymbolIndexSymbolMatch[]>;
  clear(project: ProjectIdentity): Promise<void>;
  flush(): Promise<void>;
  refresh(input: SymbolIndexRefreshInput): Promise<SymbolIndexRefreshResult>;
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
}

function assertDigest(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_DIGEST.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest.`);
  }
}

function assertCanonicalTimestamp(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !CANONICAL_UTC_TIMESTAMP.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error("last_indexed_at must be a canonical UTC timestamp.");
  }
}

function assertProjectIdentity(value: unknown): asserts value is ProjectIdentity {
  if (typeof value !== "object" || value === null) {
    throw new Error("Symbol index project identity is invalid.");
  }
  const candidate = value as Partial<ProjectIdentity>;
  assertNonEmptyString(candidate.project_id, "project.project_id");
  if (candidate.config_id !== null) {
    assertNonEmptyString(candidate.config_id, "project.config_id");
  }
}

function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function projectKey(project: ProjectIdentity): string {
  return `${project.project_id}\u0000${project.config_id ?? ""}`;
}

function entryKey(project: ProjectIdentity, filePath: string): string {
  return `${projectKey(project)}\u0000${filePath}`;
}

function sameProject(left: ProjectIdentity, right: ProjectIdentity): boolean {
  return left.project_id === right.project_id && left.config_id === right.config_id;
}

function normalizedFilePath(filePath: string): string {
  return createSourceLocation(filePath, { start_line: 1 }).file;
}

export interface SymbolIndexRefreshPlan {
  readonly entries_to_rebuild: readonly SymbolIndexFileEntry[];
  readonly rebuilt_files: readonly string[];
  readonly reused_files: readonly string[];
  readonly removed_files: readonly string[];
}

export function createSymbolIndexRefreshPlan(
  input: SymbolIndexRefreshInput,
  existing: readonly SymbolIndexFileEntry[],
): SymbolIndexRefreshPlan {
  if (
    input.current_files.length > MAX_SYMBOL_INDEX_FILE_ENTRIES ||
    input.files.length > MAX_SYMBOL_INDEX_FILE_ENTRIES ||
    existing.length > MAX_SYMBOL_INDEX_FILE_ENTRIES
  ) {
    throw new Error("Symbol index refresh file-entry limit was exceeded.");
  }
  const currentFiles = input.current_files.map((file) => {
    const filePath = normalizedFilePath(file.file_path);
    assertDigest(file.content_hash, "current_file.content_hash");
    return { file_path: filePath, content_hash: file.content_hash };
  });
  const currentPaths = new Set(currentFiles.map((file) => file.file_path));
  if (currentPaths.size !== currentFiles.length) {
    throw new Error("Symbol index refresh contains duplicate current file paths.");
  }

  const candidates = input.files.map((file) =>
    createSymbolIndexFileEntry({
      project: input.project,
      file_path: file.file_path,
      content_hash: file.content_hash,
      config_digest: input.config_digest,
      symbols: file.symbols,
      last_indexed_at: input.last_indexed_at,
    }),
  );
  const candidateByPath = new Map(candidates.map((entry) => [entry.file_path, entry]));
  if (candidateByPath.size !== candidates.length) {
    throw new Error("Symbol index refresh contains duplicate rebuild file paths.");
  }
  for (const candidate of candidates) {
    if (!currentPaths.has(candidate.file_path)) {
      throw new Error(
        `Symbol index rebuild file is not in the current file set: ${candidate.file_path}`,
      );
    }
    const current = currentFiles.find((file) => file.file_path === candidate.file_path)!;
    if (current.content_hash !== candidate.content_hash) {
      throw new Error(`Symbol index rebuild hash mismatch: ${candidate.file_path}`);
    }
  }

  const existingByPath = new Map(existing.map((entry) => [entry.file_path, entry]));
  const entriesToRebuild: SymbolIndexFileEntry[] = [];
  const reusedFiles: string[] = [];
  for (const current of currentFiles) {
    const previous = existingByPath.get(current.file_path);
    const candidate = candidateByPath.get(current.file_path);
    const requiresRebuild =
      !previous ||
      previous.content_hash !== current.content_hash ||
      previous.config_digest !== input.config_digest;
    if (requiresRebuild && !candidate) {
      throw new Error(`Missing symbol projection for rebuild file: ${current.file_path}`);
    }
    if (candidate) entriesToRebuild.push(candidate);
    else reusedFiles.push(current.file_path);
  }

  const removedFiles = existing
    .filter((entry) => !currentPaths.has(entry.file_path))
    .map((entry) => entry.file_path)
    .sort();

  entriesToRebuild.sort((left, right) => left.file_path.localeCompare(right.file_path));
  return {
    entries_to_rebuild: entriesToRebuild,
    rebuilt_files: entriesToRebuild.map((entry) => entry.file_path),
    reused_files: reusedFiles.sort(),
    removed_files: removedFiles,
  };
}

function assertQueryLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SYMBOL_INDEX_QUERY_CANDIDATES) {
    throw new Error(
      `Symbol index query limit must be between 1 and ${MAX_SYMBOL_INDEX_QUERY_CANDIDATES}.`,
    );
  }
}

function copyRange(range: SourceRange): SourceRange {
  const validated = createSourceLocation("index.ts", range);
  return {
    start_line: validated.start_line,
    ...(validated.start_column === undefined ? {} : { start_column: validated.start_column }),
    ...(validated.end_line === undefined ? {} : { end_line: validated.end_line }),
    ...(validated.end_column === undefined ? {} : { end_column: validated.end_column }),
  };
}

export function createSymbolIndexSymbol(input: CreateSymbolIndexSymbolInput): SymbolIndexSymbol {
  if (typeof input !== "object" || input === null) {
    throw new Error("Symbol index symbol is invalid.");
  }
  assertNonEmptyString(input.name, "symbol.name");
  assertNonEmptyString(input.symbol_path, "symbol.symbol_path");
  assertNonEmptyString(input.selector, "symbol.selector");
  assertNonEmptyString(input.kind, "symbol.kind");
  assertNonEmptyString(input.signature, "symbol.signature");
  assertPositiveInteger(input.line, "symbol.line");
  const range = copyRange(input.range);
  if (range.start_line !== input.line) {
    throw new Error("symbol.line must match symbol.range.start_line.");
  }

  return {
    name: input.name,
    symbol_path: input.symbol_path,
    selector: input.selector,
    kind: input.kind,
    signature: input.signature,
    line: input.line,
    range,
  };
}

function jsonStringByteLength(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes +=
        code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function jsonIntegerByteLength(value: number): number {
  return String(value).length;
}

function rangeJsonByteLength(range: SourceRange): number {
  let bytes = 14 + jsonIntegerByteLength(range.start_line);
  if (range.start_column !== undefined) bytes += 16 + jsonIntegerByteLength(range.start_column);
  if (range.end_line !== undefined) bytes += 12 + jsonIntegerByteLength(range.end_line);
  if (range.end_column !== undefined) bytes += 14 + jsonIntegerByteLength(range.end_column);
  return bytes + 1;
}

export function symbolJsonByteLength(symbol: SymbolIndexSymbol): number {
  return (
    8 +
    jsonStringByteLength(symbol.name) +
    15 +
    jsonStringByteLength(symbol.symbol_path) +
    12 +
    jsonStringByteLength(symbol.selector) +
    8 +
    jsonStringByteLength(symbol.kind) +
    13 +
    jsonStringByteLength(symbol.signature) +
    8 +
    jsonIntegerByteLength(symbol.line) +
    9 +
    rangeJsonByteLength(symbol.range) +
    1
  );
}

export function symbolProjectionJsonByteLength(symbols: readonly SymbolIndexSymbol[]): number {
  let bytes = 2;
  for (let index = 0; index < symbols.length; index += 1) {
    bytes += (index === 0 ? 0 : 1) + symbolJsonByteLength(symbols[index]);
    if (bytes > MAX_SYMBOL_INDEX_ROW_PAYLOAD_BYTES) return bytes;
  }
  return bytes;
}

function createSymbolIndexMatch(
  entry: SymbolIndexFileEntry,
  symbol: SymbolIndexSymbol,
): SymbolIndexSymbolMatch {
  return {
    ...createSymbolIndexSymbol(symbol),
    project: {
      project_id: entry.project.project_id,
      config_id: entry.project.config_id,
    },
    file_path: entry.file_path,
    content_hash: entry.content_hash,
    config_digest: entry.config_digest,
    index_schema_version: entry.index_schema_version,
  };
}

export function createSymbolIndexFileEntry(
  input: CreateSymbolIndexFileEntryInput,
): SymbolIndexFileEntry {
  if (typeof input !== "object" || input === null) {
    throw new Error("Symbol index file entry is invalid.");
  }
  assertProjectIdentity(input.project);
  const filePath = createSourceLocation(input.file_path, { start_line: 1 }).file;
  assertDigest(input.content_hash, "content_hash");
  assertDigest(input.config_digest, "config_digest");
  assertCanonicalTimestamp(input.last_indexed_at);
  if (!Array.isArray(input.symbols)) {
    throw new Error("symbols must be an array.");
  }
  if (input.symbols.length > MAX_SYMBOL_INDEX_SCANNED_SYMBOLS) {
    throw new Error("Symbol index row symbol limit was exceeded.");
  }

  const symbols: SymbolIndexSymbol[] = [];
  let payloadBytes = 2;
  for (const inputSymbol of input.symbols) {
    const symbol = createSymbolIndexSymbol(inputSymbol);
    payloadBytes += (symbols.length === 0 ? 0 : 1) + symbolJsonByteLength(symbol);
    if (payloadBytes > MAX_SYMBOL_INDEX_ROW_PAYLOAD_BYTES) {
      throw new Error("Symbol index row payload limit was exceeded.");
    }
    symbols.push(symbol);
  }

  return {
    index_schema_version: SYMBOL_INDEX_SCHEMA_VERSION,
    project: {
      project_id: input.project.project_id,
      config_id: input.project.config_id,
    },
    file_path: filePath,
    content_hash: input.content_hash,
    config_digest: input.config_digest,
    symbols,
    last_indexed_at: input.last_indexed_at,
  };
}

export class InMemorySymbolIndex implements SymbolIndexStore {
  private readonly entries = new Map<string, SymbolIndexFileEntry>();

  private projectEntries(
    project: ProjectIdentity,
    schemaVersion: SymbolIndexSchemaVersion,
  ): SymbolIndexFileEntry[] {
    const selected: SymbolIndexFileEntry[] = [];
    for (const entry of this.entries.values()) {
      if (!sameProject(entry.project, project) || entry.index_schema_version !== schemaVersion) {
        continue;
      }
      if (selected.length >= MAX_SYMBOL_INDEX_FILE_ENTRIES) {
        throw new SymbolIndexScanLimitError();
      }
      selected.push(entry);
    }
    return selected;
  }

  async load(
    project: ProjectIdentity,
    schemaVersion: SymbolIndexSchemaVersion,
  ): Promise<readonly SymbolIndexFileEntry[]> {
    return this.projectEntries(project, schemaVersion)
      .sort((left, right) => left.file_path.localeCompare(right.file_path))
      .map((entry) => createSymbolIndexFileEntry(entry));
  }

  async upsert(entry: SymbolIndexFileEntry): Promise<void> {
    if (entry.index_schema_version !== SYMBOL_INDEX_SCHEMA_VERSION) {
      throw new Error("Unsupported symbol index schema version.");
    }
    const normalized = createSymbolIndexFileEntry({
      project: entry.project,
      file_path: entry.file_path,
      content_hash: entry.content_hash,
      config_digest: entry.config_digest,
      symbols: entry.symbols,
      last_indexed_at: entry.last_indexed_at,
    });
    const key = entryKey(normalized.project, normalized.file_path);
    if (
      !this.entries.has(key) &&
      this.projectEntries(normalized.project, SYMBOL_INDEX_SCHEMA_VERSION).length >=
        MAX_SYMBOL_INDEX_FILE_ENTRIES
    ) {
      throw new SymbolIndexScanLimitError();
    }
    this.entries.set(key, normalized);
  }

  async remove(project: ProjectIdentity, filePath: string): Promise<void> {
    this.entries.delete(entryKey(project, normalizedFilePath(filePath)));
  }

  async querySymbols(query: SymbolIndexQuery): Promise<readonly SymbolIndexSymbolMatch[]> {
    assertQueryLimit(query.limit);
    const normalizedQuery = query.query.toLowerCase();
    const normalizedFileFilter = query.filters?.file_path?.toLowerCase();
    const kindSet = query.filters?.kinds ? new Set(query.filters.kinds) : undefined;
    const matches: SymbolIndexSymbolMatch[] = [];

    let scannedEntries = 0;
    let scannedSymbols = 0;
    const entries = this.projectEntries(query.project, SYMBOL_INDEX_SCHEMA_VERSION).sort(
      (left, right) => left.file_path.localeCompare(right.file_path),
    );
    for (const entry of entries) {
      if (normalizedFileFilter && !entry.file_path.toLowerCase().includes(normalizedFileFilter)) {
        continue;
      }
      scannedEntries += 1;
      if (scannedEntries > MAX_SYMBOL_INDEX_FILE_ENTRIES) {
        throw new SymbolIndexScanLimitError();
      }
      for (const symbol of entry.symbols) {
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
        matches.push(createSymbolIndexMatch(entry, symbol));
      }
    }

    matches.sort((left, right) => {
      const rank =
        symbolMatchRank(query.query, {
          symbolPath: left.symbol_path,
          name: left.name,
          line: left.line,
        }) -
        symbolMatchRank(query.query, {
          symbolPath: right.symbol_path,
          name: right.name,
          line: right.line,
        });
      if (rank !== 0) return rank;
      return (
        left.file_path.localeCompare(right.file_path) ||
        left.line - right.line ||
        left.symbol_path.localeCompare(right.symbol_path) ||
        left.kind.localeCompare(right.kind)
      );
    });
    return matches.slice(0, query.limit);
  }

  async queryAllSymbols(
    query: Omit<SymbolIndexQuery, "limit">,
  ): Promise<readonly SymbolIndexSymbolMatch[]> {
    return this.querySymbols({ ...query, limit: MAX_SYMBOL_INDEX_QUERY_CANDIDATES });
  }

  async clear(project: ProjectIdentity): Promise<void> {
    for (const entry of await this.load(project, SYMBOL_INDEX_SCHEMA_VERSION)) {
      this.entries.delete(entryKey(project, entry.file_path));
    }
  }

  async flush(): Promise<void> {}

  async refresh(input: SymbolIndexRefreshInput): Promise<SymbolIndexRefreshResult> {
    const existing = await this.load(input.project, SYMBOL_INDEX_SCHEMA_VERSION);
    const plan = createSymbolIndexRefreshPlan(input, existing);
    for (const entry of plan.entries_to_rebuild) await this.upsert(entry);
    for (const filePath of plan.removed_files) await this.remove(input.project, filePath);

    return {
      rebuilt_files: plan.rebuilt_files,
      reused_files: plan.reused_files,
      removed_files: plan.removed_files,
    };
  }
}
