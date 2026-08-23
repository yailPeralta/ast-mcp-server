import { describe, expect, it } from "vitest";
import { evaluateDoctor, type DoctorEvidence } from "../src/services/doctor-model.js";

function healthy(): DoctorEvidence {
  return {
    runtime_invalid: false,
    project_authority: "registered",
    runtime_admission: "open",
    config: { state: "ready" },
    project: {
      compiler: { state: "ready" },
      watcher: { state: "ready" },
      index: { state: "disabled" },
      operation_queue: {
        admission: "open",
        rejected_operations: 0,
        queue_timeout_operations: 0,
        deadline_exceeded_operations: 0,
      },
    },
    cache: { state: "ready", unsafe_entry_count: 0 },
    package: { state: "ready", version: "0.11.0" },
    setup: { state: "ready" },
  };
}

describe("doctor diagnostic model", () => {
  it("returns bounded ordered healthy checks for a healthy project", () => {
    const result = evaluateDoctor(healthy());
    expect(result).toMatchObject({ schema_version: 1, status: "healthy" });
    expect(result.checks.map((check) => check.code)).toEqual([
      "runtime_policy",
      "project_config",
      "compiler",
      "watcher",
      "derived_index",
      "operation_queue",
      "index_cache",
      "package",
      "client_setup",
    ]);
    expect(result.checks).toHaveLength(9);
    expect(result.checks.every((check) => check.status === "healthy")).toBe(true);
  });

  it("keeps compiler-ready separate from a degraded derived index", () => {
    const evidence = healthy();
    evidence.project!.index.state = "failed";
    const result = evaluateDoctor(evidence);
    expect(result.status).toBe("degraded");
    expect(result.checks.find((check) => check.code === "compiler")).toMatchObject({
      status: "healthy",
      reason_code: "compiler_ready",
    });
    expect(result.checks.find((check) => check.code === "derived_index")).toMatchObject({
      status: "degraded",
      reason_code: "index_degraded_compiler_ready",
      continuation: "Run: ast-tool cache inspect",
    });
  });

  it("keeps all check positions when project evidence is unavailable", () => {
    const evidence = healthy();
    evidence.config = { state: "missing", continuation: "Run: ast-tool doctor --project '.'" };
    delete evidence.project;
    const missing = evaluateDoctor(evidence);
    expect(missing.checks).toHaveLength(9);
    expect(missing.checks.slice(2, 6).every((check) => check.status === "not_run")).toBe(true);

    evidence.config = { state: "ready" };
    const failed = evaluateDoctor(evidence);
    expect(failed.checks.find((check) => check.code === "compiler")).toMatchObject({
      status: "failed",
      reason_code: "compiler_creation_failed",
    });
    expect(failed.checks.slice(3, 6).every((check) => check.status === "not_run")).toBe(true);
  });

  it("maps config, watcher, cache, queue, package, and setup failures stably", () => {
    const evidence = healthy();
    evidence.runtime_invalid = true;
    evidence.config = { state: "ambiguous", continuation: "Run: ast-tool doctor --project a.json" };
    evidence.project!.watcher.state = "failed";
    evidence.project!.operation_queue.admission = "closed";
    evidence.cache = { state: "failed", unsafe_entry_count: 1 };
    evidence.package = { state: "unsupported" };
    evidence.setup = { state: "conflict" };
    const result = evaluateDoctor(evidence);
    expect(result.status).toBe("failed");
    expect(
      Object.fromEntries(result.checks.map((check) => [check.code, check.reason_code])),
    ).toMatchObject({
      runtime_policy: "invalid_runtime_policy",
      project_config: "config_ambiguous",
      watcher: "watcher_failed",
      operation_queue: "queue_pressure",
      index_cache: "cache_unsafe",
      package: "package_unsupported",
      client_setup: "setup_conflict",
    });
  });

  it("sanitizes hostile evidence and limits each check to one continuation", () => {
    const evidence = healthy();
    evidence.package.version = "token=private /home/private/project";
    evidence.config = {
      state: "unsafe",
      continuation: "password=hunter2 /Users/private/config",
    };
    const serialized = JSON.stringify(evaluateDoctor(evidence));
    expect(serialized).not.toMatch(/private|hunter2|\/home|\/Users/);
    expect(serialized).toContain("[REDACTED]");
  });
});
