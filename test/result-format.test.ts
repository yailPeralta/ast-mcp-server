import { decode } from "@toon-format/toon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  MAX_PUBLIC_ERROR_MESSAGE_BYTES,
  MAX_PUBLIC_ERROR_RESPONSE_BYTES,
  PublicOperationalError,
} from "../src/services/public-errors.js";
import { renderToolFailureEvent } from "../src/services/runtime-logger.js";
import {
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOOL_ERROR_CONTEXT = {
  toolName: "ast_get_file",
  projectIdentity: { project_id: `project_${"a".repeat(20)}`, config_id: null },
} as const;

describe("tool result formatting", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

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

  it("returns the frozen compact JSON MCP error envelope without structured success content", () => {
    const result = errorResult(
      new PublicOperationalError("INVALID_INPUT", "The request is invalid."),
      TOOL_ERROR_CONTEXT,
    );
    const parsed = JSON.parse(result.content[0]!.text) as {
      error: { code: string; message: string; correlation_id: string };
    };

    expect(result).toEqual({
      content: [{ type: "text", text: expect.any(String) }],
      isError: true,
    });
    expect(parsed).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "The request is invalid.",
        correlation_id: expect.stringMatching(UUID_PATTERN),
      },
    });
    expect(result.content[0]!.text).toBe(JSON.stringify(parsed));
  });

  it("uses a generic INTERNAL_ERROR without serializing raw unknown error text", () => {
    const result = errorResult(
      new Error("failed at /home/yail/private.ts with token=opaque-secret"),
      TOOL_ERROR_CONTEXT,
    );
    const text = result.content[0]!.text;

    expect(JSON.parse(text)).toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "An internal error occurred." },
    });
    expect(text).not.toContain("/home/yail");
    expect(text).not.toContain("opaque-secret");
  });

  it("bounds the complete MCP error and sanitized message by UTF-8 bytes", () => {
    const result = errorResult(
      new PublicOperationalError("INVALID_INPUT", "é".repeat(MAX_PUBLIC_ERROR_MESSAGE_BYTES)),
      TOOL_ERROR_CONTEXT,
    );
    const parsed = JSON.parse(result.content[0]!.text) as { error: { message: string } };

    expect(Buffer.byteLength(parsed.error.message, "utf8")).toBeLessThanOrEqual(
      MAX_PUBLIC_ERROR_MESSAGE_BYTES,
    );
    expect(Buffer.byteLength(result.content[0]!.text, "utf8")).toBeLessThanOrEqual(
      MAX_PUBLIC_ERROR_RESPONSE_BYTES,
    );
    expect(parsed.error.message).not.toContain("�");
    expect(parsed.error.message).toMatch(/truncated]$/);
  });

  it("enforces the complete response budget after JSON escaping", () => {
    const result = errorResult(
      new PublicOperationalError("INVALID_INPUT", ['"', "\\"].join("").repeat(2048)),
      TOOL_ERROR_CONTEXT,
    );
    const parsed = JSON.parse(result.content[0]!.text) as { error: { message: string } };

    expect(Buffer.byteLength(parsed.error.message, "utf8")).toBeLessThanOrEqual(
      MAX_PUBLIC_ERROR_MESSAGE_BYTES,
    );
    expect(Buffer.byteLength(result.content[0]!.text, "utf8")).toBeLessThanOrEqual(
      MAX_PUBLIC_ERROR_RESPONSE_BYTES,
    );
    expect(parsed.error.message).toMatch(/truncated]$/);
  });

  it("emits exactly one bounded stderr event with the same correlation ID", () => {
    const result = errorResult(
      new PublicOperationalError(
        "INVALID_INPUT",
        "failed at /home/yail/private.ts with token=opaque-secret",
      ),
      TOOL_ERROR_CONTEXT,
    );
    const response = JSON.parse(result.content[0]!.text) as {
      error: { correlation_id: string; message: string };
    };

    expect(stderr).toHaveBeenCalledTimes(1);
    const line = String(stderr.mock.calls[0]![0]);
    expect(line.endsWith("\n")).toBe(true);
    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(8192);
    expect(JSON.parse(line.trim())).toEqual({
      event: "tool_failure",
      version: 1,
      correlation_id: response.error.correlation_id,
      tool: "ast_get_file",
      code: "INVALID_INPUT",
      message: response.error.message,
      project_id: `project_${"a".repeat(20)}`,
    });
    expect(line).not.toContain("/home/yail");
    expect(line).not.toContain("opaque-secret");
  });

  it("preserves the bounded MCP response when the stderr sink fails", () => {
    stderr.mockImplementationOnce(() => {
      throw new Error("stderr unavailable");
    });

    const result = errorResult(new Error("private internal failure"), TOOL_ERROR_CONTEXT);

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred.",
        correlation_id: expect.stringMatching(UUID_PATTERN),
      },
    });
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it("fails closed for invalid logger identities", () => {
    const line = renderToolFailureEvent({
      correlationId: "/home/yail/private-correlation",
      toolName: "ast_get_file\n/home/yail/private-tool",
      code: "INTERNAL_ERROR",
      message: "An internal error occurred.",
      projectIdentity: {
        project_id: "/home/yail/private-project",
        config_id: "config_opaque-secret",
      },
    });

    expect(JSON.parse(line)).toEqual({
      event: "tool_failure",
      version: 1,
      correlation_id: "invalid-correlation-id",
      tool: "unknown_tool",
      code: "INTERNAL_ERROR",
      message: "An internal error occurred.",
    });
    expect(line).not.toContain("/home/yail");
    expect(line).not.toContain("opaque-secret");
  });
});
