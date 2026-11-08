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

  it("@Input member keeps own-template usages and is completed without consumers", async () => {
    const result = await publicUsages(`@Input() title = "x";`);
    expect(result.coverage).toEqual({ status: "completed", templates: 1 });
    expect(result.usages.map((usage) => usage.kind)).toEqual(["TemplatePropertyRead"]);
  });

  it("@Output member is completed without consumers", async () => {
    const result = await publicUsages(`@Output() title = output<string>();`);
    expect(result.coverage).toEqual({ status: "completed", templates: 1 });
  });

  it.each([
    `title = input("x");`,
    `title = input.required<string>();`,
    `title = output<string>();`,
  ])("signal member %s is completed", async (member) => {
    const result = await publicUsages(member, "<p>{{ title() }}</p>");
    expect(result.coverage).toEqual({ status: "completed", templates: 1 });
    expect(result.usages.map((usage) => usage.kind)).toEqual(["TemplateCall"]);
  });

  it.each([
    `@Input(ALIAS) title = "x";`,
    `@Input({ alias: ALIAS }) title = "x";`,
    `@Input({ ...OPTIONS }) title = "x";`,
    `@Output(\`a\${ALIAS}\`) title = output<string>();`,
    `title = input("x", { alias: ALIAS });`,
    `title = input("x", OPTIONS);`,
    `title = model("x", { alias: ALIAS });`,
    `title = output<string>({ [ALIAS]: "a" });`,
  ])("non-literal alias %s stays unfinished/cross_component", async (member) => {
    const { context } = await setup({
      "src/a.component.ts": `const ALIAS = "a";\nconst OPTIONS = {};\n${PUBLIC(member)}`,
      "src/a.component.html": "<p>{{ title() }}</p>",
    });
    const result = await usagesOf(context, "AComponent.title");
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
      expect((await usagesOf(context, "AComponent.title")).coverage).toEqual({
        status: "completed",
        templates: 1,
      });
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

  it("@Pipe class and its transform are completed when no template uses the pipe", async () => {
    const { context } = await setup({
      "src/fmt.pipe.ts": PIPE,
      "src/a.component.html": "<p>none</p>",
    });
    for (const symbol of ["FmtPipe", "FmtPipe.transform"]) {
      expect(await usagesOf(context, symbol, NO_REQUEST_CONTEXT, "src/fmt.pipe.ts")).toEqual({
        coverage: { status: "completed", templates: 1 },
        usages: [],
        ...(symbol.includes(".") ? { renameBlocked: true } : {}),
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

const DIRECTIVE = (
  member: string,
  metadata = "",
  imports = "Directive, Input, Output, input, model, output",
) =>
  `import { ${imports} } from "@angular/core";
@Directive({ selector: "[appA]"${metadata} })
export class ADirective {
  ${member}
}
`;
const METADATA = (metadata: string, prelude = "") =>
  `import { Component } from "@angular/core";
${prelude}@Component({ selector: "app-a", templateUrl: "./a.component.html", ${metadata} })
export class AComponent {
  title = "x"; other = 1;
}
`;
const DIRECTIVE_CROSS = {
  coverage: { status: "unfinished", reason: "cross_component", templates: 0 },
  usages: [],
};

describe("directive members and metadata inputs/outputs", () => {
  const directiveUsages = async (source: string) => {
    const { context } = await setup({ "src/a.directive.ts": source });
    return usagesOf(context, "ADirective.title", NO_REQUEST_CONTEXT, "src/a.directive.ts");
  };
  const metadataUsages = async (metadata: string, prelude = "") => {
    const { context } = await setup({
      "src/a.component.ts": METADATA(metadata, prelude),
      "src/a.component.html": "<p>{{ title }} {{ other }}</p>",
    });
    return {
      title: await usagesOf(context, "AComponent.title"),
      other: await usagesOf(context, "AComponent.other"),
    };
  };

  it.each([
    `@Input() title = "x";`,
    `@Output() title = output<string>();`,
    `title = input("x");`,
    `title = model.required<string>();`,
  ])("directive member %s is unfinished/cross_component without usages", async (member) => {
    expect(await directiveUsages(DIRECTIVE(member))).toEqual(DIRECTIVE_CROSS);
  });

  it("plain directive member stays not_applicable", async () => {
    expect(await directiveUsages(DIRECTIVE(`title = "x";`))).toEqual({
      coverage: { status: "not_applicable" },
      usages: [],
    });
  });

  it("Directive decorator from another module stays not_applicable", async () => {
    const { context } = await setup({
      "src/decorators.ts": `export const Directive = (): ClassDecorator => () => {};\n`,
      "src/a.directive.ts": `import { Directive } from "./decorators";\n${DIRECTIVE(`@Input() title = "x";`, "", "Input")}`,
    });
    expect(
      await usagesOf(context, "ADirective.title", NO_REQUEST_CONTEXT, "src/a.directive.ts"),
    ).toEqual({ coverage: { status: "not_applicable" }, usages: [] });
  });

  it.each([
    `inputs: ["title"]`,
    `inputs: ["title: alias"]`,
    `inputs: [{ name: "title", alias: "y" }]`,
  ])(
    "component %s keeps own usages and is completed without consumers; unlisted sibling too",
    async (metadata) => {
      const { title, other } = await metadataUsages(metadata);
      expect(title.coverage).toEqual({ status: "completed", templates: 1 });
      expect(title.usages.map((usage) => usage.kind)).toEqual(["TemplatePropertyRead"]);
      expect(other.coverage).toEqual({ status: "completed", templates: 1 });
    },
  );

  it.each([`inputs: [...SHARED]`, `inputs: SHARED`, `outputs: ["x", NAME]`])(
    "non-literal %s makes every member cross_component",
    async (metadata) => {
      const prelude = `const SHARED = ["title"];\nconst NAME = "title";\n`;
      const { title, other } = await metadataUsages(metadata, prelude);
      expect(title.coverage).toEqual(CROSS_COMPONENT);
      expect(other.coverage).toEqual(CROSS_COMPONENT);
    },
  );

  it("directive outputs metadata is unfinished/cross_component", async () => {
    expect(await directiveUsages(DIRECTIVE(`title = "x";`, `, outputs: ["title"]`))).toEqual(
      DIRECTIVE_CROSS,
    );
  });
});

const CONSUMER = (html: string, imports = "[AComponent]", name = "b", metadata = "") => ({
  [`src/${name}.component.ts`]: `import { Component } from "@angular/core";
import { AComponent } from "./a.component";
@Component({ selector: "app-${name}", standalone: true, imports: ${imports}, ${metadata || `templateUrl: "./${name}.component.html"`} })
export class ${name.toUpperCase()}Component {}
`,
  [`src/${name}.component.html`]: html,
});
const TARGET_FILES = {
  "src/a.component.ts": PUBLIC(`@Input() title = "x"; @Output() save = output<string>();`),
  "src/a.component.html": "<p>{{ title }}</p>",
};
const BINDINGS = `<app-a [title]="1"></app-a><app-a title="lit"></app-a><app-a [(title)]="v"></app-a><app-a (save)="f()"></app-a>`;
const CONSUMER_FILES = { ...TARGET_FILES, ...CONSUMER(BINDINGS) };
const CONSUMER_KINDS = [
  "TemplatePropertyRead",
  "TemplateInputBinding",
  "TemplateAttribute",
  "TemplateTwoWayBinding",
];

describe("consumer template usages", () => {
  const consumerUsages = async (
    files: Record<string, string>,
    symbol = "AComponent.title",
    limits?: Parameters<typeof collectTemplateUsages>[3],
  ) => {
    const { context } = await setup({ ...TARGET_FILES, ...files });
    const node = findDeclarationByName(
      getSourceFileOrThrow(context.project, "src/a.component.ts"),
      symbol,
    );
    return collectTemplateUsages(node, context, NO_REQUEST_CONTEXT, limits);
  };

  it("lists input, static, two-way and output bindings of importing consumers", async () => {
    const input = await consumerUsages(CONSUMER_FILES);
    expect(input.coverage).toEqual({ status: "completed", templates: 2 });
    expect(
      input.usages.map((usage) => [usage.kind, usage.role, path.basename(usage.file)]),
    ).toEqual(
      CONSUMER_KINDS.map((kind, index) => [
        kind,
        index ? "consumer" : "own",
        index ? "b.component.html" : "a.component.html",
      ]),
    );
    expect(input.usages[1]).toMatchObject({
      binding: "input",
      bindingName: "title",
      container: "external",
    });
    const output = await consumerUsages(CONSUMER_FILES, "AComponent.save");
    expect(output.usages.map((usage) => usage.kind)).toEqual(["TemplateOutputBinding"]);
    expect(output.coverage).toEqual({ status: "completed", templates: 2 });
  });

  it("lists bindings of an inline consumer template as template_inline", async () => {
    const files = CONSUMER("", "[AComponent]", "b", `template: '<app-a [title]="1"></app-a>'`);
    const { usages } = await consumerUsages(files);
    expect(usages.map((usage) => [usage.kind, usage.container])).toEqual([
      ["TemplatePropertyRead", "external"],
      ["TemplateInputBinding", "inline"],
    ]);
  });

  it("ignores a decoy with the same selector that does not import the target", async () => {
    const { coverage, usages } = await consumerUsages(CONSUMER(BINDINGS, "[]"));
    expect(coverage).toEqual({ status: "completed", templates: 2 });
    expect(usages.map((usage) => usage.kind)).toEqual(["TemplatePropertyRead"]);
  });

  it.each([
    [
      `<app-a [title]="1"></app-a>`,
      { status: "unfinished", reason: "cross_component", templates: 2 },
    ],
    [`<p>no match</p>`, { status: "completed", templates: 2 }],
  ])("opaque scope with template %s is %j", async (html, expected) => {
    const files = CONSUMER(html, "[...SHARED]");
    files["src/b.component.ts"] = `const SHARED: unknown[] = [];\n${files["src/b.component.ts"]}`;
    expect((await consumerUsages(files)).coverage).toEqual(expected);
  });

  it("hostDirectives on the target is unfinished/cross_component", async () => {
    const files = {
      "src/a.component.ts": TARGET_FILES["src/a.component.ts"].replace(
        "selector:",
        "hostDirectives: [], selector:",
      ),
    };
    expect((await consumerUsages(files)).coverage).toMatchObject({
      status: "unfinished",
      reason: "cross_component",
    });
  });

  it.each([
    ["template_unsafe", { templateUrl: "../../outside.html" }],
    ["template_unresolved", { templateUrl: "missing.html" }],
    ["template_parse_error", { html: "<app-a [title]=" }],
  ])(
    "consumer failing with %s is unfinished and other consumers are still listed",
    async (reason, broken: { templateUrl?: string; html?: string }) => {
      const metadata = broken.templateUrl ? `templateUrl: "${broken.templateUrl}"` : "";
      const files = {
        ...CONSUMER(broken.html ?? "", "[AComponent]", "b", metadata),
        ...CONSUMER(BINDINGS, "[AComponent]", "c"),
      };
      const { coverage, usages } = await consumerUsages(files);
      expect(coverage).toMatchObject({ status: "unfinished", reason });
      expect(usages.map((usage) => usage.kind)).toEqual(CONSUMER_KINDS);
    },
  );

  it("a project scan over its template budget is unfinished/work_exhausted", async () => {
    const { coverage } = await consumerUsages(CONSUMER_FILES, "AComponent.title", { templates: 1 });
    expect(coverage).toMatchObject({ status: "unfinished", reason: "work_exhausted" });
  });

  it("a compiler without the selector API leaves own-template coverage alone", async () => {
    const { context, root, write } = await setup(TARGET_FILES, { compiler: null });
    const real = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "..",
      "node_modules",
      "angular-compiler-v21",
      "fesm2022",
      "compiler.mjs",
    );
    await writeFakeCompiler(
      write,
      "21.0.0",
      `export { parseTemplate, tmplAstVisitAll, TmplAstRecursiveVisitor, RecursiveAstVisitor, ImplicitReceiver, ThisReceiver, PropertyRead, Call, Binary } from ${JSON.stringify(real)};\n`,
    );
    expect((await usagesOf(context, "AComponent.title")).coverage).toMatchObject({
      status: "unfinished",
      reason: "compiler_unsupported",
    });
    await write("src/a.component.ts", COMPONENT());
    const fresh = createFreshProject(root);
    expect((await usagesOf(fresh, "AComponent.title")).coverage.status).toBe("completed");
  });
});

describe("aliases, model() and metadata names in consumer templates", () => {
  const consumerNames = async (
    member: string,
    html: string,
    options: { metadata?: string; symbol?: string } = {},
  ) => {
    const source = options.metadata
      ? METADATA(options.metadata)
          .replace('title = "x"; other = 1;', member)
          .replace("{ Component }", "{ Component, Input }")
      : PUBLIC(member);
    const { context } = await setup({
      "src/a.component.ts": source,
      "src/a.component.html": "<p>none</p>",
      ...CONSUMER(html),
    });
    const node = findDeclarationByName(
      getSourceFileOrThrow(context.project, "src/a.component.ts"),
      options.symbol ?? "AComponent.title",
    );
    const { coverage, usages } = await collectTemplateUsages(node, context, NO_REQUEST_CONTEXT);
    return { coverage, bound: usages.filter((usage) => usage.role === "consumer") };
  };
  const names = (bound: readonly { bindingName?: string; binding?: string }[]) =>
    bound.map((usage) => `${usage.binding}:${usage.bindingName}`);
  const HTML = `<app-a [a]="1" [title]="2"></app-a>`;

  it.each([
    `@Input("a") title = "x";`,
    `@Input({ alias: "a" }) title = "x";`,
    `@Input({ alias: "a", required: true }) title = "x";`,
    `title = input("x", { alias: "a" });`,
    `title = input.required<string>({ alias: "a" });`,
  ])("input alias %s binds the alias, not the member name", async (member) => {
    const { coverage, bound } = await consumerNames(member, HTML);
    expect(coverage).toEqual({ status: "completed", templates: 2 });
    expect(names(bound)).toEqual(["input:a"]);
  });

  it.each([
    [`@Output("a") title = output<string>();`],
    [`title = output<string>({ alias: "a" });`],
  ])("output alias %s binds the alias", async (member) => {
    const { coverage, bound } = await consumerNames(member, `<app-a (a)="f()" (title)="g()">`);
    expect(coverage).toMatchObject({ status: "completed" });
    expect(names(bound)).toEqual(["output:a"]);
  });

  it("an unaliased option object keeps the member name", async () => {
    const { bound } = await consumerNames(`title = input("x", { transform: Boolean });`, HTML);
    expect(names(bound)).toEqual(["input:title"]);
  });

  it.each([`title = model("x");`, `title = model.required<string>();`])(
    "%s reports [x], [(x)] and (xChange) bindings",
    async (member) => {
      const html = `<app-a [title]="1"></app-a><app-a [(title)]="v"></app-a><app-a (titleChange)="f($event)"></app-a>`;
      const { coverage, bound } = await consumerNames(member, html);
      expect(coverage).toEqual({ status: "completed", templates: 2 });
      expect(names(bound)).toEqual(["input:title", "two_way:title", "output:titleChange"]);
    },
  );

  it("model() with a literal alias maps to alias and aliasChange", async () => {
    const html = `<app-a [a]="1" [(a)]="v" (aChange)="f($event)" [title]="2" (titleChange)="g()">`;
    const { bound } = await consumerNames(`title = model("x", { alias: "a" });`, html);
    expect(names(bound)).toEqual(["input:a", "two_way:a", "output:aChange"]);
  });

  it.each([
    [`inputs: ["title"]`, "input:title"],
    [`inputs: ["title: a"]`, "input:a"],
    [`inputs: [{ name: "title", alias: "a" }]`, "input:a"],
    [`inputs: [{ name: "title" }]`, "input:title"],
  ])("metadata %s binds the public name", async (metadata, expected) => {
    const { coverage, bound } = await consumerNames(
      `title = "x"; other = 1;`,
      `<app-a [a]="1" [title]="2" [other]="3">`,
      { metadata },
    );
    expect(coverage).toMatchObject({ status: "completed" });
    expect(names(bound)).toEqual([expected]);
  });

  it("metadata outputs bind the public output name", async () => {
    const { bound } = await consumerNames(`title = "x"; other = 1;`, `<app-a (a)="f()">`, {
      metadata: `outputs: ["title: a"]`,
    });
    expect(names(bound)).toEqual(["output:a"]);
  });

  it.each([
    `inputs: [...SHARED]`,
    `inputs: ["title", NAME]`,
    `inputs: [{ name: "title", alias: NAME }]`,
    `outputs: SHARED`,
  ])("non-literal metadata %s stays unfinished/cross_component", async (metadata) => {
    const { context } = await setup({
      "src/a.component.ts": METADATA(metadata, `const SHARED = ["title"];\nconst NAME = "a";\n`),
      "src/a.component.html": "<p>{{ title }}</p>",
      ...CONSUMER(HTML),
    });
    expect((await usagesOf(context, "AComponent.title")).coverage).toMatchObject({
      status: "unfinished",
      reason: "cross_component",
    });
  });

  it("a member that is both decorated and listed in metadata stays unfinished", async () => {
    const { coverage } = await consumerNames(`@Input() title = "x"; other = 1;`, HTML, {
      metadata: `inputs: ["title"]`,
    });
    expect(coverage).toMatchObject({ status: "unfinished", reason: "cross_component" });
  });
});

const MODULE = (name: string, metadata: string, imports = "") =>
  `import { NgModule } from "@angular/core";
import { AComponent } from "./a.component";
import { BComponent } from "./b.component";
${imports}
@NgModule({ ${metadata} })
export class ${name} {}
`;
const MODULE_CONSUMER = (flag: string) => ({
  "src/b.component.ts": `import { Component } from "@angular/core";
@Component({ selector: "app-b", ${flag}templateUrl: "./b.component.html" })
export class BComponent {}
`,
  "src/b.component.html": BINDINGS,
});
const AMODULE = (exported: string) =>
  MODULE("AModule", `declarations: [AComponent], exports: [${exported}]`);
const APP_MODULE = MODULE(
  "AppModule",
  "declarations: [BComponent], imports: [AModule]",
  `import { AModule } from "./a.module";`,
);

describe("NgModule-scoped consumers", () => {
  const listed = async (files: Record<string, string>, options?: { coreVersion: string }) => {
    const { context } = await setup({ ...TARGET_FILES, ...files }, { compiler: "v21", ...options });
    return usagesOf(context, "AComponent.title");
  };

  it("lists a consumer declared in a module that imports the exporting module", async () => {
    const { coverage, usages } = await listed({
      ...MODULE_CONSUMER("standalone: false, "),
      "src/a.module.ts": AMODULE("AComponent"),
      "src/app.module.ts": APP_MODULE,
    });
    expect(coverage).toEqual({ status: "completed", templates: 2 });
    expect(usages.map((usage) => usage.kind)).toEqual(CONSUMER_KINDS);
  });

  it("ignores a module consumer whose imported module does not export the target", async () => {
    const { coverage, usages } = await listed({
      ...MODULE_CONSUMER("standalone: false, "),
      "src/a.module.ts": AMODULE(""),
      "src/app.module.ts": APP_MODULE,
    });
    expect(coverage).toEqual({ status: "completed", templates: 2 });
    expect(usages.map((usage) => usage.kind)).toEqual(["TemplatePropertyRead"]);
  });

  it("lists a standalone consumer importing an exporting module", async () => {
    const files = CONSUMER(BINDINGS, "[AModule]");
    files["src/b.component.ts"] =
      `import { AModule } from "./a.module";\n${files["src/b.component.ts"]}`;
    const { usages } = await listed({ ...files, "src/a.module.ts": AMODULE("AComponent") });
    expect(usages.map((usage) => usage.kind)).toEqual(CONSUMER_KINDS);
  });

  it("a matching consumer declared in no module is unfinished/cross_component", async () => {
    const { coverage } = await listed(MODULE_CONSUMER("standalone: false, "));
    expect(coverage).toEqual({ status: "unfinished", reason: "cross_component", templates: 2 });
  });
});

const PIPE_CONSUMER = (html: string, imports = "[FmtPipe]", name = "b") => ({
  [`src/${name}.component.ts`]: `import { Component } from "@angular/core";
import { FmtPipe } from "./fmt.pipe";
@Component({ selector: "app-${name}", standalone: true, imports: ${imports}, templateUrl: "./${name}.component.html" })
export class ${name.toUpperCase()}Component {}
`,
  [`src/${name}.component.html`]: html,
});
const PIPE_FILES = { "src/fmt.pipe.ts": PIPE, "src/a.component.html": "<p>none</p>" };

describe("pipe usages", () => {
  const pipeUsages = async (
    files: Record<string, string>,
    symbol = "FmtPipe",
    options?: Parameters<typeof setup>[1],
  ) => {
    const { context } = await setup({ ...PIPE_FILES, ...files }, options);
    return usagesOf(context, symbol, NO_REQUEST_CONTEXT, "src/fmt.pipe.ts");
  };

  it.each(["FmtPipe", "FmtPipe.transform"])(
    "lists in-scope `| fmt` usages for %s",
    async (symbol) => {
      const html = '{{ v | fmt: 1 }} <p [x]="v | fmt"></p>';
      const { coverage, usages } = await pipeUsages(PIPE_CONSUMER(html), symbol);
      expect(coverage).toEqual({ status: "completed", templates: 2 });
      expect(usages.map((usage) => [usage.kind, usage.role, usage.container, usage.file])).toEqual([
        ["TemplatePipeName", "consumer", "external", path.join("src", "b.component.html")],
        ["TemplatePipeName", "consumer", "external", path.join("src", "b.component.html")],
      ]);
      expect(usages.map((usage) => html.slice(usage.start, usage.end))).toEqual(["fmt", "fmt"]);
    },
  );

  it("lists a pipe used in an inline consumer template as inline", async () => {
    const files = PIPE_CONSUMER("");
    files["src/b.component.ts"] = files["src/b.component.ts"].replace(
      'templateUrl: "./b.component.html"',
      "template: '{{ v | fmt }}'",
    );
    const { usages } = await pipeUsages(files);
    expect(usages.map((usage) => [usage.kind, usage.container])).toEqual([
      ["TemplatePipeName", "inline"],
    ]);
  });

  it("ignores the same pipe name in a component that does not import the pipe", async () => {
    const files = {
      ...PIPE_CONSUMER("{{ v | fmt }}", "[]"),
      ...PIPE_CONSUMER("{{ v | fmt }}", "[FmtPipe]", "c"),
    };
    const { coverage, usages } = await pipeUsages(files);
    expect(coverage).toEqual({ status: "completed", templates: 3 });
    expect(usages.map((usage) => usage.file)).toEqual([path.join("src", "c.component.html")]);
  });

  it("an unrelated pipe with the same name in scope is not listed", async () => {
    const files = {
      "src/other.pipe.ts": PIPE.replace("FmtPipe", "OtherPipe"),
      "src/b.component.ts": `import { Component } from "@angular/core";
import { OtherPipe } from "./other.pipe";
@Component({ selector: "app-b", standalone: true, imports: [OtherPipe], templateUrl: "./b.component.html" })
export class BComponent {}
`,
      "src/b.component.html": "{{ v | fmt }}",
    };
    const { coverage, usages } = await pipeUsages(files);
    expect(coverage).toMatchObject({ status: "completed" });
    expect(usages).toEqual([]);
  });

  it("lists a pipe reached through an NgModule export", async () => {
    const files = {
      "src/p.module.ts": `import { NgModule } from "@angular/core";
import { FmtPipe } from "./fmt.pipe";
import { BComponent } from "./b.component";
@NgModule({ imports: [FmtPipe], exports: [FmtPipe], declarations: [BComponent] })
export class PModule {}
`,
      "src/b.component.ts": `import { Component } from "@angular/core";
@Component({ selector: "app-b", standalone: false, templateUrl: "./b.component.html" })
export class BComponent {}
`,
      "src/b.component.html": "{{ v | fmt }}",
    };
    const { coverage, usages } = await pipeUsages(files);
    expect(coverage).toMatchObject({ status: "completed" });
    expect(usages).toHaveLength(1);
  });

  it("a non-literal pipe name is unfinished/cross_component", async () => {
    const pipe = PIPE.replace('name: "fmt"', "name: NAME").replace(
      "@Pipe",
      'const NAME = "fmt";\n@Pipe',
    );
    const { coverage, usages } = await pipeUsages({
      "src/fmt.pipe.ts": pipe,
      ...PIPE_CONSUMER("{{ v | fmt }}"),
    });
    expect(coverage).toEqual({ status: "unfinished", reason: "cross_component", templates: 0 });
    expect(usages).toEqual([]);
  });

  it.each([
    ["{{ v | fmt }}", "unfinished"],
    ["<p>no pipe</p>", "completed"],
  ])("an opaque consumer scope with template %s is %s", async (html, status) => {
    const files = PIPE_CONSUMER(html, "[...SHARED]");
    files["src/b.component.ts"] = `const SHARED: unknown[] = [];\n${files["src/b.component.ts"]}`;
    expect((await pipeUsages(files)).coverage.status).toBe(status);
  });

  it("a consumer that cannot be read keeps its own reason", async () => {
    const files = PIPE_CONSUMER("{{ v | fmt }}<p [x]=");
    expect((await pipeUsages(files)).coverage).toMatchObject({
      status: "unfinished",
      reason: "template_parse_error",
    });
  });

  it("other members of a pipe class stay unfinished/cross_component", async () => {
    const pipe = PIPE.replace("transform", "helper = 1;\n  transform");
    const { coverage } = await pipeUsages(
      { "src/fmt.pipe.ts": pipe, ...PIPE_CONSUMER("{{ v | fmt }}") },
      "FmtPipe.helper",
    );
    expect(coverage).toEqual({ status: "unfinished", reason: "cross_component", templates: 0 });
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
  run("an absent standalone flag declares the consumer in its module only on core 18", async () => {
    const files = {
      ...MODULE_CONSUMER(""),
      "src/m.module.ts": MODULE("CModule", "declarations: [BComponent, AComponent]"),
    };
    const { context } = await setup(
      { ...TARGET_FILES, ...files },
      { compiler: alias, coreVersion: `${major}.0.0` },
    );
    const { coverage, usages } = await usagesOf(context, "AComponent.title");
    expect(coverage).toEqual({ status: "completed", templates: 2 });
    expect(usages.map((usage) => usage.kind)).toEqual(
      major === 18 ? CONSUMER_KINDS : ["TemplatePropertyRead"],
    );
  });
  run("pipe name spans slice to the name in arguments, nesting and control flow", async () => {
    const html = `{{ a | fmt | fmt: 2 }} {{ b | slice: (c | fmt) }}
@if (d | fmt) { @for (e of f; track e) { {{ e | fmt:(g | fmt) }} } }
<p [x]="h | fmt"></p>`;
    const { context } = await setup({ ...PIPE_FILES, ...PIPE_CONSUMER(html) }, { compiler: alias });
    const { coverage, usages } = await usagesOf(
      context,
      "FmtPipe",
      NO_REQUEST_CONTEXT,
      "src/fmt.pipe.ts",
    );
    expect(coverage).toMatchObject({ status: "completed" });
    expect(usages).toHaveLength(7);
    expect(new Set(usages.map((usage) => html.slice(usage.start, usage.end)))).toEqual(
      new Set(["fmt"]),
    );
    expect(usages.every((usage) => usage.kind === "TemplatePipeName")).toBe(true);
  });
  run("consumer bindings are listed next to own usages", async () => {
    const { context } = await setup(CONSUMER_FILES, { compiler: alias });
    const result = await usagesOf(context, "AComponent.title");
    expect(result.coverage).toEqual({ status: "completed", templates: 2 });
    expect(result.usages.map((usage) => usage.kind)).toEqual(CONSUMER_KINDS);
  });
  run("@Input directive member is unfinished/cross_component", async () => {
    const { context } = await setup(
      { "src/a.directive.ts": DIRECTIVE(`@Input() title = "x";`) },
      { compiler: alias },
    );
    expect(
      await usagesOf(context, "ADirective.title", NO_REQUEST_CONTEXT, "src/a.directive.ts"),
    ).toEqual(DIRECTIVE_CROSS);
  });
  const prepare = (html: string, files: Record<string, string> = {}) =>
    setup({ "src/a.component.html": html, ...files }, { compiler: alias });

  // Regression for #441: v18/v19 `tmplAstVisitAll` walked every subtree twice per level.
  const DEPTH = 20;
  const deep = (inner: string) => `${"<div>".repeat(DEPTH)}${inner}${"</div>".repeat(DEPTH)}`;
  run("a pipe consumer with a deeply nested template completes", async () => {
    const html = deep("{{ v | fmt }}");
    const { context } = await setup({ ...PIPE_FILES, ...PIPE_CONSUMER(html) }, { compiler: alias });
    const { coverage, usages } = await usagesOf(
      context,
      "FmtPipe",
      NO_REQUEST_CONTEXT,
      "src/fmt.pipe.ts",
    );
    expect(coverage).toMatchObject({ status: "completed" });
    expect(usages.map((usage) => html.slice(usage.start, usage.end))).toEqual(["fmt"]);
  });
  run("a member used in its own deeply nested template completes", async () => {
    const { context } = await prepare(deep("{{ title }}"));
    const { coverage, usages } = await usagesOf(context, "AComponent.title");
    expect(coverage).toEqual({ status: "completed", templates: 1 });
    expect(usages.map((usage) => usage.kind)).toEqual(["TemplatePropertyRead"]);
  });

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
