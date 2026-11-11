import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";
import { collectTemplateUsages, type TemplateCoverage } from "../src/services/angular-templates.js";
import { clearProjectSessions } from "../src/services/project.js";
import { RequestContextError } from "../src/services/request-context.js";
import { createAngularFixture, type AngularFixture } from "./helpers/angular-fixture.js";
import { generateMatrixProject } from "./helpers/angular-matrix-fixture.js";

vi.mock("../src/services/angular-templates.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/angular-templates.js")>();
  return { ...actual, collectTemplateUsages: vi.fn(actual.collectTemplateUsages) };
});
const templateHalf = vi.mocked(collectTemplateUsages);

/** `title`: declaration + 3 TypeScript references + 4 template usages. */
const BASE = {
  "src/a.component.ts": `import { Component, Input } from "@angular/core";
@Component({ selector: "app-a", standalone: true, templateUrl: "./a.component.html" })
export class AComponent {
  title = "x";
  private hidden = "h";
  @Input() label = "";
}
`,
  "src/a.component.html": `<h1>{{ title }}</h1>\n<p>{{ title }}{{ title }}{{ title }}</p>\n<b>{{ hidden }}{{ label }}</b>\n`,
  "src/user.ts": `import { AComponent } from "./a.component.js";
const a = new AComponent();
export const uses = [a.title, a.title, a.title];
`,
  "src/fmt.pipe.ts": `import { Pipe } from "@angular/core";
@Pipe({ name: "fmt", standalone: true })
export class FmtPipe {
  transform(value: string): string { return value; }
}
`,
  "src/b.component.ts": `import { Component } from "@angular/core";
import { AComponent } from "./a.component.js";
import { FmtPipe } from "./fmt.pipe.js";
@Component({ selector: "app-b", standalone: true, imports: [AComponent, FmtPipe], template: \`<app-a [label]="name | fmt"></app-a>\` })
export class BComponent { name = "n"; }
`,
  "src/base.ts": `export class Base { shared = 1; }\n`,
  "src/c.component.ts": `import { Component } from "@angular/core";
import { Base } from "./base.js";
@Component({ selector: "app-c", template: "{{ shared }}" })
export class CComponent extends Base {}
`,
};
const INCOMPLETE = { category: "incomplete", component: "references" };

type Reference = { file: string; line: number; column: number; origin?: string; context?: string };
interface Explored {
  evidence: {
    references?: {
      references: Reference[];
      reference_count: number;
      total: number;
      template_coverage?: TemplateCoverage;
      template_reference_count?: number;
    };
  }[];
  omissions: {
    counts: { category: string; component: string; count: number }[];
    details: { subject: string; category: string; component: string; reason: string }[];
    total: number;
  };
  completeness: { complete: boolean; evidence_complete: boolean; unresolved: unknown[] };
  call_spines?: unknown;
}

let client: Client;
let server: ReturnType<typeof createServer>;
let fixture: AngularFixture | undefined;

beforeEach(async () => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  server = createServer();
  client = new Client({ name: "explore-template-evidence-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await Promise.all([client.close(), server.close()]);
  clearProjectSessions();
  await fixture?.cleanup();
  fixture = undefined;
});

interface Setup {
  files?: Record<string, string>;
  compiler?: "v21" | null;
  tool?: string;
}

async function call(symbol_path: string, input: Record<string, unknown> = {}, setup: Setup = {}) {
  fixture ??= await createAngularFixture(
    { ...BASE, ...setup.files },
    { compiler: setup.compiler === undefined ? "v21" : setup.compiler },
  );
  const tool = setup.tool ?? "ast_explore";
  return client.callTool({
    name: tool,
    arguments: {
      project_root: fixture.root,
      file_path: "src/a.component.ts",
      symbol_path,
      ...(tool === "ast_explore" ? { detail: "full" } : {}),
      ...input,
    },
  });
}

async function explore(symbolPath: string, input?: Record<string, unknown>, setup?: Setup) {
  const result = await call(symbolPath, input, setup);
  expect(result.isError).not.toBe(true);
  const content = result.structuredContent as Explored;
  return {
    content,
    references: content.evidence[0]?.references,
    reasons: content.omissions.details.map((item) => item.reason),
  };
}

describe("ast_explore template evidence", () => {
  it("reports a private member used only in its template, with context lines", async () => {
    const { content, references, reasons } = await explore("AComponent.hidden", {
      reference_detail: "context",
    });
    expect(references).toMatchObject({
      reference_count: 0,
      template_reference_count: 1,
      template_coverage: { status: "completed", templates: 1 },
    });
    expect(references!.references).toMatchObject([
      { origin: "template_external", context: expect.stringContaining("hidden") },
      { origin: "compiler", context: `private hidden = "h";` },
    ]);
    expect(reasons).toEqual([]);
    expect(content.completeness).toMatchObject({ complete: true, evidence_complete: true });
  });

  it.each([
    ["a selector-public @Input", "src/a.component.ts", "AComponent.label"],
    ["a @Pipe class", "src/fmt.pipe.ts", "FmtPipe"],
    ["an inherited member", "src/base.ts", "Base.shared"],
  ])("gives %s the ast_find_references verdict", async (_name, file_path, symbolPath) => {
    const { references } = await explore(symbolPath, { file_path });
    const found = (await call(symbolPath, { file_path }, { tool: "ast_find_references" }))
      .structuredContent as NonNullable<Explored["evidence"][number]["references"]>;
    expect(found.template_coverage).toBeDefined();
    expect(references!.template_coverage).toEqual(found.template_coverage);
    expect(references!.template_reference_count).toBe(found.template_reference_count);
    expect(references!.references).toEqual(found.references);
  });

  it.each<[string, Setup & { symbol?: string; file_path?: string; mocked?: boolean }]>([
    ["compiler_missing", { compiler: null }],
    ["template_parse_error", { files: { "src/a.component.html": "<p>{{ title </div>" } }],
    ["size_exceeded", { files: { "src/a.component.html": "x".repeat(512 * 1024 + 1) } }],
    ["inherited_member", { symbol: "Base.shared", file_path: "src/base.ts" }],
    ["work_exhausted", { mocked: true }],
  ])("reports %s coverage as one incomplete omission", async (reason, setup) => {
    if (setup.mocked) {
      const coverage = { status: "unfinished", reason, templates: 2000 } as TemplateCoverage;
      templateHalf.mockResolvedValueOnce({ coverage, usages: [] });
    }
    const { content, references } = await explore(
      setup.symbol ?? "AComponent.title",
      setup.file_path ? { file_path: setup.file_path } : {},
      setup,
    );
    expect(references!.template_coverage).toMatchObject({ reason });
    expect(references!.template_coverage!.status).not.toBe("completed");
    expect(content.omissions.details).toEqual([
      { ...INCOMPLETE, subject: expect.any(String), reason: "template_coverage_incomplete" },
    ]);
    expect(content.completeness).toMatchObject({ complete: false, evidence_complete: false });
    expect(content.completeness.unresolved).toEqual([]);
  });

  it("applies reference_limit to the merged TypeScript and template list", async () => {
    const { references, reasons } = await explore("AComponent.title", { reference_limit: 5 });
    expect(references).toMatchObject({
      reference_count: 3,
      template_reference_count: 4,
      total: 8,
      template_coverage: { status: "completed" },
    });
    const items = references!.references;
    expect(items.map((item) => item.origin).join()).toBe(
      `${"template_external,".repeat(4)}compiler`,
    );
    const keys = items.map((item) => `${item.file}:${item.line}:${item.column}`);
    expect(keys).toEqual([...keys].sort((left, right) => left.localeCompare(right)));
    expect(reasons).toEqual(["reference_limit"]);
  });

  it("keeps the incomplete omission when max_bytes drops the references block", async () => {
    const setup = { files: { "src/a.component.html": "<p>{{ title </div>" } };
    const { content, reasons } = await explore("AComponent.title", { max_bytes: 1500 }, setup);
    expect(content.evidence).toEqual([]);
    expect(content.omissions.counts).toContainEqual({ ...INCOMPLETE, count: 1 });
    expect(content.omissions.total).toBe(4);
    expect(content.completeness.evidence_complete).toBe(false);
    expect(reasons).toContain("template_coverage_incomplete");

    const tight = await explore("AComponent.title", { max_bytes: 1500, omission_detail_limit: 0 });
    expect(tight.content.omissions).toMatchObject({ details: [], total: 4 });
    expect(tight.content.omissions.counts).toContainEqual({ ...INCOMPLETE, count: 1 });
    expect(tight.content.completeness.evidence_complete).toBe(false);
  });

  it("keeps the TypeScript references when the template step fails", async () => {
    templateHalf.mockRejectedValueOnce(new Error("template boom"));
    const { content, references, reasons } = await explore("AComponent.title", {
      reference_detail: "context",
    });
    expect(references).toMatchObject({
      reference_count: 3,
      template_reference_count: 0,
      template_coverage: { status: "unfinished", reason: "template_unresolved", templates: 0 },
    });
    expect(references!.references).toHaveLength(4);
    for (const item of references!.references) {
      expect(item).toMatchObject({ origin: "compiler", context: expect.any(String) });
    }
    expect(reasons).toEqual(["template_coverage_incomplete"]);
    expect(content.completeness).toMatchObject({ evidence_complete: false, unresolved: [] });
  });

  /** Makes the TypeScript half throw after the template half already succeeded. */
  const failTypeScriptHalf = (error: Error) =>
    templateHalf.mockImplementationOnce(async (node) => {
      const findable = node as unknown as { findReferencesAsNodes(): unknown[] };
      vi.spyOn(findable, "findReferencesAsNodes").mockImplementation(() => {
        throw error;
      });
      return { coverage: { status: "completed", templates: 1 }, usages: [] };
    });

  it("reports references_unresolved without template fields when TypeScript collection fails", async () => {
    failTypeScriptHalf(new Error("ts boom"));
    const { content, references, reasons } = await explore("AComponent.title");
    expect(references).toBeUndefined();
    expect(reasons).toEqual(["references_unresolved"]);
    expect(content.completeness).toMatchObject({
      evidence_complete: false,
      unresolved: [{ selector: "AComponent.title@4", reason: "references_unresolved" }],
    });
    expect(JSON.stringify(content)).not.toMatch(/template_|origin/);
  });

  it.each([
    ["REQUEST_CANCELLED", "template"],
    ["REQUEST_CANCELLED", "TypeScript"],
    ["OPERATION_DEADLINE_EXCEEDED", "template"],
    ["OPERATION_DEADLINE_EXCEEDED", "TypeScript"],
  ] as const)("propagates %s raised by the %s step", async (code, half) => {
    const interruption = new RequestContextError(code);
    if (half === "template") templateHalf.mockRejectedValueOnce(interruption);
    else failTypeScriptHalf(interruption);
    const result = await call("AComponent.title");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain(code);
  });

  it("completes template coverage on a project of more than 2000 components", async () => {
    // 667 widgets give more than 2000 components. The template scan limit used to be 2000
    // components per symbol, so this project ended with `work_exhausted` (#464). Stopping at a
    // smaller limit is covered with an explicit limit in explore-template-read-cache.test.ts.
    const { files } = generateMatrixProject({ components: 667 });
    const { references } = await explore(
      "Widget0Component.label",
      { file_path: "src/widget-0.component.ts" },
      { files },
    );
    expect(references!.template_coverage).toEqual({
      status: "completed",
      templates: expect.toSatisfy((count: number) => count > 2000),
    });
  });

  it("keeps template usages out of impact, test candidates and call spines", async () => {
    // `go` is called from TypeScript and from the template, so its incoming spine is not empty
    // and a template caller would show up in it.
    const setup = {
      files: {
        "src/a.component.ts": BASE["src/a.component.ts"].replace(
          `title = "x";`,
          `title = "x";\n  go(): void {}`,
        ),
        "src/a.component.html": `${BASE["src/a.component.html"]}<button (click)="go()">go</button>\n`,
        "src/caller.ts": `import { AComponent } from "./a.component.js";
export function trigger(): void {
  new AComponent().go();
}
`,
      },
    };
    const spines = await explore(
      "AComponent.go",
      { call_spines: { direction: "incoming" } },
      setup,
    );
    const callSpines = spines.content.call_spines as { paths: unknown[] };
    expect(spines.references!.template_reference_count).toBe(1);
    expect(spines.references!.references.map((item) => item.origin)).toContain("template_external");
    expect(JSON.stringify(callSpines.paths)).toContain("src/caller.ts");

    // Test candidates fail closed for a called method whatever the template says, so they are
    // probed on `title`, which has four template usages.
    const title = await explore("AComponent.title");
    expect(title.references!.template_reference_count).toBe(4);
    const outputs = [
      callSpines,
      (await call("AComponent.go", {}, { tool: "ast_get_impact" })).structuredContent,
      (await call("AComponent.title", {}, { tool: "ast_get_impact" })).structuredContent,
      (await call("AComponent.title", {}, { tool: "ast_find_test_candidates" })).structuredContent,
    ];
    for (const output of outputs) {
      expect(output).toBeTypeOf("object");
      expect(JSON.stringify(output)).not.toMatch(/\.html|template_/);
    }
    for (const service of ["impact", "test-candidates", "call-spines", "relationships"]) {
      const file = path.join(import.meta.dirname, "..", "src", "services", `${service}.ts`);
      expect(await readFile(file, "utf8")).not.toContain("./references.js");
    }
  });
});
