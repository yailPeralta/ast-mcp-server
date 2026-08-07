export const RUNTIME_POLICY_ENV_KEYS = Object.freeze([
  "AST_MAX_PROJECT_SESSIONS",
  "AST_MAX_QUEUED_OPERATIONS_PER_PROJECT",
  "AST_QUEUE_WAIT_TIMEOUT_MS",
  "AST_OPERATION_DEADLINE_MS",
  "AST_SHUTDOWN_DRAIN_TIMEOUT_MS",
] as const);

export type RuntimePolicyEnvironmentKey = (typeof RUNTIME_POLICY_ENV_KEYS)[number];
export type RuntimePolicyReason = "default" | "configured" | "invalid_integer" | "out_of_range";

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
    30_000,
    100,
    300_000,
  );
  const operationDeadlineMs = parseBoundedInteger(
    environment.AST_OPERATION_DEADLINE_MS,
    120_000,
    1_000,
    900_000,
  );
  const shutdownDrainTimeoutMs = parseBoundedInteger(
    environment.AST_SHUTDOWN_DRAIN_TIMEOUT_MS,
    10_000,
    100,
    60_000,
  );

  const reasons: RuntimePolicyReasons = Object.freeze({
    AST_MAX_PROJECT_SESSIONS: maxProjectSessions.reason,
    AST_MAX_QUEUED_OPERATIONS_PER_PROJECT: maxQueuedOperationsPerProject.reason,
    AST_QUEUE_WAIT_TIMEOUT_MS: queueWaitTimeoutMs.reason,
    AST_OPERATION_DEADLINE_MS: operationDeadlineMs.reason,
    AST_SHUTDOWN_DRAIN_TIMEOUT_MS: shutdownDrainTimeoutMs.reason,
  });

  return Object.freeze({
    maxProjectSessions: maxProjectSessions.value,
    maxQueuedOperationsPerProject: maxQueuedOperationsPerProject.value,
    queueWaitTimeoutMs: queueWaitTimeoutMs.value,
    operationDeadlineMs: operationDeadlineMs.value,
    shutdownDrainTimeoutMs: shutdownDrainTimeoutMs.value,
    reasons,
  });
}

export function readRuntimePolicy(
  environment: RuntimePolicyEnvironment = process.env,
): RuntimePolicy {
  return parseRuntimePolicy(environment);
}
