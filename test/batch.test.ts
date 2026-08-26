import { decode } from "@toon-format/toon";
import { afterEach, describe, expect, it } from "vitest";
import { parseBatchDocument, runBatchDocument } from "../src/batch/runner.js";
import { isReadBatchTool, MAX_BATCH_OUTPUT_BYTES, MAX_FOREACH_ITEMS } from "../src/batch/schema.js";
import { serializeCliSuccess } from "../src/cli-output.js";
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

async function candidateFixture(): Promise<ProjectFixture> {
  const created = await createProjectFixture({
    "src/value.ts":
      "export function formatValue(value: number): string { return String(value); }\n",
    "src/alpha.test.ts":
      'import { formatValue } from "./value.js";\nexport const alpha = formatValue(1);\n',
    "src/use.ts":
      'import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n',
    "src/transitive.test.ts":
      'import { result } from "./use.js";\nexport const transitive = result;\n',
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
  it("preserves diagnostic aggregates through batch JSON and final TOON output", async () => {
    const project = await fixture();
    await project.write("src/error.ts", "export const broken: string = 1;\n");
    const output = await runBatchDocument(
      parseBatchDocument({
        version: 1,
        project_root: project.root,
        steps: [
          {
            id: "diagnostics",
            tool: "ast_get_diagnostics",
            input: { include_aggregates: true, offset: 0, limit: 1 },
          },
        ],
        emit: { $ref: "#/steps/diagnostics" },
      }),
    );
    const result = output.result as Record<string, unknown>;
    expect(result.aggregates).toMatchObject({
      group_limit: 20,
      codes: { groups: [{ code: 2322, count: 1 }] },
      files: { groups: [{ file: "src/error.ts", count: 1 }] },
    });
    expect(decode(serializeCliSuccess(output, "toon"))).toEqual(
      JSON.parse(serializeCliSuccess(output, "json")),
    );
  });

  it("admits test-candidate reads and injects the authoritative pipeline root", async () => {
    const project = await fixture();
    const document = parseBatchDocument({
      version: 1,
      project_root: project.root,
      steps: [
        {
          id: "candidates",
          tool: "ast_find_test_candidates",
          input: { file_path: "src/value.ts", symbol_path: "formatValue", limit: 1 },
        },
      ],
    });
    const invocations: Array<{ tool: string; input: Record<string, unknown> }> = [];

    await runBatchDocument(document, {
      invokeTool: async (tool, input) => {
        invocations.push({ tool, input });
        return { candidates: [], completeness: { complete: true, proven_empty: true } };
      },
    });

    expect(isReadBatchTool(document.steps[0]!.tool)).toBe(true);
    expect(invocations).toEqual([
      {
        tool: "ast_find_test_candidates",
        input: {
          file_path: "src/value.ts",
          symbol_path: "formatValue",
          limit: 1,
          project_root: project.root,
        },
      },
    ]);
    expect(() =>
      parseBatchDocument({
        version: 1,
        project_root: project.root,
        steps: [
          {
            id: "candidates",
            tool: "ast_find_test_candidates",
            input: {
              project_root: "/conflicting/project",
              file_path: "src/value.ts",
              symbol_path: "formatValue",
            },
          },
        ],
      }),
    ).toThrow(/project_root/i);
  });

  it("preserves whole candidate pages across logical JSON and final TOON output", async () => {
    const project = await candidateFixture();
    const runPage = (offset: number) =>
      runBatchDocument(
        parseBatchDocument({
          version: 1,
          project_root: project.root,
          steps: [
            {
              id: "candidates",
              tool: "ast_find_test_candidates",
              input: {
                file_path: "src/value.ts",
                symbol_path: "formatValue",
                max_depth: 2,
                offset,
                limit: 1,
              },
            },
          ],
          emit: { $ref: "#/steps/candidates" },
        }),
      );

    const first = await runPage(0);
    const second = await runPage(1);
    const firstResult = first.result as Record<string, unknown>;
    const secondResult = second.result as Record<string, unknown>;

    expect(firstResult).toMatchObject({
      backend: "typescript_compiler",
      compiler_authoritative: true,
      offset: 0,
      limit: 1,
      total: 2,
      has_more: true,
      next_offset: 1,
    });
    expect(secondResult).toMatchObject({
      offset: 1,
      limit: 1,
      total: 2,
      has_more: false,
      next_offset: null,
    });
    const pages = [firstResult, secondResult].map(
      (result) => (result.candidates as Array<Record<string, unknown>>)[0]!,
    );
    expect(pages.map((candidate) => candidate.file)).toEqual([
      "src/alpha.test.ts",
      "src/transitive.test.ts",
    ]);
    expect(
      pages.map(
        (candidate) => (candidate.evidence as { relationships: unknown[] }).relationships.length,
      ),
    ).toEqual([1, 2]);

    const json = JSON.parse(serializeCliSuccess(first, "json"));
    const toon = decode(serializeCliSuccess(first, "toon")) as Record<string, unknown>;
    expect(toon).toEqual(json);
    expect(toon.result).toEqual(first.result);
  });

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
            symbol_path: { $ref: "#/steps/search/symbols/0/selector" },
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

  it("rejects explicit TOON output in intermediate batch steps before execution", async () => {
    const project = await fixture();

    expect(() =>
      parseBatchDocument({
        version: 1,
        project_root: project.root,
        steps: [
          {
            id: "search",
            tool: "ast_search_symbols",
            input: { query: "format", output_format: "toon" },
          },
        ],
      }),
    ).toThrow(/TOON.*intermediate|intermediate.*TOON/i);
  });

  it("rejects TOON introduced by a resolved template before the dependent invocation", async () => {
    const document = parseBatchDocument({
      version: 1,
      project_root: "/tmp/project",
      steps: [
        { id: "source", tool: "ast_list_files", input: {} },
        {
          id: "search",
          tool: "ast_search_symbols",
          input: { $ref: "#/steps/source/payload" },
        },
      ],
    });
    let invocations = 0;

    await expect(
      runBatchDocument(document, {
        invokeTool: async () => {
          invocations += 1;
          return { payload: { query: "format", output_format: "toon" } };
        },
      }),
    ).rejects.toThrow(/TOON.*intermediate|intermediate.*TOON/i);
    expect(invocations).toBe(1);
  });

  it("preflights every foreach input before invoking any item", async () => {
    const document = parseBatchDocument({
      version: 1,
      project_root: "/tmp/project",
      steps: [
        { id: "producer", tool: "ast_list_files", input: {} },
        {
          id: "searches",
          tool: "ast_search_symbols",
          foreach: { $ref: "#/steps/producer/items" },
          input: { $item: "" },
        },
      ],
    });
    let searchInvocations = 0;

    await expect(
      runBatchDocument(document, {
        invokeTool: async (tool) => {
          if (tool === "ast_list_files") {
            return {
              items: [
                { query: "safe", output_format: "json" },
                { query: "blocked", output_format: "toon" },
              ],
            };
          }
          searchInvocations += 1;
          return { symbols: [] };
        },
      }),
    ).rejects.toThrow(/TOON.*intermediate|intermediate.*TOON/i);
    expect(searchInvocations).toBe(0);
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

    const scaffold = parseBatchDocument({
      version: 1,
      project_root: project.root,
      steps: [
        {
          id: "prepare",
          tool: "ast_scaffold_class",
          input: {
            file_path: "src/value-service.ts",
            class_name: "ValueService",
            methods: [{ name: "render", return_type: "string" }],
          },
        },
      ],
    });
    expect(scaffold.steps[0]!.tool).toBe("ast_scaffold_class");
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
            symbol_path: { $ref: "#/steps/search/symbols/0/selector" },
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
