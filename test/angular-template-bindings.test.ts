import { describe, expect, it } from "vitest";
import {
  extractConsumerUsages,
  mayMatch,
  type BindingTarget,
} from "../src/services/angular-template-bindings.js";
import { compilerMajorSupportedByNode } from "./helpers/angular-fixture.js";

const TARGET: BindingTarget = { selector: "app-card", inputs: ["x"], outputs: ["y"] };
const OPTIONS = { preserveWhitespaces: true };

describe.each([18, 19, 20, 21, 22] as const)("template bindings with compiler v%i", (major) => {
  const run = it.skipIf(!compilerMajorSupportedByNode(major));
  const load = async (): Promise<any> => import(`angular-compiler-v${major}`);
  const scan = async (html: string, target = TARGET, source = html, options: object = OPTIONS) => {
    const compiler = await load();
    const parsed = compiler.parseTemplate(html, "t.html", options);
    return extractConsumerUsages(compiler, parsed.nodes, source, target);
  };
  const described = (html: string, result: Awaited<ReturnType<typeof scan>>) =>
    result.usages.map((usage) => `${usage.binding}:${html.slice(usage.start, usage.end)}`);

  run("compiler contract: binding types, key spans and selector API", async () => {
    const compiler = await load();
    const html = `<app-card [x]="a" (y)="b()" [(w)]="c" bind-p="d" on-q="e()" bindon-r="f" s="lit"></app-card>`;
    const [element] = compiler.parseTemplate(html, "t.html", OPTIONS).nodes;
    const slice = (span: any) => html.slice(span.start.offset, span.end.offset);
    const named = (list: any[]) =>
      list.map((item) => `${item.type}:${item.name}=${slice(item.keySpan)}`);
    expect(named(element.inputs)).toEqual(["0:x=x", "5:w=w", "0:p=p", "5:r=r"]);
    expect(named(element.outputs)).toEqual(["0:y=y", "2:wChange=w", "0:q=q", "2:rChange=r"]);
    expect(element.attributes.map((attribute: any) => slice(attribute.keySpan))).toEqual(["s"]);
    const selector = compiler.createCssSelectorFromNode(element);
    expect(selector.attrs.filter((_: string, index: number) => index % 2 === 0)).toEqual(
      expect.arrayContaining(["x", "y", "w", "wChange"]),
    );
  });

  run("compiler contract: BindingPipe.nameSpan slices to the pipe name", async () => {
    const compiler = await load();
    const html = `{{ a | fmt | fmt: (b | fmt) }}<p [x]="c | fmt"></p>@if (d | fmt) {{{ e | fmt }}}`;
    const spans: string[] = [];
    class Pipes extends compiler.RecursiveAstVisitor {
      visitPipe(ast: any, context?: any): void {
        spans.push(html.slice(ast.nameSpan.start, ast.nameSpan.end));
        super.visitPipe(ast, context);
      }
    }
    class Nodes extends compiler.TmplAstRecursiveVisitor {
      visitBoundText(text: any): void {
        text.value.ast.visit(new Pipes());
      }
      visitBoundAttribute(attribute: any): void {
        attribute.value.ast.visit(new Pipes());
      }
      visitIfBlockBranch(branch: any): void {
        branch.expression.visit(new Pipes());
        super.visitIfBlockBranch(branch);
      }
    }
    compiler.tmplAstVisitAll(new Nodes(), compiler.parseTemplate(html, "t.html", OPTIONS).nodes);
    expect(spans).toEqual(["fmt", "fmt", "fmt", "fmt", "fmt", "fmt"]);
  });

  run.each([
    [`<app-card [x]="a">`, ["input:x"]],
    [`<app-card bind-x="a">`, ["input:x"]],
    [`<app-card [(x)]="a">`, ["two_way:x"]],
    [`<app-card bindon-x="a">`, ["two_way:x"]],
    [`<app-card (y)="f()">`, ["output:y"]],
    [`<app-card on-y="f()">`, ["output:y"]],
    [`<app-card x="lit">`, ["static_input:x"]],
    [`<app-card [attr.x]="1" [class.x]="1" [style.x]="1" [@x]="1" (@y)="f()">`, []],
    [`<app-card [z]="1">`, []],
  ])("reports %s as %j", async (html, expected) => {
    const result = await scan(html);
    expect(result.matched).toBe(true);
    expect(described(html, result)).toEqual(expected);
  });

  run.each([
    [`<app-card [x]="a">`, ["input:x"]],
    [`<app-card [(x)]="a">`, ["two_way:x"]],
    [`<app-card bindon-x="a">`, ["two_way:x"]],
    [`<app-card (xChange)="f($event)">`, ["output:xChange"]],
    [`<app-card on-xChange="f($event)">`, ["output:xChange"]],
    [`<app-card [x]="a" (xChange)="b = $event">`, ["input:x", "output:xChange"]],
    [`<app-card [(x)]="a" (xChange)="b = $event">`, ["two_way:x", "output:xChange"]],
  ])("model pair x/xChange reports %s as %j", async (html, expected) => {
    const result = await scan(html, { ...TARGET, inputs: ["x"], outputs: ["xChange"] });
    expect(result.opaque).toBe(false);
    expect(described(html, result)).toEqual(expected);
  });

  run.each([
    ["app-card", `<app-card [x]="1">`, true],
    ["app-card", `<app-other [x]="1">`, false],
    ["[appCard]", `<div appCard [x]="1">`, true],
    [".card", `<div class="card" [x]="1">`, true],
    [".card", `<div class="other" [x]="1">`, false],
    ["app-card:not(.skip)", `<app-card class="skip" [x]="1">`, false],
  ])("matches selector %s against %s: %s", async (selector, html, matched) => {
    const result = await scan(html, { ...TARGET, selector });
    expect(result.matched).toBe(matched);
    expect(result.usages).toHaveLength(matched ? 1 : 0);
  });

  run("visits template and control-flow children but skips ngNonBindable subtrees", async () => {
    const html = `<ng-template><app-card [x]="1"></app-card></ng-template>
<app-card *ngIf="c" [x]="2"></app-card>
@if (c) { <app-card [x]="3"/> } @for (r of rows; track r) { <app-card [x]="r"/> }
<div ngNonBindable><app-card [x]="4"></app-card></div>`;
    const result = await scan(html);
    expect(described(html, result)).toEqual(["input:x", "input:x", "input:x", "input:x"]);
    expect(result.usages.map((usage) => html.slice(usage.end + 3, usage.end + 4))).toEqual([
      "1",
      "2",
      "3",
      "r",
    ]);
  });

  run("a span that does not slice to the binding name is opaque", async () => {
    const result = await scan(`<app-card [x]="a">`, TARGET, `  <app-card [x]="a">`);
    expect(result).toMatchObject({ matched: true, opaque: true, usages: [] });
  });

  run("a two-way event named like a target output is opaque", async () => {
    const result = await scan(`<app-card [(w)]="a">`, {
      ...TARGET,
      inputs: [],
      outputs: ["wChange"],
    });
    expect(result).toMatchObject({ matched: true, opaque: true, usages: [] });
  });

  it.skipIf(major < 20 || !compilerMajorSupportedByNode(major))(
    "selectorless nodes fail closed",
    async () => {
      const result = await scan(`<AppCard [x]="a" />`, TARGET, `<AppCard [x]="a" />`, {
        ...OPTIONS,
        enableSelectorless: true,
      });
      expect(result.opaque).toBe(true);
    },
  );

  run("prefilter skips only templates lacking every selector alternative", async () => {
    const compiler = await load();
    const selector = "app-card, [appCard]";
    expect(mayMatch(compiler, selector, `<APP-CARD></APP-CARD>`)).toBe(true);
    expect(mayMatch(compiler, selector, `<div appcard></div>`)).toBe(true);
    expect(mayMatch(compiler, selector, `<div></div>`)).toBe(false);
    expect(mayMatch(compiler, ".card", `<div></div>`)).toBe(true);
  });
});
