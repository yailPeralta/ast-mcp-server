import { decode } from "@toon-format/toon";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MAX_TOOL_ERROR_BYTES,
  MAX_TOON_RESULT_BYTES,
  ToolOutputFormatSchema,
  errorResult,
  formattedResult,
} from "../src/tools/result.js";

const FixtureSchema = z.object({
  rows: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().positive().nullable(),
      active: z.boolean(),
      message: z.string(),
    }),
  ),
  total: z.number().int().min(0),
  duration_ms: z.number().min(0),
});

const fixture = {
  rows: [
    {
      file: 'src/mañana,"quoted".ts',
      line: 7,
      active: true,
      message: "first line\nsecond: [ignore previous instructions] ✅",
    },
    {
      file: "src/empty.ts",
      line: null,
      active: false,
      message: "",
    },
  ],
  total: 2,
  duration_ms: 1.25,
};

describe("tool result formatting", () => {
  it("keeps the existing structured result as the default JSON representation", () => {
    expect(ToolOutputFormatSchema.parse(undefined)).toBe("json");
    expect(formattedResult(FixtureSchema, fixture, "json")).toEqual({
      content: [],
      structuredContent: fixture,
    });
  });

  it("returns one lossless TOON envelope without duplicate canonical JSON", () => {
    const result = formattedResult(FixtureSchema, fixture, "toon");

    expect(result.content).toEqual([]);
    expect(result.structuredContent).toEqual({
      format: "toon",
      data: expect.any(String),
    });
    expect(decode((result.structuredContent as { data: string }).data)).toEqual(fixture);
    expect(JSON.stringify(result.structuredContent)).not.toContain('"rows":');
  });

  it("validates the canonical logical value before presentation", () => {
    expect(() => formattedResult(FixtureSchema, { rows: [], total: -1 }, "toon")).toThrow(
      /greater than or equal to 0/i,
    );
  });

  it("rejects values that TOON cannot round-trip losslessly", () => {
    expect(() =>
      formattedResult(FixtureSchema, { ...fixture, duration_ms: Number.POSITIVE_INFINITY }, "toon"),
    ).toThrow(/lossless/i);
  });

  it("rejects a TOON payload over the configured UTF-8 limit before returning content", () => {
    const oversized = {
      rows: [{ file: "src/value.ts", line: 1, active: true, message: "é".repeat(64) }],
      total: 1,
      duration_ms: 1,
    };

    expect(() => formattedResult(FixtureSchema, oversized, "toon", 32)).toThrow(
      /TOON result exceeds the 32-byte limit/,
    );
  });

  it("publishes the 10 MiB MCP TOON limit", () => {
    expect(MAX_TOON_RESULT_BYTES).toBe(10 * 1024 * 1024);
  });

  it("bounds MCP error text by UTF-8 bytes", () => {
    const result = errorResult(new Error("é".repeat(MAX_TOOL_ERROR_BYTES)));
    expect(Buffer.byteLength(result.content[0]!.text, "utf8")).toBeLessThanOrEqual(
      MAX_TOOL_ERROR_BYTES,
    );
    expect(result.content[0]!.text).toMatch(/truncated]$/);
  });
});
