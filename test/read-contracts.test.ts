import { describe, expect, it } from "vitest";
import {
  FRESHNESS_CAUSES,
  READ_TRUNCATION_REASONS,
  SNAPSHOT_STATES,
  TRUNCATION_REASONS,
  createFileRange,
  createSourceLocation,
  createTruncationMetadata,
  isJsonValue,
  isSnapshotState,
  type BudgetMetadata,
  type FreshnessMetadata,
  type ReadResult,
  type SourceRange,
} from "../src/services/read-contracts.js";

describe("read contracts", () => {
  it("publishes the closed snapshot and freshness vocabularies", () => {
    expect(SNAPSHOT_STATES).toEqual(["fresh", "pending", "stale", "rebuilding", "degraded"]);
    expect(FRESHNESS_CAUSES).toEqual([
      "source_change",
      "config_change",
      "index_failure",
      "watcher_failure",
      "compiler_rebuild",
    ]);
    expect(TRUNCATION_REASONS).toEqual([
      "record_limit",
      "work_limit",
      "byte_limit",
      "depth_limit",
      "edge_limit",
      "invocation_limit",
      "serialization_limit",
    ]);
    expect(READ_TRUNCATION_REASONS).toEqual(
      TRUNCATION_REASONS.filter((reason) => reason !== "work_limit"),
    );
    expect(isSnapshotState("fresh")).toBe(true);
    expect(isSnapshotState("unknown")).toBe(false);
    expect(Object.isFrozen(SNAPSHOT_STATES)).toBe(true);
    expect(Object.isFrozen(FRESHNESS_CAUSES)).toBe(true);
    expect(Object.isFrozen(TRUNCATION_REASONS)).toBe(true);
    expect(() => (SNAPSHOT_STATES as unknown as string[]).push("unknown")).toThrow();
  });

  it("models bounded ranges and project-relative JSON-safe source locations", () => {
    expect(createFileRange(0, 20, 42)).toEqual({
      offset: 0,
      limit: 20,
      total_lines: 42,
    });
    expect(
      createSourceLocation("src/index.ts", {
        start_line: 2,
        start_column: 1,
        end_line: 4,
        end_column: 12,
      }),
    ).toEqual({
      file: "src/index.ts",
      start_line: 2,
      start_column: 1,
      end_line: 4,
      end_column: 12,
    });
    expect(() => createSourceLocation("/tmp/index.ts", { start_line: 1 })).toThrow(
      /project-relative/i,
    );
    expect(() =>
      createSourceLocation("C:\\Users\\yail\\project\\index.ts", { start_line: 1 }),
    ).toThrow(/project-relative/i);
    expect(() => createSourceLocation("C:relative.ts", { start_line: 1 })).toThrow(
      /project-relative/i,
    );
    expect(() => createSourceLocation("C:relative\\file.ts", { start_line: 1 })).toThrow(
      /project-relative/i,
    );
    expect(() => createSourceLocation("../outside.ts", { start_line: 1 })).toThrow(
      /project-relative/i,
    );
    expect(() => createSourceLocation("\\\\server\\share\\index.ts", { start_line: 1 })).toThrow(
      /project-relative/i,
    );
    expect(() =>
      createSourceLocation("C:\\Users\\yail\\My Project\\index.ts", { start_line: 1 }),
    ).toThrow(/project-relative/i);
    expect(() =>
      createSourceLocation('"/home/yail/My Project/index.ts"', { start_line: 1 }),
    ).toThrow(/project-relative/i);
    expect(() => createSourceLocation(null as unknown as string, { start_line: 1 })).toThrow(
      /invalid/i,
    );
    expect(() => createSourceLocation("src/index.ts", null as unknown as SourceRange)).toThrow(
      /invalid/i,
    );
  });

  it("requires a machine-readable reason whenever a budget truncates a result", () => {
    expect(createTruncationMetadata(false)).toEqual({ truncated: false, reason: null });
    expect(createTruncationMetadata(true, "record_limit")).toEqual({
      truncated: true,
      reason: "record_limit",
    });
    expect(() => createTruncationMetadata(true)).toThrow(/reason/i);
    expect(() => createTruncationMetadata(false, "byte_limit")).toThrow(/reason/i);
  });

  it("keeps read-result contracts JSON-safe and independent from ts-morph objects", () => {
    const freshness: FreshnessMetadata = {
      state: "stale",
      causes: ["source_change", "watcher_failure"],
      checked_at: "2026-08-04T12:00:00.000Z",
    };
    const budget: BudgetMetadata = {
      max_records: 20,
      max_bytes: 4096,
      max_depth: null,
      max_edges: null,
      max_invocations: null,
    };
    const result: ReadResult<{ file: string; lines: string[] }> = {
      data: { file: "src/index.ts", lines: ["export const value = 1;\n"] },
      metadata: {
        freshness,
        budget,
        truncation: createTruncationMetadata(false),
      },
    };

    expect(isJsonValue(result)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(isJsonValue({ value: undefined })).toBe(false);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(-0)).toBe(false);
    class CustomArray extends Array<number> {}
    expect(isJsonValue(new CustomArray(1))).toBe(false);
    const arrayWithUnsafeProperty: string[] & { unsafe?: unknown } = ["safe"];
    arrayWithUnsafeProperty.unsafe = undefined;
    expect(isJsonValue(arrayWithUnsafeProperty)).toBe(false);
    expect(isJsonValue(new Array(1))).toBe(false);
    const arrayWithEnumerableProperty: string[] & { extra?: unknown } = ["safe"];
    arrayWithEnumerableProperty.extra = null;
    expect(isJsonValue(arrayWithEnumerableProperty)).toBe(false);
    const arrayWithEnumerableSymbol = ["safe"] as string[];
    Object.defineProperty(arrayWithEnumerableSymbol, Symbol("extra"), {
      enumerable: true,
      value: null,
    });
    expect(isJsonValue(arrayWithEnumerableSymbol)).toBe(false);
    const objectWithEnumerableSymbol = { value: 1 } as Record<string | symbol, unknown>;
    objectWithEnumerableSymbol[Symbol("extra")] = null;
    expect(isJsonValue(objectWithEnumerableSymbol)).toBe(false);
    const arrayWithHiddenFunction = [] as unknown[];
    Object.defineProperty(arrayWithHiddenFunction, "0", {
      enumerable: false,
      value: () => "unsafe",
    });
    expect(isJsonValue(arrayWithHiddenFunction)).toBe(false);
    const objectWithHiddenToJson = { value: 1 } as { value: number; toJSON?: () => string };
    Object.defineProperty(objectWithHiddenToJson, "toJSON", {
      enumerable: false,
      value: () => "changed",
    });
    expect(isJsonValue(objectWithHiddenToJson)).toBe(false);
    const arrayWithHiddenToJson = [1] as unknown[] & { toJSON?: () => string };
    Object.defineProperty(arrayWithHiddenToJson, "toJSON", {
      enumerable: false,
      value: () => "changed",
    });
    expect(isJsonValue(arrayWithHiddenToJson)).toBe(false);
  });
});
