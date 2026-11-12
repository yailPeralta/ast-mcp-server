import path from "node:path";
import {
  type ClassDeclaration,
  type ClassExpression,
  type InterfaceDeclaration,
  Node,
  type SourceFile,
  type Type,
} from "ts-morph";
import {
  collectTemplateUsages,
  type TemplateCoverage,
  TemplateScanCache,
  type TemplateUsage,
} from "./angular-templates.js";
import { paginate, type Page } from "./pagination.js";
import type { ProjectContext } from "./project.js";
import {
  isCooperativeInterruption,
  NO_REQUEST_CONTEXT,
  type RequestContext,
} from "./request-context.js";

export type ReferenceDetail = "locations" | "context";

export type ReferenceOrigin = "compiler" | "template_external" | "template_inline";

export interface SymbolReference {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly kind: string;
  readonly is_declaration: boolean;
  readonly context?: string;
  /** Present only in responses that carry template coverage. */
  readonly origin?: ReferenceOrigin;
}

export interface SymbolReferences extends Omit<Page<SymbolReference>, "items"> {
  readonly symbol: string;
  readonly include_declaration: boolean;
  readonly declaration_count: number;
  readonly reference_count: number;
  readonly affected_files: readonly string[];
  /** Present only when at least one location was left out of the list and the counts. */
  readonly omitted_references?: OmittedReferences;
  readonly references: readonly SymbolReference[];
}

/** Locations the compiler groups with the symbol that are not listed as its references. */
export interface OmittedReferences {
  /** Locations in external-library files. */
  readonly external_library: number;
  /** Declarations of the same member in a supertype or in an unrelated implementer. */
  readonly unrelated_declarations: number;
  /** Property accesses on a receiver whose type cannot reach the requested member. */
  readonly unrelated_usages: number;
}

export interface SymbolReferencesWithTemplates extends SymbolReferences {
  readonly template_coverage?: TemplateCoverage;
  readonly template_reference_count?: number;
}

export interface TemplateReferenceQuery {
  readonly symbolPath: string;
  readonly includeDeclaration: boolean;
  readonly detail: ReferenceDetail;
  readonly offset: number;
  readonly limit: number;
}

interface TsLocations {
  readonly declaration: SymbolReference;
  readonly references: readonly SymbolReference[];
  /** Declaration (when requested) plus references, in discovery order. */
  readonly locations: SymbolReference[];
  readonly omitted: OmittedReferences | undefined;
}

/**
 * Semantic references of `node` excluding the declaration itself.
 *
 * ts-morph only skips the first definition entry per referenced symbol; when a usage
 * precedes the declaration in source order the declaration identifier is returned again
 * as an ordinary reference. Drop any node at the declaration's position (the declaration
 * node or its name identifier) so the declaration is reported exactly once.
 */
export function findNonDeclarationReferences(
  node: Node & { findReferencesAsNodes(): Node[] },
): Node[] {
  const declarationNodes = Node.hasName(node) ? [node, node.getNameNode()] : [node];
  const isDeclaration = (reference: Node) =>
    declarationNodes.some(
      (declaration) =>
        declaration.getSourceFile().getFilePath() === reference.getSourceFile().getFilePath() &&
        declaration.getStart() === reference.getStart(),
    );
  return node.findReferencesAsNodes().filter((reference) => !isDeclaration(reference));
}

type MemberOwner = ClassDeclaration | ClassExpression | InterfaceDeclaration;

/** Upper bound of types visited while walking the heritage of one declaration. */
const MAX_HERITAGE_TYPES = 256;

function isExternal(sourceFile: SourceFile): boolean {
  return sourceFile.isInNodeModules() || sourceFile.isFromExternalLibrary();
}

function isMemberOwner(node: Node | undefined): node is MemberOwner {
  return (
    Node.isClassDeclaration(node) ||
    Node.isClassExpression(node) ||
    Node.isInterfaceDeclaration(node)
  );
}

/** The class or interface that declares `node`, when `node` is one of its named members. */
function memberOwner(node: Node): MemberOwner | undefined {
  const isMember =
    Node.isMethodDeclaration(node) ||
    Node.isPropertyDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isMethodSignature(node) ||
    Node.isPropertySignature(node);
  const parent = node.getParent();
  return isMember && isMemberOwner(parent) ? parent : undefined;
}

/** Every declaration of the type `owner` declares; merged declarations share one symbol. */
function declarationsOf(owner: Node): Node[] {
  return owner.getSymbol()?.getDeclarations() ?? [owner];
}

/** Declarations named by the `extends` and `implements` clauses of `declaration`. */
function directSupertypes(declaration: MemberOwner): Node[] {
  if (Node.isInterfaceDeclaration(declaration)) return declaration.getBaseDeclarations();
  const implemented = declaration
    .getImplements()
    .flatMap((clause) => clause.getType().getSymbol()?.getDeclarations() ?? []);
  const baseClass = declaration.getBaseClass();
  return baseClass ? [baseClass, ...implemented] : implemented;
}

/**
 * Whether `candidate` is `owner` or names it, directly or transitively, in its heritage clauses.
 * The check is nominal on purpose: two unrelated types with the same shape are not related.
 * A heritage chain longer than the bound counts as related, so its declaration stays listed.
 */
function isSameOrSubtype(candidate: MemberOwner, owner: ReadonlySet<Node>): boolean {
  const visited = new Set<Node>();
  const pending: Node[] = [candidate];
  for (let current = pending.pop(); current; current = pending.pop()) {
    for (const declaration of declarationsOf(current)) {
      if (owner.has(declaration)) return true;
      if (visited.has(declaration) || !isMemberOwner(declaration)) continue;
      if (visited.size >= MAX_HERITAGE_TYPES) return true;
      visited.add(declaration);
      pending.push(...directSupertypes(declaration));
    }
  }
  return false;
}

/**
 * Whether `reference` names the same member declared in a type that neither is the requested
 * owner nor derives from it: the contract the requested member implements, or a sibling
 * implementation of that contract.
 */
function isUnrelatedMemberDeclaration(reference: Node, owner: ReadonlySet<Node>): boolean {
  const member = reference.getParent();
  if (!member || !Node.hasName(member) || member.getNameNode() !== reference) return false;
  const declaringType = memberOwner(member);
  return declaringType !== undefined && !isSameOrSubtype(declaringType, owner);
}

/**
 * The class and interface declarations a receiver type names, or `undefined` when any part of it
 * resolves to something else (any, a type parameter without a constraint, a mapped or literal
 * object type, a primitive): such a receiver is never used to omit a usage.
 */
function receiverOwners(type: Type): MemberOwner[][] | undefined {
  const present = type.getNonNullableType();
  // Both getters return an empty list for a type of another kind.
  const parts = [...present.getUnionTypes(), ...present.getIntersectionTypes()];
  if (parts.length > 0) {
    const owners: MemberOwner[][] = [];
    for (const part of parts) {
      const resolved = receiverOwners(part);
      if (!resolved) return undefined;
      owners.push(...resolved);
    }
    return owners;
  }
  if (present.isTypeParameter()) {
    const constraint = present.getConstraint();
    return constraint ? receiverOwners(constraint) : undefined;
  }
  const declarations = present.getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(isMemberOwner) ? [declarations] : undefined;
}

/**
 * Whether `reference` is a property access on a receiver that cannot hold the requested member:
 * every type the receiver names is neither the owner, a subtype of it, nor one of its supertypes.
 * A call through the contract or a base type can dispatch to the requested member, so it stays.
 */
function isUnrelatedUsage(
  reference: Node,
  requestedOwner: MemberOwner,
  owner: ReadonlySet<Node>,
): boolean {
  const access = reference.getParent();
  if (!Node.isPropertyAccessExpression(access) || access.getNameNode() !== reference) return false;
  const receiver = access.getExpression();
  if (Node.isThisExpression(receiver) || Node.isSuperExpression(receiver)) return false;
  const owners = receiverOwners(receiver.getType());
  if (!owners) return false;
  return owners.every(
    (declarations) =>
      !declarations.some((declaration) => isSameOrSubtype(declaration, owner)) &&
      !isSameOrSubtype(requestedOwner, new Set<Node>(declarations)),
  );
}

function collectTsLocations(
  node: Node,
  projectRoot: string,
  symbolPath: string,
  includeDeclaration: boolean,
  detail: ReferenceDetail,
  requestContext: RequestContext,
): TsLocations {
  requestContext.checkpoint();
  if (!Node.isReferenceFindable(node)) {
    throw new Error(
      `Symbol "${symbolPath}" (${node.getKindName()}) does not support semantic reference search.`,
    );
  }

  const lineCache = new Map<string, string[]>();
  const location = (referenceNode: Node, isDeclaration: boolean): SymbolReference => {
    requestContext.checkpoint();
    const referenceSource = referenceNode.getSourceFile();
    const absoluteFile = referenceSource.getFilePath();
    let lines = lineCache.get(absoluteFile);
    if (!lines) {
      lines = referenceSource.getFullText().split(/\r?\n/);
      lineCache.set(absoluteFile, lines);
    }
    const position = referenceSource.getLineAndColumnAtPos(referenceNode.getStart());
    return {
      file: path.relative(projectRoot, absoluteFile),
      line: position.line,
      column: position.column,
      kind: referenceNode.getParent()?.getKindName() ?? referenceNode.getKindName(),
      is_declaration: isDeclaration,
      ...(detail === "context"
        ? { context: (lines[position.line - 1] ?? "").trim().slice(0, 500) }
        : {}),
    };
  };

  requestContext.checkpoint();
  // A library symbol keeps its library locations; a project symbol never lists them.
  const omitExternal = !isExternal(node.getSourceFile());
  const requestedOwner = memberOwner(node);
  const owner = requestedOwner ? new Set(declarationsOf(requestedOwner)) : undefined;
  let externalLibrary = 0;
  let unrelatedDeclarations = 0;
  let unrelatedUsages = 0;
  const references: SymbolReference[] = [];
  for (const reference of findNonDeclarationReferences(node)) {
    requestContext.checkpoint();
    if (omitExternal && isExternal(reference.getSourceFile())) {
      externalLibrary += 1;
    } else if (owner && isUnrelatedMemberDeclaration(reference, owner)) {
      unrelatedDeclarations += 1;
    } else if (requestedOwner && owner && isUnrelatedUsage(reference, requestedOwner, owner)) {
      unrelatedUsages += 1;
    } else {
      references.push(location(reference, false));
    }
  }
  const declaration = location(node, true);
  return {
    declaration,
    references,
    locations: includeDeclaration ? [declaration, ...references] : [...references],
    omitted:
      externalLibrary + unrelatedDeclarations + unrelatedUsages > 0
        ? {
            external_library: externalLibrary,
            unrelated_declarations: unrelatedDeclarations,
            unrelated_usages: unrelatedUsages,
          }
        : undefined,
  };
}

function compareLocations(left: SymbolReference, right: SymbolReference): number {
  const key = (item: SymbolReference) =>
    `${item.file}:${item.line}:${item.column}:${item.is_declaration ? 0 : 1}`;
  return key(left).localeCompare(key(right));
}

export function collectSymbolReferences(
  node: Node,
  projectRoot: string,
  symbolPath: string,
  includeDeclaration: boolean,
  detail: ReferenceDetail,
  offset: number,
  limit: number,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): SymbolReferences {
  const { declaration, references, locations, omitted } = collectTsLocations(
    node,
    projectRoot,
    symbolPath,
    includeDeclaration,
    detail,
    requestContext,
  );
  requestContext.checkpoint();
  locations.sort(compareLocations);
  const affectedFiles = [...new Set([declaration, ...references].map((item) => item.file))].sort();
  const page = paginate(locations, offset, limit);

  requestContext.checkpoint();
  return {
    symbol: symbolPath,
    include_declaration: includeDeclaration,
    declaration_count: 1,
    reference_count: references.length,
    affected_files: affectedFiles,
    ...(omitted ? { omitted_references: omitted } : {}),
    references: page.items,
    offset: page.offset,
    limit: page.limit,
    total: page.total,
    has_more: page.has_more,
    next_offset: page.next_offset,
  };
}

async function templateLocation(
  usage: TemplateUsage,
  detail: ReferenceDetail,
  templateCache: TemplateScanCache,
): Promise<SymbolReference> {
  let context: string | undefined;
  if (detail === "context") {
    const lines = await templateCache.lines(usage.absolutePath);
    context = (lines[usage.line - 1] ?? "").trim().slice(0, 500);
  }
  return {
    file: usage.file,
    line: usage.line,
    column: usage.column,
    kind: usage.kind,
    is_declaration: false,
    origin: usage.container === "inline" ? "template_inline" : "template_external",
    ...(context === undefined ? {} : { context }),
  };
}

interface TemplateHalf {
  readonly coverage: TemplateCoverage;
  readonly items: readonly SymbolReference[];
}

/** Template usages of `node` as reference items, with the coverage verdict that qualifies them. */
async function collectTemplateHalf(
  node: Node,
  context: ProjectContext,
  detail: ReferenceDetail,
  requestContext: RequestContext,
  templateCache: TemplateScanCache = new TemplateScanCache(context),
): Promise<TemplateHalf> {
  const { coverage, usages } = await collectTemplateUsages(
    node,
    context,
    requestContext,
    undefined,
    templateCache,
  );
  const items: SymbolReference[] = [];
  for (const usage of usages) {
    requestContext.checkpoint();
    items.push(await templateLocation(usage, detail, templateCache));
  }
  return { coverage, items };
}

/** Merges the TypeScript references of `node` with an already collected template half. */
function mergeWithTemplateHalf(
  node: Node,
  projectRoot: string,
  query: TemplateReferenceQuery,
  template: TemplateHalf,
  requestContext: RequestContext,
): SymbolReferencesWithTemplates {
  if (template.coverage.status === "not_applicable") {
    return collectSymbolReferences(
      node,
      projectRoot,
      query.symbolPath,
      query.includeDeclaration,
      query.detail,
      query.offset,
      query.limit,
      requestContext,
    );
  }

  const ts = collectTsLocations(
    node,
    projectRoot,
    query.symbolPath,
    query.includeDeclaration,
    query.detail,
    requestContext,
  );
  const merged = [
    ...ts.locations.map((item): SymbolReference => ({ ...item, origin: "compiler" })),
    ...template.items,
  ].sort(compareLocations);
  const affectedFiles = [
    ...new Set([ts.declaration, ...ts.references, ...template.items].map((item) => item.file)),
  ].sort();
  const page = paginate(merged, query.offset, query.limit);

  requestContext.checkpoint();
  return {
    symbol: query.symbolPath,
    include_declaration: query.includeDeclaration,
    declaration_count: 1,
    reference_count: ts.references.length,
    affected_files: affectedFiles,
    ...(ts.omitted ? { omitted_references: ts.omitted } : {}),
    references: page.items,
    offset: page.offset,
    limit: page.limit,
    total: page.total,
    has_more: page.has_more,
    next_offset: page.next_offset,
    template_coverage: template.coverage,
    template_reference_count: template.items.length,
  };
}

/**
 * Collects TypeScript references and, for Angular component members, template usages.
 * Without Angular evidence the result is identical to {@link collectSymbolReferences}.
 */
export async function collectSymbolReferencesWithTemplates(
  node: Node,
  context: ProjectContext,
  query: TemplateReferenceQuery,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<SymbolReferencesWithTemplates> {
  const template = await collectTemplateHalf(node, context, query.detail, requestContext);
  return mergeWithTemplateHalf(node, context.projectRoot, query, template, requestContext);
}

/**
 * Same result as {@link collectSymbolReferencesWithTemplates}, but a failing template half is
 * reported as an `unfinished` / `template_unresolved` verdict next to the TypeScript references
 * instead of failing the call. TypeScript failures and cooperative interruptions still throw.
 *
 * A caller that collects several symbols in one request passes the same `templateCache` to each
 * call; it shares template reads between them and does not change any result.
 */
export async function collectSymbolReferencesWithTemplateVerdict(
  node: Node,
  context: ProjectContext,
  query: TemplateReferenceQuery,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
  templateCache?: TemplateScanCache,
): Promise<SymbolReferencesWithTemplates> {
  let template: TemplateHalf;
  try {
    template = await collectTemplateHalf(
      node,
      context,
      query.detail,
      requestContext,
      templateCache,
    );
  } catch (error) {
    if (isCooperativeInterruption(error)) throw error;
    template = {
      coverage: { status: "unfinished", reason: "template_unresolved", templates: 0 },
      items: [],
    };
  }
  return mergeWithTemplateHalf(node, context.projectRoot, query, template, requestContext);
}
