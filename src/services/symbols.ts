import {
  Node,
  type ModuleBlock,
  type ModuleDeclaration,
  type SourceFile,
  type Statement,
} from "ts-morph";

export interface LocatedSymbol {
  node: Node;
  symbolPath: string;
  name: string;
  kind: string;
  line: number;
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
