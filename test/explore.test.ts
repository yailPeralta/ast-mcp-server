import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";
import { clearProjectSessions, withProject } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

type ExplorePayload = {
  truncation: { truncated: boolean; reason: string | null };
  completeness: { complete: boolean; symbols_complete: boolean; spines_complete?: boolean };
  budget: { max_bytes: number; used_bytes: number };
  omissions: {
    counts: Array<{ category: string; component: string; count: number }>;
    details: Array<{ subject: string; category: string; component: string; reason: string }>;
    total: number;
    has_more: boolean;
  };
  call_spines?: unknown;
  symbols: unknown[];
  total: number;
  has_more: boolean;
  next_offset: number | null;
};

function structured(result: Awaited<ReturnType<Client["callTool"]>>): ExplorePayload {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeTypeOf("object");
  return result.structuredContent as unknown as ExplorePayload;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("ast_explore", () => {
  let client: Client;
  let server: McpServer;
  let fixture: ProjectFixture;

  beforeEach(async () => {
    fixture = await createProjectFixture({
      "src/value.ts": "export function targetValue(value: number): number { return value + 1; }\n",
    });
    server = createServer();
    client = new Client({ name: "ast-explore-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    await fixture.cleanup();
    clearProjectSessions();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("publishes additive call-spine and omission controls without changing defaults", async () => {
    const result = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: { project_root: fixture.root, query: "targetValue" },
      }),
    );
    expect(result).not.toHaveProperty("call_spines");
    expect(result.completeness).not.toHaveProperty("spines_complete");
    expect(result.omissions).toEqual({ counts: [], details: [], total: 0, has_more: false });

    const invalid = await client.callTool({
      name: "ast_explore",
      arguments: {
        project_root: fixture.root,
        query: "targetValue",
        call_spines: { direction: "incoming" },
      },
    });
    expect(invalid.isError).toBe(true);

    const overLimit = await client.callTool({
      name: "ast_explore",
      arguments: {
        project_root: fixture.root,
        file_path: "src/value.ts",
        symbol_path: "targetValue",
        call_spines: { max_depth: 33, max_nodes: 1001, max_edges: 5001 },
        omission_detail_limit: 101,
      },
    });
    expect(overLimit.isError).toBe(true);
  });

  it("continues direct and composed query tools across the 10,000-result boundary", async () => {
    await fixture.write(
      "src/many.ts",
      `export const ${Array.from(
        { length: 10_001 },
        (_, index) => `pageTarget${String(index).padStart(5, "0")} = ${index}`,
      ).join(",")};\n`,
    );

    const directFirst = structured(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: {
          project_root: fixture.root,
          query: "pageTarget",
          detail: "selectors",
          offset: 9_999,
          limit: 1,
        },
      }),
    );
    const directContinuation = structured(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: {
          project_root: fixture.root,
          query: "pageTarget",
          detail: "selectors",
          offset: directFirst.next_offset!,
          limit: 1,
        },
      }),
    );

    expect(directFirst).toMatchObject({
      total: 10_001,
      has_more: true,
      next_offset: 10_000,
      symbols: [{ selector: "pageTarget09999@1" }],
    });
    expect(directContinuation).toMatchObject({
      total: 10_001,
      has_more: false,
      next_offset: null,
      symbols: [{ selector: "pageTarget10000@1" }],
    });

    const exploreFirst = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          query: "pageTarget",
          offset: 9_999,
          limit: 1,
        },
      }),
    );
    const exploreContinuation = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          query: "pageTarget",
          offset: exploreFirst.next_offset!,
          limit: 1,
        },
      }),
    );

    expect(exploreFirst).toMatchObject({
      total: 10_001,
      has_more: true,
      next_offset: 10_000,
      symbols: [{ selector: "pageTarget09999@1" }],
    });
    expect(exploreContinuation).toMatchObject({
      total: 10_001,
      has_more: false,
      next_offset: null,
      symbols: [{ selector: "pageTarget10000@1" }],
    });
  }, 240_000);

  it("does not degrade the index when cancellation wins during an ast_explore query", async () => {
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));
    const queryStarted = deferred();
    const releaseQuery = deferred();

    await withProject(fixture.root, (context) => {
      expect(context.symbolIndexBackend).toBe("sqlite");
      expect(context.symbolIndexReady).toBe(true);
      vi.spyOn(context.symbolIndex, "countSymbols").mockImplementationOnce(async () => {
        queryStarted.resolve();
        await releaseQuery.promise;
        throw Object.assign(new Error("injected read failure after cancellation"), {
          code: "read_failed",
        });
      });
    });

    const controller = new AbortController();
    const call = client.callTool(
      {
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          query: "target",
          detail: "summary",
        },
      },
      undefined,
      { signal: controller.signal },
    );
    const cancelled = expect(call).rejects.toThrow();

    await queryStarted.promise;
    controller.abort();
    releaseQuery.resolve();
    await cancelled;

    const indexState = await withProject(fixture.root, (context) => ({
      backend: context.symbolIndexBackend,
      ready: context.symbolIndexReady,
      state: context.status.state,
      causes: context.status.causes,
      observability: context.symbolIndexObservability,
    }));
    expect(indexState).toMatchObject({
      backend: "sqlite",
      ready: true,
      state: "fresh",
      causes: [],
      observability: {
        state: "ready",
        fallback_count: 0,
        last_error: null,
      },
    });
  });

  it("reports byte-budget truncation instead of silently dropping context", async () => {
    await fixture.write(
      "src/many.ts",
      `${Array.from(
        { length: 40 },
        (_, index) => `export const target${String(index).padStart(2, "0")} = ${index};`,
      ).join("\n")}\n`,
    );
    clearProjectSessions();

    const result = structured(
      await client.callTool({
        name: "ast_explore",
        arguments: {
          project_root: fixture.root,
          query: "target",
          detail: "context",
          limit: 20,
          max_bytes: 1024,
        },
      }),
    );

    expect(result.truncation).toEqual({ truncated: true, reason: "byte_limit" });
    expect(result.completeness.complete).toBe(false);
    expect(result.completeness.symbols_complete).toBe(false);
    expect(result.budget.max_bytes).toBe(1024);
    expect(result.budget.used_bytes).toBeLessThanOrEqual(1024);
    expect(result.symbols.length).toBeGreaterThan(0);
    expect(result.symbols.length).toBeLessThan(20);
  });
});
