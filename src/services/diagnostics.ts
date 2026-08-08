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
