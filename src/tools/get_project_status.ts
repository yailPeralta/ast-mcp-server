import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FRESHNESS_CAUSES,
  SNAPSHOT_STATES,
  TRUNCATION_REASONS,
} from "../services/read-contracts.js";
import { getProjectStatus } from "../services/project.js";
import { errorResult, structuredResult } from "./result.js";

const AstGetProjectStatusInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
});

const TruncationMetadataSchema = z.object({
  truncated: z.boolean(),
  reason: z.enum(TRUNCATION_REASONS).nullable(),
});

const ProjectStatusOutputSchema = z.object({
  project: z.object({
    project_id: z.string().regex(/^project_[0-9a-f]{20}$/),
    config_id: z
      .string()
      .regex(/^config_[0-9a-f]{20}$/)
      .nullable(),
  }),
  state: z.enum(SNAPSHOT_STATES),
  causes: z.array(z.enum(FRESHNESS_CAUSES)),
  source_count: z.number().int().min(0),
  indexed_count: z.number().int().min(0),
  pending_files: z.array(z.string()),
  pending_files_truncated: z.boolean(),
  pending_files_truncation: TruncationMetadataSchema,
  pending_files_filename_truncation: TruncationMetadataSchema,
  compiler: z.object({ state: z.enum(["ready", "rebuilding", "failed"]) }),
  index: z.object({ state: z.literal("disabled") }),
  operation_queue: z.object({
    state: z.enum(["idle", "queued", "running"]),
    active_operations: z.number().int().min(0),
    queued_operations: z.number().int().min(0),
  }),
  watcher: z.object({ state: z.enum(["disabled", "ready", "failed"]) }),
  last_successful_sync_at: z.string().nullable(),
  last_successful_index_at: z.null(),
  source_snapshot_fingerprint: z.string().nullable(),
  config_snapshot_fingerprint: z.string().nullable(),
  canonical_snapshot_fingerprint: z.string().nullable(),
  degraded_errors: z.array(z.string()),
  degraded_errors_truncation: TruncationMetadataSchema,
  degraded_errors_text_truncation: TruncationMetadataSchema,
});

export function registerGetProjectStatus(server: McpServer): void {
  server.registerTool(
    "ast_get_project_status",
    {
      title: "Get project freshness status",
      description:
        "Returns bounded, read-only compiler freshness and project status without exposing filesystem identities or credentials.",
      inputSchema: AstGetProjectStatusInputSchema,
      outputSchema: ProjectStatusOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_root }) => {
      try {
        const output = await getProjectStatus(project_root);
        return structuredResult({ ...output });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
