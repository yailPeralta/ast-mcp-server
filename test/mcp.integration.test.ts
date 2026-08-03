import { decode } from "@toon-format/toon";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { clearOperationsForTests } from "../src/services/operations.js";
import { clearProjectSessions } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

function structured(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  expect(result.isError).not.toBe(true);
  expect(result.content).toEqual([]);
  expect(result.structuredContent).toBeTypeOf("object");
  return result.structuredContent as Record<string, unknown>;
}

function toon(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  if (result.isError === true) {
    throw new Error(`Expected TOON success, received: ${JSON.stringify(result)}`);
  }
  expect(result.content).toEqual([]);
  expect(result.structuredContent).toMatchObject({ format: "toon", data: expect.any(String) });
  const envelope = result.structuredContent as { format: string; data: string };
  return decode(envelope.data) as Record<string, unknown>;
}

describe("MCP integration", () => {
  let client: Client;
  let server: McpServer;
  let fixture: ProjectFixture;

  beforeEach(async () => {
    fixture = await createProjectFixture({
      "src/value.ts": `export function formatValue(value: number): string { return String(value); }\n`,
      "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n`,
    });
    server = createServer();
    client = new Client({ name: "ast-mcp-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    await fixture.cleanup();
    clearOperationsForTests();
    clearProjectSessions();
  });

  it("exposes compact structured read results", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "ast_list_files",
      "ast_get_outline",
      "ast_get_symbol_source",
      "ast_search_symbols",
      "ast_find_references",
      "ast_get_diagnostics",
      "ast_rename_symbol",
      "ast_replace_symbol_body",
      "ast_get_operation_preview",
      "ast_apply_operation",
    ]);

    const files = structured(
      await client.callTool({
        name: "ast_list_files",
        arguments: { project_root: fixture.root, limit: 1 },
      }),
    );
    expect(files.files).toHaveLength(1);
    expect(files.has_more).toBe(true);

    const outline = structured(
      await client.callTool({
        name: "ast_get_outline",
        arguments: { project_root: fixture.root, file_path: "src/value.ts" },
      }),
    );
    expect(outline.outline).toContain("export function formatValue(value: number): string;");
    expect(outline.symbols).toBeUndefined();

    const detailedOutline = structured(
      await client.callTool({
        name: "ast_get_outline",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          include_symbols: true,
        },
      }),
    );
    expect(detailedOutline.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ symbolPath: "formatValue" })]),
    );

    const source = structured(
      await client.callTool({
        name: "ast_get_symbol_source",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
        },
      }),
    );
    expect(source.text).toContain("return String(value)");

    const symbols = structured(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: { project_root: fixture.root, query: "format" },
      }),
    );
    expect(symbols.total).toBe(1);

    const references = structured(
      await client.callTool({
        name: "ast_find_references",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
        },
      }),
    );
    expect(references.total).toBe(3);

    const diagnostics = structured(
      await client.callTool({
        name: "ast_get_diagnostics",
        arguments: { project_root: fixture.root },
      }),
    );
    expect(diagnostics.error_count).toBe(0);
  });

  it("exposes lossless TOON envelopes for eligible collection reads only when requested", async () => {
    await fixture.write(
      "src/error.ts",
      'export const broken: string = 42;\nexport const message = "comma, quote: \\" and ✅";\n',
    );
    clearProjectSessions();

    const symbols = toon(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: { project_root: fixture.root, query: "format", output_format: "toon" },
      }),
    );
    expect(symbols.total).toBe(1);
    expect(symbols.symbols).toEqual([
      expect.objectContaining({ file: "src/value.ts", symbol_path: "formatValue" }),
    ]);

    const references = toon(
      await client.callTool({
        name: "ast_find_references",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          output_format: "toon",
        },
      }),
    );
    expect(references.total).toBe(3);
    expect(references.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: "src/use.ts" })]),
    );

    const diagnostics = toon(
      await client.callTool({
        name: "ast_get_diagnostics",
        arguments: { project_root: fixture.root, output_format: "toon" },
      }),
    );
    expect(diagnostics.error_count).toBeGreaterThanOrEqual(1);
    expect(diagnostics.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: "src/error.ts", code: 2322 })]),
    );

    const tools = await client.listTools();
    const eligible = new Set(["ast_search_symbols", "ast_find_references", "ast_get_diagnostics"]);
    for (const tool of tools.tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(Object.hasOwn(properties, "output_format")).toBe(eligible.has(tool.name));
    }
  });

  it("prepares, previews and atomically applies a rename", async () => {
    const prepared = structured(
      await client.callTool({
        name: "ast_rename_symbol",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          new_name: "renderValue",
        },
      }),
    );
    expect(prepared.blocked).toBe(false);
    const operationId = prepared.operation_id as string;
    expect(await fixture.read("src/value.ts")).toContain("formatValue");

    const preview = structured(
      await client.callTool({
        name: "ast_get_operation_preview",
        arguments: { operation_id: operationId, file: "src/use.ts" },
      }),
    );
    expect(JSON.stringify(preview)).toContain("renderValue");

    const applied = structured(
      await client.callTool({
        name: "ast_apply_operation",
        arguments: {
          operation_id: prepared.operation_id,
          plan_hash: prepared.plan_hash,
        },
      }),
    );
    expect(applied.status).toBe("applied");
    expect(await fixture.read("src/value.ts")).toContain("renderValue");
    expect(await fixture.read("src/use.ts")).toContain("renderValue");
  });
});
