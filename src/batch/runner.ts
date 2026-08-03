import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "../server.js";
import {
  MAX_BATCH_CONTEXT_BYTES,
  MAX_BATCH_INVOCATIONS,
  MAX_BATCH_OUTPUT_BYTES,
  MAX_FOREACH_ITEMS,
  isItemTemplate,
  isPrepareBatchTool,
  isReadBatchTool,
  isReferenceTemplate,
  parseBatchDocument as parseDocument,
  type BatchDocument,
  type BatchStep,
  type BatchToolName,
} from "./schema.js";

export { parseDocument as parseBatchDocument };

export interface BatchExecutionResult {
  version: 1;
  status: "ok";
  duration_ms: number;
  step_count: number;
  invocation_count: number;
  result: unknown;
  operation_id?: string;
  plan_hash?: string;
  plan_file?: string;
}

export interface BatchRunOptions {
  persistPreparedOperation?: (operationId: string) => Promise<string>;
  invokeTool?: (tool: BatchToolName, input: Record<string, unknown>) => Promise<unknown>;
}

export class BatchExecutionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly stepId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BatchExecutionError";
  }
}

interface BatchConnection {
  client: Client;
  server: McpServer;
}

interface ExecutionContext {
  steps: Record<string, unknown>;
}

function decodePointerSegment(segment: string): string {
  if (/~(?![01])/.test(segment)) {
    throw new BatchExecutionError(
      `Invalid JSON Pointer escape in segment "${segment}".`,
      "INVALID_REFERENCE",
    );
  }
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolvePointer(root: unknown, pointer: string, label: string): unknown {
  const fragment = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  if (fragment === "") return root;
  if (!fragment.startsWith("/")) {
    throw new BatchExecutionError(`${label} must be empty or start with "/".`, "INVALID_REFERENCE");
  }

  let current = root;
  for (const encodedSegment of fragment.slice(1).split("/")) {
    const segment = decodePointerSegment(encodedSegment);
    if (segment === "__proto__" || segment === "prototype" || segment === "constructor") {
      throw new BatchExecutionError(`${label} contains a forbidden segment.`, "INVALID_REFERENCE");
    }
    if ((typeof current !== "object" || current === null) && !Array.isArray(current)) {
      throw new BatchExecutionError(
        `${label} does not resolve to an object value.`,
        "MISSING_REFERENCE",
      );
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new BatchExecutionError(
        `${label} does not contain segment "${segment}".`,
        "MISSING_REFERENCE",
      );
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveTemplate(value: unknown, context: ExecutionContext, item?: unknown): unknown {
  if (isReferenceTemplate(value)) {
    return resolvePointer(context, value.$ref, `$ref ${value.$ref}`);
  }
  if (isItemTemplate(value)) {
    if (item === undefined) {
      throw new BatchExecutionError(
        "$item is unavailable outside foreach.",
        "INVALID_ITEM_REFERENCE",
      );
    }
    return resolvePointer(item, value.$item, `$item ${value.$item}`);
  }
  if (Array.isArray(value)) return value.map((child) => resolveTemplate(child, context, item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolveTemplate(child, context, item)]),
    );
  }
  return value;
}

function injectProjectRoot(
  resolved: unknown,
  projectRoot: string,
  step: BatchStep,
): Record<string, unknown> {
  if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) {
    throw new BatchExecutionError(
      `Step "${step.id}" input must resolve to an object.`,
      "INVALID_STEP_INPUT",
      step.id,
    );
  }
  const input = resolved as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(input, "project_root") &&
    input.project_root !== projectRoot
  ) {
    throw new BatchExecutionError(
      `Step "${step.id}" resolves a conflicting project_root.`,
      "PROJECT_ROOT_CONFLICT",
      step.id,
    );
  }
  return { ...input, project_root: projectRoot };
}

async function connectBatchClient(): Promise<BatchConnection> {
  const server = createServer();
  const client = new Client({ name: "ast-tool-batch", version: "0.3.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function toolErrorMessage(result: unknown): string {
  const content =
    typeof result === "object" && result !== null
      ? (result as Record<string, unknown>).content
      : undefined;
  const blocks = Array.isArray(content) ? content : [];
  const text = blocks
    .flatMap((block) => {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        return [(block as Record<string, string>).text];
      }
      return [];
    })
    .join("\n");
  return text || "Tool returned an unspecified error.";
}

async function callStructuredTool(
  client: Client,
  step: BatchStep,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name: step.tool, arguments: input });
  if (result.isError) {
    throw new BatchExecutionError(
      `Step "${step.id}" failed: ${toolErrorMessage(result)}`,
      "TOOL_ERROR",
      step.id,
    );
  }
  if (
    typeof result.structuredContent !== "object" ||
    result.structuredContent === null ||
    Array.isArray(result.structuredContent)
  ) {
    throw new BatchExecutionError(
      `Step "${step.id}" returned no structured object result.`,
      "INVALID_TOOL_RESULT",
      step.id,
    );
  }
  return result.structuredContent as Record<string, unknown>;
}

async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  callback: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runBatchDocument(
  document: BatchDocument,
  options: BatchRunOptions = {},
): Promise<BatchExecutionResult> {
  const startedAt = performance.now();
  const context: ExecutionContext = { steps: Object.create(null) as Record<string, unknown> };
  let invocationCount = 0;
  let retainedContextBytes = 0;
  const connection = options.invokeTool ? undefined : await connectBatchClient();
  const invoke = async (
    step: BatchStep,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    if (!options.invokeTool) return callStructuredTool(connection!.client, step, input);
    const result = await options.invokeTool(step.tool, input);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new BatchExecutionError(
        `Step "${step.id}" returned no structured object result.`,
        "INVALID_TOOL_RESULT",
        step.id,
      );
    }
    return result as Record<string, unknown>;
  };

  const reserveInvocations = (count: number, step: BatchStep): void => {
    if (invocationCount + count > MAX_BATCH_INVOCATIONS) {
      throw new BatchExecutionError(
        `Step "${step.id}" would exceed the ${MAX_BATCH_INVOCATIONS}-invocation batch limit.`,
        "INVOCATION_LIMIT",
        step.id,
      );
    }
    invocationCount += count;
  };

  const retainResult = (result: unknown, step: BatchStep): void => {
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(result));
    } catch (error) {
      throw new BatchExecutionError(
        `Step "${step.id}" returned a result that cannot be serialized as JSON.`,
        "INVALID_TOOL_RESULT",
        step.id,
        { cause: error },
      );
    }
    if (bytes > MAX_BATCH_OUTPUT_BYTES) {
      throw new BatchExecutionError(
        `Step "${step.id}" returned ${bytes} bytes; maximum per result is ${MAX_BATCH_OUTPUT_BYTES}.`,
        "RESULT_LIMIT",
        step.id,
      );
    }
    retainedContextBytes += bytes;
    if (retainedContextBytes > MAX_BATCH_CONTEXT_BYTES) {
      throw new BatchExecutionError(
        `Batch retained context exceeds ${MAX_BATCH_CONTEXT_BYTES} bytes.`,
        "CONTEXT_LIMIT",
        step.id,
      );
    }
  };

  try {
    for (const step of document.steps) {
      if (step.foreach) {
        if (!isReadBatchTool(step.tool)) {
          throw new BatchExecutionError(
            `Step "${step.id}" cannot expand non-read tool "${step.tool}".`,
            "FORBIDDEN_FOREACH_TOOL",
            step.id,
          );
        }
        const items = resolveTemplate(step.foreach, context);
        if (!Array.isArray(items)) {
          throw new BatchExecutionError(
            `Step "${step.id}" foreach must resolve to an array.`,
            "INVALID_FOREACH",
            step.id,
          );
        }
        if (items.length > MAX_FOREACH_ITEMS) {
          throw new BatchExecutionError(
            `Step "${step.id}" expands to ${items.length} items; maximum is ${MAX_FOREACH_ITEMS}.`,
            "FOREACH_LIMIT",
            step.id,
          );
        }
        reserveInvocations(items.length, step);
        const results = await mapLimit(items, document.limits.concurrency, async (item) => {
          const resolved = resolveTemplate(step.input, context, item);
          return invoke(step, injectProjectRoot(resolved, document.project_root, step));
        });
        retainResult(results, step);
        context.steps[step.id] = results;
      } else {
        reserveInvocations(1, step);
        const resolved = resolveTemplate(step.input, context);
        const result = await invoke(step, injectProjectRoot(resolved, document.project_root, step));
        if (isPrepareBatchTool(step.tool) && options.persistPreparedOperation) {
          const operationId = result.operation_id;
          if (typeof operationId !== "string") {
            throw new BatchExecutionError(
              `Prepare step "${step.id}" returned no operation_id.`,
              "INVALID_TOOL_RESULT",
              step.id,
            );
          }
          result.plan_file = await options.persistPreparedOperation(operationId);
        }
        retainResult(result, step);
        context.steps[step.id] = result;
      }
    }

    const finalStep = document.steps.at(-1)!;
    const projected =
      document.emit === undefined
        ? context.steps[finalStep.id]
        : resolveTemplate(document.emit, context);
    const output: BatchExecutionResult = {
      version: 1,
      status: "ok",
      duration_ms: performance.now() - startedAt,
      step_count: document.steps.length,
      invocation_count: invocationCount,
      result: projected,
    };
    if (isPrepareBatchTool(finalStep.tool)) {
      const prepared = context.steps[finalStep.id] as Record<string, unknown>;
      if (
        typeof prepared.operation_id === "string" &&
        typeof prepared.plan_hash === "string" &&
        typeof prepared.plan_file === "string"
      ) {
        output.operation_id = prepared.operation_id;
        output.plan_hash = prepared.plan_hash;
        output.plan_file = prepared.plan_file;
      }
    }
    const outputBytes = Buffer.byteLength(JSON.stringify(output));
    if (outputBytes > MAX_BATCH_OUTPUT_BYTES) {
      throw new BatchExecutionError(
        `Batch output is ${outputBytes} bytes; maximum is ${MAX_BATCH_OUTPUT_BYTES}. Narrow emit or pagination.`,
        "OUTPUT_LIMIT",
      );
    }
    return output;
  } finally {
    if (connection)
      await Promise.allSettled([connection.client.close(), connection.server.close()]);
  }
}
