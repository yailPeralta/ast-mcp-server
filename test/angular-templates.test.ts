import { link, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectTemplateUsages,
  listTemplateFiles,
  type TemplateCoverage,
} from "../src/services/angular-templates.js";
import {
  createFreshProject,
  findDeclarationByName,
  getSourceFileOrThrow,
  type ProjectContext,
} from "../src/services/project.js";
import {
  NO_REQUEST_CONTEXT,
  RequestContextError,
  type RequestContext,
} from "../src/services/request-context.js";
import {
  compilerMajorSupportedByNode,
  createAngularFixture,
  type AngularCompilerAlias,
  type AngularFixture,
} from "./helpers/angular-fixture.js";
import { createProjectFixture } from "./helpers/project-fixture.js";

const COMPONENT = (
  decorator = `templateUrl: "./a.component.html"`,
  extra = "",
  cls = "AComponent",
) =>
  `import { Component } from "@angular/core";
@Component({ selector: "app-a", ${decorator} })
export class ${cls} {
  title = "x"; item = 1; event = 2; items = [1]; limit = 3; user = null; ref = 1;
  count = () => 1;
  save(): void {}
  ${extra}
}
`;

const created: AngularFixture[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((fixture) => fixture.cleanup()));
});

async function setup(
  files: Record<string, string>,
  options: Parameters<typeof createAngularFixture>[1] = { compiler: "v21" },
): Promise<{ root: string; context: ProjectContext; write: AngularFixture["write"] }> {
  const fixture = await createAngularFixture(
    { "src/a.component.ts": COMPONENT(), ...files },
    options,
  );
  created.push(fixture);
  return { root: fixture.root, context: createFreshProject(fixture.root), write: fixture.write };
}

function usagesOf(
  context: ProjectContext,
  symbol: string,
  rc: RequestContext = NO_REQUEST_CONTEXT,
  file = "src/a.component.ts",
) {
  const node = findDeclarationByName(getSourceFileOrThrow(context.project, file), symbol);
  return collectTemplateUsages(node, context, rc);
}

async function coverageOf(
  files: Record<string, string>,
  options?: Parameters<typeof createAngularFixture>[1],
): Promise<TemplateCoverage> {
  const { context } = await setup(files, options);
  return (await usagesOf(context, "AComponent.title")).coverage;
}

/** Fake compiler package whose entry would throw if it were ever evaluated. */
async function writeFakeCompiler(
  write: AngularFixture["write"],
  version: string,
  entry = `throw new Error("must not be evaluated");\n`,
): Promise<void> {
  const dir = "node_modules/@angular/compiler";
  await write(
    `${dir}/package.json`,
    JSON.stringify({
      name: "@angular/compiler",
      version,
      type: "module",
      exports: { ".": "./index.mjs", "./package.json": "./package.json" },
    }),
  );
  await write(`${dir}/index.mjs`, entry);
}

describe("detection and compiler gate", () => {
  it("core absent returns not_applicable and lists no templates", async () => {
    const fixture = await createProjectFixture({
      "src/a.component.ts": COMPONENT(),
      "src/a.component.html": "<p>{{ title }}</p>",
    });
    try {
      const context = createFreshProject(fixture.root);
      expect(await usagesOf(context, "AComponent.title")).toEqual({
        coverage: { status: "not_applicable" },
        usages: [],
      });
      expect(listTemplateFiles(context)).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("compiler missing yields unfinished/compiler_missing", async () => {
    const files = { "src/a.component.html": "<p>{{ title }}</p>" };
    expect(await coverageOf(files, { compiler: null })).toEqual({
      status: "unfinished",
      reason: "compiler_missing",
      templates: 0,
    });
  });

  it.each(["17.3.12", "23.0.0", "18.0.0-next.1"])(
    "out-of-range version %s yields compiler_unsupported without evaluating it",
    async (version) => {
      const { context, write } = await setup(
        { "src/a.component.html": "<p>{{ title }}</p>" },
        { compiler: null },
      );
      await writeFakeCompiler(write, version);
      const { coverage } = await usagesOf(context, "AComponent.title");
      expect(coverage).toMatchObject({ status: "unfinished", reason: "compiler_unsupported" });
    },
  );

  it("missing required export yields compiler_unsupported", async () => {
    const { context, write } = await setup(
      { "src/a.component.html": "<p>{{ title }}</p>" },
      { compiler: null },
    );
    await writeFakeCompiler(write, "21.0.0", "export const parseTemplate = () => ({});\n");
    const { coverage } = await usagesOf(context, "AComponent.title");
    expect(coverage).toMatchObject({ status: "unfinished", reason: "compiler_unsupported" });
  });

  it("realpath outside ancestor node_modules is rejected (os.tmpdir fixture)", async () => {
    const files = { "src/a.component.html": "<p>{{ title }}</p>" };
    expect(await coverageOf(files, { compiler: "v21", location: "os-tmp" })).toMatchObject({
      status: "unfinished",
      reason: "compiler_unsupported",
    });
    // The same layout inside the repository resolves, so the rejection is containment.
    expect((await coverageOf(files, { compiler: "v21" })).status).toBe("completed");
  });

  describe.each([
    ["v18", 18],
    ["v19", 19],
    ["v20", 20],
    ["v21", 21],
    ["v22", 22],
  ] as const)("compiler %s", (alias: AngularCompilerAlias, major) => {
    it.skipIf(!compilerMajorSupportedByNode(major))("loads supported major", async () => {
      const { context } = await setup(
        { "src/a.component.html": "<p>{{ title }}</p>" },
        { compiler: alias },
      );
      const result = await usagesOf(context, "AComponent.title");
      expect(result.coverage).toEqual({ status: "completed", templates: 1 });
      expect(result.usages.map((usage) => usage.kind)).toEqual(["TemplatePropertyRead"]);
    });
  });

  it("listTemplateFiles does not load the compiler", async () => {
    const { context, root, write } = await setup(
      { "src/a.component.html": "<p>{{ title }}</p>" },
      { compiler: null },
    );
    await writeFakeCompiler(write, "21.0.0");
    const files = listTemplateFiles(context);
    expect(files).toEqual([path.join(root, "src", "a.component.html")]);
    expect(files).not.toBeInstanceOf(Promise);
  });
});

describe("template location", () => {
  it("resolves literal templateUrl", async () => {
    const html = "<p>{{ title }}</p>\n<b>{{ save() }}</b>";
    for (const decorator of [
      `templateUrl: "./a.component.html"`,
      "templateUrl: `a.component.html`",
    ]) {
      const { context, root } = await setup({
        "src/a.component.ts": COMPONENT(decorator),
        "src/a.component.html": html,
      });
      const { coverage, usages } = await usagesOf(context, "AComponent.title");
      expect(coverage).toEqual({ status: "completed", templates: 1 });
      expect(usages).toHaveLength(1);
      expect(usages[0]).toMatchObject({
        absolutePath: path.join(root, "src", "a.component.html"),
        file: path.join("src", "a.component.html"),
        container: "external",
        start: 6,
        end: 11,
        line: 1,
        column: 7,
      });
      expect(usages[0]?.fileHash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("same member name in another component is not a usage", async () => {
    const { context } = await setup({
      "src/a.component.html": "<p>{{ title }}</p>",
      "src/b.component.ts": COMPONENT(`templateUrl: "./b.component.html"`, "", "BComponent"),
      "src/b.component.html": "<p>{{ title }} {{ title }}</p>",
    });
    const first = await usagesOf(context, "AComponent.title");
    const second = await usagesOf(
      context,
      "BComponent.title",
      NO_REQUEST_CONTEXT,
      "src/b.component.ts",
    );
    expect(first.usages.map((usage) => path.basename(usage.file))).toEqual(["a.component.html"]);
    expect(second.usages.map((usage) => path.basename(usage.file))).toEqual([
      "b.component.html",
      "b.component.html",
    ]);
  });

  it("templateUrl escaping root is template_unsafe", async () => {
    const escaped = { status: "unfinished", reason: "template_unsafe", templates: 0 };
    expect(
      await coverageOf({ "src/a.component.ts": COMPONENT(`templateUrl: "../../outside.html"`) }),
    ).toEqual(escaped);
  });

  it("symlink/hardlink template is template_unsafe", async () => {
    const unsafe = { status: "unfinished", reason: "template_unsafe", templates: 0 };
    const symlinked = await setup({ "src/real.html": "<p>{{ title }}</p>" });
    await symlink("real.html", path.join(symlinked.root, "src", "a.component.html"));
    expect((await usagesOf(symlinked.context, "AComponent.title")).coverage).toEqual(unsafe);

    const hardlinked = await setup({ "src/real.html": "<p>{{ title }}</p>" });
    await link(
      path.join(hardlinked.root, "src", "real.html"),
      path.join(hardlinked.root, "src", "a.component.html"),
    );
    const result = await usagesOf(hardlinked.context, "AComponent.title");
    expect(result).toEqual({ coverage: unsafe, usages: [] });
  });

  it("computed templateUrl is template_unresolved", async () => {
    const computed = { status: "unfinished", reason: "template_unresolved", templates: 0 };
    for (const decorator of [
      `templateUrl: TEMPLATE`,
      "templateUrl: `./${'a'}.component.html`",
      `templateUrl: "./missing.html"`,
    ]) {
      const source = `const TEMPLATE = "./a.component.html";\n${COMPONENT(decorator)}`;
      expect(
        await coverageOf({
          "src/a.component.ts": source,
          "src/a.component.html": "<p>{{ title }}</p>",
        }),
      ).toEqual(computed);
    }
  });

  it("derived component yields unsupported/inherited_member", async () => {
    const { context } = await setup({
      "src/a.component.html": "<p>{{ title }}</p>",
      "src/b.component.ts": `import { Component } from "@angular/core";
import { AComponent } from "./a.component";
@Component({ selector: "app-b", template: "<p>{{ title }}</p>" })
export class BComponent extends AComponent {}
`,
    });
    const result = await usagesOf(context, "AComponent.title");
    expect(result.coverage).toEqual({
      status: "unsupported",
      reason: "inherited_member",
      templates: 0,
    });
    expect(result.usages).toEqual([]);
  });
});

const PUBLIC = (member: string, imports = "Component, Input, Output, Pipe, input, model, output") =>
  `import { ${imports} } from "@angular/core";
@Component({ selector: "app-a", templateUrl: "./a.component.html" })
export class AComponent {
  ${member}
}
`;
const PIPE = `import { Pipe } from "@angular/core";
@Pipe({ name: "fmt" })
export class FmtPipe {
  transform(value: string): string { return value; }
}
`;
const CROSS_COMPONENT = { status: "unfinished", reason: "cross_component", templates: 1 };

describe("selector-public members and pipes", () => {
  const publicUsages = async (member: string, html = "<p>{{ title }}</p>") => {
    const { context } = await setup({
      "src/a.component.ts": PUBLIC(member),
      "src/a.component.html": html,
    });
    return usagesOf(context, "AComponent.title");
  };

  it("@Input member keeps own-template usages but is unfinished/cross_component", async () => {
    const result = await publicUsages(`@Input() title = "x";`);
    expect(result.coverage).toEqual(CROSS_COMPONENT);
    expect(result.usages.map((usage) => usage.kind)).toEqual(["TemplatePropertyRead"]);
  });

  it("@Output member is unfinished/cross_component", async () => {
    const result = await publicUsages(`@Output() title = output<string>();`);
    expect(result.coverage).toEqual(CROSS_COMPONENT);
  });

  it.each([
    `title = input("x");`,
    `title = input.required<string>();`,
    `title = model("x");`,
    `title = model.required<string>();`,
    `title = output<string>();`,
  ])("signal member %s is unfinished/cross_component", async (member) => {
    const result = await publicUsages(member, "<p>{{ title() }}</p>");
    expect(result.coverage).toEqual(CROSS_COMPONENT);
    expect(result.usages.map((usage) => usage.kind)).toEqual(["TemplateCall"]);
  });

  it("aliased and namespace imports from @angular/core count", async () => {
    const aliased = PUBLIC(`@Prop() title = "x";`, "Component, Input as Prop");
    const namespaced = `import * as ng from "@angular/core";
@ng.Component({ selector: "app-a", templateUrl: "./a.component.html" })
export class AComponent { title = ng.input.required<string>(); }
`;
    for (const source of [aliased, namespaced]) {
      const { context } = await setup({
        "src/a.component.ts": source,
        "src/a.component.html": "<p>none</p>",
      });
      expect((await usagesOf(context, "AComponent.title")).coverage).toEqual(CROSS_COMPONENT);
    }
  });

  it("Input decorator or input() from another module is a plain member", async () => {
    const decorators = `export const Input = (): PropertyDecorator => () => {};
export const input = <T>(value: T) => () => value;
`;
    for (const member of [`@Input() title = "x";`, `title = input("x");`]) {
      const { context } = await setup({
        "src/a.component.ts": `import { Input, input } from "./decorators";
${PUBLIC(member, "Component")}`,
        "src/decorators.ts": decorators,
        "src/a.component.html": "<p>none</p>",
      });
      expect((await usagesOf(context, "AComponent.title")).coverage).toEqual({
        status: "completed",
        templates: 1,
      });
    }
  });

  it("plain member next to an @Input stays completed", async () => {
    const result = await publicUsages(`@Input() other = 1;
  title = "x";`);
    expect(result.coverage).toEqual({ status: "completed", templates: 1 });
    expect(result.usages).toHaveLength(1);
  });

  it("own-template failure keeps its own reason for an @Input", async () => {
    const { context } = await setup({
      "src/a.component.ts": PUBLIC(`@Input() title = "x";`).replace(
        "./a.component.html",
        "./missing.html",
      ),
    });
    expect((await usagesOf(context, "AComponent.title")).coverage).toEqual({
      status: "unfinished",
      reason: "template_unresolved",
      templates: 0,
    });
  });

  it("@Pipe class and its transform are unfinished/cross_component without usages", async () => {
    const { context } = await setup({ "src/fmt.pipe.ts": PIPE });
    for (const symbol of ["FmtPipe", "FmtPipe.transform"]) {
      expect(await usagesOf(context, symbol, NO_REQUEST_CONTEXT, "src/fmt.pipe.ts")).toEqual({
        coverage: { status: "unfinished", reason: "cross_component", templates: 0 },
        usages: [],
      });
    }
  });

  it("class that is both @Pipe and @Component is unfinished/cross_component", async () => {
    const { context } = await setup({
      "src/a.component.ts": PUBLIC(`title = "x";`).replace(
        "@Component(",
        '@Pipe({ name: "a" })\n@Component(',
      ),
      "src/a.component.html": "<p>{{ title }}</p>",
    });
    expect((await usagesOf(context, "AComponent.title")).coverage).toEqual({
      status: "unfinished",
      reason: "cross_component",
      templates: 0,
    });
  });

  it("@Pipe without @angular/core stays not_applicable", async () => {
    const fixture = await createProjectFixture({ "src/fmt.pipe.ts": PIPE });
    created.push(fixture);
    const context = createFreshProject(fixture.root);
    expect(await usagesOf(context, "FmtPipe", NO_REQUEST_CONTEXT, "src/fmt.pipe.ts")).toEqual({
      coverage: { status: "not_applicable" },
      usages: [],
    });
  });
});

describe.each([
  ["v18", 18],
  ["v19", 19],
  ["v20", 20],
  ["v21", 21],
  ["v22", 22],
] as const)("usage extraction with compiler %s", (alias, major) => {
  const run = it.skipIf(!compilerMajorSupportedByNode(major));
  run("@Input member is unfinished/cross_component with its own usages", async () => {
    const { context } = await setup(
      {
        "src/a.component.ts": PUBLIC(`@Input() title = "x";`),
        "src/a.component.html": "<p>{{ title }}</p>",
      },
      { compiler: alias },
    );
    const result = await usagesOf(context, "AComponent.title");
    expect(result.coverage).toEqual(CROSS_COMPONENT);
    expect(result.usages).toHaveLength(1);
  });
  const prepare = (html: string, files: Record<string, string> = {}) =>
    setup({ "src/a.component.html": html, ...files }, { compiler: alias });

  run("extracts TemplatePropertyRead/Write/Call", async () => {
    const html = `<p>{{ title }}</p>
<button (click)="title = 'x'">a</button>
<button (click)="save()">b</button>
<span>{{ count() }}</span>
<input [(ngModel)]="title" />`;
    const { context } = await prepare(html);
    const summary = async (symbol: string) =>
      (await usagesOf(context, symbol)).usages.map(
        (usage) =>
          `${usage.kind}@${usage.line}:${usage.column}=${html.slice(usage.start, usage.end)}`,
      );
    expect(await summary("AComponent.title")).toEqual([
      "TemplatePropertyRead@1:7=title",
      "TemplatePropertyWrite@2:18=title",
      "TemplatePropertyWrite@5:21=title",
    ]);
    expect(await summary("AComponent.save")).toEqual(["TemplateCall@3:18=save"]);
    expect(await summary("AComponent.count")).toEqual(["TemplateCall@4:10=count"]);
  });

  run("extracts through control flow and pipe arguments", async () => {
    const html = `@if (user) { {{ items | slice: limit }} }
<li *ngFor="let n of items">{{ n }}</li>
@switch (title) { @case (limit) { {{ save() }} } }`;
    const { context } = await prepare(html);
    const names = async (symbol: string) =>
      (await usagesOf(context, symbol)).usages.map((usage) => usage.line);
    expect(await names("AComponent.user")).toEqual([1]);
    expect(await names("AComponent.items")).toEqual([1, 2]);
    expect(await names("AComponent.limit")).toEqual([1, 3]);
    expect(await names("AComponent.title")).toEqual([3]);
    expect(await names("AComponent.save")).toEqual([3]);
  });

  run("marks inline template usages container=inline", async () => {
    const source = COMPONENT("template: `<p>{{ title }}</p>`");
    const { context } = await prepare("", { "src/a.component.ts": source });
    const { coverage, usages } = await usagesOf(context, "AComponent.title");
    expect(coverage).toEqual({ status: "completed", templates: 1 });
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      container: "inline",
      file: path.join("src", "a.component.ts"),
    });
    expect(source.slice(usages[0]!.start, usages[0]!.end)).toBe("title");
  });

  run("@for item shadows member", async () => {
    const { context } = await prepare("@for (item of items; track item) { {{ item }} } {{ item }}");
    const { usages } = await usagesOf(context, "AComponent.item");
    expect(usages.map((usage) => usage.column)).toEqual([52]);
  });

  run("$event shadows member", async () => {
    const { context } = await prepare(`<a (click)="save(event, $event)"></a>`);
    const { usages } = await usagesOf(context, "AComponent.event");
    expect(usages.map((usage) => usage.column)).toEqual([18]);
    expect((await usagesOf(context, "AComponent.save")).usages).toHaveLength(1);
  });

  run("member read outside shadowing scope is still a usage", async () => {
    const html = `@let ref = 2; {{ ref }} <ng-template let-title><i>{{ title }}</i></ng-template> {{ title }} {{ this.title }}`;
    const { context } = await prepare(html);
    const title = await usagesOf(context, "AComponent.title");
    expect(title.usages.map((usage) => html.slice(usage.start - 5, usage.end))).toEqual([
      "> {{ title",
      "this.title",
    ]);
    expect((await usagesOf(context, "AComponent.ref")).usages).toEqual([]);
  });

  run("records localsInScope", async () => {
    const { context } = await prepare(
      `<div #box>@for (item of items; track item) { <i (click)="save($event)">{{ title }}</i> }</div>`,
    );
    const [usage] = (await usagesOf(context, "AComponent.title")).usages;
    expect(usage?.localsInScope).toEqual(expect.arrayContaining(["box", "item", "$index"]));
    expect(usage?.localsInScope).not.toContain("$event");
    const [call] = (await usagesOf(context, "AComponent.save")).usages;
    expect(call?.localsInScope).toContain("$event");
  });

  it.skipIf(major !== 22 || !compilerMajorSupportedByNode(22))(
    "arrow function parameters shadow members",
    async () => {
      const { context } = await prepare("{{ items.map(title => title + limit) }}");
      expect((await usagesOf(context, "AComponent.title")).usages).toEqual([]);
      expect((await usagesOf(context, "AComponent.limit")).usages).toHaveLength(1);
    },
  );

  run("write via PropertyWrite (v18/v19 AST) or assignment Binary (v20 AST)", async () => {
    const html = `<a (click)="title = 'x'; items[0] = limit"></a>`;
    const { context } = await prepare(html);
    const kinds = async (symbol: string) =>
      (await usagesOf(context, symbol)).usages.map((usage) => usage.kind);
    expect(await kinds("AComponent.title")).toEqual(["TemplatePropertyWrite"]);
    expect(await kinds("AComponent.limit")).toEqual(["TemplatePropertyRead"]);
    expect(await kinds("AComponent.items")).toEqual(["TemplatePropertyRead"]);
  });

  // Compound assignment operators are template syntax since Angular 20; v18/v19 reject them.
  it.skipIf(!compilerMajorSupportedByNode(major) || major < 20)(
    "compound assignment is a write via assignment Binary (v20 AST)",
    async () => {
      const { context } = await prepare(`<a (click)="limit += 1"></a>`);
      const { usages } = await usagesOf(context, "AComponent.limit");
      expect(usages.map((usage) => usage.kind)).toEqual(["TemplatePropertyWrite"]);
    },
  );

  it.skipIf(!compilerMajorSupportedByNode(major) || major >= 20)(
    "compound assignment is a parse error before v20",
    async () => {
      const { context } = await prepare(`<a (click)="limit += 1"></a>`);
      const { coverage, usages } = await usagesOf(context, "AComponent.limit");
      expect(coverage).toEqual({
        status: "unfinished",
        reason: "template_parse_error",
        templates: 0,
      });
      expect(usages).toEqual([]);
    },
  );
});

describe("completeness and bounds", () => {
  it("unparseable template yields unfinished/template_parse_error", async () => {
    const { context } = await setup({ "src/a.component.html": "<p>{{ title }}</b>" });
    const { coverage, usages } = await usagesOf(context, "AComponent.title");
    expect(coverage).toEqual({
      status: "unfinished",
      reason: "template_parse_error",
      templates: 0,
    });
    expect(usages).toEqual([]);
  });

  it("fully covered returns completed with template count", async () => {
    expect(await coverageOf({ "src/a.component.html": "<p>{{ title }}</p>" })).toEqual({
      status: "completed",
      templates: 1,
    });
  });

  it("template over 512 KiB yields size_exceeded without parsing", async () => {
    // "</b>" is a parse error, so the reason proves the parser never ran.
    const html = `</b>${" ".repeat(512 * 1024)}`;
    expect(await coverageOf({ "src/a.component.html": html })).toEqual({
      status: "unfinished",
      reason: "size_exceeded",
      templates: 0,
    });
  });

  it("inline template over 512 KiB yields size_exceeded", async () => {
    // "</b>" would be a parse error, so the reason proves the parser never ran.
    const source = COMPONENT(`template: \`</b>${" ".repeat(512 * 1024)}\``);
    expect(await coverageOf({ "src/a.component.ts": source })).toEqual({
      status: "unfinished",
      reason: "size_exceeded",
      templates: 0,
    });
  });

  it("node bound exhaustion yields work_exhausted", async () => {
    const html = "<i>{{a}}</i>".repeat(25_000);
    expect(await coverageOf({ "src/a.component.html": html })).toEqual({
      status: "unfinished",
      reason: "work_exhausted",
      templates: 0,
    });
  });

  it("cancelled request stops between templates", async () => {
    const { context } = await setup({ "src/a.component.html": "{{ title }}".repeat(2000) });
    let calls = 0;
    const rc: RequestContext = {
      signal: new AbortController().signal,
      checkpoint() {
        if (++calls >= 3) throw new RequestContextError("REQUEST_CANCELLED");
      },
    };
    await expect(usagesOf(context, "AComponent.title", rc)).rejects.toMatchObject({
      code: "REQUEST_CANCELLED",
    });
    expect(calls).toBe(3);
  });
});
