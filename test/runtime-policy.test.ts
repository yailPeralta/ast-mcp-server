import { describe, expect, it } from "vitest";
import {
  RUNTIME_POLICY_ENV_KEYS,
  parseRuntimePolicy,
  type RuntimePolicyEnvironmentKey,
} from "../src/services/runtime-policy.js";

const policyCases = [
  {
    environmentKey: "AST_MAX_PROJECT_SESSIONS",
    policyKey: "maxProjectSessions",
    defaultValue: 8,
    minimum: 1,
    maximum: 32,
  },
  {
    environmentKey: "AST_MAX_QUEUED_OPERATIONS_PER_PROJECT",
    policyKey: "maxQueuedOperationsPerProject",
    defaultValue: 32,
    minimum: 1,
    maximum: 256,
  },
  {
    environmentKey: "AST_QUEUE_WAIT_TIMEOUT_MS",
    policyKey: "queueWaitTimeoutMs",
    defaultValue: 30_000,
    minimum: 100,
    maximum: 300_000,
  },
  {
    environmentKey: "AST_OPERATION_DEADLINE_MS",
    policyKey: "operationDeadlineMs",
    defaultValue: 120_000,
    minimum: 1_000,
    maximum: 900_000,
  },
  {
    environmentKey: "AST_SHUTDOWN_DRAIN_TIMEOUT_MS",
    policyKey: "shutdownDrainTimeoutMs",
    defaultValue: 10_000,
    minimum: 100,
    maximum: 60_000,
  },
] as const;

describe("runtime policy", () => {
  it("uses conservative defaults without reading ambient process state", () => {
    const policy = parseRuntimePolicy({});

    expect(policy).toMatchObject({
      maxProjectSessions: 8,
      maxQueuedOperationsPerProject: 32,
      queueWaitTimeoutMs: 30_000,
      operationDeadlineMs: 120_000,
      shutdownDrainTimeoutMs: 10_000,
    });
    expect(policy.reasons).toEqual(
      Object.fromEntries(RUNTIME_POLICY_ENV_KEYS.map((key) => [key, "default"])),
    );
  });

  it.each(policyCases)(
    "accepts the inclusive bounds for $environmentKey",
    ({ environmentKey, policyKey, minimum, maximum }) => {
      const minimumPolicy = parseRuntimePolicy({ [environmentKey]: String(minimum) });
      const maximumPolicy = parseRuntimePolicy({ [environmentKey]: String(maximum) });

      expect(minimumPolicy[policyKey]).toBe(minimum);
      expect(minimumPolicy.reasons[environmentKey]).toBe("configured");
      expect(maximumPolicy[policyKey]).toBe(maximum);
      expect(maximumPolicy.reasons[environmentKey]).toBe("configured");
    },
  );

  it.each(policyCases)(
    "falls back for out-of-range integers in $environmentKey",
    ({ environmentKey, policyKey, defaultValue, minimum, maximum }) => {
      for (const value of [minimum - 1, -1, 0, maximum + 1]) {
        const policy = parseRuntimePolicy({ [environmentKey]: String(value) });

        expect(policy[policyKey]).toBe(defaultValue);
        expect(policy.reasons[environmentKey]).toBe("out_of_range");
      }
    },
  );

  it.each(policyCases)(
    "falls back for malformed, non-integer and overflow values in $environmentKey",
    ({ environmentKey, policyKey, defaultValue }) => {
      for (const value of ["", " ", "NaN", "Infinity", "1.5", "1e3", "+1", "9007199254740992"]) {
        const policy = parseRuntimePolicy({ [environmentKey]: value });

        expect(policy[policyKey]).toBe(defaultValue);
        expect(policy.reasons[environmentKey]).toBe("invalid_integer");
        expect(Object.values(policy)).not.toContain(value);
        expect(Object.values(policy.reasons)).not.toContain(value);
      }
    },
  );

  it("rejects hostile non-string runtime values without throwing or retaining them", () => {
    for (const value of [null, 7, true, {}, [], Symbol("runtime-policy")]) {
      const policy = parseRuntimePolicy({ AST_MAX_PROJECT_SESSIONS: value });

      expect(policy.maxProjectSessions).toBe(8);
      expect(policy.reasons.AST_MAX_PROJECT_SESSIONS).toBe("invalid_integer");
      expect(Object.values(policy)).not.toContain(value);
      expect(Object.values(policy.reasons)).not.toContain(value);
    }
  });

  it("freezes the public vocabulary, policy and reason map at runtime", () => {
    const policy = parseRuntimePolicy({ AST_MAX_PROJECT_SESSIONS: "12" });

    expect(Object.keys(policy)).toEqual([
      "maxProjectSessions",
      "maxQueuedOperationsPerProject",
      "queueWaitTimeoutMs",
      "operationDeadlineMs",
      "shutdownDrainTimeoutMs",
      "reasons",
    ]);
    expect(Object.isFrozen(RUNTIME_POLICY_ENV_KEYS)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.reasons)).toBe(true);
    expect(Reflect.set(RUNTIME_POLICY_ENV_KEYS, 0, "UNSUPPORTED_KEY")).toBe(false);
    expect(Reflect.set(policy, "maxProjectSessions", 31)).toBe(false);
    expect(Reflect.set(policy.reasons, "AST_MAX_PROJECT_SESSIONS", "default")).toBe(false);
    expect(policy.maxProjectSessions).toBe(12);
    expect(policy.reasons.AST_MAX_PROJECT_SESSIONS).toBe("configured");
  });

  it("ignores unsupported variables and exposes only closed safe reasons", () => {
    const environment = {
      AST_MAX_PROJECT_SESSIONS: "not-a-number-containing-sensitive-text",
      AST_MAX_QUEUED_OPERATIONS_GLOBAL: "2048",
    };

    const policy = parseRuntimePolicy(environment);

    expect(policy.maxProjectSessions).toBe(8);
    expect(policy.reasons.AST_MAX_PROJECT_SESSIONS).toBe("invalid_integer");
    expect(Object.keys(policy.reasons)).toEqual(RUNTIME_POLICY_ENV_KEYS);
    expect(JSON.stringify(policy)).not.toContain(environment.AST_MAX_PROJECT_SESSIONS);
    expect(JSON.stringify(policy)).not.toContain("AST_MAX_QUEUED_OPERATIONS_GLOBAL");
  });

  it("exports the exact approved environment-key vocabulary", () => {
    expect(RUNTIME_POLICY_ENV_KEYS).toEqual([
      "AST_MAX_PROJECT_SESSIONS",
      "AST_MAX_QUEUED_OPERATIONS_PER_PROJECT",
      "AST_QUEUE_WAIT_TIMEOUT_MS",
      "AST_OPERATION_DEADLINE_MS",
      "AST_SHUTDOWN_DRAIN_TIMEOUT_MS",
    ] satisfies RuntimePolicyEnvironmentKey[]);
  });
});
