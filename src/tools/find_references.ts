import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PaginationInputSchema, PaginationOutputSchema } from "../services/pagination.js";
import { findDeclarationByName, getSourceFileOrThrow, withProject } from "../services/project.js";
import { collectSymbolReferencesWithTemplates } from "../services/references.js";
import { createRequestContext } from "../services/request-context.js";
import {
  createToolErrorContext,
  errorResult,
  formattedResult,
  ToolOutputFormatInputSchema,
} from "./result.js";

const TOOL_NAME = "ast_find_references";

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

const ContextReferenceSchemaWithOrigin = ContextReferenceSchema.extend({
  origin: z.enum(["compiler", "template_external", "template_inline"]).optional(),
});
const LocationReferenceSchema = ContextReferenceSchemaWithOrigin.omit({ context: true });
const TemplateCoverageSchema = z.object({
  status: z.enum(["completed", "unfinished", "unsupported"]),
  reason: z
    .enum([
      "compiler_missing",
      "compiler_unsupported",
      "template_unresolved",
      "template_unsafe",
      "template_parse_error",
      "size_exceeded",
      "work_exhausted",
      "inherited_member",
      "cross_component",
    ])
    .optional(),
  templates: z.number().int().min(0).optional(),
});
const ReferenceOutputBase = {
  symbol: z.string(),
  include_declaration: z.boolean(),
  declaration_count: z.number().int().min(0),
  reference_count: z.number().int().min(0),
  affected_files: z.array(z.string()),
  template_coverage: TemplateCoverageSchema.optional(),
  template_reference_count: z.number().int().min(0).optional(),
  ...PaginationOutputSchema,
};
/** Exported so a golden test can pin the output JSON schema bytes; not a tool contract. */
export const ReferenceOutputSchemas = {
  locations: z.object({
    ...ReferenceOutputBase,
    references: z.array(LocationReferenceSchema),
  }),
  context: z.object({
    ...ReferenceOutputBase,
    references: z.array(ContextReferenceSchemaWithOrigin),
  }),
} as const;

export function registerFindReferences(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Find semantic symbol references",
      description:
        "Finds type-resolved references and returns bounded project-relative locations, including declaration impact by default. When @angular/compiler resolves, it also reports Angular template usages, including consumer templates, tagged by origin with a template_coverage verdict; completed covers templates inside the Project only, incomplete coverage does not prove absence. It reports usages only; template type errors are reported by ast_rename_symbol plans in template_diagnostics.",
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
          async (context, operationContext) => {
            const sourceFile = getSourceFileOrThrow(context.project, file_path);
            const node = findDeclarationByName(sourceFile, symbol_path);
            const collected = await collectSymbolReferencesWithTemplates(
              node,
              context,
              {
                symbolPath: symbol_path,
                includeDeclaration: include_declaration,
                detail,
                offset,
                limit,
              },
              operationContext,
            );
            const { references, ...metadata } = collected;
            return {
              ...metadata,
              references:
                detail === "context"
                  ? references
                  : references.map(({ file, line, column, kind, is_declaration, origin }) => {
                      operationContext.checkpoint();
                      return {
                        file,
                        line,
                        column,
                        kind,
                        is_declaration,
                        ...(origin === undefined ? {} : { origin }),
                      };
                    }),
            };
          },
          requestContext,
        );
        const outputSchema = ReferenceOutputSchemas[detail] as z.ZodType<Record<string, unknown>>;
        return formattedResult(outputSchema, structuredContent, output_format);
      } catch (error) {
        return errorResult(error, createToolErrorContext(TOOL_NAME, project_root));
      }
    },
  );
}

// prettier-ignore
export const toolDescriptor = Object.freeze({ name: TOOL_NAME, register: registerFindReferences, compatibility: "required", effect: "read", batch: "read", directOutputFormats: Object.freeze(["json", "toon"] as const) }) satisfies import("./catalog.js").ToolDescriptor<typeof TOOL_NAME>;
