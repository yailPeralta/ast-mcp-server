import { Buffer } from "node:buffer";
import { encode } from "@toon-format/toon";
import { MAX_BATCH_OUTPUT_BYTES } from "./batch/schema.js";

export type CliOutputFormat = "json" | "toon";
export type CliOutputErrorCode = "ENCODING_ERROR" | "OUTPUT_LIMIT";

export class CliOutputError extends Error {
  constructor(
    message: string,
    readonly code: CliOutputErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CliOutputError";
  }
}

export function serializeCliSuccess(
  value: unknown,
  outputFormat: CliOutputFormat,
  maxBytes = MAX_BATCH_OUTPUT_BYTES,
): string {
  let serialized: string | undefined;
  try {
    serialized = outputFormat === "toon" ? encode(value) : JSON.stringify(value);
  } catch (error) {
    throw new CliOutputError(
      `Failed to encode ${outputFormat.toUpperCase()} output.`,
      "ENCODING_ERROR",
      { cause: error },
    );
  }
  if (serialized === undefined) {
    throw new CliOutputError(
      `${outputFormat.toUpperCase()} output did not produce a document.`,
      "ENCODING_ERROR",
    );
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maxBytes) {
    throw new CliOutputError(
      `${outputFormat === "toon" ? "TOON" : "JSON"} output exceeds the ${maxBytes}-byte limit (${bytes} bytes encoded).`,
      "OUTPUT_LIMIT",
    );
  }
  return serialized;
}
