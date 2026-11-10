import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBatchDocument, runBatchDocument } from "../src/batch/runner.js";
import { createServer } from "../src/server.js";
import { clearProjectSessions } from "../src/services/project.js";
import golden from "./fixtures/explore-unchanged-golden.json" with { type: "json" };
import { createAngularFixture } from "./helpers/angular-fixture.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const FILES = {
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

let client: Client;
let server: ReturnType<typeof createServer>;
let fixture: ProjectFixture | undefined;

const PLAIN_FILES = {
  "src/value.ts": `export function formatValue(value: number): string { return String(value); }\n`,
  "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n`,
};
/** Requests whose output carries no template evidence: it must never change. */
const UNCHANGED = {
  non_angular: { angular: false, file_path: "src/value.ts", symbol_path: "formatValue" },
  not_applicable: { angular: true, file_path: "src/user.ts", symbol_path: "first" },
} as const;

function normalize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, item) => (key === "checked_at" ? "<timestamp>" : item)),
  );
}

beforeEach(async () => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  server = createServer();
  client = new Client({ name: "explore-unchanged-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await Promise.all([client.close(), server.close()]);
  clearProjectSessions();
  await fixture?.cleanup();
  fixture = undefined;
});

describe("ast_explore output without template evidence", () => {
  it.each(["non_angular", "not_applicable"] as const)(
    "%s output is deep-equal to the pre-change golden, direct and in a batch",
    async (name) => {
      const { angular, ...input } = { ...UNCHANGED[name], detail: "full" };
      fixture = angular
        ? await createAngularFixture(FILES, { compiler: "v21" })
        : await createProjectFixture(PLAIN_FILES);
      const direct = await client.callTool({
        name: "ast_explore",
        arguments: { project_root: fixture.root, ...input },
      });
      expect(direct.isError).not.toBe(true);
      const batch = await runBatchDocument(
        parseBatchDocument({
          version: 1,
          project_root: fixture.root,
          steps: [{ id: "explore", tool: "ast_explore", input }],
          emit: { $ref: "#/steps/explore" },
        }),
      );
      const expected = JSON.parse(golden[name]) as unknown;
      expect(normalize(direct.structuredContent)).toEqual(expected);
      expect(normalize(batch.result)).toEqual(expected);
      expect(golden[name]).not.toMatch(/origin|template_coverage|template_reference_count/);
    },
  );
});

describe("ast_explore reports template evidence", () => {
  it("ast_explore output for an Angular member includes its template usages", async () => {
    fixture = await createAngularFixture(FILES, { compiler: "v21" });
    const explored = await client.callTool({
      name: "ast_explore",
      arguments: {
        project_root: fixture.root,
        file_path: "src/a.component.ts",
        symbol_path: "AComponent.title",
        detail: "full",
      },
    });
    expect(explored.isError).not.toBe(true);
    const evidence = (
      explored.structuredContent as { evidence: { references: Record<string, unknown> }[] }
    ).evidence;
    expect(evidence).toHaveLength(1);
    // One TypeScript use in user.ts plus the declaration, and the two template usages.
    expect(evidence[0]!.references).toMatchObject({
      reference_count: 1,
      template_reference_count: 2,
      total: 4,
      affected_files: ["src/a.component.html", "src/a.component.ts", "src/user.ts"],
      template_coverage: { status: "completed", templates: 1 },
    });
  });

  it("routes context-builder through the template verdict collection", async () => {
    const source = await readFile(
      path.join(import.meta.dirname, "..", "src", "services", "context-builder.ts"),
      "utf8",
    );
    expect(source).toContain("collectSymbolReferencesWithTemplateVerdict(");
  });
});
