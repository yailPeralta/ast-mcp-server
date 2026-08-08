import { createRequire } from "node:module";
import {
  McpServer,
  type RegisteredTool,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { PublicOperationalError } from "./services/public-errors.js";
import type { RuntimeActivityTracker } from "./services/runtime-activity.js";
import { registerApplyOperation } from "./tools/apply_operation.js";
import { registerFindReferences } from "./tools/find_references.js";
import { registerGetDiagnostics } from "./tools/get_diagnostics.js";
import { registerGetFile } from "./tools/get_file.js";
import { registerGetImpact } from "./tools/get_impact.js";
import { registerGetOperationPreview } from "./tools/get_operation_preview.js";
import { registerGetOutline } from "./tools/get_outline.js";
import { registerGetProjectStatus } from "./tools/get_project_status.js";
import { registerGetSymbolSource } from "./tools/get_symbol_source.js";
import { registerListFiles } from "./tools/list_files.js";
import { registerRenameSymbol } from "./tools/rename_symbol.js";
import { registerReplaceSymbolBody } from "./tools/replace_symbol_body.js";
import { registerScaffoldClass } from "./tools/scaffold_class.js";
import { registerSearchSymbols } from "./tools/search_symbols.js";
import { registerExplore } from "./tools/explore.js";
import { createToolErrorContext, errorResult } from "./tools/result.js";

const packageMetadata = createRequire(import.meta.url)("../package.json") as { version: string };
export const PACKAGE_VERSION = packageMetadata.version;

export interface CreateServerOptions {
  readonly runtimeActivity?: RuntimeActivityTracker;
}

function installRuntimeActivityTracking(
  server: McpServer,
  runtimeActivity: RuntimeActivityTracker,
): void {
  const registerTool = server.registerTool.bind(server);
  function trackedRegisterTool<
    OutputArgs extends ZodRawShapeCompat | AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  >(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: InputArgs;
      outputSchema?: OutputArgs;
      annotations?: ToolAnnotations;
      _meta?: Record<string, unknown>;
    },
    callback: ToolCallback<InputArgs>,
  ): RegisteredTool {
    const trackedCallback = (async (...args: Parameters<ToolCallback<InputArgs>>) =>
      runtimeActivity.trackRequest(() => {
        if (runtimeActivity.admission === "closed") {
          return errorResult(
            new PublicOperationalError("SERVER_SHUTTING_DOWN", "Server is shutting down."),
            createToolErrorContext(name),
          );
        }
        return Reflect.apply(callback, undefined, args);
      })) as ToolCallback<InputArgs>;
    return registerTool(name, config, trackedCallback);
  }
  server.registerTool = trackedRegisterTool;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "ast-mcp-server",
    version: PACKAGE_VERSION,
  });
  if (options.runtimeActivity) installRuntimeActivityTracking(server, options.runtimeActivity);
  registerListFiles(server);
  registerGetProjectStatus(server);
  registerExplore(server);
  registerGetOutline(server);
  registerGetSymbolSource(server);
  registerSearchSymbols(server);
  registerFindReferences(server);
  registerGetImpact(server);
  registerGetDiagnostics(server);
  registerGetFile(server);
  registerRenameSymbol(server);
  registerReplaceSymbolBody(server);
  registerScaffoldClass(server);
  registerGetOperationPreview(server);
  registerApplyOperation(server);
  return server;
}
