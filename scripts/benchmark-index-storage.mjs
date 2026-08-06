#!/usr/bin/env node

import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  createSymbolIndexFileEntry,
  InMemorySymbolIndex,
  SYMBOL_INDEX_SCHEMA_VERSION,
} from "../dist/services/symbol-index.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const SCHEMA_VERSION = SYMBOL_INDEX_SCHEMA_VERSION;
const PROJECT = Object.freeze({
  project_id: "project_11111111111111111111",
  config_id: "config_22222222222222222222",
});
const ENTRY_COUNT = 128;
const SYMBOLS_PER_ENTRY = 8;
const QUERY_ITERATIONS = 30;

function parseArgs(argv) {
  const options = { output: undefined, skipPackageSmoke: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") options.output = argv[++index];
    else if (value === "--skip-package-smoke") options.skipPackageSmoke = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createEntries(configDigest = digest("config-v1")) {
  return Array.from({ length: ENTRY_COUNT }, (_, fileIndex) =>
    createSymbolIndexFileEntry({
      project: PROJECT,
      file_path: `src/file-${String(fileIndex).padStart(4, "0")}.ts`,
      content_hash: digest(`source-${fileIndex}`),
      config_digest: configDigest,
      last_indexed_at: "2026-08-06T00:00:00.000Z",
      symbols: Array.from({ length: SYMBOLS_PER_ENTRY }, (_, symbolIndex) => ({
        name: `symbol_${symbolIndex}`,
        symbol_path: `symbol_${symbolIndex}`,
        selector: `symbol_${symbolIndex}@${symbolIndex + 1}`,
        kind: "FunctionDeclaration",
        signature: `export function symbol_${symbolIndex}(): number;`,
        line: symbolIndex + 1,
        range: { start_line: symbolIndex + 1, end_line: symbolIndex + 1 },
      })),
    }),
  );
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value) {
  return Number(value.toFixed(3));
}

async function timed(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: performance.now() - startedAt };
}

function projectMatches(entries, query) {
  const normalizedQuery = query.toLowerCase();
  return entries
    .flatMap((entry) =>
      entry.symbols
        .filter((symbol) =>
          [symbol.name, symbol.symbol_path, symbol.selector, symbol.signature].some((value) =>
            value.toLowerCase().includes(normalizedQuery),
          ),
        )
        .map((symbol) => ({
          ...symbol,
          project: entry.project,
          file_path: entry.file_path,
          content_hash: entry.content_hash,
          config_digest: entry.config_digest,
          index_schema_version: entry.index_schema_version,
        })),
    )
    .sort((left, right) =>
      `${left.file_path}:${left.selector}`.localeCompare(`${right.file_path}:${right.selector}`),
    )
    .slice(0, 256);
}

class MemoryAdapter {
  constructor() {
    this.store = new InMemorySymbolIndex();
  }

  async upsert(entry) {
    await this.store.upsert(entry);
  }

  async query(query) {
    return this.store.querySymbols(query);
  }

  async load() {
    return this.store.load(PROJECT, SCHEMA_VERSION);
  }

  async flush() {}

  async close() {}
}

class JsonFileAdapter {
  constructor(filePath) {
    this.filePath = filePath;
    this.entries = new Map();
    this.loaded = false;
    this.schemaVersion = SCHEMA_VERSION;
  }

  async ensureLoaded() {
    if (this.loaded) return;
    try {
      const document = JSON.parse(await readFile(this.filePath, "utf8"));
      this.schemaVersion = document.schema_version;
      this.entries = new Map(document.entries.map((entry) => [entry.file_path, entry]));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  async upsert(entry) {
    await this.ensureLoaded();
    this.entries.set(entry.file_path, entry);
  }

  async query(query) {
    return projectMatches(await this.load(), query.query).slice(0, query.limit);
  }

  async load() {
    await this.ensureLoaded();
    return [...this.entries.values()]
      .filter((entry) => entry.project.project_id === PROJECT.project_id)
      .filter((entry) => entry.project.config_id === PROJECT.config_id)
      .filter((entry) => entry.index_schema_version === SCHEMA_VERSION)
      .sort((left, right) => left.file_path.localeCompare(right.file_path));
  }

  async flush() {
    await this.ensureLoaded();
    const document = JSON.stringify(
      {
        schema_version: this.schemaVersion,
        entries: [...this.entries.values()].sort((left, right) =>
          left.file_path.localeCompare(right.file_path),
        ),
      },
      null,
      2,
    );
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${document}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, this.filePath);
  }

  async close() {}

  async forceSchemaVersion(version) {
    await this.ensureLoaded();
    this.schemaVersion = version;
    await this.flush();
  }
}

class NativeSqliteAdapter {
  constructor(filePath, DatabaseSync) {
    this.filePath = filePath;
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS symbol_index (
        project_id TEXT NOT NULL,
        config_id TEXT,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        config_digest TEXT NOT NULL,
        symbols_json TEXT NOT NULL,
        last_indexed_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        PRIMARY KEY (project_id, config_id, file_path)
      );
    `);
    this.db
      .prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', ?)")
      .run(String(SCHEMA_VERSION));
  }

  begin() {
    this.db.exec("BEGIN IMMEDIATE");
  }

  async upsert(entry) {
    this.db
      .prepare(
        `INSERT INTO symbol_index
          (project_id, config_id, file_path, content_hash, config_digest, symbols_json, last_indexed_at, schema_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, config_id, file_path) DO UPDATE SET
           content_hash = excluded.content_hash,
           config_digest = excluded.config_digest,
           symbols_json = excluded.symbols_json,
           last_indexed_at = excluded.last_indexed_at,
           schema_version = excluded.schema_version`,
      )
      .run(
        entry.project.project_id,
        entry.project.config_id,
        entry.file_path,
        entry.content_hash,
        entry.config_digest,
        JSON.stringify(entry.symbols),
        entry.last_indexed_at,
        entry.index_schema_version,
      );
  }

  async query(query) {
    const rows = this.db
      .prepare(
        `SELECT project_id, config_id, file_path, content_hash, config_digest, symbols_json,
                last_indexed_at, schema_version
         FROM symbol_index
         WHERE project_id = ? AND config_id IS ? AND schema_version = ?
         ORDER BY file_path`,
      )
      .all(PROJECT.project_id, PROJECT.config_id, SCHEMA_VERSION);
    return projectMatches(
      rows.map((row) =>
        createSymbolIndexFileEntry({
          project: { project_id: row.project_id, config_id: row.config_id },
          file_path: row.file_path,
          content_hash: row.content_hash,
          config_digest: row.config_digest,
          symbols: JSON.parse(row.symbols_json),
          last_indexed_at: row.last_indexed_at,
        }),
      ),
      query.query,
    ).slice(0, query.limit);
  }

  async load() {
    const rows = this.db
      .prepare(
        `SELECT project_id, config_id, file_path, content_hash, config_digest, symbols_json,
                last_indexed_at, schema_version
         FROM symbol_index
         WHERE project_id = ? AND config_id IS ? AND schema_version = ?
         ORDER BY file_path`,
      )
      .all(PROJECT.project_id, PROJECT.config_id, SCHEMA_VERSION);
    return rows.map((row) =>
      createSymbolIndexFileEntry({
        project: { project_id: row.project_id, config_id: row.config_id },
        file_path: row.file_path,
        content_hash: row.content_hash,
        config_digest: row.config_digest,
        symbols: JSON.parse(row.symbols_json),
        last_indexed_at: row.last_indexed_at,
      }),
    );
  }

  async flush() {
    try {
      this.db.exec("COMMIT");
    } catch (error) {
      if (!String(error?.message).includes("no transaction is active")) throw error;
    }
  }

  async close() {
    this.db.close();
  }

  forceSchemaVersion(version) {
    this.db
      .prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'")
      .run(String(version));
  }

  migrate() {
    const current = Number(
      this.db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()?.value,
    );
    if (current === SCHEMA_VERSION) return false;
    this.db
      .prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'")
      .run(String(SCHEMA_VERSION));
    return true;
  }
}

async function detectNativeSqlite() {
  if (typeof process.getBuiltinModule === "function") {
    const module = process.getBuiltinModule("node:sqlite");
    if (module?.DatabaseSync) return module.DatabaseSync;
  }
  try {
    const module = await import("node:sqlite");
    return module.DatabaseSync;
  } catch {
    return undefined;
  }
}

function detectPortableWasm() {
  for (const packageName of ["@sqlite.org/sqlite-wasm", "sql.js", "wa-sqlite"]) {
    try {
      return { package: packageName, resolved: require.resolve(packageName) };
    } catch {
      // The absence is evidence for the report, not a reason to install a dependency here.
    }
  }
  return undefined;
}

function detectRuntimeMatrix() {
  const targets = [
    { target: "node22.5+", env: "INDEX_STORAGE_NODE22_5_BIN" },
    { target: "node24+", env: "INDEX_STORAGE_NODE24_BIN" },
  ];
  return targets.map(({ target, env }) => ({
    target,
    status: process.env[env] ? "configured" : "not_available",
    executable: process.env[env] ?? null,
    note: process.env[env]
      ? "Configured for a follow-up run; this report measures the current runtime only."
      : "No compatible executable was found; no download or implicit runtime installation was attempted.",
  }));
}

async function seed(adapter, entries) {
  if (typeof adapter.begin === "function") adapter.begin();
  for (const entry of entries) await adapter.upsert(entry);
  await adapter.flush();
}

async function runMemoryBenchmark(entries) {
  const adapter = new MemoryAdapter();
  const initial = await timed(() => seed(adapter, entries));
  const queryDurations = [];
  let queryCount = 0;
  for (let index = 0; index < QUERY_ITERATIONS; index += 1) {
    const result = await timed(() =>
      adapter.query({ project: PROJECT, query: "symbol_0", limit: 256 }),
    );
    queryDurations.push(result.durationMs);
    queryCount = result.value.length;
  }
  const changed = { ...entries[0], content_hash: digest("source-0-changed") };
  const changedResult = await timed(() => seed(adapter, [changed]));
  const configEntries = createEntries(digest("config-v2"));
  const configResult = await timed(() => seed(adapter, configEntries));
  return {
    backend: "memory",
    status: "available",
    storage_bytes: null,
    operations: {
      initial_rebuild: round(initial.durationMs),
      warm_query_p50: round(percentile(queryDurations, 0.5)),
      warm_query_p95: round(percentile(queryDurations, 0.95)),
      changed_file_rebuild: round(changedResult.durationMs),
      config_rebuild: round(configResult.durationMs),
    },
    evidence: {
      initial_entries: (await adapter.load()).length,
      warm_query_matches: queryCount,
      restart: {
        status: "not_applicable",
        reason: "Memory-only state is intentionally not durable.",
      },
      migration: { status: "not_applicable", reason: "No persisted schema exists." },
      corruption_recovery: { status: "not_applicable", reason: "No persisted bytes exist." },
      source_bodies_persisted: false,
    },
  };
}

async function runJsonBenchmark(filePath, entries) {
  const adapter = new JsonFileAdapter(filePath);
  const initial = await timed(() => seed(adapter, entries));
  const queryDurations = [];
  let queryCount = 0;
  for (let index = 0; index < QUERY_ITERATIONS; index += 1) {
    const result = await timed(() =>
      adapter.query({ project: PROJECT, query: "symbol_0", limit: 256 }),
    );
    queryDurations.push(result.durationMs);
    queryCount = result.value.length;
  }
  const changedResult = await timed(() =>
    seed(adapter, [{ ...entries[0], content_hash: digest("source-0-changed") }]),
  );
  const configResult = await timed(() => seed(adapter, createEntries(digest("config-v2"))));
  await adapter.close();
  const restarted = new JsonFileAdapter(filePath);
  const restartResult = await timed(() => restarted.load());
  await restarted.forceSchemaVersion(0);
  const migrationResult = await timed(async () => {
    const migrated = new JsonFileAdapter(filePath);
    await migrated.ensureLoaded();
    await migrated.forceSchemaVersion(SCHEMA_VERSION);
    return migrated.load();
  });
  await writeFile(filePath, "{ corrupted", "utf8");
  const corruptionResult = await timed(async () => {
    let recovered = false;
    try {
      await new JsonFileAdapter(filePath).load();
    } catch {
      recovered = true;
      await rm(filePath, { force: true });
      const rebuilt = new JsonFileAdapter(filePath);
      await seed(rebuilt, entries);
      return { recovered, entries: (await rebuilt.load()).length };
    }
    return { recovered, entries: 0 };
  });
  const bytes = (await stat(filePath)).size;
  return {
    backend: "file-json",
    status: "available",
    storage_bytes: bytes,
    operations: {
      initial_rebuild: round(initial.durationMs),
      warm_query_p50: round(percentile(queryDurations, 0.5)),
      warm_query_p95: round(percentile(queryDurations, 0.95)),
      changed_file_rebuild: round(changedResult.durationMs),
      config_rebuild: round(configResult.durationMs),
      restart_load: round(restartResult.durationMs),
      migration: round(migrationResult.durationMs),
      corruption_recovery: round(corruptionResult.durationMs),
    },
    evidence: {
      initial_entries: entries.length,
      warm_query_matches: queryCount,
      restart: { status: restartResult.value.length === entries.length ? "pass" : "fail" },
      migration: { status: migrationResult.value.length === entries.length ? "pass" : "fail" },
      corruption_recovery: corruptionResult.value,
      source_bodies_persisted: JSON.stringify(await restarted.load()).includes('"body"'),
    },
  };
}

async function runNativeSqliteBenchmark(filePath, entries, DatabaseSync) {
  const adapter = new NativeSqliteAdapter(filePath, DatabaseSync);
  const initial = await timed(() => seed(adapter, entries));
  const queryDurations = [];
  let queryCount = 0;
  for (let index = 0; index < QUERY_ITERATIONS; index += 1) {
    const result = await timed(() =>
      adapter.query({ project: PROJECT, query: "symbol_0", limit: 256 }),
    );
    queryDurations.push(result.durationMs);
    queryCount = result.value.length;
  }
  const changedResult = await timed(() =>
    seed(adapter, [{ ...entries[0], content_hash: digest("source-0-changed") }]),
  );
  const configResult = await timed(() => seed(adapter, createEntries(digest("config-v2"))));
  adapter.forceSchemaVersion(0);
  const migrationResult = await timed(() => adapter.migrate());
  await adapter.close();
  const restarted = new NativeSqliteAdapter(filePath, DatabaseSync);
  const restartResult = await timed(() => restarted.load());
  await restarted.close();
  await writeFile(filePath, "not a sqlite database", "utf8");
  const corruptionResult = await timed(async () => {
    let recovered = false;
    try {
      new NativeSqliteAdapter(filePath, DatabaseSync);
    } catch {
      recovered = true;
      await rm(filePath, { force: true });
      const rebuilt = new NativeSqliteAdapter(filePath, DatabaseSync);
      await seed(rebuilt, entries);
      await rebuilt.close();
    }
    return { recovered };
  });
  const bytes = (await stat(filePath)).size;
  return {
    backend: "native-sqlite",
    status: "available",
    storage_bytes: bytes,
    operations: {
      initial_rebuild: round(initial.durationMs),
      warm_query_p50: round(percentile(queryDurations, 0.5)),
      warm_query_p95: round(percentile(queryDurations, 0.95)),
      changed_file_rebuild: round(changedResult.durationMs),
      config_rebuild: round(configResult.durationMs),
      restart_load: round(restartResult.durationMs),
      migration: round(migrationResult.durationMs),
      corruption_recovery: round(corruptionResult.durationMs),
    },
    evidence: {
      initial_entries: entries.length,
      warm_query_matches: queryCount,
      restart: { status: restartResult.value.length === entries.length ? "pass" : "fail" },
      migration: { status: migrationResult.value ? "pass" : "fail" },
      corruption_recovery: corruptionResult.value,
      source_bodies_persisted: false,
    },
  };
}

async function runPackageSmoke(repositoryRoot) {
  try {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/package-smoke.mjs"], {
      cwd: repositoryRoot,
      maxBuffer: 20 * 1024 * 1024,
    });
    const lines = stdout.trim().split("\n").filter(Boolean);
    return { status: "pass", report: JSON.parse(lines.at(-1)) };
  } catch (error) {
    return { status: "fail", error: String(error?.message ?? error).slice(0, 512) };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const temporaryDirectory = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "ast-index-storage-")),
  );
  const entries = createEntries();
  const DatabaseSync = await detectNativeSqlite();
  const wasm = detectPortableWasm();
  let results;
  try {
    results = [
      await runMemoryBenchmark(entries),
      await runJsonBenchmark(path.join(temporaryDirectory, "index.json"), entries),
    ];
    if (DatabaseSync) {
      results.push(
        await runNativeSqliteBenchmark(
          path.join(temporaryDirectory, "index.sqlite"),
          entries,
          DatabaseSync,
        ),
      );
    } else {
      results.push({
        backend: "native-sqlite",
        status: "unavailable",
        reason: "node:sqlite is unavailable on this runtime; no native dependency was installed.",
      });
    }
    results.push(
      wasm
        ? {
            backend: "portable-wasm-sqlite",
            status: "detected_not_benchmarked",
            package: wasm.package,
            resolved: path.basename(wasm.resolved),
            reason:
              "A portable WASM package is present but no dependency-specific adapter is selected.",
          }
        : {
            backend: "portable-wasm-sqlite",
            status: "unavailable",
            reason:
              "No portable WASM SQLite package is installed; dependency selection is deferred to the ADR.",
          },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const yarnConfig = await readFile(path.join(repositoryRoot, ".yarnrc.yml"), "utf8");
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    runtime: {
      current: {
        node: process.version,
        executable: process.execPath,
        native_sqlite: Boolean(DatabaseSync),
      },
      targets: detectRuntimeMatrix(),
    },
    packaging: {
      lifecycle_scripts_disabled: /enableScripts:\s*false/.test(yarnConfig),
      isolated_tarball_install: options.skipPackageSmoke
        ? { status: "skipped", reason: "--skip-package-smoke was requested." }
        : await runPackageSmoke(repositoryRoot),
    },
    workload: {
      files: ENTRY_COUNT,
      symbols_per_file: SYMBOLS_PER_ENTRY,
      query_iterations: QUERY_ITERATIONS,
      query: "symbol_0",
      source_bodies_in_payload: false,
      note: "Synthetic body-free SymbolIndexFileEntry records; timings are local observations, not SLAs.",
    },
    results,
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await writeFile(path.resolve(options.output), output, "utf8");
  }
  process.stdout.write(output);
}

await main();
