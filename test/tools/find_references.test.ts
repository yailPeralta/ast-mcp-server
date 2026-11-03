import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decode } from "@toon-format/toon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../../src/server.js";
import { clearProjectSessions } from "../../src/services/project.js";
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
