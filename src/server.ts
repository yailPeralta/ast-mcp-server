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
import { registerSearchSymbols } from "./tools/search_symbols.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "ast-mcp-server",
    version: "0.3.0",
  });
  registerListFiles(server);
  registerGetOutline(server);
  registerGetSymbolSource(server);
  registerSearchSymbols(server);
  registerFindReferences(server);
  registerGetDiagnostics(server);
  registerRenameSymbol(server);
  registerReplaceSymbolBody(server);
  registerGetOperationPreview(server);
  registerApplyOperation(server);
  return server;
}
