import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { decode, encode } from "@toon-format/toon";
import { z } from "zod";
import { createProjectIdentity, type ProjectIdentity } from "../services/project-status.js";
import { renderPublicError } from "../services/public-errors.js";
import { emitToolFailureEvent } from "../services/runtime-logger.js";

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

export interface ToolErrorContext {
  readonly toolName: string;
  readonly projectIdentity?: ProjectIdentity;
}

export function createToolErrorContext(toolName: string, projectRoot?: unknown): ToolErrorContext {
  if (typeof projectRoot !== "string") return { toolName };
  try {
    return { toolName, projectIdentity: createProjectIdentity({ projectRoot }) };
  } catch {
    return { toolName };
  }
}

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

export function errorResult(
  error: unknown,
  context: ToolErrorContext,
): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const { envelope, text } = renderPublicError(error);
  try {
    emitToolFailureEvent({
      correlationId: envelope.error.correlation_id,
      toolName: context.toolName,
      code: envelope.error.code,
      message: envelope.error.message,
      projectIdentity: context.projectIdentity,
    });
  } catch {
    // A logging sink failure must not replace the bounded MCP error.
  }
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError: true,
  };
}
