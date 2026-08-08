import { decode } from "@toon-format/toon";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import packageMetadata from "../package.json" with { type: "json" };
import { createServer } from "../src/server.js";
import { PublicOperationalError } from "../src/services/public-errors.js";
import {
  clearOperationsForTests,
  prepareRename,
  setOperationTestHooksForTests,
} from "../src/services/operations.js";
import {
  clearProjectSessions,
  getProjectOperationQueueSnapshot,
  withProject,
} from "../src/services/project.js";
import { createProjectIdentity } from "../src/services/project-status.js";
import {
  createSymbolIndexSymbol,
  SYMBOL_INDEX_SCHEMA_VERSION,
} from "../src/services/symbol-index.js";
import { createToolErrorContext, errorResult } from "../src/tools/result.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const PUBLIC_ERROR_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function publicFailure(result: Awaited<ReturnType<Client["callTool"]>>): {
  code: string;
  message: string;
  correlation_id: string;
} {
  expect(result.isError).toBe(true);
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]).toMatchObject({ type: "text", text: expect.any(String) });
  expect(result).not.toHaveProperty("structuredContent");
  const text = content[0]!.text!;
  const parsed = JSON.parse(text) as {
    error: { code: string; message: string; correlation_id: string };
  };
  expect(text).toBe(JSON.stringify(parsed));
  expect(parsed.error.correlation_id).toMatch(PUBLIC_ERROR_UUID_PATTERN);
  return parsed.error;
}

describe("MCP integration", () => {
  let client: Client;
  let server: McpServer;
  let fixture: ProjectFixture;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    fixture = await createProjectFixture({
      "src/value.ts": `export function formatValueHelper(value: number): string { return String(value); }
export function formatValue(value: number): string { return String(value); }
`,
      "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n`,
      "src/transitive.ts": `import { result } from "./use.js";\nexport const wrapped = result;\n`,
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
    vi.unstubAllEnvs();
    stderr.mockRestore();
  });

  it("preserves the frozen public error envelope for a production tool with outputSchema", async () => {
    const failure = publicFailure(
      await client.callTool({
        name: "ast_get_file",
        arguments: { project_root: fixture.root, file_path: "src/missing.ts" },
      }),
    );

    expect(failure).toEqual({
      code: "NOT_FOUND",
      message: "The requested target was not found.",
      correlation_id: expect.stringMatching(PUBLIC_ERROR_UUID_PATTERN),
    });
    expect(stderr).toHaveBeenCalledTimes(1);
    const line = String(stderr.mock.calls[0]![0]);
    expect(JSON.parse(line)).toEqual({
      event: "tool_failure",
      version: 1,
      correlation_id: failure.correlation_id,
      tool: "ast_get_file",
      code: "NOT_FOUND",
      message: "The requested target was not found.",
      project_id: createProjectIdentity({ projectRoot: fixture.root }).project_id,
    });
    expect(line).not.toContain(fixture.root);
  });

  it("preserves the frozen public error envelope for a tool without outputSchema", async () => {
    const fixtureServer = new McpServer({ name: "error-fixture", version: "1.0.0" });
    fixtureServer.registerTool(
      "failure_without_output_schema",
      { inputSchema: z.object({}) },
      async () =>
        errorResult(
          new PublicOperationalError("CONFLICT", "Safe conflict."),
          createToolErrorContext("ast_failure_without_output_schema"),
        ),
    );
    const fixtureClient = new Client({ name: "error-fixture-client", version: "1.0.0" });
    const [fixtureClientTransport, fixtureServerTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      fixtureServer.connect(fixtureServerTransport),
      fixtureClient.connect(fixtureClientTransport),
    ]);

    try {
      expect(
        publicFailure(
          await fixtureClient.callTool({ name: "failure_without_output_schema", arguments: {} }),
        ),
      ).toEqual({
        code: "CONFLICT",
        message: "Safe conflict.",
        correlation_id: expect.stringMatching(PUBLIC_ERROR_UUID_PATTERN),
      });
    } finally {
      await fixtureClient.close();
      await fixtureServer.close();
    }
  });

  it("does not echo hostile values when SDK input validation fails before the callback", async () => {
    const hostilePath = "/home/yail/private/source.ts";
    const hostileCredential = "Authorization: Bearer opaque-precallback-secret";
    const result = await client.callTool({
      name: "ast_get_file",
      arguments: {
        project_root: { hostilePath, hostileCredential },
        file_path: hostilePath,
        limit: hostileCredential,
      },
    });
    const serialized = JSON.stringify(result);

    expect(result.isError).toBe(true);
    expect(serialized).not.toContain(hostilePath);
    expect(serialized).not.toContain("opaque-precallback-secret");
    expect(serialized).not.toContain(hostileCredential);
  });

  it("exposes the reserved enabled policy reason through MCP status", async () => {
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "enabled");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", `${fixture.root}/.symbol-index-cache`);

    const status = structured(
      await client.callTool({
        name: "ast_get_project_status",
        arguments: { project_root: fixture.root },
      }),
    );
    expect(status).toMatchObject({
      index: { state: "disabled" },
      index_observability: {
        policy: "disabled",
        policy_reason: "enabled_not_released",
        backend: "memory",
      },
    });
  });

  it("propagates MCP cancellation to a queued project operation and unlinks it", async () => {
    let markRunning!: () => void;
    const running = new Promise<void>((resolve) => {
      markRunning = resolve;
    });
    let releaseRunning!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseRunning = resolve;
    });
    const blocker = withProject(fixture.root, async () => {
      markRunning();
      await release;
    });
    await running;

    const controller = new AbortController();
    const cancelledCall = client.callTool(
      {
        name: "ast_list_files",
        arguments: { project_root: fixture.root, offset: 0, limit: 10 },
      },
      undefined,
      { signal: controller.signal },
    );
    const cancelledExpectation = expect(cancelledCall).rejects.toThrow();

    try {
      await vi.waitFor(() => {
        expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
          active_operations: 1,
          queued_operations: 1,
        });
      });
      controller.abort();
      await cancelledExpectation;
      await vi.waitFor(() => {
        expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
          active_operations: 1,
          queued_operations: 0,
          cancelled_operations: 1,
        });
      });
    } finally {
      releaseRunning();
      await blocker;
    }
  });

  it("cancels a running MCP apply at the final pre-write checkpoint", async () => {
    const prepared = await prepareRename({
      projectRoot: fixture.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    const originalValue = await fixture.read("src/value.ts");
    const originalUse = await fixture.read("src/use.ts");

    let markBeforeWrite!: () => void;
    const beforeWrite = new Promise<void>((resolve) => {
      markBeforeWrite = resolve;
    });
    let releaseBeforeWrite!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseBeforeWrite = resolve;
    });
    setOperationTestHooksForTests({
      beforeReplace: async (_file, index) => {
        if (index !== 0) return;
        markBeforeWrite();
        await release;
      },
    });

    const controller = new AbortController();
    const applyCall = client.callTool(
      {
        name: "ast_apply_operation",
        arguments: {
          operation_id: prepared.operation_id,
          plan_hash: prepared.plan_hash,
        },
      },
      undefined,
      { signal: controller.signal },
    );
    const cancelledExpectation = expect(applyCall).rejects.toThrow();

    await beforeWrite;
    controller.abort();
    await cancelledExpectation;
    expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
      active_operations: 1,
      queued_operations: 0,
    });

    releaseBeforeWrite();
    await vi.waitFor(() => {
      expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
        active_operations: 0,
        cancelled_operations: 1,
      });
    });
    expect(await fixture.read("src/value.ts")).toBe(originalValue);
    expect(await fixture.read("src/use.ts")).toBe(originalUse);
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
      "ast_get_impact",
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
      freshness: {
        state: "fresh",
        causes: [],
        checked_at: expect.any(String),
      },
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
      freshness: {
        state: "fresh",
        causes: [],
        checked_at: expect.any(String),
      },
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

  it("exposes bounded direct and transitive compiler impact without mutation plans", async () => {
    const impact = structured(
      await client.callTool({
        name: "ast_get_impact",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          direction: "incoming",
          max_depth: 2,
          max_nodes: 10,
          max_edges: 10,
        },
      }),
    );

    expect(impact).toMatchObject({
      root: {
        file: "src/value.ts",
        symbol_path: "formatValue",
        selector: "formatValue@2",
      },
      direction: "incoming",
      incomplete: false,
      truncation: { truncated: false, reason: null },
      freshness: {
        state: "fresh",
        causes: [],
        checked_at: expect.any(String),
      },
    });
    expect(impact.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint: expect.objectContaining({ symbol_path: "result" }),
          direct: true,
          depth: 1,
        }),
        expect.objectContaining({
          endpoint: expect.objectContaining({ symbol_path: "wrapped" }),
          direct: false,
          depth: 2,
        }),
      ]),
    );
    expect(impact.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reference", provenance: "compiler" }),
      ]),
    );
    expect(impact).not.toHaveProperty("operation_id");
    expect(impact).not.toHaveProperty("plan_hash");
    expect(impact).not.toHaveProperty("edits");
  });

  it("falls back to compiler search when an indexed candidate is stale", async () => {
    structured(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: { project_root: fixture.root, query: "formatValue" },
      }),
    );

    await withProject(fixture.root, async (context) => {
      const entry = (
        await context.symbolIndex.load(context.status.project, SYMBOL_INDEX_SCHEMA_VERSION)
      ).find((candidate) => candidate.file_path === "src/value.ts");
      expect(entry).toBeDefined();
      await context.symbolIndex.upsert({
        ...entry!,
        symbols: [
          createSymbolIndexSymbol({
            name: "formatValue",
            symbol_path: "formatValue",
            selector: "formatValue@999",
            kind: "FunctionDeclaration",
            signature: "export function formatValue(value: number): string;",
            line: 999,
            range: { start_line: 999 },
          }),
        ],
      });
    });

    const result = structured(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: { project_root: fixture.root, query: "formatValue" },
      }),
    );
    expect(result.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ selector: "formatValue@2" })]),
    );
    expect(result.symbols).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ selector: "formatValue@999" })]),
    );
  });

  it("exposes project status without leaking the fixture path", async () => {
    const status = structured(
      await client.callTool({
        name: "ast_get_project_status",
        arguments: { project_root: fixture.root },
      }),
    );

    expect(status.state).toBe("fresh");
    expect(status.source_count).toBe(3);
    expect(status.indexed_count).toBe(0);
    expect(status.index).toEqual({ state: "disabled" });
    expect(status.operation_queue).toEqual({
      state: "running",
      admission: "open",
      queue_capacity: 32,
      active_operations: 1,
      queued_operations: 0,
      rejected_operations: 0,
      cancelled_operations: 0,
      queue_timeout_operations: 0,
      deadline_exceeded_operations: 0,
      last_outcome: "none",
      max_queue_wait_ms: expect.any(Number),
      max_execution_ms: 0,
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
      freshness: {
        state: "fresh",
        causes: [],
        checked_at: expect.any(String),
      },
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
    const eligible = new Set([
      "ast_search_symbols",
      "ast_find_references",
      "ast_get_impact",
      "ast_get_diagnostics",
    ]);
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
