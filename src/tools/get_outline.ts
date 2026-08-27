import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildFileOutline } from "../services/outline.js";
import { getSourceFileOrThrow, withProject } from "../services/project.js";
import { createRequestContext } from "../services/request-context.js";
import { createToolErrorContext, errorResult, structuredResult } from "./result.js";

const TOOL_NAME = "ast_get_outline";

const AstGetOutlineInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
  file_path: z.string().describe("Project-relative or absolute source file path."),
  include_symbols: z
    .boolean()
    .default(false)
    .describe("Include detailed symbol metadata. Omit for the smallest body-free response."),
});

const OutlineSymbolSchema = z.object({
  symbolPath: z.string(),
  name: z.string(),
  kind: z.string(),
  signature: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

const AstGetOutlineOutputSchema = z.object({
  file: z.string(),
  outline: z.string(),
  symbols: z.array(OutlineSymbolSchema).optional(),
});

export function registerGetOutline(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get compact file outline",
      description:
        "Returns body-free declaration signatures for one TypeScript/JavaScript file. Detailed symbol metadata is opt-in because it duplicates signature text.",
      inputSchema: AstGetOutlineInputSchema,
      outputSchema: AstGetOutlineOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_root, file_path, include_symbols }, extra) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        const structuredContent = await withProject(
          project_root,
          ({ project, projectRoot }, operationContext) => {
            const sourceFile = getSourceFileOrThrow(project, file_path);
            const outline = buildFileOutline(sourceFile, operationContext);
            return {
              file: path.relative(projectRoot, sourceFile.getFilePath()),
              outline: outline.text,
              ...(include_symbols ? { symbols: outline.symbols } : {}),
            };
          },
          requestContext,
        );
        return structuredResult(structuredContent);
      } catch (error) {
        return errorResult(error, createToolErrorContext(TOOL_NAME, project_root));
      }
    },
  );
}

// prettier-ignore
export const toolDescriptor = Object.freeze({ name: TOOL_NAME, register: registerGetOutline, compatibility: "required", effect: "read", batch: "read", directOutputFormats: Object.freeze(["json"] as const) }) satisfies import("./catalog.js").ToolDescriptor<typeof TOOL_NAME>;
