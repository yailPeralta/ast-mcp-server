import { z } from "zod";

export const BATCH_SCHEMA_VERSION = 1 as const;
export const MAX_BATCH_STEPS = 50;
export const MAX_BATCH_INVOCATIONS = 500;
export const MAX_FOREACH_ITEMS = 200;
export const DEFAULT_BATCH_CONCURRENCY = 4;
export const MAX_BATCH_CONCURRENCY = 16;
export const MAX_BATCH_INPUT_BYTES = 1024 * 1024;
export const MAX_BATCH_OUTPUT_BYTES = 10 * 1024 * 1024;
export const MAX_BATCH_CONTEXT_BYTES = 50 * 1024 * 1024;

export const READ_BATCH_TOOLS = [
  "ast_list_files",
  "ast_get_outline",
  "ast_get_symbol_source",
  "ast_search_symbols",
  "ast_find_references",
  "ast_find_test_candidates",
  "ast_explore",
  "ast_get_diagnostics",
] as const;

export const PREPARE_BATCH_TOOLS = [
  "ast_rename_symbol",
  "ast_replace_symbol_body",
  "ast_scaffold_class",
] as const;

export const BATCH_TOOLS = [...READ_BATCH_TOOLS, ...PREPARE_BATCH_TOOLS] as const;

export type BatchToolName = (typeof BATCH_TOOLS)[number];

export interface BatchStep {
  id: string;
  tool: BatchToolName;
  input: Record<string, unknown>;
  foreach?: { $ref: string };
}

export interface BatchDocument {
  version: typeof BATCH_SCHEMA_VERSION;
  project_root: string;
  limits: { concurrency: number };
  steps: BatchStep[];
  emit?: unknown;
}

const BatchToolSchema = z.enum(BATCH_TOOLS);

const BatchStepSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    tool: BatchToolSchema,
    input: z.record(z.unknown()).default({}),
    foreach: z
      .object({ $ref: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();

const BatchDocumentSchema = z
  .object({
    version: z.literal(BATCH_SCHEMA_VERSION),
    project_root: z.string().min(1),
    limits: z
      .object({
        concurrency: z
          .number()
          .int()
          .min(1)
          .max(MAX_BATCH_CONCURRENCY)
          .default(DEFAULT_BATCH_CONCURRENCY),
      })
      .strict()
      .default({ concurrency: DEFAULT_BATCH_CONCURRENCY }),
    steps: z.array(BatchStepSchema).min(1).max(MAX_BATCH_STEPS),
    emit: z.unknown().optional(),
  })
  .strict();

function isTemplateObject(value: unknown, key: "$ref" | "$item"): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[key] === "string"
  );
}

function decodePointerSegment(segment: string): string {
  if (/~(?![01])/u.test(segment)) {
    throw new Error(`Invalid JSON Pointer escape in segment "${segment}".`);
  }
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function referencedStepId(pointer: string): string {
  if (!pointer.startsWith("#/steps/")) {
    throw new Error(`Batch $ref must start with "#/steps/": ${pointer}`);
  }
  const remainder = pointer.slice("#/steps/".length);
  const encodedId = remainder.split("/", 1)[0];
  if (!encodedId) throw new Error(`Batch $ref is missing a step id: ${pointer}`);
  return decodePointerSegment(encodedId);
}

function visitTemplate(
  value: unknown,
  options: {
    availableSteps: ReadonlySet<string>;
    allowItem: boolean;
    location: string;
  },
): void {
  if (isTemplateObject(value, "$ref")) {
    const id = referencedStepId(value.$ref);
    if (!options.availableSteps.has(id)) {
      throw new Error(
        `${options.location} references step "${id}" before it is available; only prior steps may be referenced.`,
      );
    }
    return;
  }
  if (isTemplateObject(value, "$item")) {
    if (!options.allowItem) {
      throw new Error(`${options.location} uses $item outside a foreach step.`);
    }
    if (value.$item !== "" && !value.$item.startsWith("/")) {
      throw new Error(`${options.location} $item must be an empty pointer or start with "/".`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitTemplate(item, { ...options, location: `${options.location}/${index}` }),
    );
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      visitTemplate(child, { ...options, location: `${options.location}/${key}` });
    }
  }
}

export function isPrepareBatchTool(tool: BatchToolName): boolean {
  return (PREPARE_BATCH_TOOLS as readonly string[]).includes(tool);
}

export function isReadBatchTool(tool: BatchToolName): boolean {
  return (READ_BATCH_TOOLS as readonly string[]).includes(tool);
}

export function parseBatchDocument(input: unknown): BatchDocument {
  const parsed = BatchDocumentSchema.parse(input) as BatchDocument;
  const ids = new Set<string>();
  const prepareIndexes: number[] = [];

  for (const [index, step] of parsed.steps.entries()) {
    if (ids.has(step.id)) throw new Error(`Duplicate batch step id "${step.id}".`);
    if (step.input.output_format === "toon") {
      throw new Error(
        `Step "${step.id}" cannot request TOON for an intermediate batch result. Use CLI --output-format toon for the final output.`,
      );
    }
    if (Object.hasOwn(step.input, "project_root")) {
      if (step.input.project_root !== parsed.project_root) {
        throw new Error(`Step "${step.id}" project_root conflicts with the pipeline project_root.`);
      }
      delete step.input.project_root;
    }
    if (isPrepareBatchTool(step.tool)) {
      prepareIndexes.push(index);
      if (step.foreach) throw new Error(`Prepare step "${step.id}" cannot use foreach.`);
    }

    if (step.foreach) {
      visitTemplate(step.foreach, {
        availableSteps: ids,
        allowItem: false,
        location: `step "${step.id}" foreach`,
      });
    }
    visitTemplate(step.input, {
      availableSteps: ids,
      allowItem: Boolean(step.foreach),
      location: `step "${step.id}" input`,
    });
    ids.add(step.id);
  }

  if (prepareIndexes.length > 1) throw new Error("A batch may contain at most one prepare step.");
  if (prepareIndexes.length === 1 && prepareIndexes[0] !== parsed.steps.length - 1) {
    throw new Error("A prepare step must be the final batch step.");
  }

  if (parsed.emit !== undefined) {
    visitTemplate(parsed.emit, {
      availableSteps: ids,
      allowItem: false,
      location: "emit",
    });
  }

  return parsed;
}

export function isReferenceTemplate(value: unknown): value is { $ref: string } {
  return isTemplateObject(value, "$ref");
}

export function isItemTemplate(value: unknown): value is { $item: string } {
  return isTemplateObject(value, "$item");
}
