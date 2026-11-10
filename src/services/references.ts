import { readFile } from "node:fs/promises";
import path from "node:path";
import { Node } from "ts-morph";
import {
  collectTemplateUsages,
  type TemplateCoverage,
  type TemplateScanCache,
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
  readonly references: readonly SymbolReference[];
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
  const references = findNonDeclarationReferences(node).map((reference) =>
    location(reference, false),
  );
  const declaration = location(node, true);
  return {
    declaration,
    references,
    locations: includeDeclaration ? [declaration, ...references] : [...references],
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
  const { declaration, references, locations } = collectTsLocations(
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
  lineCache: Map<string, Promise<string[]>>,
): Promise<SymbolReference> {
  let context: string | undefined;
  if (detail === "context") {
    let lines = lineCache.get(usage.absolutePath);
    if (!lines) {
      lines = readFile(usage.absolutePath, "utf8").then((text) => text.split(/\r?\n/));
      lineCache.set(usage.absolutePath, lines);
    }
    context = ((await lines)[usage.line - 1] ?? "").trim().slice(0, 500);
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
  templateCache?: TemplateScanCache,
): Promise<TemplateHalf> {
  const { coverage, usages } = await collectTemplateUsages(
    node,
    context,
    requestContext,
    undefined,
    templateCache,
  );
  const lineCache = new Map<string, Promise<string[]>>();
  const items: SymbolReference[] = [];
  for (const usage of usages) {
    requestContext.checkpoint();
    items.push(await templateLocation(usage, detail, lineCache));
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
