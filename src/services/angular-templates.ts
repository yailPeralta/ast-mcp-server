import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Node, SyntaxKind, type ClassDeclaration } from "ts-morph";
import {
  componentDecorator,
  isDirectiveClass,
  isMetadataPublic,
  isPipeClass,
  isSelectorPublic,
} from "./angular-decorators.js";
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
  | "inherited_member"
  | "cross_component";
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

const MAX_TEMPLATE_BYTES = 512 * 1024;
const MAX_TEMPLATE_NODES = 100_000;
const CHECKPOINT_EVERY_NODES = 1000;
const MIN_COMPILER_MAJOR = 18;
const MAX_COMPILER_MAJOR = 22;
const TWO_WAY_BINDING = 5; // BindingType.TwoWay, stable across supported majors
const TWO_WAY_EVENT = 2; // ParsedEventType.TwoWay, stable across supported majors
const NOT_APPLICABLE = { coverage: { status: "not_applicable" }, usages: [] } as const;
const ASSIGNMENT_OPERATION = /^(?:=|(?:\*\*|&&|\|\||\?\?|<<|>>>|>>|[+\-*/%&|^])=)$/u;

type AnyCtor = new () => any;
export interface CompilerModule {
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
  CssSelector?: AnyCtor & { parse(selector: string): any[] };
  SelectorMatcher?: AnyCtor;
  createCssSelectorFromNode?(node: any): any;
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

class WorkExhausted extends Error {}
type RawUsage = Pick<TemplateUsage, "start" | "end" | "kind" | "localsInScope">;

/** Walks parsed template nodes with a scope stack so template-local names shadow members. */
function extractUsages(
  compiler: CompilerModule,
  nodes: any[],
  memberName: string,
  rc: RequestContext,
): RawUsage[] {
  const usages = new Map<string, RawUsage>();
  const scopes: Set<string>[] = [];
  let visited = 0;
  const tick = (): void => {
    if (++visited > MAX_TEMPLATE_NODES) throw new WorkExhausted();
    if (visited % CHECKPOINT_EVERY_NODES === 0) rc.checkpoint();
  };
  const isLocal = (name: string) => scopes.some((scope) => scope.has(name));
  const record = (ast: any, kind: RawUsage["kind"]): void => {
    const key = `${ast.nameSpan.start}:${ast.nameSpan.end}`;
    const merged =
      usages.get(key)?.kind === "TemplatePropertyWrite" ? "TemplatePropertyWrite" : kind;
    usages.set(key, {
      start: ast.nameSpan.start,
      end: ast.nameSpan.end,
      kind: merged,
      localsInScope: [...new Set(scopes.flatMap((scope) => [...scope]))].sort(),
    });
  };
  // Explicit `this.` bypasses template locals; ThisReceiver only extends ImplicitReceiver in some majors.
  const isMemberReceiver = (receiver: any): boolean =>
    receiver instanceof compiler.ThisReceiver ||
    (receiver instanceof compiler.ImplicitReceiver && !isLocal(memberName));
  const isMember = (ast: any): boolean =>
    ast instanceof compiler.PropertyRead &&
    ast.name === memberName &&
    isMemberReceiver(ast.receiver);

  class Expressions extends (compiler.RecursiveAstVisitor as new () => {
    visitPropertyRead(ast: any, context?: any): void;
    visitCall(ast: any, context?: any): void;
    visitBinary(ast: any, context?: any): void;
  }) {
    writeRoot: unknown;
    visit(ast: any, context?: any): void {
      tick();
      ast.visit(this, context);
    }
    override visitPropertyRead(ast: any, context?: any): void {
      if (isMember(ast))
        record(ast, ast === this.writeRoot ? "TemplatePropertyWrite" : "TemplatePropertyRead");
      super.visitPropertyRead(ast, context);
    }
    override visitCall(ast: any, context?: any): void {
      if (!isMember(ast.receiver)) return super.visitCall(ast, context);
      record(ast.receiver, "TemplateCall");
      ast.args.forEach((arg: any) => this.visit(arg, context));
    }
    visitSafeCall(ast: any, context?: any): void {
      this.visitCall(ast, context);
    }
    override visitBinary(ast: any, context?: any): void {
      if (!ASSIGNMENT_OPERATION.test(ast.operation) || !isMember(ast.left)) {
        return super.visitBinary(ast, context);
      }
      record(ast.left, "TemplatePropertyWrite");
      this.visit(ast.right, context);
    }
    visitPropertyWrite(ast: any, context?: any): void {
      if (ast.name === memberName && isMemberReceiver(ast.receiver)) {
        record(ast, "TemplatePropertyWrite");
      }
      this.visit(ast.receiver, context);
      this.visit(ast.value, context);
    }
    visitArrowFunction(ast: any, context?: any): void {
      scopes.push(new Set(ast.parameters.map((parameter: any) => parameter.name)));
      this.visit(ast.body, context);
      scopes.pop();
    }
  }
  const expressions = new Expressions();

  // References belong to the view that declares them and are visible before the declaration.
  class References extends (compiler.TmplAstRecursiveVisitor as new () => object) {
    names: string[] = [];
    visitReference(reference: any): void {
      this.names.push(reference.name);
    }
    visitTemplate(template: any): void {
      template.references.forEach((reference: any) => this.visitReference(reference));
    }
    visitIfBlock = (): void => {};
    visitForLoopBlock = (): void => {};
    visitSwitchBlock = (): void => {};
    visitDeferredBlock = (): void => {};
  }
  const referencesOf = (children: any[]): string[] => {
    const collector = new References();
    compiler.tmplAstVisitAll(collector, children);
    return collector.names;
  };

  class Templates extends (compiler.TmplAstRecursiveVisitor as new () => object) {
    visit(node: any): void {
      tick();
      node.visit(this);
    }
    view(locals: (string | undefined)[], children: any[], before?: () => void): void {
      const names = [...locals, ...referencesOf(children)].filter((name): name is string => !!name);
      scopes.push(new Set(names));
      before?.();
      compiler.tmplAstVisitAll(this, children);
      scopes.pop();
    }
    expression(value: any, writeRoot?: unknown): void {
      if (!value?.ast) return;
      expressions.writeRoot = writeRoot && value.ast;
      expressions.visit(value.ast);
      expressions.writeRoot = undefined;
    }
    visitBoundText(text: any): void {
      this.expression(text.value);
    }
    visitBoundAttribute(attribute: any): void {
      this.expression(attribute.value, attribute.type === TWO_WAY_BINDING);
    }
    visitBoundEvent(event: any): void {
      if (event.type === TWO_WAY_EVENT) return; // covered by the paired two-way input
      scopes.push(new Set(["$event"]));
      this.expression(event.handler);
      scopes.pop();
    }
    visitTemplate(template: any): void {
      for (const list of [
        template.templateAttrs,
        template.inputs,
        template.outputs,
        template.directives,
      ]) {
        compiler.tmplAstVisitAll(this, list ?? []);
      }
      this.view(
        template.variables.map((variable: any) => variable.name),
        template.children,
      );
    }
    visitIfBlockBranch(branch: any): void {
      this.expression(branch.expression);
      this.view([branch.expressionAlias?.name], branch.children);
    }
    visitForLoopBlock(block: any): void {
      this.expression(block.expression);
      const locals = [
        block.item.name,
        ...block.contextVariables.map((variable: any) => variable.name),
      ];
      this.view(locals, block.children, () => this.expression(block.trackBy));
      if (block.empty) this.visit(block.empty);
    }
    visitForLoopBlockEmpty(block: any): void {
      this.view([], block.children);
    }
    visitSwitchBlock(block: any): void {
      this.expression(block.expression);
      const groups =
        block.groups ?? block.cases.map((c: any) => ({ cases: [c], children: c.children }));
      for (const group of groups) {
        group.cases.forEach((c: any) => this.expression(c.expression));
        this.view([], group.children);
      }
    }
    visitDeferredBlock(block: any): void {
      for (const triggers of [block.triggers, block.prefetchTriggers, block.hydrateTriggers]) {
        Object.values(triggers ?? {}).forEach((trigger: any) => this.expression(trigger?.value));
      }
      this.view([], block.children);
      [block.placeholder, block.loading, block.error].forEach((sub) => sub && this.visit(sub));
    }
    visitDeferredBlockPlaceholder(block: any): void {
      this.view([], block.children);
    }
    visitDeferredBlockLoading(block: any): void {
      this.view([], block.children);
    }
    visitDeferredBlockError(block: any): void {
      this.view([], block.children);
    }
    visitLetDeclaration(declaration: any): void {
      this.expression(declaration.value);
      scopes[scopes.length - 1]?.add(declaration.name);
    }
    visitIcu(icu: any): void {
      [...Object.values(icu.vars ?? {}), ...Object.values(icu.placeholders ?? {})].forEach(
        (text: any) => this.expression(text.value),
      );
    }
  }
  new Templates().view([], nodes);
  return [...usages.values()].sort((left, right) => left.start - right.start);
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: offset - lineStart + 1 };
}

function decodeTemplate(bytes: Buffer): string | undefined {
  try {
    const utf16 =
      (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
    return utf16 ? undefined : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Collects usages of a component member inside its declaring component's template. */
export async function collectTemplateUsages(
  node: Node,
  context: ProjectContext,
  rc: RequestContext,
): Promise<{ coverage: TemplateCoverage; usages: readonly TemplateUsage[] }> {
  rc.checkpoint();
  if (!hasAngularCore(context)) return NOT_APPLICABLE;
  const fail = (status: "unfinished" | "unsupported", reason: TemplateCoverageReason) => ({
    coverage: { status, reason, templates: 0 } as TemplateCoverage,
    usages: [] as readonly TemplateUsage[],
  });
  if (Node.isClassDeclaration(node)) {
    return isPipeClass(node) ? fail("unfinished", "cross_component") : NOT_APPLICABLE;
  }
  const owner = memberOwner(node);
  if (!owner) return NOT_APPLICABLE;
  if (isPipeClass(owner.cls)) return fail("unfinished", "cross_component");
  const isComponent = componentDecorator(owner.cls) !== undefined;
  const selectorPublic = isSelectorPublic(node) || isMetadataPublic(owner.cls, owner.name);
  if (!isComponent && selectorPublic && isDirectiveClass(owner.cls)) {
    return fail("unfinished", "cross_component");
  }
  const derived = hasDerivedComponent(context, owner.cls);
  if (!isComponent && !derived) return NOT_APPLICABLE;
  if (derived) return fail("unsupported", "inherited_member");

  const loaded = await loadCompiler(context.tsConfigFilePath);
  if ("reason" in loaded) return fail("unfinished", loaded.reason);
  const located = locateTemplate(owner.cls);
  if ("reason" in located) return fail("unfinished", located.reason);

  let text: string;
  let offset = 0;
  let bytes: Buffer;
  if (located.container === "inline") {
    ({ text, offset } = located);
    bytes = Buffer.from(text, "utf8");
  } else {
    const unsafe = checkTemplatePath(context.projectRoot, located.absolutePath);
    if (unsafe) return fail("unfinished", unsafe);
    if ((await stat(located.absolutePath)).size > MAX_TEMPLATE_BYTES) {
      return fail("unfinished", "size_exceeded");
    }
    bytes = await readFile(located.absolutePath);
    const decoded = decodeTemplate(bytes);
    if (decoded === undefined) return fail("unfinished", "template_parse_error");
    text = decoded;
  }

  // Shared cap: the external path also checks the size before reading, inline checks here.
  if (bytes.length > MAX_TEMPLATE_BYTES) return fail("unfinished", "size_exceeded");
  rc.checkpoint();
  const parsed = loaded.compiler.parseTemplate(text, located.absolutePath, {
    preserveWhitespaces: true,
  });
  if (parsed.errors?.length) return fail("unfinished", "template_parse_error");
  let raw: RawUsage[];
  try {
    raw = extractUsages(loaded.compiler, parsed.nodes, owner.name, rc);
  } catch (error) {
    if (error instanceof WorkExhausted) return fail("unfinished", "work_exhausted");
    throw error;
  }

  const fileText = located.container === "inline" ? owner.cls.getSourceFile().getFullText() : text;
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const usages = raw.map((usage): TemplateUsage => {
    const start = usage.start + offset;
    return {
      absolutePath: located.absolutePath,
      file: path.relative(context.projectRoot, located.absolutePath),
      container: located.container,
      start,
      end: usage.end + offset,
      ...lineColumn(fileText, start),
      kind: usage.kind,
      localsInScope: usage.localsInScope,
      fileHash,
    };
  });
  // Selector-public members are also bound in consuming templates, which are never read.
  const coverage: TemplateCoverage = selectorPublic
    ? { status: "unfinished", reason: "cross_component", templates: 1 }
    : { status: "completed", templates: 1 };
  return { coverage, usages };
}
