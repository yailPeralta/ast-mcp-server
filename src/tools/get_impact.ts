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
  traverseImpact,
} from "../services/impact.js";
import {
  FRESHNESS_CAUSES,
  SNAPSHOT_STATES,
  TRUNCATION_REASONS,
} from "../services/read-contracts.js";
import { withProject } from "../services/project.js";
import { createRequestContext } from "../services/request-context.js";
import {
  RELATIONSHIP_CONFIDENCES,
  RELATIONSHIP_EDGE_KINDS,
  RELATIONSHIP_PROVENANCES,
  RELATIONSHIP_RESOLUTIONS,
} from "../services/relationships.js";
import {
  createToolErrorContext,
  errorResult,
  formattedResult,
  ToolOutputFormatInputSchema,
} from "./result.js";

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

const SourceRangeSchema = z.object({
  start_line: z.number().int().positive(),
  start_column: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  end_column: z.number().int().positive().optional(),
});

const RelationshipEndpointSchema = z.object({
  file: z.string(),
  symbol_path: z.string(),
  selector: z.string(),
  range: SourceRangeSchema.optional(),
});

const FreshnessSchema = z.object({
  state: z.enum(SNAPSHOT_STATES),
  causes: z.array(z.enum(FRESHNESS_CAUSES)),
  checked_at: z.string().nullable(),
});

const RelationshipEdgeSchema = z.object({
  relationship_id: z.string(),
  source: RelationshipEndpointSchema,
  target: RelationshipEndpointSchema,
  kind: z.enum(RELATIONSHIP_EDGE_KINDS),
  provenance: z.enum(RELATIONSHIP_PROVENANCES),
  confidence: z.enum(RELATIONSHIP_CONFIDENCES),
  resolution: z.enum(RELATIONSHIP_RESOLUTIONS),
  compiler_authoritative: z.boolean(),
  freshness: FreshnessSchema,
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
  visited_nodes: z.number().int().min(0),
  visited_edges: z.number().int().min(0),
  max_depth_reached: z.number().int().min(0),
  max_depth: z.number().int().min(0),
  max_nodes: z.number().int().positive(),
  max_edges: z.number().int().positive(),
  incomplete: z.boolean(),
  truncation: z.object({
    truncated: z.boolean(),
    reason: z.enum(TRUNCATION_REASONS).nullable(),
  }),
  truncation_reasons: z.array(z.enum(TRUNCATION_REASONS)),
  freshness: FreshnessSchema,
});

export function registerGetImpact(server: McpServer): void {
  server.registerTool(
    "ast_get_impact",
    {
      title: "Get bounded compiler-backed impact",
      description:
        "Traverses exact compiler-backed relationships around a symbol with explicit direction, depth, node and edge budgets. Returns bounded session freshness metadata and fails closed when exact relationships are not fresh. Read-only evidence only; it never prepares or applies mutations.",
      inputSchema: AstGetImpactInputSchema,
      outputSchema: ImpactOutputSchema,
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
            if (!context.relationshipEdgesReady || context.status.state !== "fresh") {
              throw new Error(
                "Compiler-backed impact relationships are not fresh. Retry the read.",
              );
            }
            const root = resolveImpactRoot(
              context.project,
              context.projectRoot,
              { file_path, symbol_path },
              operationContext,
            );
            const impact = traverseImpact(
              root,
              context.relationshipEdges,
              { direction, max_depth, max_nodes, max_edges, relationship_kinds },
              operationContext,
            );
            return {
              ...impact,
              freshness: {
                state: context.status.state,
                causes: context.status.causes,
                checked_at: context.status.lastSuccessfulSyncAt,
              },
            };
          },
          requestContext,
        );
        return formattedResult(ImpactOutputSchema, structuredContent, output_format);
      } catch (error) {
        return errorResult(error, createToolErrorContext("ast_get_impact", project_root));
      }
    },
  );
}
