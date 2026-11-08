import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
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
} from "./angular-template-typecheck-protocol.js";
import type { DiagnosticDelta } from "./diagnostics.js";

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

/**
 * Entry point of the template type check. Until the worker lands (next slice) a request that
 * passes the preflight and the work limits reports `unfinished/check_failed`.
 */
export async function checkTemplateTypes(
  input: TemplateTypeCheckInput,
): Promise<TemplateDiagnostics> {
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
  return emptyDelta("unfinished", "check_failed");
}
