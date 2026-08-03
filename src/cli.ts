#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

import { ZodError } from "zod";
import { BatchExecutionError, parseBatchDocument, runBatchDocument } from "./batch/runner.js";
import { MAX_BATCH_INPUT_BYTES } from "./batch/schema.js";
import { applyPersistedOperation, persistOperationPlan } from "./services/operation-plan-file.js";

interface CliFailure {
  status: "error";
  command: string | null;
  code: string;
  step_id?: string;
  message: string;
}

class CliError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly exitCode: 1 | 2,
    readonly command: string | null,
    readonly stepId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CliError";
  }
}

function usage(): string {
  return [
    "Usage:",
    "  ast-tool run <pipeline.json|->",
    "  ast-tool validate <pipeline.json|->",
    "  ast-tool apply <plan.astplan> --plan-hash <sha256>",
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
    if (commandArgs.length !== 1 || !commandArgs[0]) {
      throw new CliError(usage(), "USAGE", 2, command);
    }
    const document = await parseDocumentForCommand(commandArgs[0], command);
    if (command === "validate") {
      return {
        version: 1,
        status: "valid",
        step_count: document.steps.length,
      };
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

  throw new CliError(usage(), "USAGE", 2, command ?? null);
}

function failure(error: unknown): { value: CliFailure; exitCode: 1 | 2 } {
  if (error instanceof CliError) {
    return {
      value: {
        status: "error",
        command: error.command,
        code: error.code,
        ...(error.stepId ? { step_id: error.stepId } : {}),
        message: error.message,
      },
      exitCode: error.exitCode,
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
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const failed = failure(error);
    process.stderr.write(`${JSON.stringify(failed.value)}\n`);
    process.exitCode = failed.exitCode;
  }
}

await main();
