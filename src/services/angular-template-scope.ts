import { Node, type ClassDeclaration } from "ts-morph";
import { componentDecorator, isAngularCoreExport } from "./angular-decorators.js";
import type { RequestContext } from "./request-context.js";

/** Whether a consumer component's compilation scope contains the target class. */
export type ScopeVerdict = "includes" | "excludes" | "opaque";
export interface ScopeBudget {
  /** Remaining scope visits for the whole request; shared and mutated. */
  scopeVisits: number;
}
export const MAX_SCOPE_VISITS = 10_000;

export class ScopeWorkExhausted extends Error {}

type Resolved = "target" | "other" | "external" | "opaque";

/** Follows aliases to the declarations a node refers to. */
function declarationsOf(node: Node): Node[] {
  const symbol = node.getSymbol();
  const resolved = symbol?.isAlias() ? (symbol.getAliasedSymbol() ?? symbol) : symbol;
  return resolved?.getDeclarations() ?? [];
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
  const classify = (expression: Node): Resolved => {
    tick();
    if (Node.isCallExpression(expression)) {
      const callee = expression.getExpression();
      const [arrow] = expression.getArguments();
      if (isAngularCoreExport(callee, "forwardRef")) {
        return Node.isArrowFunction(arrow) && !Node.isBlock(arrow.getBody())
          ? classify(arrow.getBody())
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
    if (isExternal(declaration)) return "external";
    if (declaration === target) return "target";
    // An in-project NgModule re-exports other classes; that scope is not resolved yet.
    return declaration
      .getDecorators()
      .some((d) => isAngularCoreExport(d.getExpression(), "NgModule"))
      ? "opaque"
      : "other";
  };
  const isExternal = (declaration: Node): boolean =>
    declaration.getSourceFile().isFromExternalLibrary();

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
    // Module-declared consumers need NgModule resolution, which is not implemented yet.
    if (!standalone) return "opaque";
    const imports = metadata.getProperty("imports");
    if (!imports) return "excludes";
    const list = Node.isPropertyAssignment(imports) ? imports.getInitializer() : undefined;
    if (!Node.isArrayLiteralExpression(list)) return "opaque";
    const results = list.getElements().map(classify);
    if (results.includes("target")) return "includes";
    return results.includes("opaque") ? "opaque" : "excludes";
  };
  return (consumer) => {
    let verdict = memo.get(consumer);
    if (!verdict) memo.set(consumer, (verdict = resolve(consumer)));
    return verdict;
  };
}
