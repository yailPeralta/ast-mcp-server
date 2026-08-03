import { afterEach, describe, expect, it } from "vitest";
import { parseBatchDocument, runBatchDocument } from "../src/batch/runner.js";
import { MAX_BATCH_OUTPUT_BYTES, MAX_FOREACH_ITEMS } from "../src/batch/schema.js";
import { clearOperationsForTests } from "../src/services/operations.js";
import { clearProjectSessions } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

async function fixture(): Promise<ProjectFixture> {
  const created = await createProjectFixture({
    "src/value.ts":
      "export function formatValue(value: number): string { return String(value); }\n",
    "src/use.ts":
      'import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n',
  });
  fixtures.push(created);
  return created;
}

afterEach(async () => {
  clearOperationsForTests();
  clearProjectSessions();
  await Promise.all(fixtures.splice(0).map((item) => item.cleanup()));
});

describe("batch runner", () => {
  it("chains a symbol search into an exact source read and emits only the projection", async () => {
    const project = await fixture();
    const document = parseBatchDocument({
      version: 1,
      project_root: project.root,
      steps: [
        {
          id: "search",
          tool: "ast_search_symbols",
          input: { query: "formatValue" },
        },
        {
          id: "source",
          tool: "ast_get_symbol_source",
          input: {
            file_path: { $ref: "#/steps/search/symbols/0/file" },
            symbol_path: { $ref: "#/steps/search/symbols/0/symbol_path" },
          },
        },
      ],
      emit: {
        file: { $ref: "#/steps/source/file" },
        text: { $ref: "#/steps/source/text" },
      },
    });

    const output = await runBatchDocument(document);

    expect(output.status).toBe("ok");
    expect(output.step_count).toBe(2);
    expect(output.invocation_count).toBe(2);
    expect(output.result).toEqual({
      file: "src/value.ts",
      text: "export function formatValue(value: number): string { return String(value); }",
    });
    expect(JSON.stringify(output.result)).not.toContain('duration_ms":');
  });

  it("expands a bounded foreach in source order", async () => {
    const project = await fixture();
    const document = parseBatchDocument({
      version: 1,
      project_root: project.root,
      limits: { concurrency: 2 },
      steps: [
        { id: "files", tool: "ast_list_files", input: { limit: 2 } },
        {
          id: "outlines",
          tool: "ast_get_outline",
          foreach: { $ref: "#/steps/files/files" },
          input: { file_path: { $item: "" } },
        },
      ],
    });

    const output = await runBatchDocument(document);
    const outlines = output.result as Array<{ file: string; outline: string }>;

    expect(output.invocation_count).toBe(3);
    expect(outlines.map((item) => item.file)).toEqual(["src/use.ts", "src/value.ts"]);
    expect(outlines.every((item) => !Object.hasOwn(item, "symbols"))).toBe(true);
  });

  it("rejects forward refs, conflicting roots and forbidden apply calls before execution", async () => {
    const project = await fixture();
    const base = {
      version: 1,
      project_root: project.root,
    } as const;

    expect(() =>
      parseBatchDocument({
        ...base,
        steps: [
          {
            id: "first",
            tool: "ast_get_outline",
            input: { file_path: { $ref: "#/steps/later/file" } },
          },
          { id: "later", tool: "ast_list_files", input: {} },
        ],
      }),
    ).toThrow(/forward|prior/i);

    expect(() =>
      parseBatchDocument({
        ...base,
        steps: [
          {
            id: "files",
            tool: "ast_list_files",
            input: { project_root: "/another/project" },
          },
        ],
      }),
    ).toThrow(/project_root/i);

    expect(() =>
      parseBatchDocument({
        ...base,
        steps: [
          {
            id: "apply",
            tool: "ast_apply_operation",
            input: { operation_id: "00000000-0000-4000-8000-000000000000" },
          },
        ],
      }),
    ).toThrow(/tool|invalid/i);
  });

  it("allows one prepare only as the final non-foreach step", async () => {
    const project = await fixture();

    expect(() =>
      parseBatchDocument({
        version: 1,
        project_root: project.root,
        steps: [
          {
            id: "prepare",
            tool: "ast_rename_symbol",
            input: {
              file_path: "src/value.ts",
              symbol_path: "formatValue",
              new_name: "renderValue",
            },
          },
          { id: "files", tool: "ast_list_files", input: {} },
        ],
      }),
    ).toThrow(/prepare.*final/i);
  });

  it("rejects missing runtime reference targets before invoking the dependent tool", async () => {
    let invocations = 0;
    const document = parseBatchDocument({
      version: 1,
      project_root: "/tmp/project",
      steps: [
        { id: "search", tool: "ast_search_symbols", input: { query: "missing" } },
        {
          id: "source",
          tool: "ast_get_symbol_source",
          input: {
            file_path: { $ref: "#/steps/search/symbols/0/file" },
            symbol_path: { $ref: "#/steps/search/symbols/0/symbol_path" },
          },
        },
      ],
    });

    await expect(
      runBatchDocument(document, {
        invokeTool: async () => {
          invocations += 1;
          return { symbols: [] };
        },
      }),
    ).rejects.toThrow(/does not (exist|contain)/i);
    expect(invocations).toBe(1);
  });

  it("rejects foreach expansion beyond the fixed item limit", async () => {
    let invocations = 0;
    const document = parseBatchDocument({
      version: 1,
      project_root: "/tmp/project",
      steps: [
        { id: "files", tool: "ast_list_files", input: {} },
        {
          id: "outlines",
          tool: "ast_get_outline",
          foreach: { $ref: "#/steps/files/files" },
          input: { file_path: { $item: "" } },
        },
      ],
    });

    await expect(
      runBatchDocument(document, {
        invokeTool: async () => {
          invocations += 1;
          return {
            files: Array.from({ length: MAX_FOREACH_ITEMS + 1 }, (_, index) => `${index}.ts`),
          };
        },
      }),
    ).rejects.toThrow(/maximum/i);
    expect(invocations).toBe(1);
  });

  it("rejects an oversized tool result before retaining it", async () => {
    const document = parseBatchDocument({
      version: 1,
      project_root: "/tmp/project",
      steps: [{ id: "files", tool: "ast_list_files", input: {} }],
    });

    await expect(
      runBatchDocument(document, {
        invokeTool: async () => ({ text: "x".repeat(MAX_BATCH_OUTPUT_BYTES) }),
      }),
    ).rejects.toThrow(/maximum per result/i);
  });

  it("rejects cumulative intermediate context even when emit is small", async () => {
    const largeResult = "x".repeat(9 * 1024 * 1024);
    const document = parseBatchDocument({
      version: 1,
      project_root: "/tmp/project",
      steps: Array.from({ length: 6 }, (_, index) => ({
        id: `step${index}`,
        tool: "ast_list_files" as const,
        input: {},
      })),
      emit: { status: "bounded" },
    });

    await expect(
      runBatchDocument(document, {
        invokeTool: async () => ({ text: largeResult }),
      }),
    ).rejects.toThrow(/retained context exceeds/i);
  });

  it("always exposes review coordinates for a persisted prepare even when emit omits them", async () => {
    const planHash = "a".repeat(64);
    const operationId = "00000000-0000-4000-8000-000000000000";
    const document = parseBatchDocument({
      version: 1,
      project_root: "/tmp/project",
      steps: [
        {
          id: "prepare",
          tool: "ast_rename_symbol",
          input: {
            file_path: "src/value.ts",
            symbol_path: "formatValue",
            new_name: "renderValue",
          },
        },
      ],
      emit: { summary: "review required" },
    });

    const output = await runBatchDocument(document, {
      invokeTool: async () => ({ operation_id: operationId, plan_hash: planHash }),
      persistPreparedOperation: async () => "/tmp/review.astplan",
    });

    expect(output.result).toEqual({ summary: "review required" });
    expect(output.operation_id).toBe(operationId);
    expect(output.plan_hash).toBe(planHash);
    expect(output.plan_file).toBe("/tmp/review.astplan");
  });

  it("rejects a conflicting project_root introduced through a resolved reference", async () => {
    const document = parseBatchDocument({
      version: 1,
      project_root: "/tmp/project",
      steps: [
        { id: "source", tool: "ast_list_files", input: {} },
        {
          id: "conflict",
          tool: "ast_list_files",
          input: { $ref: "#/steps/source/payload" },
        },
      ],
    });
    let invocations = 0;

    await expect(
      runBatchDocument(document, {
        invokeTool: async () => {
          invocations += 1;
          return { payload: { project_root: "/tmp/other", limit: 1 } };
        },
      }),
    ).rejects.toThrow(/conflicting project_root/i);
    expect(invocations).toBe(1);
  });
});
