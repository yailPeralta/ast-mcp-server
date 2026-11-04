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

export interface DeclaredContracts {
  baseline: string;
  tools: Record<string, ToolContract>;
}

export interface ContractFailure {
  tool: string;
  field: string;
  reason: string;
}

export interface ContractComparison {
  ok: boolean;
  failures: ContractFailure[];
}

/** Accepts untrusted input: malformed catalogs or declarations become failures, never throws. */
export function compareToolContracts(input: {
  publicTools: unknown;
  candidateTools: unknown;
  declared: unknown;
  baselineVersion: string;
}): ContractComparison;
