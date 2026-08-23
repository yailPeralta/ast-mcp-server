import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor, type DoctorDependencies } from "../src/services/doctor.js";
import {
  beginProjectShutdown,
  clearProjectSessions,
  getProjectSessionRegistrySnapshot,
  getProjectStatus,
  reportSymbolIndexFailure,
  withProject,
} from "../src/services/project.js";
import { parseRuntimePolicy } from "../src/services/runtime-policy.js";

const roots: string[] = [];
afterEach(async () => {
  clearProjectSessions();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function dependencies(): DoctorDependencies {
  return {
    resolveProject: async (_project, cwd) => path.join(cwd, "tsconfig.json"),
    projectStatus: async (project) => ({
      authority: "registered",
      runtime_admission: "open",
      session_capacity: 8,
      status: await getProjectStatus(project),
    }),
    cache: async () => ({ state: "disabled", unsafe_entry_count: 0 }) as never,
    package: async () => ({ state: "ready", version: "0.11.0" }),
    setup: async () => ({ state: "ready" }),
    runtime: () => parseRuntimePolicy({}),
  };
}

function probes() {
  const values = dependencies();
  return {
    cache: values.cache,
    package: values.package,
    setup: values.setup,
    runtime: values.runtime,
  };
}

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-doctor-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const destination = path.join(root, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return root;
}

describe("doctor authorities", () => {
  it("reports dual and missing configs as structured actionable findings", async () => {
    const dual = await fixture({ "tsconfig.json": "{}", "jsconfig.json": "{}" });
    const missing = await fixture({ "src/value.ts": "export const value = 1;" });
    for (const [cwd, reason] of [
      [dual, "config_ambiguous"],
      [missing, "config_missing"],
    ]) {
      const result = await runDoctor({ cwd, executable: "ignored" }, probes());
      expect(result.status).toBe("failed");
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
      expect(result.checks.find((check) => check.code === "project_config")?.reason_code).toBe(
        reason,
      );
      const continuation = result.checks.find(
        (check) => check.code === "project_config",
      )?.continuation;
      expect(continuation).toContain("ast-tool doctor --project");
      expect(continuation).not.toMatch(/\[path-redacted\]|\/home|\/Users/);
      if (reason === "config_ambiguous") expect(continuation).toContain("'./tsconfig.json'");
    }
    const nested = path.join(dual, "nested", "cwd");
    await mkdir(nested, { recursive: true });
    const nestedAmbiguity = await runDoctor({ cwd: nested, executable: "ignored" }, probes());
    expect(
      nestedAmbiguity.checks.find((check) => check.code === "project_config")?.continuation,
    ).toContain("'../../tsconfig.json'");
  });

  it("peeks the registered compiler and degraded index authority", async () => {
    const root = await fixture({ "tsconfig.json": "{}" });
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(root, ".cache"));
    await getProjectStatus(root);
    await reportSymbolIndexFailure(root, "capability_unavailable");
    const result = await runDoctor({ cwd: root, executable: "ignored" }, probes());
    expect(result.checks.find((check) => check.code === "compiler")).toMatchObject({
      status: "healthy",
      reason_code: "compiler_ready",
    });
    expect(result.checks.find((check) => check.code === "derived_index")).toMatchObject({
      status: "degraded",
      reason_code: "index_degraded_compiler_ready",
    });
  });

  it("peeks real closed admission instead of an isolated open scheduler", async () => {
    const root = await fixture({ "tsconfig.json": "{}" });
    await getProjectStatus(root);
    beginProjectShutdown();
    const result = await runDoctor({ cwd: root, executable: "ignored" }, probes());
    expect(result.checks.find((check) => check.code === "operation_queue")).toMatchObject({
      status: "degraded",
      reason_code: "runtime_admission_closed",
    });
  });

  it("preserves active sessions and never mutates persistence during concurrent diagnosis", async () => {
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    const first = await fixture({ "tsconfig.json": "{}" });
    const second = await fixture({ "tsconfig.json": "{}" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const active = withProject(first, () => gate);
    await vi.waitFor(() => expect(getProjectSessionRegistrySnapshot().active_sessions).toBe(1));
    const diagnoses = Promise.all([
      runDoctor({ cwd: first, executable: "ignored" }, probes()),
      runDoctor({ cwd: second, executable: "ignored" }, probes()),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(process.env.AST_SYMBOL_INDEX_PERSISTENCE).toBe("canary");
    release();
    await Promise.all([active, diagnoses]);
    expect(process.env.AST_SYMBOL_INDEX_PERSISTENCE).toBe("canary");
    expect(getProjectSessionRegistrySnapshot()).toMatchObject({
      session_count: 1,
      idle_sessions: 1,
    });
  });

  it("returns runnable relative remediations without invented paths", async () => {
    const root = await fixture({});
    const requested = "missing 'project";
    const result = await runDoctor(
      { cwd: root, project: requested, executable: "ignored" },
      probes(),
    );
    const continuation = result.checks.find(
      (check) => check.code === "project_config",
    )?.continuation;
    expect(continuation).toContain("ast-tool doctor --project './missing '\\''project'");
    expect(continuation).not.toMatch(/tsconfig|\[path-redacted\]|\/home|\/Users/);

    await writeFile(path.join(root, "tsconfig.json"), "{}");
    await symlink(path.join(root, "tsconfig.json"), path.join(root, "linked.json"));
    const unsafe = await runDoctor(
      { cwd: root, project: "linked.json", executable: "ignored" },
      probes(),
    );
    expect(unsafe.checks.find((check) => check.code === "project_config")).toMatchObject({
      reason_code: "config_unsafe",
      continuation: expect.stringContaining("ast-tool doctor --project './linked.json'"),
    });

    const hostileAbsolute = await runDoctor(
      { cwd: root, project: "/home/private/project", executable: "ignored" },
      probes(),
    );
    const serialized = JSON.stringify(hostileAbsolute);
    expect(serialized).not.toContain("[path-redacted]");
    expect(serialized).not.toContain("--project '/");
    expect(serialized).toContain("ast-tool doctor --project");
  });

  it("maps hostile authority exceptions without exposing their content", async () => {
    const root = await fixture({ "tsconfig.json": "{}" });
    const hostile = async () => {
      throw new Error("token=private /home/private argv --secret");
    };
    const result = await runDoctor(
      { cwd: root, executable: "ignored" },
      {
        ...dependencies(),
        projectStatus: hostile,
        cache: hostile,
        package: hostile,
        setup: hostile,
      },
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/private|\/home|argv|--secret/);
    expect(result.checks.find((check) => check.code === "compiler")?.reason_code).toBe(
      "compiler_creation_failed",
    );
    expect(result.checks).toHaveLength(9);
    expect(
      result.checks
        .filter((check) => ["watcher", "derived_index", "operation_queue"].includes(check.code))
        .every((check) => check.status === "not_run"),
    ).toBe(true);
  });

  it("does not write project files and leaves no diagnostic state", async () => {
    const root = await fixture({
      "tsconfig.json": JSON.stringify({ include: ["src/**/*.ts"] }),
      "src/value.ts": "export const value = 1;\n",
    });
    const before = {
      files: await readdir(root, { recursive: true }),
      config: await readFile(path.join(root, "tsconfig.json"), "utf8"),
      source: await readFile(path.join(root, "src/value.ts"), "utf8"),
    };
    const result = await runDoctor(
      {
        cwd: root,
        executable: "ignored",
        environment: { AST_SYMBOL_INDEX_PERSISTENCE: "disabled", PATH: "" },
      },
      probes(),
    );
    expect(result.status).toBe("healthy");
    expect({
      files: await readdir(root, { recursive: true }),
      config: await readFile(path.join(root, "tsconfig.json"), "utf8"),
      source: await readFile(path.join(root, "src/value.ts"), "utf8"),
    }).toEqual(before);
  });
});
