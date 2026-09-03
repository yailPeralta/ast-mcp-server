import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildExploreContext,
  EXPLORE_DEFAULT_LIMIT,
  EXPLORE_DEFAULT_MAX_BYTES,
  EXPLORE_DEFAULT_OMISSION_DETAIL_LIMIT,
  EXPLORE_DEFAULT_REFERENCE_LIMIT,
  EXPLORE_MAX_BYTES,
  EXPLORE_MAX_OMISSION_DETAIL_LIMIT,
} from "../services/context-builder.js";
import {
  DEFAULT_IMPACT_MAX_DEPTH,
  DEFAULT_IMPACT_MAX_EDGES,
  DEFAULT_IMPACT_MAX_NODES,
  MAX_IMPACT_DEPTH,
  MAX_IMPACT_EDGES,
  MAX_IMPACT_NODES,
} from "../services/impact.js";
import { EXPLORE_OMISSION_REASONS } from "../services/explore-presentation.js";
import { createPaginationInputSchema } from "../services/pagination.js";
import { withProject } from "../services/project.js";
import { createRequestContext } from "../services/request-context.js";
import {
  FRESHNESS_CAUSES,
  READ_TRUNCATION_REASONS,
  SNAPSHOT_STATES,
} from "../services/read-contracts.js";
import { createToolErrorContext, errorResult, structuredResult } from "./result.js";
import { RelationshipEndpointSchema } from "./relationship-schema.js";

const TOOL_NAME = "ast_explore";

const ExploreDetailSchema = z.enum(["selectors", "summary", "context", "full"]).default("summary");
const ReferenceDetailSchema = z.enum(["locations", "context"]).default("locations");
const CallSpinesInputSchema = z.object({
  direction: z.enum(["incoming", "outgoing"]).default("outgoing"),
  max_depth: z.number().int().min(0).max(MAX_IMPACT_DEPTH).default(DEFAULT_IMPACT_MAX_DEPTH),
  max_nodes: z.number().int().min(1).max(MAX_IMPACT_NODES).default(DEFAULT_IMPACT_MAX_NODES),
  max_edges: z.number().int().min(1).max(MAX_IMPACT_EDGES).default(DEFAULT_IMPACT_MAX_EDGES),
});

const ExploreInputObjectSchema = z
  .object({
    project_root: z
      .string()
      .describe("Absolute project directory containing tsconfig.json, or the config path."),
    query: z.string().min(1).optional().describe("Bounded case-insensitive symbol query."),
    file_path: z.string().optional().describe("Known project-relative or unambiguous source file."),
    symbol_path: z
      .string()
      .min(1)
      .optional()
      .describe("Exact symbol path or selector, valid only with file_path."),
    kinds: z.array(z.string()).max(32).optional().describe("Optional exact syntax-kind filters."),
    file_filter: z.string().optional().describe("Optional query-route file path substring filter."),
    detail: ExploreDetailSchema.describe(
      "selectors returns routing coordinates; summary adds signatures; context adds source; full adds source and references.",
    ),
    include_source: z
      .boolean()
      .optional()
      .describe("Override detail-based source expansion for selected symbols."),
    include_references: z
      .boolean()
      .optional()
      .describe("Override detail-based compiler reference expansion for selected symbols."),
    reference_detail: ReferenceDetailSchema.describe(
      "Reference locations or bounded source-line context.",
    ),
    reference_limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(EXPLORE_DEFAULT_REFERENCE_LIMIT)
      .describe("Maximum compiler references per selected symbol."),
    ...createPaginationInputSchema(EXPLORE_DEFAULT_LIMIT),
    max_bytes: z
      .number()
      .int()
      .min(1024)
      .max(EXPLORE_MAX_BYTES)
      .default(EXPLORE_DEFAULT_MAX_BYTES)
      .describe("Maximum serialized logical result size in UTF-8 bytes."),
    call_spines: CallSpinesInputSchema.optional().describe(
      "Optional compiler-authoritative static call paths for an exact file_path and symbol_path.",
    ),
    omission_detail_limit: z
      .number()
      .int()
      .min(0)
      .max(EXPLORE_MAX_OMISSION_DETAIL_LIMIT)
      .default(EXPLORE_DEFAULT_OMISSION_DETAIL_LIMIT)
      .describe("Maximum deterministic omission detail records; exact counts are always retained."),
  })
  .strip();

const ExploreInputSchema = ExploreInputObjectSchema.refine(
  (input) => Boolean(input.query || input.file_path),
  {
    message: "Provide query, file_path, or both file_path and symbol_path.",
    path: ["query"],
  },
)
  .refine((input) => !input.symbol_path || Boolean(input.file_path), {
    message: "symbol_path requires file_path so the exact declaration can be resolved.",
    path: ["symbol_path"],
  })
  .refine((input) => !input.call_spines || Boolean(input.file_path && input.symbol_path), {
    message: "call_spines requires exact file_path and symbol_path inputs.",
    path: ["call_spines"],
  });

const ExploreSymbolSchema = z.object({
  file: z.string(),
  selector: z.string(),
  kind: z.string(),
  symbol_path: z.string().optional(),
  name: z.string().optional(),
  line: z.number().int().positive().optional(),
  signature: z.string().optional(),
});

const ExploreSourceSchema = z.object({
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  text: z.string(),
});

const ExploreReferenceSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  kind: z.string(),
  is_declaration: z.boolean(),
  context: z.string().optional(),
});

const ExploreEvidenceSchema = z.object({
  selector: z.string(),
  source: ExploreSourceSchema.optional(),
  references: z
    .object({
      symbol: z.string(),
      include_declaration: z.boolean(),
      declaration_count: z.number().int().min(0),
      reference_count: z.number().int().min(0),
      affected_files: z.array(z.string()),
      references: z.array(ExploreReferenceSchema),
      offset: z.number().int().min(0),
      limit: z.number().int().positive(),
      total: z.number().int().min(0),
      has_more: z.boolean(),
      next_offset: z.number().int().min(0).nullable(),
    })
    .optional(),
});

const ExploreOmissionSchema = z.object({
  subject: z.string(),
  category: z.enum(["budget", "incomplete", "untrusted"]),
  component: z.enum(["signature", "source", "references", "call_spine"]),
  reason: z.enum(EXPLORE_OMISSION_REASONS),
});

const CallSpinesOutputSchema = z.object({
  root: RelationshipEndpointSchema,
  direction: z.enum(["incoming", "outgoing"]),
  paths: z.array(
    z.object({
      endpoint: RelationshipEndpointSchema,
      endpoints: z.array(RelationshipEndpointSchema),
      relationship_ids: z.array(z.string()),
    }),
  ),
  visited: z.object({
    nodes: z.number().int().min(0),
    edges: z.number().int().min(0),
    max_depth: z.number().int().min(0),
  }),
  budget: z.object({
    max_depth: z.number().int().min(0),
    max_nodes: z.number().int().positive(),
    max_edges: z.number().int().positive(),
  }),
  incomplete: z.boolean(),
  truncation_reasons: z.array(z.enum(["depth_limit", "node_limit", "edge_limit"])),
  authority_state: z.enum(["authoritative", "incomplete", "untrusted"]),
  empty_proven: z.boolean(),
});

const ExploreOutputSchema = z.object({
  route: z.enum(["query", "file", "symbol"]),
  query: z.string().nullable(),
  file: z.string().nullable(),
  symbol: z.string().nullable(),
  detail: ExploreDetailSchema,
  symbols: z.array(ExploreSymbolSchema),
  evidence: z.array(ExploreEvidenceSchema),
  offset: z.number().int().min(0),
  limit: z.number().int().positive(),
  total: z.number().int().min(0),
  has_more: z.boolean(),
  next_offset: z.number().int().min(0).nullable(),
  omissions: z.object({
    counts: z.array(
      z.object({
        category: z.enum(["budget", "incomplete", "untrusted"]),
        component: z.enum(["signature", "source", "references", "call_spine"]),
        count: z.number().int().positive(),
      }),
    ),
    details: z.array(ExploreOmissionSchema),
    total: z.number().int().min(0),
    has_more: z.boolean(),
  }),
  call_spines: CallSpinesOutputSchema.optional(),
  freshness: z.object({
    state: z.enum(SNAPSHOT_STATES),
    causes: z.array(z.enum(FRESHNESS_CAUSES)),
    checked_at: z.string().nullable(),
  }),
  completeness: z.object({
    complete: z.boolean(),
    symbols_complete: z.boolean(),
    evidence_complete: z.boolean(),
    spines_complete: z.boolean().optional(),
    unresolved: z.array(
      z.object({
        selector: z.string(),
        reason: z.enum(["source_unresolved", "references_unresolved"]),
      }),
    ),
  }),
  budget: z.object({
    max_records: z.number().int().positive(),
    max_bytes: z.number().int().positive(),
    max_depth: z.null(),
    max_edges: z.null(),
    max_invocations: z.number().int().positive(),
    used_bytes: z.number().int().nonnegative(),
  }),
  truncation: z.object({
    truncated: z.boolean(),
    reason: z.enum(READ_TRUNCATION_REASONS).nullable(),
  }),
});

export function registerExplore(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Explore project context",
      description:
        "Composes bounded structural search, exact selectors, source evidence and compiler references without weakening the primitive AST tools. Returns bounded session freshness metadata for fresh, pending, stale, rebuilding or degraded state.",
      inputSchema: ExploreInputObjectSchema,
      outputSchema: ExploreOutputSchema,
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
        query,
        file_path,
        symbol_path,
        kinds,
        file_filter,
        detail,
        include_source,
        include_references,
        reference_detail,
        reference_limit,
        offset,
        limit,
        max_bytes,
        call_spines,
        omission_detail_limit,
      },
      extra,
    ) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        ExploreInputSchema.parse({ project_root, query, file_path, symbol_path, call_spines });
        const output = await withProject(
          project_root,
          (context, operationContext) =>
            buildExploreContext(
              context,
              {
                query,
                filePath: file_path,
                symbolPath: symbol_path,
                kinds,
                fileFilter: file_filter,
                detail,
                includeSource: include_source,
                includeReferences: include_references,
                referenceDetail: reference_detail,
                offset,
                limit,
                referenceLimit: reference_limit,
                maxBytes: max_bytes,
                callSpines: call_spines
                  ? {
                      direction: call_spines.direction,
                      maxDepth: call_spines.max_depth,
                      maxNodes: call_spines.max_nodes,
                      maxEdges: call_spines.max_edges,
                    }
                  : undefined,
                omissionDetailLimit: omission_detail_limit,
              },
              operationContext,
            ),
          requestContext,
        );
        return structuredResult(ExploreOutputSchema.parse(output));
      } catch (error) {
        return errorResult(error, createToolErrorContext(TOOL_NAME, project_root));
      }
    },
  );
}

// prettier-ignore
export const toolDescriptor = Object.freeze({ name: TOOL_NAME, register: registerExplore, compatibility: "optional", effect: "read", batch: "read", directOutputFormats: Object.freeze(["json"] as const) }) satisfies import("./catalog.js").ToolDescriptor<typeof TOOL_NAME>;
