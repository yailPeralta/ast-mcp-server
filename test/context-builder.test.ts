import { afterEach, describe, expect, it } from "vitest";
import { buildExploreContext, type ExploreRequest } from "../src/services/context-builder.js";
import { clearProjectSessions, createFreshProject, withProject } from "../src/services/project.js";
import { RequestContextError } from "../src/services/request-context.js";
import {
  createSymbolIndexSymbol,
  SYMBOL_INDEX_SCHEMA_VERSION,
} from "../src/services/symbol-index.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

const request = (overrides: Partial<ExploreRequest> = {}): ExploreRequest => ({
  detail: "summary",
  referenceDetail: "locations",
  offset: 0,
  limit: 20,
  referenceLimit: 20,
  maxBytes: 64 * 1024,
  ...overrides,
});

afterEach(async () => {
  clearProjectSessions();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe("context builder", () => {
  it("preserves default ranking without requesting call traversal", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": `export function formatValueHelper(): void {}
export function formatValue(): void {}
`,
    });
    fixtures.push(fixture);

    const result = await withProject(fixture.root, (context) =>
      buildExploreContext(context, request({ query: "formatValue" })),
    );

    expect(result.symbols.map((item) => item.selector)).toEqual([
      "formatValue@2",
      "formatValueHelper@1",
    ]);
    expect(result).not.toHaveProperty("call_spines");
    expect(result.omissions).toEqual({ counts: [], details: [], total: 0, has_more: false });
  });

  it("reuses structural search ranking and reports bounded pagination", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": `export function formatValueHelper(value: number): string { return String(value); }
export function formatValue(value: number): string { return String(value); }
`,
    });
    fixtures.push(fixture);

    const result = await withProject(fixture.root, (context) =>
      buildExploreContext(context, request({ query: "formatValue", limit: 1 })),
    );

    expect(result.route).toBe("query");
    expect(result.symbols).toEqual([
      expect.objectContaining({ selector: "formatValue@2", signature: expect.any(String) }),
    ]);
    expect(result.total).toBe(2);
    expect(result.has_more).toBe(true);
    expect(result.next_offset).toBe(1);
    expect(result.truncation).toEqual({ truncated: true, reason: "record_limit" });
    expect(result.completeness).toMatchObject({
      complete: false,
      symbols_complete: false,
      evidence_complete: true,
      unresolved: [],
    });
  });

  it("resolves an exact selector and composes source plus compiler references", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts":
        "export function formatValue(value: number): string { return String(value); }\n",
      "src/use.ts":
        'import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n',
    });
    fixtures.push(fixture);

    const result = await withProject(fixture.root, (context) =>
      buildExploreContext(
        context,
        request({
          filePath: "src/value.ts",
          symbolPath: "formatValue",
          detail: "full",
        }),
      ),
    );

    expect(result.route).toBe("symbol");
    expect(result.symbols).toEqual([
      expect.objectContaining({ selector: "formatValue@1", symbol_path: "formatValue" }),
    ]);
    expect(result.evidence).toEqual([
      expect.objectContaining({
        selector: "formatValue@1",
        source: expect.objectContaining({
          file: "src/value.ts",
          text: expect.stringContaining("return String"),
        }),
        references: expect.objectContaining({
          declaration_count: 1,
          reference_count: 2,
          total: 3,
          references: expect.arrayContaining([expect.objectContaining({ file: "src/use.ts" })]),
        }),
      }),
    ]);
    expect(result.freshness.state).toBe("fresh");
    expect(result.completeness).toMatchObject({
      complete: true,
      symbols_complete: true,
      evidence_complete: true,
      unresolved: [],
    });
  });

  it("propagates cooperative interruption from reference collection", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts":
        "export function formatValue(value: number): string { return String(value); }\n",
    });
    fixtures.push(fixture);
    const context = createFreshProject(fixture.root);
    const countCheckpoints = async (includeReferences: boolean): Promise<number> => {
      let count = 0;
      await buildExploreContext(
        context,
        request({
          filePath: "src/value.ts",
          symbolPath: "formatValue",
          detail: "full",
          includeSource: false,
          includeReferences,
        }),
        {
          signal: new AbortController().signal,
          checkpoint: () => {
            count += 1;
          },
        },
      );
      return count;
    };
    const withoutReferences = await countCheckpoints(false);
    const withReferences = await countCheckpoints(true);
    expect(withReferences).toBeGreaterThan(withoutReferences);
    let checkpoints = 0;

    await expect(
      buildExploreContext(
        context,
        request({
          filePath: "src/value.ts",
          symbolPath: "formatValue",
          detail: "full",
          includeSource: false,
        }),
        {
          signal: new AbortController().signal,
          checkpoint: () => {
            checkpoints += 1;
            if (checkpoints === withoutReferences) {
              throw new RequestContextError("REQUEST_CANCELLED");
            }
          },
        },
      ),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(checkpoints).toBe(withoutReferences);
  });

  it("uses a known file route without requiring a query", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);

    const result = await withProject(fixture.root, (context) =>
      buildExploreContext(context, request({ filePath: "src/value.ts", detail: "selectors" })),
    );

    expect(result.route).toBe("file");
    expect(result.query).toBeNull();
    expect(result.symbols).toEqual([
      { file: "src/value.ts", selector: "value@1", kind: "VariableDeclaration" },
    ]);
  });

  it("fails closed when no query or routing file is supplied", async () => {
    const fixture = await createProjectFixture({ "src/value.ts": "export const value = 1;\n" });
    fixtures.push(fixture);

    await expect(
      withProject(fixture.root, (context) => buildExploreContext(context, request())),
    ).rejects.toThrow("requires query");
  });

  it("falls back to compiler search when the index is not ready", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts":
        "export function formatValue(value: number): string { return String(value); }\n",
    });
    fixtures.push(fixture);

    const result = await buildExploreContext(
      createFreshProject(fixture.root),
      request({ query: "formatValue", detail: "full" }),
    );

    expect(result.symbols).toEqual([
      expect.objectContaining({ selector: "formatValue@1", symbol_path: "formatValue" }),
    ]);
    expect(result.freshness.state).toBe("pending");
  });

  it("falls back to compiler search when an indexed selector mismatches", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts":
        "export function formatValue(value: number): string { return String(value); }\n",
    });
    fixtures.push(fixture);

    const result = await withProject(fixture.root, async (context) => {
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
      return buildExploreContext(context, request({ query: "formatValue", detail: "full" }));
    });

    expect(result.symbols).toEqual([
      expect.objectContaining({ selector: "formatValue@1", symbol_path: "formatValue" }),
    ]);
    expect(result.symbols).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ selector: "formatValue@999" })]),
    );
    expect(result.freshness).toMatchObject({
      state: "fresh",
      causes: expect.not.arrayContaining(["index_failure"]),
    });
  });
});
