import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";

let client: Client;
let closeServer: () => Promise<void>;

beforeEach(async () => {
  const server = createServer();
  client = new Client({ name: "rename-symbol-description-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closeServer = async () => {
    await Promise.all([client.close(), server.close()]);
  };
});

afterEach(async () => {
  await closeServer();
});

describe("ast_rename_symbol description", () => {
  it("description states external template edits and TS-only diagnostics", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "ast_rename_symbol");
    expect(tool?.description).toBe(
      "Prepares an exact hash-bound rename plan without writing. Review the preview and apply its operation_id with ast_apply_operation. The plan also rewrites external Angular templates, including consumer templates when coverage is completed, hash-bound to the workspace snapshot; diagnostics stay TypeScript-only.",
    );
    expect(tool?.description).toMatch(/external Angular templates/u);
    expect(tool?.description).toMatch(/consumer templates/u);
    expect(tool?.description).toMatch(/TypeScript-only/u);
  });
});
