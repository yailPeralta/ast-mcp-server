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

export interface DiagnosticObservation {
  public: NormalizedDiagnostic;
  start: number | null;
  length: number | null;
  ordinal: number;
}

export function observeDiagnostic(
  diagnostic: Diagnostic,
  projectRoot: string,
  ordinal = 0,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): DiagnosticObservation {
  requestContext.checkpoint();
  const sourceFile = diagnostic.getSourceFile();
  const start = diagnostic.getStart() ?? null;
  const length = diagnostic.getLength() ?? null;
  const location =
    sourceFile && start !== null ? sourceFile.getLineAndColumnAtPos(start) : undefined;
  return {
    public: {
      code: diagnostic.getCode(),
      category: DiagnosticCategory[diagnostic.getCategory()] ?? String(diagnostic.getCategory()),
      file: sourceFile ? path.relative(projectRoot, sourceFile.getFilePath()) : null,
      line: location?.line ?? null,
      column: location?.column ?? null,
      message: ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText, "\n"),
    },
    start,
    length,
    ordinal,
  };
}

export function normalizeDiagnostic(
  diagnostic: Diagnostic,
  projectRoot: string,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): NormalizedDiagnostic {
  return observeDiagnostic(diagnostic, projectRoot, 0, requestContext).public;
}

export interface EditSpan {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

export interface EditContext {
  coarse: boolean;
  runs: EditSpan[];
  hunks: EditSpan[];
}

export interface EditBudget {
  frontierSteps: number;
  traceCells: number;
  hunks: number;
}

const DEFAULT_EDIT_BUDGET = { frontierSteps: 1_000_000, traceCells: 250_000, hunks: 10_000 };
const BUDGET_EXCEEDED = Symbol("edit-budget-exceeded");
type EditOperation = "equal" | "delete" | "insert";

function coarseContext(
  oldLength: number,
  newLength: number,
  prefix: number,
  suffix: number,
): EditContext {
  const runs: EditSpan[] = [];
  if (prefix > 0) runs.push({ oldStart: 0, oldEnd: prefix, newStart: 0, newEnd: prefix });
  if (suffix > 0) {
    runs.push({
      oldStart: oldLength - suffix,
      oldEnd: oldLength,
      newStart: newLength - suffix,
      newEnd: newLength,
    });
  }
  return {
    coarse: true,
    runs,
    hunks: [
      {
        oldStart: prefix,
        oldEnd: oldLength - suffix,
        newStart: prefix,
        newEnd: newLength - suffix,
      },
    ],
  };
}

function backtrack(
  trace: ReadonlyMap<number, number>[],
  depth: number,
  oldLength: number,
  newLength: number,
): EditOperation[] {
  const reversed: EditOperation[] = [];
  let x = oldLength;
  let y = newLength;
  for (let d = depth; d > 0; d -= 1) {
    const previous = trace[d - 1]!;
    const diagonal = x - y;
    const left = previous.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
    const right = previous.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
    const previousDiagonal =
      diagonal === -d || (diagonal !== d && left < right) ? diagonal + 1 : diagonal - 1;
    const previousX = previous.get(previousDiagonal)!;
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      reversed.push("equal");
      x -= 1;
      y -= 1;
    }
    if (x === previousX) {
      reversed.push("insert");
      y -= 1;
    } else {
      reversed.push("delete");
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    reversed.push("equal");
    x -= 1;
    y -= 1;
  }
  return reversed.reverse();
}

function emitContext(
  operations: readonly EditOperation[],
  prefix: number,
  budget: EditBudget,
  requestContext: RequestContext,
): EditContext {
  const runs: EditSpan[] = [];
  const hunks: EditSpan[] = [];
  let oldPosition = prefix;
  let newPosition = prefix;
  if (prefix > 0) runs.push({ oldStart: 0, oldEnd: prefix, newStart: 0, newEnd: prefix });
  for (let index = 0; index < operations.length;) {
    requestContext.checkpoint();
    const equal = operations[index] === "equal";
    const oldStart = oldPosition;
    const newStart = newPosition;
    while (index < operations.length && (operations[index] === "equal") === equal) {
      if (operations[index] !== "insert") oldPosition += 1;
      if (operations[index] !== "delete") newPosition += 1;
      index += 1;
    }
    const span = { oldStart, oldEnd: oldPosition, newStart, newEnd: newPosition };
    if (equal) runs.push(span);
    else {
      if (hunks.length >= budget.hunks) throw BUDGET_EXCEEDED;
      hunks.push(span);
    }
  }
  return { coarse: false, runs, hunks };
}

export function buildEditContext(
  oldText: string,
  newText: string,
  budget: EditBudget = DEFAULT_EDIT_BUDGET,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): EditContext {
  requestContext.checkpoint();
  let comparisons = 0;
  const equalAt = (oldIndex: number, newIndex: number): boolean => {
    if (++comparisons % 4_096 === 0) requestContext.checkpoint();
    return oldText[oldIndex] === newText[newIndex];
  };
  let prefix = 0;
  while (prefix < oldText.length && prefix < newText.length && equalAt(prefix, prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    equalAt(oldText.length - suffix - 1, newText.length - suffix - 1)
  )
    suffix += 1;
  if (prefix === oldText.length && prefix === newText.length) {
    return {
      coarse: false,
      runs: prefix === 0 ? [] : [{ oldStart: 0, oldEnd: prefix, newStart: 0, newEnd: prefix }],
      hunks: [],
    };
  }

  const oldMiddle = oldText.slice(prefix, oldText.length - suffix);
  const newMiddle = newText.slice(prefix, newText.length - suffix);
  const trace: Map<number, number>[] = [];
  let previous = new Map<number, number>([[1, 0]]);
  let frontierSteps = 0;
  let traceCells = 0;
  try {
    for (let depth = 0; depth <= oldMiddle.length + newMiddle.length; depth += 1) {
      const current = new Map<number, number>();
      for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
        requestContext.checkpoint();
        if (++frontierSteps > budget.frontierSteps || ++traceCells > budget.traceCells)
          throw BUDGET_EXCEEDED;
        const left = previous.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
        const right = previous.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
        let x = diagonal === -depth || (diagonal !== depth && left < right) ? right : left + 1;
        let y = x - diagonal;
        while (x < oldMiddle.length && y < newMiddle.length && oldMiddle[x] === newMiddle[y]) {
          if (++comparisons % 4_096 === 0) requestContext.checkpoint();
          x += 1;
          y += 1;
        }
        current.set(diagonal, x);
        if (x >= oldMiddle.length && y >= newMiddle.length) {
          trace.push(current);
          const context = emitContext(
            backtrack(trace, depth, oldMiddle.length, newMiddle.length),
            prefix,
            budget,
            requestContext,
          );
          if (suffix > 0)
            context.runs.push({
              oldStart: oldText.length - suffix,
              oldEnd: oldText.length,
              newStart: newText.length - suffix,
              newEnd: newText.length,
            });
          return context;
        }
      }
      trace.push(current);
      previous = current;
    }
    throw new Error("Myers alignment did not terminate.");
  } catch (error) {
    if (error !== BUDGET_EXCEEDED) throw error;
    return coarseContext(oldText.length, newText.length, prefix, suffix);
  }
}

function identity(diagnostic: NormalizedDiagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.category,
    diagnostic.file,
    diagnostic.message,
  ]);
}

export interface DiagnosticTextChange {
  file: string;
  beforeText: string | null;
  afterText: string | null;
}

interface FileEditPair extends DiagnosticTextChange {
  context: EditContext | null;
}

function touchesHunk(
  start: number,
  length: number,
  hunks: readonly EditSpan[],
  side: "old" | "new",
): boolean {
  const end = start + length;
  return hunks.some((hunk) => {
    const hunkStart = side === "old" ? hunk.oldStart : hunk.newStart;
    const hunkEnd = side === "old" ? hunk.oldEnd : hunk.newEnd;
    return end >= hunkStart && start <= hunkEnd;
  });
}

function observationKey(
  observation: DiagnosticObservation,
  change: FileEditPair | undefined,
  side: "old" | "new",
): string | null {
  const diagnostic = observation.public;
  if (diagnostic.file === null) {
    return JSON.stringify([identity(diagnostic), diagnostic.line, diagnostic.column]);
  }
  if (!change) {
    return JSON.stringify([identity(diagnostic), observation.start, observation.length]);
  }
  if (
    change.beforeText === null ||
    change.afterText === null ||
    observation.start === null ||
    observation.length === null ||
    !change.context ||
    touchesHunk(observation.start, observation.length, change.context.hunks, side)
  ) {
    return null;
  }

  const run = change.context.runs.find((candidate) => {
    const runStart = side === "old" ? candidate.oldStart : candidate.newStart;
    const runEnd = side === "old" ? candidate.oldEnd : candidate.newEnd;
    return observation.start! >= runStart && observation.start! + observation.length! <= runEnd;
  });
  if (!run) return null;
  const mappedStart =
    side === "old" ? run.newStart + observation.start - run.oldStart : observation.start;
  return JSON.stringify([identity(diagnostic), mappedStart, observation.length]);
}

export function compareObservedDiagnostics(
  before: readonly DiagnosticObservation[],
  after: readonly DiagnosticObservation[],
  changes: readonly DiagnosticTextChange[],
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): DiagnosticDelta {
  requestContext.checkpoint();
  const edits = new Map<string, FileEditPair>();
  for (const change of changes) {
    requestContext.checkpoint();
    edits.set(change.file, {
      ...change,
      context:
        change.beforeText === null || change.afterText === null
          ? null
          : buildEditContext(change.beforeText, change.afterText, undefined, requestContext),
    });
  }

  const queues = new Map<string, { indices: number[]; cursor: number }>();
  for (let index = 0; index < before.length; index += 1) {
    requestContext.checkpoint();
    const observation = before[index]!;
    const key = observationKey(
      observation,
      observation.public.file === null ? undefined : edits.get(observation.public.file),
      "old",
    );
    if (key !== null) {
      const queue = queues.get(key) ?? { indices: [], cursor: 0 };
      queue.indices.push(index);
      queues.set(key, queue);
    }
  }

  const matchedBefore = new Set<number>();
  const matchedAfter = new Set<number>();
  for (let index = 0; index < after.length; index += 1) {
    requestContext.checkpoint();
    const observation = after[index]!;
    const key = observationKey(
      observation,
      observation.public.file === null ? undefined : edits.get(observation.public.file),
      "new",
    );
    const queue = key === null ? undefined : queues.get(key);
    if (queue && queue.cursor < queue.indices.length) {
      matchedBefore.add(queue.indices[queue.cursor++]!);
      matchedAfter.add(index);
    }
  }

  const added = after
    .filter((_, index) => !matchedAfter.has(index))
    .map(({ public: value }) => value);
  const removed = before
    .filter((_, index) => !matchedBefore.has(index))
    .map(({ public: value }) => value);
  return {
    added,
    removed,
    addedErrors: added.filter((diagnostic) => diagnostic.category === "Error"),
  };
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
