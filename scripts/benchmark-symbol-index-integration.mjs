#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { URL } from "node:url";

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex === -1 ? null : process.argv[outputIndex + 1];
if (outputIndex !== -1 && !outputPath) throw new Error("--output requires a path.");

const root = await mkdtemp(path.join(os.tmpdir(), "ast-symbol-index-integration-"));
const cacheRoot = path.join(root, ".cache");
const previousPersistence = process.env.AST_SYMBOL_INDEX_PERSISTENCE;
const previousCacheRoot = process.env.AST_SYMBOL_INDEX_CACHE_ROOT;

function restoreEnvironment() {
  if (previousPersistence === undefined) delete process.env.AST_SYMBOL_INDEX_PERSISTENCE;
  else process.env.AST_SYMBOL_INDEX_PERSISTENCE = previousPersistence;
  if (previousCacheRoot === undefined) delete process.env.AST_SYMBOL_INDEX_CACHE_ROOT;
  else process.env.AST_SYMBOL_INDEX_CACHE_ROOT = previousCacheRoot;
}

async function activeCacheFiles() {
  try {
    return (await readdir(cacheRoot)).filter((file) => file.endsWith(".sqlite"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function projectCacheFiles() {
  return (await activeCacheFiles()).filter((file) => file.startsWith("symbol-index-"));
}

async function timed(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, duration_ms: Number((performance.now() - startedAt).toFixed(3)) };
}

function expectStatus(status, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(status[key], value, `Expected status.${key} to equal ${value}`);
  }
}

await writeFile(
  path.join(root, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  ),
);
await mkdir(path.join(root, "src"), { recursive: true });
await writeFile(path.join(root, "src.ts"), "export const ignored = true;\n");
await writeFile(path.join(root, "src", "first.ts"), "export const first = 1;\n");
await writeFile(path.join(root, "src", "second.ts"), "export const second = 2;\n");

const {
  clearProjectSessions,
  getProjectStatus,
  invalidateProject,
  reportSymbolIndexFailure,
  withProject,
} = await import(new URL("../dist/services/project.js", import.meta.url));
const { searchProjectSymbolsWithIndex } = await import(
  new URL("../dist/services/symbols.js", import.meta.url)
);
const { openSQLiteSymbolIndexStore, SQLiteSymbolIndexStore } = await import(
  new URL("../dist/services/symbol-index-sqlite.js", import.meta.url)
);
const { SYMBOL_INDEX_SCHEMA_VERSION } = await import(
  new URL("../dist/services/symbol-index.js", import.meta.url)
);
const { readSymbolIndexPersistencePolicy } = await import(
  new URL("../dist/services/symbol-index-policy.js", import.meta.url)
);
const { DatabaseSync } = await import("node:sqlite");

const measurements = {};
const failureInjection = {};
try {
  process.env.AST_SYMBOL_INDEX_CACHE_ROOT = cacheRoot;
  process.env.AST_SYMBOL_INDEX_PERSISTENCE = "disabled";
  const disabled = await timed(() => getProjectStatus(root));
  measurements.disabled = disabled;
  expectStatus(disabled.value, { indexed_count: 0 });
  assert.equal(disabled.value.index_observability.policy, "disabled");
  assert.equal(disabled.value.index_observability.backend, "memory");
  assert.deepEqual(await projectCacheFiles(), []);

  process.env.AST_SYMBOL_INDEX_PERSISTENCE = "canary";
  invalidateProject(root);
  const canaryMiss = await timed(() => getProjectStatus(root));
  measurements.canary_miss = canaryMiss;
  expectStatus(canaryMiss.value, { indexed_count: 2 });
  assert.equal(canaryMiss.value.index_observability.backend, "sqlite");
  assert.equal(canaryMiss.value.index_observability.state, "ready");
  assert.equal(canaryMiss.value.index_observability.operation, "rebuild");
  assert.equal((await projectCacheFiles()).length, 1);

  const canaryHit = await timed(() => getProjectStatus(root));
  measurements.canary_hit = canaryHit;
  assert.equal(canaryHit.value.index_observability.backend, "sqlite");
  assert.equal(canaryHit.value.index_observability.cache_hits > 0, true);

  const unsupportedCapability = await timed(async () => {
    try {
      await openSQLiteSymbolIndexStore(path.join(root, "unsupported.sqlite"), {
        DatabaseSync: null,
      });
      return null;
    } catch (error) {
      return { code: error?.code ?? "unknown" };
    }
  });
  failureInjection.unsupported_capability = unsupportedCapability;
  assert.equal(unsupportedCapability.value.code, "capability_unavailable");

  const enabledPolicy = readSymbolIndexPersistencePolicy({
    AST_SYMBOL_INDEX_PERSISTENCE: "enabled",
    AST_SYMBOL_INDEX_CACHE_ROOT: cacheRoot,
  });
  assert.equal(enabledPolicy.backend, "memory");
  assert.equal(enabledPolicy.reason, "enabled_not_released");
  process.env.AST_SYMBOL_INDEX_PERSISTENCE = "enabled";
  invalidateProject(root);
  const enabledStatus = await timed(() => getProjectStatus(root));
  measurements.enabled_fail_closed = enabledStatus;
  assert.equal(enabledStatus.value.index_observability.backend, "memory");
  assert.equal(enabledStatus.value.index_observability.policy_reason, "enabled_not_released");
  process.env.AST_SYMBOL_INDEX_PERSISTENCE = "canary";
  invalidateProject(root);

  let injectReadFailure = false;
  class ReadFailureDatabase {
    constructor(filePath) {
      this.database = new DatabaseSync(filePath);
    }

    exec(sql) {
      return this.database.exec(sql);
    }

    prepare(sql) {
      const statement = this.database.prepare(sql);
      if (
        injectReadFailure &&
        sql.includes("FROM symbol_index") &&
        sql.includes("ORDER BY file_path")
      ) {
        return {
          all() {
            throw new Error("injected read failure");
          },
          iterate() {
            throw new Error("injected read failure");
          },
        };
      }
      return statement;
    }

    close() {
      this.database.close();
    }
  }
  const readFailurePath = path.join(cacheRoot, "read-failure.sqlite");
  const readFailureStore = await openSQLiteSymbolIndexStore(readFailurePath, {
    DatabaseSync: ReadFailureDatabase,
  });
  injectReadFailure = true;
  const readFailure = await timed(async () => {
    try {
      await readFailureStore.querySymbols({
        project: canaryHit.value.project,
        query: "first",
        limit: 10,
      });
      return null;
    } catch (error) {
      return { code: error?.code ?? "unknown" };
    }
  });
  injectReadFailure = false;
  readFailureStore.close();
  failureInjection.read_failure = readFailure;
  assert.equal(readFailure.value.code, "read_failed");

  const invalidPath = await timed(async () => {
    try {
      await openSQLiteSymbolIndexStore(`${root}/../invalid.sqlite`);
      return null;
    } catch (error) {
      return { code: error?.code ?? "unknown" };
    }
  });
  failureInjection.invalid_path = invalidPath;
  assert.equal(invalidPath.value.code, "invalid_path");

  const migrationPath = path.join(cacheRoot, "migration-failure.sqlite");
  const legacyDatabase = new DatabaseSync(migrationPath);
  legacyDatabase.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO metadata (key, value) VALUES ('schema_version', '0');
    CREATE TABLE symbol_index (
      project_id TEXT NOT NULL,
      config_id TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      config_digest TEXT NOT NULL,
      symbols_json TEXT NOT NULL,
      last_indexed_at TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      PRIMARY KEY (project_id, config_id, file_path)
    );
  `);
  legacyDatabase
    .prepare(
      `INSERT INTO symbol_index
       (project_id, config_id, file_path, content_hash, config_digest, symbols_json, last_indexed_at, schema_version)
       VALUES (?, '', ?, ?, ?, '[]', ?, 0)`,
    )
    .run(
      canaryHit.value.project.project_id,
      "src/legacy.ts",
      "a".repeat(64),
      "b".repeat(64),
      new Date().toISOString(),
    );
  legacyDatabase.close();
  class MigrationFailureDatabase {
    constructor(filePath) {
      this.database = new DatabaseSync(filePath);
      this.commitCount = 0;
    }

    exec(sql) {
      if (sql === "COMMIT" && ++this.commitCount === 2) {
        throw new Error("injected migration commit failure");
      }
      return this.database.exec(sql);
    }

    prepare(sql) {
      return this.database.prepare(sql);
    }

    close() {
      this.database.close();
    }
  }
  const migrationFailure = await timed(async () => {
    try {
      await openSQLiteSymbolIndexStore(migrationPath, { DatabaseSync: MigrationFailureDatabase });
      return null;
    } catch (error) {
      return { code: error?.code ?? "unknown" };
    }
  });
  failureInjection.migration_failure = migrationFailure;
  assert.equal(migrationFailure.value.code, "migration_failed");

  const commitFailurePath = path.join(cacheRoot, "commit-failure.sqlite");
  let failNextCommit = false;
  class CommitFailureDatabase {
    constructor(filePath) {
      this.database = new DatabaseSync(filePath);
    }

    exec(sql) {
      if (sql === "COMMIT" && failNextCommit) {
        failNextCommit = false;
        throw new Error("injected non-contention commit failure");
      }
      return this.database.exec(sql);
    }

    prepare(sql) {
      return this.database.prepare(sql);
    }

    close() {
      this.database.close();
    }
  }
  const commitEntry = (name) => ({
    project: canaryHit.value.project,
    file_path: "src/commit.ts",
    content_hash: createHash("sha256").update(name).digest("hex"),
    config_digest: "d".repeat(64),
    symbols: [
      {
        name,
        symbol_path: name,
        selector: `${name}@1`,
        kind: "VariableDeclaration",
        signature: `const ${name}: number`,
        line: 1,
        range: { start_line: 1 },
      },
    ],
    last_indexed_at: new Date().toISOString(),
    index_schema_version: SYMBOL_INDEX_SCHEMA_VERSION,
  });
  let commitFailureStore = await openSQLiteSymbolIndexStore(commitFailurePath, {
    DatabaseSync: CommitFailureDatabase,
  });
  await commitFailureStore.upsert(commitEntry("before"));
  failNextCommit = true;
  let commitFailureCode = "none";
  try {
    await commitFailureStore.upsert(commitEntry("after"));
  } catch (error) {
    commitFailureCode = error?.code ?? "unknown";
  }
  commitFailureStore.close();
  commitFailureStore = await openSQLiteSymbolIndexStore(commitFailurePath);
  const previousStatePreserved =
    (
      await commitFailureStore.queryAllSymbols({
        project: canaryHit.value.project,
        query: "before",
      })
    ).length === 1;
  const failedStateAbsent =
    (
      await commitFailureStore.queryAllSymbols({
        project: canaryHit.value.project,
        query: "after",
      })
    ).length === 0;
  commitFailureStore.close();

  const contentionPath = path.join(cacheRoot, "contention.sqlite");
  const contentionStore = await openSQLiteSymbolIndexStore(contentionPath, {
    busyTimeoutMs: 25,
  });
  const blocker = new DatabaseSync(contentionPath);
  blocker.exec("BEGIN IMMEDIATE");
  const contention = await timed(async () => {
    try {
      await contentionStore.upsert({
        project: canaryHit.value.project,
        file_path: "src/blocked.ts",
        content_hash: "c".repeat(64),
        config_digest: "d".repeat(64),
        symbols: [],
        last_indexed_at: new Date().toISOString(),
        index_schema_version: SYMBOL_INDEX_SCHEMA_VERSION,
      });
      return null;
    } catch (error) {
      return { code: error?.code ?? "unknown" };
    }
  });
  const flushFailure = await timed(async () => {
    try {
      await contentionStore.flush();
      return null;
    } catch (error) {
      return { code: error?.code ?? "unknown" };
    }
  });
  blocker.exec("ROLLBACK");
  blocker.close();
  contentionStore.close();
  failureInjection.bounded_contention = contention;
  failureInjection.flush_failure = flushFailure;
  assert.equal(contention.value.code, "contention");
  assert.equal(flushFailure.value.code, "contention");

  await writeFile(path.join(root, "src", "first.ts"), "export const first = 3;\n");
  const changedFile = await timed(() => getProjectStatus(root));
  measurements.changed_file = changedFile;
  assert.equal(changedFile.value.index_observability.rebuilt_files, 1);
  assert.equal(changedFile.value.index_observability.reused_files >= 1, true);

  const originalRefresh = SQLiteSymbolIndexStore.prototype.refresh;
  SQLiteSymbolIndexStore.prototype.refresh = async function () {
    throw Object.assign(new Error("injected session write failure"), { code: "write_failed" });
  };
  await writeFile(path.join(root, "src", "second.ts"), "export const second = 4;\n");
  let writeFallback;
  try {
    writeFallback = await timed(() =>
      withProject(root, async (context) => {
        const symbols = await searchProjectSymbolsWithIndex(
          context.project,
          context.projectRoot,
          context.status.project,
          context.symbolIndex,
          context.symbolIndexReady,
          { query: "second" },
        );
        return {
          index_observability: context.symbolIndexObservability,
          indexed_count: (
            await context.symbolIndex.load(context.status.project, SYMBOL_INDEX_SCHEMA_VERSION)
          ).length,
          compiler_symbol_found: symbols?.some((symbol) => symbol.selector === "second@1") === true,
        };
      }),
    );
  } finally {
    SQLiteSymbolIndexStore.prototype.refresh = originalRefresh;
  }
  measurements.write_failure_fallback = writeFallback;
  failureInjection.non_contention_write_failure = {
    duration_ms: writeFallback.duration_ms,
    value: {
      code: commitFailureCode,
      previous_state_preserved: previousStatePreserved,
      failed_state_absent: failedStateAbsent,
      memory_backend: writeFallback.value.index_observability.backend === "memory",
      failed_state: writeFallback.value.index_observability.state === "failed",
      compiler_symbol_found: writeFallback.value.compiler_symbol_found,
      write_failure_count: writeFallback.value.index_observability.write_failure_count,
    },
  };

  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  const configRebuild = await timed(() => getProjectStatus(root));
  measurements.config_rebuild = configRebuild;
  assert.equal(configRebuild.value.index_observability.backend, "sqlite");
  assert.equal(configRebuild.value.index_observability.state, "ready");

  invalidateProject(root);
  const restart = await timed(() => getProjectStatus(root));
  measurements.restart = restart;
  assert.equal(restart.value.index_observability.backend, "sqlite");
  assert.equal(restart.value.index_observability.state, "ready");

  const projectCacheFile = (await projectCacheFiles())[0];
  assert.ok(projectCacheFile);
  const cachePath = path.join(cacheRoot, projectCacheFile);
  invalidateProject(root);
  await writeFile(cachePath, "corrupt");
  const corruption = await timed(() => getProjectStatus(root));
  measurements.corruption_fallback = corruption;
  assert.equal(corruption.value.index_observability.backend, "memory");
  assert.equal(corruption.value.index_observability.state, "failed");
  assert.equal(corruption.value.index_observability.last_error, "corrupt_storage");
  assert.equal((await projectCacheFiles()).length, 0);

  const recovered = await timed(() => getProjectStatus(root));
  measurements.corruption_recovery = recovered;
  assert.equal(recovered.value.index_observability.backend, "sqlite");
  assert.equal(recovered.value.index_observability.state, "ready");
  assert.equal(recovered.value.indexed_count, 2);

  const recoveredCacheFile = (await projectCacheFiles())[0];
  assert.ok(recoveredCacheFile);
  invalidateProject(root);
  const forgedDatabase = new DatabaseSync(path.join(cacheRoot, recoveredCacheFile));
  const forgedProjection = "[]";
  const forgedRow = forgedDatabase
    .prepare("SELECT file_path FROM symbol_index ORDER BY file_path LIMIT 1")
    .get();
  assert.equal(typeof forgedRow?.file_path, "string");
  const forgedUpdate = forgedDatabase
    .prepare("UPDATE symbol_index SET symbols_json = ?, symbols_digest = ? WHERE file_path = ?")
    .run(
      forgedProjection,
      createHash("sha256").update(forgedProjection).digest("hex"),
      forgedRow.file_path,
    );
  assert.equal(forgedUpdate.changes, 1);
  forgedDatabase.close();
  let forgedSymbols = [];
  const forgedProjectionFallback = await timed(async () => {
    let effectiveContext;
    await withProject(root, async (context) => {
      effectiveContext = context;
      forgedSymbols = await searchProjectSymbolsWithIndex(
        context.project,
        context.projectRoot,
        context.status.project,
        context.symbolIndex,
        context.symbolIndexReady,
        { query: "first" },
        async (reason) => {
          effectiveContext =
            (await reportSymbolIndexFailure(context.projectRoot, reason)) ?? effectiveContext;
        },
      );
    });
    assert.ok(effectiveContext);
    return {
      index_observability: effectiveContext.symbolIndexObservability,
      indexed_count: effectiveContext.status.index.indexed_count,
    };
  });
  measurements.forged_projection_fallback = forgedProjectionFallback;
  assert.equal(forgedProjectionFallback.value.index_observability.backend, "memory");
  assert.equal(forgedProjectionFallback.value.index_observability.state, "failed");
  assert.equal(forgedProjectionFallback.value.index_observability.last_error, "corrupt_storage");
  assert.equal(forgedSymbols[0]?.selector, "first@1");
  assert.equal((await projectCacheFiles()).length, 0);

  const cacheFilesBeforeRollback = await activeCacheFiles();
  process.env.AST_SYMBOL_INDEX_PERSISTENCE = "disabled";
  invalidateProject(root);
  const rollback = await timed(() => getProjectStatus(root));
  measurements.rollback = rollback;
  assert.equal(rollback.value.index_observability.policy, "disabled");
  assert.equal(rollback.value.index_observability.backend, "memory");
  assert.equal(rollback.value.index_observability.state, "disabled");
  assert.equal(rollback.value.indexed_count, 0);
  assert.deepEqual(await activeCacheFiles(), cacheFilesBeforeRollback);

  const report = {
    schema_version: 1,
    node_version: process.version,
    project_root: "[deterministic-fixture]",
    cache_root: "[temporary-cache-root]",
    policy_default: "disabled",
    scenarios: Object.fromEntries(
      Object.entries(measurements).map(([name, measurement]) => [
        name,
        {
          duration_ms: measurement.duration_ms,
          state: measurement.value.index_observability.state,
          backend: measurement.value.index_observability.backend,
          policy: measurement.value.index_observability.policy,
          indexed_count: measurement.value.indexed_count,
          observability: measurement.value.index_observability,
        },
      ]),
    ),
    failure_injection: Object.fromEntries(
      Object.entries(failureInjection).map(([name, measurement]) => [
        name,
        { duration_ms: measurement.duration_ms, ...measurement.value },
      ]),
    ),
    gates: {
      default_disabled: measurements.disabled.value.index_observability.backend === "memory",
      canary_persisted: measurements.canary_miss.value.index_observability.backend === "sqlite",
      incremental_changed_file:
        measurements.changed_file.value.index_observability.rebuilt_files === 1,
      corruption_quarantined:
        measurements.corruption_fallback.value.index_observability.state === "failed",
      corruption_recovered:
        measurements.corruption_recovery.value.index_observability.backend === "sqlite",
      forged_projection_quarantined:
        measurements.forged_projection_fallback.value.index_observability.state === "failed",
      rollback_memory_only: measurements.rollback.value.index_observability.backend === "memory",
      unsupported_capability:
        failureInjection.unsupported_capability.value.code === "capability_unavailable",
      enabled_fails_closed:
        enabledPolicy.backend === "memory" &&
        enabledPolicy.reason === "enabled_not_released" &&
        measurements.enabled_fail_closed.value.index_observability.backend === "memory" &&
        measurements.enabled_fail_closed.value.index_observability.policy_reason ===
          "enabled_not_released",
      read_failure: failureInjection.read_failure.value.code === "read_failed",
      invalid_path: failureInjection.invalid_path.value.code === "invalid_path",
      migration_failure: failureInjection.migration_failure.value.code === "migration_failed",
      non_contention_write_failure:
        failureInjection.non_contention_write_failure.value.code === "write_failed" &&
        failureInjection.non_contention_write_failure.value.previous_state_preserved &&
        failureInjection.non_contention_write_failure.value.failed_state_absent &&
        failureInjection.non_contention_write_failure.value.memory_backend &&
        failureInjection.non_contention_write_failure.value.failed_state &&
        failureInjection.non_contention_write_failure.value.compiler_symbol_found &&
        failureInjection.non_contention_write_failure.value.write_failure_count === 1,
      bounded_contention: failureInjection.bounded_contention.value.code === "contention",
      flush_failure: failureInjection.flush_failure.value.code === "contention",
    },
  };
  assert.equal(
    Object.values(report.gates).every((gate) => gate === true),
    true,
    `Integration gates failed: ${Object.entries(report.gates)
      .filter(([, passed]) => !passed)
      .map(([name]) => name)
      .join(", ")}`,
  );
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    JSON.stringify({ status: "ok", output: outputPath ?? "stdout", gates: report.gates }) + "\n",
  );
} finally {
  clearProjectSessions();
  restoreEnvironment();
  await rm(root, { recursive: true, force: true });
}
