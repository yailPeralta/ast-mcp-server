import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Node } from "ts-morph";
import { z } from "zod";
import { PaginationInputSchema, PaginationOutputSchema, paginate } from "../services/pagination.js";
import { findDeclarationByName, getSourceFileOrThrow, withProject } from "../services/project.js";
import { errorResult, formattedResult, ToolOutputFormatInputSchema } from "./result.js";

const AstFindReferencesInputSchema = z.object({
  project_root: z
    .string()
    .describe("Absolute project directory containing tsconfig.json, or the config path."),
  file_path: z.string().describe("File containing the declaration."),
  symbol_path: z.string().describe("Exact symbol path returned by an outline or symbol search."),
  include_declaration: z.boolean().default(true),
  ...ToolOutputFormatInputSchema,
  ...PaginationInputSchema,
});

const ReferenceSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  kind: z.string(),
  is_declaration: z.boolean(),
  context: z.string(),
});

const AstFindReferencesOutputSchema = z.object({
  symbol: z.string(),
  declaration_count: z.number().int().min(0),
  reference_count: z.number().int().min(0),
  affected_files: z.array(z.string()),
  references: z.array(ReferenceSchema),
  ...PaginationOutputSchema,
});

export function registerFindReferences(server: McpServer): void {
  server.registerTool(
    "ast_find_references",
    {
      title: "Find semantic symbol references",
      description:
        "Finds type-resolved references and returns bounded project-relative locations, including declaration impact by default.",
      inputSchema: AstFindReferencesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      project_root,
      file_path,
      symbol_path,
      include_declaration,
      output_format,
      offset,
      limit,
    }) => {
      try {
        const structuredContent = await withProject(project_root, ({ project, projectRoot }) => {
          const sourceFile = getSourceFileOrThrow(project, file_path);
          const node = findDeclarationByName(sourceFile, symbol_path);
          if (!Node.isReferenceFindable(node)) {
            throw new Error(
              `Symbol "${symbol_path}" (${node.getKindName()}) does not support semantic reference search.`,
            );
          }

          const lineCache = new Map<string, string[]>();
          const location = (referenceNode: Node, isDeclaration: boolean) => {
            const referenceSource = referenceNode.getSourceFile();
            const absoluteFile = referenceSource.getFilePath();
            let lines = lineCache.get(absoluteFile);
            if (!lines) {
              lines = referenceSource.getFullText().split(/\r?\n/);
              lineCache.set(absoluteFile, lines);
            }
            const position = referenceSource.getLineAndColumnAtPos(referenceNode.getStart());
            return {
              file: path.relative(projectRoot, absoluteFile),
              line: position.line,
              column: position.column,
              kind: referenceNode.getParent()?.getKindName() ?? referenceNode.getKindName(),
              is_declaration: isDeclaration,
              context: (lines[position.line - 1] ?? "").trim().slice(0, 500),
            };
          };

          const references = node
            .findReferencesAsNodes()
            .map((reference) => location(reference, false));
          const declaration = location(node, true);
          const allLocations = include_declaration ? [declaration, ...references] : references;
          allLocations.sort((left, right) =>
            `${left.file}:${left.line}:${left.column}:${left.is_declaration ? 0 : 1}`.localeCompare(
              `${right.file}:${right.line}:${right.column}:${right.is_declaration ? 0 : 1}`,
            ),
          );
          const affectedFiles = [
            ...new Set([declaration, ...references].map((item) => item.file)),
          ].sort();
          const page = paginate(allLocations, offset, limit);
          const { items, ...metadata } = page;
          return {
            symbol: symbol_path,
            declaration_count: 1,
            reference_count: references.length,
            affected_files: affectedFiles,
            references: items,
            ...metadata,
          };
        });
        return formattedResult(AstFindReferencesOutputSchema, structuredContent, output_format);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
