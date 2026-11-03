import { readFile } from "node:fs/promises";
import path from "node:path";
import { Node } from "ts-morph";
import {
  collectTemplateUsages,
  type TemplateCoverage,
  type TemplateUsage,
} from "./angular-templates.js";
import { paginate, type Page } from "./pagination.js";
import type { ProjectContext } from "./project.js";
import { NO_REQUEST_CONTEXT, type RequestContext } from "./request-context.js";

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
  const references = node.findReferencesAsNodes().map((reference) => location(reference, false));
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
  const { projectRoot } = context;
  const { coverage, usages } = await collectTemplateUsages(node, context, requestContext);
  if (coverage.status === "not_applicable") {
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
  const lineCache = new Map<string, Promise<string[]>>();
  const templateItems: SymbolReference[] = [];
  for (const usage of usages) {
    requestContext.checkpoint();
    templateItems.push(await templateLocation(usage, query.detail, lineCache));
  }
  const merged = [
    ...ts.locations.map((item): SymbolReference => ({ ...item, origin: "compiler" })),
    ...templateItems,
  ].sort(compareLocations);
  const affectedFiles = [
    ...new Set([ts.declaration, ...ts.references, ...templateItems].map((item) => item.file)),
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
    template_coverage: coverage,
    template_reference_count: templateItems.length,
  };
}
