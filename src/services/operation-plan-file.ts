import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  applyOperation,
  configureOperationApply,
  exportOperationRecord,
  importOperationRecord,
  type AppliedOperation,
  type PersistedOperationRecord,
} from "./operations.js";
import {
  ensurePrivateDirectory,
  resolveRuntimeStateDirectory,
  type RuntimeStateOptions,
} from "./runtime-state.js";

export const PLAN_SCHEMA_VERSION = 1 as const;
export const MAX_PLAN_BYTES = 50 * 1024 * 1024;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const IsoDateSchema = z.string().datetime({ offset: true });
const DiagnosticSchema = z
  .object({
    code: z.number().int(),
    category: z.string(),
    file: z.string().nullable(),
    line: z.number().int().positive().nullable(),
    column: z.number().int().positive().nullable(),
    message: z.string(),
  })
  .strict();
const DiagnosticDeltaSchema = z
  .object({
    added: z.array(DiagnosticSchema),
    removed: z.array(DiagnosticSchema),
    addedErrors: z.array(DiagnosticSchema),
  })
  .strict();
const AffectedFileSchema = z
  .object({
    file: z.string().min(1),
    original_hash: HashSchema,
    updated_hash: HashSchema,
  })
  .strict();
const PersistedFileSchema = AffectedFileSchema.extend({
  original_bytes_base64: z.string(),
  updated_bytes_base64: z.string(),
  mode: z.number().int().nonnegative(),
}).strict();
const PersistedOperationSchema = z
  .object({
    operation_id: z.string().uuid(),
    plan_hash: HashSchema,
    kind: z.enum(["rename_symbol", "replace_symbol_body"]),
    status: z.enum(["prepared", "applied"]),
    project_root: z.string().min(1),
    created_at: IsoDateSchema,
    expires_at: IsoDateSchema,
    affected_files: z.array(AffectedFileSchema).min(1),
    reference_count: z.number().int().nonnegative(),
    workspace_hash: HashSchema,
    post_workspace_hash: HashSchema,
    workspace_file_count: z.number().int().positive(),
    diagnostics: DiagnosticDeltaSchema,
    allow_new_errors: z.boolean(),
    blocked: z.boolean(),
    block_reason: z.string().nullable(),
    preview: z.string().nullable(),
    preview_truncated: z.boolean(),
    applied_at: IsoDateSchema.optional(),
    files: z.array(PersistedFileSchema).min(1),
  })
  .strict();
const PlanEnvelopeSchema = z
  .object({
    schema_version: z.literal(PLAN_SCHEMA_VERSION),
    operation: PersistedOperationSchema,
  })
  .strict();

interface PlanEnvelope {
  schema_version: typeof PLAN_SCHEMA_VERSION;
  operation: PersistedOperationRecord;
}

export type PersistPlanOptions = RuntimeStateOptions;

function stateDirectory(options: PersistPlanOptions): string {
  return resolveRuntimeStateDirectory(options);
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWritePlan(planFile: string, envelope: PlanEnvelope): Promise<void> {
  const directory = path.dirname(planFile);
  await ensurePrivateDirectory(directory);
  const serialized = `${JSON.stringify(envelope)}\n`;
  const bytes = Buffer.byteLength(serialized);
  if (bytes > MAX_PLAN_BYTES) {
    throw new Error(`Persisted plan is ${bytes} bytes; maximum is ${MAX_PLAN_BYTES}.`);
  }

  const temporaryPath = path.join(directory, `.${path.basename(planFile)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, planFile);
    if (process.platform !== "win32") await chmod(planFile, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readPlanEnvelope(planFileInput: string): Promise<{
  planFile: string;
  envelope: PlanEnvelope;
}> {
  const planFile = path.resolve(planFileInput);
  const flags =
    process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
  const handle = await open(planFile, flags);
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) throw new Error(`Plan path is not a regular file: ${planFile}`);
    const canonicalPlanFile = await realpath(planFile);
    const samePath =
      process.platform === "win32"
        ? canonicalPlanFile.toLowerCase() === planFile.toLowerCase()
        : canonicalPlanFile === planFile;
    if (!samePath) {
      throw new Error(`Plan path must not traverse symbolic links: ${planFile}`);
    }
    if (process.platform !== "win32" && fileStat.nlink !== 1) {
      throw new Error(`Plan file must have exactly one hard link: ${planFile}`);
    }
    const uid = process.getuid?.();
    if (uid !== undefined && fileStat.uid !== uid) {
      throw new Error(`Plan file is not owned by the current user: ${planFile}`);
    }
    if (fileStat.size > MAX_PLAN_BYTES) {
      throw new Error(`Persisted plan is ${fileStat.size} bytes; maximum is ${MAX_PLAN_BYTES}.`);
    }
    if (process.platform !== "win32" && (fileStat.mode & 0o077) !== 0) {
      throw new Error(`Plan file permissions are too broad; expected 0600: ${planFile}`);
    }
    const serialized = await handle.readFile({ encoding: "utf8" });
    const parsed = PlanEnvelopeSchema.parse(JSON.parse(serialized)) as PlanEnvelope;
    return { planFile, envelope: parsed };
  } finally {
    await handle.close();
  }
}

export async function persistOperationPlan(
  operationId: string,
  options: PersistPlanOptions = {},
): Promise<string> {
  const plansDirectory = path.join(stateDirectory(options), "plans");
  const planFile = path.join(plansDirectory, `${operationId}.astplan`);
  await atomicWritePlan(planFile, {
    schema_version: PLAN_SCHEMA_VERSION,
    operation: exportOperationRecord(operationId),
  });
  return planFile;
}

export async function applyPersistedOperation(
  planFileInput: string,
  planHash: string,
  options: PersistPlanOptions = {},
): Promise<AppliedOperation> {
  if (!/^[a-f0-9]{64}$/.test(planHash)) {
    throw new Error("plan_hash must be a 64-character lowercase SHA-256 digest.");
  }
  const current = await readPlanEnvelope(planFileInput);
  const operationId = current.envelope.operation.operation_id;
  importOperationRecord(current.envelope.operation, planHash);
  configureOperationApply(operationId, {
    stateDirectory: options.stateDirectory,
    receiptWriter: async () => {
      await atomicWritePlan(current.planFile, {
        schema_version: PLAN_SCHEMA_VERSION,
        operation: exportOperationRecord(operationId),
      });
    },
  });
  return applyOperation(operationId, planHash);
}

export async function inspectPersistedPlan(planFileInput: string): Promise<{
  schema_version: 1;
  operation_id: string;
  plan_hash: string;
  status: "prepared" | "applied";
  project_root: string;
  created_at: string;
  expires_at: string;
  affected_files: PersistedOperationRecord["affected_files"];
  blocked: boolean;
  block_reason: string | null;
  preview: string | null;
  preview_truncated: boolean;
}> {
  const { envelope } = await readPlanEnvelope(planFileInput);
  const operation = envelope.operation;
  return {
    schema_version: PLAN_SCHEMA_VERSION,
    operation_id: operation.operation_id,
    plan_hash: operation.plan_hash,
    status: operation.status,
    project_root: operation.project_root,
    created_at: operation.created_at,
    expires_at: operation.expires_at,
    affected_files: operation.affected_files,
    blocked: operation.blocked,
    block_reason: operation.block_reason,
    preview: operation.preview,
    preview_truncated: operation.preview_truncated,
  };
}
