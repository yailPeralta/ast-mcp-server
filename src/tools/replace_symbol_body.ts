import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prepareReplaceBody } from "../services/operations.js";
import { createRequestContext } from "../services/request-context.js";
import { PreparedOperationOutputSchema, serializePreparedOperation } from "./operation-schema.js";
import { createToolErrorContext, errorResult, structuredResult } from "./result.js";

const AstReplaceSymbolBodyInputSchema = z.object({
  project_root: z.string(),
  file_path: z.string(),
  symbol_path: z.string(),
  new_body: z.string().describe("New body text without the enclosing braces."),
  dry_run: z
    .boolean()
    .default(true)
    .describe("Compatibility field. Direct application is disabled; this tool always prepares."),
  allow_new_errors: z
    .boolean()
    .default(false)
    .describe("Permit a plan with new TypeScript errors after explicit review."),
});

export function registerReplaceSymbolBody(server: McpServer): void {
  server.registerTool(
    "ast_replace_symbol_body",
    {
      title: "Prepare an exact function-body replacement",
      description:
        "Prepares a hash-bound body replacement while preserving the signature. Supports declarations, methods, accessors and function-valued variables/properties.",
      inputSchema: AstReplaceSymbolBodyInputSchema,
      outputSchema: PreparedOperationOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (
      { project_root, file_path, symbol_path, new_body, dry_run, allow_new_errors },
      extra,
    ) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        if (!dry_run) {
          throw new Error(
            "Direct body replacement is disabled. Prepare with dry_run=true, then call ast_apply_operation with the returned operation_id.",
          );
        }
        const operation = await prepareReplaceBody(
          {
            projectRoot: project_root,
            filePath: file_path,
            symbolPath: symbol_path,
            newBody: new_body,
            allowNewErrors: allow_new_errors,
          },
          requestContext,
        );
        return structuredResult(serializePreparedOperation(operation));
      } catch (error) {
        return errorResult(error, createToolErrorContext("ast_replace_symbol_body", project_root));
      }
    },
  );
}
