import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectSessions,
  getDiagnosticProjectStatus,
  getProjectOperationQueueSnapshot,
  getProjectSessionRegistrySnapshot,
  getProjectStatus,
  invalidateProject,
  withProject,
} from "../src/services/project.js";

const roots: string[] = [];
afterEach(async () => {
  clearProjectSessions();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(config = "{}") {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-diagnostic-project-"));
  roots.push(root);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "tsconfig.json"), config);
  await writeFile(path.join(root, "src", "value.ts"), "export const value = 1;\n");
  return root;
}

describe("isolated diagnostic project status", () => {
  it("preserves an existing idle session, watcher, and registry capacity", async () => {
    vi.stubEnv("AST_MAX_PROJECT_SESSIONS", "1");
    const existing = await fixture();
    const inspected = await fixture();
    const initial = await getProjectStatus(existing);
    const registry = getProjectSessionRegistrySnapshot();
    const queue = getProjectOperationQueueSnapshot(existing);
    await expect(getDiagnosticProjectStatus(inspected)).resolves.toMatchObject({
      authority: "isolated",
      status: { compiler: { state: "ready" }, index: { state: "disabled" } },
    });
    expect(getProjectSessionRegistrySnapshot()).toEqual(registry);
    expect(getProjectOperationQueueSnapshot(existing)).toEqual(queue);
    expect((await getProjectStatus(existing)).watcher).toEqual(initial.watcher);
  });

  it("keeps foreign sessions safe when authority appears or disappears around peek", async () => {
    const root = await fixture();
    await getProjectStatus(root);
    await expect(getDiagnosticProjectStatus(root)).resolves.toMatchObject({
      authority: "registered",
    });
    invalidateProject(root);
    const isolated = getDiagnosticProjectStatus(root);
    await getProjectStatus(root);
    await expect(isolated).resolves.toMatchObject({ authority: "isolated" });
    expect(getProjectSessionRegistrySnapshot()).toMatchObject({ session_count: 1 });
  });

  it("runs concurrently without mutating persistence or registered active state", async () => {
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    const first = await fixture();
    const second = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const active = withProject(first, () => gate);
    await vi.waitFor(() => expect(getProjectSessionRegistrySnapshot().active_sessions).toBe(1));
    const diagnoses = Promise.all([
      getDiagnosticProjectStatus(first),
      getDiagnosticProjectStatus(first),
      getDiagnosticProjectStatus(second),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(process.env.AST_SYMBOL_INDEX_PERSISTENCE).toBe("canary");
    expect(getProjectSessionRegistrySnapshot()).toMatchObject({
      session_count: 1,
      active_sessions: 1,
    });
    release();
    await Promise.all([active, diagnoses]);
    expect(getProjectSessionRegistrySnapshot()).toMatchObject({
      session_count: 1,
      idle_sessions: 1,
    });
  });

  it("leaves no registered state or cache when compiler creation fails", async () => {
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    const invalid = await fixture("{");
    await expect(getDiagnosticProjectStatus(invalid)).rejects.toThrow();
    expect(getProjectSessionRegistrySnapshot().session_count).toBe(0);
    expect(process.env.AST_SYMBOL_INDEX_PERSISTENCE).toBe("canary");
  });
});
