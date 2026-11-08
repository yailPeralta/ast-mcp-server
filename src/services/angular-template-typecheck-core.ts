import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MAX_MESSAGE_CHARS,
  type Request,
  type Response,
  type WireDiagnostic,
} from "./angular-template-typecheck-protocol.js";

type TsModule = typeof import("typescript");
type Options = Record<string, unknown>;

interface NgDiagnostic {
  readonly code: number;
  readonly category: number;
  readonly file?: import("typescript").SourceFile;
  readonly start?: number;
  readonly length?: number;
  readonly messageText: string | import("typescript").DiagnosticMessageChain;
}
interface NgProgram {
  readonly compiler: {
    getComponentsWithTemplateFile?(
      template: string,
    ): Iterable<{ getSourceFile(): { fileName: string } }>;
  };
  loadNgStructureAsync(): Promise<void>;
  getNgSemanticDiagnostics(): readonly NgDiagnostic[];
}
/** The slice of the public `@angular/compiler-cli` entry this driver uses. */
export interface CliModule {
  NgtscProgram: new (
    rootNames: readonly string[],
    options: Options,
    host: unknown,
    oldProgram?: NgProgram,
  ) => NgProgram;
  readConfiguration(project: string): {
    options: Options;
    rootNames: string[];
    errors: readonly unknown[];
  };
  createCompilerHost(parameters: { options: Options; tsHost: unknown }): unknown;
}
export interface Toolchain {
  readonly ts: TsModule;
  readonly cli: CliModule;
}

/** Loads the TypeScript that ngtsc itself resolves, then the pre-validated compiler-cli entry. */
export async function loadToolchain(cliEntry: string): Promise<Toolchain> {
  const tsEntry = createRequire(cliEntry).resolve("typescript");
  const ts = ((await import(pathToFileURL(tsEntry).href)) as { default: TsModule }).default;
  const cli = (await import(pathToFileURL(cliEntry).href)) as CliModule;
  return { ts, cli };
}

/** True when the public surface this driver needs is present (never touches `private/*`). */
export function probeCompilerApi(cli: Partial<CliModule>): boolean {
  return (
    typeof cli.NgtscProgram === "function" &&
    typeof cli.readConfiguration === "function" &&
    typeof cli.createCompilerHost === "function" &&
    typeof cli.NgtscProgram.prototype?.getNgSemanticDiagnostics === "function"
  );
}

/** Forces the options that make an emit or a build-info write impossible. */
export function withNoEmit(options: Options): Options {
  return {
    ...options,
    noEmit: true,
    incremental: false,
    composite: false,
    tsBuildInfoFile: undefined,
  };
}

/** Scope B: an edited template or a scoped component file, never anything under node_modules. */
export function isInScope(fileName: string, scopeFiles: ReadonlySet<string>): boolean {
  return scopeFiles.has(fileName) && !fileName.split(/[\\/]/u).includes("node_modules");
}

export function toWireDiagnostic(
  ts: TsModule,
  root: string,
  diagnostic: NgDiagnostic,
): WireDiagnostic {
  const { file } = diagnostic;
  const start = diagnostic.start ?? null;
  const position = file && start !== null ? file.getLineAndCharacterOfPosition(start) : null;
  return {
    code: diagnostic.code,
    category: ts.DiagnosticCategory[diagnostic.category] ?? String(diagnostic.category),
    file: file ? path.relative(root, file.fileName) : "",
    line: position ? position.line + 1 : null,
    column: position ? position.character + 1 : null,
    message: ts
      .flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      .slice(0, MAX_MESSAGE_CHARS),
    start,
    length: diagnostic.length ?? null,
  };
}

/**
 * Host over the disk with an optional in-memory overlay. Unchanged files come from one cache
 * shared by both runs, so the after run reuses the identical SourceFile objects and only parses
 * overlay files again.
 */
function createCheckHost(
  { ts, cli }: Toolchain,
  options: Options,
  overlay: ReadonlyMap<string, string> | undefined,
  shared: Map<string, unknown>,
): unknown {
  const tsHost = ts.createCompilerHost(options as import("typescript").CompilerOptions, true);
  const { readFile, fileExists, getSourceFile } = tsHost;
  const fresh = new Map<string, unknown>();
  tsHost.writeFile = () => {
    throw new Error("The template type check must not write files.");
  };
  tsHost.readFile = (name) => overlay?.get(name) ?? readFile.call(tsHost, name);
  tsHost.fileExists = (name) => overlay?.has(name) === true || fileExists.call(tsHost, name);
  tsHost.getSourceFile = (name, languageVersion, ...rest) => {
    const text = overlay?.get(name);
    if (text !== undefined) {
      if (!fresh.has(name)) fresh.set(name, ts.createSourceFile(name, text, languageVersion, true));
      return fresh.get(name) as import("typescript").SourceFile;
    }
    if (!shared.has(name)) {
      shared.set(name, getSourceFile.call(tsHost, name, languageVersion, ...rest));
    }
    return shared.get(name) as import("typescript").SourceFile | undefined;
  };
  const ngHost = cli.createCompilerHost({ options, tsHost }) as {
    getModifiedResourceFiles?: () => Set<string>;
  };
  if (overlay) {
    // With `oldProgram` reuse ngtsc re-analyzes a component only if it is told which resources changed.
    const resources = new Set([...overlay.keys()].filter((name) => !/\.[cm]?tsx?$/u.test(name)));
    ngHost.getModifiedResourceFiles = () => resources;
  }
  return ngHost;
}

type Side = { readonly program: NgProgram; readonly diagnostics: WireDiagnostic[] } | "unsupported";

async function checkSide(
  toolchain: Toolchain,
  config: { options: Options; rootNames: string[] },
  request: Request,
  overlay: ReadonlyMap<string, string> | undefined,
  shared: Map<string, unknown>,
  oldProgram: NgProgram | undefined,
): Promise<Side> {
  const host = createCheckHost(toolchain, config.options, overlay, shared);
  const program = new toolchain.cli.NgtscProgram(
    config.rootNames,
    config.options,
    host,
    oldProgram,
  );
  await program.loadNgStructureAsync();
  const compiler = program.compiler;
  if (typeof compiler?.getComponentsWithTemplateFile !== "function") return "unsupported";
  const scope = new Set(request.templates);
  for (const template of request.templates) {
    for (const component of compiler.getComponentsWithTemplateFile(template)) {
      scope.add(component.getSourceFile().fileName);
    }
  }
  const root = path.dirname(request.tsconfig);
  const diagnostics = program
    .getNgSemanticDiagnostics()
    .filter((diagnostic) => diagnostic.file && isInScope(diagnostic.file.fileName, scope))
    .map((diagnostic) => toWireDiagnostic(toolchain.ts, root, diagnostic));
  return { program, diagnostics };
}

const fail = (reason: Extract<Response, { ok: false }>["reason"]): Response => ({
  v: 1,
  ok: false,
  reason,
});

/** Runs ngtsc on the disk state, then on disk plus overlay, and returns both scoped lists. */
export async function runTemplateTypeCheck(
  request: Request,
  load: (cliEntry: string) => Promise<Toolchain> = loadToolchain,
): Promise<Response> {
  try {
    const toolchain = await load(request.cliEntry);
    if (!probeCompilerApi(toolchain.cli)) return fail("compiler_unsupported");
    const read = toolchain.cli.readConfiguration(request.tsconfig);
    if (read.errors.length > 0) return fail("check_failed");
    const config = { options: withNoEmit(read.options), rootNames: read.rootNames };
    const shared = new Map<string, unknown>();
    const overlay = new Map(request.overlay.map((file) => [file.absolutePath, file.text]));

    const before = await checkSide(toolchain, config, request, undefined, shared, undefined);
    if (before === "unsupported") return fail("compiler_unsupported");
    if (before.diagnostics.length > request.maxDiagnostics) return fail("work_exhausted");
    const after = await checkSide(toolchain, config, request, overlay, shared, before.program);
    if (after === "unsupported") return fail("compiler_unsupported");
    if (after.diagnostics.length > request.maxDiagnostics) return fail("work_exhausted");
    return { v: 1, ok: true, before: before.diagnostics, after: after.diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return fail(
      message.startsWith("The Angular Compiler requires TypeScript")
        ? "typescript_incompatible"
        : "check_failed",
    );
  }
}
