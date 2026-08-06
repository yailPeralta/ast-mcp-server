import { createSourceLocation, type SourceRange } from "./read-contracts.js";
import type { ProjectIdentity } from "./project-status.js";

export const SYMBOL_INDEX_SCHEMA_VERSION = 1 as const;
export type SymbolIndexSchemaVersion = typeof SYMBOL_INDEX_SCHEMA_VERSION;

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
  clear(project: ProjectIdentity): Promise<void>;
  flush(): Promise<void>;
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

  return {
    index_schema_version: SYMBOL_INDEX_SCHEMA_VERSION,
    project: {
      project_id: input.project.project_id,
      config_id: input.project.config_id,
    },
    file_path: filePath,
    content_hash: input.content_hash,
    config_digest: input.config_digest,
    symbols: input.symbols.map(createSymbolIndexSymbol),
    last_indexed_at: input.last_indexed_at,
  };
}
