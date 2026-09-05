import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_IMPACT_MAX_DEPTH,
  DEFAULT_IMPACT_MAX_EDGES,
  DEFAULT_IMPACT_MAX_NODES,
  MAX_IMPACT_DEPTH,
  MAX_IMPACT_EDGES,
  MAX_IMPACT_NODES,
  isCompleteExactImpactEvidence,
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
  TEST_CANDIDATE_RELATIONSHIP_KINDS,
  TEST_CANDIDATE_CONFIDENCES,
  TEST_CANDIDATE_REASONS,
} from "../services/test-candidates.js";
import {
  CompilerImpactWorkSchema,
  FreshnessSchema,
  RelationshipCoverageSchema,
  RelationshipEdgeSchema,
  RelationshipEndpointSchema,
} from "./relationship-schema.js";
import { createToolErrorContext, errorResult, structuredResult } from "./result.js";

const TOOL_NAME = "ast_find_test_candidates";

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
  relationship_kinds: z.tuple([
    z.literal("reference"),
    z.literal("import"),
    z.literal("export"),
    z.literal("extends"),
    z.literal("implements"),
    z.literal("call"),
  ]),
  coverage: RelationshipCoverageSchema.refine(
    (entries) => entries.length === TEST_CANDIDATE_RELATIONSHIP_KINDS.length,
    { message: "Candidate coverage must contain six entries." },
  ),
  work: CompilerImpactWorkSchema,
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
    TOOL_NAME,
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
              {
                direction: "incoming",
                max_depth,
                max_nodes,
                max_edges,
                relationship_kinds: TEST_CANDIDATE_RELATIONSHIP_KINDS,
              },
              operationContext,
            );
            if (!isCompleteExactImpactEvidence(impact)) {
              const reason = impact.work.exhausted
                ? "work_limit"
                : impact.coverage.some(({ status }) => status === "unsupported")
                  ? "unsupported relationship coverage"
                  : "incomplete relationship evidence";
              throw new PublicOperationalError("INCOMPLETE_EVIDENCE", reason);
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
              relationship_kinds: TEST_CANDIDATE_RELATIONSHIP_KINDS,
              coverage: impact.coverage,
              work: impact.work,
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
        return errorResult(error, createToolErrorContext(TOOL_NAME, project_root));
      }
    },
  );
}

// prettier-ignore
export const toolDescriptor = Object.freeze({ name: TOOL_NAME, register: registerFindTestCandidates, compatibility: "required", effect: "read", batch: "read", directOutputFormats: Object.freeze(["json"] as const) }) satisfies import("./catalog.js").ToolDescriptor<typeof TOOL_NAME>;
