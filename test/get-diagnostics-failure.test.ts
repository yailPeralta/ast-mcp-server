import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../src/services/diagnostics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/diagnostics.js")>()),
  buildDiagnosticAggregates: vi.fn(() => {
    throw new Error("injected aggregate failure");
  }),
}));

import { createServer } from "../src/server.js";
import { clearProjectSessions } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

let client: Client | undefined;
let fixture: ProjectFixture | undefined;

afterEach(async () => {
  await client?.close();
  await fixture?.cleanup();
  clearProjectSessions();
});

it("returns the existing error envelope instead of a partial aggregate", async () => {
  fixture = await createProjectFixture({ "src/value.ts": "export const value = 1;\n" });
  const server = createServer();
  client = new Client({ name: "aggregate-failure-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const result = await client.callTool({
    name: "ast_get_diagnostics",
    arguments: { project_root: fixture.root, include_aggregates: true },
  });

  expect(result.isError).toBe(true);
  expect(result).not.toHaveProperty("structuredContent");
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content).toHaveLength(1);
  expect(JSON.parse(content[0]!.text)).toEqual({
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred.",
      correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    },
  });
  await server.close();
});
