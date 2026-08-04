import {
  LanguageVariant,
  Node,
  Scope,
  ScriptTarget,
  SyntaxKind,
  ts,
  type Project,
  type SourceFile,
} from "ts-morph";
import { buildFileOutline } from "./outline.js";

export type ScaffoldAccessModifier =
  | "public"
  | "public readonly"
  | "protected"
  | "protected readonly"
  | "private"
  | "private readonly";

export interface ScaffoldImport {
  from: string;
  named?: string[];
  default?: string;
}

export interface ScaffoldParameter {
  name: string;
  type: string;
}

export interface ScaffoldConstructorParameter extends ScaffoldParameter {
  accessModifier?: ScaffoldAccessModifier;
}

export interface ScaffoldProperty {
  name: string;
  type: string;
  accessModifier?: ScaffoldAccessModifier;
  initializer?: string;
}

export interface ScaffoldMethod {
  name: string;
  isAsync: boolean;
  accessModifier?: ScaffoldAccessModifier;
  params: ScaffoldParameter[];
  returnType: string;
  decorators?: string[];
  docs?: string[];
}

export interface ClassScaffoldSpec {
  className: string;
  imports: ScaffoldImport[];
  extends?: string;
  implements: string[];
  decorators: string[];
  constructorParams: ScaffoldConstructorParameter[];
  properties: ScaffoldProperty[];
  methods: ScaffoldMethod[];
}

export interface ClassScaffoldResult {
  sourceFile: SourceFile;
  pendingMethods: string[];
  outline: string;
}

interface ScopeStructure {
  scope?: Scope;
  isReadonly?: boolean;
}

function assertIdentifier(value: string, label: string): void {
  const scanner = ts.createScanner(ScriptTarget.Latest, false, LanguageVariant.Standard, value);
  const valid =
    scanner.scan() === SyntaxKind.Identifier && scanner.scan() === SyntaxKind.EndOfFileToken;
  if (!valid) throw new Error(`${label} must be a valid TypeScript identifier.`);
}

function assertBoundedText(value: string, label: string, maximum = 10_000): void {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty.`);
  if (value.length > maximum) throw new Error(`${label} exceeds ${maximum} characters.`);
}

type ParsedSourceFile = ts.SourceFile & {
  readonly parseDiagnostics: readonly ts.Diagnostic[];
};

function parseFragment(sourceText: string, label: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    "__ast_scaffold_fragment.ts",
    sourceText,
    ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = (sourceFile as ParsedSourceFile).parseDiagnostics;
  if (diagnostics.length > 0) {
    throw new Error(`${label} is not valid TypeScript in its declaration position.`);
  }
  return sourceFile;
}

function assertTypeFragment(value: string, label: string): void {
  assertBoundedText(value, label);
  const sourceFile = parseFragment(`type __ScaffoldType = ${value};`, label);
  const declaration = sourceFile.statements[0];
  if (
    sourceFile.statements.length !== 1 ||
    !declaration ||
    !ts.isTypeAliasDeclaration(declaration) ||
    declaration.type.getText(sourceFile) !== value.trim()
  ) {
    throw new Error(`${label} must contain exactly one TypeScript type.`);
  }
}

function assertHeritageFragment(
  value: string,
  label: string,
  token: typeof SyntaxKind.ExtendsKeyword | typeof SyntaxKind.ImplementsKeyword,
): void {
  assertBoundedText(value, label);
  const keyword = token === SyntaxKind.ExtendsKeyword ? "extends" : "implements";
  const sourceFile = parseFragment(`class __Scaffold ${keyword} ${value} {}`, label);
  const declaration = sourceFile.statements[0];
  const clause =
    declaration && ts.isClassDeclaration(declaration)
      ? declaration.heritageClauses?.find((item) => item.token === token)
      : undefined;
  if (
    sourceFile.statements.length !== 1 ||
    !clause ||
    clause.types.length !== 1 ||
    clause.types[0]?.getText(sourceFile) !== value.trim()
  ) {
    throw new Error(`${label} must contain exactly one TypeScript heritage expression.`);
  }
}

function assertInitializerFragment(value: string, label: string): void {
  assertBoundedText(value, label);
  const sourceFile = parseFragment(`class __Scaffold { value = ${value}; }`, label);
  const declaration = sourceFile.statements[0];
  const members = declaration && ts.isClassDeclaration(declaration) ? declaration.members : [];
  const property = members[0];
  if (
    sourceFile.statements.length !== 1 ||
    members.length !== 1 ||
    !property ||
    !ts.isPropertyDeclaration(property) ||
    property.initializer?.getText(sourceFile) !== value.trim()
  ) {
    throw new Error(`${label} must contain exactly one TypeScript expression.`);
  }
}

function scopeStructure(modifier: ScaffoldAccessModifier | undefined): ScopeStructure {
  switch (modifier) {
    case "public":
      return { scope: Scope.Public };
    case "public readonly":
      return { scope: Scope.Public, isReadonly: true };
    case "protected":
      return { scope: Scope.Protected };
    case "protected readonly":
      return { scope: Scope.Protected, isReadonly: true };
    case "private":
      return { scope: Scope.Private };
    case "private readonly":
      return { scope: Scope.Private, isReadonly: true };
    default:
      return {};
  }
}

function decoratorStructure(value: string, label: string): { name: string; arguments: string[] } {
  assertBoundedText(value, label);
  const sourceFile = parseFragment(`${value.trim()}\nclass __Scaffold {}`, label);
  const declaration = sourceFile.statements[0];
  const decorators =
    declaration && ts.isClassDeclaration(declaration) && ts.canHaveDecorators(declaration)
      ? ts.getDecorators(declaration)
      : undefined;
  if (
    sourceFile.statements.length !== 1 ||
    decorators?.length !== 1 ||
    decorators[0]?.getText(sourceFile) !== value.trim()
  ) {
    throw new Error(`${label} must contain exactly one TypeScript decorator.`);
  }
  const match = /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\(([\s\S]*)\))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`${label} must use @Name or @Name(arguments) syntax.`);
  }
  const argumentText = match[2]?.trim();
  return {
    name: match[1]!,
    arguments: argumentText ? [argumentText] : [],
  };
}

function validateSpec(spec: ClassScaffoldSpec): void {
  assertIdentifier(spec.className, "class_name");
  if (spec.methods.length === 0) throw new Error("methods must contain at least one method.");

  const methodNames = new Set<string>();
  for (const [index, method] of spec.methods.entries()) {
    assertIdentifier(method.name, `methods[${index}].name`);
    if (method.name === "constructor") {
      throw new Error('Method name "constructor" is reserved for the generated constructor.');
    }
    if (methodNames.has(method.name)) {
      throw new Error("Method names must be unique so pending method selectors are unambiguous.");
    }
    methodNames.add(method.name);
    assertTypeFragment(method.returnType, `methods[${index}].return_type`);
    const parameterNames = new Set<string>();
    for (const [paramIndex, parameter] of method.params.entries()) {
      assertIdentifier(parameter.name, `methods[${index}].params[${paramIndex}].name`);
      if (parameterNames.has(parameter.name)) {
        throw new Error(`methods[${index}] parameter names must be unique.`);
      }
      parameterNames.add(parameter.name);
      assertTypeFragment(parameter.type, `methods[${index}].params[${paramIndex}].type`);
    }
    for (const [docsIndex, docs] of (method.docs ?? []).entries()) {
      assertBoundedText(docs, `methods[${index}].docs[${docsIndex}]`);
      if (docs.includes("*/")) {
        throw new Error(`methods[${index}].docs[${docsIndex}] must not close its doc comment.`);
      }
    }
  }

  const constructorParameterNames = new Set<string>();
  for (const [index, parameter] of spec.constructorParams.entries()) {
    assertIdentifier(parameter.name, `constructor_params[${index}].name`);
    if (constructorParameterNames.has(parameter.name)) {
      throw new Error("Constructor parameter names must be unique.");
    }
    constructorParameterNames.add(parameter.name);
    assertTypeFragment(parameter.type, `constructor_params[${index}].type`);
  }
  const propertyNames = new Set<string>();
  for (const [index, property] of spec.properties.entries()) {
    assertIdentifier(property.name, `properties[${index}].name`);
    if (propertyNames.has(property.name)) throw new Error("Property names must be unique.");
    if (methodNames.has(property.name)) {
      throw new Error("Property names must not collide with generated method names.");
    }
    propertyNames.add(property.name);
    assertTypeFragment(property.type, `properties[${index}].type`);
    if (property.initializer === undefined) {
      throw new Error(`properties[${index}] requires an initializer.`);
    }
    assertInitializerFragment(property.initializer, `properties[${index}].initializer`);
  }
  for (const [index, declaration] of spec.imports.entries()) {
    assertBoundedText(declaration.from, `imports[${index}].from`, 500);
    if (
      [...declaration.from].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      })
    ) {
      throw new Error(`imports[${index}].from must not contain control characters.`);
    }
    if (declaration.default !== undefined) {
      assertIdentifier(declaration.default, `imports[${index}].default`);
    }
    for (const [nameIndex, name] of (declaration.named ?? []).entries()) {
      assertIdentifier(name, `imports[${index}].named[${nameIndex}]`);
    }
  }
  spec.decorators.forEach((decorator, index) =>
    decoratorStructure(decorator, `decorators[${index}]`),
  );
  spec.methods.forEach((method, methodIndex) =>
    (method.decorators ?? []).forEach((decorator, decoratorIndex) =>
      decoratorStructure(decorator, `methods[${methodIndex}].decorators[${decoratorIndex}]`),
    ),
  );
  if (spec.extends !== undefined) {
    assertHeritageFragment(spec.extends, "extends", SyntaxKind.ExtendsKeyword);
  }
  spec.implements.forEach((value, index) =>
    assertHeritageFragment(value, `implements[${index}]`, SyntaxKind.ImplementsKeyword),
  );
}

export function buildClassScaffold(
  project: Project,
  filePath: string,
  spec: ClassScaffoldSpec,
): ClassScaffoldResult {
  validateSpec(spec);
  const sourceFile = project.createSourceFile(filePath, "", { overwrite: false });

  sourceFile.addImportDeclarations(
    spec.imports.map((declaration) => ({
      moduleSpecifier: declaration.from,
      ...(declaration.default ? { defaultImport: declaration.default } : {}),
      ...(declaration.named?.length ? { namedImports: declaration.named } : {}),
    })),
  );

  sourceFile.addClass({
    name: spec.className,
    isExported: true,
    ...(spec.extends ? { extends: spec.extends } : {}),
    ...(spec.implements.length > 0 ? { implements: spec.implements } : {}),
    decorators: spec.decorators.map((decorator, index) =>
      decoratorStructure(decorator, `decorators[${index}]`),
    ),
    ctors:
      spec.constructorParams.length > 0
        ? [
            {
              parameters: spec.constructorParams.map((parameter) => ({
                name: parameter.name,
                type: parameter.type,
                ...scopeStructure(parameter.accessModifier),
              })),
              statements: [],
            },
          ]
        : [],
    properties: spec.properties.map((property) => ({
      name: property.name,
      type: property.type,
      ...scopeStructure(property.accessModifier),
      ...(property.initializer !== undefined ? { initializer: property.initializer } : {}),
    })),
    methods: spec.methods.map((method, methodIndex) => ({
      name: method.name,
      isAsync: method.isAsync,
      returnType: method.returnType,
      ...scopeStructure(method.accessModifier),
      parameters: method.params.map((parameter) => ({
        name: parameter.name,
        type: parameter.type,
      })),
      decorators: (method.decorators ?? []).map((decorator, decoratorIndex) =>
        decoratorStructure(decorator, `methods[${methodIndex}].decorators[${decoratorIndex}]`),
      ),
      docs: method.docs ?? [],
      statements: [`throw new Error("Not implemented: ${spec.className}.${method.name}");`],
    })),
  });

  const classes = sourceFile.getClasses();
  const allowedStatements = sourceFile
    .getStatements()
    .every(
      (statement) => Node.isImportDeclaration(statement) || Node.isClassDeclaration(statement),
    );
  if (
    !allowedStatements ||
    classes.length !== 1 ||
    classes[0]?.getName() !== spec.className ||
    classes[0].getMethods().length !== spec.methods.length
  ) {
    throw new Error("Generated scaffold failed structural postcondition validation.");
  }

  return {
    sourceFile,
    pendingMethods: spec.methods.map((method) => `${spec.className}.${method.name}`),
    outline: buildFileOutline(sourceFile).text,
  };
}
