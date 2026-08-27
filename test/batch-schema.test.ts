import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BATCH_TOOLS,
  parseBatchDocument,
  PREPARE_BATCH_TOOLS,
  READ_BATCH_TOOLS,
} from "../src/batch/schema.js";
import { createServer } from "../src/server.js";
import { toolCatalog } from "../src/tools/catalog.js";

afterEach(() => {
  vi.doUnmock("../src/tools/catalog.js");
  vi.resetModules();
});

describe("catalog-backed production projections", () => {
  it("uses the catalog's exact closed batch projections", () => {
    expect(READ_BATCH_TOOLS).toBe(toolCatalog.batch.read);
    expect(PREPARE_BATCH_TOOLS).toBe(toolCatalog.batch.prepare);
    expect(BATCH_TOOLS).toEqual([...toolCatalog.batch.read, ...toolCatalog.batch.prepare]);
    expect(toolCatalog.batch).toMatchObject({
      read: expect.any(Array),
      prepare: expect.any(Array),
      excluded: expect.any(Array),
    });
    expect(toolCatalog.batch.read).toHaveLength(8);
    expect(toolCatalog.batch.prepare).toHaveLength(3);
    expect(toolCatalog.batch.excluded).toHaveLength(5);
  });

  it("keeps excluded tools rejected and existing batch errors unchanged", () => {
    expect(() =>
      parseBatchDocument({
        version: 1,
        project_root: "/project",
        steps: [{ id: "excluded", tool: "ast_get_file", input: {} }],
      }),
    ).toThrow();
    expect(() =>
      parseBatchDocument({
        version: 1,
        project_root: "/project",
        steps: [
          { id: "prepare", tool: "ast_rename_symbol", input: {} },
          { id: "read", tool: "ast_list_files", input: {} },
        ],
      }),
    ).toThrow("A prepare step must be the final batch step.");
  });

  it("registers the fixed server inventory through the catalog", async () => {
    const registerAll = vi.fn();
    vi.resetModules();
    vi.doMock("../src/tools/catalog.js", () => ({ toolCatalog: { registerAll } }));

    const { createServer: createCatalogServer } = await import("../src/server.js");
    const server = createCatalogServer();
    expect(registerAll).toHaveBeenCalledOnce();
    expect(registerAll).toHaveBeenCalledWith(server);
  });

  it("matches the four direct JSON+TOON descriptors to live tools/list schemas", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "catalog-projection-test", version: "1" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      const liveToon = tools.tools
        .filter((tool) => Object.hasOwn(tool.inputSchema.properties ?? {}, "output_format"))
        .map(({ name }) => name);
      expect(liveToon).toEqual(toolCatalog.directToon);
      expect(liveToon).toHaveLength(4);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
