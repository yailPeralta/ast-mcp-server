import { describe, expect, it, vi } from "vitest";
import { loadRuntimeModule } from "../src/index.js";
import {
  createCompilerWorkerSpawnSpec,
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
      compilerWorkerIdleTtlMs: 60_000,
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
      "compilerWorkerMode",
      "compilerWorkerIdleTtlMs",
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
      "AST_COMPILER_WORKER_MODE",
      "AST_COMPILER_WORKER_IDLE_TTL_MS",
    ] satisfies RuntimePolicyEnvironmentKey[]);
  });

  it("selects supervised mode only by explicit valid opt-in and supports TTL zero", () => {
    const supervised = parseRuntimePolicy({
      AST_COMPILER_WORKER_MODE: "supervised",
      AST_COMPILER_WORKER_IDLE_TTL_MS: "0",
    });
    const invalid = parseRuntimePolicy({ AST_COMPILER_WORKER_MODE: "fork $(touch nope)" });
    expect(supervised.compilerWorkerMode).toBe("supervised");
    expect(supervised.compilerWorkerIdleTtlMs).toBe(0);
    expect(invalid.compilerWorkerMode).toBe("in_process");
    expect(invalid.reasons.AST_COMPILER_WORKER_MODE).toBe("invalid_mode");
  });
  it("loads only the selected runtime module", async () => {
    const inProcess = vi.fn(async () => "local");
    const supervised = vi.fn(async () => "child");
    const loaders = { inProcess, supervised };
    await expect(loadRuntimeModule(parseRuntimePolicy({}), loaders)).resolves.toEqual({
      mode: "in_process",
      module: "local",
    });
    expect([inProcess.mock.calls.length, supervised.mock.calls.length]).toEqual([1, 0]);
    vi.clearAllMocks();
    const policy = parseRuntimePolicy({ AST_COMPILER_WORKER_MODE: "supervised" });
    await expect(loadRuntimeModule(policy, loaders)).resolves.toEqual({
      mode: "supervised",
      module: "child",
    });
    expect([inProcess.mock.calls.length, supervised.mock.calls.length]).toEqual([0, 1]);
  });
  it("builds a fixed shell-free spawn spec from a closed environment allowlist", () => {
    const result = createCompilerWorkerSpawnSpec("/app/dist/compiler-worker-entry.js", {
      XDG_CACHE_HOME: "/tmp/cache;echo data",
      AST_MAX_PROJECT_SESSIONS: "12",
      NODE_OPTIONS: "--import=/tmp/hostile.mjs",
      LD_PRELOAD: "/tmp/inject.so",
      AST_COMPILER_WORKER_MODE: "supervised",
    });
    expect(result).toMatchObject({
      ok: true,
      command: process.execPath,
      args: ["/app/dist/compiler-worker-entry.js"],
      options: {
        shell: false,
        env: { XDG_CACHE_HOME: "/tmp/cache;echo data", AST_MAX_PROJECT_SESSIONS: "12" },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/NODE_OPTIONS|LD_PRELOAD|AST_COMPILER_WORKER_MODE/);
  });
  it("fails projection before spawn for NUL, oversized, or non-string allowed values", () => {
    for (const environment of [
      { HOME: "/home/worker\0hidden" },
      { XDG_CACHE_HOME: `/${"x".repeat(4097)}` },
      { AST_SYMBOL_INDEX_CACHE_ROOT: 7 },
    ]) {
      expect(createCompilerWorkerSpawnSpec("/app/worker.js", environment)).toEqual({
        ok: false,
        reason: "invalid_environment",
      });
    }
  });
});
