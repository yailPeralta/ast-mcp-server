import { Node, SyntaxKind, type ClassDeclaration } from "ts-morph";
import {
  bindingNames,
  declarableDecorator,
  isCoreDecorator,
  isMetadataPublic,
  isSelectorPublic,
  literalString,
  metadataBindingNames,
  type BindingNames,
} from "./angular-decorators.js";
import { memberOwner, type TemplateUsage } from "./angular-templates.js";
import type { ProjectContext } from "./project.js";
import { PublicOperationalError } from "./public-errors.js";

export interface TemplateEdit {
  readonly usage: TemplateUsage;
  readonly newText: string;
}

const blocked = (reason: string): PublicOperationalError =>
  new PublicOperationalError("MUTATION_BLOCKED", reason);

const CHANGE = "Change";

function selectorOf(cls: ClassDeclaration): string | undefined {
  const metadata = declarableDecorator(cls)?.getArguments()[0];
  if (!Node.isObjectLiteralExpression(metadata)) return undefined;
  const property = metadata.getProperty("selector");
  return literalString(Node.isPropertyAssignment(property) ? property.getInitializer() : undefined);
}

/** Public names of every selector-bound member of `cls` except `skip`; undefined when any is unknowable. */
function publicNames(cls: ClassDeclaration, skip?: Node): Set<string> | undefined {
  const names = new Set<string>();
  for (const member of cls.getMembers()) {
    if (member === skip) continue;
    const name = (member as Node & { getName?(): string }).getName?.();
    if (name === undefined) continue;
    const listed = isMetadataPublic(cls, name);
    if (!listed && !isSelectorPublic(member)) continue;
    // A member both decorated and listed in metadata has ambiguous binding names.
    const found: BindingNames | undefined =
      listed && isSelectorPublic(member)
        ? undefined
        : listed
          ? metadataBindingNames(cls, name)
          : bindingNames(member, name);
    if (!found) return undefined;
    [...found.inputs, ...found.outputs].forEach((entry) => names.add(entry));
  }
  return names;
}

/** Directives other than `target` whose selector matches the element of a consumer binding. */
function siblingDirectives(context: ProjectContext, target: ClassDeclaration): ClassDeclaration[] {
  return context.project
    .getSourceFiles()
    .filter((file) => !file.isDeclarationFile() && !file.isFromExternalLibrary())
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration))
    .filter(
      (cls) =>
        cls !== target &&
        cls
          .getDecorators()
          .some((decorator) =>
            ["Component", "Directive"].some((name) => isCoreDecorator(decorator, name)),
          ),
    );
}

function hasHostDirectives(cls: ClassDeclaration): boolean {
  return cls.getDecorators().some((decorator) => {
    const metadata = decorator.getArguments()[0];
    return Node.isObjectLiteralExpression(metadata) && !!metadata.getProperty("hostDirectives");
  });
}

/**
 * Plans the template edit of every usage with its own `newText`, or throws `MUTATION_BLOCKED` when
 * the rewrite cannot be proven safe. Must run before the TypeScript rename mutates the program.
 * Own-template usages are the member name itself. Consumer bindings use the public binding name:
 * an alias-keyed binding is left alone, and a `model()` event key becomes `<newName>Change`. A
 * binding key that another directive on the same element also publishes is never rewritten.
 */
export function planTemplateEdits(
  node: Node,
  usages: readonly TemplateUsage[],
  newName: string,
  context: ProjectContext,
): TemplateEdit[] {
  const owner = memberOwner(node);
  const consumers = usages.filter((usage) => usage.role === "consumer");
  if (!owner || !isSelectorPublic(node)) {
    return usages.map((usage) => ({ usage, newText: newName }));
  }
  const names = bindingNames(node, owner.name);
  if (!names) throw blocked("The public binding names of the member cannot be determined.");
  const isModel = names.inputs.length === 1 && names.outputs.length === 1;
  const published = [...names.inputs, ...names.outputs];
  const renamed = new Map(
    [
      [owner.name, newName],
      ...(isModel ? [[`${owner.name}${CHANGE}`, `${newName}${CHANGE}`]] : []),
    ].filter(([from]) => published.includes(from!)) as [string, string][],
  );
  if (renamed.size > 0) assertNewNamesFree(owner.cls, node, renamed, consumers, context);

  const edits: TemplateEdit[] = [];
  for (const usage of usages) {
    const newText = usage.role === "own" ? newName : renamed.get(usage.bindingName ?? "");
    if (newText === undefined) continue; // an alias-keyed binding still names the alias
    if (usage.binding === "two_way" && !isModel) {
      throw blocked(
        "A two-way binding needs a model() member: its paired event cannot be renamed.",
      );
    }
    edits.push({ usage, newText });
  }
  return edits;
}

function assertNewNamesFree(
  cls: ClassDeclaration,
  node: Node,
  renamed: ReadonlyMap<string, string>,
  consumers: readonly TemplateUsage[],
  context: ProjectContext,
): void {
  const incoming = [...renamed.values()];
  const others = publicNames(cls, node);
  if (!others) throw blocked("Another member's public binding names cannot be determined.");
  if (incoming.some((name) => others.has(name))) {
    throw blocked("The new name duplicates another input, output or alias of the same directive.");
  }
  const tokens = new Set(
    (selectorOf(cls) ?? "")
      .toLowerCase()
      .split(/[^\w$-]+/u)
      .filter(Boolean),
  );
  if ([...renamed.keys(), ...incoming].some((name) => tokens.has(name.toLowerCase()))) {
    throw blocked("The binding name appears in the directive's own selector.");
  }
  const siblings = siblingDirectives(context, cls);
  for (const usage of consumers) {
    for (const sibling of siblings) {
      const selector = selectorOf(sibling);
      if (selector === undefined || !usage.elementMatches?.(selector)) continue;
      const theirs = hasHostDirectives(sibling) ? undefined : publicNames(sibling);
      if (!theirs || incoming.some((name) => theirs.has(name))) {
        throw blocked(
          "Another directive on the same element binds the new name or cannot be listed.",
        );
      }
      // The binding key feeds both directives: rewriting it would unbind the sibling.
      if ([...renamed.keys()].some((name) => theirs.has(name))) {
        throw blocked("Another directive on the same element binds the name being renamed.");
      }
    }
  }
}
