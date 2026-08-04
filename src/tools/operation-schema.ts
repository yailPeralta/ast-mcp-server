import { z } from "zod";
import type { PreparedOperation } from "../services/operations.js";

export const NormalizedDiagnosticSchema = z.object({
  code: z.number().int(),
  category: z.string(),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable(),
  message: z.string(),
});

export const PreparedOperationOutputSchema = z.object({
  operation_id: z.string().uuid(),
  plan_hash: z.string().length(64),
  kind: z.enum(["rename_symbol", "replace_symbol_body", "scaffold_class"]),
  status: z.literal("prepared"),
  project_root: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  affected_files: z.array(
    z.object({
      file: z.string(),
      original_hash: z.string(),
      updated_hash: z.string(),
    }),
  ),
  reference_count: z.number().int().min(0),
  workspace_hash: z.string().length(64),
  workspace_file_count: z.number().int().positive(),
  diagnostics: z.object({
    added: z.array(NormalizedDiagnosticSchema),
    removed: z.array(NormalizedDiagnosticSchema),
    added_errors: z.array(NormalizedDiagnosticSchema),
  }),
  allow_new_errors: z.boolean(),
  blocked: z.boolean(),
  block_reason: z.string().nullable(),
  preview: z.string().nullable(),
  preview_truncated: z.boolean(),
});

export function serializePreparedOperation(operation: PreparedOperation) {
  if (operation.status !== "prepared") {
    throw new Error(`Operation ${operation.operation_id} is not in prepared state.`);
  }
  return {
    operation_id: operation.operation_id,
    plan_hash: operation.plan_hash,
    kind: operation.kind,
    status: "prepared" as const,
    project_root: operation.project_root,
    created_at: operation.created_at,
    expires_at: operation.expires_at,
    affected_files: operation.affected_files,
    reference_count: operation.reference_count,
    workspace_hash: operation.workspace_hash,
    workspace_file_count: operation.workspace_file_count,
    diagnostics: {
      added: operation.diagnostics.added,
      removed: operation.diagnostics.removed,
      added_errors: operation.diagnostics.addedErrors,
    },
    allow_new_errors: operation.allow_new_errors,
    blocked: operation.blocked,
    block_reason: operation.block_reason,
    preview: operation.preview,
    preview_truncated: operation.preview_truncated,
  };
}
