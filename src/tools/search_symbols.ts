import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildFileOutline } from "../services/outline.js";
import { PaginationInputSchema, PaginationOutputSchema, paginate } from "../services/pagination.js";
import { withProject } from "../services/project.js";
import { collectSymbols } from "../services/symbols.js";
import { errorResult, structuredResult } from "./result.js";

const AstSearchSymbolsInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
  query: z
    .string()
    .min(1)
    .describe("Case-insensitive substring matched against name and symbol path."),
  kinds: z
    .array(z.string())
    .optional()
    .describe(
      "Optional exact ts-morph syntax kinds, such as ClassDeclaration or MethodDeclaration.",
    ),
  file_filter: z
    .string()
    .optional()
    .describe("Optional case-insensitive substring matched against project-relative file paths."),
  ...PaginationInputSchema,
});

const SearchSymbolSchema = z.object({
  file: z.string(),
  symbol_path: z.string(),
  selector: z.string(),
  name: z.string(),
  kind: z.string(),
  line: z.number().int().positive(),
  signature: z.string(),
});

const AstSearchSymbolsOutputSchema = z.object({
  symbols: z.array(SearchSymbolSchema),
  duration_ms: z.number().min(0),
  ...PaginationOutputSchema,
});

export function registerSearchSymbols(server: McpServer): void {
  server.registerTool(
    "ast_search_symbols",
    {
      title: "Search project symbols",
      description:
        "Searches declarations structurally and returns exact file/symbol selectors that can be passed to the other AST tools.",
      inputSchema: AstSearchSymbolsInputSchema,
      outputSchema: AstSearchSymbolsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_root, query, kinds, file_filter, offset, limit }) => {
      try {
        const structuredContent = await withProject(project_root, ({ project, projectRoot }) => {
          const startedAt = performance.now();
          const normalizedQuery = query.toLowerCase();
          const normalizedFileFilter = file_filter?.toLowerCase();
          const kindSet = kinds ? new Set(kinds) : undefined;
          const matches: Array<{
            file: string;
            symbol_path: string;
            selector: string;
            name: string;
            kind: string;
            line: number;
            signature: string;
          }> = [];

          for (const sourceFile of project.getSourceFiles()) {
            const file = path.relative(projectRoot, sourceFile.getFilePath());
            if (normalizedFileFilter && !file.toLowerCase().includes(normalizedFileFilter)) {
              continue;
            }

            const matchingSymbols = collectSymbols(sourceFile).filter(
              (symbol) =>
                (!kindSet || kindSet.has(symbol.kind)) &&
                (symbol.name.toLowerCase().includes(normalizedQuery) ||
                  symbol.symbolPath.toLowerCase().includes(normalizedQuery)),
            );
            if (matchingSymbols.length === 0) continue;

            const signatures = new Map(
              buildFileOutline(sourceFile).symbols.map((symbol) => [
                `${symbol.symbolPath}@${symbol.startLine}`,
                symbol.signature,
              ]),
            );
            for (const symbol of matchingSymbols) {
              matches.push({
                file,
                symbol_path: symbol.symbolPath,
                selector: `${symbol.symbolPath}@${symbol.line}`,
                name: symbol.name,
                kind: symbol.kind,
                line: symbol.line,
                signature:
                  signatures.get(`${symbol.symbolPath}@${symbol.line}`) ?? symbol.node.getText(),
              });
            }
          }

          matches.sort((left, right) =>
            `${left.file}:${left.line}:${left.symbol_path}`.localeCompare(
              `${right.file}:${right.line}:${right.symbol_path}`,
            ),
          );
          const page = paginate(matches, offset, limit);
          const { items, ...metadata } = page;
          return {
            symbols: items,
            duration_ms: performance.now() - startedAt,
            ...metadata,
          };
        });
        return structuredResult(structuredContent);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
