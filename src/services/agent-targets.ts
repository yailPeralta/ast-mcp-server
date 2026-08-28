import { toolCatalog } from "../tools/catalog.js";

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
  | { status: "missing" | "current" | "repairable"; detail?: undefined }
  | { status: "conflict" | "blocked_untrusted_folder"; detail: string }
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
  unregister(runtime: AgentTargetRuntime): Promise<AgentTargetCommandResult>;
  registerLegacy(
    runtime: AgentTargetRuntime,
    context: AgentTargetMcpContext,
  ): Promise<AgentTargetCommandResult>;
  registrationAccepted(result: AgentTargetCommandResult): boolean;
  removalAccepted(result: AgentTargetCommandResult): boolean;
}

export type SkillTarget = "claude" | "hermes" | "agents";
export interface AgentTargetDefinition {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly skillTarget: SkillTarget;
  readonly mcp: AgentTargetMcpAdapter;
}

export type Compatibility =
  | { status: "compatible"; contract: string; version: string }
  | { status: "incompatible"; reason: string };

export const MCP_SERVER_NAME = "ast";
const EXPECTED_TOOLS = toolCatalog.compatibility.required;
const APPLY_TOOL = "ast_apply_operation";
/** Ambient agent surfaces opt into the apply-effect tool (fail-closed guard default is deny). */
const APPLY_GUARD_ALLOW_ENV = "AST_MCP_APPLY_GUARD=allow";

function semver(value: string): [number, number, number] | undefined {
  const match = value.match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?=\s|$|[-+()]|\.(?:\s|$))/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function atLeast(value: [number, number, number], minimum: [number, number, number]): boolean {
  return (
    value[0] > minimum[0] ||
    (value[0] === minimum[0] &&
      (value[1] > minimum[1] || (value[1] === minimum[1] && value[2] >= minimum[2])))
  );
}

export function classifyAgentVersion(id: AgentTargetId, output: string): Compatibility {
  const version = semver(output);
  if (!version)
    return {
      status: "incompatible",
      reason: "Version output does not match an admitted contract.",
    };
  if (id === "opencode" && !atLeast(version, [1, 18, 18])) {
    return { status: "incompatible", reason: "OpenCode 1.18.18 or newer is required." };
  }
  return { status: "compatible", contract: `${id}-mcp-v1`, version: version.join(".") };
}

function expected(context: AgentTargetMcpContext, command: unknown, args: unknown): boolean {
  return (
    command === context.nodeExecutable &&
    Array.isArray(args) &&
    args.length === 1 &&
    args[0] === context.serverEntryPath
  );
}

function structuredGuardStatus(...values: unknown[]): "current" | "repairable" | "conflict" {
  const provided = values.filter((value) => value !== undefined);
  if (provided.length === 0) return "repairable";
  const records = provided.filter(
    (value): value is Record<string, unknown> =>
      value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return records.length === provided.length &&
    records.length === 1 &&
    Object.keys(records[0]).length === 1 &&
    records[0].AST_MCP_APPLY_GUARD === "allow"
    ? "current"
    : "conflict";
}

function matchingRegistration(
  hasExpectedCommand: boolean,
  guardStatus: "current" | "repairable" | "conflict",
) {
  if (!hasExpectedCommand) {
    return {
      status: "conflict" as const,
      detail: "The existing 'ast' registration does not match this package.",
    };
  }
  return guardStatus === "conflict"
    ? {
        status: "conflict" as const,
        detail: "The existing 'ast' registration has unsupported environment settings.",
      }
    : { status: guardStatus };
}

function parseJson(result: AgentTargetCommandResult): unknown {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

function structuredInspection(
  result: AgentTargetCommandResult,
  context: AgentTargetMcpContext,
): AgentTargetMcpInspection {
  if (result.exitCode !== 0) {
    return /(?:not found|no mcp server)/i.test(`${result.stdout}\n${result.stderr}`)
      ? { status: "missing" }
      : { status: "error", operation: "MCP inspection", result };
  }
  const value = parseJson(result) as Record<string, unknown> | undefined;
  if (!value || value.name !== MCP_SERVER_NAME)
    return { status: "error", operation: "MCP inspection", result };
  const transport = (value.transport ?? value) as Record<string, unknown>;
  return matchingRegistration(
    transport.type === "stdio" && expected(context, transport.command, transport.args),
    structuredGuardStatus(transport.env, transport.environment),
  );
}

function copilotStructuredInspection(
  result: AgentTargetCommandResult,
  context: AgentTargetMcpContext,
): AgentTargetMcpInspection {
  if (result.exitCode !== 0) {
    return /(?:not found|no mcp server)/i.test(`${result.stdout}\n${result.stderr}`)
      ? { status: "missing" }
      : { status: "error", operation: "MCP inspection", result };
  }
  const value = parseJson(result) as Record<string, unknown> | undefined;
  const server = value?.[MCP_SERVER_NAME];
  if (server === null || typeof server !== "object" || Array.isArray(server)) {
    return { status: "error", operation: "MCP inspection", result };
  }
  const configuration = server as Record<string, unknown>;
  const matches =
    configuration.type === "local" &&
    configuration.source === "user" &&
    configuration.enabled === true &&
    Array.isArray(configuration.tools) &&
    configuration.tools.length === 1 &&
    configuration.tools[0] === "*" &&
    expected(context, configuration.command, configuration.args);
  const inspection = matchingRegistration(
    matches,
    structuredGuardStatus(configuration.env, configuration.environment),
  );
  return inspection.status === "conflict"
    ? {
        ...inspection,
        detail: "The existing user-scoped 'ast' registration does not match this package.",
      }
    : inspection;
}

function claudeRegister(
  runtime: AgentTargetRuntime,
  context: AgentTargetMcpContext,
  guarded: boolean,
) {
  return runtime.run([
    "mcp",
    "add",
    "--scope",
    "user",
    ...(guarded ? ["--env", APPLY_GUARD_ALLOW_ENV] : []),
    "--transport",
    "stdio",
    MCP_SERVER_NAME,
    "--",
    context.nodeExecutable,
    context.serverEntryPath,
  ]);
}

const claudeMcp: AgentTargetMcpAdapter = {
  async inspect(runtime, context) {
    const result = await runtime.run(["mcp", "get", MCP_SERVER_NAME]);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.exitCode !== 0)
      return /no\s+mcp\s+server.*ast/i.test(output)
        ? { status: "missing" }
        : { status: "error", operation: "MCP inspection", result };
    const fields = new Map<string, string>();
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = line.match(/^\s*(Scope|Status|Type|Command|Args):\s*(.*)$/i);
      if (match) fields.set(match[1].toLowerCase(), match[2].trim());
    }
    const matches =
      /^user config\b/i.test(fields.get("scope") ?? "") &&
      /connected/i.test(fields.get("status") ?? "") &&
      fields.get("type")?.toLowerCase() === "stdio" &&
      expected(context, fields.get("command"), [fields.get("args")]);
    const hasEnvironment = /^\s*Environment:\s*$/im.test(result.stdout);
    const inspection = matchingRegistration(
      matches,
      /(?:^|\s)AST_MCP_APPLY_GUARD\s*=\s*allow(?:\s|$)/m.test(result.stdout)
        ? "current"
        : hasEnvironment
          ? "conflict"
          : "repairable",
    );
    return inspection.status === "conflict"
      ? {
          ...inspection,
          detail: "The existing user-scoped 'ast' registration does not match this package.",
        }
      : inspection;
  },
  register: (runtime, context) => claudeRegister(runtime, context, true),
  unregister: (runtime) => runtime.run(["mcp", "remove", MCP_SERVER_NAME, "--scope", "user"]),
  registerLegacy: (runtime, context) => claudeRegister(runtime, context, false),
  registrationAccepted: (result) => result.exitCode === 0,
  removalAccepted: (result) => result.exitCode === 0,
};

function hermesRegister(
  runtime: AgentTargetRuntime,
  context: AgentTargetMcpContext,
  guarded: boolean,
) {
  return runtime.run(
    [
      "mcp",
      "add",
      MCP_SERVER_NAME,
      "--command",
      context.nodeExecutable,
      ...(guarded ? ["--env", APPLY_GUARD_ALLOW_ENV] : []),
      "--args",
      context.serverEntryPath,
    ],
    "\n",
  );
}

const hermesMcp: AgentTargetMcpAdapter = {
  async inspect(runtime, context) {
    const listed = await runtime.run(["mcp", "list"]);
    if (listed.exitCode !== 0) return { status: "error", operation: "MCP list", result: listed };
    if (!/^\s*ast(?:\s|$)/im.test(listed.stdout)) return { status: "missing" };
    const configured = await runtime.run(["config", "get", "mcp_servers.ast", "--json"]);
    const registration = parseJson(configured) as Record<string, unknown> | undefined;
    if (
      configured.exitCode !== 0 ||
      !registration ||
      Array.isArray(registration) ||
      !expected(context, registration.command, registration.args)
    ) {
      return {
        status: "conflict",
        detail: "The existing 'ast' registration cannot be authenticated as this package.",
      };
    }
    const guardStatus = structuredGuardStatus(registration.env);
    const admittedKeys =
      guardStatus === "repairable" ? ["args", "command"] : ["args", "command", "env"];
    if (
      guardStatus === "conflict" ||
      Object.keys(registration).sort().join(",") !== admittedKeys.join(",")
    ) {
      return {
        status: "conflict",
        detail: "The existing 'ast' registration has unsupported configuration.",
      };
    }
    const tested = await runtime.run(["mcp", "test", MCP_SERVER_NAME]);
    const expectedWithoutApply = EXPECTED_TOOLS.filter((tool) => tool !== APPLY_TOOL);
    if (
      tested.exitCode === 0 &&
      expectedWithoutApply.every((tool) => tested.stdout.includes(tool))
    ) {
      const applyPresent =
        !EXPECTED_TOOLS.includes(APPLY_TOOL) || tested.stdout.includes(APPLY_TOOL);
      return guardStatus === "current" && applyPresent
        ? { status: "current" }
        : guardStatus === "repairable" && !tested.stdout.includes(APPLY_TOOL)
          ? { status: "repairable" }
          : {
              status: "conflict",
              detail: "The existing 'ast' registration tool surface contradicts its configuration.",
            };
    }
    return {
      status: "conflict",
      detail: "The existing 'ast' registration does not expose the expected structural tools.",
    };
  },
  register: (runtime, context) => hermesRegister(runtime, context, true),
  unregister: (runtime) => runtime.run(["mcp", "remove", MCP_SERVER_NAME]),
  registerLegacy: (runtime, context) => hermesRegister(runtime, context, false),
  registrationAccepted: (result) => result.exitCode === 0 && /saved\s+'ast'/i.test(result.stdout),
  removalAccepted: (result) => result.exitCode === 0,
};

function separatorRegister(
  runtime: AgentTargetRuntime,
  context: AgentTargetMcpContext,
  guarded: boolean,
) {
  return runtime.run([
    "mcp",
    "add",
    MCP_SERVER_NAME,
    ...(guarded ? ["--env", APPLY_GUARD_ALLOW_ENV] : []),
    "--",
    context.nodeExecutable,
    context.serverEntryPath,
  ]);
}

const codexMcp: AgentTargetMcpAdapter = {
  async inspect(runtime, context) {
    return structuredInspection(
      await runtime.run(["mcp", "get", MCP_SERVER_NAME, "--json"]),
      context,
    );
  },
  register: (runtime, context) => separatorRegister(runtime, context, true),
  unregister: (runtime) => runtime.run(["mcp", "remove", MCP_SERVER_NAME]),
  registerLegacy: (runtime, context) => separatorRegister(runtime, context, false),
  registrationAccepted: (result) => result.exitCode === 0,
  removalAccepted: (result) => result.exitCode === 0,
};

const copilotMcp: AgentTargetMcpAdapter = {
  async inspect(runtime, context) {
    return copilotStructuredInspection(
      await runtime.run(["mcp", "get", MCP_SERVER_NAME, "--json"]),
      context,
    );
  },
  register: (runtime, context) => separatorRegister(runtime, context, true),
  unregister: (runtime) => runtime.run(["mcp", "remove", MCP_SERVER_NAME]),
  registerLegacy: (runtime, context) => separatorRegister(runtime, context, false),
  registrationAccepted: (result) => result.exitCode === 0,
  removalAccepted: (result) => result.exitCode === 0,
};

function geminiRegister(
  runtime: AgentTargetRuntime,
  context: AgentTargetMcpContext,
  guarded: boolean,
) {
  return runtime.run([
    "mcp",
    "add",
    MCP_SERVER_NAME,
    ...(guarded ? ["--env", APPLY_GUARD_ALLOW_ENV] : []),
    context.nodeExecutable,
    context.serverEntryPath,
    "--scope",
    "user",
  ]);
}

const geminiMcp: AgentTargetMcpAdapter = {
  async inspect(runtime, context) {
    const result = await runtime.run(["mcp", "list"]);
    const output = `${result.stdout}\n${result.stderr}`;
    if (
      /MCP servers are disabled in untrusted folders\. Trust this folder to continue\./i.test(
        output,
      )
    ) {
      return {
        status: "blocked_untrusted_folder",
        detail: "Trust the working folder in Gemini CLI and retry.",
      };
    }
    if (result.exitCode !== 0) return { status: "error", operation: "MCP list", result };
    if (/No MCP servers configured\./i.test(result.stdout)) return { status: "missing" };
    const pattern = /ast[^\n]*Connected[^\n]*command:\s*([^,\n]+),\s*args:\s*\[([^\]]*)\]/i;
    const match = result.stdout.match(pattern);
    if (!match) return { status: "error", operation: "MCP inspection", result };
    const matches = expected(
      context,
      match[1]?.trim(),
      match[2]?.split(",").map((item) => item.trim()),
    );
    const inspection = matchingRegistration(
      matches,
      /(?:^|\s|,)AST_MCP_APPLY_GUARD\s*=\s*allow(?:\s|$|,)/m.test(result.stdout)
        ? "current"
        : /\benv(?:ironment)?\s*:/i.test(result.stdout)
          ? "conflict"
          : "repairable",
    );
    return inspection.status === "conflict"
      ? {
          status: "conflict",
          detail: "The existing Gemini 'ast' registration does not match this package.",
        }
      : inspection;
  },
  register: (runtime, context) => geminiRegister(runtime, context, true),
  unregister: (runtime) => runtime.run(["mcp", "remove", MCP_SERVER_NAME, "--scope", "user"]),
  registerLegacy: (runtime, context) => geminiRegister(runtime, context, false),
  registrationAccepted: (result) => result.exitCode === 0,
  removalAccepted: (result) => result.exitCode === 0,
};

const opencodeMcp: AgentTargetMcpAdapter = {
  async inspect() {
    return {
      status: "error",
      operation: "OpenCode configuration inspection",
      result: {
        exitCode: 1,
        stdout: "",
        stderr: "OpenCode uses the routed configuration adapter.",
      },
    };
  },
  async register() {
    return { exitCode: 1, stdout: "", stderr: "OpenCode CLI registration is disabled." };
  },
  async unregister() {
    return { exitCode: 1, stdout: "", stderr: "OpenCode CLI removal is disabled." };
  },
  async registerLegacy() {
    return { exitCode: 1, stdout: "", stderr: "OpenCode CLI registration is disabled." };
  },
  registrationAccepted: () => false,
  removalAccepted: () => false,
};

export const AGENT_TARGETS = [
  { id: "claude", label: "Claude Code", command: "claude", skillTarget: "claude", mcp: claudeMcp },
  { id: "hermes", label: "Hermes", command: "hermes", skillTarget: "hermes", mcp: hermesMcp },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    skillTarget: "agents",
    mcp: opencodeMcp,
  },
  { id: "codex", label: "Codex CLI", command: "codex", skillTarget: "agents", mcp: codexMcp },
  { id: "gemini", label: "Gemini CLI", command: "gemini", skillTarget: "agents", mcp: geminiMcp },
  {
    id: "copilot",
    label: "GitHub Copilot CLI",
    command: "copilot",
    skillTarget: "agents",
    mcp: copilotMcp,
  },
] as const satisfies readonly AgentTargetDefinition[];

export type AgentTargetId = (typeof AGENT_TARGETS)[number]["id"];
export const AGENT_IDS = AGENT_TARGETS.map((target) => target.id) as readonly AgentTargetId[];
export function getAgentTarget(id: AgentTargetId): (typeof AGENT_TARGETS)[number] {
  const target = AGENT_TARGETS.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unsupported agent target: ${id}`);
  return target;
}

export async function inspectAgentFixture(
  id: AgentTargetId,
  results: AgentTargetCommandResult[],
  context: AgentTargetMcpContext,
): Promise<AgentTargetMcpInspection> {
  let index = 0;
  return getAgentTarget(id).mcp.inspect(
    {
      run: async () =>
        results[index++] ?? { exitCode: 1, stdout: "", stderr: "Missing fixture result." },
    },
    context,
  );
}
