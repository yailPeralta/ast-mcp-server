import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { decode, encode } from "@toon-format/toon";
import { z } from "zod";

export const MAX_TOOL_ERROR_BYTES = 64 * 1024;
export const MAX_TOON_RESULT_BYTES = 10 * 1024 * 1024;

export const ToolOutputFormatSchema = z.enum(["json", "toon"]).default("json");
export type ToolOutputFormat = z.infer<typeof ToolOutputFormatSchema>;

export const ToolOutputFormatInputSchema = {
  output_format: ToolOutputFormatSchema.describe(
    "Result representation. TOON wraps one compact encoded value in structuredContent.",
  ),
};

export const ToonResultSchema = z.object({
  format: z.literal("toon"),
  data: z.string(),
});
export type ToonResult = z.infer<typeof ToonResultSchema>;

type StructuredToolResult<T extends Record<string, unknown>> = {
  content: [];
  structuredContent: T;
};

export function structuredResult<T extends Record<string, unknown>>(
  structuredContent: T,
): StructuredToolResult<T> {
  return { content: [], structuredContent };
}

export function formattedResult<T extends Record<string, unknown>>(
  outputSchema: z.ZodType<T>,
  candidate: unknown,
  outputFormat: ToolOutputFormat,
  maxToonBytes = MAX_TOON_RESULT_BYTES,
): StructuredToolResult<T | ToonResult> {
  const validated = outputSchema.parse(candidate);
  if (outputFormat === "json") {
    return structuredResult(validated);
  }

  const text = encode(validated);
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > maxToonBytes) {
    throw new Error(
      `TOON result exceeds the ${maxToonBytes}-byte limit (${byteLength} bytes encoded).`,
    );
  }
  if (!isDeepStrictEqual(decode(text), validated)) {
    throw new Error("TOON result cannot represent the validated value losslessly.");
  }
  return structuredResult({ format: "toon", data: text });
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "... [truncated]";
  const source = Buffer.from(value, "utf8");
  let end = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  while (end > 0 && (source[end]! & 0xc0) === 0x80) end -= 1;
  let prefix = source.subarray(0, end).toString("utf8");
  while (Buffer.byteLength(prefix + suffix, "utf8") > maxBytes) {
    prefix = prefix.slice(0, -1);
  }
  return prefix + suffix;
}

export function errorResult(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: truncateUtf8(message, MAX_TOOL_ERROR_BYTES),
      },
    ],
    isError: true,
  };
}
