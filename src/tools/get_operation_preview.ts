import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOperationPreview } from "../services/operations.js";
import { createRequestContext } from "../services/request-context.js";
import { errorResult, structuredResult } from "./result.js";

const AstGetOperationPreviewInputSchema = z.object({
  operation_id: z.string().uuid(),
  file: z.string().optional().describe("Optional affected file path to retrieve only its diff."),
});

const AstGetOperationPreviewOutputSchema = z.object({
  operation_id: z.string().uuid(),
  plan_hash: z.string().length(64),
  files: z.array(z.object({ file: z.string(), diff: z.string() })),
});

export function registerGetOperationPreview(server: McpServer): void {
  server.registerTool(
    "ast_get_operation_preview",
    {
      title: "Get complete prepared-operation diff",
      description:
        "Retrieves exact unified diffs retained for a prepared operation, optionally one affected file at a time.",
      inputSchema: AstGetOperationPreviewInputSchema,
      outputSchema: AstGetOperationPreviewOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ operation_id, file }, extra) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        const output = await getOperationPreview(operation_id, file, requestContext);
        return structuredResult(output);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
