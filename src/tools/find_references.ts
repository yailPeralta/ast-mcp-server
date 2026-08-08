import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PaginationInputSchema, PaginationOutputSchema } from "../services/pagination.js";
import { findDeclarationByName, getSourceFileOrThrow, withProject } from "../services/project.js";
import { collectSymbolReferences } from "../services/references.js";
import { createRequestContext } from "../services/request-context.js";
import { errorResult, formattedResult, ToolOutputFormatInputSchema } from "./result.js";

const ReferenceDetailSchema = z.enum(["locations", "context"]).default("locations");

const AstFindReferencesInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
  file_path: z.string().describe("File containing the declaration."),
  symbol_path: z.string().describe("Exact symbol path returned by an outline or symbol search."),
  include_declaration: z.boolean().default(true),
  detail: ReferenceDetailSchema.describe(
    "Result detail: locations omits source lines; context adds bounded source-line text.",
  ),
  ...ToolOutputFormatInputSchema,
  ...PaginationInputSchema,
});

const ContextReferenceSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  kind: z.string(),
  is_declaration: z.boolean(),
  context: z.string(),
});

const LocationReferenceSchema = ContextReferenceSchema.omit({ context: true });
const ReferenceOutputBase = {
  symbol: z.string(),
  include_declaration: z.boolean(),
  declaration_count: z.number().int().min(0),
  reference_count: z.number().int().min(0),
  affected_files: z.array(z.string()),
  ...PaginationOutputSchema,
};
const ReferenceOutputSchemas = {
  locations: z.object({
    ...ReferenceOutputBase,
    references: z.array(LocationReferenceSchema),
  }),
  context: z.object({
    ...ReferenceOutputBase,
    references: z.array(ContextReferenceSchema),
  }),
} as const;

export function registerFindReferences(server: McpServer): void {
  server.registerTool(
    "ast_find_references",
    {
      title: "Find semantic symbol references",
      description:
        "Finds type-resolved references and returns bounded project-relative locations, including declaration impact by default.",
      inputSchema: AstFindReferencesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (
      {
        project_root,
        file_path,
        symbol_path,
        include_declaration,
        detail,
        output_format,
        offset,
        limit,
      },
      extra,
    ) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        const structuredContent = await withProject(
          project_root,
          ({ project, projectRoot }, operationContext) => {
            const sourceFile = getSourceFileOrThrow(project, file_path);
            const node = findDeclarationByName(sourceFile, symbol_path);
            const collected = collectSymbolReferences(
              node,
              projectRoot,
              symbol_path,
              include_declaration,
              detail,
              offset,
              limit,
              operationContext,
            );
            const { references, ...metadata } = collected;
            return {
              ...metadata,
              references:
                detail === "context"
                  ? references
                  : references.map(({ file, line, column, kind, is_declaration }) => {
                      operationContext.checkpoint();
                      return { file, line, column, kind, is_declaration };
                    }),
            };
          },
          requestContext,
        );
        const outputSchema = ReferenceOutputSchemas[detail] as z.ZodType<Record<string, unknown>>;
        return formattedResult(outputSchema, structuredContent, output_format);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
