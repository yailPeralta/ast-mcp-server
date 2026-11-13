import { Node, SyntaxKind, type ClassDeclaration, type ObjectLiteralExpression } from "ts-morph";
import {
  componentDecorator,
  declarableDecorator,
  isAngularCoreExport,
  isCoreDecorator,
} from "./angular-decorators.js";
import type { RequestContext } from "./request-context.js";

/** Whether a consumer component's compilation scope contains the target class. */
export type ScopeVerdict = "includes" | "excludes" | "opaque";
export interface ScopeBudget {
  /** Remaining scope visits for the whole request; shared and mutated. */
  scopeVisits: number;
}
export const MAX_SCOPE_VISITS = 10_000;
export const MAX_SCOPE_DEPTH = 32;

export class ScopeWorkExhausted extends Error {}

type Reference = ClassDeclaration | "external" | "opaque";
type Contribution = "target" | "other" | "opaque";

/** Follows aliases to the declarations a node refers to. */
function declarationsOf(node: Node): Node[] {
  const symbol = node.getSymbol();
  const resolved = symbol?.isAlias() ? (symbol.getAliasedSymbol() ?? symbol) : symbol;
  return resolved?.getDeclarations() ?? [];
}

const isExternal = (declaration: Node): boolean =>
  declaration.getSourceFile().isFromExternalLibrary();

function ngModuleMetadata(cls: ClassDeclaration): ObjectLiteralExpression | "opaque" | undefined {
  const decorator = cls.getDecorators().find((candidate) => isCoreDecorator(candidate, "NgModule"));
  if (!decorator) return undefined;
  const metadata = decorator.getArguments()[0];
  return Node.isObjectLiteralExpression(metadata) ? metadata : "opaque";
}

/** Elements of a metadata array: none when the key is absent, `opaque` when not an array literal. */
function listOf(metadata: ObjectLiteralExpression, key: string): Node[] | "opaque" {
  const property = metadata.getProperty(key);
  if (!property) return [];
  const list = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  return Node.isArrayLiteralExpression(list) ? list.getElements() : "opaque";
}

/**
 * Whether a class in `declarables` may apply `target` as a host directive: its `hostDirectives`
 * names the target, or cannot be read as a literal list of resolved classes. A host directive
 * publishes the target's inputs and outputs on another selector, under names of its choosing.
 */
export function mayBeHostDirective(
  target: ClassDeclaration,
  declarables: readonly ClassDeclaration[],
): boolean {
  const namesTarget = (element: Node): boolean => {
    let reference: Node | undefined = element;
    if (Node.isObjectLiteralExpression(element)) {
      const property = element.getProperty("directive");
      const spread = element.getProperties().some((entry) => Node.isSpreadAssignment(entry));
      reference =
        !spread && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
    }
    if (!Node.isIdentifier(reference)) return true;
    const declarations = declarationsOf(reference);
    const [declaration] = declarations;
    if (declarations.length !== 1 || !Node.isClassDeclaration(declaration)) return true;
    return declaration === target;
  };
  return declarables.some((cls) => {
    if (cls === target) return false;
    const decorator = declarableDecorator(cls);
    const metadata = decorator?.getArguments()[0];
    if (!decorator || metadata === undefined) return false;
    if (!Node.isObjectLiteralExpression(metadata)) return true;
    if (metadata.getProperties().some((entry) => Node.isSpreadAssignment(entry))) return true;
    const property = metadata.getProperty("hostDirectives");
    if (!property) return false;
    const list = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
    return !Node.isArrayLiteralExpression(list) || list.getElements().some(namesTarget);
  });
}

function merge(results: readonly Contribution[]): Contribution {
  if (results.includes("target")) return "target";
  return results.includes("opaque") ? "opaque" : "other";
}

/**
 * Resolves, with ts-morph only, whether the target is in a consumer's scope. Memoized per
 * request. Anything that cannot be proven is `opaque`; the caller decides what that costs.
 */
export function createScopeResolver(
  target: ClassDeclaration,
  options: { coreMajor: number | undefined; budget: ScopeBudget; rc: RequestContext },
): (consumer: ClassDeclaration) => ScopeVerdict {
  const memo = new Map<ClassDeclaration, ScopeVerdict>();
  const tick = (): void => {
    if (--options.budget.scopeVisits < 0) throw new ScopeWorkExhausted();
    options.rc.checkpoint();
  };
  const referenceOf = (expression: Node): Reference => {
    tick();
    if (Node.isCallExpression(expression)) {
      const callee = expression.getExpression();
      const [arrow] = expression.getArguments();
      if (isAngularCoreExport(callee, "forwardRef")) {
        return Node.isArrowFunction(arrow) && !Node.isBlock(arrow.getBody())
          ? referenceOf(arrow.getBody())
          : "opaque";
      }
      let root: Node = callee;
      while (Node.isPropertyAccessExpression(root)) root = root.getExpression();
      // A library cannot export project classes, so its calls never add the target.
      const declarations = Node.isIdentifier(root) ? declarationsOf(root) : [];
      return declarations.length > 0 && declarations.every(isExternal) ? "external" : "opaque";
    }
    if (!Node.isIdentifier(expression)) return "opaque";
    const declarations = declarationsOf(expression);
    const [declaration] = declarations;
    if (declarations.length !== 1 || !Node.isClassDeclaration(declaration)) return "opaque";
    return isExternal(declaration) ? "external" : declaration;
  };

  /** What an element of `imports` / `exports` makes visible: itself, or a module's exports. */
  const contribution = (
    expression: Node,
    trail: Set<ClassDeclaration>,
    depth: number,
  ): Contribution => {
    const reference = referenceOf(expression);
    if (reference === "external") return "other";
    if (reference === "opaque") return "opaque";
    if (reference === target) return "target";
    const metadata = ngModuleMetadata(reference);
    if (!metadata) return "other";
    if (trail.has(reference)) return "other";
    if (depth > MAX_SCOPE_DEPTH || metadata === "opaque") return "opaque";
    if (reference.getSourceFile().isDeclarationFile()) return "opaque";
    trail.add(reference);
    const exported = listOf(metadata, "exports");
    if (exported === "opaque") return "opaque";
    return merge(exported.map((element) => contribution(element, trail, depth + 1)));
  };
  const scopeOf = (imports: readonly Node[], trail: Set<ClassDeclaration>): Contribution =>
    merge(imports.map((element) => contribution(element, trail, 1)));
  const verdictOf = (found: Contribution): ScopeVerdict =>
    found === "target" ? "includes" : found === "opaque" ? "opaque" : "excludes";

  interface DeclaringModule {
    metadata: ObjectLiteralExpression;
    declared: Set<Node>;
  }
  let declaring: { modules: DeclaringModule[]; opaque: boolean } | undefined;
  /** Every project NgModule with the classes it declares; built once, on first module consumer. */
  const declaringModules = () => {
    if (declaring) return declaring;
    declaring = { modules: [], opaque: false };
    const classes = target
      .getProject()
      .getSourceFiles()
      .filter(
        (file) =>
          !file.isDeclarationFile() &&
          !file.isFromExternalLibrary() &&
          file.getFullText().includes("NgModule"),
      )
      .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration));
    for (const cls of classes) {
      const metadata = ngModuleMetadata(cls);
      if (!metadata) continue;
      const list = metadata === "opaque" ? "opaque" : listOf(metadata, "declarations");
      const references = list === "opaque" ? [] : list.map(referenceOf);
      if (metadata === "opaque" || list === "opaque" || references.includes("opaque")) {
        declaring.opaque = true;
        continue;
      }
      declaring.modules.push({
        metadata,
        declared: new Set(references.filter((reference) => typeof reference !== "string")),
      });
    }
    return declaring;
  };

  const resolve = (consumer: ClassDeclaration): ScopeVerdict => {
    if (consumer === target) return "includes";
    const metadata = componentDecorator(consumer)?.getArguments()[0];
    if (!Node.isObjectLiteralExpression(metadata)) return "opaque";
    const flag = metadata.getProperty("standalone");
    const initializer = Node.isPropertyAssignment(flag) ? flag.getInitializer() : undefined;
    if (flag && !Node.isTrueLiteral(initializer) && !Node.isFalseLiteral(initializer)) {
      return "opaque";
    }
    const standalone = flag
      ? Node.isTrueLiteral(initializer)
      : options.coreMajor !== undefined && options.coreMajor >= 19;
    const trail = new Set<ClassDeclaration>();
    if (!standalone) {
      if (!flag && options.coreMajor === undefined) return "opaque";
      const { modules, opaque } = declaringModules();
      const owners = modules.filter((module) => module.declared.has(consumer));
      if (opaque || owners.length !== 1) return "opaque";
      const [owner] = owners;
      if (owner!.declared.has(target)) return "includes";
      const imports = listOf(owner!.metadata, "imports");
      return imports === "opaque" ? "opaque" : verdictOf(scopeOf(imports, trail));
    }
    const imports = listOf(metadata, "imports");
    return imports === "opaque" ? "opaque" : verdictOf(scopeOf(imports, trail));
  };
  return (consumer) => {
    let verdict = memo.get(consumer);
    if (!verdict) memo.set(consumer, (verdict = resolve(consumer)));
    return verdict;
  };
}
