import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import {
  applySkillInstallationPlan,
  planBundledSkillInstallation,
  SkillConflictError,
  type SkillInstallation,
  type SkillInstallationPlan,
} from "./skill-installer.js";
import {
  planManagedGuidance,
  type GuidanceStatus,
  type ManagedGuidancePlan,
} from "./managed-guidance.js";
import {
  applyManagedFilePlan,
  createManagedFileApplyContext,
  ManagedFileApplyError,
  ManagedFileRollbackError,
  revalidateManagedFilePlan,
  verifyManagedFilePostimage,
  type ManagedFileApplyContext,
  type ManagedFileApplyHooks,
  type ManagedFilePlan,
} from "./managed-file.js";
import { type AgentDetection, type AgentId } from "./setup-wizard.js";
import {
  AGENT_IDS,
  classifyAgentVersion,
  getAgentTarget,
  MCP_SERVER_NAME,
  type AgentTargetRuntime,
} from "./agent-targets.js";
import {
  applyOpenCodeConfigPlan,
  planOpenCodeConfig,
  resolveOpenCodeConfigPath,
  withIsolatedOpenCodeConfig,
  type OpenCodeConfigPlan,
} from "./opencode-config.js";

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
  status: "missing" | "current" | "conflict" | "blocked_untrusted_folder";
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
  sourceGuidancePath: string;
  releaseManifestPath: string;
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
  guidance: GuidanceStatus;
}

export interface AgentSetupResult {
  version: 2;
  status: "ok";
  command: "setup";
  server: {
    name: typeof MCP_SERVER_NAME;
    command: string;
    args: [string];
  };
  agents: AgentSetupItem[];
  correlation_id: string;
  physical_writes: Array<{
    path: string;
    asset: "skill" | "guidance" | "mcp_config";
    status: string;
  }>;
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

export async function applyManagedAssetPlans(
  skillPlan: SkillInstallationPlan,
  guidancePlan: ManagedGuidancePlan,
  context: ManagedFileApplyContext = createManagedFileApplyContext(),
  hooks: ManagedFileApplyHooks = {},
): Promise<AgentSetupResult["physical_writes"]> {
  const physicalWrites: AgentSetupResult["physical_writes"] = [];
  const possiblyCommitted: AgentSetupResult["physical_writes"] = [];
  const rolledBack: AgentSetupResult["physical_writes"] = [];
  const rollbackFailed: AgentSetupResult["physical_writes"] = [];
  const authenticated: ManagedFilePlan[] = [];
  let activePlan: { file: ManagedFilePlan; asset: "skill" | "guidance" } | undefined;
  let skillBundleApplying = true;
  try {
    for (const file of [...skillPlan.files, ...guidancePlan.files]) {
      await revalidateManagedFilePlan(file);
    }
    await applySkillInstallationPlan(
      skillPlan,
      (file) => {
        authenticated.push(file);
        if (file.status !== "unchanged")
          physicalWrites.push({ path: file.path, asset: "skill", status: file.status });
      },
      context,
      hooks,
    );
    skillBundleApplying = false;
    const plans = guidancePlan.files.map((file) => ({ file, asset: "guidance" as const }));
    for (const { file, asset } of plans) {
      activePlan = { file, asset };
      for (const current of authenticated) {
        await verifyManagedFilePostimage(current, context);
      }
      await applyManagedFilePlan(file, context, hooks);
      authenticated.push(file);
      if (file.status !== "unchanged") {
        physicalWrites.push({ path: file.path, asset, status: file.status });
      }
      activePlan = undefined;
    }
    for (const current of authenticated) {
      await verifyManagedFilePostimage(current, context);
    }
    return physicalWrites;
  } catch (error) {
    if (skillBundleApplying) physicalWrites.length = 0;
    if (activePlan !== undefined && activePlan.file.status !== "unchanged") {
      const write = {
        path: activePlan.file.path,
        asset: activePlan.asset,
        status: activePlan.file.status,
      };
      if (error instanceof ManagedFileRollbackError) {
        rolledBack.push(write);
      } else if (error instanceof ManagedFileApplyError) {
        if (error.commitState === "committed") {
          physicalWrites.push(write);
        } else {
          possiblyCommitted.push(write);
        }
        if (error.rollbackState === "failed") {
          rollbackFailed.push(write);
        }
      }
    }
    throw new AgentSetupError(
      error instanceof Error ? error.message : "Managed asset apply failed.",
      "AGENT_ASSET_APPLY_FAILED",
      {
        completed_writes: physicalWrites,
        possibly_committed: possiblyCommitted,
        rolled_back: rolledBack,
        rollback_failed: rollbackFailed,
        pending: [
          ...skillPlan.files
            .filter((file) => file.status !== "unchanged")
            .map((file) => ({ path: file.path, asset: "skill", status: file.status })),
          ...guidancePlan.files
            .filter((file) => file.status !== "unchanged")
            .map((file) => ({ path: file.path, asset: "guidance", status: file.status })),
        ].filter(
          (pending) =>
            !physicalWrites.some(
              (completed) => completed.path === pending.path && completed.asset === pending.asset,
            ) &&
            !possiblyCommitted.some(
              (uncertain) => uncertain.path === pending.path && uncertain.asset === pending.asset,
            ),
        ),
      },
    );
  }
}

async function verifyManagedAssetPlans(
  skillPlan: SkillInstallationPlan,
  guidancePlan: ManagedGuidancePlan,
  context: ManagedFileApplyContext,
): Promise<void> {
  try {
    for (const file of [...skillPlan.files, ...guidancePlan.files]) {
      await verifyManagedFilePostimage(file, context);
    }
  } catch (error) {
    throw new AgentSetupError(
      error instanceof Error ? error.message : "Managed asset postimage verification failed.",
      "AGENT_ASSET_APPLY_FAILED",
      { cause: error instanceof Error ? error.message : String(error) },
    );
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
        ),
      );
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.on("error", () => {
      finishWithError(
        new AgentSetupError("Failed to start the agent command.", "AGENT_COMMAND_START"),
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
  return new AgentSetupError(
    `${getAgentTarget(agent).label} ${operation} failed with exit code ${result.exitCode}.`,
    "AGENT_COMMAND_FAILED",
    { agent, operation, reason: `Command exited with code ${result.exitCode}.` },
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

async function verifyOpenCode(
  detection: AgentDetection,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
  context: { nodeExecutable: string; serverEntryPath: string },
): Promise<void> {
  await withIsolatedOpenCodeConfig(
    environment,
    environment.HOME ?? os.homedir(),
    async (isolatedEnvironment) => {
      const runtime = targetRuntime(detection, isolatedEnvironment, timeoutMs);
      const resolved = await runtime.run(["debug", "config", "--pure"]);
      if (resolved.exitCode !== 0)
        throw commandFailure("opencode", "resolved configuration verification", resolved);
      let config: any;
      try {
        config = JSON.parse(resolved.stdout);
      } catch {
        throw new AgentSetupError(
          "OpenCode resolved configuration output is unknown.",
          "AGENT_VERIFICATION_FAILED",
          { agent: "opencode" },
        );
      }
      const command = config?.mcp?.ast?.command;
      if (
        !Array.isArray(command) ||
        command.length !== 2 ||
        command[0] !== context.nodeExecutable ||
        command[1] !== context.serverEntryPath
      ) {
        throw new AgentSetupError(
          "OpenCode resolved configuration does not contain the expected ast server.",
          "AGENT_VERIFICATION_FAILED",
          { agent: "opencode" },
        );
      }
      const listed = await runtime.run(["mcp", "list", "--pure"]);
      const plainList = listed.stdout.replaceAll("\u001b", "");
      if (listed.exitCode !== 0 || !/ast[\s\S]*connected/i.test(plainList)) {
        throw new AgentSetupError(
          "OpenCode did not report the ast server as connected.",
          "AGENT_VERIFICATION_FAILED",
          { agent: "opencode" },
        );
      }
    },
  );
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
        return {
          id,
          label: definition.label,
          installed: false,
          compatibility: { status: "unavailable", reason: "Not found in PATH." },
        };
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
      const compatibility =
        version === undefined
          ? {
              status: "incompatible" as const,
              reason: "Version command did not produce admitted evidence.",
            }
          : classifyAgentVersion(id, version);
      return { id, label: definition.label, installed: true, executable, version, compatibility };
    }),
  );
}

export async function runAgentSetup(options: RunAgentSetupOptions): Promise<AgentSetupResult> {
  const correlationId = randomUUID();
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
    if (detection.compatibility && detection.compatibility.status !== "compatible") {
      throw new AgentSetupError(
        `${getAgentTarget(agent).label} is incompatible: ${detection.compatibility.reason}`,
        detection.compatibility.status === "blocked_untrusted_folder"
          ? "AGENT_TRUST_REQUIRED"
          : "AGENT_INCOMPATIBLE",
        { agent, correlation_id: correlationId },
      );
    }
  }
  await assertRegularFile(options.serverEntryPath, "MCP server entrypoint");
  await assertRegularFile(options.sourceSkillPath, "Bundled skill");

  let openCodePlan: OpenCodeConfigPlan | undefined;
  if (requested.includes("opencode")) {
    openCodePlan = await planOpenCodeConfig({
      filePath: resolveOpenCodeConfigPath(environment, environment.HOME ?? os.homedir()),
      nodeExecutable,
      serverEntryPath: options.serverEntryPath,
    }).catch((error: unknown) => {
      throw new AgentSetupError(
        error instanceof Error ? error.message : "OpenCode configuration preflight failed.",
        "AGENT_MCP_CONFLICT",
        { agent: "opencode", correlation_id: correlationId },
      );
    });
    const effective = await withIsolatedOpenCodeConfig(
      environment,
      environment.HOME ?? os.homedir(),
      (isolatedEnvironment) =>
        targetRuntime(detectionMap.get("opencode")!, isolatedEnvironment, timeoutMs).run([
          "debug",
          "config",
          "--pure",
        ]),
    );
    if (effective.exitCode !== 0) {
      throw new AgentSetupError(
        `OpenCode effective configuration preflight failed with exit code ${effective.exitCode}.`,
        "AGENT_MCP_CONFLICT",
        { agent: "opencode", correlation_id: correlationId },
      );
    }
    let effectiveConfig: any;
    try {
      effectiveConfig = JSON.parse(effective.stdout);
    } catch {
      throw new AgentSetupError(
        "OpenCode effective configuration output is unknown.",
        "AGENT_MCP_CONFLICT",
        { agent: "opencode", correlation_id: correlationId },
      );
    }
    const effectiveAst = effectiveConfig?.mcp?.ast;
    const desiredAst = {
      type: "local",
      command: [nodeExecutable, options.serverEntryPath],
      enabled: true,
      environment: { AST_MCP_APPLY_GUARD: "allow" },
    };
    if (effectiveAst !== undefined && JSON.stringify(effectiveAst) !== JSON.stringify(desiredAst)) {
      throw new AgentSetupError(
        "OpenCode effective configuration conflict at mcp.ast.",
        "AGENT_MCP_CONFLICT",
        { agent: "opencode", correlation_id: correlationId },
      );
    }
    if (effectiveAst !== undefined && openCodePlan.status === "installed") {
      openCodePlan = { ...openCodePlan, status: "unchanged" };
    }
  }

  const inspections = await Promise.all(
    requested.map((agent) =>
      agent === "opencode"
        ? Promise.resolve<McpInspection>({
            agent,
            status: openCodePlan?.status === "unchanged" ? "current" : "missing",
          })
        : inspectMcp(
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
  const blocked = inspections.find((item) => item.status === "blocked_untrusted_folder");
  if (blocked !== undefined) {
    throw new AgentSetupError(
      `${getAgentTarget(blocked.agent).label} requires the working folder to be trusted before setup.`,
      "AGENT_TRUST_REQUIRED",
      { agent: blocked.agent, correlation_id: correlationId },
    );
  }

  let skillPlan: SkillInstallationPlan;
  try {
    skillPlan = await planBundledSkillInstallation({
      target: requested,
      scope: "user",
      force: options.forceSkill ?? false,
      sourceSkillPath: options.sourceSkillPath,
      releaseManifestPath: options.releaseManifestPath,
      environment,
      homeDirectory: environment.HOME ?? os.homedir(),
    });
  } catch (error) {
    if (error instanceof SkillConflictError) {
      throw new AgentSetupError(
        `Skill already exists with different content at ${error.destination}; pass --force-skill to replace it.`,
        "AGENT_SKILL_CONFLICT",
        { path: error.destination },
      );
    }
    throw new AgentSetupError(
      error instanceof Error ? error.message : "Skill preflight failed.",
      "SETUP_ASSET_INVALID",
      { asset: "skill", correlation_id: correlationId },
    );
  }

  let guidancePlan: ManagedGuidancePlan;
  try {
    guidancePlan = await planManagedGuidance({
      agents: requested,
      sourceGuidancePath: options.sourceGuidancePath,
      environment,
      homeDirectory: environment.HOME ?? os.homedir(),
    });
  } catch (error) {
    throw new AgentSetupError(
      error instanceof Error ? error.message : "Managed guidance preflight failed.",
      "AGENT_GUIDANCE_CONFLICT",
      { asset: "guidance", correlation_id: correlationId },
    );
  }

  const skillStatuses = new Map(
    skillPlan.installations.map((installation) => [installation.target, installation.status]),
  );
  const guidanceStatuses = new Map(
    guidancePlan.installations.map((installation) => [installation.agent, installation.status]),
  );
  const applyContext = createManagedFileApplyContext();
  const physicalWrites = await applyManagedAssetPlans(skillPlan, guidancePlan, applyContext);

  const completed: AgentSetupItem[] = [];
  for (const agent of requested) {
    const detection = detectionMap.get(agent)!;
    const inspection = inspections.find((item) => item.agent === agent)!;
    try {
      await verifyManagedAssetPlans(skillPlan, guidancePlan, applyContext);
      if (inspection.status === "missing") {
        if (agent === "opencode") {
          await applyOpenCodeConfigPlan(openCodePlan!);
          if (openCodePlan!.status === "installed") {
            physicalWrites.push({
              path: openCodePlan!.filePath,
              asset: "mcp_config",
              status: "installed",
            });
          }
          await verifyOpenCode(detection, environment, timeoutMs, {
            nodeExecutable,
            serverEntryPath: options.serverEntryPath,
          });
        } else
          await configureMcp(
            agent,
            detection,
            options.serverEntryPath,
            nodeExecutable,
            environment,
            timeoutMs,
          );
      } else if (agent === "opencode") {
        await verifyOpenCode(detection, environment, timeoutMs, {
          nodeExecutable,
          serverEntryPath: options.serverEntryPath,
        });
      }
      await verifyManagedAssetPlans(skillPlan, guidancePlan, applyContext);
      completed.push({
        agent,
        executable: detection.executable!,
        version: detection.version,
        mcp: inspection.status === "current" ? "unchanged" : "configured",
        skill: skillStatuses.get(agent)!,
        guidance: guidanceStatuses.get(agent)!,
      });
    } catch (error) {
      if (error instanceof AgentSetupError) {
        throw new AgentSetupError(error.message, error.code, {
          cause: error.details,
          completed,
          skills: skillPlan.installations,
          guidance: guidancePlan.installations,
          completed_writes: physicalWrites,
        });
      }
      throw error;
    }
  }

  return {
    version: 2,
    status: "ok",
    command: "setup",
    server: { name: MCP_SERVER_NAME, command: nodeExecutable, args: [options.serverEntryPath] },
    agents: completed,
    correlation_id: correlationId,
    physical_writes: physicalWrites,
  };
}
