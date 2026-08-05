import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_FILE_LINE_LIMIT,
  MAX_FILE_LINE_LIMIT,
  readFileSnapshot,
} from "../services/file-snapshot.js";
import { buildFileOutline } from "../services/outline.js";
import { getSourceFileOrThrow, withProject } from "../services/project.js";
import { errorResult, structuredResult } from "./result.js";

const AstGetFileInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
  file_path: z
    .string()
    .describe("Project-relative or unambiguous source file path included by the active tsconfig."),
  offset: z.number().int().min(0).default(0).describe("Zero-based line offset for source mode."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_FILE_LINE_LIMIT)
    .default(DEFAULT_FILE_LINE_LIMIT)
    .describe(`Maximum source lines to return, capped at ${MAX_FILE_LINE_LIMIT}.`),
  symbols_only: z
    .boolean()
    .default(false)
    .describe("Return body-free symbol selectors and signatures instead of source lines."),
});

const FileRangeSchema = z.object({
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(MAX_FILE_LINE_LIMIT),
  total_lines: z.number().int().min(0),
});

const FileLineSchema = z.object({
  line: z.number().int().positive(),
  text: z.string(),
});

const OutlineSymbolSchema = z.object({
  symbolPath: z.string(),
  name: z.string(),
  kind: z.string(),
  signature: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

const FileSnapshotBaseSchema = {
  file: z.string(),
  file_hash: z.string().regex(/^[0-9a-f]{64}$/),
  snapshot_state: z.enum(["fresh", "stale"]),
};

const AstGetFileOutputSchema = z.object({
  mode: z.enum(["source", "symbols_only"]),
  ...FileSnapshotBaseSchema,
  range: FileRangeSchema.optional(),
  lines: z.array(FileLineSchema).optional(),
  symbols: z.array(OutlineSymbolSchema).optional(),
});

export function registerGetFile(server: McpServer): void {
  server.registerTool(
    "ast_get_file",
    {
      title: "Get bounded source file",
      description:
        "Returns exact bounded source lines for one TypeScript/JavaScript file, or body-free symbols when symbols_only is true. Read-only; freshness is reported separately from compiler diagnostics.",
      inputSchema: AstGetFileInputSchema,
      outputSchema: AstGetFileOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_root, file_path, offset, limit, symbols_only }) => {
      try {
        const structuredContent = await withProject(
          project_root,
          async ({ project, projectRoot }) => {
            const snapshot = await readFileSnapshot(project, projectRoot, file_path, {
              offset,
              limit,
            });
            if (!symbols_only) {
              return {
                mode: "source" as const,
                ...snapshot,
              };
            }

            const sourceFile = getSourceFileOrThrow(project, file_path);
            return {
              mode: "symbols_only" as const,
              file: snapshot.file,
              file_hash: snapshot.file_hash,
              snapshot_state: snapshot.snapshot_state,
              symbols: buildFileOutline(sourceFile).symbols,
            };
          },
        );
        return structuredResult(structuredContent);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
