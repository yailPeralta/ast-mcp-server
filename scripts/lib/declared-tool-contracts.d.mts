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

export type ContractField =
  "baseline" | "catalog" | "declaration" | "description" | "input_schema" | "additionalProperties";

export type ContractReason =
  | "baseline_mismatch"
  | "names_differ"
  | "malformed"
  | "unknown_tool"
  | "reserved_tool"
  | "drift_from_public"
  | "stale_equals_public"
  | "mismatch_declaration"
  | "loosened";

/** `tool` is "*" for whole-catalog failures. */
export interface ContractFailure {
  tool: string;
  field: ContractField;
  reason: ContractReason;
}

export interface ToolContractEvidence {
  status: "undeclared" | "declared";
  publicSha256: string;
  candidateSha256: string;
  declaredSha256?: string;
}

export interface ContractComparison {
  ok: boolean;
  /** Sorted by tool, then field, then reason. */
  failures: ContractFailure[];
  tools: Record<string, ToolContractEvidence>;
  /** Digest of the undeclared, non-reserved tools on each side; null when the input is malformed. */
  undeclaredSha256: { public: string | null; candidate: string | null };
}

/** Accepts untrusted input: malformed catalogs or declarations become failures, never throws. */
export function compareToolContracts(input: {
  publicTools: unknown;
  candidateTools: unknown;
  declared: unknown;
  baselineVersion: string;
}): ContractComparison;

export function formatContractFailures(failures: readonly ContractFailure[]): string;
