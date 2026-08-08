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
  completeness: { complete: boolean; symbols_complete: boolean };
  budget: { max_bytes: number; used_bytes: number };
  symbols: unknown[];
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

  it("does not degrade the index when cancellation wins during an ast_explore query", async () => {
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));
    const queryStarted = deferred();
    const releaseQuery = deferred();

    await withProject(fixture.root, (context) => {
      expect(context.symbolIndexBackend).toBe("sqlite");
      expect(context.symbolIndexReady).toBe(true);
      vi.spyOn(context.symbolIndex, "queryAllSymbols").mockImplementationOnce(async () => {
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
