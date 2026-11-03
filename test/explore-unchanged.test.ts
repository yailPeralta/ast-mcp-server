import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";
import { clearProjectSessions } from "../src/services/project.js";
import { createAngularFixture, type AngularFixture } from "./helpers/angular-fixture.js";

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
let fixture: AngularFixture | undefined;

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

describe("ast_explore stays TypeScript-only", () => {
  it("ast_explore output for an Angular member equals pre-change output", async () => {
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
    const references = evidence[0]!.references as {
      reference_count: number;
      total: number;
      affected_files: string[];
      references: Record<string, unknown>[];
    };
    // One TypeScript use in user.ts plus the declaration: the two template usages are absent.
    expect(references.reference_count).toBe(1);
    expect(references.total).toBe(2);
    expect(references.affected_files).toEqual(["src/a.component.ts", "src/user.ts"]);
    const serialized = JSON.stringify(explored.structuredContent);
    expect(serialized).not.toContain("template_coverage");
    expect(serialized).not.toContain("template_reference_count");
    expect(serialized).not.toContain("origin");
    expect(serialized).not.toContain(".html");
  });

  it("keeps context-builder on the synchronous TypeScript-only references function", async () => {
    const source = await readFile(
      path.join(import.meta.dirname, "..", "src", "services", "context-builder.ts"),
      "utf8",
    );
    expect(source).toContain("collectSymbolReferences(");
    expect(source).not.toContain("collectSymbolReferencesWithTemplates");
  });
});
