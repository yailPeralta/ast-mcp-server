import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildFileOutline } from "../services/outline.js";
import {
  createPaginationInputSchema,
  PaginationOutputSchema,
  paginate,
} from "../services/pagination.js";
import { withProject } from "../services/project.js";
import { collectSymbols, symbolMatchRank } from "../services/symbols.js";
import { errorResult, formattedResult, ToolOutputFormatInputSchema } from "./result.js";

const SEARCH_DEFAULT_LIMIT = 20;
const SearchDetailSchema = z.enum(["selectors", "summary", "full"]).default("summary");

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
  detail: SearchDetailSchema.describe(
    "Result detail: selectors for routing, summary adds signatures, full adds redundant declaration fields.",
  ),
  ...ToolOutputFormatInputSchema,
  ...createPaginationInputSchema(SEARCH_DEFAULT_LIMIT),
});

const FullSearchSymbolSchema = z.object({
  file: z.string(),
  symbol_path: z.string(),
  selector: z.string(),
  name: z.string(),
  kind: z.string(),
  line: z.number().int().positive(),
  signature: z.string(),
});

const SelectorSearchSymbolSchema = FullSearchSymbolSchema.pick({
  file: true,
  selector: true,
  kind: true,
});
const SummarySearchSymbolSchema = FullSearchSymbolSchema.pick({
  file: true,
  selector: true,
  kind: true,
  signature: true,
});

const SearchOutputSchemas = {
  selectors: z.object({
    symbols: z.array(SelectorSearchSymbolSchema),
    duration_ms: z.number().min(0),
    ...PaginationOutputSchema,
  }),
  summary: z.object({
    symbols: z.array(SummarySearchSymbolSchema),
    duration_ms: z.number().min(0),
    ...PaginationOutputSchema,
  }),
  full: z.object({
    symbols: z.array(FullSearchSymbolSchema),
    duration_ms: z.number().min(0),
    ...PaginationOutputSchema,
  }),
} as const;

type FullSearchSymbol = z.infer<typeof FullSearchSymbolSchema>;
type SearchDetail = z.infer<typeof SearchDetailSchema>;

function projectSymbols(detail: SearchDetail, symbols: FullSearchSymbol[]) {
  if (detail === "full") return symbols;
  if (detail === "summary") {
    return symbols.map(({ file, selector, kind, signature }) => ({
      file,
      selector,
      kind,
      signature,
    }));
  }
  return symbols.map(({ file, selector, kind }) => ({ file, selector, kind }));
}

export function registerSearchSymbols(server: McpServer): void {
  server.registerTool(
    "ast_search_symbols",
    {
      title: "Search project symbols",
      description:
        "Ranks structural declarations and returns exact file/symbol selectors for downstream AST tools.",
      inputSchema: AstSearchSymbolsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_root, query, kinds, file_filter, detail, output_format, offset, limit }) => {
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

            const matchingSymbols = collectSymbols(sourceFile).filter((symbol) => {
              const selector = `${symbol.symbolPath}@${symbol.line}`.toLowerCase();
              return (
                (!kindSet || kindSet.has(symbol.kind)) &&
                (symbol.name.toLowerCase().includes(normalizedQuery) ||
                  symbol.symbolPath.toLowerCase().includes(normalizedQuery) ||
                  selector.includes(normalizedQuery))
              );
            });
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

          matches.sort((left, right) => {
            const rank =
              symbolMatchRank(query, {
                symbolPath: left.symbol_path,
                name: left.name,
                line: left.line,
              }) -
              symbolMatchRank(query, {
                symbolPath: right.symbol_path,
                name: right.name,
                line: right.line,
              });
            if (rank !== 0) return rank;
            return (
              left.file.localeCompare(right.file) ||
              left.line - right.line ||
              left.symbol_path.localeCompare(right.symbol_path) ||
              left.kind.localeCompare(right.kind)
            );
          });
          const page = paginate(matches, offset, limit);
          const { items, ...metadata } = page;
          return {
            symbols: projectSymbols(detail, items),
            duration_ms: performance.now() - startedAt,
            ...metadata,
          };
        });
        const outputSchema = SearchOutputSchemas[detail] as z.ZodType<Record<string, unknown>>;
        return formattedResult(outputSchema, structuredContent, output_format);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
