import path from "node:path";
import { z } from "zod";

/** Caps shared by both ends of the one-shot IPC channel (v1). */
export const MAX_WIRE_DIAGNOSTICS = 5000;
export const MAX_OVERLAY_BYTES = 32 * 1024 * 1024;
export const MAX_TEMPLATES = 2000;
export const MAX_OVERLAY_FILES = 10_000;
const MAX_PATH_CHARS = 4096;
export const MAX_MESSAGE_CHARS = 8192;

const absolutePath = z
  .string()
  .max(MAX_PATH_CHARS)
  .refine((value) => path.isAbsolute(value), "must be an absolute path");

export const RequestSchema = z
  .object({
    v: z.literal(1),
    tsconfig: absolutePath,
    cliEntry: absolutePath,
    templates: z.array(absolutePath).max(MAX_TEMPLATES),
    overlay: z
      .array(z.object({ absolutePath, text: z.string() }).strict())
      .max(MAX_OVERLAY_FILES)
      .refine(
        (files) =>
          files.reduce((total, file) => total + Buffer.byteLength(file.text, "utf8"), 0) <=
          MAX_OVERLAY_BYTES,
        "overlay exceeds the byte cap",
      ),
    maxDiagnostics: z.number().int().min(1).max(MAX_WIRE_DIAGNOSTICS),
  })
  .strict();
export type Request = z.infer<typeof RequestSchema>;

const position = z.number().int().nonnegative().nullable();
export const WireDiagnosticSchema = z
  .object({
    code: z.number().int(),
    category: z.string().max(32),
    /** Project-relative path. */
    file: z.string().max(MAX_PATH_CHARS),
    line: position,
    column: position,
    message: z.string().max(MAX_MESSAGE_CHARS),
    start: position,
    length: position,
  })
  .strict();
export type WireDiagnostic = z.infer<typeof WireDiagnosticSchema>;

/** Only a successful reply carries diagnostics, so a non-completed status can never include any. */
export const ResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      v: z.literal(1),
      ok: z.literal(true),
      before: z.array(WireDiagnosticSchema).max(MAX_WIRE_DIAGNOSTICS),
      after: z.array(WireDiagnosticSchema).max(MAX_WIRE_DIAGNOSTICS),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      ok: z.literal(false),
      reason: z.enum([
        "compiler_unsupported",
        "typescript_incompatible",
        "work_exhausted",
        "check_failed",
      ]),
    })
    .strict(),
]);
export type Response = z.infer<typeof ResponseSchema>;

export type ParsedResponse =
  | { readonly status: "valid"; readonly response: Response }
  | { readonly status: "oversized" }
  | { readonly status: "malformed" };

/** Separates an over-cap reply (work bound) from a malformed one (check failure). */
export function parseResponse(value: unknown): ParsedResponse {
  if (typeof value === "object" && value !== null) {
    const { before, after } = value as { before?: unknown; after?: unknown };
    const oversizedSide = (side: unknown): boolean =>
      Array.isArray(side) && side.length > MAX_WIRE_DIAGNOSTICS;
    if (oversizedSide(before) || oversizedSide(after)) return { status: "oversized" };
  }
  const parsed = ResponseSchema.safeParse(value);
  return parsed.success ? { status: "valid", response: parsed.data } : { status: "malformed" };
}
