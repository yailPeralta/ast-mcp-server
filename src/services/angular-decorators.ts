import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  Node,
  type ClassDeclaration,
  type Decorator,
  type PropertyAccessExpression,
} from "ts-morph";
import type { ProjectContext } from "./project.js";

/** The text of a plain string literal, or undefined for anything computed. */
export function literalString(node: Node | undefined): string | undefined {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)
    ? node.getLiteralText()
    : undefined;
}

/** Major version of the project's resolvable `@angular/core`, or undefined when unknown. */
export function angularCoreMajor(context: ProjectContext): number | undefined {
  try {
    const manifest = createRequire(context.tsConfigFilePath).resolve("@angular/core/package.json");
    const major = /^(\d+)\./u.exec(String(JSON.parse(readFileSync(manifest, "utf8")).version));
    return major ? Number(major[1]) : undefined;
  } catch {
    return undefined;
  }
}

/** True when `callee` names `exportName` imported from `@angular/core` (named, aliased, or namespace). */
export function isAngularCoreExport(callee: Node, exportName: string): boolean {
  return callee
    .getSourceFile()
    .getImportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue() === "@angular/core")
    .some((declaration) => {
      const namespace = declaration.getNamespaceImport();
      if (Node.isPropertyAccessExpression(callee)) {
        return (
          callee.getName() === exportName &&
          callee.getExpression().getText() === namespace?.getText()
        );
      }
      return declaration
        .getNamedImports()
        .some(
          (specifier) =>
            specifier.getName() === exportName &&
            (specifier.getAliasNode()?.getText() ?? exportName) === callee.getText(),
        );
    });
}

export function isCoreDecorator(decorator: Decorator, name: string): boolean {
  const callee = decorator.getCallExpression()?.getExpression();
  return callee !== undefined && isAngularCoreExport(callee, name);
}

function isComponentDecorator(decorator: Decorator): boolean {
  return isCoreDecorator(decorator, "Component");
}

export function componentDecorator(cls: ClassDeclaration): Decorator | undefined {
  return cls.getDecorators().find(isComponentDecorator);
}

/** The `@Component` decorator of a class, or else its `@Directive` decorator. */
export function declarableDecorator(cls: ClassDeclaration): Decorator | undefined {
  return (
    componentDecorator(cls) ??
    cls.getDecorators().find((decorator) => isCoreDecorator(decorator, "Directive"))
  );
}

/** Pipe usages live in other components' templates, which are never read. */
export function isPipeClass(cls: ClassDeclaration): boolean {
  return cls.getDecorators().some((decorator) => isCoreDecorator(decorator, "Pipe"));
}

/** Directives have no template; their selector-public members are bound only in consuming templates. */
export function isDirectiveClass(cls: ClassDeclaration): boolean {
  return cls.getDecorators().some((decorator) => isCoreDecorator(decorator, "Directive"));
}

/**
 * Members listed in the `inputs` / `outputs` metadata arrays of `@Component` / `@Directive`.
 * Fails closed: a non-literal array or element makes every member of the class public.
 */
export function isMetadataPublic(cls: ClassDeclaration, memberName: string): boolean {
  const literalName = literalString;
  const listsMember = (element: Node): boolean => {
    const text = literalName(element);
    if (text !== undefined) return text.split(":")[0]!.trim() === memberName;
    if (!Node.isObjectLiteralExpression(element)) return true;
    const name = element.getProperty("name");
    const value = Node.isPropertyAssignment(name) ? literalName(name.getInitializer()) : undefined;
    return value === undefined || value === memberName;
  };
  return cls
    .getDecorators()
    .filter((decorator) =>
      ["Component", "Directive"].some((name) => isCoreDecorator(decorator, name)),
    )
    .some((decorator) => {
      const metadata = decorator.getArguments()[0];
      if (!Node.isObjectLiteralExpression(metadata)) return false;
      return ["inputs", "outputs"].some((key) => {
        const property = metadata.getProperty(key);
        if (!property) return false;
        const list = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
        return !Node.isArrayLiteralExpression(list) || list.getElements().some(listsMember);
      });
    });
}

/** Members bound through the selector (`@Input`, `@Output`, `input()`, `output()`, `model()`). */
export function isSelectorPublic(node: Node): boolean {
  const decorated =
    Node.isDecoratable(node) &&
    node
      .getDecorators()
      .some((decorator) => ["Input", "Output"].some((name) => isCoreDecorator(decorator, name)));
  if (decorated || !Node.isPropertyDeclaration(node)) return decorated;
  const initializer = node.getInitializer();
  if (!Node.isCallExpression(initializer)) return false;
  let callee = initializer.getExpression();
  if (Node.isPropertyAccessExpression(callee) && callee.getName() === "required") {
    callee = callee.getExpression(); // input.required(...) / model.required(...)
  }
  return ["input", "output", "model"].some((name) => isAngularCoreExport(callee, name));
}

/** Public names a consumer template binds for one member. */
export interface BindingNames {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

/** The alias in a literal options object (or a literal string), the fallback when absent, else undefined. */
function aliasOf(options: Node | undefined, fallback: string): string | undefined {
  if (options === undefined) return fallback;
  const text = literalString(options);
  if (text !== undefined) return text;
  if (!Node.isObjectLiteralExpression(options)) return undefined;
  const properties = options.getProperties();
  const computed = (property: Node): boolean =>
    Node.isPropertyAssignment(property) && Node.isComputedPropertyName(property.getNameNode());
  if (properties.some((property) => Node.isSpreadAssignment(property) || computed(property))) {
    return undefined;
  }
  const alias = options.getProperty("alias");
  if (alias === undefined) return fallback;
  return Node.isPropertyAssignment(alias) ? literalString(alias.getInitializer()) : undefined;
}

/**
 * Public binding names of an `@Input` / `@Output` / `input()` / `output()` / `model()` member,
 * following literal aliases. A `model()` binds `x` and `xChange`. Undefined when an alias or the
 * options are not literal, because the binding name then cannot be known.
 */
export function bindingNames(node: Node, name: string): BindingNames | undefined {
  if (Node.isDecoratable(node)) {
    for (const decorator of node.getDecorators()) {
      const kind = (["Input", "Output"] as const).find((id) => isCoreDecorator(decorator, id));
      if (!kind) continue;
      const args = decorator.getArguments();
      const alias = args.length <= 1 ? aliasOf(args[0], name) : undefined;
      if (alias === undefined || (kind === "Output" && args[0] && !literalString(args[0]))) {
        return undefined;
      }
      return kind === "Input" ? { inputs: [alias], outputs: [] } : { inputs: [], outputs: [alias] };
    }
  }
  const initializer = Node.isPropertyDeclaration(node) ? node.getInitializer() : undefined;
  if (!Node.isCallExpression(initializer)) return undefined;
  let callee = initializer.getExpression();
  const required = Node.isPropertyAccessExpression(callee) && callee.getName() === "required";
  if (required) callee = (callee as PropertyAccessExpression).getExpression();
  const kind = (["input", "model", "output"] as const).find((id) =>
    isAngularCoreExport(callee, id),
  );
  if (!kind) return undefined;
  // The initial value comes first for input() and model(); required() and output() take options only.
  const optionsAt = kind !== "output" && !required ? 1 : 0;
  const args = initializer.getArguments();
  if (args.length > optionsAt + 1) return undefined;
  const alias = aliasOf(args[optionsAt], name);
  if (alias === undefined) return undefined;
  if (kind === "input") return { inputs: [alias], outputs: [] };
  if (kind === "output") return { inputs: [], outputs: [alias] };
  return { inputs: [alias], outputs: [`${alias}Change`] };
}

/**
 * Public names of a member listed in the `inputs` / `outputs` metadata (`'x'`, `'x: alias'`,
 * `{ name, alias }`). Undefined when any array or element is not literal, matching #410's fail-closed rule.
 */
export function metadataBindingNames(
  cls: ClassDeclaration,
  name: string,
): BindingNames | undefined {
  const found = { inputs: [] as string[], outputs: [] as string[] };
  for (const decorator of cls.getDecorators()) {
    if (!["Component", "Directive"].some((id) => isCoreDecorator(decorator, id))) continue;
    const metadata = decorator.getArguments()[0];
    if (!Node.isObjectLiteralExpression(metadata)) continue;
    for (const key of ["inputs", "outputs"] as const) {
      const property = metadata.getProperty(key);
      if (!property) continue;
      const list = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
      if (!Node.isArrayLiteralExpression(list)) return undefined;
      for (const element of list.getElements()) {
        let listed: string;
        let alias: string | undefined;
        const text = literalString(element);
        if (text !== undefined) {
          const [member = "", rest] = text.split(":");
          listed = member.trim();
          alias = rest === undefined ? listed : rest.trim();
        } else if (Node.isObjectLiteralExpression(element)) {
          const nameProperty = element.getProperty("name");
          const value = Node.isPropertyAssignment(nameProperty)
            ? literalString(nameProperty.getInitializer())
            : undefined;
          if (value === undefined) return undefined;
          listed = value;
          alias = aliasOf(element, listed);
        } else {
          return undefined;
        }
        if (listed !== name) continue;
        if (alias === undefined) return undefined;
        found[key].push(alias);
      }
    }
  }
  return found;
}
