#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import { ZodError } from "zod";
import { BatchExecutionError, parseBatchDocument, runBatchDocument } from "./batch/runner.js";
import { MAX_BATCH_INPUT_BYTES, isPrepareBatchTool } from "./batch/schema.js";
import { CliOutputError, serializeCliSuccess, type CliOutputFormat } from "./cli-output.js";
import { applyPersistedOperation, persistOperationPlan } from "./services/operation-plan-file.js";
import {
  AgentSetupError,
  detectInstalledAgents,
  resolveServerEntryPath,
  runAgentSetup,
} from "./services/agent-setup.js";
import {
  installBundledSkill,
  resolveBundledSkillPath,
  type SkillScope,
  type SkillTargetSelection,
} from "./services/skill-installer.js";
import {
  parseAgentsArgument,
  promptForAgentSelection,
  type AgentId,
} from "./services/setup-wizard.js";

interface CliFailure {
  status: "error";
  command: string | null;
  code: string;
  step_id?: string;
  message: string;
  details?: unknown;
}

class CliError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly exitCode: 1 | 2,
    readonly command: string | null,
    readonly stepId?: string,
    options?: ErrorOptions,
    readonly details?: unknown,
  ) {
    super(message, options);
    this.name = "CliError";
  }
}

function usage(): string {
  return [
    "Usage:",
    "  ast-tool run <pipeline.json|-> [--output-format json|toon]",
    "  ast-tool validate <pipeline.json|->",
    "  ast-tool apply <plan.astplan> --plan-hash <sha256>",
    "  ast-tool install-skill [claude|hermes|all] [--scope user|project] [--project-root <path>] [--force]",
    "  ast-tool setup [--agents claude,hermes|all --yes] [--force-skill]",
  ].join("\n");
}

async function readStdinBounded(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BATCH_INPUT_BYTES) {
      throw new CliError(
        `Batch input exceeds ${MAX_BATCH_INPUT_BYTES} bytes.`,
        "INPUT_LIMIT",
        2,
        null,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readBatchInput(source: string): Promise<unknown> {
  const bytes = source === "-" ? await readStdinBounded() : await readFile(source);
  if (bytes.length > MAX_BATCH_INPUT_BYTES) {
    throw new CliError(
      `Batch input is ${bytes.length} bytes; maximum is ${MAX_BATCH_INPUT_BYTES}.`,
      "INPUT_LIMIT",
      2,
      null,
    );
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CliError("Batch input is not valid JSON.", "INVALID_JSON", 2, null, undefined, {
      cause: error,
    });
  }
}

function parseApplyArgs(args: string[]): { planFile: string; planHash: string } {
  if (args.length !== 3 || args[1] !== "--plan-hash" || !args[0] || !args[2]) {
    throw new CliError(usage(), "USAGE", 2, "apply");
  }
  return { planFile: args[0], planHash: args[2] };
}

interface RunArgs {
  source: string;
  outputFormat: CliOutputFormat;
}

function parseRunArgs(args: string[]): RunArgs {
  let source: string | undefined;
  let outputFormat: CliOutputFormat = "json";
  let outputFormatSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--output-format") {
      const value = args[index + 1];
      if (outputFormatSeen || (value !== "json" && value !== "toon")) {
        throw new CliError(usage(), "USAGE", 2, "run");
      }
      outputFormat = value;
      outputFormatSeen = true;
      index += 1;
      continue;
    }
    if (source === undefined && !argument.startsWith("--")) {
      source = argument;
      continue;
    }
    throw new CliError(usage(), "USAGE", 2, "run");
  }

  if (!source) throw new CliError(usage(), "USAGE", 2, "run");
  return { source, outputFormat };
}

interface InstallSkillArgs {
  target: SkillTargetSelection;
  scope: SkillScope;
  projectRoot?: string;
  force: boolean;
}

function parseInstallSkillArgs(args: string[]): InstallSkillArgs {
  let target: SkillTargetSelection = "all";
  let targetSeen = false;
  let scope: SkillScope = "user";
  let scopeSeen = false;
  let projectRoot: string | undefined;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--force") {
      if (force) throw new CliError(usage(), "USAGE", 2, "install-skill");
      force = true;
      continue;
    }
    if (argument === "--scope") {
      const value = args[index + 1];
      if (scopeSeen || (value !== "user" && value !== "project")) {
        throw new CliError(usage(), "USAGE", 2, "install-skill");
      }
      scope = value;
      scopeSeen = true;
      index += 1;
      continue;
    }
    if (argument === "--project-root") {
      const value = args[index + 1];
      if (projectRoot !== undefined || !value || value.startsWith("--")) {
        throw new CliError(usage(), "USAGE", 2, "install-skill");
      }
      projectRoot = value;
      index += 1;
      continue;
    }
    if (!targetSeen && (argument === "claude" || argument === "hermes" || argument === "all")) {
      target = argument;
      targetSeen = true;
      continue;
    }
    throw new CliError(usage(), "USAGE", 2, "install-skill");
  }

  if (projectRoot !== undefined && scope !== "project") {
    throw new CliError(usage(), "USAGE", 2, "install-skill");
  }
  return { target, scope, ...(projectRoot ? { projectRoot } : {}), force };
}

interface SetupArgs {
  agents?: AgentId[];
  yes: boolean;
  forceSkill: boolean;
}

function parseSetupArgs(args: string[]): SetupArgs {
  let agents: AgentId[] | undefined;
  let yes = false;
  let forceSkill = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--agents") {
      const value = args[index + 1];
      if (agents !== undefined || !value || value.startsWith("--")) {
        throw new CliError(usage(), "USAGE", 2, "setup");
      }
      try {
        agents = parseAgentsArgument(value);
      } catch (error) {
        throw new CliError(
          error instanceof Error ? error.message : String(error),
          "USAGE",
          2,
          "setup",
          undefined,
          { cause: error },
        );
      }
      index += 1;
      continue;
    }
    if (argument === "--yes") {
      if (yes) throw new CliError(usage(), "USAGE", 2, "setup");
      yes = true;
      continue;
    }
    if (argument === "--force-skill") {
      if (forceSkill) throw new CliError(usage(), "USAGE", 2, "setup");
      forceSkill = true;
      continue;
    }
    throw new CliError(usage(), "USAGE", 2, "setup");
  }

  if ((agents === undefined) === yes) {
    throw new CliError(
      "Non-interactive setup requires both --agents and --yes; interactive setup accepts neither.",
      "USAGE",
      2,
      "setup",
    );
  }
  return { ...(agents === undefined ? {} : { agents }), yes, forceSkill };
}

async function parseDocumentForCommand(source: string, command: string) {
  try {
    return parseBatchDocument(await readBatchInput(source));
  } catch (error) {
    if (error instanceof CliError) {
      throw new CliError(error.message, error.code, 2, command, error.stepId, { cause: error });
    }
    const message =
      error instanceof ZodError ? error.issues.map((issue) => issue.message).join("; ") : error;
    throw new CliError(
      message instanceof Error ? message.message : String(message),
      "INVALID_BATCH",
      2,
      command,
      undefined,
      { cause: error },
    );
  }
}

export async function runCli(args: string[]): Promise<unknown> {
  const [command, ...commandArgs] = args;
  if (command === "run" || command === "validate") {
    const runArgs =
      command === "run"
        ? parseRunArgs(commandArgs)
        : commandArgs.length === 1 && commandArgs[0]
          ? { source: commandArgs[0], outputFormat: "json" as const }
          : undefined;
    if (!runArgs) throw new CliError(usage(), "USAGE", 2, command);
    const document = await parseDocumentForCommand(runArgs.source, command);
    if (command === "validate") {
      return {
        version: 1,
        status: "valid",
        step_count: document.steps.length,
      };
    }
    if (
      runArgs.outputFormat === "toon" &&
      document.steps.some((step) => isPrepareBatchTool(step.tool))
    ) {
      throw new CliError(
        "TOON output is available only for read-only batches; prepare results require JSON review coordinates.",
        "INVALID_BATCH",
        2,
        command,
      );
    }
    try {
      return await runBatchDocument(document, {
        persistPreparedOperation: (operationId) => persistOperationPlan(operationId),
      });
    } catch (error) {
      if (error instanceof BatchExecutionError) {
        throw new CliError(error.message, error.code, 1, command, error.stepId, {
          cause: error,
        });
      }
      throw new CliError(
        error instanceof Error ? error.message : String(error),
        "EXECUTION_ERROR",
        1,
        command,
        undefined,
        { cause: error },
      );
    }
  }

  if (command === "apply") {
    const { planFile, planHash } = parseApplyArgs(commandArgs);
    try {
      return await applyPersistedOperation(planFile, planHash);
    } catch (error) {
      throw new CliError(
        error instanceof Error ? error.message : String(error),
        "APPLY_ERROR",
        1,
        command,
        undefined,
        { cause: error },
      );
    }
  }

  if (command === "setup") {
    const options = parseSetupArgs(commandArgs);
    try {
      const detections = await detectInstalledAgents();
      let agents = options.agents;
      if (agents === undefined) {
        if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
          throw new CliError(
            "Interactive setup requires a TTY. Use --agents claude,hermes --yes for automation.",
            "USAGE",
            2,
            command,
          );
        }
        const prompt = createInterface({ input: process.stdin, output: process.stderr });
        try {
          agents = await promptForAgentSelection(detections, (question) =>
            prompt.question(question),
          );
        } finally {
          prompt.close();
        }
        if (agents.length === 0) {
          return { status: "cancelled", command: "setup", agents: [] };
        }
      }

      const executablePath = process.argv[1];
      if (!executablePath) {
        throw new Error("Cannot resolve the ast-tool executable path.");
      }
      return await runAgentSetup({
        agents,
        detections,
        sourceSkillPath: await resolveBundledSkillPath(executablePath),
        serverEntryPath: await resolveServerEntryPath(executablePath),
        forceSkill: options.forceSkill,
      });
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      if (error instanceof AgentSetupError) {
        throw new CliError(
          error.message,
          error.code,
          1,
          command,
          undefined,
          { cause: error },
          error.details,
        );
      }
      throw new CliError(
        error instanceof Error ? error.message : String(error),
        "SETUP_ERROR",
        1,
        command,
        undefined,
        { cause: error },
      );
    }
  }

  if (command === "install-skill") {
    const options = parseInstallSkillArgs(commandArgs);
    try {
      const executablePath = process.argv[1];
      if (!executablePath) {
        throw new Error("Cannot resolve the ast-tool executable path.");
      }
      return await installBundledSkill({
        ...options,
        sourceSkillPath: await resolveBundledSkillPath(executablePath),
      });
    } catch (error) {
      throw new CliError(
        error instanceof Error ? error.message : String(error),
        "SKILL_INSTALL_ERROR",
        1,
        command,
        undefined,
        { cause: error },
      );
    }
  }

  throw new CliError(usage(), "USAGE", 2, command ?? null);
}

function failure(
  error: unknown,
  command: string | null = null,
): { value: CliFailure; exitCode: 1 | 2 } {
  if (error instanceof CliError) {
    return {
      value: {
        status: "error",
        command: error.command,
        code: error.code,
        ...(error.stepId ? { step_id: error.stepId } : {}),
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      exitCode: error.exitCode,
    };
  }
  if (error instanceof CliOutputError) {
    return {
      value: {
        status: "error",
        command,
        code: error.code,
        message: error.message,
      },
      exitCode: 1,
    };
  }
  return {
    value: {
      status: "error",
      command: null,
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
    exitCode: 1,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    const result = await runCli(args);
    const outputFormat = args[0] === "run" ? parseRunArgs(args.slice(1)).outputFormat : "json";
    process.stdout.write(`${serializeCliSuccess(result, outputFormat)}\n`);
  } catch (error) {
    const failed = failure(error, args[0] ?? null);
    process.stderr.write(`${JSON.stringify(failed.value)}\n`);
    process.exitCode = failed.exitCode;
  }
}

await main();
