import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyOperation } from "../services/operations.js";
import { createRequestContext } from "../services/request-context.js";
import { createToolErrorContext, errorResult, structuredResult } from "./result.js";

const TOOL_NAME = "ast_apply_operation";

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
    TOOL_NAME,
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
    async ({ operation_id, plan_hash }, extra) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        return structuredResult({
          ...(await applyOperation(operation_id, plan_hash, requestContext)),
        });
      } catch (error) {
        return errorResult(error, createToolErrorContext(TOOL_NAME));
      }
    },
  );
}

// prettier-ignore
export const toolDescriptor = Object.freeze({ name: TOOL_NAME, register: registerApplyOperation, compatibility: "required", effect: "apply", batch: "none", directOutputFormats: Object.freeze(["json"] as const) }) satisfies import("./catalog.js").ToolDescriptor<typeof TOOL_NAME>;
