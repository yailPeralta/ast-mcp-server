import path from "node:path";
import { Node, ts, type Project, type ModuleDeclaration, type SourceFile } from "ts-morph";
import { buildFileOutline, declarationSignature } from "./outline.js";
import {
  isCooperativeInterruption,
  NO_REQUEST_CONTEXT,
  type RequestContext,
} from "./request-context.js";
import type { SourceRange } from "./read-contracts.js";
import type { Page } from "./pagination.js";
import { MAX_SYMBOL_INDEX_QUERY_CANDIDATES } from "./symbol-index-limits.js";
import { compareSymbolIndexText } from "./symbol-index-order.js";
import type {
  SymbolIndexStore,
  SymbolIndexSymbol,
  SymbolIndexSymbolMatch,
} from "./symbol-index.js";
import type { ProjectIdentity } from "./project-status.js";

export interface LocatedSymbol {
  node: Node;
  symbolPath: string;
  name: string;
  kind: string;
  line: number;
}

export interface SymbolMatchCandidate {
  symbolPath: string;
  name: string;
  line: number;
}

export interface ProjectSymbolSearchOptions {
  readonly query: string;
  readonly kinds?: readonly string[];
  readonly fileFilter?: string;
}

export type SymbolIndexFailureHandler = (reason: string) => void | Promise<void>;

class IndexedProjectionMismatchError extends Error {
  readonly code = "corrupt_storage";

  constructor(message: string) {
    super(message);
    this.name = "IndexedProjectionMismatchError";
  }
}

export interface ProjectSymbolRecord {
  readonly file: string;
  readonly symbol_path: string;
  readonly selector: string;
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly signature: string;
}

export function sourceFileSymbols(
  sourceFile: SourceFile,
  projectRoot: string,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): ProjectSymbolRecord[] {
  const file = path.relative(projectRoot, sourceFile.getFilePath());
  const signatures = new Map(
    buildFileOutline(sourceFile, requestContext).symbols.map((symbol) => [
      `${symbol.symbolPath}@${symbol.startLine}`,
      symbol.signature,
    ]),
  );
  return collectSymbols(sourceFile).map((symbol) => ({
    file,
    symbol_path: symbol.symbolPath,
    selector: `${symbol.symbolPath}@${symbol.line}`,
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.line,
    signature: signatures.get(`${symbol.symbolPath}@${symbol.line}`) ?? symbol.node.getText(),
  }));
}

export function sourceFileIndexSymbols(
  sourceFile: SourceFile,
  projectRoot: string,
): SymbolIndexSymbol[] {
  const outlineSignatures = new Map(
    buildFileOutline(sourceFile).symbols.map((symbol) => [
      `${symbol.symbolPath}@${symbol.startLine}`,
      symbol.signature,
    ]),
  );
  const locatedSymbols = new Map(
    collectSymbols(sourceFile).map((symbol) => [`${symbol.symbolPath}@${symbol.line}`, symbol]),
  );

  return sourceFileSymbols(sourceFile, projectRoot).map((symbol) => {
    const located = locatedSymbols.get(symbol.selector);
    if (!located) {
      throw new Error(`Unable to locate indexed symbol ${symbol.selector}.`);
    }
    const start = sourceFile.getLineAndColumnAtPos(located.node.getStart());
    const end = sourceFile.getLineAndColumnAtPos(
      Math.max(located.node.getStart(), located.node.getEnd() - 1),
    );
    const range: SourceRange = {
      start_line: start.line,
      start_column: start.column,
      end_line: end.line,
      end_column: end.column,
    };

    return {
      name: symbol.name,
      symbol_path: symbol.symbol_path,
      selector: symbol.selector,
      kind: symbol.kind,
      signature: outlineSignatures.get(symbol.selector) ?? `${symbol.kind} ${symbol.name};`,
      line: symbol.line,
      range,
    };
  });
}

export function symbolMatchRank(query: string, symbol: SymbolMatchCandidate): number {
  const normalizedQuery = query.toLowerCase();
  const normalizedPath = symbol.symbolPath.toLowerCase();
  const normalizedName = symbol.name.toLowerCase();
  const normalizedSelector = `${normalizedPath}@${symbol.line}`;

  if (normalizedSelector === normalizedQuery) return 0;
  if (normalizedPath === normalizedQuery) return 1;
  if (normalizedName === normalizedQuery) return 2;
  if (normalizedPath.startsWith(normalizedQuery) || normalizedName.startsWith(normalizedQuery)) {
    return 3;
  }
  return 4;
}

export function searchProjectSymbols(
  project: Project,
  projectRoot: string,
  options: ProjectSymbolSearchOptions,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): ProjectSymbolRecord[] {
  return searchProjectSymbolsPage(
    project,
    projectRoot,
    options,
    0,
    MAX_SYMBOL_INDEX_QUERY_CANDIDATES,
    requestContext,
  ).items;
}

interface ProjectSymbolCandidate {
  readonly file: string;
  readonly selector: string;
  readonly symbol: LocatedSymbol;
  readonly rank: number;
  readonly symbolPosition: number;
}

function candidateOrder(left: ProjectSymbolCandidate, right: ProjectSymbolCandidate): number {
  return (
    left.rank - right.rank ||
    compareSymbolIndexText(left.file, right.file) ||
    left.symbol.line - right.symbol.line ||
    left.symbolPosition - right.symbolPosition
  );
}

function assertSearchPage(offset: number, limit: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Symbol search offset must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SYMBOL_INDEX_QUERY_CANDIDATES) {
    throw new Error(
      `Symbol search limit must be an integer from 1 to ${MAX_SYMBOL_INDEX_QUERY_CANDIDATES}.`,
    );
  }
}

export function searchProjectSymbolsPage(
  project: Project,
  projectRoot: string,
  options: ProjectSymbolSearchOptions,
  offset: number,
  limit: number,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Page<ProjectSymbolRecord> {
  assertSearchPage(offset, limit);
  const normalizedQuery = options.query.toLowerCase();
  const normalizedFileFilter = options.fileFilter?.toLowerCase();
  const kindSet = options.kinds ? new Set(options.kinds) : undefined;
  const sourceFiles = project
    .getSourceFiles()
    .map((sourceFile) => ({
      sourceFile,
      file: path.relative(projectRoot, sourceFile.getFilePath()).replaceAll("\\", "/"),
    }))
    .sort((left, right) => compareSymbolIndexText(left.file, right.file));
  const rankCounts = [0, 0, 0, 0, 0];

  for (const { sourceFile, file } of sourceFiles) {
    requestContext.checkpoint();
    if (normalizedFileFilter && !file.toLowerCase().includes(normalizedFileFilter)) continue;
    forEachLocatedSymbol(sourceFile, (symbol) => {
      requestContext.checkpoint();
      const selector = `${symbol.symbolPath}@${symbol.line}`;
      if (
        (!kindSet || kindSet.has(symbol.kind)) &&
        (symbol.name.toLowerCase().includes(normalizedQuery) ||
          symbol.symbolPath.toLowerCase().includes(normalizedQuery) ||
          selector.toLowerCase().includes(normalizedQuery))
      ) {
        rankCounts[symbolMatchRank(options.query, symbol)] += 1;
      }
    });
  }

  const total = rankCounts.reduce((sum, count) => sum + count, 0);
  const rankSkips = [0, 0, 0, 0, 0];
  const rankTakes = [0, 0, 0, 0, 0];
  let rankOffset = 0;
  for (let rank = 0; rank < rankCounts.length; rank += 1) {
    const rankEnd = rankOffset + rankCounts[rank];
    const pageStart = Math.max(offset, rankOffset);
    const pageEnd = Math.min(offset + limit, rankEnd);
    if (pageStart < pageEnd) {
      rankSkips[rank] = pageStart - rankOffset;
      rankTakes[rank] = pageEnd - pageStart;
    }
    rankOffset = rankEnd;
  }

  const seenByRank = [0, 0, 0, 0, 0];
  const selectedByRank: ProjectSymbolCandidate[][] = [[], [], [], [], []];
  for (const { sourceFile, file } of sourceFiles) {
    requestContext.checkpoint();
    if (normalizedFileFilter && !file.toLowerCase().includes(normalizedFileFilter)) continue;
    let symbolPosition = 0;
    forEachLocatedSymbol(sourceFile, (symbol) => {
      requestContext.checkpoint();
      const selector = `${symbol.symbolPath}@${symbol.line}`;
      const currentSymbolPosition = symbolPosition;
      symbolPosition += 1;
      if (
        (kindSet && !kindSet.has(symbol.kind)) ||
        (!symbol.name.toLowerCase().includes(normalizedQuery) &&
          !symbol.symbolPath.toLowerCase().includes(normalizedQuery) &&
          !selector.toLowerCase().includes(normalizedQuery))
      ) {
        return;
      }
      const rank = symbolMatchRank(options.query, symbol);
      const position = seenByRank[rank];
      seenByRank[rank] += 1;
      if (position < rankSkips[rank] || selectedByRank[rank].length >= rankTakes[rank]) {
        return;
      }
      selectedByRank[rank].push({
        file,
        selector,
        symbol,
        rank,
        symbolPosition: currentSymbolPosition,
      });
    });
  }

  requestContext.checkpoint();
  const pageCandidates = selectedByRank.flat().sort(candidateOrder);
  const items = pageCandidates.map((match): ProjectSymbolRecord => {
    requestContext.checkpoint();
    return {
      file: match.file,
      symbol_path: match.symbol.symbolPath,
      selector: match.selector,
      name: match.symbol.name,
      kind: match.symbol.kind,
      line: match.symbol.line,
      signature: declarationSignature(match.symbol.node, requestContext),
    };
  });
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < total;
  return {
    items,
    offset,
    limit,
    total,
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null,
  };
}

export async function searchProjectSymbolsWithIndex(
  project: Project,
  projectRoot: string,
  projectIdentity: ProjectIdentity,
  symbolIndex: SymbolIndexStore,
  symbolIndexReady: boolean,
  options: ProjectSymbolSearchOptions,
  onIndexFailure?: SymbolIndexFailureHandler,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<ProjectSymbolRecord[] | undefined> {
  const page = await searchProjectSymbolsPageWithIndex(
    project,
    projectRoot,
    projectIdentity,
    symbolIndex,
    symbolIndexReady,
    options,
    0,
    MAX_SYMBOL_INDEX_QUERY_CANDIDATES,
    onIndexFailure,
    requestContext,
  );
  return page?.items;
}

function sameSymbolRecord(left: ProjectSymbolRecord, right: ProjectSymbolRecord): boolean {
  return (
    left.file === right.file &&
    left.symbol_path === right.symbol_path &&
    left.selector === right.selector &&
    left.name === right.name &&
    left.kind === right.kind &&
    left.line === right.line &&
    left.signature === right.signature
  );
}

export async function searchProjectSymbolsPageWithIndex(
  project: Project,
  projectRoot: string,
  projectIdentity: ProjectIdentity,
  symbolIndex: SymbolIndexStore,
  symbolIndexReady: boolean,
  options: ProjectSymbolSearchOptions,
  offset: number,
  limit: number,
  onIndexFailure?: SymbolIndexFailureHandler,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<Page<ProjectSymbolRecord> | undefined> {
  requestContext.checkpoint();
  if (!symbolIndexReady) return undefined;
  const canonical = searchProjectSymbolsPage(
    project,
    projectRoot,
    options,
    offset,
    limit,
    requestContext,
  );

  try {
    requestContext.checkpoint();
    const indexQuery = {
      project: projectIdentity,
      query: options.query,
      filters: {
        ...(options.kinds ? { kinds: options.kinds } : {}),
        ...(options.fileFilter ? { file_path: options.fileFilter } : {}),
      },
    };
    const indexedTotal = await symbolIndex.countSymbols(indexQuery);
    requestContext.checkpoint();
    let complete = indexedTotal === canonical.total;
    if (complete) {
      const matches = await symbolIndex.querySymbols({ ...indexQuery, offset, limit });
      requestContext.checkpoint();
      const indexedPage = matches.map((match) => {
        requestContext.checkpoint();
        return validateIndexedSymbol(project, projectRoot, match, requestContext);
      });
      complete =
        indexedPage.length === canonical.items.length &&
        indexedPage.every((record, index) => sameSymbolRecord(record, canonical.items[index]));
    }
    if (!complete) {
      requestContext.checkpoint();
      try {
        await onIndexFailure?.("corrupt_storage");
      } catch (error) {
        if (isCooperativeInterruption(error)) throw error;
        // Failure reporting cannot suppress the compiler-authoritative result.
      }
      requestContext.checkpoint();
      return canonical;
    }
    return canonical;
  } catch (error) {
    requestContext.checkpoint();
    if (isCooperativeInterruption(error)) throw error;
    if ((error as { code?: unknown }).code !== "scan_limit_exceeded") {
      try {
        await onIndexFailure?.(
          typeof (error as { code?: unknown })?.code === "string"
            ? (error as { code: string }).code
            : "sqlite_read_failed",
        );
      } catch (reportError) {
        if (isCooperativeInterruption(reportError)) throw reportError;
        // Failure reporting cannot suppress the compiler-authoritative result.
      }
    }
    requestContext.checkpoint();
    return canonical;
  }
}

function validateIndexedSymbol(
  project: Project,
  projectRoot: string,
  match: SymbolIndexSymbolMatch,
  requestContext: RequestContext,
): ProjectSymbolRecord {
  const sourceFile = project.getSourceFile(path.resolve(projectRoot, match.file_path));
  if (!sourceFile) {
    throw new IndexedProjectionMismatchError(
      `Indexed source file "${match.file_path}" was not found in the compiler project.`,
    );
  }
  const expectedFile = path.relative(projectRoot, sourceFile.getFilePath()).replaceAll("\\", "/");
  if (expectedFile !== match.file_path.replaceAll("\\", "/")) {
    throw new IndexedProjectionMismatchError(
      `Indexed source file "${match.file_path}" resolved ambiguously.`,
    );
  }
  const located = findLocatedSymbol(sourceFile, match.selector);
  if (!located) {
    throw new IndexedProjectionMismatchError(
      `Indexed symbol "${match.selector}" does not exist in the compiler project.`,
    );
  }
  const node = located.node;
  if (node.getStartLineNumber() !== match.line || node.getKindName() !== match.kind) {
    throw new IndexedProjectionMismatchError(
      `Indexed symbol "${match.selector}" does not match the compiler declaration.`,
    );
  }
  const canonicalName = namedNode(node);
  const canonicalSymbolPath = located.symbolPath;
  const canonicalSignature = declarationSignature(node, requestContext);
  if (
    !canonicalName ||
    canonicalSymbolPath !== match.symbol_path ||
    canonicalName !== match.name ||
    canonicalSignature !== match.signature ||
    node.getStartLineNumber() !== match.range.start_line
  ) {
    throw new IndexedProjectionMismatchError(
      `Indexed symbol "${match.selector}" does not match canonical compiler metadata.`,
    );
  }
  return {
    file: expectedFile,
    symbol_path: canonicalSymbolPath,
    selector: match.selector,
    name: canonicalName,
    kind: node.getKindName(),
    line: node.getStartLineNumber(),
    signature: canonicalSignature,
  };
}

function namedNode(node: Node): string | undefined {
  if (Node.isConstructorDeclaration(node)) return "constructor";
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isClassDeclaration(node) ||
    Node.isInterfaceDeclaration(node) ||
    Node.isEnumDeclaration(node) ||
    Node.isTypeAliasDeclaration(node) ||
    Node.isModuleDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isMethodSignature(node) ||
    Node.isPropertyDeclaration(node) ||
    Node.isPropertySignature(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isVariableDeclaration(node)
  ) {
    return node.getName();
  }
  return undefined;
}

function locatedSymbol(node: Node, symbolPath: string): LocatedSymbol | undefined {
  const name = namedNode(node);
  if (!name) return undefined;
  return {
    node,
    symbolPath,
    name,
    kind: node.getKindName(),
    line: node.getStartLineNumber(),
  };
}

function visitClassLike(
  node: Node,
  prefix: string,
  visit: (symbol: LocatedSymbol) => boolean | void,
): boolean {
  if (!Node.isClassDeclaration(node) && !Node.isInterfaceDeclaration(node)) return true;
  let complete = true;
  node.forEachChild((member) => {
    const name = namedNode(member);
    const located = name ? locatedSymbol(member, `${prefix}.${name}`) : undefined;
    if (located && visit(located) === false) {
      complete = false;
      return true;
    }
    return undefined;
  });
  return complete;
}

function visitModuleStatements(
  module: ModuleDeclaration,
  prefix: string,
  visit: (symbol: LocatedSymbol) => boolean | void,
): boolean {
  let body = module.getBody();
  while (body && Node.isModuleDeclaration(body)) body = body.getBody();
  return !body || !Node.isModuleBlock(body) || visitChildStatements(body, prefix, visit);
}

function visitStatement(
  statement: Node,
  prefix: string | undefined,
  visit: (symbol: LocatedSymbol) => boolean | void,
): boolean {
  if (Node.isVariableStatement(statement)) {
    let complete = true;
    statement.getDeclarationList().forEachChild((declaration) => {
      if (Node.isVariableDeclaration(declaration)) {
        const path = prefix ? `${prefix}.${declaration.getName()}` : declaration.getName();
        const located = locatedSymbol(declaration, path);
        if (located && visit(located) === false) {
          complete = false;
          return true;
        }
      }
      return undefined;
    });
    return complete;
  }

  const name = namedNode(statement);
  if (!name) return true;
  const symbolPath = prefix ? `${prefix}.${name}` : name;
  const located = locatedSymbol(statement, symbolPath);
  if (located && visit(located) === false) return false;
  if (!visitClassLike(statement, symbolPath, visit)) return false;

  if (Node.isModuleDeclaration(statement)) {
    return visitModuleStatements(statement, symbolPath, visit);
  }
  return true;
}

function visitChildStatements(
  container: Node,
  prefix: string | undefined,
  visit: (symbol: LocatedSymbol) => boolean | void,
): boolean {
  let complete = true;
  container.forEachChild((statement) => {
    if (!visitStatement(statement, prefix, visit)) {
      complete = false;
      return true;
    }
    return undefined;
  });
  return complete;
}

export function forEachLocatedSymbol(
  sourceFile: SourceFile,
  visit: (symbol: LocatedSymbol) => boolean | void,
): void {
  visitChildStatements(sourceFile, undefined, visit);
}

export function collectSymbols(sourceFile: SourceFile): LocatedSymbol[] {
  const symbols: LocatedSymbol[] = [];
  forEachLocatedSymbol(sourceFile, (symbol) => {
    symbols.push(symbol);
  });
  return symbols;
}

export function containingSymbol(sourceFile: SourceFile, node: Node): LocatedSymbol | undefined {
  return collectSymbols(sourceFile)
    .filter(
      (symbol) =>
        symbol.node.getStart() <= node.getStart() && symbol.node.getEnd() >= node.getEnd(),
    )
    .sort((left, right) => {
      const leftSize = left.node.getEnd() - left.node.getStart();
      const rightSize = right.node.getEnd() - right.node.getStart();
      return (
        leftSize - rightSize ||
        left.line - right.line ||
        left.symbolPath.localeCompare(right.symbolPath)
      );
    })[0];
}

function parseSelector(symbolPath: string): { path: string; line?: number } {
  const match = /^(.*)@(\d+)$/.exec(symbolPath);
  return match ? { path: match[1], line: Number(match[2]) } : { path: symbolPath };
}

export function findLocatedSymbol(
  sourceFile: SourceFile,
  requestedSelector: string,
  onVisit: (symbol: LocatedSymbol) => void = () => undefined,
): LocatedSymbol | undefined {
  const selector = parseSelector(requestedSelector);
  if (selector.line === undefined) {
    throw new Error("Located-symbol resolution requires an exact selector with a line number.");
  }
  let match: LocatedSymbol | undefined;
  forEachLocatedSymbol(sourceFile, (symbol) => {
    onVisit(symbol);
    if (symbol.symbolPath !== selector.path || symbol.line !== selector.line) return;
    match = symbol;
    return false;
  });
  return match;
}

export function findLocatedDeclaration(
  sourceFile: SourceFile,
  requestedPath: string,
  onVisit: (symbol: LocatedSymbol) => void = () => undefined,
): LocatedSymbol {
  const selector = parseSelector(requestedPath);
  let match: LocatedSymbol | undefined;
  forEachLocatedSymbol(sourceFile, (symbol) => {
    onVisit(symbol);
    if (symbol.symbolPath !== selector.path) return;
    if (selector.line !== undefined && symbol.line !== selector.line) return;
    match = symbol;
    return false;
  });

  if (!match) {
    throw new Error(
      `Symbol "${requestedPath}" was not found in ${sourceFile.getFilePath()}. Use ast_get_outline or ast_search_symbols to obtain an exact symbol path.`,
    );
  }
  if (selector.line !== undefined) return match;

  const compilerDeclarations = match.node.getSymbol()?.compilerSymbol.declarations;
  if (!compilerDeclarations) return match;
  let declarationsInFile = 0;
  let implementationNode: ts.Node | undefined;
  let implementationCount = 0;
  const selectors: string[] = [];
  for (const declaration of compilerDeclarations) {
    if (declaration.getSourceFile() !== sourceFile.compilerNode) continue;
    declarationsInFile += 1;
    if (selectors.length < 20) {
      const line =
        sourceFile.compilerNode.getLineAndCharacterOfPosition(declaration.getStart()).line + 1;
      selectors.push(`${match.symbolPath}@${line}`);
    }
    if (
      (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) &&
      declaration.body
    ) {
      implementationNode = declaration;
      implementationCount += 1;
    }
  }
  if (declarationsInFile <= 1) return match;

  if (implementationCount === 1) {
    let implementation: LocatedSymbol | undefined;
    forEachLocatedSymbol(sourceFile, (symbol) => {
      onVisit(symbol);
      if (symbol.node.compilerNode !== implementationNode) return;
      implementation = symbol;
      return false;
    });
    if (implementation) return implementation;
  }

  throw new Error(
    `Symbol "${requestedPath}" is ambiguous. Select one by line: ${selectors.join(", ")}${
      declarationsInFile > selectors.length ? ", ..." : ""
    }.`,
  );
}

export function findDeclaration(sourceFile: SourceFile, requestedPath: string): Node {
  return findLocatedDeclaration(sourceFile, requestedPath).node;
}

export function executableDeclaration(node: Node): Node {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  ) {
    return node;
  }

  if (Node.isVariableDeclaration(node) || Node.isPropertyDeclaration(node)) {
    const initializer = node.getInitializer();
    if (
      initializer &&
      (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    ) {
      return initializer;
    }
  }

  throw new Error(`Symbol kind ${node.getKindName()} does not have a replaceable executable body.`);
}
