export const SNAPSHOT_STATES = Object.freeze([
  "fresh",
  "pending",
  "stale",
  "rebuilding",
  "degraded",
] as const);

export type SnapshotState = (typeof SNAPSHOT_STATES)[number];

export function isSnapshotState(value: unknown): value is SnapshotState {
  return SNAPSHOT_STATES.some((state) => state === value);
}

export const FRESHNESS_CAUSES = Object.freeze([
  "source_change",
  "config_change",
  "index_failure",
  "watcher_failure",
  "compiler_rebuild",
] as const);

export type FreshnessCause = (typeof FRESHNESS_CAUSES)[number];

export function isFreshnessCause(value: unknown): value is FreshnessCause {
  return FRESHNESS_CAUSES.some((cause) => cause === value);
}

export interface FreshnessMetadata {
  readonly state: SnapshotState;
  readonly causes: readonly FreshnessCause[];
  readonly checked_at: string | null;
}

export interface FileRange {
  readonly offset: number;
  readonly limit: number;
  readonly total_lines: number;
}

function assertIntegerAtLeast(value: number, minimum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
}

export function createFileRange(offset: number, limit: number, totalLines: number): FileRange {
  assertIntegerAtLeast(offset, 0, "File range offset");
  assertIntegerAtLeast(limit, 1, "File range limit");
  assertIntegerAtLeast(totalLines, 0, "File range total_lines");
  return { offset, limit, total_lines: totalLines };
}

export interface SourceRange {
  readonly start_line: number;
  readonly start_column?: number;
  readonly end_line?: number;
  readonly end_column?: number;
}

export interface SourceLocation extends SourceRange {
  readonly file: string;
}

function projectRelativePath(file: string): string {
  let unquoted = file.trim();
  const quote = unquoted[0];
  if (
    unquoted.length >= 2 &&
    (quote === '"' || quote === "'" || quote === "`") &&
    unquoted.endsWith(quote)
  ) {
    unquoted = unquoted.slice(1, -1).trim();
  }
  const normalized = unquoted.replaceAll("\\", "/");
  const relative = normalized.startsWith("./") ? normalized.slice(2) : normalized;
  const segments = relative.split("/");
  const isWindowsAbsolute = /^[A-Za-z]:/.test(relative);

  if (
    relative.length === 0 ||
    relative.startsWith("/") ||
    isWindowsAbsolute ||
    segments.some((segment) => segment.length === 0 || segment === ".." || segment === ".")
  ) {
    throw new Error("Source location file must be project-relative.");
  }
  return relative;
}

export function createSourceLocation(file: string, range: SourceRange): SourceLocation {
  if (typeof file !== "string" || typeof range !== "object" || range === null) {
    throw new Error("Source location input is invalid.");
  }
  assertIntegerAtLeast(range.start_line, 1, "Source location start_line");
  if (range.start_column !== undefined) {
    assertIntegerAtLeast(range.start_column, 1, "Source location start_column");
  }
  if (range.end_line !== undefined) {
    assertIntegerAtLeast(range.end_line, range.start_line, "Source location end_line");
  }
  if (range.end_column !== undefined) {
    assertIntegerAtLeast(range.end_column, 1, "Source location end_column");
  }
  if (
    range.end_line === range.start_line &&
    range.start_column !== undefined &&
    range.end_column !== undefined &&
    range.end_column < range.start_column
  ) {
    throw new Error("Source location end_column must not precede start_column.");
  }

  return {
    file: projectRelativePath(file),
    start_line: range.start_line,
    ...(range.start_column === undefined ? {} : { start_column: range.start_column }),
    ...(range.end_line === undefined ? {} : { end_line: range.end_line }),
    ...(range.end_column === undefined ? {} : { end_column: range.end_column }),
  };
}

export const TRUNCATION_REASONS = Object.freeze([
  "record_limit",
  "byte_limit",
  "depth_limit",
  "edge_limit",
  "invocation_limit",
  "serialization_limit",
] as const);

export type TruncationReason = (typeof TRUNCATION_REASONS)[number];

export function isTruncationReason(value: unknown): value is TruncationReason {
  return TRUNCATION_REASONS.some((reason) => reason === value);
}

export interface TruncationMetadata {
  readonly truncated: boolean;
  readonly reason: TruncationReason | null;
}

export function createTruncationMetadata(
  truncated: boolean,
  reason: TruncationReason | null = null,
): TruncationMetadata {
  if (reason !== null && !isTruncationReason(reason)) {
    throw new Error(`Unknown truncation reason: ${String(reason)}.`);
  }
  if (truncated !== (reason !== null)) {
    throw new Error(
      "A truncated result requires a machine-readable reason, and a complete result does not.",
    );
  }
  return { truncated, reason };
}

export interface BudgetMetadata {
  readonly max_records: number | null;
  readonly max_bytes: number | null;
  readonly max_depth: number | null;
  readonly max_edges: number | null;
  readonly max_invocations: number | null;
}

export interface ReadMetadata {
  readonly freshness: FreshnessMetadata;
  readonly budget: BudgetMetadata;
  readonly truncation: TruncationMetadata;
}

export type JsonPrimitive = string | number | boolean | null;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonArray = readonly JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface ReadResult<T extends JsonValue> {
  readonly data: T;
  readonly metadata: ReadMetadata;
}

export function isJsonValue(value: unknown): value is JsonValue {
  const ancestors = new Set<object>();

  function visit(candidate: unknown): candidate is JsonValue {
    if (candidate === null) return true;
    if (typeof candidate === "string" || typeof candidate === "boolean") return true;
    if (typeof candidate === "number") {
      return Number.isFinite(candidate) && !Object.is(candidate, -0);
    }
    if (typeof candidate !== "object") return false;
    if (ancestors.has(candidate)) return false;

    ancestors.add(candidate);
    try {
      if ("toJSON" in candidate) return false;
      if (Array.isArray(candidate)) {
        if (Object.getPrototypeOf(candidate) !== Array.prototype) return false;
        if (Object.getOwnPropertySymbols(candidate).length > 0) return false;
        for (let index = 0; index < candidate.length; index += 1) {
          if (!Object.hasOwn(candidate, index)) return false;
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !visit(descriptor.value)) {
            return false;
          }
        }
        return Object.getOwnPropertyNames(candidate).every((key) => {
          if (key === "length") return true;
          const index = Number(key);
          return (
            Number.isInteger(index) &&
            index >= 0 &&
            index < candidate.length &&
            String(index) === key
          );
        });
      }
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) return false;
      if (Object.getOwnPropertySymbols(candidate).length > 0) return false;
      return Object.getOwnPropertyNames(candidate).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        return (
          descriptor !== undefined &&
          descriptor.enumerable &&
          "value" in descriptor &&
          visit(descriptor.value)
        );
      });
    } finally {
      ancestors.delete(candidate);
    }
  }

  return visit(value);
}
