import { decode } from "@toon-format/toon";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import packageMetadata from "../package.json" with { type: "json" };
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
      "src/value.ts": `export function formatValueHelper(value: number): string { return String(value); }
export function formatValue(value: number): string { return String(value); }
`,
      "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n`,
    });
    server = createServer();
    client = new Client({ name: "ast-mcp-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    expect(client.getServerVersion()?.version).toBe(packageMetadata.version);
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
      "ast_get_project_status",
      "ast_explore",
      "ast_get_outline",
      "ast_get_symbol_source",
      "ast_search_symbols",
      "ast_find_references",
      "ast_get_diagnostics",
      "ast_get_file",
      "ast_rename_symbol",
      "ast_replace_symbol_body",
      "ast_scaffold_class",
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

    const file = structured(
      await client.callTool({
        name: "ast_get_file",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          offset: 1,
          limit: 1,
        },
      }),
    );
    expect(file).toMatchObject({
      mode: "source",
      file: "src/value.ts",
      range: { offset: 1, limit: 1, total_lines: 2 },
      lines: [
        {
          line: 2,
          text: "export function formatValue(value: number): string { return String(value); }",
        },
      ],
      snapshot_state: "fresh",
    });
    expect(file.file_hash).toMatch(/^[0-9a-f]{64}$/);

    const symbolsOnly = structured(
      await client.callTool({
        name: "ast_get_file",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbols_only: true,
        },
      }),
    );
    expect(symbolsOnly).toMatchObject({
      mode: "symbols_only",
      file: "src/value.ts",
      snapshot_state: "fresh",
    });
    expect(symbolsOnly.symbols).toEqual(
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
        arguments: { project_root: fixture.root, query: "formatValue" },
      }),
    );
    expect(symbols.total).toBe(2);
    expect(symbols.limit).toBe(20);
    expect(symbols.symbols).toEqual([
      {
        file: "src/value.ts",
        selector: "formatValue@2",
        kind: "FunctionDeclaration",
        signature: "export function formatValue(value: number): string;",
      },
      {
        file: "src/value.ts",
        selector: "formatValueHelper@1",
        kind: "FunctionDeclaration",
        signature: "export function formatValueHelper(value: number): string;",
      },
    ]);

    const selectorSymbols = structured(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: {
          project_root: fixture.root,
          query: "formatValue",
          detail: "selectors",
        },
      }),
    );
    expect(selectorSymbols.symbols).toEqual([
      { file: "src/value.ts", selector: "formatValue@2", kind: "FunctionDeclaration" },
      {
        file: "src/value.ts",
        selector: "formatValueHelper@1",
        kind: "FunctionDeclaration",
      },
    ]);

    const fullSymbols = structured(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: {
          project_root: fixture.root,
          query: "formatValue",
          detail: "full",
          limit: 100,
        },
      }),
    );
    expect(fullSymbols.limit).toBe(100);
    expect(fullSymbols.symbols).toEqual([
      expect.objectContaining({ symbol_path: "formatValue", name: "formatValue", line: 2 }),
      expect.objectContaining({ symbol_path: "formatValueHelper", line: 1 }),
    ]);

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
    expect(references).toMatchObject({
      include_declaration: true,
      declaration_count: 1,
    });
    expect(references.total).toBe(3);
    expect(references.references).toEqual(
      expect.arrayContaining([expect.not.objectContaining({ context: expect.anything() })]),
    );

    const referencesWithContext = structured(
      await client.callTool({
        name: "ast_find_references",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          detail: "context",
        },
      }),
    );
    expect(referencesWithContext.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ context: expect.any(String) })]),
    );

    const diagnostics = structured(
      await client.callTool({
        name: "ast_get_diagnostics",
        arguments: { project_root: fixture.root },
      }),
    );
    expect(diagnostics.error_count).toBe(0);
  });

  it("exposes project status without leaking the fixture path", async () => {
    const status = structured(
      await client.callTool({
        name: "ast_get_project_status",
        arguments: { project_root: fixture.root },
      }),
    );

    expect(status.state).toBe("fresh");
    expect(status.source_count).toBe(2);
    expect(status.indexed_count).toBe(0);
    expect(status.index).toEqual({ state: "disabled" });
    expect(status.operation_queue).toEqual({
      state: "running",
      active_operations: 1,
      queued_operations: 0,
    });
    expect(status.project).toEqual({
      project_id: expect.stringMatching(/^project_[0-9a-f]{20}$/),
      config_id: expect.stringMatching(/^config_[0-9a-f]{20}$/),
    });
    expect(JSON.stringify(status)).not.toContain(fixture.root);
  });

  it("composes search-to-source exploration with bounded evidence", async () => {
    const explored = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          query: "formatValue",
          detail: "summary",
          limit: 1,
        },
      }),
    );
    expect(explored).toMatchObject({
      route: "query",
      total: 2,
      has_more: true,
      truncation: { truncated: true, reason: "record_limit" },
      completeness: { symbols_complete: false, evidence_complete: true },
    });
    expect(explored.symbols).toEqual([
      expect.objectContaining({ selector: "formatValue@2", signature: expect.any(String) }),
    ]);

    const exact = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          detail: "full",
        },
      }),
    );
    expect(exact).toMatchObject({
      route: "symbol",
      completeness: { complete: true, unresolved: [] },
    });
    expect(exact.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: "formatValue@2",
          source: expect.objectContaining({ file: "src/value.ts" }),
          references: expect.objectContaining({ reference_count: 2 }),
        }),
      ]),
    );

    const invalid = await client.callTool({
      name: "ast_explore",
      arguments: { project_root: fixture.root },
    });
    expect(invalid.isError).toBe(true);
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
        arguments: {
          project_root: fixture.root,
          query: "formatValue",
          detail: "full",
          output_format: "toon",
        },
      }),
    );
    expect(symbols.total).toBe(2);
    expect(symbols.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "src/value.ts", symbol_path: "formatValue" }),
      ]),
    );

    const references = toon(
      await client.callTool({
        name: "ast_find_references",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          detail: "context",
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

  it("prepares, previews and atomically applies a create-only class scaffold", async () => {
    const prepared = structured(
      await client.callTool({
        name: "ast_scaffold_class",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value-service.ts",
          class_name: "ValueService",
          methods: [
            {
              name: "render",
              is_async: false,
              return_type: "string",
              access: "public",
              parameters: [{ name: "value", type: "number" }],
            },
          ],
        },
      }),
    );
    expect(prepared).toMatchObject({
      kind: "scaffold_class",
      status: "prepared",
      blocked: false,
      file: "src/value-service.ts",
      class_name: "ValueService",
      pending_methods: ["ValueService.render"],
    });
    expect(prepared.outline).toContain("export class ValueService");
    await expect(fixture.read("src/value-service.ts")).rejects.toMatchObject({ code: "ENOENT" });

    const preview = structured(
      await client.callTool({
        name: "ast_get_operation_preview",
        arguments: {
          operation_id: prepared.operation_id,
          file: "src/value-service.ts",
        },
      }),
    );
    expect(JSON.stringify(preview)).toContain("/dev/null");
    expect(JSON.stringify(preview)).toContain("Not implemented: ValueService.render");

    const applied = structured(
      await client.callTool({
        name: "ast_apply_operation",
        arguments: {
          operation_id: prepared.operation_id,
          plan_hash: prepared.plan_hash,
        },
      }),
    );
    expect(applied).toMatchObject({ kind: "scaffold_class", status: "applied" });
    expect(await fixture.read("src/value-service.ts")).toContain(
      'throw new Error("Not implemented: ValueService.render")',
    );
  });
});
