import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyOperation } from "../services/operations.js";
import { errorResult, structuredResult } from "./result.js";

const AstApplyOperationInputSchema = z.object({
  operation_id: z.string().uuid().describe("Identifier returned by a prepare operation."),
  plan_hash: z.string().length(64).describe("Plan hash returned by the same prepare operation."),
});

const AstApplyOperationOutputSchema = z.object({
  operation_id: z.string().uuid(),
  kind: z.enum(["rename_symbol", "replace_symbol_body", "scaffold_class"]),
  status: z.literal("applied"),
  applied_at: z.string(),
  affected_files: z.array(z.string()),
  idempotent_replay: z.boolean(),
});

export function registerApplyOperation(server: McpServer): void {
  server.registerTool(
    "ast_apply_operation",
    {
      title: "Apply a prepared structural operation",
      description:
        "Applies exactly the reviewed plan after verifying its plan hash and the complete TypeScript workspace fingerprint. Conflicts abort before writes; retries after success are idempotent.",
      inputSchema: AstApplyOperationInputSchema,
      outputSchema: AstApplyOperationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ operation_id, plan_hash }) => {
      try {
        return structuredResult({ ...(await applyOperation(operation_id, plan_hash)) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
