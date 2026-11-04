export type JsonSchema = Record<string, unknown>;

export interface ToolContract {
  description: string;
  input_schema: JsonSchema;
}

export interface ToolSurface {
  description: string;
  parameters: JsonSchema;
}

export const RESERVED_TOOL_NAMES: readonly string[];

export function semanticSchema(node: unknown, root?: unknown): unknown;
export function contractFromTool(tool: {
  description: string;
  inputSchema: JsonSchema;
}): ToolContract;
export function toolContractSha256(name: string, tool: ToolSurface): string;
