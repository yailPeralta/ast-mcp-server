import path from "node:path";
import { Node } from "ts-morph";
import { paginate, type Page } from "./pagination.js";

export type ReferenceDetail = "locations" | "context";

export interface SymbolReference {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly kind: string;
  readonly is_declaration: boolean;
  readonly context?: string;
}

export interface SymbolReferences extends Omit<Page<SymbolReference>, "items"> {
  readonly symbol: string;
  readonly include_declaration: boolean;
  readonly declaration_count: number;
  readonly reference_count: number;
  readonly affected_files: readonly string[];
  readonly references: readonly SymbolReference[];
}

export function collectSymbolReferences(
  node: Node,
  projectRoot: string,
  symbolPath: string,
  includeDeclaration: boolean,
  detail: ReferenceDetail,
  offset: number,
  limit: number,
): SymbolReferences {
  if (!Node.isReferenceFindable(node)) {
    throw new Error(
      `Symbol "${symbolPath}" (${node.getKindName()}) does not support semantic reference search.`,
    );
  }

  const lineCache = new Map<string, string[]>();
  const location = (referenceNode: Node, isDeclaration: boolean): SymbolReference => {
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

  const references = node.findReferencesAsNodes().map((reference) => location(reference, false));
  const declaration = location(node, true);
  const allLocations = includeDeclaration ? [declaration, ...references] : references;
  allLocations.sort((left, right) =>
    `${left.file}:${left.line}:${left.column}:${left.is_declaration ? 0 : 1}`.localeCompare(
      `${right.file}:${right.line}:${right.column}:${right.is_declaration ? 0 : 1}`,
    ),
  );
  const affectedFiles = [...new Set([declaration, ...references].map((item) => item.file))].sort();
  const page = paginate(allLocations, offset, limit);

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
