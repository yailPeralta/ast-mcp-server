import path from "node:path";
import {
  Node,
  type ArrowFunction,
  type ClassDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type InterfaceDeclaration,
  type MethodDeclaration,
  type ModuleDeclaration,
  type SourceFile,
  type VariableStatement,
} from "ts-morph";
import { NO_REQUEST_CONTEXT, type RequestContext } from "./request-context.js";

export interface OutlineSymbol {
  symbolPath: string;
  name: string;
  kind: string;
  signature: string;
  startLine: number;
  endLine: number;
}

export interface FileOutline {
  text: string;
  symbols: OutlineSymbol[];
}

interface FormattedStatement {
  lines: string[];
  symbols: OutlineSymbol[];
}

function joinPresent(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

function modifiersOf(node: { getModifiers(): Array<{ getText(): string }> }): string {
  return node
    .getModifiers()
    .map((modifier) => modifier.getText())
    .join(" ");
}

function typeParametersOf(node: { getTypeParameters(): Array<{ getText(): string }> }): string {
  const parameters = node.getTypeParameters().map((parameter) => parameter.getText());
  return parameters.length > 0 ? `<${parameters.join(", ")}>` : "";
}

function parametersOf(node: { getParameters(): Array<{ getText(): string }> }): string {
  return node
    .getParameters()
    .map((parameter) => parameter.getText())
    .join(", ");
}

function returnTypeOf(node: { getReturnTypeNode(): { getText(): string } | undefined }): string {
  const returnType = node.getReturnTypeNode()?.getText();
  return returnType ? `: ${returnType}` : "";
}

function optionalMarker(node: { hasQuestionToken(): boolean }): string {
  return node.hasQuestionToken() ? "?" : "";
}

function functionSignature(node: FunctionDeclaration): string {
  const name = node.getName() ?? "<anonymous>";
  const generator = node.getAsteriskToken() ? "*" : "";
  const declaration = `function${generator} ${name}${typeParametersOf(node)}(${parametersOf(node)})${returnTypeOf(node)};`;
  return joinPresent([modifiersOf(node), declaration]);
}

function methodSignature(node: MethodDeclaration): string {
  const generator = node.getAsteriskToken() ? "*" : "";
  const declaration = `${generator}${node.getName()}${optionalMarker(node)}${typeParametersOf(node)}(${parametersOf(node)})${returnTypeOf(node)};`;
  return joinPresent([modifiersOf(node), declaration]);
}

function callableExpressionSignature(node: ArrowFunction | FunctionExpression): string {
  const generic = typeParametersOf(node);
  const returnType = node.getReturnTypeNode()?.getText() ?? "unknown";
  return `${generic}(${parametersOf(node)}) => ${returnType}`;
}

type ClassMember = ReturnType<ClassDeclaration["getMembers"]>[number];

function memberSignature(member: ClassMember): string | undefined {
  if (Node.isMethodDeclaration(member)) return methodSignature(member);

  if (Node.isConstructorDeclaration(member)) {
    return joinPresent([modifiersOf(member), `constructor(${parametersOf(member)});`]);
  }

  if (Node.isGetAccessorDeclaration(member)) {
    return joinPresent([modifiersOf(member), `get ${member.getName()}()${returnTypeOf(member)};`]);
  }

  if (Node.isSetAccessorDeclaration(member)) {
    return joinPresent([modifiersOf(member), `set ${member.getName()}(${parametersOf(member)});`]);
  }

  if (Node.isPropertyDeclaration(member)) {
    const question = member.hasQuestionToken() ? "?" : "";
    const definite = member.hasExclamationToken() ? "!" : "";
    const explicitType = member.getTypeNode()?.getText();
    const initializer = member.getInitializer();
    const callableType =
      initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
        ? callableExpressionSignature(initializer)
        : undefined;
    const type = explicitType ?? callableType;
    return joinPresent([
      modifiersOf(member),
      `${member.getName()}${question}${definite}${type ? `: ${type}` : ""};`,
    ]);
  }

  return undefined;
}

function symbolOf(node: Node, symbolPath: string, name: string, signature: string): OutlineSymbol {
  return {
    symbolPath,
    name,
    kind: node.getKindName(),
    signature,
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
  };
}

function formatClass(
  statement: ClassDeclaration,
  prefix = "",
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): FormattedStatement {
  const name = statement.getName() ?? "<anonymous>";
  const symbolPath = prefix ? `${prefix}.${name}` : name;
  const heritage = statement.getExtends()?.getText();
  const implementations = statement.getImplements().map((item) => item.getText());
  const declaration = joinPresent([
    modifiersOf(statement),
    `class ${name}${typeParametersOf(statement)}`,
    heritage ? `extends ${heritage}` : undefined,
    implementations.length > 0 ? `implements ${implementations.join(", ")}` : undefined,
  ]);
  const lines = [`${declaration} {`];
  const symbols = [symbolOf(statement, symbolPath, name, declaration)];

  for (const member of statement.getMembers()) {
    requestContext.checkpoint();
    const signature = memberSignature(member);
    if (!signature) continue;
    const memberName = Node.isConstructorDeclaration(member) ? "constructor" : member.getName();
    lines.push(`  ${signature}`);
    symbols.push(symbolOf(member, `${symbolPath}.${memberName}`, memberName, signature));
  }

  lines.push("}");
  return { lines, symbols };
}

function formatInterface(
  statement: InterfaceDeclaration,
  prefix = "",
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): FormattedStatement {
  const name = statement.getName();
  const symbolPath = prefix ? `${prefix}.${name}` : name;
  const extensions = statement.getExtends().map((item) => item.getText());
  const declaration = joinPresent([
    modifiersOf(statement),
    `interface ${name}${typeParametersOf(statement)}`,
    extensions.length > 0 ? `extends ${extensions.join(", ")}` : undefined,
  ]);
  const lines = [`${declaration} {`];
  const symbols = [symbolOf(statement, symbolPath, name, declaration)];

  for (const member of statement.getMembers()) {
    requestContext.checkpoint();
    const signature = member.getText().trim();
    lines.push(`  ${signature}`);
    const memberName = "getName" in member ? member.getName() : member.getKindName();
    symbols.push(symbolOf(member, `${symbolPath}.${memberName}`, memberName, signature));
  }

  lines.push("}");
  return { lines, symbols };
}

function formatVariable(
  statement: VariableStatement,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): FormattedStatement {
  const lines: string[] = [];
  const symbols: OutlineSymbol[] = [];
  const keyword = statement.getDeclarationKind();
  const modifiers = modifiersOf(statement);

  for (const declaration of statement.getDeclarations()) {
    requestContext.checkpoint();
    const name = declaration.getName();
    const explicitType = declaration.getTypeNode()?.getText();
    const initializer = declaration.getInitializer();
    const callableType =
      initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
        ? callableExpressionSignature(initializer)
        : undefined;
    const signature = joinPresent([
      modifiers,
      `${keyword} ${name}${explicitType || callableType ? `: ${explicitType ?? callableType}` : ""};`,
    ]);
    lines.push(signature);
    symbols.push(symbolOf(declaration, name, name, signature));
  }

  return { lines, symbols };
}

function moduleStatements(module: ModuleDeclaration): Node[] {
  const body = module.getBody();
  if (!body) return [];
  if (Node.isModuleBlock(body)) return body.getStatements();
  if (Node.isModuleDeclaration(body)) return [body];
  return [];
}

function formatStatement(
  statement: Node,
  prefix = "",
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): FormattedStatement | undefined {
  requestContext.checkpoint();
  if (Node.isClassDeclaration(statement)) return formatClass(statement, prefix, requestContext);
  if (Node.isInterfaceDeclaration(statement)) {
    return formatInterface(statement, prefix, requestContext);
  }

  if (Node.isFunctionDeclaration(statement)) {
    const name = statement.getName() ?? "<anonymous>";
    const symbolPath = prefix ? `${prefix}.${name}` : name;
    const signature = functionSignature(statement);
    return { lines: [signature], symbols: [symbolOf(statement, symbolPath, name, signature)] };
  }

  if (Node.isTypeAliasDeclaration(statement)) {
    const name = statement.getName();
    const symbolPath = prefix ? `${prefix}.${name}` : name;
    const signature = joinPresent([
      modifiersOf(statement),
      `type ${name}${typeParametersOf(statement)} = ${statement.getTypeNode()?.getText() ?? "unknown"};`,
    ]);
    return { lines: [signature], symbols: [symbolOf(statement, symbolPath, name, signature)] };
  }

  if (Node.isEnumDeclaration(statement)) {
    const name = statement.getName();
    const symbolPath = prefix ? `${prefix}.${name}` : name;
    const members = statement
      .getMembers()
      .map((member) => {
        requestContext.checkpoint();
        return member.getName();
      })
      .join(", ");
    const signature = joinPresent([modifiersOf(statement), `enum ${name} { ${members} }`]);
    return { lines: [signature], symbols: [symbolOf(statement, symbolPath, name, signature)] };
  }

  if (Node.isVariableStatement(statement)) return formatVariable(statement, requestContext);

  if (Node.isModuleDeclaration(statement)) {
    const name = statement.getName();
    const symbolPath = prefix ? `${prefix}.${name}` : name;
    const declaration = joinPresent([modifiersOf(statement), `namespace ${name}`]);
    const lines = [`${declaration} {`];
    const symbols = [symbolOf(statement, symbolPath, name, declaration)];
    for (const child of moduleStatements(statement)) {
      requestContext.checkpoint();
      const formatted = formatStatement(child, symbolPath, requestContext);
      if (!formatted) continue;
      lines.push(...formatted.lines.map((line) => `  ${line}`));
      symbols.push(...formatted.symbols);
    }
    lines.push("}");
    return { lines, symbols };
  }

  return undefined;
}

export function buildFileOutline(
  sourceFile: SourceFile,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): FileOutline {
  const lines: string[] = [];
  const symbols: OutlineSymbol[] = [];
  for (const statement of sourceFile.getStatements()) {
    requestContext.checkpoint();
    const formatted = formatStatement(statement, "", requestContext);
    if (!formatted) continue;
    lines.push(...formatted.lines);
    symbols.push(...formatted.symbols);
  }
  return { text: lines.join("\n"), symbols };
}

export function fileOutline(sourceFile: SourceFile): string {
  return buildFileOutline(sourceFile).text;
}

export function nodeSourceWithLocation(
  node: Node,
  projectRoot?: string,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
} {
  requestContext.checkpoint();
  const sourceFile = node.getSourceFile();
  return {
    file: projectRoot
      ? path.relative(projectRoot, sourceFile.getFilePath())
      : sourceFile.getFilePath(),
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
    text: node.getText(),
  };
}
