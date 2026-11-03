import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Node, SyntaxKind, type ClassDeclaration, type Decorator } from "ts-morph";
import type { ProjectContext } from "./project.js";
import type { RequestContext } from "./request-context.js";
import { assertSafeOperationFile } from "./safe-file.js";

export type TemplateCoverageReason =
  | "compiler_missing"
  | "compiler_unsupported"
  | "template_unresolved"
  | "template_unsafe"
  | "template_parse_error"
  | "size_exceeded"
  | "work_exhausted"
  | "inherited_member";
export type TemplateCoverage =
  | { readonly status: "not_applicable" }
  | { readonly status: "completed"; readonly templates: number }
  | {
      readonly status: "unfinished" | "unsupported";
      readonly reason: TemplateCoverageReason;
      readonly templates: number;
    };
export interface TemplateUsage {
  readonly absolutePath: string;
  readonly file: string;
  readonly container: "external" | "inline";
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly kind: "TemplatePropertyRead" | "TemplatePropertyWrite" | "TemplateCall";
  readonly localsInScope: readonly string[];
  readonly fileHash: string;
}

const MIN_COMPILER_MAJOR = 20;
const MAX_COMPILER_MAJOR = 22;
const NOT_APPLICABLE = { coverage: { status: "not_applicable" }, usages: [] } as const;

type AnyCtor = new () => any;
interface CompilerModule {
  parseTemplate(
    text: string,
    url: string,
    options: object,
  ): { nodes: any[]; errors?: any[] | null };
  tmplAstVisitAll(visitor: object, nodes: any[]): void;
  TmplAstRecursiveVisitor: AnyCtor;
  RecursiveAstVisitor: AnyCtor;
  ImplicitReceiver: AnyCtor;
  ThisReceiver: AnyCtor;
  PropertyRead: AnyCtor;
  Call: AnyCtor;
  Binary?: AnyCtor;
  PropertyWrite?: AnyCtor;
}
type CompilerLoad =
  | { readonly compiler: CompilerModule }
  | { readonly reason: "compiler_missing" | "compiler_unsupported" };

const compilerCache = new Map<string, Promise<CompilerModule>>();

function resolveFrom(tsConfigFilePath: string, request: string): string | undefined {
  try {
    const resolved = createRequire(tsConfigFilePath).resolve(request);
    return existsSync(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** True when `packageDir` sits in a node_modules directory owned by `projectDir` or an ancestor. */
function isUnderAncestorNodeModules(packageDir: string, projectDir: string): boolean {
  const segments = packageDir.split(path.sep);
  return segments.some(
    (segment, index) =>
      segment === "node_modules" &&
      isWithin(segments.slice(0, index).join(path.sep) || path.sep, projectDir),
  );
}

function isSupportedVersion(version: unknown): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+.*)?$/u.exec(String(version));
  if (!match) return false;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number) as [
    number,
    number,
    number,
  ];
  const belowFloor = major === MIN_COMPILER_MAJOR && minor === 0 && patch === 0 && !!match[4];
  return major >= MIN_COMPILER_MAJOR && major <= MAX_COMPILER_MAJOR && !belowFloor;
}

async function loadCompiler(tsConfigFilePath: string): Promise<CompilerLoad> {
  const unsupported = { reason: "compiler_unsupported" } as const;
  const manifestPath = resolveFrom(tsConfigFilePath, "@angular/compiler/package.json");
  if (!manifestPath) {
    try {
      createRequire(tsConfigFilePath).resolve("@angular/compiler/package.json");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
        return { reason: "compiler_missing" };
      }
    }
    return unsupported;
  }
  try {
    const packageDir = realpathSync(path.dirname(manifestPath));
    if (!isUnderAncestorNodeModules(packageDir, realpathSync(path.dirname(tsConfigFilePath)))) {
      return unsupported;
    }
    const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
    const entry = resolveFrom(tsConfigFilePath, "@angular/compiler");
    const realEntry = entry && realpathSync(entry);
    if (manifest.name !== "@angular/compiler" || !isSupportedVersion(manifest.version)) {
      return unsupported;
    }
    if (!realEntry || !isWithin(packageDir, realEntry)) return unsupported;
    const key = `${realEntry}@${manifest.version}`;
    let loading = compilerCache.get(key);
    if (!loading) {
      loading = import(pathToFileURL(realEntry).href) as Promise<CompilerModule>;
      compilerCache.set(key, loading);
    }
    const compiler = await loading.catch((error: unknown) => {
      compilerCache.delete(key);
      throw error;
    });
    const hasWriteNode = compiler.Binary !== undefined || compiler.PropertyWrite !== undefined;
    const complete =
      hasWriteNode &&
      [
        compiler.parseTemplate,
        compiler.tmplAstVisitAll,
        compiler.TmplAstRecursiveVisitor,
        compiler.RecursiveAstVisitor,
        compiler.ImplicitReceiver,
        compiler.ThisReceiver,
        compiler.PropertyRead,
        compiler.Call,
      ].every((member) => typeof member === "function");
    return complete ? { compiler } : unsupported;
  } catch {
    return unsupported;
  }
}

function hasAngularCore(context: ProjectContext): boolean {
  return resolveFrom(context.tsConfigFilePath, "@angular/core/package.json") !== undefined;
}

function isComponentDecorator(decorator: Decorator): boolean {
  const callee = decorator.getCallExpression()?.getExpression();
  if (!callee) return false;
  return decorator
    .getSourceFile()
    .getImportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue() === "@angular/core")
    .some((declaration) => {
      const namespace = declaration.getNamespaceImport();
      if (Node.isPropertyAccessExpression(callee)) {
        return (
          callee.getName() === "Component" &&
          callee.getExpression().getText() === namespace?.getText()
        );
      }
      return declaration
        .getNamedImports()
        .some(
          (specifier) =>
            specifier.getName() === "Component" &&
            (specifier.getAliasNode()?.getText() ?? "Component") === callee.getText(),
        );
    });
}

function componentDecorator(cls: ClassDeclaration): Decorator | undefined {
  return cls.getDecorators().find(isComponentDecorator);
}

type Located =
  | { readonly container: "external"; readonly absolutePath: string }
  | {
      readonly container: "inline";
      readonly absolutePath: string;
      readonly text: string;
      readonly offset: number;
    }
  | { readonly reason: TemplateCoverageReason };

/** Finds the template of a component class from literal metadata only. */
function locateTemplate(cls: ClassDeclaration): Located {
  const unresolved = { reason: "template_unresolved" } as const;
  const metadata = componentDecorator(cls)?.getArguments()[0];
  if (!Node.isObjectLiteralExpression(metadata) || metadata.getProperty("interpolation")) {
    return unresolved;
  }
  const initializer = (name: string): Node | null | undefined => {
    const property = metadata.getProperty(name);
    if (!property) return undefined;
    return Node.isPropertyAssignment(property) ? (property.getInitializer() ?? null) : null;
  };
  const literalText = (node: Node | null | undefined): string | undefined => {
    const literal = node ?? undefined;
    return Node.isStringLiteral(literal) || Node.isNoSubstitutionTemplateLiteral(literal)
      ? literal.getLiteralText()
      : undefined;
  };
  const sourceFile = cls.getSourceFile();
  const templateUrl = initializer("templateUrl");
  if (templateUrl !== undefined) {
    const url = literalText(templateUrl);
    if (url === undefined) return unresolved;
    return {
      container: "external",
      absolutePath: path.resolve(path.dirname(sourceFile.getFilePath()), url),
    };
  }
  const template = initializer("template");
  const text = literalText(template);
  if (!template || text === undefined) return unresolved;
  const offset = template.getStart() + 1;
  // Escapes or CRLF make cooked text diverge from source offsets, so spans would be inexact.
  if (sourceFile.getFullText().slice(offset, template.getEnd() - 1) !== text) return unresolved;
  return { container: "inline", absolutePath: sourceFile.getFilePath(), text, offset };
}

function checkTemplatePath(
  projectRoot: string,
  absolutePath: string,
): TemplateCoverageReason | undefined {
  if (!isWithin(projectRoot, absolutePath) || absolutePath === projectRoot)
    return "template_unsafe";
  try {
    assertSafeOperationFile(projectRoot, absolutePath, path.relative(projectRoot, absolutePath));
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "template_unresolved"
      : "template_unsafe";
  }
}

function componentClasses(context: ProjectContext): ClassDeclaration[] {
  return context.project
    .getSourceFiles()
    .filter(
      (file) =>
        !file.isDeclarationFile() &&
        !file.isFromExternalLibrary() &&
        file.getFullText().includes("Component"),
    )
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration))
    .filter((cls) => componentDecorator(cls) !== undefined);
}

/** Existing, contained external template files of every component. Sync and compiler-free. */
export function listTemplateFiles(context: ProjectContext): readonly string[] {
  if (!hasAngularCore(context)) return [];
  const files = new Set<string>();
  for (const cls of componentClasses(context)) {
    const located = locateTemplate(cls);
    if (
      "container" in located &&
      located.container === "external" &&
      checkTemplatePath(context.projectRoot, located.absolutePath) === undefined
    ) {
      files.add(located.absolutePath);
    }
  }
  return [...files].sort();
}

function memberOwner(node: Node): { cls: ClassDeclaration; name: string } | undefined {
  let owner: Node | undefined;
  if (Node.isParameterDeclaration(node)) {
    owner = node.isParameterProperty() ? node.getParent()?.getParent() : undefined;
  } else if (
    Node.isPropertyDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  ) {
    owner = node.isStatic() ? undefined : node.getParent();
  }
  const nameNode = (node as Node & { getNameNode?(): Node }).getNameNode?.();
  return Node.isClassDeclaration(owner) && Node.isIdentifier(nameNode)
    ? { cls: owner, name: nameNode.getText() }
    : undefined;
}

function hasDerivedComponent(context: ProjectContext, cls: ClassDeclaration): boolean {
  const identity = (node: ClassDeclaration) =>
    `${node.getSourceFile().getFilePath()}:${node.getPos()}`;
  const target = identity(cls);
  return componentClasses(context).some((candidate) => {
    let base = candidate.getBaseClass();
    for (let depth = 0; base && depth < 32; depth += 1) {
      if (identity(base) === target) return true;
      base = base.getBaseClass();
    }
    return false;
  });
}

/**
 * Resolves coverage and the owning template of a component member. Usage extraction is
 * wired in by the next change; until then a located, safe template reports no usages.
 */
export async function collectTemplateUsages(
  node: Node,
  context: ProjectContext,
  rc: RequestContext,
): Promise<{ coverage: TemplateCoverage; usages: readonly TemplateUsage[] }> {
  rc.checkpoint();
  const owner = memberOwner(node);
  if (!owner || !hasAngularCore(context)) return NOT_APPLICABLE;
  const isComponent = componentDecorator(owner.cls) !== undefined;
  const derived = hasDerivedComponent(context, owner.cls);
  if (!isComponent && !derived) return NOT_APPLICABLE;
  const fail = (status: "unfinished" | "unsupported", reason: TemplateCoverageReason) => ({
    coverage: { status, reason, templates: 0 } as TemplateCoverage,
    usages: [] as readonly TemplateUsage[],
  });
  if (derived) return fail("unsupported", "inherited_member");

  const loaded = await loadCompiler(context.tsConfigFilePath);
  if ("reason" in loaded) return fail("unfinished", loaded.reason);
  const located = locateTemplate(owner.cls);
  if ("reason" in located) return fail("unfinished", located.reason);
  if (located.container === "external") {
    const unsafe = checkTemplatePath(context.projectRoot, located.absolutePath);
    if (unsafe) return fail("unfinished", unsafe);
  }
  return { coverage: { status: "completed", templates: 1 }, usages: [] };
}
