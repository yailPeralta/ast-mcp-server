import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { decode, encode } from "@toon-format/toon";
import { z } from "zod";
import {
  COMPILER_WORKER_MAX_RESULT_BYTES,
  fitsCompilerWorkerResponseResult,
} from "../services/compiler-worker-protocol.js";
import { createProjectIdentity, type ProjectIdentity } from "../services/project-status.js";
import { renderPublicError } from "../services/public-errors.js";
import { emitToolFailureEvent } from "../services/runtime-logger.js";

export const MAX_TOON_RESULT_BYTES = 10 * 1024 * 1024;
// Leave room for the unchanged structured value plus JSON-RPC framing under
// the supervised worker's 256 KiB line limit.
export const MAX_TEXT_PROJECTION_BYTES = 112 * 1024;
export const MAX_PROJECTED_RESULT_BYTES = COMPILER_WORKER_MAX_RESULT_BYTES;

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

type ProjectableToolResult = {
  readonly content: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
};

/**
 * Add a deterministic model-visible JSON projection without replacing the
 * canonical structured value. Existing content wins, and oversized values get
 * an explicit bounded marker when the complete framed result has room for it;
 * otherwise the unchanged structured-only result remains authoritative.
 */
export function projectStructuredContentAsText<T extends ProjectableToolResult>(
  result: T,
  enabled: boolean,
  maxBytes = MAX_TEXT_PROJECTION_BYTES,
): T {
  if (
    !enabled ||
    result.isError === true ||
    result.content.length > 0 ||
    result.structuredContent === undefined
  ) {
    return result;
  }

  let text: string;
  try {
    text =
      JSON.stringify(result.structuredContent) ??
      "(structured result is not JSON-serializable for model-visible projection)";
  } catch {
    text = "(structured result is not JSON-serializable for model-visible projection)";
  }
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > maxBytes) {
    text = `(structured result exceeds the ${maxBytes}-byte model-visible projection limit; canonical structuredContent remains available)`;
  }
  let projected = {
    ...result,
    content: [{ type: "text", text }],
  } as T;
  if (fitsCompilerWorkerResponseResult(projected)) return projected;
  projected = {
    ...result,
    content: [
      {
        type: "text",
        text: `(structured result exceeds the ${MAX_PROJECTED_RESULT_BYTES}-byte complete projection limit; canonical structuredContent remains available)`,
      },
    ],
  } as T;
  return fitsCompilerWorkerResponseResult(projected) ? projected : result;
}

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
