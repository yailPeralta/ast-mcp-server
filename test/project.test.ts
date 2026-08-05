import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectSessions,
  createFreshProject,
  getProjectStatus,
  getSourceFileOrThrow,
  withProject,
} from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  clearProjectSessions();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.remove()));
});

describe("project sessions", () => {
  it("tracks bounded freshness metadata on the serialized project session", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);

    const initial = createFreshProject(fixture.root);
    expect(initial.status.state).toBe("pending");
    expect(initial.status.lastSuccessfulSyncAt).toBeNull();
    expect(initial.status.index).toEqual({ state: "disabled" });

    const synchronized = await withProject(fixture.root, ({ status }) => status);

    expect(synchronized.state).toBe("fresh");
    expect(synchronized.sourceCount).toBe(1);
    expect(synchronized.indexedCount).toBe(0);
    expect(synchronized.index).toEqual({ state: "disabled" });
    expect(synchronized.lastSuccessfulSyncAt).toMatch(/Z$/);
    expect(synchronized.sourceSnapshotFingerprint).toMatch(/^source_/);
    expect(synchronized.configSnapshotFingerprint).toMatch(/^config_/);
    expect(synchronized.canonicalSnapshotFingerprint).toMatch(/^snapshot_/);
  });

  it("refreshes externally modified source files before the next operation", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const before = 1;\n",
    });
    fixtures.push(fixture);

    const first = await withProject(fixture.root, ({ project }) =>
      getSourceFileOrThrow(project, "src/value.ts").getText(),
    );
    expect(first).toContain("before");

    await fixture.write("src/value.ts", "export const after = 2;\n");

    const second = await withProject(fixture.root, ({ project }) =>
      getSourceFileOrThrow(project, "src/value.ts").getText(),
    );
    expect(second).toContain("after");
    expect(second).not.toContain("before");
  });

  it("recomputes source freshness fingerprints after an external source change", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const before = 1;\n",
    });
    fixtures.push(fixture);

    const first = await withProject(fixture.root, ({ status }) => status);
    await fixture.write("src/value.ts", "export const after = 2;\n");
    const second = await withProject(fixture.root, ({ status }) => status);

    expect(first.state).toBe("fresh");
    expect(second.state).toBe("fresh");
    expect(second.sourceSnapshotFingerprint).not.toBe(first.sourceSnapshotFingerprint);
    expect(second.canonicalSnapshotFingerprint).not.toBe(first.canonicalSnapshotFingerprint);
    expect(second.lastSuccessfulSyncAt).toMatch(/Z$/);
  });

  it("reports stale status when session synchronization fails", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);

    const first = await getProjectStatus(fixture.root);
    await fixture.write("tsconfig.json", "{ invalid json");
    const stale = await getProjectStatus(fixture.root);

    expect(first.state).toBe("fresh");
    expect(stale.state).toBe("stale");
    expect(stale.causes).toContain("compiler_rebuild");
    expect(stale.compiler).toEqual({ state: "failed" });
    expect(stale.last_successful_sync_at).toBe(first.last_successful_sync_at);
  });

  it("stays stale when source files change during synchronization", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const before = 1;\n",
    });
    fixtures.push(fixture);

    const sourceFile = await withProject(fixture.root, ({ project }) =>
      getSourceFileOrThrow(project, "src/value.ts"),
    );
    const refresh = sourceFile.refreshFromFileSystem.bind(sourceFile);
    let refreshCount = 0;
    const refreshSpy = vi
      .spyOn(sourceFile, "refreshFromFileSystem")
      .mockImplementation(async () => {
        const result = await refresh();
        refreshCount += 1;
        await fixture.write("src/value.ts", `export const after = ${refreshCount};\n`);
        return result;
      });

    try {
      const stale = await getProjectStatus(fixture.root);
      expect(stale.state).toBe("stale");
      expect(stale.causes).toContain("source_change");
      expect(stale.last_successful_sync_at).not.toBeNull();
    } finally {
      refreshSpy.mockRestore();
    }
  });

  it("discovers included files and forgets deleted files", async () => {
    const fixture = await createProjectFixture({
      "src/first.ts": "export const first = 1;\n",
    });
    fixtures.push(fixture);

    await withProject(fixture.root, ({ project }) => {
      expect(project.getSourceFiles()).toHaveLength(1);
    });

    await fixture.write("src/second.ts", "export const second = 2;\n");
    await withProject(fixture.root, ({ project }) => {
      expect(
        project
          .getSourceFiles()
          .map((sourceFile) => sourceFile.getBaseName())
          .sort(),
      ).toEqual(["first.ts", "second.ts"]);
    });

    await rm(path.join(fixture.root, "src/first.ts"));
    await withProject(fixture.root, ({ project }) => {
      expect(project.getSourceFiles().map((sourceFile) => sourceFile.getBaseName())).toEqual([
        "second.ts",
      ]);
    });
  });

  it("rebuilds a cached project when an extended config changes", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    await fixture.write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { strict: false, target: "ES2022" } }),
    );
    await fixture.write(
      "tsconfig.json",
      JSON.stringify({ extends: "./tsconfig.base.json", include: ["src/**/*"] }),
    );

    const first = await withProject(fixture.root, ({ project, status }) => ({
      strict: project.getCompilerOptions().strict,
      configFingerprint: status.configSnapshotFingerprint,
    }));
    expect(first.strict).toBe(false);

    await fixture.write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { strict: true, target: "ES2022" } }),
    );

    const second = await withProject(fixture.root, ({ project, status }) => ({
      strict: project.getCompilerOptions().strict,
      configFingerprint: status.configSnapshotFingerprint,
      state: status.state,
    }));
    expect(second.strict).toBe(true);
    expect(second.state).toBe("fresh");
    expect(second.configFingerprint).not.toBe(first.configFingerprint);
  });

  it("rejects ambiguous suffix paths and reports project-relative candidates", async () => {
    const fixture = await createProjectFixture({
      "src/a/index.ts": "export const first = 1;\n",
      "src/b/index.ts": "export const second = 2;\n",
    });
    fixtures.push(fixture);
    const { project } = createFreshProject(fixture.root);

    expect(() => getSourceFileOrThrow(project, "index.ts")).toThrowError(
      /src\/a\/index\.ts, src\/b\/index\.ts/,
    );
    expect(getSourceFileOrThrow(project, "src/b/index.ts").getText()).toContain("second");
  });

  it("serializes operations for the same project", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const events: string[] = [];

    const first = withProject(fixture.root, async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push("first:end");
    });
    const second = withProject(fixture.root, () => {
      events.push("second:start");
    });

    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });
});
