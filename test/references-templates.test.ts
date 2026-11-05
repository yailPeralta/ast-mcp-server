import { afterEach, describe, expect, it } from "vitest";
import {
  createFreshProject,
  findDeclarationByName,
  getSourceFileOrThrow,
} from "../src/services/project.js";
import {
  collectSymbolReferences,
  collectSymbolReferencesWithTemplates,
  type ReferenceDetail,
} from "../src/services/references.js";
import { NO_REQUEST_CONTEXT } from "../src/services/request-context.js";
import { createAngularFixture, type AngularFixture } from "./helpers/angular-fixture.js";
import { createProjectFixture } from "./helpers/project-fixture.js";

const COMPONENT = (decorator = `templateUrl: "./a.component.html"`) =>
  `import { Component } from "@angular/core";
@Component({ selector: "app-a", ${decorator} })
export class AComponent {
  title = "x";
}
`;
const USER = `import { AComponent } from "./a.component.js";
const component = new AComponent();
export const first = component.title;
export const second = component.title;
`;
const HTML = `<h1>{{ title }}</h1>
<button (click)="title = 'y'">{{ title }}</button>
`;

const created: { cleanup(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((fixture) => fixture.cleanup()));
});

async function open(files: Record<string, string>): Promise<AngularFixture> {
  const fixture = await createAngularFixture(
    { "src/a.component.ts": COMPONENT(), "src/user.ts": USER, ...files },
    { compiler: "v21" },
  );
  created.push(fixture);
  return fixture;
}

async function collect(
  fixture: AngularFixture,
  options: {
    detail?: ReferenceDetail;
    offset?: number;
    limit?: number;
    declaration?: boolean;
    file?: string;
    symbolPath?: string;
  } = {},
) {
  const context = createFreshProject(fixture.root);
  const symbolPath = options.symbolPath ?? "AComponent.title";
  const node = findDeclarationByName(
    getSourceFileOrThrow(context.project, options.file ?? "src/a.component.ts"),
    symbolPath,
  );
  return collectSymbolReferencesWithTemplates(
    node,
    context,
    {
      symbolPath,
      includeDeclaration: options.declaration ?? true,
      detail: options.detail ?? "locations",
      offset: options.offset ?? 0,
      limit: options.limit ?? 100,
    },
    NO_REQUEST_CONTEXT,
  );
}

describe("collectSymbolReferencesWithTemplates", () => {
  it("merges template items with TS items and sorts deterministically", async () => {
    const result = await collect(await open({ "src/a.component.html": HTML }));
    expect(result.references.map((item) => [item.file, item.line, item.column, item.kind])).toEqual(
      [
        ["src/a.component.html", 1, 8, "TemplatePropertyRead"],
        ["src/a.component.html", 2, 18, "TemplatePropertyWrite"],
        ["src/a.component.html", 2, 34, "TemplatePropertyRead"],
        ["src/a.component.ts", 4, 3, "ClassDeclaration"],
        ["src/user.ts", 3, 32, "PropertyAccessExpression"],
        ["src/user.ts", 4, 33, "PropertyAccessExpression"],
      ],
    );
    expect(result.references.map((item) => item.origin)).toEqual([
      "template_external",
      "template_external",
      "template_external",
      "compiler",
      "compiler",
      "compiler",
    ]);
    expect(result.references.filter((item) => item.is_declaration)).toEqual([
      expect.objectContaining({ file: "src/a.component.ts", origin: "compiler" }),
    ]);
  });

  it("reference_count stays TS-only while total counts both", async () => {
    const result = await collect(await open({ "src/a.component.html": HTML }));
    expect(result).toMatchObject({
      reference_count: 2,
      template_reference_count: 3,
      total: 6,
      template_coverage: { status: "completed", templates: 1 },
    });
    expect(result.affected_files).toEqual([
      "src/a.component.html",
      "src/a.component.ts",
      "src/user.ts",
    ]);
  });

  it("paginates over mixed items with truthful total/has_more", async () => {
    const fixture = await open({ "src/a.component.html": HTML });
    const full = await collect(fixture);
    const first = await collect(fixture, { limit: 4 });
    const second = await collect(fixture, { limit: 4, offset: first.next_offset ?? 0 });
    expect(first).toMatchObject({ total: 6, has_more: true, next_offset: 4 });
    expect(first.references).toHaveLength(4);
    expect(second).toMatchObject({ total: 6, has_more: false });
    expect([...first.references, ...second.references]).toEqual(full.references);
  });

  it("origin is uniform per response", async () => {
    const external = await collect(await open({ "src/a.component.html": HTML }));
    expect(external.references.every((item) => item.origin !== undefined)).toBe(true);
    const inline = await collect(
      await open({
        "src/a.component.ts": COMPONENT("template: `<p>{{ title }}</p>`"),
      }),
    );
    expect(inline.references.map((item) => item.origin).sort()).toEqual([
      "compiler",
      "compiler",
      "compiler",
      "template_inline",
    ]);
    expect(inline.references.filter((item) => item.origin === "template_inline")).toHaveLength(1);
    expect(inline.template_reference_count).toBe(1);
  });

  it("adds the template line as context only for detail=context", async () => {
    const fixture = await open({ "src/a.component.html": HTML });
    const withContext = await collect(fixture, { detail: "context" });
    expect(withContext.references[1]).toMatchObject({
      origin: "template_external",
      context: `<button (click)="title = 'y'">{{ title }}</button>`,
    });
    const without = await collect(fixture);
    expect(without.references[1]).not.toHaveProperty("context");
  });

  it("fields absent when not_applicable", async () => {
    const plain = await createProjectFixture({
      "src/value.ts": `export function formatValue(value: number): string { return String(value); }\n`,
      "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n`,
    });
    created.push(plain);
    const context = createFreshProject(plain.root);
    const node = findDeclarationByName(
      getSourceFileOrThrow(context.project, "src/value.ts"),
      "formatValue",
    );
    const query = {
      symbolPath: "formatValue",
      includeDeclaration: true,
      detail: "locations" as const,
      offset: 0,
      limit: 100,
    };
    const result = await collectSymbolReferencesWithTemplates(
      node,
      context,
      query,
      NO_REQUEST_CONTEXT,
    );
    expect(result).toEqual(
      collectSymbolReferences(node, context.projectRoot, "formatValue", true, "locations", 0, 100),
    );
    expect(result).not.toHaveProperty("template_coverage");
    expect(result.references[0]).not.toHaveProperty("origin");
  });

  it("reports unfinished coverage and keeps TS references when the template cannot be parsed", async () => {
    const result = await collect(await open({ "src/a.component.html": "<p>{{ title </div>" }));
    expect(result).toMatchObject({
      reference_count: 2,
      template_reference_count: 0,
      total: 3,
      template_coverage: { status: "unfinished", reason: "template_parse_error" },
    });
    expect(result.references.map((item) => item.origin)).toEqual([
      "compiler",
      "compiler",
      "compiler",
    ]);
  });

  it("@Input member without consumers reports completed and keeps own-template usages", async () => {
    const result = await collect(
      await open({
        "src/a.component.ts": COMPONENT()
          .replace("import { Component }", "import { Component, Input }")
          .replace("  title", "  @Input() title"),
        "src/a.component.html": HTML,
      }),
    );
    expect(result).toMatchObject({
      reference_count: 2,
      template_reference_count: 3,
      total: 6,
      template_coverage: { status: "completed", templates: 1 },
    });
  });

  it("@Pipe transform reports unfinished/cross_component instead of an absent field", async () => {
    const fixture = await open({
      "src/fmt.pipe.ts": `import { Pipe } from "@angular/core";
@Pipe({ name: "fmt" })
export class FmtPipe {
  transform(value: string): string { return value; }
}
`,
    });
    const result = await collect(fixture, {
      file: "src/fmt.pipe.ts",
      symbolPath: "FmtPipe.transform",
    });
    expect(result).toMatchObject({
      template_reference_count: 0,
      template_coverage: { status: "unfinished", reason: "cross_component", templates: 0 },
    });
    expect(result.references.every((item) => item.origin === "compiler")).toBe(true);
  });

  it("@Input directive member reports unfinished/cross_component with zero templates", async () => {
    const fixture = await open({
      "src/a.directive.ts": `import { Directive, Input } from "@angular/core";
@Directive({ selector: "[appA]" })
export class ADirective {
  @Input() title = "x";
}
`,
    });
    const result = await collect(fixture, {
      file: "src/a.directive.ts",
      symbolPath: "ADirective.title",
    });
    expect(result).toMatchObject({
      template_reference_count: 0,
      template_coverage: { status: "unfinished", reason: "cross_component", templates: 0 },
    });
    expect(result.references.every((item) => item.origin === "compiler")).toBe(true);
  });

  it("many usages paginate", async () => {
    const html = Array.from({ length: 30 }, () => "<i>{{ title }}</i>").join("\n");
    const fixture = await open({ "src/a.component.html": html });
    const pageOne = await collect(fixture, { limit: 10 });
    expect(pageOne).toMatchObject({ total: 33, has_more: true, next_offset: 10 });
    expect(pageOne.references).toHaveLength(10);
    expect(pageOne.references.every((item) => item.origin === "template_external")).toBe(true);
    const last = await collect(fixture, { limit: 10, offset: 30 });
    expect(last).toMatchObject({ has_more: false, template_reference_count: 30 });
    expect(last.references).toHaveLength(3);
  });
});
