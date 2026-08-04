import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApplyOperation } from "./tools/apply_operation.js";
import { registerFindReferences } from "./tools/find_references.js";
import { registerGetDiagnostics } from "./tools/get_diagnostics.js";
import { registerGetOperationPreview } from "./tools/get_operation_preview.js";
import { registerGetOutline } from "./tools/get_outline.js";
import { registerGetSymbolSource } from "./tools/get_symbol_source.js";
import { registerListFiles } from "./tools/list_files.js";
import { registerRenameSymbol } from "./tools/rename_symbol.js";
import { registerReplaceSymbolBody } from "./tools/replace_symbol_body.js";
import { registerScaffoldClass } from "./tools/scaffold_class.js";
import { registerSearchSymbols } from "./tools/search_symbols.js";

const packageMetadata = createRequire(import.meta.url)("../package.json") as { version: string };
export const PACKAGE_VERSION = packageMetadata.version;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "ast-mcp-server",
    version: PACKAGE_VERSION,
  });
  registerListFiles(server);
  registerGetOutline(server);
  registerGetSymbolSource(server);
  registerSearchSymbols(server);
  registerFindReferences(server);
  registerGetDiagnostics(server);
  registerRenameSymbol(server);
  registerReplaceSymbolBody(server);
  registerScaffoldClass(server);
  registerGetOperationPreview(server);
  registerApplyOperation(server);
  return server;
}
