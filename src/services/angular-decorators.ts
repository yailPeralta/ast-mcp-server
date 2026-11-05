import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Node, type ClassDeclaration, type Decorator } from "ts-morph";
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
