import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectSessions,
  createFreshProject,
  getProjectStatus,
  getSourceFileOrThrow,
  invalidateProject,
  reportSymbolIndexFailure,
  withProject,
} from "../src/services/project.js";
import {
  readSymbolIndexPersistencePolicy,
  symbolIndexCachePath,
} from "../src/services/symbol-index-policy.js";
import { SYMBOL_INDEX_SCHEMA_VERSION } from "../src/services/symbol-index.js";
import { SQLiteSymbolIndexStore } from "../src/services/symbol-index-sqlite.js";
import * as symbolsModule from "../src/services/symbols.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  clearProjectSessions();
  vi.unstubAllEnvs();
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

  it("starts a watcher for cached sessions without attaching one to fresh projects", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);

    expect(createFreshProject(fixture.root).status.watcher).toEqual({ state: "disabled" });
    const status = await getProjectStatus(fixture.root);

    expect(status.watcher).toEqual({ state: "ready" });
  });

  it("opens SQLite only for explicit canary opt-in and rolls back to memory", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const cacheRoot = path.join(fixture.root, ".symbol-index-cache");
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", cacheRoot);

    const first = await withProject(fixture.root, async (context) => ({
      backend: context.symbolIndexBackend,
      entries: await context.symbolIndex.load(context.status.project, SYMBOL_INDEX_SCHEMA_VERSION),
    }));
    expect(first.backend).toBe("sqlite");
    expect(first.entries).toHaveLength(1);
    expect(await readdir(cacheRoot)).toContainEqual(
      expect.stringMatching(/^symbol-index-.*\.sqlite$/),
    );
    await expect(getProjectStatus(fixture.root)).resolves.toMatchObject({
      index: { state: "ready" },
      indexed_count: 1,
      index_observability: {
        policy: "canary",
        policy_reason: "default",
        backend: "sqlite",
        state: "ready",
        operation: "hit",
        last_operation: "hit",
        loaded_entries: 1,
        accepted_entries: 1,
        rejected_entries: 0,
        migration_count: 0,
        corruption_count: 0,
        write_failure_count: 0,
        last_successful_persistence_at: expect.stringMatching(/Z$/),
      },
    });

    invalidateProject(fixture.root);
    const reopened = await withProject(
      fixture.root,
      ({ symbolIndexBackend }) => symbolIndexBackend,
    );
    expect(reopened).toBe("sqlite");

    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "disabled");
    invalidateProject(fixture.root);
    const rolledBack = await withProject(
      fixture.root,
      ({ symbolIndexBackend }) => symbolIndexBackend,
    );
    expect(rolledBack).toBe("memory");
    await expect(getProjectStatus(fixture.root)).resolves.toMatchObject({
      index: { state: "disabled" },
      indexed_count: 0,
      index_observability: {
        policy: "disabled",
        policy_reason: "default",
        backend: "memory",
        state: "disabled",
        loaded_entries: 0,
        accepted_entries: 0,
        rejected_entries: 0,
        migration_count: 0,
        corruption_count: 0,
        write_failure_count: 0,
        last_successful_persistence_at: null,
      },
    });
  });

  it("exposes the reserved enabled fail-closed reason through project status", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const cacheRoot = path.join(fixture.root, ".symbol-index-cache");
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "enabled");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", cacheRoot);

    await expect(getProjectStatus(fixture.root)).resolves.toMatchObject({
      index: { state: "disabled" },
      index_observability: {
        policy: "disabled",
        policy_reason: "enabled_not_released",
        backend: "memory",
      },
    });
    await expect(readdir(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("falls back to compiler search and marks the session failed on an indexed query error", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));

    let fallbackContext: Awaited<ReturnType<typeof reportSymbolIndexFailure>>;
    const indexed = await withProject(fixture.root, async (context) => {
      const querySpy = vi
        .spyOn(context.symbolIndex, "queryAllSymbols")
        .mockRejectedValue(
          Object.assign(new Error("injected read failure"), { code: "read_failed" }),
        );
      try {
        return await symbolsModule.searchProjectSymbolsWithIndex(
          context.project,
          context.projectRoot,
          context.status.project,
          context.symbolIndex,
          context.symbolIndexReady,
          { query: "value" },
          async (reason) => {
            fallbackContext = await reportSymbolIndexFailure(context.projectRoot, reason);
          },
        );
      } finally {
        querySpy.mockRestore();
      }
    });

    expect(indexed).toEqual([expect.objectContaining({ selector: "value@1" })]);
    expect(fallbackContext).toMatchObject({
      symbolIndexBackend: "memory",
      symbolIndexReady: false,
      status: { state: "degraded", causes: expect.arrayContaining(["index_failure"]) },
      symbolIndexObservability: {
        state: "failed",
        operation: "read_failure",
        last_operation: "read_failure",
        fallback_count: 1,
        rejected_entries: 1,
        last_error: "read_failed",
      },
    });
    expect(
      symbolsModule.searchProjectSymbols(createFreshProject(fixture.root).project, fixture.root, {
        query: "value",
      }),
    ).toHaveLength(1);
  });

  it("rejects persisted symbol metadata that disagrees with the compiler", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));

    let fallbackContext: Awaited<ReturnType<typeof reportSymbolIndexFailure>>;
    const result = await withProject(fixture.root, async (context) => {
      const valid = await context.symbolIndex.queryAllSymbols({
        project: context.status.project,
        query: "value",
      });
      const querySpy = vi
        .spyOn(context.symbolIndex, "queryAllSymbols")
        .mockResolvedValue([{ ...valid[0], name: "forged" }]);
      try {
        return await symbolsModule.searchProjectSymbolsWithIndex(
          context.project,
          context.projectRoot,
          context.status.project,
          context.symbolIndex,
          context.symbolIndexReady,
          { query: "value" },
          async (reason) => {
            fallbackContext = await reportSymbolIndexFailure(context.projectRoot, reason);
          },
        );
      } finally {
        querySpy.mockRestore();
      }
    });

    expect(result).toEqual([expect.objectContaining({ selector: "value@1", name: "value" })]);
    expect(fallbackContext).toMatchObject({
      symbolIndexBackend: "memory",
      status: { state: "degraded", causes: expect.arrayContaining(["index_failure"]) },
      symbolIndexObservability: {
        operation: "corruption",
        last_error: "corrupt_storage",
      },
    });
  });

  it("returns canonical compiler symbols when failure reporting rejects", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));

    const result = await withProject(fixture.root, async (context) => {
      const valid = await context.symbolIndex.queryAllSymbols({
        project: context.status.project,
        query: "value",
      });
      const querySpy = vi
        .spyOn(context.symbolIndex, "queryAllSymbols")
        .mockResolvedValue([{ ...valid[0], name: "forged" }]);
      try {
        return await symbolsModule.searchProjectSymbolsWithIndex(
          context.project,
          context.projectRoot,
          context.status.project,
          context.symbolIndex,
          context.symbolIndexReady,
          { query: "value" },
          async () => {
            throw new Error("injected report failure");
          },
        );
      } finally {
        querySpy.mockRestore();
      }
    });

    expect(result).toEqual([expect.objectContaining({ selector: "value@1", name: "value" })]);
  });

  it("falls back within the same operation after a non-contention write failure", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));
    await withProject(fixture.root, () => undefined);
    await writeFile(path.join(fixture.root, "src/value.ts"), "export const value = 2;\n");

    const failure = Object.assign(new Error("injected non-contention write failure"), {
      code: "write_failed",
    });
    const refresh = vi
      .spyOn(SQLiteSymbolIndexStore.prototype, "refresh")
      .mockRejectedValueOnce(failure);
    let result;
    try {
      result = await withProject(fixture.root, async (context) => ({
        backend: context.symbolIndexBackend,
        ready: context.symbolIndexReady,
        observability: context.symbolIndexObservability,
        symbols: await symbolsModule.searchProjectSymbolsWithIndex(
          context.project,
          context.projectRoot,
          context.status.project,
          context.symbolIndex,
          context.symbolIndexReady,
          { query: "value" },
        ),
      }));
    } finally {
      refresh.mockRestore();
    }

    expect(result).toMatchObject({
      backend: "memory",
      ready: true,
      observability: {
        state: "failed",
        operation: "write_failure",
        write_failure_count: 1,
      },
      symbols: [expect.objectContaining({ selector: "value@1", name: "value" })],
    });
  });

  it("installs memory fallback before best-effort persistent-store close", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));
    await withProject(fixture.root, () => undefined);

    const close = vi.spyOn(SQLiteSymbolIndexStore.prototype, "close").mockImplementation(() => {
      throw new Error("injected close failure");
    });
    let effective;
    try {
      effective = await reportSymbolIndexFailure(fixture.root, "write_failed");
    } finally {
      close.mockRestore();
    }

    expect(effective).toMatchObject({
      symbolIndexBackend: "memory",
      symbolIndexReady: false,
      status: { state: "degraded", causes: expect.arrayContaining(["index_failure"]) },
      symbolIndexObservability: {
        state: "failed",
        operation: "write_failure",
        write_failure_count: 1,
      },
    });
  });

  it("quarantines an omitted persisted projection and preserves compiler symbols", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const cacheRoot = path.join(fixture.root, ".symbol-index-cache");
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", cacheRoot);

    await withProject(fixture.root, () => undefined);
    invalidateProject(fixture.root);
    const databaseName = (await readdir(cacheRoot)).find((name) => name.endsWith(".sqlite"));
    expect(databaseName).toBeDefined();
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path.join(cacheRoot, databaseName!));
    const forgedProjection = "[]";
    database
      .prepare("UPDATE symbol_index SET symbols_json = ?, symbols_digest = ?")
      .run(forgedProjection, createHash("sha256").update(forgedProjection).digest("hex"));
    database.close();

    const result = await withProject(fixture.root, async (context) => {
      let effectiveContext = context;
      const symbols = await symbolsModule.searchProjectSymbolsWithIndex(
        context.project,
        context.projectRoot,
        context.status.project,
        context.symbolIndex,
        context.symbolIndexReady,
        { query: "value" },
        async (reason) => {
          effectiveContext =
            (await reportSymbolIndexFailure(context.projectRoot, reason)) ?? effectiveContext;
        },
      );
      return {
        backend: effectiveContext.symbolIndexBackend,
        state: effectiveContext.symbolIndexObservability.state,
        reason: effectiveContext.symbolIndexFallbackReason,
        symbols,
      };
    });

    expect(result).toMatchObject({
      backend: "memory",
      state: "failed",
      reason: "corrupt_storage",
      symbols: [expect.objectContaining({ selector: "value@1" })],
    });
    expect(await readdir(cacheRoot)).toContainEqual(expect.stringContaining(".sqlite.corrupt-"));
  });

  it("quarantines a migrated empty projection and preserves compiler symbols", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const cacheRoot = path.join(fixture.root, ".symbol-index-cache");
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", cacheRoot);

    await withProject(fixture.root, () => undefined);
    invalidateProject(fixture.root);
    const databaseName = (await readdir(cacheRoot)).find((name) => name.endsWith(".sqlite"));
    expect(databaseName).toBeDefined();
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path.join(cacheRoot, databaseName!));
    const emptyProjection = "[]";
    database
      .prepare("UPDATE symbol_index SET symbols_json = ?, symbols_digest = ?, schema_version = 1")
      .run(emptyProjection, createHash("sha256").update(emptyProjection).digest("hex"));
    database.prepare("UPDATE metadata SET value = '1' WHERE key = 'schema_version'").run();
    database.close();

    const result = await withProject(fixture.root, async (context) => {
      let effectiveContext = context;
      const symbols = await symbolsModule.searchProjectSymbolsWithIndex(
        context.project,
        context.projectRoot,
        context.status.project,
        context.symbolIndex,
        context.symbolIndexReady,
        { query: "value" },
        async (reason) => {
          effectiveContext =
            (await reportSymbolIndexFailure(context.projectRoot, reason)) ?? effectiveContext;
        },
      );
      return {
        backend: effectiveContext.symbolIndexBackend,
        reason: effectiveContext.symbolIndexFallbackReason,
        symbols,
      };
    });

    expect(result).toMatchObject({
      backend: "memory",
      reason: "corrupt_storage",
      symbols: [expect.objectContaining({ selector: "value@1" })],
    });
    expect(await readdir(cacheRoot)).toContainEqual(expect.stringContaining(".sqlite.corrupt-"));
  });

  it("switches the current operation to memory when SQLite flush fails", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));

    let flushSpy: ReturnType<typeof vi.spyOn> | undefined;
    await withProject(fixture.root, (context) => {
      flushSpy = vi
        .spyOn(context.symbolIndex, "flush")
        .mockRejectedValue(
          Object.assign(new Error("injected flush failure"), { code: "write_failed" }),
        );
    });
    await fixture.write("src/value.ts", "export const value = 2;\n");

    try {
      const effective = await withProject(fixture.root, (context) => ({
        backend: context.symbolIndexBackend,
        ready: context.symbolIndexReady,
        status: context.status,
        observability: context.symbolIndexObservability,
        source: getSourceFileOrThrow(context.project, "src/value.ts").getText(),
      }));

      expect(effective).toMatchObject({
        backend: "memory",
        ready: true,
        status: { state: "degraded", causes: expect.arrayContaining(["index_failure"]) },
        observability: {
          state: "failed",
          operation: "write_failure",
          last_operation: "write_failure",
          fallback_count: 1,
          write_failure_count: 1,
          last_error: "write_failed",
        },
      });
      expect(effective.source).toContain("value = 2");
    } finally {
      flushSpy?.mockRestore();
    }
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

  it("extracts symbols only for files whose verified content changed", async () => {
    const fixture = await createProjectFixture({
      "src/first.ts": "export const first = 1;\n",
      "src/second.ts": "export const second = 2;\n",
    });
    fixtures.push(fixture);
    await withProject(fixture.root, () => undefined);
    const extractionSpy = vi.spyOn(symbolsModule, "sourceFileIndexSymbols").mockClear();

    await fixture.write("src/first.ts", "export const first = 3;\n");
    await withProject(fixture.root, () => undefined);

    expect(extractionSpy).toHaveBeenCalledTimes(1);
    expect(extractionSpy.mock.calls[0][0].getBaseName()).toBe("first.ts");
    extractionSpy.mockRestore();
  });

  it("falls back to memory and exposes corruption without serving a corrupt cache", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const cacheRoot = path.join(fixture.root, ".symbol-index-cache");
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", cacheRoot);
    await mkdir(cacheRoot, { recursive: true });
    const identity = createFreshProject(fixture.root).status.project;
    const cachePath = symbolIndexCachePath(readSymbolIndexPersistencePolicy(), identity);
    await writeFile(cachePath!, "corrupt");

    await expect(getProjectStatus(fixture.root)).resolves.toMatchObject({
      state: "degraded",
      causes: expect.arrayContaining(["index_failure"]),
      index: { state: "failed" },
      index_observability: {
        policy: "canary",
        backend: "memory",
        state: "failed",
        operation: "corruption",
        last_operation: "corruption",
        rejected_entries: 1,
        corruption_count: 1,
        last_error: "corrupt_storage",
      },
    });
    const cacheFiles = await readdir(cacheRoot);
    expect(cacheFiles).toContainEqual(expect.stringMatching(/\.sqlite\.corrupt-/));
    expect(cacheFiles).not.toContainEqual(expect.stringMatching(/\.sqlite$/));

    await expect(getProjectStatus(fixture.root)).resolves.toMatchObject({
      state: "fresh",
      causes: expect.not.arrayContaining(["index_failure"]),
      index: { state: "ready" },
      indexed_count: 1,
      index_observability: { backend: "sqlite", state: "ready" },
    });
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
