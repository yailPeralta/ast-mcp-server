import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_IMPACT_MAX_DEPTH,
  DEFAULT_IMPACT_MAX_EDGES,
  DEFAULT_IMPACT_MAX_NODES,
  MAX_IMPACT_DEPTH,
  MAX_IMPACT_EDGES,
  MAX_IMPACT_NODES,
  resolveImpactRoot,
  traverseCompilerImpact,
} from "../services/impact.js";
import { paginate, PaginationInputSchema, PaginationOutputSchema } from "../services/pagination.js";
import { withProject } from "../services/project.js";
import { PublicOperationalError } from "../services/public-errors.js";
import { createRequestContext } from "../services/request-context.js";
import {
  findTestCandidates,
  MAX_TEST_CANDIDATE_CONVENTION_ITEMS,
  MAX_TEST_CANDIDATE_CONVENTION_LENGTH,
  TEST_CANDIDATE_CONFIDENCES,
  TEST_CANDIDATE_REASONS,
} from "../services/test-candidates.js";
import {
  FreshnessSchema,
  RelationshipEdgeSchema,
  RelationshipEndpointSchema,
} from "./relationship-schema.js";
import { createToolErrorContext, errorResult, structuredResult } from "./result.js";

const ConventionSchema = z
  .array(z.string().min(1).max(MAX_TEST_CANDIDATE_CONVENTION_LENGTH))
  .max(MAX_TEST_CANDIDATE_CONVENTION_ITEMS)
  .optional();

const AstFindTestCandidatesInputSchema = z.object({
  project_root: z.string(),
  file_path: z.string(),
  symbol_path: z.string(),
  max_depth: z.number().int().min(0).max(MAX_IMPACT_DEPTH).default(DEFAULT_IMPACT_MAX_DEPTH),
  max_nodes: z.number().int().min(1).max(MAX_IMPACT_NODES).default(DEFAULT_IMPACT_MAX_NODES),
  max_edges: z.number().int().min(1).max(MAX_IMPACT_EDGES).default(DEFAULT_IMPACT_MAX_EDGES),
  test_file_patterns: ConventionSchema,
  test_directories: ConventionSchema,
  ...PaginationInputSchema,
});

const TestCandidateSchema = z.object({
  file: z.string(),
  reason: z.enum(TEST_CANDIDATE_REASONS),
  confidence: z.enum(TEST_CANDIDATE_CONFIDENCES),
  evidence: z.object({
    depth: z.number().int().min(0),
    direct: z.boolean(),
    compiler_authoritative: z.literal(true),
    relationship_ids: z.array(z.string()),
    relationships: z.array(RelationshipEdgeSchema),
  }),
});

const FindTestCandidatesOutputSchema = z.object({
  backend: z.literal("typescript_compiler"),
  compiler_authoritative: z.literal(true),
  root: RelationshipEndpointSchema,
  direction: z.literal("incoming"),
  candidates: z.array(TestCandidateSchema),
  ...PaginationOutputSchema,
  visited_nodes: z.number().int().min(0),
  visited_edges: z.number().int().min(0),
  max_depth_reached: z.number().int().min(0),
  max_depth: z.number().int().min(0),
  max_nodes: z.number().int().positive(),
  max_edges: z.number().int().positive(),
  incomplete: z.literal(false),
  truncation: z.object({
    truncated: z.literal(false),
    reason: z.null(),
  }),
  freshness: FreshnessSchema,
  completeness: z.object({
    complete: z.literal(true),
    proven_empty: z.boolean(),
  }),
});

export function registerFindTestCandidates(server: McpServer): void {
  server.registerTool(
    "ast_find_test_candidates",
    {
      title: "Find compiler-backed affected test candidates",
      description:
        "Finds deterministic affected test candidates from fresh, complete incoming compiler relationships. Returns bounded whole-candidate proofs and never executes tests or prepares mutations.",
      inputSchema: AstFindTestCandidatesInputSchema,
      outputSchema: FindTestCandidatesOutputSchema,
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
        max_depth,
        max_nodes,
        max_edges,
        test_file_patterns,
        test_directories,
        offset,
        limit,
      },
      extra,
    ) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        const result = await withProject(
          project_root,
          (context, operationContext) => {
            if (context.status.state !== "fresh") {
              throw new PublicOperationalError("STALE_WORKSPACE", "Retry the workspace read.");
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
              { direction: "incoming", max_depth, max_nodes, max_edges },
              operationContext,
            );
            if (impact.incomplete || impact.truncation.truncated) {
              throw new PublicOperationalError("INCOMPLETE_EVIDENCE", "Evidence is incomplete.");
            }
            const candidates = findTestCandidates(impact, {
              test_file_patterns,
              test_directories,
            });
            const page = paginate(candidates, offset, limit);
            return {
              backend: "typescript_compiler" as const,
              compiler_authoritative: true as const,
              root: impact.root,
              direction: "incoming" as const,
              candidates: page.items,
              offset: page.offset,
              limit: page.limit,
              total: page.total,
              has_more: page.has_more,
              next_offset: page.next_offset,
              visited_nodes: impact.visited_nodes,
              visited_edges: impact.visited_edges,
              max_depth_reached: impact.max_depth_reached,
              max_depth: impact.max_depth,
              max_nodes: impact.max_nodes,
              max_edges: impact.max_edges,
              incomplete: false as const,
              truncation: { truncated: false as const, reason: null },
              freshness,
              completeness: { complete: true as const, proven_empty: candidates.length === 0 },
            };
          },
          requestContext,
        );
        return structuredResult(FindTestCandidatesOutputSchema.parse(result));
      } catch (error) {
        return errorResult(error, createToolErrorContext("ast_find_test_candidates", project_root));
      }
    },
  );
}
