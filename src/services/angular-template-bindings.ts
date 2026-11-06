import type { CompilerModule } from "./angular-templates.js";

/** What a consumer template can bind on the target: its selector and public binding names. */
export interface BindingTarget {
  readonly selector: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}
export type ConsumerBinding = "input" | "static_input" | "two_way" | "output";
export interface ConsumerUsage {
  readonly start: number;
  readonly end: number;
  readonly kind: string;
  readonly binding: ConsumerBinding;
  readonly bindingName: string;
}
export interface ConsumerScan {
  /** An element matched the target selector, whatever it binds. */
  matched: boolean;
  /** Something could not be proven (a span drifted or a selectorless node appeared). */
  opaque: boolean;
  usages: ConsumerUsage[];
}
export type SelectorCompiler = CompilerModule &
  Required<Pick<CompilerModule, "CssSelector" | "SelectorMatcher" | "createCssSelectorFromNode">>;

// BindingType.Property / TwoWay and ParsedEventType.Regular / TwoWay are stable across v18-v22.
// Animation members were renumbered in v20 and are deliberately never matched.
const PROPERTY = 0;
const TWO_WAY = 5;
const REGULAR_EVENT = 0;
const TWO_WAY_EVENT = 2;
const KINDS: Record<ConsumerBinding, string> = {
  input: "TemplateInputBinding",
  static_input: "TemplateAttribute",
  two_way: "TemplateTwoWayBinding",
  output: "TemplateOutputBinding",
};

/**
 * Cheap necessary condition: an alternative can match only if its element (or first attribute)
 * name occurs in the text. Alternatives with neither (such as `.card`) always require a parse.
 */
export function mayMatch(compiler: SelectorCompiler, selector: string, text: string): boolean {
  const lower = text.toLowerCase();
  return compiler.CssSelector.parse(selector).some((alternative: any) => {
    const required: string | undefined = alternative.element ?? alternative.attrs[0];
    return !required || required === "*" || lower.includes(required.toLowerCase());
  });
}

function pairedTwoWayInput(target: BindingTarget, event: string): boolean {
  return (
    target.outputs.includes(event) &&
    event.endsWith("Change") &&
    target.inputs.includes(event.slice(0, -"Change".length))
  );
}

/** Pure: finds the bindings of `target` in a parsed consumer template, matching by selector. */
export function extractConsumerUsages(
  compiler: SelectorCompiler,
  nodes: any[],
  text: string,
  target: BindingTarget,
  tick: () => void = () => {},
): ConsumerScan {
  const matcher = new compiler.SelectorMatcher();
  matcher.addSelectables(compiler.CssSelector.parse(target.selector));
  const scan: ConsumerScan = { matched: false, opaque: false, usages: [] };
  const add = (binding: ConsumerBinding, name: string, keySpan: any): void => {
    const start = keySpan?.start.offset;
    const end = keySpan?.end.offset;
    // Runtime check, not a typing: the key span must slice to exactly the binding name.
    if (start === undefined || text.slice(start, end) !== name) scan.opaque = true;
    else scan.usages.push({ start, end, kind: KINDS[binding], binding, bindingName: name });
  };
  const consider = (element: any): void => {
    let hit = false;
    matcher.match(compiler.createCssSelectorFromNode(element), () => (hit = true));
    if (!hit) return;
    scan.matched = true;
    for (const input of element.inputs) {
      const twoWay = input.type === TWO_WAY;
      if ((input.type === PROPERTY || twoWay) && target.inputs.includes(input.name)) {
        add(twoWay ? "two_way" : "input", input.name, input.keySpan);
      }
    }
    for (const attribute of element.attributes) {
      if (target.inputs.includes(attribute.name))
        add("static_input", attribute.name, attribute.keySpan);
    }
    for (const output of element.outputs) {
      // The event half of `[(x)]` on a model pair is already reported through the input half.
      if (output.type === TWO_WAY_EVENT && pairedTwoWayInput(target, output.name)) continue;
      const regular = output.type === REGULAR_EVENT || output.type === TWO_WAY_EVENT;
      if (regular && target.outputs.includes(output.name))
        add("output", output.name, output.keySpan);
    }
  };

  class Visitor extends (compiler.TmplAstRecursiveVisitor as new () => any) {
    visitElement(element: any): void {
      tick();
      consider(element);
      if (!element.attributes.some((attribute: any) => attribute.name === "ngNonBindable")) {
        super.visitElement(element);
      }
    }
    visitTemplate(template: any): void {
      tick();
      super.visitTemplate(template);
    }
    // Selectorless nodes reference classes by name, which selector matching cannot see.
    visitComponent(): void {
      scan.opaque = true;
    }
    visitDirective(): void {
      scan.opaque = true;
    }
  }
  compiler.tmplAstVisitAll(new Visitor(), nodes);
  return scan;
}
