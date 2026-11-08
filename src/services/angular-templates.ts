import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Node, SyntaxKind, type ClassDeclaration } from "ts-morph";
import {
  angularCoreMajor,
  componentDecorator,
  isCoreDecorator,
  isDirectiveClass,
  isMetadataPublic,
  isPipeClass,
  isSelectorPublic,
  literalString,
  bindingNames,
  metadataBindingNames,
} from "./angular-decorators.js";
import {
  extractConsumerUsages,
  mayMatch,
  type BindingTarget,
  type ConsumerBinding,
  type SelectorCompiler,
} from "./angular-template-bindings.js";
import {
  createScopeResolver,
  MAX_SCOPE_VISITS,
  ScopeWorkExhausted,
} from "./angular-template-scope.js";
import {
  isSupportedVersion,
  isUnderAncestorNodeModules,
  isWithin,
  resolveFrom,
} from "./angular-package-resolution.js";
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
  readonly kind: string;
  readonly localsInScope: readonly string[];
  readonly fileHash: string;
  readonly role: "own" | "consumer";
  readonly binding?: ConsumerBinding;
  readonly bindingName?: string;
  /** Consumer usages only: whether a directive selector also matches the element of the binding. */
  readonly elementMatches?: (selector: string) => boolean;
}
export interface ScanLimits {
  readonly templates: number;
  readonly bytes: number;
  readonly nodes: number;
}

const MAX_TEMPLATE_BYTES = 512 * 1024;
const MAX_TEMPLATE_NODES = 100_000;
const CHECKPOINT_EVERY_NODES = 1000;
const TWO_WAY_BINDING = 5; // BindingType.TwoWay, stable across supported majors
const TWO_WAY_EVENT = 2; // ParsedEventType.TwoWay, stable across supported majors
const SCAN_LIMITS: ScanLimits = { templates: 2000, bytes: 32 * 1024 * 1024, nodes: 1_000_000 };
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
  | { readonly compiler: CompilerModule; readonly selectors: boolean }
  | { readonly reason: "compiler_missing" | "compiler_unsupported" };

const compilerCache = new Map<string, Promise<CompilerModule>>();

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
    const selectors = [
      compiler.CssSelector?.parse,
      compiler.SelectorMatcher,
      compiler.createCssSelectorFromNode,
    ].every((member) => typeof member === "function");
    return complete ? { compiler, selectors } : unsupported;
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

export function memberOwner(node: Node): { cls: ClassDeclaration; name: string } | undefined {
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
/** A pipe name span that does not slice to the name: the usage cannot be edited exactly. */
class SpanDrift extends Error {}
/** A usage query: a component member, or a pipe by its literal `name` (the template text checks spans). */
type UsageQuery = { readonly member: string } | { readonly pipe: string; readonly text: string };
type RawUsage = Pick<TemplateUsage, "start" | "end" | "kind" | "localsInScope" | "role"> &
  Partial<Pick<TemplateUsage, "binding" | "bindingName" | "elementMatches">>;

/** Walks parsed template nodes with a scope stack so template-local names shadow members. */
function extractUsages(
  compiler: CompilerModule,
  nodes: any[],
  query: UsageQuery,
  rc: RequestContext,
  onNode: () => void = () => {},
): RawUsage[] {
  const memberName = "member" in query ? query.member : undefined;
  const usages = new Map<string, RawUsage>();
  const scopes: Set<string>[] = [];
  let visited = 0;
  const tick = (): void => {
    if (++visited > MAX_TEMPLATE_NODES) throw new WorkExhausted();
    if (visited % CHECKPOINT_EVERY_NODES === 0) rc.checkpoint();
    onNode();
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
      role: "own",
      localsInScope: [...new Set(scopes.flatMap((scope) => [...scope]))].sort(),
    });
  };
  // Explicit `this.` bypasses template locals; ThisReceiver only extends ImplicitReceiver in some majors.
  const isMemberReceiver = (receiver: any): boolean =>
    receiver instanceof compiler.ThisReceiver ||
    (receiver instanceof compiler.ImplicitReceiver && !isLocal(memberName!));
  const isMember = (ast: any): boolean =>
    memberName !== undefined &&
    ast instanceof compiler.PropertyRead &&
    ast.name === memberName &&
    isMemberReceiver(ast.receiver);

  class Expressions extends (compiler.RecursiveAstVisitor as new () => {
    visitPropertyRead(ast: any, context?: any): void;
    visitCall(ast: any, context?: any): void;
    visitBinary(ast: any, context?: any): void;
    visitPipe(ast: any, context?: any): void;
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
    override visitPipe(ast: any, context?: any): void {
      if ("pipe" in query && ast.name === query.pipe) {
        if (query.text.slice(ast.nameSpan.start, ast.nameSpan.end) !== query.pipe) {
          throw new SpanDrift();
        }
        record(ast, "TemplatePipeName");
      }
      super.visitPipe(ast, context);
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
    // v18/v19 `tmplAstVisitAll` runs `visitor.visit(node) || node.visit(visitor)`; returning
    // true marks the node handled so each subtree is walked once instead of twice per level.
    visit(node: any): true {
      tick();
      node.visit(this);
      return true;
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

interface TemplateRead {
  readonly text: string;
  readonly bytes: Buffer;
  readonly offset: number;
}

/** Reads a located template within the per-template size cap. */
async function readTemplate(
  context: ProjectContext,
  located: Exclude<Located, { reason: TemplateCoverageReason }>,
): Promise<TemplateRead | { readonly reason: TemplateCoverageReason }> {
  let text: string;
  let bytes: Buffer;
  if (located.container === "inline") {
    text = located.text;
    bytes = Buffer.from(text, "utf8");
  } else {
    const unsafe = checkTemplatePath(context.projectRoot, located.absolutePath);
    if (unsafe) return { reason: unsafe };
    if ((await stat(located.absolutePath)).size > MAX_TEMPLATE_BYTES) {
      return { reason: "size_exceeded" };
    }
    bytes = await readFile(located.absolutePath);
    const decoded = decodeTemplate(bytes);
    if (decoded === undefined) return { reason: "template_parse_error" };
    text = decoded;
  }
  // Shared cap: the external path also checks the size before reading, inline checks here.
  if (bytes.length > MAX_TEMPLATE_BYTES) return { reason: "size_exceeded" };
  return { text, bytes, offset: located.container === "inline" ? located.offset : 0 };
}

function toUsages(
  context: ProjectContext,
  cls: ClassDeclaration,
  located: Exclude<Located, { reason: TemplateCoverageReason }>,
  read: TemplateRead,
  raw: readonly RawUsage[],
): TemplateUsage[] {
  const fileText = located.container === "inline" ? cls.getSourceFile().getFullText() : read.text;
  const fileHash = createHash("sha256").update(read.bytes).digest("hex");
  return raw.map((usage): TemplateUsage => {
    const start = usage.start + read.offset;
    return {
      ...usage,
      absolutePath: located.absolutePath,
      file: path.relative(context.projectRoot, located.absolutePath),
      container: located.container,
      start,
      end: usage.end + read.offset,
      ...lineColumn(fileText, start),
      fileHash,
    };
  });
}

/** Selector and public binding names, or undefined when bindings cannot be named from the member. */
function bindingTarget(cls: ClassDeclaration, node: Node, name: string): BindingTarget | undefined {
  const metadata = componentDecorator(cls)?.getArguments()[0];
  if (!Node.isObjectLiteralExpression(metadata) || metadata.getProperty("hostDirectives")) {
    return undefined;
  }
  const property = metadata.getProperty("selector");
  const selector = literalString(
    Node.isPropertyAssignment(property) ? property.getInitializer() : undefined,
  );
  const names = isMetadataPublic(cls, name)
    ? // A member both decorated and listed in metadata has ambiguous binding names.
      isSelectorPublic(node)
      ? undefined
      : metadataBindingNames(cls, name)
    : bindingNames(node, name);
  if (!selector || !names) return undefined;
  return { selector, inputs: names.inputs, outputs: names.outputs };
}

/** What a consumer template holds for the target: nothing to look at, or the usages found. */
type Inspection =
  | "skip"
  | { readonly matched: boolean; readonly opaque: boolean; readonly usages: readonly RawUsage[] };
type Inspector = (
  text: string,
  absolutePath: string,
  tick: () => void,
) => Inspection | "template_parse_error";

/** Parses a consumer template, or returns undefined when the compiler reports errors. */
function parseConsumer(compiler: CompilerModule, text: string, absolutePath: string) {
  const parsed = compiler.parseTemplate(text, absolutePath, { preserveWhitespaces: true });
  return parsed.errors?.length ? undefined : parsed.nodes;
}

function selectorInspector(compiler: SelectorCompiler, target: BindingTarget): Inspector {
  return (text, absolutePath, tick) => {
    if (!mayMatch(compiler, target.selector, text)) return "skip";
    const nodes = parseConsumer(compiler, text, absolutePath);
    if (!nodes) return "template_parse_error";
    const scan = extractConsumerUsages(compiler, nodes, text, target, tick);
    const usages = scan.usages.map((usage): RawUsage => ({
      ...usage,
      localsInScope: [],
      role: "consumer",
    }));
    return { matched: scan.matched, opaque: scan.opaque, usages };
  };
}

function pipeInspector(compiler: CompilerModule, name: string, rc: RequestContext): Inspector {
  return (text, absolutePath, tick) => {
    if (!text.includes(name)) return "skip";
    const nodes = parseConsumer(compiler, text, absolutePath);
    if (!nodes) return "template_parse_error";
    try {
      const raw = extractUsages(compiler, nodes, { pipe: name, text }, rc, tick);
      const usages = raw.map((usage): RawUsage => ({ ...usage, role: "consumer" }));
      return { matched: usages.length > 0, opaque: false, usages };
    } catch (error) {
      if (error instanceof SpanDrift) return { matched: true, opaque: true, usages: [] };
      throw error;
    }
  };
}

/**
 * Scans every component template in the Project with `inspect`. Matching comes first; scope only
 * filters matches. Unreadable templates and unproven scopes are reported.
 */
async function scanConsumers(
  context: ProjectContext,
  cls: ClassDeclaration,
  inspect: Inspector,
  rc: RequestContext,
  limits: Partial<ScanLimits>,
): Promise<{ usages: TemplateUsage[]; failure?: TemplateCoverageReason; examined: number }> {
  const remaining = { ...SCAN_LIMITS, ...limits };
  const usages: TemplateUsage[] = [];
  let failure: TemplateCoverageReason | undefined;
  let examined = 0;
  const resolve = createScopeResolver(cls, {
    coreMajor: angularCoreMajor(context),
    budget: { scopeVisits: MAX_SCOPE_VISITS },
    rc,
  });
  const tick = (): void => {
    if (--remaining.nodes < 0) throw new WorkExhausted();
    if (remaining.nodes % CHECKPOINT_EVERY_NODES === 0) rc.checkpoint();
  };
  try {
    for (const consumer of componentClasses(context)) {
      rc.checkpoint();
      if (--remaining.templates < 0) throw new WorkExhausted();
      const located = locateTemplate(consumer);
      if ("reason" in located) {
        failure ??= located.reason;
        continue;
      }
      const read = await readTemplate(context, located);
      if ("reason" in read) {
        failure ??= read.reason;
        continue;
      }
      remaining.bytes -= read.bytes.length;
      if (remaining.bytes < 0) throw new WorkExhausted();
      examined += 1;
      const scan = inspect(read.text, located.absolutePath, tick);
      if (scan === "skip") continue;
      if (scan === "template_parse_error") {
        failure ??= scan;
        continue;
      }
      if (scan.opaque) failure ??= "cross_component";
      if (!scan.matched) continue;
      const verdict = resolve(consumer);
      if (verdict === "opaque") failure ??= "cross_component";
      if (verdict === "includes") {
        usages.push(...toUsages(context, consumer, located, read, scan.usages));
      }
    }
  } catch (error) {
    if (error instanceof WorkExhausted || error instanceof ScopeWorkExhausted) {
      return { usages: [], failure: "work_exhausted", examined };
    }
    throw error;
  }
  return { usages, failure, examined };
}

/** The literal `name` of a `@Pipe({ name })` class, or undefined when it is not a plain literal. */
function pipeName(cls: ClassDeclaration): string | undefined {
  const decorator = cls.getDecorators().find((candidate) => isCoreDecorator(candidate, "Pipe"));
  const metadata = decorator?.getArguments()[0];
  if (!Node.isObjectLiteralExpression(metadata)) return undefined;
  const property = metadata.getProperty("name");
  return literalString(Node.isPropertyAssignment(property) ? property.getInitializer() : undefined);
}

/** `| name` usages of a pipe class in the templates of components that have the class in scope. */
async function collectPipeUsages(
  cls: ClassDeclaration,
  context: ProjectContext,
  rc: RequestContext,
  limits: Partial<ScanLimits>,
) {
  const unfinished = (reason: TemplateCoverageReason, templates = 0) => ({
    coverage: { status: "unfinished", reason, templates } as TemplateCoverage,
    usages: [] as readonly TemplateUsage[],
  });
  const name = pipeName(cls);
  if (name === undefined) return unfinished("cross_component");
  const loaded = await loadCompiler(context.tsConfigFilePath);
  if ("reason" in loaded) return unfinished(loaded.reason);
  const scan = await scanConsumers(
    context,
    cls,
    pipeInspector(loaded.compiler, name, rc),
    rc,
    limits,
  );
  const coverage: TemplateCoverage = scan.failure
    ? { status: "unfinished", reason: scan.failure, templates: scan.examined }
    : { status: "completed", templates: scan.examined };
  return { coverage, usages: scan.usages };
}

/** Collects usages of a component member inside its declaring component's template. */
export async function collectTemplateUsages(
  node: Node,
  context: ProjectContext,
  rc: RequestContext,
  limits: Partial<ScanLimits> = {},
): Promise<{
  coverage: TemplateCoverage;
  usages: readonly TemplateUsage[];
  /** Rename must stay refused even though coverage is complete (a pipe `transform`, a metadata-listed name). */
  renameBlocked?: boolean;
}> {
  rc.checkpoint();
  if (!hasAngularCore(context)) return NOT_APPLICABLE;
  const fail = (status: "unfinished" | "unsupported", reason: TemplateCoverageReason) => ({
    coverage: { status, reason, templates: 0 } as TemplateCoverage,
    usages: [] as readonly TemplateUsage[],
  });
  if (Node.isClassDeclaration(node)) {
    return isPipeClass(node) ? collectPipeUsages(node, context, rc, limits) : NOT_APPLICABLE;
  }
  const owner = memberOwner(node);
  if (!owner) return NOT_APPLICABLE;
  if (isPipeClass(owner.cls)) {
    // Only `transform` is the pipe contract: it reports the pipe's usages but a rename stays refused.
    if (owner.name !== "transform" || componentDecorator(owner.cls)) {
      return fail("unfinished", "cross_component");
    }
    return { ...(await collectPipeUsages(owner.cls, context, rc, limits)), renameBlocked: true };
  }
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
  const read = await readTemplate(context, located);
  if ("reason" in read) return fail("unfinished", read.reason);

  rc.checkpoint();
  const parsed = loaded.compiler.parseTemplate(read.text, located.absolutePath, {
    preserveWhitespaces: true,
  });
  if (parsed.errors?.length) return fail("unfinished", "template_parse_error");
  let raw: RawUsage[];
  try {
    raw = extractUsages(loaded.compiler, parsed.nodes, { member: owner.name }, rc);
  } catch (error) {
    if (error instanceof WorkExhausted) return fail("unfinished", "work_exhausted");
    throw error;
  }

  const usages = toUsages(context, owner.cls, located, read, raw);
  if (!selectorPublic) return { coverage: { status: "completed", templates: 1 }, usages };
  // Selector-public members are also bound in consuming templates: scan every component template.
  const target = bindingTarget(owner.cls, node, owner.name);
  const unfinished = (reason: TemplateCoverageReason, templates = 1) => ({
    coverage: { status: "unfinished", reason, templates } as TemplateCoverage,
    usages,
  });
  if (!target) return unfinished("cross_component");
  if (!loaded.selectors) return unfinished("compiler_unsupported");
  const scan = await scanConsumers(
    context,
    owner.cls,
    selectorInspector(loaded.compiler as SelectorCompiler, target),
    rc,
    limits,
  );
  const coverage: TemplateCoverage = scan.failure
    ? { status: "unfinished", reason: scan.failure, templates: scan.examined }
    : { status: "completed", templates: scan.examined };
  // Names listed in `inputs` / `outputs` metadata are strings that a TypeScript rename cannot follow.
  const renameBlocked = isMetadataPublic(owner.cls, owner.name);
  return { coverage, usages: [...usages, ...scan.usages], renameBlocked };
}
