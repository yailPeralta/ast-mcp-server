import { fork, type ChildProcess, type ForkOptions } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isSupportedVersion,
  isUnderAncestorNodeModules,
  isWithin,
  rangeVerdict,
  resolveFrom,
} from "./angular-package-resolution.js";
import {
  MAX_OVERLAY_BYTES,
  MAX_OVERLAY_FILES,
  MAX_TEMPLATES,
  MAX_WIRE_DIAGNOSTICS,
  parseResponse,
  type Request,
  type Response,
  type WireDiagnostic,
} from "./angular-template-typecheck-protocol.js";
import {
  compareObservedDiagnostics,
  type DiagnosticDelta,
  type DiagnosticObservation,
  type DiagnosticTextChange,
} from "./diagnostics.js";
import { NO_REQUEST_CONTEXT, RequestContextError, type RequestContext } from "./request-context.js";

export type TemplateTypeCheckReason =
  | "compiler_cli_missing"
  | "compiler_unsupported"
  | "typescript_incompatible"
  | "work_exhausted"
  | "deadline"
  | "check_failed";
export type TemplateDiagnostics =
  | ({ status: "completed" } & DiagnosticDelta)
  | ({ status: "unavailable" | "unfinished"; reason: TemplateTypeCheckReason } & DiagnosticDelta);

export interface TemplateOverlayFile {
  readonly absolutePath: string;
  readonly text: string;
}
export interface TemplateTypeCheckInput {
  readonly tsConfigFilePath: string;
  /** Absolute paths of the external templates the plan edits. */
  readonly templates: readonly string[];
  /** Changed files only: TypeScript `afterText` plus the edited templates. */
  readonly overlay: readonly TemplateOverlayFile[];
  /** The plan's text changes (project-relative `file`), used to map positions across the edit. */
  readonly changes: readonly DiagnosticTextChange[];
}
/** The request context plus the time the enclosing operation has left (scheduler-owned). */
export interface TemplateTypeCheckContext extends RequestContext {
  remainingMs(): number;
}
export interface TemplateTypeCheckDeps {
  /** Seam over `child_process.fork`, for supervisor tests. */
  readonly spawn?: (entry: string, args: string[], options: ForkOptions) => ChildProcess;
  readonly entry?: string;
}

export type Preflight =
  | { readonly ok: true; readonly cliDir: string; readonly cliEntry: string }
  | {
      readonly ok: false;
      readonly reason: "compiler_cli_missing" | "compiler_unsupported" | "typescript_incompatible";
    };

const UNSUPPORTED = { ok: false, reason: "compiler_unsupported" } as const;

interface PackageInfo {
  readonly dir: string;
  readonly manifest: Record<string, unknown>;
}

/** Locates an installed package through the shared guard, or reports why it cannot be trusted. */
function locatePackage(
  tsConfigFilePath: string,
  name: string,
  projectDir: string,
): PackageInfo | "missing" | "unsupported" {
  const manifestPath = resolveFrom(tsConfigFilePath, `${name}/package.json`);
  if (!manifestPath) {
    try {
      createRequire(tsConfigFilePath).resolve(`${name}/package.json`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return "missing";
    }
    return "unsupported";
  }
  try {
    const dir = realpathSync(path.dirname(manifestPath));
    if (!isUnderAncestorNodeModules(dir, projectDir)) return "unsupported";
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    return manifest?.name === name ? { dir, manifest } : "unsupported";
  } catch {
    return "unsupported";
  }
}

function majorOf(version: unknown): number {
  return Number(String(version).split(".")[0]);
}

/** In-process checks before any spawn; TypeScript is resolved from the compiler-cli, as ngtsc does. */
export function preflightTemplateTypeCheck(tsConfigFilePath: string): Preflight {
  let projectDir: string;
  try {
    projectDir = realpathSync(path.dirname(tsConfigFilePath));
  } catch {
    return UNSUPPORTED;
  }
  const cli = locatePackage(tsConfigFilePath, "@angular/compiler-cli", projectDir);
  if (cli === "missing") return { ok: false, reason: "compiler_cli_missing" };
  if (cli === "unsupported") return UNSUPPORTED;
  const compiler = locatePackage(tsConfigFilePath, "@angular/compiler", projectDir);
  const core = locatePackage(tsConfigFilePath, "@angular/core", projectDir);
  if (typeof compiler === "string" || typeof core === "string") return UNSUPPORTED;
  const version = cli.manifest.version;
  if (!isSupportedVersion(version) || compiler.manifest.version !== version) return UNSUPPORTED;
  if (
    !isSupportedVersion(core.manifest.version) ||
    majorOf(core.manifest.version) !== majorOf(version)
  ) {
    return UNSUPPORTED;
  }

  const entry = resolveFrom(tsConfigFilePath, "@angular/compiler-cli");
  let cliEntry: string | undefined;
  try {
    cliEntry = entry && realpathSync(entry);
  } catch {
    return UNSUPPORTED;
  }
  if (!cliEntry || !isWithin(cli.dir, cliEntry)) return UNSUPPORTED;

  const peer = (cli.manifest.peerDependencies as Record<string, unknown> | undefined)?.typescript;
  const typescript = resolveFrom(path.join(cli.dir, "package.json"), "typescript/package.json");
  if (typeof peer !== "string") return UNSUPPORTED;
  if (!typescript) return { ok: false, reason: "typescript_incompatible" };
  let typescriptVersion: unknown;
  try {
    typescriptVersion = JSON.parse(readFileSync(typescript, "utf8")).version;
  } catch {
    return UNSUPPORTED;
  }
  const verdict = rangeVerdict(String(typescriptVersion), peer);
  if (verdict === "unsupported") return UNSUPPORTED;
  if (verdict === "unsatisfied") return { ok: false, reason: "typescript_incompatible" };
  return { ok: true, cliDir: cli.dir, cliEntry };
}

function emptyDelta(
  status: "unavailable" | "unfinished",
  reason: TemplateTypeCheckReason,
): TemplateDiagnostics {
  return { status, reason, added: [], removed: [], addedErrors: [] };
}

const MAX_CHECK_MS = 30_000;
const MIN_CHECK_MS = 2_000;
const RESERVE_MS = 10_000;
const CHILD_HEAP_MB = 1024;
const EXIT_SETTLE_MS = 500;
const OOM_EXIT_CODE = 134;
const DEFAULT_ENTRY = fileURLToPath(
  new URL("../angular-template-typecheck-entry.js", import.meta.url),
);
const UNBOUNDED_CONTEXT: TemplateTypeCheckContext = {
  signal: NO_REQUEST_CONTEXT.signal,
  checkpoint: () => NO_REQUEST_CONTEXT.checkpoint(),
  remainingMs: () => MAX_CHECK_MS + RESERVE_MS,
};

/** Time the child may run: capped, and leaving a reserve for the rest of the operation. */
export function checkBudgetMs(remainingMs: number): number {
  return Math.min(MAX_CHECK_MS, remainingMs - RESERVE_MS);
}

type ChildOutcome =
  | { readonly kind: "reply"; readonly response: Response }
  | { readonly kind: "reason"; readonly reason: "work_exhausted" | "check_failed" }
  | { readonly kind: "deadline" };

function outcomeOf(code: number | null, signal: string | null, reply: unknown): ChildOutcome {
  if (signal === "SIGABRT" || code === OOM_EXIT_CODE) {
    return { kind: "reason", reason: "work_exhausted" };
  }
  if (code !== 0) return { kind: "reason", reason: "check_failed" };
  const parsed = parseResponse(reply);
  if (parsed.status === "valid") return { kind: "reply", response: parsed.response };
  return {
    kind: "reason",
    reason: parsed.status === "oversized" ? "work_exhausted" : "check_failed",
  };
}

/** Runs one child to completion; it is always reaped before this settles. */
function runChild(
  request: Request,
  budgetMs: number,
  ctx: TemplateTypeCheckContext,
  deps: TemplateTypeCheckDeps,
): Promise<ChildOutcome> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = (deps.spawn ?? fork)(deps.entry ?? DEFAULT_ENTRY, [], {
        execPath: process.execPath,
        execArgv: [`--max-old-space-size=${CHILD_HEAP_MB}`],
        env: {},
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
    } catch {
      return resolve({ kind: "reason", reason: "check_failed" });
    }
    let reply: unknown;
    let killedFor: "deadline" | "abort" | undefined;
    let failed = false;
    let settled = false;
    const kill = (why: "deadline" | "abort") => {
      killedFor ??= why;
      child.kill("SIGKILL");
    };
    const settle = (result: ChildOutcome | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onAbort = () => kill("abort");
    const timer = setTimeout(() => kill("deadline"), budgetMs);
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    child.once("message", (message) => {
      reply = message;
    });
    child.once("error", () => {
      failed = true;
      // No pid means the spawn itself failed and no exit will follow; otherwise reap first.
      if (child.pid === undefined) settle({ kind: "reason", reason: "check_failed" });
      else child.kill("SIGKILL");
    });
    child.once("exit", (code, signal) => {
      const finish = () => {
        if (killedFor === "abort") settle(abortError(ctx));
        else if (killedFor === "deadline") settle({ kind: "deadline" });
        else if (failed) settle({ kind: "reason", reason: "check_failed" });
        else settle(outcomeOf(code, signal, reply));
      };
      // Pending IPC messages are delivered before the channel reports closed.
      if (!child.connected) return finish();
      child.once("disconnect", finish);
      setTimeout(finish, EXIT_SETTLE_MS).unref();
    });
    if (ctx.signal.aborted) return onAbort();
    child.send(request, () => undefined);
  });
}

function abortError(ctx: TemplateTypeCheckContext): Error {
  try {
    ctx.checkpoint();
  } catch (error) {
    return error as Error;
  }
  return new RequestContextError("REQUEST_CANCELLED");
}

function observations(diagnostics: readonly WireDiagnostic[]): DiagnosticObservation[] {
  return diagnostics.map(({ start, length, ...shown }, ordinal) => ({
    public: {
      code: shown.code,
      category: shown.category,
      file: shown.file,
      line: shown.line,
      column: shown.column,
      message: shown.message,
    },
    start,
    length,
    ordinal,
  }));
}

function diagnosticsOf(
  response: Response,
  changes: readonly DiagnosticTextChange[],
  ctx: TemplateTypeCheckContext,
): TemplateDiagnostics {
  if (!response.ok) {
    const reason = response.reason;
    return emptyDelta(
      reason === "compiler_unsupported" || reason === "typescript_incompatible"
        ? "unavailable"
        : "unfinished",
      reason,
    );
  }
  const delta = compareObservedDiagnostics(
    observations(response.before),
    observations(response.after),
    changes,
    ctx,
  );
  return { status: "completed", ...delta };
}

/**
 * Entry point of the template type check: preflight and limits in-process, then one forked child
 * under a wall-clock budget. A client abort kills the child and rethrows `REQUEST_CANCELLED`.
 */
export async function checkTemplateTypes(
  input: TemplateTypeCheckInput,
  ctx: TemplateTypeCheckContext = UNBOUNDED_CONTEXT,
  deps: TemplateTypeCheckDeps = {},
): Promise<TemplateDiagnostics> {
  ctx.checkpoint();
  const preflight = preflightTemplateTypeCheck(input.tsConfigFilePath);
  if (!preflight.ok) return emptyDelta("unavailable", preflight.reason);
  const overlayBytes = input.overlay.reduce(
    (total, file) => total + Buffer.byteLength(file.text, "utf8"),
    0,
  );
  if (
    input.templates.length > MAX_TEMPLATES ||
    input.overlay.length > MAX_OVERLAY_FILES ||
    overlayBytes > MAX_OVERLAY_BYTES
  ) {
    return emptyDelta("unfinished", "work_exhausted");
  }
  const budgetMs = checkBudgetMs(ctx.remainingMs());
  if (budgetMs < MIN_CHECK_MS) return emptyDelta("unfinished", "deadline");

  const outcome = await runChild(
    {
      v: 1,
      tsconfig: input.tsConfigFilePath,
      cliEntry: preflight.cliEntry,
      templates: [...input.templates],
      overlay: input.overlay.map(({ absolutePath, text }) => ({ absolutePath, text })),
      maxDiagnostics: MAX_WIRE_DIAGNOSTICS,
    },
    budgetMs,
    ctx,
    deps,
  );
  if (outcome.kind === "deadline") return emptyDelta("unfinished", "deadline");
  if (outcome.kind === "reason") return emptyDelta("unfinished", outcome.reason);
  return diagnosticsOf(outcome.response, input.changes, ctx);
}
