export interface AgentTargetCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AgentTargetRuntime {
  run(args: readonly string[], input?: string): Promise<AgentTargetCommandResult>;
}

export interface AgentTargetMcpContext {
  serverEntryPath: string;
  nodeExecutable: string;
}

export type AgentTargetMcpInspection =
  | { status: "missing" | "current"; detail?: undefined }
  | { status: "conflict"; detail: string }
  | { status: "error"; operation: string; result: AgentTargetCommandResult };

export interface AgentTargetMcpAdapter {
  inspect(
    runtime: AgentTargetRuntime,
    context: AgentTargetMcpContext,
  ): Promise<AgentTargetMcpInspection>;
  register(
    runtime: AgentTargetRuntime,
    context: AgentTargetMcpContext,
  ): Promise<AgentTargetCommandResult>;
  registrationAccepted(result: AgentTargetCommandResult): boolean;
}

export interface AgentTargetDefinition {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly skillTarget: "claude" | "hermes";
  readonly mcp: AgentTargetMcpAdapter;
}

export const MCP_SERVER_NAME = "ast";

const EXPECTED_HERMES_TOOLS = [
  "ast_list_files",
  "ast_get_outline",
  "ast_get_symbol_source",
  "ast_search_symbols",
  "ast_find_references",
  "ast_get_diagnostics",
  "ast_rename_symbol",
  "ast_replace_symbol_body",
  "ast_scaffold_class",
  "ast_get_operation_preview",
  "ast_apply_operation",
] as const;

function isMissingClaudeMcp(output: string): boolean {
  return (
    /\bno\s+mcp\s+server\b/i.test(output) &&
    /(?:\bfound\b|\bnamed?\b)/i.test(output) &&
    /\bast\b/i.test(output)
  );
}

function inspectClaudeFields(stdout: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(Status|Type|Command|Args):\s*(.*)$/i);
    if (match !== null) fields.set(match[1].toLowerCase(), match[2].trim());
  }
  return fields;
}

const claudeMcp: AgentTargetMcpAdapter = {
  async inspect(runtime, context) {
    const result = await runtime.run(["mcp", "get", MCP_SERVER_NAME]);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.exitCode !== 0) {
      return isMissingClaudeMcp(output)
        ? { status: "missing" }
        : { status: "error", operation: "MCP inspection", result };
    }

    const fields = inspectClaudeFields(result.stdout);
    const current =
      /connected/i.test(fields.get("status") ?? "") &&
      fields.get("type")?.toLowerCase() === "stdio" &&
      fields.get("command") === context.nodeExecutable &&
      fields.get("args") === context.serverEntryPath;
    return current
      ? { status: "current" }
      : {
          status: "conflict",
          detail: "The existing user-scoped 'ast' registration does not match this package.",
        };
  },

  register(runtime, context) {
    return runtime.run([
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "stdio",
      MCP_SERVER_NAME,
      "--",
      context.nodeExecutable,
      context.serverEntryPath,
    ]);
  },

  registrationAccepted(result) {
    return result.exitCode === 0;
  },
};

const hermesMcp: AgentTargetMcpAdapter = {
  async inspect(runtime) {
    const listed = await runtime.run(["mcp", "list"]);
    if (listed.exitCode !== 0) {
      return { status: "error", operation: "MCP list", result: listed };
    }
    if (!/^\s*ast(?:\s|$)/im.test(listed.stdout)) return { status: "missing" };

    const tested = await runtime.run(["mcp", "test", MCP_SERVER_NAME]);
    const current =
      tested.exitCode === 0 && EXPECTED_HERMES_TOOLS.every((tool) => tested.stdout.includes(tool));
    return current
      ? { status: "current" }
      : {
          status: "conflict",
          detail: "The existing 'ast' registration does not expose the expected structural tools.",
        };
  },

  register(runtime, context) {
    return runtime.run(
      [
        "mcp",
        "add",
        MCP_SERVER_NAME,
        "--command",
        context.nodeExecutable,
        "--args",
        context.serverEntryPath,
      ],
      "\n",
    );
  },

  registrationAccepted(result) {
    return result.exitCode === 0 && /saved\s+'ast'/i.test(result.stdout);
  },
};

export const AGENT_TARGETS = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    skillTarget: "claude",
    mcp: claudeMcp,
  },
  {
    id: "hermes",
    label: "Hermes",
    command: "hermes",
    skillTarget: "hermes",
    mcp: hermesMcp,
  },
] as const satisfies readonly AgentTargetDefinition[];

export type AgentTargetId = (typeof AGENT_TARGETS)[number]["id"];

export const AGENT_IDS = AGENT_TARGETS.map((target) => target.id) as readonly AgentTargetId[];

export function getAgentTarget(id: AgentTargetId): (typeof AGENT_TARGETS)[number] {
  const target = AGENT_TARGETS.find((candidate) => candidate.id === id);
  if (target === undefined) throw new Error(`Unsupported agent target: ${id}`);
  return target;
}
