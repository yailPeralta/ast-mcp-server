import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  installBundledSkill,
  SkillConflictError,
  type SkillInstallation,
  type SkillTargetSelection,
} from "./skill-installer.js";
import { type AgentDetection, type AgentId } from "./setup-wizard.js";
import {
  AGENT_IDS,
  getAgentTarget,
  MCP_SERVER_NAME,
  type AgentTargetRuntime,
} from "./agent-targets.js";

export type { AgentDetection } from "./setup-wizard.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface McpInspection {
  agent: AgentId;
  status: "missing" | "current" | "conflict";
  detail?: string;
}

export interface DetectInstalledAgentsOptions {
  environment?: NodeJS.ProcessEnv;
  commandTimeoutMs?: number;
}

export interface RunAgentSetupOptions {
  agents: readonly AgentId[];
  detections: readonly AgentDetection[];
  sourceSkillPath: string;
  serverEntryPath: string;
  environment?: NodeJS.ProcessEnv;
  nodeExecutable?: string;
  forceSkill?: boolean;
  commandTimeoutMs?: number;
}

export interface AgentSetupItem {
  agent: AgentId;
  executable: string;
  version?: string;
  mcp: "configured" | "unchanged";
  skill: SkillInstallation["status"];
}

export interface AgentSetupResult {
  status: "ok";
  command: "setup";
  server: {
    name: typeof MCP_SERVER_NAME;
    command: string;
    args: [string];
  };
  agents: AgentSetupItem[];
}

export class AgentSetupError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "AgentSetupError";
    this.code = code;
    this.details = details;
  }
}

function environmentPath(environment: NodeJS.ProcessEnv): string {
  return environment.PATH ?? environment.Path ?? environment.path ?? "";
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const candidateStat = await stat(candidate);
    if (!candidateStat.isFile()) {
      return false;
    }
    if (process.platform !== "win32") {
      await access(candidate, fsConstants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(
  command: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const extensions =
    process.platform === "win32"
      ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];

  for (const directory of environmentPath(environment).split(path.delimiter)) {
    if (directory === "") {
      continue;
    }
    for (const extension of extensions) {
      const candidate = path.resolve(directory, `${command}${extension}`);
      if (await isExecutableFile(candidate)) {
        return realpath(candidate);
      }
    }
  }
  return undefined;
}

async function runCommand(
  executable: string,
  args: string[],
  options: {
    environment: NodeJS.ProcessEnv;
    timeoutMs: number;
    input?: string;
  },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: options.environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;

    const finishWithError = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGKILL");
      reject(error);
    };
    const appendOutput = (target: "stdout" | "stderr", chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        finishWithError(
          new AgentSetupError(
            `Agent command exceeded ${MAX_COMMAND_OUTPUT_BYTES} output bytes.`,
            "AGENT_COMMAND_OUTPUT_LIMIT",
            { executable, args },
          ),
        );
        return;
      }
      if (target === "stdout") {
        stdout += chunk.toString("utf8");
      } else {
        stderr += chunk.toString("utf8");
      }
    };

    const timeout = setTimeout(() => {
      finishWithError(
        new AgentSetupError(
          `Agent command timed out after ${options.timeoutMs}ms.`,
          "AGENT_COMMAND_TIMEOUT",
          { executable, args },
        ),
      );
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.on("error", (error) => {
      finishWithError(
        new AgentSetupError(
          `Failed to start ${executable}: ${error.message}`,
          "AGENT_COMMAND_START",
          {
            executable,
            args,
          },
        ),
      );
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });

    child.stdin.end(options.input);
  });
}

function commandFailure(agent: AgentId, operation: string, result: CommandResult): AgentSetupError {
  const output = `${result.stdout}\n${result.stderr}`.trim().slice(0, 4000);
  return new AgentSetupError(
    `${getAgentTarget(agent).label} ${operation} failed with exit code ${result.exitCode}.`,
    "AGENT_COMMAND_FAILED",
    { agent, operation, output },
  );
}

function targetRuntime(
  detection: AgentDetection,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): AgentTargetRuntime {
  return {
    run: (args, input) =>
      runCommand(detection.executable!, [...args], {
        environment,
        timeoutMs,
        input,
      }),
  };
}

async function inspectMcp(
  agent: AgentId,
  detection: AgentDetection,
  serverEntryPath: string,
  nodeExecutable: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<McpInspection> {
  const target = getAgentTarget(agent);
  const inspection = await target.mcp.inspect(targetRuntime(detection, environment, timeoutMs), {
    serverEntryPath,
    nodeExecutable,
  });
  if (inspection.status === "error") {
    throw commandFailure(agent, inspection.operation, inspection.result);
  }
  return {
    agent,
    status: inspection.status,
    ...(inspection.detail ? { detail: inspection.detail } : {}),
  };
}

async function configureMcp(
  agent: AgentId,
  detection: AgentDetection,
  serverEntryPath: string,
  nodeExecutable: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  const target = getAgentTarget(agent);
  const added = await target.mcp.register(targetRuntime(detection, environment, timeoutMs), {
    serverEntryPath,
    nodeExecutable,
  });
  if (!target.mcp.registrationAccepted(added)) {
    throw commandFailure(agent, "MCP registration", added);
  }
  const verified = await inspectMcp(
    agent,
    detection,
    serverEntryPath,
    nodeExecutable,
    environment,
    timeoutMs,
  );
  if (verified.status !== "current") {
    throw new AgentSetupError(
      `${target.label} saved the MCP registration but verification did not match.`,
      "AGENT_VERIFICATION_FAILED",
      { agent, inspection: verified },
    );
  }
}

async function assertRegularFile(filePath: string, label: string): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    throw new AgentSetupError(`${label} does not exist: ${filePath}`, "SETUP_ARTIFACT_MISSING", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!fileStat.isFile()) {
    throw new AgentSetupError(
      `${label} is not a regular file: ${filePath}`,
      "SETUP_ARTIFACT_INVALID",
    );
  }
}

export async function resolveServerEntryPath(cliExecutablePath: string): Promise<string> {
  const resolvedCli = await realpath(cliExecutablePath);
  return path.join(path.dirname(resolvedCli), "index.js");
}

export async function detectInstalledAgents(
  options: DetectInstalledAgentsOptions = {},
): Promise<AgentDetection[]> {
  const environment = options.environment ?? process.env;
  const timeoutMs = options.commandTimeoutMs ?? 5000;

  return Promise.all(
    AGENT_IDS.map(async (id): Promise<AgentDetection> => {
      const definition = getAgentTarget(id);
      const executable = await findExecutable(definition.command, environment);
      if (executable === undefined) {
        return { id, label: definition.label, installed: false };
      }

      let version: string | undefined;
      try {
        const result = await runCommand(executable, ["--version"], {
          environment,
          timeoutMs,
        });
        version = `${result.stdout}\n${result.stderr}`
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);
      } catch {
        version = undefined;
      }
      return { id, label: definition.label, installed: true, executable, version };
    }),
  );
}

export async function runAgentSetup(options: RunAgentSetupOptions): Promise<AgentSetupResult> {
  const environment = options.environment ?? process.env;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const timeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const requested = AGENT_IDS.filter((agent) => options.agents.includes(agent));
  if (requested.length === 0) {
    throw new AgentSetupError("At least one agent must be selected.", "SETUP_NO_AGENTS");
  }

  const detectionMap = new Map(options.detections.map((item) => [item.id, item]));
  for (const agent of requested) {
    const detection = detectionMap.get(agent);
    if (!detection?.installed || detection.executable === undefined) {
      throw new AgentSetupError(
        `${getAgentTarget(agent).label} is not installed or is not available in PATH.`,
        "AGENT_NOT_INSTALLED",
        { agent },
      );
    }
  }
  await assertRegularFile(options.serverEntryPath, "MCP server entrypoint");
  await assertRegularFile(options.sourceSkillPath, "Bundled skill");

  const inspections = await Promise.all(
    requested.map((agent) =>
      inspectMcp(
        agent,
        detectionMap.get(agent)!,
        options.serverEntryPath,
        nodeExecutable,
        environment,
        timeoutMs,
      ),
    ),
  );
  const conflict = inspections.find((item) => item.status === "conflict");
  if (conflict !== undefined) {
    throw new AgentSetupError(
      `Conflicting ${getAgentTarget(conflict.agent).label} MCP registration: ${conflict.detail}`,
      "AGENT_MCP_CONFLICT",
      { agent: conflict.agent },
    );
  }

  const skillTarget: SkillTargetSelection =
    requested.length === AGENT_IDS.length ? "all" : getAgentTarget(requested[0]!).skillTarget;
  const skillResult = await installBundledSkill({
    target: skillTarget,
    scope: "user",
    force: options.forceSkill ?? false,
    sourceSkillPath: options.sourceSkillPath,
    environment,
  }).catch((error: unknown) => {
    if (error instanceof SkillConflictError) {
      throw new AgentSetupError(
        `Skill already exists with different content at ${error.destination}; pass --force-skill to replace it.`,
        "AGENT_SKILL_CONFLICT",
        { path: error.destination },
      );
    }
    throw error;
  });
  const skillStatuses = new Map(
    skillResult.installations.map((installation) => [installation.target, installation.status]),
  );

  const completed: AgentSetupItem[] = [];
  for (const agent of requested) {
    const detection = detectionMap.get(agent)!;
    const inspection = inspections.find((item) => item.agent === agent)!;
    try {
      if (inspection.status === "missing") {
        await configureMcp(
          agent,
          detection,
          options.serverEntryPath,
          nodeExecutable,
          environment,
          timeoutMs,
        );
      }
      completed.push({
        agent,
        executable: detection.executable!,
        version: detection.version,
        mcp: inspection.status === "current" ? "unchanged" : "configured",
        skill: skillStatuses.get(agent)!,
      });
    } catch (error) {
      if (error instanceof AgentSetupError) {
        throw new AgentSetupError(error.message, error.code, {
          cause: error.details,
          completed,
          skills: skillResult.installations,
        });
      }
      throw error;
    }
  }

  return {
    status: "ok",
    command: "setup",
    server: { name: MCP_SERVER_NAME, command: nodeExecutable, args: [options.serverEntryPath] },
    agents: completed,
  };
}
