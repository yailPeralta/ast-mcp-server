import path from "node:path";
import packageMetadata from "../../package.json" with { type: "json" };
export const RUNTIME_POLICY_ENV_KEYS = Object.freeze([
  "AST_MAX_PROJECT_SESSIONS",
  "AST_MAX_QUEUED_OPERATIONS_PER_PROJECT",
  "AST_QUEUE_WAIT_TIMEOUT_MS",
  "AST_OPERATION_DEADLINE_MS",
  "AST_SHUTDOWN_DRAIN_TIMEOUT_MS",
  "AST_COMPILER_WORKER_MODE",
  "AST_COMPILER_WORKER_IDLE_TTL_MS",
  "AST_MCP_APPLY_GUARD",
  "AST_MCP_TEXT_PROJECTION",
] as const);

export type RuntimePolicyEnvironmentKey = (typeof RUNTIME_POLICY_ENV_KEYS)[number];
export type RuntimePolicyReason =
  "default" | "configured" | "invalid_integer" | "invalid_mode" | "out_of_range";

export type RuntimePolicyEnvironment = Readonly<Record<string, unknown>>;
export type RuntimePolicyReasons = Readonly<
  Record<RuntimePolicyEnvironmentKey, RuntimePolicyReason>
>;

export interface RuntimePolicy {
  readonly maxProjectSessions: number;
  readonly maxQueuedOperationsPerProject: number;
  readonly queueWaitTimeoutMs: number;
  readonly operationDeadlineMs: number;
  readonly shutdownDrainTimeoutMs: number;
  readonly compilerWorkerMode: "in_process" | "supervised";
  readonly compilerWorkerIdleTtlMs: number;
  /** Deny every apply-effect MCP tool at registration (deny-by-default apply guard). */
  readonly denyApply: boolean;
  /** Add canonical JSON text for hosts that do not render structured MCP success values. */
  readonly projectStructuredContentAsText: boolean;
  readonly reasons: RuntimePolicyReasons;
}

interface ParsedPolicyValue {
  readonly value: number;
  readonly reason: RuntimePolicyReason;
}

function parseBoundedInteger(
  rawValue: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number,
): ParsedPolicyValue {
  if (rawValue === undefined) return { value: defaultValue, reason: "default" };
  if (typeof rawValue !== "string" || !/^-?\d+$/.test(rawValue)) {
    return { value: defaultValue, reason: "invalid_integer" };
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    return { value: defaultValue, reason: "invalid_integer" };
  }
  if (value < minimum || value > maximum) {
    return { value: defaultValue, reason: "out_of_range" };
  }
  return { value, reason: "configured" };
}

export function parseRuntimePolicy(environment: RuntimePolicyEnvironment): RuntimePolicy {
  const maxProjectSessions = parseBoundedInteger(environment.AST_MAX_PROJECT_SESSIONS, 8, 1, 32);
  const maxQueuedOperationsPerProject = parseBoundedInteger(
    environment.AST_MAX_QUEUED_OPERATIONS_PER_PROJECT,
    32,
    1,
    256,
  );
  const queueWaitTimeoutMs = parseBoundedInteger(
    environment.AST_QUEUE_WAIT_TIMEOUT_MS,
    packageMetadata.deepseekHarness.timeoutBudget.queueWaitMs,
    100,
    300_000,
  );
  const operationDeadlineMs = parseBoundedInteger(
    environment.AST_OPERATION_DEADLINE_MS,
    packageMetadata.deepseekHarness.timeoutBudget.executionDeadlineMs,
    1_000,
    900_000,
  );
  const shutdownDrainTimeoutMs = parseBoundedInteger(
    environment.AST_SHUTDOWN_DRAIN_TIMEOUT_MS,
    10_000,
    100,
    60_000,
  );
  const rawWorkerMode = environment.AST_COMPILER_WORKER_MODE;
  const compilerWorkerMode = rawWorkerMode === "supervised" ? "supervised" : "in_process";
  const compilerWorkerModeReason: RuntimePolicyReason =
    rawWorkerMode === undefined
      ? "default"
      : rawWorkerMode === "in_process" || rawWorkerMode === "supervised"
        ? "configured"
        : "invalid_mode";
  const compilerWorkerIdleTtlMs = parseBoundedInteger(
    environment.AST_COMPILER_WORKER_IDLE_TTL_MS,
    60_000,
    0,
    86_400_000,
  );
  const rawApplyGuard = environment.AST_MCP_APPLY_GUARD;
  // Fail-closed: only an explicit `allow` permits the apply-effect MCP tool on
  // this surface. A missing value, `deny`, or any invalid value denies apply.
  const denyApply = rawApplyGuard !== "allow";
  const applyGuardReason: RuntimePolicyReason =
    rawApplyGuard === undefined
      ? "default"
      : rawApplyGuard === "allow" || rawApplyGuard === "deny"
        ? "configured"
        : "invalid_mode";
  const rawTextProjection = environment.AST_MCP_TEXT_PROJECTION;
  const projectStructuredContentAsText = rawTextProjection === "canonical_json";
  const textProjectionReason: RuntimePolicyReason =
    rawTextProjection === undefined
      ? "default"
      : projectStructuredContentAsText
        ? "configured"
        : "invalid_mode";

  const reasons: RuntimePolicyReasons = Object.freeze({
    AST_MAX_PROJECT_SESSIONS: maxProjectSessions.reason,
    AST_MAX_QUEUED_OPERATIONS_PER_PROJECT: maxQueuedOperationsPerProject.reason,
    AST_QUEUE_WAIT_TIMEOUT_MS: queueWaitTimeoutMs.reason,
    AST_OPERATION_DEADLINE_MS: operationDeadlineMs.reason,
    AST_SHUTDOWN_DRAIN_TIMEOUT_MS: shutdownDrainTimeoutMs.reason,
    AST_COMPILER_WORKER_MODE: compilerWorkerModeReason,
    AST_COMPILER_WORKER_IDLE_TTL_MS: compilerWorkerIdleTtlMs.reason,
    AST_MCP_APPLY_GUARD: applyGuardReason,
    AST_MCP_TEXT_PROJECTION: textProjectionReason,
  });

  return Object.freeze({
    maxProjectSessions: maxProjectSessions.value,
    maxQueuedOperationsPerProject: maxQueuedOperationsPerProject.value,
    queueWaitTimeoutMs: queueWaitTimeoutMs.value,
    operationDeadlineMs: operationDeadlineMs.value,
    shutdownDrainTimeoutMs: shutdownDrainTimeoutMs.value,
    compilerWorkerMode,
    compilerWorkerIdleTtlMs: compilerWorkerIdleTtlMs.value,
    denyApply,
    projectStructuredContentAsText,
    reasons,
  });
}

const WORKER_PATH_KEYS = ["HOME", "XDG_CACHE_HOME", "AST_SYMBOL_INDEX_CACHE_ROOT"] as const;
const WORKER_ENV_KEYS = [
  ...WORKER_PATH_KEYS,
  "AST_SYMBOL_INDEX_PERSISTENCE",
  "AST_SYMBOL_INDEX_BUSY_TIMEOUT_MS",
] as const;
const MAX_WORKER_ENV_VALUE_LENGTH = 4096;
function validEnvironmentString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_WORKER_ENV_VALUE_LENGTH &&
    !value.includes("\0")
  );
}
export function createCompilerWorkerSpawnSpec(
  workerEntryPath: string,
  environment: RuntimePolicyEnvironment,
) {
  const projected: Record<string, string> = {};
  for (const key of WORKER_ENV_KEYS) {
    const value = environment[key];
    if (value === undefined) continue;
    if (!validEnvironmentString(value))
      return { ok: false, reason: "invalid_environment" as const };
    const isPath = WORKER_PATH_KEYS.includes(key as (typeof WORKER_PATH_KEYS)[number]);
    const invalidMode =
      key === "AST_SYMBOL_INDEX_PERSISTENCE" && !["disabled", "canary", "enabled"].includes(value);
    const invalidTimeout =
      key === "AST_SYMBOL_INDEX_BUSY_TIMEOUT_MS" &&
      parseBoundedInteger(value, 1_000, 1, 60_000).reason !== "configured";
    if (
      (isPath && (!path.isAbsolute(value) || path.normalize(value) !== value)) ||
      invalidMode ||
      invalidTimeout
    ) {
      return { ok: false, reason: "invalid_environment" as const };
    }
    projected[key] = value;
  }
  const policy = parseRuntimePolicy(environment);
  Object.assign(projected, {
    AST_MAX_PROJECT_SESSIONS: String(policy.maxProjectSessions),
    AST_MAX_QUEUED_OPERATIONS_PER_PROJECT: String(policy.maxQueuedOperationsPerProject),
    AST_QUEUE_WAIT_TIMEOUT_MS: String(policy.queueWaitTimeoutMs),
    AST_OPERATION_DEADLINE_MS: String(policy.operationDeadlineMs),
    AST_SHUTDOWN_DRAIN_TIMEOUT_MS: String(policy.shutdownDrainTimeoutMs),
    // Forward the parent's resolved apply-guard policy so the supervised worker
    // registers the same tool surface (deny-by-default fail-closed, allow opt-in).
    AST_MCP_APPLY_GUARD: policy.denyApply ? "deny" : "allow",
    ...(policy.projectStructuredContentAsText ? { AST_MCP_TEXT_PROJECTION: "canonical_json" } : {}),
  });
  return {
    ok: true,
    command: process.execPath,
    args: [workerEntryPath],
    options: { shell: false, env: projected },
  };
}

export function readRuntimePolicy(
  environment: RuntimePolicyEnvironment = process.env,
): RuntimePolicy {
  return parseRuntimePolicy(environment);
}
