import path from "node:path";
import { DiagnosticCategory, type Diagnostic, ts } from "ts-morph";

export interface NormalizedDiagnostic {
  code: number;
  category: string;
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
}

export interface DiagnosticDelta {
  added: NormalizedDiagnostic[];
  removed: NormalizedDiagnostic[];
  addedErrors: NormalizedDiagnostic[];
}

export function normalizeDiagnostic(
  diagnostic: Diagnostic,
  projectRoot: string,
): NormalizedDiagnostic {
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
): NormalizedDiagnostic[] {
  const counts = new Map<string, number>();
  for (const diagnostic of baseline) {
    const key = identity(diagnostic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const difference: NormalizedDiagnostic[] = [];
  for (const diagnostic of candidates) {
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
): DiagnosticDelta {
  const added = subtract(after, before);
  const removed = subtract(before, after);
  return {
    added,
    removed,
    addedErrors: added.filter((diagnostic) => diagnostic.category === "Error"),
  };
}
