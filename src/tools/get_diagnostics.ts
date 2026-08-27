import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildDiagnosticAggregates,
  DIAGNOSTIC_AGGREGATE_GROUP_LIMIT,
  normalizeDiagnostic,
} from "../services/diagnostics.js";
import { PaginationInputSchema, PaginationOutputSchema, paginate } from "../services/pagination.js";
import { getSourceFileOrThrow, withProject } from "../services/project.js";
import { createRequestContext } from "../services/request-context.js";
import {
  createToolErrorContext,
  errorResult,
  formattedResult,
  ToolOutputFormatInputSchema,
} from "./result.js";

const TOOL_NAME = "ast_get_diagnostics";

const DiagnosticSchema = z.object({
  code: z.number().int(),
  category: z.string(),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable(),
  message: z.string(),
});

const AggregateMetadataSchema = {
  total_group_count: z.number().int().safe().min(0),
  omitted_group_count: z.number().int().safe().min(0),
  covered_diagnostic_count: z.number().int().safe().min(0),
  omitted_diagnostic_count: z.number().int().safe().min(0),
  truncated: z.boolean(),
};

const DiagnosticAggregatesSchema = z.object({
  group_limit: z.literal(DIAGNOSTIC_AGGREGATE_GROUP_LIMIT),
  codes: z.object({
    groups: z
      .array(z.object({ code: z.number().int().safe(), count: z.number().int().safe().positive() }))
      .max(DIAGNOSTIC_AGGREGATE_GROUP_LIMIT),
    ...AggregateMetadataSchema,
  }),
  files: z.object({
    groups: z
      .array(z.object({ file: z.string(), count: z.number().int().safe().positive() }))
      .max(DIAGNOSTIC_AGGREGATE_GROUP_LIMIT),
    ...AggregateMetadataSchema,
    unfiled_diagnostic_count: z.number().int().safe().min(0),
  }),
});

const AstGetDiagnosticsInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
  file_path: z
    .string()
    .optional()
    .describe("Optional project-relative or absolute file path. Omit for project diagnostics."),
  include_aggregates: z.boolean().optional().default(false),
  ...ToolOutputFormatInputSchema,
  ...PaginationInputSchema,
});

const AstGetDiagnosticsOutputSchema = z.object({
  diagnostics: z.array(DiagnosticSchema),
  error_count: z.number().int().min(0),
  warning_count: z.number().int().min(0),
  duration_ms: z.number().min(0),
  aggregates: DiagnosticAggregatesSchema.optional(),
  ...PaginationOutputSchema,
});

export function registerGetDiagnostics(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get TypeScript diagnostics",
      description:
        "Returns bounded normalized TypeScript diagnostics for a project or one source file. Existing errors are preserved as evidence for write-operation delta checks.",
      inputSchema: AstGetDiagnosticsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (
      { project_root, file_path, include_aggregates, output_format, offset, limit },
      extra,
    ) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        const structuredContent = await withProject(
          project_root,
          ({ project, projectRoot }, operationContext) => {
            const startedAt = performance.now();
            const diagnostics = file_path
              ? getSourceFileOrThrow(project, file_path).getPreEmitDiagnostics()
              : [...project.getConfigFileParsingDiagnostics(), ...project.getPreEmitDiagnostics()];
            const normalized = diagnostics
              .map((diagnostic) => normalizeDiagnostic(diagnostic, projectRoot, operationContext))
              .sort((left, right) =>
                `${left.file ?? ""}:${left.line ?? 0}:${left.column ?? 0}:${left.code}`.localeCompare(
                  `${right.file ?? ""}:${right.line ?? 0}:${right.column ?? 0}:${right.code}`,
                ),
              );
            const aggregates = include_aggregates
              ? buildDiagnosticAggregates(normalized, operationContext)
              : undefined;
            const page = paginate(normalized, offset, limit);
            const { items, ...metadata } = page;
            return {
              diagnostics: items,
              error_count: normalized.filter((diagnostic) => diagnostic.category === "Error")
                .length,
              warning_count: normalized.filter((diagnostic) => diagnostic.category === "Warning")
                .length,
              duration_ms: performance.now() - startedAt,
              ...(aggregates ? { aggregates } : {}),
              ...metadata,
            };
          },
          requestContext,
        );
        return formattedResult(AstGetDiagnosticsOutputSchema, structuredContent, output_format);
      } catch (error) {
        return errorResult(error, createToolErrorContext(TOOL_NAME, project_root));
      }
    },
  );
}

// prettier-ignore
export const toolDescriptor = Object.freeze({ name: TOOL_NAME, register: registerGetDiagnostics, compatibility: "required", effect: "read", batch: "read", directOutputFormats: Object.freeze(["json", "toon"] as const) }) satisfies import("./catalog.js").ToolDescriptor<typeof TOOL_NAME>;
