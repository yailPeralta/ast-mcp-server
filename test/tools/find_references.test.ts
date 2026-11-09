import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decode } from "@toon-format/toon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../../src/server.js";
import { clearProjectSessions } from "../../src/services/project.js";
import { createAngularFixture } from "../helpers/angular-fixture.js";
import { createProjectFixture, type ProjectFixture } from "../helpers/project-fixture.js";

const PLAIN_FILES = {
  "src/value.ts": `export function formatValue(value: number): string { return String(value); }\n`,
  "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n`,
};

let client: Client;
let fixture: ProjectFixture | undefined;
let closeServer: () => Promise<void>;

beforeEach(async () => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const server = createServer();
  client = new Client({ name: "find-references-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closeServer = async () => {
    await Promise.all([client.close(), server.close()]);
  };
});

afterEach(async () => {
  await closeServer();
  clearProjectSessions();
  await fixture?.cleanup();
  fixture = undefined;
});

async function call(
  files: Record<string, string>,
  args: Record<string, unknown>,
  create: (f: Record<string, string>) => Promise<ProjectFixture> = createProjectFixture,
) {
  fixture = await create(files);
  return client.callTool({
    name: "ast_find_references",
    arguments: { project_root: fixture.root, ...args },
  });
}

describe("ast_find_references non-Angular output", () => {
  it("non-Angular find_references output deep-equals pre-change golden", async () => {
    const result = await call(PLAIN_FILES, {
      file_path: "src/value.ts",
      symbol_path: "formatValue",
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      symbol: "formatValue",
      include_declaration: true,
      declaration_count: 1,
      reference_count: 2,
      affected_files: ["src/use.ts", "src/value.ts"],
      references: [
        { file: "src/use.ts", line: 1, column: 10, kind: "ImportSpecifier", is_declaration: false },
        {
          file: "src/use.ts",
          line: 2,
          column: 23,
          kind: "CallExpression",
          is_declaration: false,
        },
        { file: "src/value.ts", line: 1, column: 1, kind: "SourceFile", is_declaration: true },
      ],
      offset: 0,
      limit: 100,
      total: 3,
      has_more: false,
      next_offset: null,
    });
  });

  it("reference_count equals the real call sites of a method used before its declaration", async () => {
    const result = await call(
      {
        "src/header.ts": `export class Header {\n  toggle(): void {\n    this.closeMenu();\n  }\n\n  closeMenu(): void {}\n}\n`,
        "src/use.ts": `import { Header } from "./header.js";\nexport const closed = new Header().closeMenu();\n`,
      },
      { file_path: "src/header.ts", symbol_path: "Header.closeMenu" },
    );
    expect(result.isError).not.toBe(true);
    const content = result.structuredContent as {
      reference_count: number;
      total: number;
      references: { line: number; file: string; is_declaration: boolean }[];
    };
    expect(content.reference_count).toBe(2);
    expect(content.total).toBe(3);
    expect(
      content.references.filter((item) => item.file === "src/header.ts" && item.line === 6),
    ).toEqual([expect.objectContaining({ is_declaration: true })]);
  });

  it("non-Angular TOON output decodes to the same golden without template fields", async () => {
    const result = await call(PLAIN_FILES, {
      file_path: "src/value.ts",
      symbol_path: "formatValue",
      output_format: "toon",
    });
    const envelope = result.structuredContent as { format: string; data: string };
    expect(envelope.format).toBe("toon");
    const decoded = decode(envelope.data) as Record<string, unknown>;
    expect(decoded).toMatchObject({ total: 3, reference_count: 2 });
    expect(decoded).not.toHaveProperty("template_coverage");
    expect(decoded).not.toHaveProperty("template_reference_count");
    expect(decoded.references).toHaveLength(3);
    expect(decoded.references).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ origin: expect.anything() })]),
    );
  });
});

const ANGULAR_FILES = {
  "src/a.component.ts": `import { Component } from "@angular/core";
@Component({ selector: "app-a", templateUrl: "./a.component.html" })
export class AComponent {
  title = "x";
}
`,
  "src/user.ts": `import { AComponent } from "./a.component.js";
export const first = new AComponent().title;
`,
  "src/a.component.html": `<h1>{{ title }}</h1>\n<p>{{ title }}</p>\n`,
};
const angular = (files: Record<string, string>) => createAngularFixture(files, { compiler: "v21" });
const ANGULAR_ARGS = { file_path: "src/a.component.ts", symbol_path: "AComponent.title" };

describe("ast_find_references with Angular templates", () => {
  it("JSON and TOON parity for Angular responses", async () => {
    const json = await call(ANGULAR_FILES, ANGULAR_ARGS, angular);
    const expected = json.structuredContent as Record<string, unknown>;
    expect(expected).toMatchObject({
      reference_count: 1,
      template_reference_count: 2,
      total: 4,
      template_coverage: { status: "completed", templates: 1 },
    });
    expect((expected.references as { origin: string }[]).map((item) => item.origin)).toEqual([
      "template_external",
      "template_external",
      "compiler",
      "compiler",
    ]);
    expect(expected.affected_files).toContain("src/a.component.html");

    const toonResult = await client.callTool({
      name: "ast_find_references",
      arguments: { project_root: fixture!.root, ...ANGULAR_ARGS, output_format: "toon" },
    });
    const envelope = toonResult.structuredContent as { format: string; data: string };
    expect(decode(envelope.data)).toEqual(expected);
  });

  it("TOON stays tabular with uniform origin", async () => {
    const result = await call(ANGULAR_FILES, { ...ANGULAR_ARGS, output_format: "toon" }, angular);
    const { data } = result.structuredContent as { data: string };
    expect(data).toMatch(/references\[4\]\{[^}]*\borigin\b[^}]*\}:/);
  });

  it("unfinished coverage is reported not silently dropped", async () => {
    const result = await call(
      { ...ANGULAR_FILES, "src/a.component.html": "<p>{{ title </div>" },
      ANGULAR_ARGS,
      angular,
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      reference_count: 1,
      template_reference_count: 0,
      total: 2,
      template_coverage: { status: "unfinished", reason: "template_parse_error", templates: 0 },
    });
  });

  it("includes the template line as context for detail=context", async () => {
    const result = await call(ANGULAR_FILES, { ...ANGULAR_ARGS, detail: "context" }, angular);
    const references = (result.structuredContent as { references: Record<string, unknown>[] })
      .references;
    expect(references[0]).toMatchObject({
      origin: "template_external",
      kind: "TemplatePropertyRead",
      context: "<h1>{{ title }}</h1>",
    });
  });
});

describe("ast_find_references description", () => {
  it("description states template usages and points to template_diagnostics for type errors", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "ast_find_references");
    expect(tool?.description).toBe(
      "Finds type-resolved references and returns bounded project-relative locations, including declaration impact by default. When @angular/compiler resolves, it also reports Angular template usages, including consumer templates, tagged by origin with a template_coverage verdict; completed covers templates inside the Project only, incomplete coverage does not prove absence. It reports usages only; template type errors are reported by ast_rename_symbol plans in template_diagnostics.",
    );
    expect(tool?.description).toMatch(/template_coverage/u);
    expect(tool?.description).toMatch(/reports usages only/u);
    expect(tool?.description).toMatch(/template_diagnostics/u);
    expect(tool?.description).not.toMatch(/template errors are not diagnosed/u);
    expect(tool?.description).toMatch(/consumer templates/u);
    expect(tool?.description).toMatch(/inside the Project only/u);
  });
});
