import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prepareRename } from "../services/operations.js";
import { createRequestContext } from "../services/request-context.js";
import { PreparedOperationOutputSchema, serializePreparedOperation } from "./operation-schema.js";
import { createToolErrorContext, errorResult, structuredResult } from "./result.js";

const AstRenameSymbolInputSchema = z.object({
  project_root: z.string(),
  file_path: z.string(),
  symbol_path: z.string(),
  new_name: z.string().min(1).describe("New identifier only, without a container prefix."),
  dry_run: z
    .boolean()
    .default(true)
    .describe("Compatibility field. Direct application is disabled; this tool always prepares."),
  allow_new_errors: z
    .boolean()
    .default(false)
    .describe("Permit a plan with new TypeScript errors after explicit review."),
});

export function registerRenameSymbol(server: McpServer): void {
  server.registerTool(
    "ast_rename_symbol",
    {
      title: "Prepare a project-wide structural rename",
      description:
        "Prepares an exact hash-bound rename plan without writing. Review the preview and apply its operation_id with ast_apply_operation.",
      inputSchema: AstRenameSymbolInputSchema,
      outputSchema: PreparedOperationOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (
      { project_root, file_path, symbol_path, new_name, dry_run, allow_new_errors },
      extra,
    ) => {
      const requestContext = createRequestContext(extra.signal);
      try {
        if (!dry_run) {
          throw new Error(
            "Direct rename application is disabled. Prepare with dry_run=true, then call ast_apply_operation with the returned operation_id.",
          );
        }
        const operation = await prepareRename(
          {
            projectRoot: project_root,
            filePath: file_path,
            symbolPath: symbol_path,
            newName: new_name,
            allowNewErrors: allow_new_errors,
          },
          requestContext,
        );
        return structuredResult(serializePreparedOperation(operation));
      } catch (error) {
        return errorResult(error, createToolErrorContext("ast_rename_symbol", project_root));
      }
    },
  );
}
