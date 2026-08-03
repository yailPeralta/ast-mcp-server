import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { nodeSourceWithLocation } from "../services/outline.js";
import { findDeclarationByName, getSourceFileOrThrow, withProject } from "../services/project.js";
import { errorResult, structuredResult } from "./result.js";

const AstGetSymbolSourceInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
  file_path: z.string().describe("Project-relative or absolute source file path."),
  symbol_path: z.string().describe('Symbol path such as "formatDate" or "UserService.create".'),
});

const AstGetSymbolSourceOutputSchema = z.object({
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  text: z.string(),
});

export function registerGetSymbolSource(server: McpServer): void {
  server.registerTool(
    "ast_get_symbol_source",
    {
      title: "Get one symbol implementation",
      description:
        "Returns exactly one declaration or implementation with its project-relative location, not the complete file.",
      inputSchema: AstGetSymbolSourceInputSchema,
      outputSchema: AstGetSymbolSourceOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_root, file_path, symbol_path }) => {
      try {
        const structuredContent = await withProject(project_root, ({ project, projectRoot }) => {
          const sourceFile = getSourceFileOrThrow(project, file_path);
          const node = findDeclarationByName(sourceFile, symbol_path);
          return nodeSourceWithLocation(node, projectRoot);
        });
        return structuredResult(structuredContent);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
