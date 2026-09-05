import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_IMPACT_MAX_DEPTH,
  DEFAULT_IMPACT_MAX_EDGES,
  DEFAULT_IMPACT_MAX_NODES,
  IMPACT_DIRECTIONS,
  MAX_IMPACT_DEPTH,
  MAX_IMPACT_EDGES,
  MAX_IMPACT_NODES,
  resolveImpactRoot,
  traverseCompilerImpact,
} from "../services/impact.js";
import { TRUNCATION_REASONS } from "../services/read-contracts.js";
import { withProject } from "../services/project.js";
import { createRequestContext } from "../services/request-context.js";
import { RELATIONSHIP_EDGE_KINDS } from "../services/relationships.js";
import {
  CompilerImpactWorkSchema,
  FreshnessSchema,
  RelationshipCoverageSchema,
  RelationshipEdgeSchema,
  RelationshipEndpointSchema,
} from "./relationship-schema.js";
import {
  createToolErrorContext,
  errorResult,
  formattedResult,
  ToolOutputFormatInputSchema,
} from "./result.js";

const TOOL_NAME = "ast_get_impact";
const IMPACT_TRUNCATION_REASONS = [...TRUNCATION_REASONS, "work_limit"] as const;

const AstGetImpactInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
  file_path: z.string().describe("Project-relative file containing the exact impact root."),
  symbol_path: z.string().describe("Exact symbol path returned by an outline or symbol search."),
  direction: z
    .enum(IMPACT_DIRECTIONS)
    .default("both")
    .describe("Traversal direction relative to the root symbol."),
  max_depth: z
    .number()
    .int()
    .min(0)
    .max(MAX_IMPACT_DEPTH)
    .default(DEFAULT_IMPACT_MAX_DEPTH)
    .describe("Maximum relationship depth, including zero for the root only."),
  max_nodes: z
    .number()
    .int()
    .min(1)
    .max(MAX_IMPACT_NODES)
    .default(DEFAULT_IMPACT_MAX_NODES)
    .describe("Maximum returned impact nodes, including the root."),
  max_edges: z
    .number()
    .int()
    .min(1)
    .max(MAX_IMPACT_EDGES)
    .default(DEFAULT_IMPACT_MAX_EDGES)
    .describe("Maximum returned relationship edges."),
  relationship_kinds: z
    .array(z.enum(RELATIONSHIP_EDGE_KINDS))
    .optional()
    .describe("Optional relationship kinds to traverse; defaults to all normalized kinds."),
  ...ToolOutputFormatInputSchema,
});

const ImpactOutputSchema = z.object({
  root: RelationshipEndpointSchema,
  direction: z.enum(IMPACT_DIRECTIONS),
  relationship_kinds: z.array(z.enum(RELATIONSHIP_EDGE_KINDS)),
  nodes: z.array(
    z.object({
      endpoint: RelationshipEndpointSchema,
      depth: z.number().int().min(0),
      direct: z.boolean(),
    }),
  ),
  edges: z.array(RelationshipEdgeSchema),
  coverage: RelationshipCoverageSchema,
  work: CompilerImpactWorkSchema,
  visited_nodes: z.number().int().min(0),
  visited_edges: z.number().int().min(0),
  max_depth_reached: z.number().int().min(0),
  max_depth: z.number().int().min(0),
  max_nodes: z.number().int().positive(),
  max_edges: z.number().int().positive(),
  incomplete: z.boolean(),
  truncation: z.object({
    truncated: z.boolean(),
    reason: z.enum(IMPACT_TRUNCATION_REASONS).nullable(),
  }),
  truncation_reasons: z.array(z.enum(IMPACT_TRUNCATION_REASONS)),
  freshness: FreshnessSchema,
});

export function registerGetImpact(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Get bounded compiler-backed impact",
      description:
        "Traverses exact compiler-backed relationships around a symbol with explicit direction, depth, node and edge budgets. Returns bounded session freshness metadata and fails closed when exact relationships are not fresh. Read-only evidence only; it never prepares or applies mutations.",
      inputSchema: AstGetImpactInputSchema,
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
        direction,
        max_depth,
        max_nodes,
        max_edges,
        relationship_kinds,
        output_format,
      },
      extra,
    ) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        const structuredContent = await withProject(
          project_root,
          (context, operationContext) => {
            if (context.status.state !== "fresh") {
              throw new Error("Compiler-backed impact evidence is not fresh. Retry the read.");
            }
            const freshness = {
              state: context.status.state,
              causes: context.status.causes,
              checked_at: context.status.lastSuccessfulSyncAt,
            };
            const root = resolveImpactRoot(
              context.project,
              context.projectRoot,
              { file_path, symbol_path },
              operationContext,
            );
            const impact = traverseCompilerImpact(
              context.project,
              context.projectRoot,
              root,
              freshness,
              { direction, max_depth, max_nodes, max_edges, relationship_kinds },
              operationContext,
            );
            return {
              ...impact,
              freshness,
            };
          },
          requestContext,
        );
        return formattedResult(ImpactOutputSchema.passthrough(), structuredContent, output_format);
      } catch (error) {
        return errorResult(error, createToolErrorContext(TOOL_NAME, project_root));
      }
    },
  );
}

// prettier-ignore
export const toolDescriptor = Object.freeze({ name: TOOL_NAME, register: registerGetImpact, compatibility: "optional", effect: "read", batch: "none", directOutputFormats: Object.freeze(["json", "toon"] as const) }) satisfies import("./catalog.js").ToolDescriptor<typeof TOOL_NAME>;
