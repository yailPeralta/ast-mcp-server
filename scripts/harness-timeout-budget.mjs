const TIMEOUT_BUDGET_KEYS = ["queueWaitMs", "executionDeadlineMs", "marginMs", "outerToolCallMs"];

export function validateTimeoutBudget(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("timeout budget must be an object");
  }
  for (const key of TIMEOUT_BUDGET_KEYS) {
    if (!Number.isSafeInteger(value[key])) {
      throw new TypeError(`timeout budget ${key} must be a safe integer`);
    }
  }
  if (value.queueWaitMs < 0 || value.executionDeadlineMs < 0) {
    throw new RangeError("AST timeout budgets must not be negative");
  }
  if (value.marginMs <= 0) {
    throw new RangeError("timeout budget marginMs must be positive");
  }
  const requiredHeadroom = value.queueWaitMs + value.executionDeadlineMs + value.marginMs;
  if (value.outerToolCallMs <= requiredHeadroom) {
    throw new RangeError("outerToolCallMs must exceed the complete AST budget and margin");
  }
  return Object.freeze({
    queueWaitMs: value.queueWaitMs,
    executionDeadlineMs: value.executionDeadlineMs,
    marginMs: value.marginMs,
    outerToolCallMs: value.outerToolCallMs,
  });
}
