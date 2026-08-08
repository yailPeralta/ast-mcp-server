import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PaginationInputSchema, PaginationOutputSchema, paginate } from "../services/pagination.js";
import { withProject } from "../services/project.js";
import { createRequestContext } from "../services/request-context.js";
import { errorResult, structuredResult } from "./result.js";

const AstListFilesInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
  glob_filter: z
    .string()
    .optional()
    .describe("Optional case-insensitive substring used to filter project-relative paths."),
  ...PaginationInputSchema,
});

const AstListFilesOutputSchema = z.object({
  files: z.array(z.string()),
  ...PaginationOutputSchema,
});

export function registerListFiles(server: McpServer): void {
  server.registerTool(
    "ast_list_files",
    {
      title: "List TypeScript/JavaScript project files",
      description:
        "Lists source files included by the project's tsconfig in deterministic, project-relative, paginated form.",
      inputSchema: AstListFilesInputSchema,
      outputSchema: AstListFilesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_root, glob_filter, offset, limit }, extra) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        const output = await withProject(
          project_root,
          ({ project, projectRoot }, operationContext) => {
            const filter = glob_filter?.toLowerCase();
            const files = project
              .getSourceFiles()
              .map((sourceFile) => {
                operationContext.checkpoint();
                return path.relative(projectRoot, sourceFile.getFilePath());
              })
              .filter((file) => !filter || file.toLowerCase().includes(filter))
              .sort((left, right) => left.localeCompare(right));
            const page = paginate(files, offset, limit);
            const { items, ...metadata } = page;
            return { files: items, ...metadata };
          },
          requestContext,
        );

        return structuredResult(output);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
