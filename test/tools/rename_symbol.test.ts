import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as operations from "../../src/services/operations.js";
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
  vi.restoreAllMocks();
  await closeServer();
});

describe("ast_rename_symbol description", () => {
  it("description states external template edits and the template_diagnostics field", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "ast_rename_symbol");
    expect(tool?.description).toBe(
      "Prepares an exact hash-bound rename plan without writing. Review the preview and apply its operation_id with ast_apply_operation. The plan also rewrites external Angular templates, including consumer templates when coverage is completed, hash-bound to the workspace snapshot. The diagnostics field stays TypeScript-only; when templates are edited, template_diagnostics reports the template type-check delta separately with a typed status, and blocks only with block_on_template_errors=true.",
    );
    expect(tool?.description).toMatch(/external Angular templates/u);
    expect(tool?.description).toMatch(/consumer templates/u);
    expect(tool?.description).toMatch(/diagnostics field stays TypeScript-only/u);
    expect(tool?.description).toMatch(/template_diagnostics/u);
    expect(tool?.description).toMatch(/block_on_template_errors=true\.$/u);
    expect(tool?.description).not.toMatch(/diagnostics stay TypeScript-only/u);
  });
});

describe("ast_rename_symbol template diagnostics contract", () => {
  const PREPARED = {
    operation_id: "6f1c1f0e-7a2b-4c3d-9e4f-0a1b2c3d4e5f",
    plan_hash: "a".repeat(64),
    kind: "rename_symbol" as const,
    status: "prepared" as const,
    project_root: "/project",
    created_at: "2026-11-08T00:00:00.000Z",
    expires_at: "2026-11-08T00:15:00.000Z",
    affected_files: [],
    reference_count: 0,
    workspace_hash: "d".repeat(64),
    post_workspace_hash: "e".repeat(64),
    workspace_file_count: 1,
    diagnostics: { added: [], removed: [], addedErrors: [] },
    allow_new_errors: false,
    blocked: false,
    block_reason: null,
    preview: null,
    preview_truncated: false,
  };
  const ARGUMENTS = {
    project_root: "/project",
    file_path: "src/a.ts",
    symbol_path: "A",
    new_name: "B",
  };

  async function tools() {
    return new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
  }

  it("declares the optional block_on_template_errors input with a false default", async () => {
    const schema = (await tools()).get("ast_rename_symbol")?.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(schema.properties.block_on_template_errors).toEqual({
      type: "boolean",
      default: false,
      description:
        "Block the plan when a completed template check adds template errors. allow_new_errors still waives it.",
    });
    expect(schema.required).not.toContain("block_on_template_errors");
  });

  it("forwards the flag to the plan, defaulting to false", async () => {
    const prepare = vi.spyOn(operations, "prepareRename").mockResolvedValue(PREPARED);

    await client.callTool({ name: "ast_rename_symbol", arguments: ARGUMENTS });
    await client.callTool({
      name: "ast_rename_symbol",
      arguments: { ...ARGUMENTS, block_on_template_errors: true },
    });

    expect(prepare.mock.calls.map(([args]) => args.blockOnTemplateErrors)).toEqual([false, true]);
  });

  it("returns template_diagnostics only when the plan carries it", async () => {
    const call = () => client.callTool({ name: "ast_rename_symbol", arguments: ARGUMENTS });
    vi.spyOn(operations, "prepareRename").mockResolvedValueOnce(PREPARED);
    expect((await call()).structuredContent).not.toHaveProperty("template_diagnostics");

    vi.spyOn(operations, "prepareRename").mockResolvedValueOnce({
      ...PREPARED,
      template_diagnostics: {
        status: "unavailable",
        reason: "compiler_cli_missing",
        added: [],
        removed: [],
        addedErrors: [],
      },
      block_on_template_errors: false,
    });
    expect((await call()).structuredContent).toMatchObject({
      template_diagnostics: {
        status: "unavailable",
        reason: "compiler_cli_missing",
        added: [],
        removed: [],
        added_errors: [],
      },
    });
  });

  it("changes only the rename output contract, not replace or scaffold", async () => {
    const listed = await tools();
    const properties = (name: string) =>
      Object.keys(
        (listed.get(name)?.outputSchema as { properties?: Record<string, unknown> } | undefined)
          ?.properties ?? {},
      );

    expect(properties("ast_replace_symbol_body")).toContain("plan_hash");
    expect(properties("ast_scaffold_class")).toContain("plan_hash");
    expect(properties("ast_rename_symbol")).toContain("template_diagnostics");
    expect(properties("ast_replace_symbol_body")).not.toContain("template_diagnostics");
    expect(properties("ast_scaffold_class")).not.toContain("template_diagnostics");
    expect(properties("ast_find_references")).not.toContain("template_diagnostics");
  });
});
