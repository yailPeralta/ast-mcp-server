import { decode } from "@toon-format/toon";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Project } from "ts-morph";
import packageMetadata from "../package.json" with { type: "json" };
import toolInventory from "./fixtures/tool-inventory.json" with { type: "json" };
import { parseBatchDocument, runBatchDocument } from "../src/batch/runner.js";
import { serializeCliSuccess } from "../src/cli-output.js";
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
  reportSymbolIndexFailure,
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

async function addCandidateFixtures(fixture: ProjectFixture): Promise<void> {
  const files = {
    "src/another.test.ts": `import { formatValue } from "./value.js";\nexport const anotherTestValue = formatValue(1);\n`,
    "src/value.test.ts": `import { formatValue } from "./value.js";\nexport const directTestValue = formatValue(2);\n`,
    "src/transitive.test.ts": `import { result } from "./use.js";\nexport const transitiveTestValue = result;\n`,
    "src/checks/value.check.ts": `import { formatValue } from "../value.js";\nexport const customTestValue = formatValue(3);\n`,
  };
  await Promise.all(Object.entries(files).map(([file, content]) => fixture.write(file, content)));
}

function callCandidates(
  client: Client,
  fixture: ProjectFixture,
  argumentsOverride: Record<string, unknown> = {},
) {
  return client.callTool({
    name: "ast_find_test_candidates",
    arguments: {
      project_root: fixture.root,
      file_path: "src/value.ts",
      symbol_path: "formatValue",
      ...argumentsOverride,
    },
  });
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

  it.each([
    { label: "absent default", policy: undefined, expectedPolicy: "enabled" },
    { label: "explicit enabled", policy: "enabled", expectedPolicy: "enabled" },
    { label: "explicit canary", policy: "canary", expectedPolicy: "canary" },
  ])(
    "exposes $label SQLite readiness and restart hit without paths",
    async ({ policy, expectedPolicy }) => {
      const xdgCacheHome = path.join(fixture.root, ".xdg-cache");
      const isolatedHome = path.join(fixture.root, ".home");
      const explicitRoot = path.join(fixture.root, ".symbol-index-cache");
      vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", policy);
      vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", policy === undefined ? undefined : explicitRoot);
      vi.stubEnv("XDG_CACHE_HOME", xdgCacheHome);
      vi.stubEnv("HOME", isolatedHome);

      const first = structured(
        await client.callTool({
          name: "ast_get_project_status",
          arguments: { project_root: fixture.root },
        }),
      );
      expect(first).toMatchObject({
        index: { state: "ready" },
        index_observability: {
          policy: expectedPolicy,
          policy_reason: "default",
          backend: "sqlite",
          state: "ready",
          operation: "rebuild",
          last_operation: "rebuild",
          fallback_count: 0,
        },
      });
      expect(JSON.stringify(first)).not.toContain(fixture.root);

      clearProjectSessions();
      const reopened = structured(
        await client.callTool({
          name: "ast_get_project_status",
          arguments: { project_root: fixture.root },
        }),
      );
      expect(reopened).toMatchObject({
        index_observability: {
          policy: expectedPolicy,
          backend: "sqlite",
          state: "ready",
          operation: "hit",
          last_operation: "hit",
          fallback_count: 0,
        },
      });
      expect(JSON.stringify(reopened)).not.toContain(fixture.root);
    },
  );

  it("exposes explicit disabled rollback without creating a cache root", async () => {
    const cacheRoot = path.join(fixture.root, ".symbol-index-cache");
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "disabled");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", cacheRoot);

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
        policy_reason: "default",
        backend: "memory",
        state: "disabled",
      },
    });
    await expect(readdir(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exposes enabled root failure as bounded memory fallback", async () => {
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", undefined);
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", "relative-cache");

    const status = structured(
      await client.callTool({
        name: "ast_get_project_status",
        arguments: { project_root: fixture.root },
      }),
    );

    expect(status).toMatchObject({
      index: { state: "failed" },
      index_observability: {
        policy: "enabled",
        policy_reason: "cache_root_invalid",
        backend: "memory",
        state: "failed",
        operation: "fallback",
        fallback_count: expect.any(Number),
        last_error: "cache_root_invalid",
      },
    });
    const observability = status.index_observability as { fallback_count: number };
    expect(observability.fallback_count).toEqual(expect.any(Number));
    expect(observability.fallback_count).toBeGreaterThan(0);
    expect(JSON.stringify(status)).not.toContain(fixture.root);
  });

  it("keeps compiler reads fresh during stable persistence fallback", async () => {
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));

    expect(
      structured(
        await client.callTool({
          name: "ast_get_project_status",
          arguments: { project_root: fixture.root },
        }),
      ),
    ).toMatchObject({ index_observability: { backend: "sqlite", state: "ready" } });
    await reportSymbolIndexFailure(fixture.root, "capability_unavailable");

    const status = structured(
      await client.callTool({
        name: "ast_get_project_status",
        arguments: { project_root: fixture.root },
      }),
    );
    expect(status).toMatchObject({
      state: "fresh",
      causes: [],
      compiler: { state: "ready" },
      index: { state: "failed" },
      index_observability: {
        backend: "memory",
        state: "failed",
        operation: "fallback",
        last_operation: "fallback",
        fallback_count: 1,
        rejected_entries: 1,
        last_error: "capability_unavailable",
      },
    });

    const search = structured(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: {
          project_root: fixture.root,
          query: "formatValue",
          detail: "selectors",
        },
      }),
    );
    expect(search.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "src/value.ts", selector: "formatValue@2" }),
      ]),
    );

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
    expect(references.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: "src/use.ts" })]),
    );

    const impact = structured(
      await client.callTool({
        name: "ast_get_impact",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          direction: "incoming",
          max_depth: 1,
          max_nodes: 10,
          max_edges: 10,
        },
      }),
    );
    expect(impact).toMatchObject({
      freshness: {
        state: "fresh",
        causes: [],
        checked_at: expect.any(String),
      },
    });

    const finalStatus = structured(
      await client.callTool({
        name: "ast_get_project_status",
        arguments: { project_root: fixture.root },
      }),
    );
    expect(finalStatus).toMatchObject({
      state: "fresh",
      causes: [],
      index_observability: { fallback_count: 1 },
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
      onFilePhase: async ({ index, phase }) => {
        if (phase !== "before-publish" || index !== 0) return;
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
    expect(tools.tools.map((tool) => tool.name)).toEqual(toolInventory.names);
    expect(createHash("sha256").update(JSON.stringify(tools.tools)).digest("hex")).toBe(
      toolInventory.tools_list_sha256,
    );

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

  it("returns opt-in page-independent diagnostic aggregates from one compiler query", async () => {
    await fixture.write("src/alpha-error.ts", "export const alpha: string = 1;\n");
    await fixture.write("src/zeta-error.ts", 'export const zeta: number = "x";\n');
    clearProjectSessions();

    const compilerQuery = vi.spyOn(Project.prototype, "getPreEmitDiagnostics");
    const first = structured(
      await client.callTool({
        name: "ast_get_diagnostics",
        arguments: { project_root: fixture.root, include_aggregates: true, offset: 0, limit: 1 },
      }),
    );
    expect(compilerQuery).toHaveBeenCalledTimes(1);
    compilerQuery.mockRestore();

    const second = structured(
      await client.callTool({
        name: "ast_get_diagnostics",
        arguments: { project_root: fixture.root, include_aggregates: true, offset: 1, limit: 1 },
      }),
    );
    const disabled = structured(
      await client.callTool({
        name: "ast_get_diagnostics",
        arguments: { project_root: fixture.root, offset: 0, limit: 1 },
      }),
    );
    const encoded = toon(
      await client.callTool({
        name: "ast_get_diagnostics",
        arguments: {
          project_root: fixture.root,
          include_aggregates: true,
          output_format: "toon",
          offset: 1,
          limit: 1,
        },
      }),
    );
    const batch = await runBatchDocument(
      parseBatchDocument({
        version: 1,
        project_root: fixture.root,
        steps: [
          {
            id: "diagnostics",
            tool: "ast_get_diagnostics",
            input: { include_aggregates: true, offset: 1, limit: 1 },
          },
        ],
        emit: { $ref: "#/steps/diagnostics" },
      }),
    );

    expect(Object.keys(disabled).sort()).toEqual([
      "diagnostics",
      "duration_ms",
      "error_count",
      "has_more",
      "limit",
      "next_offset",
      "offset",
      "total",
      "warning_count",
    ]);
    expect(first.aggregates).toEqual(second.aggregates);
    expect(encoded.aggregates).toEqual(first.aggregates);
    expect((batch.result as Record<string, unknown>).aggregates).toEqual(first.aggregates);
    expect(first.diagnostics).not.toEqual(second.diagnostics);
    expect(first.aggregates).toMatchObject({
      group_limit: 20,
      codes: { groups: [{ code: 2322, count: 2 }], covered_diagnostic_count: 2 },
      files: {
        groups: [
          { file: "src/alpha-error.ts", count: 1 },
          { file: "src/zeta-error.ts", count: 1 },
        ],
        covered_diagnostic_count: 2,
        unfiled_diagnostic_count: 0,
      },
    });
    expect(JSON.stringify(first.aggregates)).not.toContain(fixture.root);
    expect((first.diagnostics as Array<{ file: string }>).map(({ file }) => file)).not.toContain(
      "src/zeta-error.ts",
    );
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

  it("rejects false-complete incoming call emptiness", async () => {
    clearProjectSessions();

    const callImpact = (output_format: "json" | "toon") =>
      client.callTool({
        name: "ast_get_impact",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          direction: "incoming",
          relationship_kinds: ["call"],
          max_depth: 1,
          max_nodes: 10,
          max_edges: 10,
          output_format,
        },
      });
    const impact = structured(await callImpact("json"));
    const toonImpact = toon(await callImpact("toon"));

    const normalize = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, item) => (key === "checked_at" ? "<timestamp>" : item)),
      );
    expect(normalize(toonImpact)).toEqual(normalize(impact));
    expect(impact).not.toMatchObject({ edges: [], incomplete: false });
    expect(impact.edges).toEqual([
      expect.objectContaining({
        relationship_id:
          'call:["src/use.ts","result","result@2"]->["src/value.ts","formatValue","formatValue@2"]',
        source: expect.objectContaining({
          file: "src/use.ts",
          symbol_path: "result",
          selector: "result@2",
        }),
        target: expect.objectContaining({
          file: "src/value.ts",
          symbol_path: "formatValue",
          selector: "formatValue@2",
        }),
        kind: "call",
        provenance: "compiler",
        confidence: "exact",
        resolution: "resolved",
        compiler_authoritative: true,
      }),
    ]);
    expect(impact.coverage).toEqual([
      {
        kind: "call",
        direction: "incoming",
        endpoint_class: "symbol",
        status: "completed",
      },
    ]);
    expect(impact.work).toMatchObject({
      max_items: 100_000,
      consumed_items: expect.any(Number),
      exhausted: false,
    });
    expect(impact.work).toSatisfy(
      (work: { consumed_items: number; max_items: number }) =>
        Number.isSafeInteger(work.consumed_items) && work.consumed_items <= work.max_items,
    );
  });

  it("finds exact compiler-backed test candidates with bounded trust metadata", async () => {
    await addCandidateFixtures(fixture);
    const tools = await client.listTools();
    const registered = tools.tools.find((tool) => tool.name === "ast_find_test_candidates");
    expect(registered).toMatchObject({
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(registered?.inputSchema.properties).toMatchObject({
      max_depth: { default: 3, maximum: 32 },
      max_nodes: { default: 100, maximum: 1000 },
      max_edges: { default: 200, maximum: 5000 },
      offset: { default: 0 },
      limit: { default: 100, maximum: 500 },
    });
    expect(Object.keys(registered?.inputSchema.properties ?? {})).not.toEqual(
      expect.arrayContaining(["direction", "relationship_kinds", "impact", "output_format"]),
    );

    const candidates = structured(await callCandidates(client, fixture));
    expect(candidates).toMatchObject({
      backend: "typescript_compiler",
      compiler_authoritative: true,
      root: { file: "src/value.ts", symbol_path: "formatValue", selector: "formatValue@2" },
      direction: "incoming",
      max_depth: 3,
      max_nodes: 100,
      max_edges: 200,
      incomplete: false,
      truncation: { truncated: false, reason: null },
      completeness: { complete: true, proven_empty: false },
      freshness: { state: "fresh", causes: [], checked_at: expect.any(String) },
      offset: 0,
      limit: 100,
      total: 3,
      has_more: false,
      next_offset: null,
    });
    const summary = (candidates.candidates as Array<Record<string, unknown>>).map((candidate) => [
      candidate.file,
      candidate.reason,
      (candidate.evidence as { depth: number }).depth,
    ]);
    expect(summary).toEqual([
      ["src/another.test.ts", "direct_compiler_reference", 1],
      ["src/value.test.ts", "direct_compiler_reference", 1],
      ["src/transitive.test.ts", "transitive_compiler_reference", 2],
    ]);
    expect(candidates).not.toHaveProperty("operation_id");
    expect(candidates).not.toHaveProperty("plan_hash");
    expect(candidates).not.toHaveProperty("edits");

    const custom = structured(
      await callCandidates(client, fixture, {
        test_file_patterns: ["**/*.check.ts"],
        test_directories: [],
      }),
    );
    expect(custom.candidates).toEqual([
      expect.objectContaining({
        file: "src/checks/value.check.ts",
        reason: "convention_match",
      }),
    ]);

    const empty = structured(
      await callCandidates(client, fixture, { symbol_path: "formatValueHelper" }),
    );
    expect(empty).toMatchObject({
      candidates: [],
      total: 0,
      completeness: { complete: true, proven_empty: true },
    });
  });

  it("fails closed before pagination and keeps candidate proofs atomic", async () => {
    await addCandidateFixtures(fixture);
    const incomplete = publicFailure(await callCandidates(client, fixture, { max_nodes: 1 }));
    expect(incomplete).toMatchObject({ code: "INCOMPLETE_EVIDENCE" });

    const missing = publicFailure(
      await callCandidates(client, fixture, { symbol_path: "missingSymbol" }),
    );
    expect(missing).toMatchObject({ code: "NOT_FOUND" });

    const maximums = structured(
      await callCandidates(client, fixture, {
        max_depth: 32,
        max_nodes: 1000,
        max_edges: 5000,
        offset: 2,
        limit: 1,
      }),
    );
    expect(maximums).toMatchObject({
      max_depth: 32,
      max_nodes: 1000,
      max_edges: 5000,
      offset: 2,
      limit: 1,
      total: 3,
      candidates: [expect.objectContaining({ file: "src/transitive.test.ts" })],
    });
    const proof = (maximums.candidates as Array<{ evidence: Record<string, unknown[]> }>)[0]!
      .evidence;
    expect(proof.relationship_ids).toHaveLength(2);
    expect(proof.relationships).toHaveLength(2);
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

  it("publishes executable explore inputs and explicit multi-format outputs", async () => {
    const tools = (await client.listTools()).tools;
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(Object.keys(tool.inputSchema.properties ?? {}).length).toBeGreaterThan(0);
      for (const required of tool.inputSchema.required ?? []) {
        expect(tool.inputSchema.properties).toHaveProperty(required);
      }
    }
    const explore = tools.find((tool) => tool.name === "ast_explore");
    expect(explore?.inputSchema.required).toEqual(["project_root"]);
    expect(explore?.inputSchema.properties).toMatchObject({
      project_root: { type: "string" },
      detail: { enum: ["selectors", "summary", "context", "full"], default: "summary" },
      max_bytes: { type: "integer", minimum: 1024 },
      call_spines: {
        type: "object",
        properties: {
          direction: { enum: ["incoming", "outgoing"], default: "outgoing" },
          max_depth: { minimum: 0, maximum: 32, default: 3 },
          max_nodes: { minimum: 1, maximum: 1000, default: 100 },
          max_edges: { minimum: 1, maximum: 5000, default: 200 },
        },
      },
    });

    const dualFormat = tools.filter((tool) =>
      Object.hasOwn(tool.inputSchema.properties ?? {}, "output_format"),
    );
    expect(dualFormat.map((tool) => tool.name).sort()).toEqual([
      "ast_find_references",
      "ast_get_diagnostics",
      "ast_get_impact",
      "ast_search_symbols",
    ]);
    for (const tool of dualFormat) {
      expect(tool.inputSchema.properties?.output_format).toMatchObject({
        enum: ["json", "toon"],
        default: "json",
      });
      expect(tool.outputSchema).toBeUndefined();
    }
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

    for (const arguments_ of [
      { project_root: fixture.root },
      { project_root: fixture.root, query: "formatValue", symbol_path: "formatValue" },
      { project_root: fixture.root, query: "formatValue", call_spines: {} },
    ]) {
      const invalid = await client.callTool({ name: "ast_explore", arguments: arguments_ });
      expect(invalid.isError).toBe(true);
    }
  });

  it("exposes exact compiler call spines and bounded omission metadata", async () => {
    const exact = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          call_spines: { direction: "incoming" },
          max_bytes: 4096,
        },
      }),
    );
    expect(exact).toMatchObject({
      call_spines: {
        root: { file: "src/value.ts", symbol_path: "formatValue", selector: "formatValue@2" },
        direction: "incoming",
        paths: [
          {
            endpoint: { file: "src/use.ts", symbol_path: "result", selector: "result@2" },
            relationship_ids: [expect.any(String)],
          },
        ],
        incomplete: false,
        authority_state: "authoritative",
        empty_proven: false,
      },
      completeness: { spines_complete: true },
      omissions: { counts: [], details: [], total: 0, has_more: false },
      budget: { max_bytes: 4096 },
    });
    expect((exact.budget as { used_bytes: number }).used_bytes).toBeLessThanOrEqual(4096);

    const outgoing = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          file_path: "src/use.ts",
          symbol_path: "result",
          call_spines: {},
          max_bytes: 4096,
        },
      }),
    );
    expect(outgoing).toMatchObject({
      call_spines: {
        direction: "outgoing",
        budget: { max_depth: 3, max_nodes: 100, max_edges: 200 },
        paths: [
          {
            endpoint: {
              file: "src/value.ts",
              symbol_path: "formatValue",
              selector: "formatValue@2",
            },
          },
        ],
      },
    });

    const bounded = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          call_spines: { direction: "incoming", max_nodes: 1 },
          omission_detail_limit: 1,
          max_bytes: 4096,
        },
      }),
    );
    expect(bounded).toMatchObject({
      call_spines: {
        paths: [],
        incomplete: true,
        truncation_reasons: ["node_limit"],
        empty_proven: false,
      },
      completeness: { complete: false, evidence_complete: false, spines_complete: false },
      omissions: {
        counts: [{ category: "budget", component: "call_spine", count: 1 }],
        details: [
          {
            subject: "formatValue@2",
            category: "budget",
            component: "call_spine",
            reason: "node_limit",
          },
        ],
        total: 1,
        has_more: false,
      },
    });
  });

  it("atomically omits oversized call spines across direct MCP and batch", async () => {
    const caller = `call${"x".repeat(900)}`;
    await fixture.write(
      "src/spine-target.ts",
      "export function spineTarget(): number { return 1; }\n",
    );
    await fixture.write(
      "src/spine-caller.ts",
      `import { spineTarget } from "./spine-target.js";\nexport const ${caller} = spineTarget();\n`,
    );
    const baseInput = {
      file_path: "src/spine-target.ts",
      symbol_path: "spineTarget",
      max_bytes: 1024,
    };

    const noSpine = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: { project_root: fixture.root, ...baseInput },
      }),
    );
    expect(noSpine.completeness).toMatchObject({ complete: true });

    const spineInput = { ...baseInput, call_spines: { direction: "incoming" } };
    const direct = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: { project_root: fixture.root, ...spineInput },
      }),
    );
    expect(direct).not.toHaveProperty("call_spines");
    expect(direct).toMatchObject({
      omissions: {
        counts: [{ category: "budget", component: "call_spine", count: 1 }],
        details: [
          {
            subject: "spineTarget@1",
            category: "budget",
            component: "call_spine",
            reason: "byte_limit",
          },
        ],
        total: 1,
        has_more: false,
      },
      completeness: {
        complete: false,
        evidence_complete: false,
        spines_complete: false,
      },
      truncation: { truncated: true, reason: "byte_limit" },
      budget: { max_bytes: 1024, used_bytes: expect.any(Number) },
    });
    const directBytes = Buffer.byteLength(JSON.stringify(direct), "utf8");
    expect(directBytes).toBe((direct.budget as { used_bytes: number }).used_bytes);
    expect(directBytes).toBeLessThanOrEqual(1024);

    const ample = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          ...spineInput,
          max_bytes: 65536,
        },
      }),
    );
    expect(ample).toMatchObject({
      call_spines: {
        paths: [{ endpoint: { selector: `${caller}@2` } }],
        incomplete: false,
      },
      completeness: { complete: true, spines_complete: true },
    });

    const document = parseBatchDocument({
      version: 1,
      project_root: fixture.root,
      steps: [{ id: "explore", tool: "ast_explore", input: spineInput }],
      emit: { $ref: "#/steps/explore" },
    });
    const batch = await runBatchDocument(document);
    const normalize = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, item) => (key === "checked_at" ? "<timestamp>" : item)),
      );
    expect(normalize(batch.result)).toEqual(normalize(direct));
  });

  it("keeps ast_explore direct, batch, JSON, and TOON results logically equivalent", async () => {
    const input = {
      file_path: "src/value.ts",
      symbol_path: "formatValue",
      call_spines: { direction: "incoming" },
      max_bytes: 4096,
    };
    const direct = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: { project_root: fixture.root, ...input },
      }),
    );
    const document = parseBatchDocument({
      version: 1,
      project_root: fixture.root,
      steps: [{ id: "explore", tool: "ast_explore", input }],
      emit: { $ref: "#/steps/explore" },
    });
    const batch = await runBatchDocument(document);
    const normalize = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, item) => (key === "checked_at" ? "<timestamp>" : item)),
      );

    expect(normalize(batch.result)).toEqual(normalize(direct));
    expect(batch.result).toMatchObject({
      route: "symbol",
      completeness: { complete: true, spines_complete: true },
      omissions: { total: 0, has_more: false },
      budget: { max_bytes: 4096, used_bytes: expect.any(Number) },
    });
    const json = JSON.parse(serializeCliSuccess(batch, "json"));
    const encodedToon = decode(serializeCliSuccess(batch, "toon")) as Record<string, unknown>;
    expect(encodedToon).toEqual(json);
    expect(encodedToon.result).toEqual(batch.result);

    expect(() =>
      parseBatchDocument({
        version: 1,
        project_root: fixture.root,
        steps: [
          {
            id: "explore",
            tool: "ast_explore",
            input: { ...input, project_root: "/conflicting/project" },
          },
        ],
      }),
    ).toThrow(/project_root/i);
    const tooSmall = parseBatchDocument({
      version: 1,
      project_root: fixture.root,
      steps: [
        { id: "explore", tool: "ast_explore", input: { query: "formatValue", max_bytes: 1 } },
      ],
    });
    await expect(runBatchDocument(tooSmall)).rejects.toMatchObject({
      code: "TOOL_ERROR",
      stepId: "explore",
    });
  });

  it("cancels queued ast_explore work without returning partial evidence", async () => {
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
    const explored = client.callTool(
      {
        name: "ast_explore",
        arguments: { project_root: fixture.root, query: "formatValue", detail: "full" },
      },
      undefined,
      { signal: controller.signal },
    );
    try {
      await vi.waitFor(() =>
        expect(getProjectOperationQueueSnapshot(fixture.root).queued_operations).toBe(1),
      );
      controller.abort();
      await expect(explored).rejects.toThrow();
      await vi.waitFor(() =>
        expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
          active_operations: 1,
          queued_operations: 0,
          cancelled_operations: 1,
        }),
      );
    } finally {
      releaseRunning();
      await blocker;
    }
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

    const impact = toon(
      await client.callTool({
        name: "ast_get_impact",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          output_format: "toon",
        },
      }),
    );
    expect(impact).toMatchObject({
      root: { file: "src/value.ts", symbol_path: "formatValue" },
      freshness: { state: "fresh" },
    });

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

  it("denies the apply tool while keeping reads, prepare and preview under the guard", async () => {
    const guardedServer = createServer({ denyApply: true });
    const guardedClient = new Client({ name: "ast-mcp-guard-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      guardedServer.connect(serverTransport),
      guardedClient.connect(clientTransport),
    ]);

    const guardedTools = (await guardedClient.listTools()).tools.sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const baselineTools = (await client.listTools()).tools
      .filter(({ name }) => name !== "ast_apply_operation")
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(guardedTools).toHaveLength(15);
    expect(JSON.stringify(guardedTools)).toBe(JSON.stringify(baselineTools));

    // Reads, prepare, and preview still work on the guarded surface.
    const read = structured(
      await guardedClient.callTool({
        name: "ast_get_project_status",
        arguments: { project_root: fixture.root },
      }),
    );
    expect(read).toMatchObject({ compiler: { state: "ready" } });

    const prepared = structured(
      await guardedClient.callTool({
        name: "ast_rename_symbol",
        arguments: {
          project_root: fixture.root,
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          new_name: "formatValueRenamed",
          dry_run: true,
        },
      }),
    );
    expect(prepared.operation_id).toEqual(expect.any(String));

    const preview = structured(
      await guardedClient.callTool({
        name: "ast_get_operation_preview",
        arguments: {
          operation_id: prepared.operation_id,
          file: "src/value.ts",
        },
      }),
    );
    expect(preview).toMatchObject({ plan_hash: expect.any(String) });
  });
});
