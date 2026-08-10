import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectSessions,
  createFreshProject,
  getProjectStatus,
  getProjectOperationQueueSnapshot,
  getProjectSessionRegistrySnapshot,
  getSourceFileOrThrow,
  invalidateProject,
  reportSymbolIndexFailure,
  withProject,
} from "../src/services/project.js";
import { buildFileOutline } from "../src/services/outline.js";
import { createRequestContext } from "../src/services/request-context.js";
import {
  readSymbolIndexPersistencePolicy,
  symbolIndexCachePath,
} from "../src/services/symbol-index-policy.js";
import { SYMBOL_INDEX_SCHEMA_VERSION } from "../src/services/symbol-index.js";
import { SQLiteSymbolIndexStore } from "../src/services/symbol-index-sqlite.js";
import * as projectWatcherModule from "../src/services/project-watcher.js";
import * as symbolsModule from "../src/services/symbols.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(async () => {
  clearProjectSessions();
  vi.unstubAllEnvs();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.remove()));
});

describe("project sessions", () => {
  it("bounds waiting operations while preserving one running operation separately", async () => {
    vi.stubEnv("AST_MAX_QUEUED_OPERATIONS_PER_PROJECT", "1");
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    let queuedCalls = 0;
    let rejectedCalls = 0;

    const first = withProject(fixture.root, async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return "first";
    });
    await firstStarted.promise;
    const queued = withProject(fixture.root, () => {
      queuedCalls += 1;
      return "queued";
    });

    expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
      state: "running",
      admission: "open",
      queue_capacity: 1,
      active_operations: 1,
      queued_operations: 1,
    });
    await expect(
      withProject(fixture.root, () => {
        rejectedCalls += 1;
      }),
    ).rejects.toMatchObject({ code: "PROJECT_QUEUE_FULL" });
    expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
      active_operations: 1,
      queued_operations: 1,
      rejected_operations: 1,
      last_outcome: "rejected",
    });

    releaseFirst.resolve();
    await expect(first).resolves.toBe("first");
    await expect(queued).resolves.toBe("queued");
    expect(queuedCalls).toBe(1);
    expect(rejectedCalls).toBe(0);
    expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
      state: "idle",
      active_operations: 0,
      queued_operations: 0,
      last_outcome: "succeeded",
    });
  });

  it("rejects a pre-aborted request before project session lookup or creation", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const controller = new AbortController();
    controller.abort();
    let operationCalled = false;

    await expect(
      withProject(
        fixture.root,
        () => {
          operationCalled = true;
        },
        createRequestContext(controller.signal),
      ),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });

    expect(operationCalled).toBe(false);
    expect(getProjectSessionRegistrySnapshot()).toMatchObject({ session_count: 0 });
  });

  it("unlinks a cancelled queued request before synchronization or callback work", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const controller = new AbortController();
    let queuedCallbackCalled = false;

    const first = withProject(fixture.root, async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    });
    await firstStarted.promise;
    const queued = withProject(
      fixture.root,
      () => {
        queuedCallbackCalled = true;
      },
      createRequestContext(controller.signal),
    );
    const queuedExpectation = expect(queued).rejects.toMatchObject({
      code: "REQUEST_CANCELLED",
    });
    expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
      active_operations: 1,
      queued_operations: 1,
    });

    controller.abort();
    await queuedExpectation;
    expect(queuedCallbackCalled).toBe(false);
    expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
      active_operations: 1,
      queued_operations: 0,
    });

    releaseFirst.resolve();
    await first;
  });

  it("stops active read traversal at a cooperative checkpoint", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const controller = new AbortController();

    await expect(
      withProject(
        fixture.root,
        (context, operationContext) => {
          controller.abort();
          return buildFileOutline(
            getSourceFileOrThrow(context.project, "src/value.ts"),
            operationContext,
          );
        },
        createRequestContext(controller.signal),
      ),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(getProjectOperationQueueSnapshot(fixture.root)).toMatchObject({
      active_operations: 0,
      cancelled_operations: 1,
      last_outcome: "cancelled",
    });
  });

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

  it("scopes session watchers to compiler source directories", async () => {
    const files: Record<string, string> = {
      "src/value.ts": "export const value = 1;\n",
    };
    for (let index = 0; index < 512; index += 1) {
      files[`docs/generated-${index}/note.md`] = "not part of the compiler project\n";
    }
    const fixture = await createProjectFixture(files);
    fixtures.push(fixture);

    const status = await getProjectStatus(fixture.root);

    expect(status.watcher).toEqual({ state: "ready" });
    expect(status.state).toBe("fresh");
  });

  it("replaces session watcher coverage when the compiler source universe changes", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
      "packages/new/feature.ts": "export const feature = 1;\n",
    });
    fixtures.push(fixture);
    await fixture.write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
    );
    const createWatcher = projectWatcherModule.createProjectWatcher;
    const watcherSpy = vi
      .spyOn(projectWatcherModule, "createProjectWatcher")
      .mockImplementation((options) => createWatcher(options));

    try {
      await getProjectStatus(fixture.root);
      await fixture.write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: { strict: true },
          include: ["src/**/*.ts", "packages/new/**/*.ts"],
        }),
      );
      await getProjectStatus(fixture.root);

      expect(watcherSpy).toHaveBeenCalledTimes(2);
      expect(watcherSpy.mock.calls[1][0].directories).toContain(
        path.join(fixture.root, "packages/new"),
      );
    } finally {
      watcherSpy.mockRestore();
    }
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

  it("keeps SQLite ready when an ASCII file filter matches a Unicode case fold", async () => {
    const fixture = await createProjectFixture({
      "src/Key.ts": "export const kelvinValue = 1;\n",
    });
    fixtures.push(fixture);
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));
    const onIndexFailure = vi.fn();

    const result = await withProject(fixture.root, async (context, operationContext) => ({
      backend: context.symbolIndexBackend,
      page: await symbolsModule.searchProjectSymbolsPageWithIndex(
        context.project,
        context.projectRoot,
        context.status.project,
        context.symbolIndex,
        context.symbolIndexReady,
        { query: "kelvin", fileFilter: "k" },
        0,
        1,
        onIndexFailure,
        operationContext,
      ),
    }));

    expect(result).toMatchObject({
      backend: "sqlite",
      page: {
        total: 1,
        items: [expect.objectContaining({ file: "src/Key.ts", name: "kelvinValue" })],
      },
    });
    expect(onIndexFailure).not.toHaveBeenCalled();
    await expect(getProjectStatus(fixture.root)).resolves.toMatchObject({
      index: { state: "ready" },
      index_observability: {
        backend: "sqlite",
        state: "ready",
        corruption_count: 0,
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
        .spyOn(context.symbolIndex, "countSymbols")
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

  it("does not classify cooperative symbol-search interruption as index failure", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", "canary");
    vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", path.join(fixture.root, ".symbol-index-cache"));
    const controller = new AbortController();
    const onIndexFailure = vi.fn();

    const search = withProject(
      fixture.root,
      async (context, operationContext) => {
        const valid = await context.symbolIndex.countSymbols({
          project: context.status.project,
          query: "value",
        });
        const querySpy = vi
          .spyOn(context.symbolIndex, "countSymbols")
          .mockImplementationOnce(async () => {
            controller.abort();
            return valid;
          });
        try {
          return await symbolsModule.searchProjectSymbolsWithIndex(
            context.project,
            context.projectRoot,
            context.status.project,
            context.symbolIndex,
            context.symbolIndexReady,
            { query: "value" },
            onIndexFailure,
            operationContext,
          );
        } finally {
          querySpy.mockRestore();
        }
      },
      createRequestContext(controller.signal),
    );

    await expect(search).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(onIndexFailure).not.toHaveBeenCalled();
    expect(getProjectSessionRegistrySnapshot()).toMatchObject({
      session_count: 1,
      active_sessions: 0,
    });
  });

  it("validates indexed search candidates without formatting unrelated declarations", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": [
        "export class TargetService {}",
        "export type UnrelatedService = { value: string };",
      ].join("\n"),
    });
    fixtures.push(fixture);

    const result = await withProject(fixture.root, async (context, operationContext) => {
      expect(context.symbolIndexReady).toBe(true);
      const allCandidates = vi.spyOn(context.symbolIndex, "queryAllSymbols");
      const countCandidates = vi.spyOn(context.symbolIndex, "countSymbols");
      const pageCandidates = vi.spyOn(context.symbolIndex, "querySymbols");
      const targetFile = context.project.getSourceFileOrThrow(
        path.join(fixture.root, "src/target.ts"),
      );
      const unrelatedDeclaration = targetFile.getTypeAliasOrThrow("UnrelatedService");
      const unrelatedType = unrelatedDeclaration.getTypeNodeOrThrow();
      const unrelatedName = vi.spyOn(unrelatedDeclaration, "getName");
      const unrelatedSpy = vi.spyOn(unrelatedType, "getText").mockImplementation(() => {
        throw new Error("unrelated declaration was inspected");
      });
      try {
        const page = await symbolsModule.searchProjectSymbolsPageWithIndex(
          context.project,
          context.projectRoot,
          context.status.project,
          context.symbolIndex,
          context.symbolIndexReady,
          { query: "Service", fileFilter: "src" },
          0,
          1,
          undefined,
          operationContext,
        );
        expect(allCandidates).not.toHaveBeenCalled();
        expect(countCandidates).toHaveBeenCalledWith(expect.objectContaining({ query: "Service" }));
        expect(pageCandidates).toHaveBeenCalledWith(
          expect.objectContaining({ query: "Service", offset: 0, limit: 1 }),
        );
        // Counting and page selection each visit it twice; exact indexed validation stops earlier.
        expect(unrelatedName).toHaveBeenCalledTimes(4);
        return page;
      } finally {
        unrelatedName.mockRestore();
        unrelatedSpy.mockRestore();
        allCandidates.mockRestore();
        countCandidates.mockRestore();
        pageCandidates.mockRestore();
      }
    });

    expect(result).toMatchObject({
      total: 2,
      has_more: true,
      items: [expect.objectContaining({ selector: "TargetService@1", name: "TargetService" })],
    });
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
      const valid = await context.symbolIndex.querySymbols({
        project: context.status.project,
        query: "value",
        offset: 0,
        limit: 1,
      });
      const querySpy = vi
        .spyOn(context.symbolIndex, "querySymbols")
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
      const valid = await context.symbolIndex.querySymbols({
        project: context.status.project,
        query: "value",
        offset: 0,
        limit: 1,
      });
      const querySpy = vi
        .spyOn(context.symbolIndex, "querySymbols")
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

  it("does not refresh unchanged compiler source files between operations", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);

    const sourceFile = await withProject(fixture.root, ({ project }) =>
      getSourceFileOrThrow(project, "src/value.ts"),
    );
    const refreshSpy = vi.spyOn(sourceFile, "refreshFromFileSystem");
    try {
      await withProject(fixture.root, () => undefined);
      expect(refreshSpy).not.toHaveBeenCalled();
    } finally {
      refreshSpy.mockRestore();
    }
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
    await fixture.write("src/value.ts", "export const changed = 2;\n");

    try {
      const stale = await getProjectStatus(fixture.root);
      expect(stale.state).toBe("stale");
      expect(stale.causes).toContain("source_change");
      expect(stale.last_successful_sync_at).not.toBeNull();
    } finally {
      refreshSpy.mockRestore();
    }
  });

  it("rebuilds compiler state after an unstable synchronization before publishing fresh", async () => {
    const original = "export const value = 'A';\n";
    const fixture = await createProjectFixture({ "src/value.ts": original });
    fixtures.push(fixture);

    const sourceFile = await withProject(fixture.root, ({ project }) =>
      getSourceFileOrThrow(project, "src/value.ts"),
    );
    const refresh = sourceFile.refreshFromFileSystem.bind(sourceFile);
    const refreshSpy = vi
      .spyOn(sourceFile, "refreshFromFileSystem")
      .mockImplementation(async () => {
        const result = await refresh();
        await fixture.write("src/value.ts", "export const value = 'C';\n");
        return result;
      });
    await fixture.write("src/value.ts", "export const value = 'B';\n");

    try {
      await expect(withProject(fixture.root, () => undefined)).rejects.toThrow(
        /source changed during synchronization/i,
      );
    } finally {
      refreshSpy.mockRestore();
    }

    await fixture.write("src/value.ts", original);
    const retry = await withProject(fixture.root, ({ project, status }) => ({
      text: getSourceFileOrThrow(project, "src/value.ts").getText(),
      state: status.state,
    }));

    expect(retry).toEqual({ text: original, state: "fresh" });
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

  it("evicts the least-recently-used idle session without exceeding capacity", async () => {
    vi.stubEnv("AST_MAX_PROJECT_SESSIONS", "2");
    const firstFixture = await createProjectFixture({
      "src/value.ts": "export const first = 1;\n",
    });
    const secondFixture = await createProjectFixture({
      "src/value.ts": "export const second = 2;\n",
    });
    const thirdFixture = await createProjectFixture({
      "src/value.ts": "export const third = 3;\n",
    });
    fixtures.push(firstFixture, secondFixture, thirdFixture);

    const firstProject = await withProject(firstFixture.root, ({ project }) => project);
    const secondProject = await withProject(secondFixture.root, ({ project }) => project);
    await withProject(firstFixture.root, () => undefined);
    await withProject(thirdFixture.root, () => undefined);

    expect(getProjectSessionRegistrySnapshot()).toEqual({
      session_count: 2,
      active_sessions: 0,
      idle_sessions: 2,
      session_capacity: 2,
    });
    await expect(withProject(firstFixture.root, ({ project }) => project)).resolves.toBe(
      firstProject,
    );
    await expect(withProject(secondFixture.root, ({ project }) => project)).resolves.not.toBe(
      secondProject,
    );
    expect(getProjectSessionRegistrySnapshot().session_count).toBe(2);
  });

  it("rejects a new project before admission when every retained session is busy", async () => {
    vi.stubEnv("AST_MAX_PROJECT_SESSIONS", "2");
    const firstFixture = await createProjectFixture({
      "src/value.ts": "export const first = 1;\n",
    });
    const secondFixture = await createProjectFixture({
      "src/value.ts": "export const second = 2;\n",
    });
    const rejectedFixture = await createProjectFixture({
      "src/value.ts": "export const rejected = 3;\n",
    });
    fixtures.push(firstFixture, secondFixture, rejectedFixture);
    await rejectedFixture.write("tsconfig.json", "{ invalid json");
    const firstStarted = createDeferred();
    const secondStarted = createDeferred();
    const release = createDeferred();
    let rejectedOperationCalled = false;

    const first = withProject(firstFixture.root, async () => {
      firstStarted.resolve();
      await release.promise;
    });
    const second = withProject(secondFixture.root, async () => {
      secondStarted.resolve();
      await release.promise;
    });

    try {
      await Promise.all([firstStarted.promise, secondStarted.promise]);
      expect(getProjectSessionRegistrySnapshot()).toEqual({
        session_count: 2,
        active_sessions: 2,
        idle_sessions: 0,
        session_capacity: 2,
      });
      await expect(
        withProject(rejectedFixture.root, () => {
          rejectedOperationCalled = true;
        }),
      ).rejects.toMatchObject({
        name: "ProjectCapacityError",
        code: "PROJECT_CAPACITY_EXCEEDED",
        message: "Project session capacity exceeded.",
      });
      expect(rejectedOperationCalled).toBe(false);
      expect(getProjectSessionRegistrySnapshot()).toEqual({
        session_count: 2,
        active_sessions: 2,
        idle_sessions: 0,
        session_capacity: 2,
      });
    } finally {
      release.resolve();
      await Promise.all([first, second]);
    }
  });

  it("deduplicates concurrent requests for the same new project at capacity one", async () => {
    vi.stubEnv("AST_MAX_PROJECT_SESSIONS", "1");
    const fixture = await createProjectFixture({ "src/value.ts": "export const value = 1;\n" });
    fixtures.push(fixture);
    const firstStarted = createDeferred();
    const release = createDeferred();
    let firstProject: unknown;

    const first = withProject(fixture.root, async ({ project }) => {
      firstProject = project;
      firstStarted.resolve();
      await release.promise;
      return project;
    });
    await firstStarted.promise;
    const second = withProject(fixture.root, ({ project }) => project);

    expect(getProjectSessionRegistrySnapshot()).toEqual({
      session_count: 1,
      active_sessions: 1,
      idle_sessions: 0,
      session_capacity: 1,
    });
    release.resolve();
    await expect(first).resolves.toBe(firstProject);
    await expect(second).resolves.toBe(firstProject);
    expect(getProjectSessionRegistrySnapshot()).toEqual({
      session_count: 1,
      active_sessions: 0,
      idle_sessions: 1,
      session_capacity: 1,
    });
  });
});
