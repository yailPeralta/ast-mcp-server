import path from "node:path";
import {
  Node,
  type Project,
  type ModuleBlock,
  type ModuleDeclaration,
  type SourceFile,
  type Statement,
} from "ts-morph";
import { buildFileOutline } from "./outline.js";
import type { SourceRange } from "./read-contracts.js";
import type { SymbolIndexSymbol } from "./symbol-index.js";

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
): ProjectSymbolRecord[] {
  const file = path.relative(projectRoot, sourceFile.getFilePath());
  const signatures = new Map(
    buildFileOutline(sourceFile).symbols.map((symbol) => [
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
): ProjectSymbolRecord[] {
  const normalizedQuery = options.query.toLowerCase();
  const normalizedFileFilter = options.fileFilter?.toLowerCase();
  const kindSet = options.kinds ? new Set(options.kinds) : undefined;
  const matches: ProjectSymbolRecord[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const file = path.relative(projectRoot, sourceFile.getFilePath());
    if (normalizedFileFilter && !file.toLowerCase().includes(normalizedFileFilter)) continue;

    const matchingSymbols = sourceFileSymbols(sourceFile, projectRoot).filter((symbol) => {
      return (
        (!kindSet || kindSet.has(symbol.kind)) &&
        (symbol.name.toLowerCase().includes(normalizedQuery) ||
          symbol.symbol_path.toLowerCase().includes(normalizedQuery) ||
          symbol.selector.toLowerCase().includes(normalizedQuery))
      );
    });
    if (matchingSymbols.length === 0) continue;

    for (const symbol of matchingSymbols) {
      matches.push(symbol);
    }
  }

  matches.sort((left, right) => {
    const rank =
      symbolMatchRank(options.query, {
        symbolPath: left.symbol_path,
        name: left.name,
        line: left.line,
      }) -
      symbolMatchRank(options.query, {
        symbolPath: right.symbol_path,
        name: right.name,
        line: right.line,
      });
    if (rank !== 0) return rank;
    return (
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.symbol_path.localeCompare(right.symbol_path) ||
      left.kind.localeCompare(right.kind)
    );
  });
  return matches;
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

function addLocated(node: Node, symbolPath: string, output: LocatedSymbol[]): void {
  const name = namedNode(node);
  if (!name) return;
  output.push({
    node,
    symbolPath,
    name,
    kind: node.getKindName(),
    line: node.getStartLineNumber(),
  });
}

function collectClassLike(node: Node, prefix: string, output: LocatedSymbol[]): void {
  if (!Node.isClassDeclaration(node) && !Node.isInterfaceDeclaration(node)) return;
  for (const member of node.getMembers()) {
    const name = namedNode(member);
    if (name) addLocated(member, `${prefix}.${name}`, output);
  }
}

function moduleStatements(module: ModuleDeclaration): Statement[] {
  let body = module.getBody();
  while (body && Node.isModuleDeclaration(body)) body = body.getBody();
  return body && Node.isModuleBlock(body) ? (body as ModuleBlock).getStatements() : [];
}

function collectStatements(
  statements: readonly Statement[],
  prefix: string | undefined,
  output: LocatedSymbol[],
): void {
  for (const statement of statements) {
    if (Node.isVariableStatement(statement)) {
      for (const declaration of statement.getDeclarations()) {
        const path = prefix ? `${prefix}.${declaration.getName()}` : declaration.getName();
        addLocated(declaration, path, output);
      }
      continue;
    }

    const name = namedNode(statement);
    if (!name) continue;
    const symbolPath = prefix ? `${prefix}.${name}` : name;
    addLocated(statement, symbolPath, output);
    collectClassLike(statement, symbolPath, output);

    if (Node.isModuleDeclaration(statement)) {
      collectStatements(moduleStatements(statement), symbolPath, output);
    }
  }
}

export function collectSymbols(sourceFile: SourceFile): LocatedSymbol[] {
  const symbols: LocatedSymbol[] = [];
  collectStatements(sourceFile.getStatements(), undefined, symbols);
  return symbols;
}

function parseSelector(symbolPath: string): { path: string; line?: number } {
  const match = /^(.*)@(\d+)$/.exec(symbolPath);
  return match ? { path: match[1], line: Number(match[2]) } : { path: symbolPath };
}

export function findDeclaration(sourceFile: SourceFile, requestedPath: string): Node {
  const selector = parseSelector(requestedPath);
  let matches = collectSymbols(sourceFile).filter(
    (symbol) =>
      symbol.symbolPath === selector.path && (!selector.line || symbol.line === selector.line),
  );

  if (matches.length > 1) {
    const implementations = matches.filter((symbol) => {
      const node = symbol.node;
      return (
        (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) &&
        node.getBody() !== undefined
      );
    });
    if (implementations.length === 1) matches = implementations;
  }

  if (matches.length === 1) return matches[0].node;
  if (matches.length === 0) {
    throw new Error(
      `Symbol "${requestedPath}" was not found in ${sourceFile.getFilePath()}. Use ast_get_outline or ast_search_symbols to obtain an exact symbol path.`,
    );
  }

  throw new Error(
    `Symbol "${requestedPath}" is ambiguous. Select one by line: ${matches
      .map((symbol) => `${symbol.symbolPath}@${symbol.line}`)
      .join(", ")}.`,
  );
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
