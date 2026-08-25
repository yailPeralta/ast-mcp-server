import path from "node:path";
import { DiagnosticCategory, type Diagnostic, ts } from "ts-morph";
import { NO_REQUEST_CONTEXT, type RequestContext } from "./request-context.js";

export interface NormalizedDiagnostic {
  code: number;
  category: string;
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
}

export const DIAGNOSTIC_AGGREGATE_GROUP_LIMIT = 20 as const;

export interface DiagnosticAggregateMetadata {
  total_group_count: number;
  omitted_group_count: number;
  covered_diagnostic_count: number;
  omitted_diagnostic_count: number;
  truncated: boolean;
}

export interface DiagnosticCodeGroup {
  code: number;
  count: number;
}

export interface DiagnosticFileGroup {
  file: string;
  count: number;
}

export interface DiagnosticCodeAggregates extends DiagnosticAggregateMetadata {
  groups: DiagnosticCodeGroup[];
}

export interface DiagnosticFileAggregates extends DiagnosticAggregateMetadata {
  groups: DiagnosticFileGroup[];
  unfiled_diagnostic_count: number;
}

export interface DiagnosticAggregates {
  group_limit: typeof DIAGNOSTIC_AGGREGATE_GROUP_LIMIT;
  codes: DiagnosticCodeAggregates;
  files: DiagnosticFileAggregates;
}

function safeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Diagnostic aggregate count is outside the safe integer range.");
  }
  return value;
}

function increment<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, safeCount((counts.get(key) ?? 0) + 1));
}

function rankGroups<K, T extends { count: number }>(
  counts: ReadonlyMap<K, number>,
  createGroup: (key: K, count: number) => T,
  compareKey: (left: T, right: T) => number,
  groupedDiagnosticCount: number,
  requestContext: RequestContext,
): DiagnosticAggregateMetadata & { groups: T[] } {
  const groups: T[] = [];
  for (const [key, count] of counts) {
    requestContext.checkpoint();
    groups.push(createGroup(key, safeCount(count)));
  }
  groups.sort((left, right) => {
    requestContext.checkpoint();
    return right.count - left.count || compareKey(left, right);
  });

  const selected = groups.slice(0, DIAGNOSTIC_AGGREGATE_GROUP_LIMIT);
  const covered = safeCount(selected.reduce((total, group) => safeCount(total + group.count), 0));
  const omittedGroups = safeCount(groups.length - selected.length);
  return {
    groups: selected,
    total_group_count: safeCount(groups.length),
    omitted_group_count: omittedGroups,
    covered_diagnostic_count: covered,
    omitted_diagnostic_count: safeCount(groupedDiagnosticCount - covered),
    truncated: omittedGroups > 0,
  };
}

export function buildDiagnosticAggregates(
  diagnostics: readonly NormalizedDiagnostic[],
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): DiagnosticAggregates {
  requestContext.checkpoint();
  const codeCounts = new Map<number, number>();
  const fileCounts = new Map<string, number>();
  let unfiled = 0;
  for (const diagnostic of diagnostics) {
    requestContext.checkpoint();
    increment(codeCounts, diagnostic.code);
    if (diagnostic.file === null) {
      unfiled = safeCount(unfiled + 1);
    } else {
      increment(fileCounts, diagnostic.file);
    }
  }

  const codes = rankGroups<number, DiagnosticCodeGroup>(
    codeCounts,
    (code, count) => ({ code, count }),
    (left, right) => left.code - right.code,
    safeCount(diagnostics.length),
    requestContext,
  );
  const files = rankGroups<string, DiagnosticFileGroup>(
    fileCounts,
    (file, count) => ({ file, count }),
    (left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0),
    safeCount(diagnostics.length - unfiled),
    requestContext,
  );
  return {
    group_limit: DIAGNOSTIC_AGGREGATE_GROUP_LIMIT,
    codes,
    files: { ...files, unfiled_diagnostic_count: unfiled },
  };
}

export interface DiagnosticDelta {
  added: NormalizedDiagnostic[];
  removed: NormalizedDiagnostic[];
  addedErrors: NormalizedDiagnostic[];
}

export function normalizeDiagnostic(
  diagnostic: Diagnostic,
  projectRoot: string,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): NormalizedDiagnostic {
  requestContext.checkpoint();
  const sourceFile = diagnostic.getSourceFile();
  const start = diagnostic.getStart();
  const location =
    sourceFile && start !== undefined ? sourceFile.getLineAndColumnAtPos(start) : undefined;
  return {
    code: diagnostic.getCode(),
    category: DiagnosticCategory[diagnostic.getCategory()] ?? String(diagnostic.getCategory()),
    file: sourceFile ? path.relative(projectRoot, sourceFile.getFilePath()) : null,
    line: location?.line ?? null,
    column: location?.column ?? null,
    message: ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText, "\n"),
  };
}

function identity(diagnostic: NormalizedDiagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.category,
    diagnostic.file,
    diagnostic.message,
  ]);
}

function subtract(
  candidates: readonly NormalizedDiagnostic[],
  baseline: readonly NormalizedDiagnostic[],
  requestContext: RequestContext,
): NormalizedDiagnostic[] {
  const counts = new Map<string, number>();
  for (const diagnostic of baseline) {
    requestContext.checkpoint();
    const key = identity(diagnostic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const difference: NormalizedDiagnostic[] = [];
  for (const diagnostic of candidates) {
    requestContext.checkpoint();
    const key = identity(diagnostic);
    const remaining = counts.get(key) ?? 0;
    if (remaining > 0) {
      counts.set(key, remaining - 1);
    } else {
      difference.push(diagnostic);
    }
  }
  return difference;
}

export function compareDiagnostics(
  before: readonly NormalizedDiagnostic[],
  after: readonly NormalizedDiagnostic[],
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): DiagnosticDelta {
  requestContext.checkpoint();
  const added = subtract(after, before, requestContext);
  const removed = subtract(before, after, requestContext);
  return {
    added,
    removed,
    addedErrors: added.filter((diagnostic) => diagnostic.category === "Error"),
  };
}
