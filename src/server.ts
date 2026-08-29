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
import { toolCatalog } from "./tools/catalog.js";
import {
  createToolErrorContext,
  errorResult,
  projectStructuredContentAsText,
} from "./tools/result.js";

const packageMetadata = createRequire(import.meta.url)("../package.json") as { version: string };
export const PACKAGE_VERSION = packageMetadata.version;

export interface CreateServerOptions {
  readonly runtimeActivity?: RuntimeActivityTracker;
  /** Deny every apply-effect tool at registration (deny-by-default apply guard). */
  readonly denyApply?: boolean;
  /** Project empty successful structured results as canonical JSON text for model-only hosts. */
  readonly projectStructuredContentAsText?: boolean;
}

function installStructuredContentTextProjection(server: McpServer): void {
  const registerTool = server.registerTool.bind(server);
  function projectedRegisterTool<
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
    const projectedCallback = (async (...args: Parameters<ToolCallback<InputArgs>>) => {
      const result = await Reflect.apply(callback, undefined, args);
      return projectStructuredContentAsText(result, true);
    }) as ToolCallback<InputArgs>;
    return registerTool(name, config, projectedCallback);
  }
  server.registerTool = projectedRegisterTool;
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
  if (options.projectStructuredContentAsText === true) {
    installStructuredContentTextProjection(server);
  }
  if (options.denyApply === undefined) {
    toolCatalog.registerAll(server);
  } else {
    toolCatalog.registerAll(server, { denyApply: options.denyApply });
  }
  return server;
}
