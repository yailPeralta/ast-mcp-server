import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOperationPreview } from "../services/operations.js";
import { createRequestContext } from "../services/request-context.js";
import { createToolErrorContext, errorResult, structuredResult } from "./result.js";

const TOOL_NAME = "ast_get_operation_preview";

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
    TOOL_NAME,
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
        return errorResult(error, createToolErrorContext(TOOL_NAME));
      }
    },
  );
}

// prettier-ignore
export const toolDescriptor = Object.freeze({ name: TOOL_NAME, register: registerGetOperationPreview, compatibility: "required", effect: "read", batch: "none", directOutputFormats: Object.freeze(["json"] as const) }) satisfies import("./catalog.js").ToolDescriptor<typeof TOOL_NAME>;
