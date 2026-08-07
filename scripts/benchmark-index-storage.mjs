#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
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
import { symbolMatchRank } from "../dist/services/symbols.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const SCHEMA_VERSION = SYMBOL_INDEX_SCHEMA_VERSION;
const PROJECT = Object.freeze({
  project_id: "project_11111111111111111111",
  config_id: "config_22222222222222222222",
});
const OTHER_PROJECT = Object.freeze({
  project_id: "project_33333333333333333333",
  config_id: "config_44444444444444444444",
});
const ENTRY_COUNT = 128;
const SYMBOLS_PER_ENTRY = 8;
const QUERY_ITERATIONS = 30;
const BACKENDS = new Set(["all", "memory", "json", "sqlite"]);
const SCENARIOS = new Set(["all", "migration", "cross-project"]);

function parseArgs(argv) {
  const options = {
    output: undefined,
    skipPackageSmoke: false,
    backend: "all",
    scenario: "all",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") options.output = argv[++index];
    else if (value === "--skip-package-smoke") options.skipPackageSmoke = true;
    else if (value === "--backend") options.backend = argv[++index];
    else if (value === "--scenario") options.scenario = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!BACKENDS.has(options.backend)) {
    throw new Error(`Unsupported backend: ${options.backend}`);
  }
  if (!SCENARIOS.has(options.scenario)) {
    throw new Error(`Unsupported scenario: ${options.scenario}`);
  }
  if (options.scenario !== "all" && !["json", "sqlite"].includes(options.backend)) {
    throw new Error("Focused scenarios require --backend json or --backend sqlite.");
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

async function storageSize(filePath) {
  const paths = [filePath, `${filePath}-wal`, `${filePath}-shm`];
  const sizes = await Promise.all(
    paths.map(async (candidate) => {
      try {
        return (await stat(candidate)).size;
      } catch (error) {
        if (error?.code === "ENOENT") return 0;
        throw error;
      }
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function assertQueryLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Symbol index query limit must be a positive integer.");
  }
}

function sameProject(left, right) {
  return left.project_id === right.project_id && left.config_id === right.config_id;
}

function entryKey(project, filePath) {
  return `${project.project_id}\u0000${project.config_id ?? ""}\u0000${filePath}`;
}

async function timed(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: performance.now() - startedAt };
}

function projectMatches(entries, query) {
  assertQueryLimit(query.limit);
  const normalizedQuery = query.query.toLowerCase();
  const normalizedFileFilter = query.filters?.file_path?.toLowerCase();
  const kindSet = query.filters?.kinds ? new Set(query.filters.kinds) : undefined;
  return entries
    .flatMap((entry) =>
      entry.symbols
        .filter(
          () =>
            !normalizedFileFilter || entry.file_path.toLowerCase().includes(normalizedFileFilter),
        )
        .filter((symbol) => !kindSet || kindSet.has(symbol.kind))
        .filter((symbol) =>
          [symbol.name, symbol.symbol_path, symbol.selector].some((value) =>
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
    .sort((left, right) => {
      const rank =
        symbolMatchRank(query.query, {
          symbolPath: left.symbol_path,
          name: left.name,
          line: left.line,
        }) -
        symbolMatchRank(query.query, {
          symbolPath: right.symbol_path,
          name: right.name,
          line: right.line,
        });
      if (rank !== 0) return rank;
      return (
        left.file_path.localeCompare(right.file_path) ||
        left.line - right.line ||
        left.symbol_path.localeCompare(right.symbol_path) ||
        left.kind.localeCompare(right.kind)
      );
    })
    .slice(0, query.limit);
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

  async load(project = PROJECT, schemaVersion = SCHEMA_VERSION) {
    return this.store.load(project, schemaVersion);
  }

  async remove(project, filePath) {
    await this.store.remove(project, filePath);
  }

  async clear(project) {
    await this.store.clear(project);
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
      this.entries = new Map(
        document.entries.map((entry) => [entryKey(entry.project, entry.file_path), entry]),
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  async upsert(entry) {
    await this.ensureLoaded();
    this.entries.set(entryKey(entry.project, entry.file_path), entry);
  }

  async query(query) {
    return projectMatches(await this.load(query.project), query);
  }

  async load(project = PROJECT, schemaVersion = SCHEMA_VERSION) {
    await this.ensureLoaded();
    return [...this.entries.values()]
      .filter((entry) => sameProject(entry.project, project))
      .filter((entry) => entry.index_schema_version === schemaVersion)
      .sort((left, right) => left.file_path.localeCompare(right.file_path));
  }

  async remove(project, filePath) {
    await this.ensureLoaded();
    this.entries.delete(entryKey(project, filePath));
  }

  async clear(project) {
    await this.ensureLoaded();
    for (const [key, value] of this.entries) {
      if (sameProject(value.project, project)) this.entries.delete(key);
    }
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

  async forceEntrySchemaVersion(version) {
    await this.ensureLoaded();
    this.schemaVersion = version;
    this.entries = new Map(
      [...this.entries.values()].map((entry) => [
        entryKey(entry.project, entry.file_path),
        { ...entry, index_schema_version: version },
      ]),
    );
    await this.flush();
  }

  async migrateRows() {
    await this.ensureLoaded();
    const before = [...this.entries.values()].filter(
      (entry) => entry.index_schema_version !== SCHEMA_VERSION,
    ).length;
    this.schemaVersion = SCHEMA_VERSION;
    this.entries = new Map(
      [...this.entries.values()].map((entry) => [
        entryKey(entry.project, entry.file_path),
        { ...entry, index_schema_version: SCHEMA_VERSION },
      ]),
    );
    await this.flush();
    const after = [...this.entries.values()].filter(
      (entry) => entry.index_schema_version !== SCHEMA_VERSION,
    ).length;
    return {
      status: before > 0 && after === 0 ? "pass" : "fail",
      before,
      after,
      entries: this.entries.size,
    };
  }
}

class NativeSqliteAdapter {
  constructor(filePath, DatabaseSync) {
    this.filePath = filePath;
    assertSqliteDatabaseHeader(filePath);
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA busy_timeout = 1000;
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
    return projectMatches(await this.load(query.project), query);
  }

  async load(project = PROJECT, schemaVersion = SCHEMA_VERSION) {
    const rows = this.db
      .prepare(
        `SELECT project_id, config_id, file_path, content_hash, config_digest, symbols_json,
                last_indexed_at, schema_version
         FROM symbol_index
         WHERE project_id = ? AND config_id IS ? AND schema_version = ?
         ORDER BY file_path`,
      )
      .all(project.project_id, project.config_id, schemaVersion);
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

  async remove(project, filePath) {
    this.db
      .prepare("DELETE FROM symbol_index WHERE project_id = ? AND config_id IS ? AND file_path = ?")
      .run(project.project_id, project.config_id, filePath);
  }

  async clear(project) {
    this.db
      .prepare("DELETE FROM symbol_index WHERE project_id = ? AND config_id IS ?")
      .run(project.project_id, project.config_id);
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

  forceEntrySchemaVersion(version) {
    this.db.exec("BEGIN IMMEDIATE");
    this.db.prepare("UPDATE symbol_index SET schema_version = ?").run(version);
    this.db
      .prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'")
      .run(String(version));
    this.db.exec("COMMIT");
  }

  migrateRows() {
    const before = Number(
      this.db
        .prepare("SELECT COUNT(*) AS count FROM symbol_index WHERE schema_version <> ?")
        .get(SCHEMA_VERSION).count,
    );
    this.db.exec("BEGIN IMMEDIATE");
    this.db
      .prepare("UPDATE symbol_index SET schema_version = ? WHERE schema_version <> ?")
      .run(SCHEMA_VERSION, SCHEMA_VERSION);
    this.db
      .prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'")
      .run(String(SCHEMA_VERSION));
    this.db.exec("COMMIT");
    const after = Number(
      this.db
        .prepare("SELECT COUNT(*) AS count FROM symbol_index WHERE schema_version <> ?")
        .get(SCHEMA_VERSION).count,
    );
    const entries = Number(
      this.db.prepare("SELECT COUNT(*) AS count FROM symbol_index").get().count,
    );
    return {
      status: before > 0 && after === 0 ? "pass" : "fail",
      before,
      after,
      entries,
    };
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

function assertSqliteDatabaseHeader(filePath) {
  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  const header = Buffer.from("SQLite format 3\u0000", "utf8");
  if (!bytes.subarray(0, header.length).equals(header)) {
    throw new Error("SQLite database header is invalid.");
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

function compareVersionParts(left, right) {
  for (let index = 0; index < right.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
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

async function detectRuntimeMatrix() {
  const targets = [
    { target: "node22.5+", env: "INDEX_STORAGE_NODE22_5_BIN", minimum: [22, 5, 0] },
    { target: "node24+", env: "INDEX_STORAGE_NODE24_BIN", minimum: [24, 0, 0] },
  ];
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  return Promise.all(
    targets.map(async ({ target, env, minimum }) => {
      const executable = process.env[env];
      if (!executable) {
        return {
          target,
          status: "not_available",
          executable: null,
          note: "No compatible executable was found; no download or implicit runtime installation was attempted.",
        };
      }
      try {
        const { stdout } = await execFileAsync(
          executable,
          ["-e", "process.stdout.write(process.version)"],
          { env: environment, timeout: 5000, maxBuffer: 1024 },
        );
        const version = stdout.trim();
        const actualVersion = version.replace(/^v/, "").split(".").map(Number);
        const satisfiesMinimum = compareVersionParts(actualVersion, minimum) >= 0;
        return {
          target,
          status: satisfiesMinimum ? "pass" : "fail",
          executable,
          version,
          note: satisfiesMinimum
            ? "Executable identity probe passed."
            : "Executable is below the declared minimum.",
        };
      } catch (error) {
        return {
          target,
          status: "fail",
          executable,
          note: String(error?.message ?? error).slice(0, 256),
        };
      }
    }),
  );
}

async function seed(adapter, entries) {
  if (typeof adapter.begin === "function") adapter.begin();
  for (const entry of entries) await adapter.upsert(entry);
  await adapter.flush();
}

async function runStoreConformance(name, createAdapter, cleanup) {
  const adapter = await createAdapter();
  const entries = createEntries(digest(`conformance-${name}`));
  const primary = { ...entries[0], file_path: "src/conformance-primary.ts" };
  const secondary = { ...entries[1], file_path: "src/conformance-secondary.ts" };
  const foreign = {
    ...entries[2],
    project: OTHER_PROJECT,
    file_path: "src/conformance-foreign.ts",
  };

  try {
    await adapter.upsert(primary);
    await adapter.upsert(secondary);
    await adapter.upsert(foreign);

    const loaded = await adapter.load(PROJECT, SCHEMA_VERSION);
    assert.deepEqual(
      loaded.map((entry) => entry.file_path),
      [primary.file_path, secondary.file_path].sort(),
      `${name}: load must isolate project identity and sort paths`,
    );
    assert.equal(
      (await adapter.load(OTHER_PROJECT, SCHEMA_VERSION)).length,
      1,
      `${name}: foreign project entry must remain isolated`,
    );
    assert.equal(
      (await adapter.load(PROJECT, 999)).length,
      0,
      `${name}: unsupported schema must not load as current`,
    );

    const query = await adapter.query({
      project: PROJECT,
      query: "symbol_0",
      filters: { file_path: "conformance", kinds: ["FunctionDeclaration"] },
      limit: 1,
    });
    assert.equal(query.length, 1, `${name}: query limit and filters must be enforced`);
    assert.equal(query[0].file_path, primary.file_path, `${name}: query result must be scoped`);
    assert.equal(
      JSON.stringify(loaded).includes("source_body"),
      false,
      `${name}: source bodies must not be persisted`,
    );

    await adapter.remove(PROJECT, primary.file_path);
    assert.equal(
      (await adapter.load(PROJECT, SCHEMA_VERSION)).some(
        (entry) => entry.file_path === primary.file_path,
      ),
      false,
      `${name}: remove must delete only the selected file`,
    );
    await adapter.clear(PROJECT);
    assert.equal(
      (await adapter.load(PROJECT, SCHEMA_VERSION)).length,
      0,
      `${name}: clear must remove the selected project`,
    );
    assert.equal(
      (await adapter.load(OTHER_PROJECT, SCHEMA_VERSION)).length,
      1,
      `${name}: clear must not remove another project`,
    );
    await adapter.flush();
    return { status: "pass" };
  } finally {
    await adapter.close();
    await cleanup?.();
  }
}

async function runInterruptedJsonFlush(filePath, expectedEntries) {
  const temporaryPath = `${filePath}.interrupted.tmp`;
  const script = `
    import { writeFile } from "node:fs/promises";
    await writeFile(${JSON.stringify(temporaryPath)}, "{\\"schema_version\\":1,\\"entries\\":[", "utf8");
    process.kill(process.pid, "SIGKILL");
  `;
  let killed = false;
  try {
    await execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
  } catch (error) {
    killed = error?.signal === "SIGKILL";
  }

  const recovered = new JsonFileAdapter(filePath);
  const entries = await recovered.load();
  await rm(temporaryPath, { force: true });
  return {
    status: killed && entries.length === expectedEntries ? "pass" : "fail",
    entries: entries.length,
  };
}

async function runInterruptedSqliteFlush(filePath, DatabaseSync, expectedEntry) {
  const interruptedHash = "z".repeat(64);
  const script = `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(filePath)});
    db.exec("BEGIN IMMEDIATE");
    db.prepare("UPDATE symbol_index SET content_hash = ? WHERE project_id = ? AND config_id IS ? AND file_path = ?")
      .run(${JSON.stringify(interruptedHash)}, ${JSON.stringify(PROJECT.project_id)}, ${JSON.stringify(PROJECT.config_id)}, ${JSON.stringify(expectedEntry.file_path)});
    process.kill(process.pid, "SIGKILL");
  `;
  let killed = false;
  try {
    await execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
  } catch (error) {
    killed = error?.signal === "SIGKILL";
  }

  const recovered = new NativeSqliteAdapter(filePath, DatabaseSync);
  const entries = await recovered.load();
  await recovered.close();
  const unchanged = entries.find((entry) => entry.file_path === expectedEntry.file_path);
  return {
    status: killed && unchanged?.content_hash === expectedEntry.content_hash ? "pass" : "fail",
    entries: entries.length,
  };
}

async function runConcurrentJsonWriters(filePath, entries) {
  const writers = [
    {
      entry: { ...entries[0], file_path: "src/concurrent-left.ts" },
      temporaryPath: `${filePath}.concurrent-left.tmp`,
    },
    {
      entry: { ...entries[1], file_path: "src/concurrent-right.ts" },
      temporaryPath: `${filePath}.concurrent-right.tmp`,
    },
  ];
  const results = await Promise.allSettled(
    writers.map(({ entry, temporaryPath }) => {
      const script = `
        import { readFile, rename, writeFile } from "node:fs/promises";
        const filePath = ${JSON.stringify(filePath)};
        const temporaryPath = ${JSON.stringify(temporaryPath)};
        const entry = ${JSON.stringify(entry)};
        const document = JSON.parse(await readFile(filePath, "utf8"));
        document.entries = document.entries.filter((item) => item.file_path !== entry.file_path);
        document.entries.push(entry);
        await writeFile(temporaryPath, JSON.stringify(document, null, 2) + "\\n", "utf8");
        await new Promise((resolve) => setTimeout(resolve, 50));
        await rename(temporaryPath, filePath);
      `;
      return execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
    }),
  );
  await Promise.all(writers.map(({ temporaryPath }) => rm(temporaryPath, { force: true })));
  let loaded;
  try {
    loaded = await new JsonFileAdapter(filePath).load();
  } catch (error) {
    return { status: "fail", reason: String(error?.message ?? error).slice(0, 256) };
  }
  const present = writers.filter(({ entry }) =>
    loaded.some((candidate) => candidate.file_path === entry.file_path),
  ).length;
  return {
    status:
      results.every((result) => result.status === "fulfilled") && present === 2 ? "pass" : "fail",
    present,
    reason: present === 2 ? undefined : "concurrent writers lost at least one committed entry",
  };
}

async function runConcurrentJsonCrossProjectWriters(filePath, entries) {
  const writers = [
    {
      entry: { ...entries[0], project: PROJECT, file_path: "src/cross-primary.ts" },
      temporaryPath: `${filePath}.cross-primary.tmp`,
    },
    {
      entry: { ...entries[1], project: OTHER_PROJECT, file_path: "src/cross-foreign.ts" },
      temporaryPath: `${filePath}.cross-foreign.tmp`,
    },
  ];
  const results = await Promise.allSettled(
    writers.map(({ entry, temporaryPath }) => {
      const script = `
        import { readFile, rename, writeFile } from "node:fs/promises";
        const filePath = ${JSON.stringify(filePath)};
        const temporaryPath = ${JSON.stringify(temporaryPath)};
        const entry = ${JSON.stringify(entry)};
        const document = JSON.parse(await readFile(filePath, "utf8"));
        const key = (item) => JSON.stringify([item.project.project_id, item.project.config_id, item.file_path]);
        document.entries = document.entries.filter((item) => key(item) !== key(entry));
        document.entries.push(entry);
        await writeFile(temporaryPath, JSON.stringify(document, null, 2) + "\\n", "utf8");
        await new Promise((resolve) => setTimeout(resolve, 50));
        await rename(temporaryPath, filePath);
      `;
      return execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
    }),
  );
  await Promise.all(writers.map(({ temporaryPath }) => rm(temporaryPath, { force: true })));
  let primaryLoaded;
  let foreignLoaded;
  try {
    const adapter = new JsonFileAdapter(filePath);
    primaryLoaded = await adapter.load(PROJECT);
    foreignLoaded = await adapter.load(OTHER_PROJECT);
  } catch (error) {
    return { status: "fail", reason: String(error?.message ?? error).slice(0, 256) };
  }
  const primaryPresent = primaryLoaded.some(
    (entry) => entry.file_path === writers[0].entry.file_path,
  );
  const foreignPresent = foreignLoaded.some(
    (entry) => entry.file_path === writers[1].entry.file_path,
  );
  const leaked =
    primaryLoaded.some((entry) => entry.file_path === writers[1].entry.file_path) ||
    foreignLoaded.some((entry) => entry.file_path === writers[0].entry.file_path);
  return {
    status:
      results.every((result) => result.status === "fulfilled") &&
      primaryPresent &&
      foreignPresent &&
      !leaked
        ? "pass"
        : "fail",
    primary_present: primaryPresent,
    foreign_present: foreignPresent,
    leaked,
  };
}

async function runConcurrentSqliteWriters(filePath, DatabaseSync, entries) {
  const writers = [
    { ...entries[0], file_path: "src/concurrent-left.ts" },
    { ...entries[1], file_path: "src/concurrent-right.ts" },
  ];
  const results = await Promise.allSettled(
    writers.map((entry) => {
      const script = `
        import { DatabaseSync } from "node:sqlite";
        const db = new DatabaseSync(${JSON.stringify(filePath)});
        db.exec("PRAGMA busy_timeout = 1000");
        db.prepare("INSERT OR REPLACE INTO symbol_index (project_id, config_id, file_path, content_hash, config_digest, symbols_json, last_indexed_at, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(${JSON.stringify(entry.project.project_id)}, ${JSON.stringify(entry.project.config_id)}, ${JSON.stringify(entry.file_path)}, ${JSON.stringify(entry.content_hash)}, ${JSON.stringify(entry.config_digest)}, ${JSON.stringify(JSON.stringify(entry.symbols))}, ${JSON.stringify(entry.last_indexed_at)}, ${JSON.stringify(entry.index_schema_version)});
        db.close();
      `;
      return execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
    }),
  );
  const recovered = new NativeSqliteAdapter(filePath, DatabaseSync);
  const loaded = await recovered.load();
  await recovered.close();
  const present = writers.filter(({ file_path }) =>
    loaded.some((candidate) => candidate.file_path === file_path),
  ).length;
  return {
    status:
      results.every((result) => result.status === "fulfilled") && present === 2 ? "pass" : "fail",
    present,
    reason: present === 2 ? undefined : "concurrent writers lost at least one committed entry",
  };
}

async function runConcurrentSqliteCrossProjectWriters(filePath, DatabaseSync, entries) {
  const writers = [
    { ...entries[0], project: PROJECT, file_path: "src/cross-primary.ts" },
    { ...entries[1], project: OTHER_PROJECT, file_path: "src/cross-foreign.ts" },
  ];
  const results = await Promise.allSettled(
    writers.map((entry) => {
      const script = `
        import { DatabaseSync } from "node:sqlite";
        const db = new DatabaseSync(${JSON.stringify(filePath)});
        db.exec("PRAGMA busy_timeout = 1000");
        db.prepare("INSERT OR REPLACE INTO symbol_index (project_id, config_id, file_path, content_hash, config_digest, symbols_json, last_indexed_at, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(${JSON.stringify(entry.project.project_id)}, ${JSON.stringify(entry.project.config_id)}, ${JSON.stringify(entry.file_path)}, ${JSON.stringify(entry.content_hash)}, ${JSON.stringify(entry.config_digest)}, ${JSON.stringify(JSON.stringify(entry.symbols))}, ${JSON.stringify(entry.last_indexed_at)}, ${JSON.stringify(entry.index_schema_version)});
        db.close();
      `;
      return execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
    }),
  );
  const recovered = new NativeSqliteAdapter(filePath, DatabaseSync);
  const primaryLoaded = await recovered.load(PROJECT);
  const foreignLoaded = await recovered.load(OTHER_PROJECT);
  await recovered.close();
  const primaryPresent = primaryLoaded.some((entry) => entry.file_path === writers[0].file_path);
  const foreignPresent = foreignLoaded.some((entry) => entry.file_path === writers[1].file_path);
  const leaked =
    primaryLoaded.some((entry) => entry.file_path === writers[1].file_path) ||
    foreignLoaded.some((entry) => entry.file_path === writers[0].file_path);
  return {
    status:
      results.every((result) => result.status === "fulfilled") &&
      primaryPresent &&
      foreignPresent &&
      !leaked
        ? "pass"
        : "fail",
    primary_present: primaryPresent,
    foreign_present: foreignPresent,
    leaked,
  };
}

async function runConcurrentSqliteReadersAndWriter(filePath, DatabaseSync, entries) {
  const entry = { ...entries[2], file_path: "src/concurrent-reader-writer.ts" };
  const readerScript = `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(filePath)});
    db.exec("PRAGMA busy_timeout = 1000");
    const before = db.prepare("SELECT COUNT(*) AS count FROM symbol_index").get().count;
    if (before < ${entries.length}) process.exit(2);
    await new Promise((resolve) => setTimeout(resolve, 75));
    const after = db.prepare("SELECT COUNT(*) AS count FROM symbol_index").get().count;
    if (after < ${entries.length}) process.exit(3);
    db.close();
  `;
  const writerScript = `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(${JSON.stringify(filePath)});
    db.exec("PRAGMA busy_timeout = 1000");
    db.prepare("INSERT OR REPLACE INTO symbol_index (project_id, config_id, file_path, content_hash, config_digest, symbols_json, last_indexed_at, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(${JSON.stringify(entry.project.project_id)}, ${JSON.stringify(entry.project.config_id)}, ${JSON.stringify(entry.file_path)}, ${JSON.stringify(entry.content_hash)}, ${JSON.stringify(entry.config_digest)}, ${JSON.stringify(JSON.stringify(entry.symbols))}, ${JSON.stringify(entry.last_indexed_at)}, ${JSON.stringify(entry.index_schema_version)});
    db.close();
  `;
  const results = await Promise.allSettled([
    execFileAsync(process.execPath, ["--input-type=module", "-e", readerScript]),
    execFileAsync(process.execPath, ["--input-type=module", "-e", readerScript]),
    execFileAsync(process.execPath, ["--input-type=module", "-e", writerScript]),
  ]);
  const recovered = new NativeSqliteAdapter(filePath, DatabaseSync);
  const loaded = await recovered.load();
  await recovered.close();
  const writerPresent = loaded.some((candidate) => candidate.file_path === entry.file_path);
  return {
    status:
      results.every((result) => result.status === "fulfilled") && writerPresent ? "pass" : "fail",
    readers: 2,
    writer_present: writerPresent,
  };
}

async function runMemoryBenchmark(entries) {
  const adapter = new MemoryAdapter();
  const conformance = await runStoreConformance("memory", () => new MemoryAdapter());
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
      conformance,
    },
  };
}

async function runJsonBenchmark(filePath, entries) {
  const adapter = new JsonFileAdapter(filePath);
  const conformance = await runStoreConformance(
    "file-json",
    () => new JsonFileAdapter(`${filePath}.conformance`),
    async () => rm(`${filePath}.conformance`, { force: true }),
  );
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
  await adapter.forceEntrySchemaVersion(SCHEMA_VERSION - 1);
  const migrationResult = await timed(() => adapter.migrateRows());
  await adapter.close();
  const restarted = new JsonFileAdapter(filePath);
  const restartResult = await timed(() => restarted.load());
  const interruptedResult = await timed(() => runInterruptedJsonFlush(filePath, entries.length));
  const concurrencyResult = await timed(() => runConcurrentJsonWriters(filePath, entries));
  const crossProjectResult = await timed(() =>
    runConcurrentJsonCrossProjectWriters(filePath, entries),
  );
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
      const rebuiltEntries = await rebuilt.load();
      return {
        recovered,
        entries: rebuiltEntries.length,
        source_bodies_persisted: JSON.stringify(rebuiltEntries).includes('"body"'),
      };
    }
    return { recovered, entries: 0, source_bodies_persisted: false };
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
      interrupted_flush: round(interruptedResult.durationMs),
      concurrency: round(concurrencyResult.durationMs),
      cross_project: round(crossProjectResult.durationMs),
      corruption_recovery: round(corruptionResult.durationMs),
    },
    evidence: {
      initial_entries: entries.length,
      warm_query_matches: queryCount,
      restart: { status: restartResult.value.length === entries.length ? "pass" : "fail" },
      migration: migrationResult.value,
      interrupted_flush: interruptedResult.value,
      concurrency: concurrencyResult.value,
      cross_project: crossProjectResult.value,
      corruption_recovery: corruptionResult.value,
      source_bodies_persisted: corruptionResult.value.source_bodies_persisted,
      conformance,
    },
  };
}

async function runNativeSqliteBenchmark(filePath, entries, DatabaseSync) {
  const adapter = new NativeSqliteAdapter(filePath, DatabaseSync);
  const conformance = await runStoreConformance(
    "native-sqlite",
    () => new NativeSqliteAdapter(`${filePath}.conformance`, DatabaseSync),
    async () =>
      Promise.all(
        ["", "-wal", "-shm"].map((suffix) =>
          rm(`${filePath}.conformance${suffix}`, { force: true }),
        ),
      ),
  );
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
  adapter.forceEntrySchemaVersion(SCHEMA_VERSION - 1);
  const migrationResult = await timed(() => adapter.migrateRows());
  await adapter.close();
  const restarted = new NativeSqliteAdapter(filePath, DatabaseSync);
  const restartResult = await timed(() => restarted.load());
  await restarted.close();
  const interruptedResult = await timed(() =>
    runInterruptedSqliteFlush(filePath, DatabaseSync, entries[0]),
  );
  const concurrencyResult = await timed(() =>
    runConcurrentSqliteWriters(filePath, DatabaseSync, entries),
  );
  const crossProjectResult = await timed(() =>
    runConcurrentSqliteCrossProjectWriters(filePath, DatabaseSync, entries),
  );
  const readerWriterResult = await timed(() =>
    runConcurrentSqliteReadersAndWriter(filePath, DatabaseSync, entries),
  );
  await writeFile(filePath, "not a sqlite database", "utf8");
  const corruptionResult = await timed(async () => {
    let recovered = false;
    try {
      new NativeSqliteAdapter(filePath, DatabaseSync);
    } catch {
      recovered = true;
      await Promise.all(
        ["", "-wal", "-shm"].map((suffix) => rm(`${filePath}${suffix}`, { force: true })),
      );
      const rebuilt = new NativeSqliteAdapter(filePath, DatabaseSync);
      await seed(rebuilt, entries);
      const rebuiltEntries = await rebuilt.load();
      await rebuilt.close();
      return {
        recovered,
        entries: rebuiltEntries.length,
        source_bodies_persisted: JSON.stringify(rebuiltEntries).includes('"body"'),
      };
    }
    return { recovered, entries: 0, source_bodies_persisted: false };
  });
  const bytes = await storageSize(filePath);
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
      interrupted_flush: round(interruptedResult.durationMs),
      concurrency: round(concurrencyResult.durationMs),
      cross_project: round(crossProjectResult.durationMs),
      reader_writer: round(readerWriterResult.durationMs),
      corruption_recovery: round(corruptionResult.durationMs),
    },
    evidence: {
      initial_entries: entries.length,
      warm_query_matches: queryCount,
      restart: { status: restartResult.value.length === entries.length ? "pass" : "fail" },
      migration: migrationResult.value,
      interrupted_flush: interruptedResult.value,
      concurrency: concurrencyResult.value,
      cross_project: crossProjectResult.value,
      reader_writer: readerWriterResult.value,
      corruption_recovery: corruptionResult.value,
      source_bodies_persisted: corruptionResult.value.source_bodies_persisted,
      conformance,
    },
  };
}

async function runFocusedJsonScenario(filePath, entries, scenario) {
  const adapter = new JsonFileAdapter(filePath);
  const initial = await timed(() => seed(adapter, entries));
  const evidenceKey = scenario === "cross-project" ? "cross_project" : scenario;
  let operation;
  let evidence;

  if (scenario === "migration") {
    await adapter.forceEntrySchemaVersion(SCHEMA_VERSION - 1);
    operation = await timed(() => adapter.migrateRows());
    await adapter.close();
    const reopened = new JsonFileAdapter(filePath);
    const currentEntries = await reopened.load(PROJECT, SCHEMA_VERSION);
    const legacyEntries = await reopened.load(PROJECT, SCHEMA_VERSION - 1);
    await reopened.close();
    evidence = {
      ...operation.value,
      status:
        operation.value.status === "pass" &&
        currentEntries.length === entries.length &&
        legacyEntries.length === 0
          ? "pass"
          : "fail",
      reopened_entries: currentEntries.length,
      legacy_entries_after_reopen: legacyEntries.length,
    };
  } else {
    await adapter.close();
    operation = await timed(() => runConcurrentJsonCrossProjectWriters(filePath, entries));
    evidence = operation.value;
  }

  return {
    backend: "file-json",
    status: "available",
    scenario,
    storage_bytes: (await stat(filePath)).size,
    operations: {
      [evidenceKey]: round(operation.durationMs),
      initial_seed: round(initial.durationMs),
    },
    evidence: { initial_entries: entries.length, [evidenceKey]: evidence },
  };
}

async function runFocusedNativeSqliteScenario(filePath, entries, DatabaseSync, scenario) {
  const adapter = new NativeSqliteAdapter(filePath, DatabaseSync);
  const initial = await timed(() => seed(adapter, entries));
  const evidenceKey = scenario === "cross-project" ? "cross_project" : scenario;
  let operation;
  let evidence;

  if (scenario === "migration") {
    adapter.forceEntrySchemaVersion(SCHEMA_VERSION - 1);
    operation = await timed(() => adapter.migrateRows());
    await adapter.close();
    const reopened = new NativeSqliteAdapter(filePath, DatabaseSync);
    const currentEntries = await reopened.load(PROJECT, SCHEMA_VERSION);
    const legacyEntries = await reopened.load(PROJECT, SCHEMA_VERSION - 1);
    await reopened.close();
    evidence = {
      ...operation.value,
      status:
        operation.value.status === "pass" &&
        currentEntries.length === entries.length &&
        legacyEntries.length === 0
          ? "pass"
          : "fail",
      reopened_entries: currentEntries.length,
      legacy_entries_after_reopen: legacyEntries.length,
    };
  } else {
    await adapter.close();
    operation = await timed(() =>
      runConcurrentSqliteCrossProjectWriters(filePath, DatabaseSync, entries),
    );
    evidence = operation.value;
  }

  return {
    backend: "native-sqlite",
    status: "available",
    scenario,
    storage_bytes: await storageSize(filePath),
    operations: {
      [evidenceKey]: round(operation.durationMs),
      initial_seed: round(initial.durationMs),
    },
    evidence: { initial_entries: entries.length, [evidenceKey]: evidence },
  };
}

function assertFocusedEvidence(result, scenario) {
  const evidenceKey = scenario === "cross-project" ? "cross_project" : scenario;
  const status = result.evidence?.[evidenceKey]?.status;
  const isExpectedJsonNegativeControl =
    result.backend === "file-json" && scenario === "cross-project";
  if (status !== "pass" && !isExpectedJsonNegativeControl) {
    throw new Error(`${result.backend} ${scenario} evidence failed.`);
  }
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

function assertDurableEvidence(results) {
  for (const result of results) {
    if (result.backend === "memory" || result.status !== "available") continue;

    const failures = [];
    if (result.evidence?.restart?.status !== "pass") failures.push("restart");
    if (result.evidence?.migration?.status !== "pass") failures.push("migration");
    if (result.evidence?.interrupted_flush?.status !== "pass") {
      failures.push("interrupted_flush");
    }
    if (result.backend === "native-sqlite" && result.evidence?.reader_writer?.status !== "pass") {
      failures.push("reader_writer");
    }
    if (result.backend === "native-sqlite" && result.evidence?.cross_project?.status !== "pass") {
      failures.push("cross_project");
    }
    if (result.evidence?.corruption_recovery?.recovered !== true) {
      failures.push("corruption_recovery");
    }
    if (result.evidence?.corruption_recovery?.entries !== result.evidence?.initial_entries) {
      failures.push("corruption_recovery_entries");
    }
    if (result.evidence?.source_bodies_persisted !== false) {
      failures.push("source_body_exclusion");
    }
    if (failures.length > 0) {
      throw new Error(`${result.backend} evidence failed: ${failures.join(", ")}`);
    }
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
    if (options.scenario !== "all") {
      if (options.backend === "json") {
        results = [
          await runFocusedJsonScenario(
            path.join(temporaryDirectory, "index.json"),
            entries,
            options.scenario,
          ),
        ];
      } else {
        if (!DatabaseSync) {
          throw new Error(
            "The requested SQLite scenario requires node:sqlite on the current runtime.",
          );
        }
        results = [
          await runFocusedNativeSqliteScenario(
            path.join(temporaryDirectory, "index.sqlite"),
            entries,
            DatabaseSync,
            options.scenario,
          ),
        ];
      }
    } else {
      results = [];
      if (["all", "memory"].includes(options.backend)) {
        results.push(await runMemoryBenchmark(entries));
      }
      if (["all", "json"].includes(options.backend)) {
        results.push(await runJsonBenchmark(path.join(temporaryDirectory, "index.json"), entries));
      }
      if (["all", "sqlite"].includes(options.backend)) {
        if (DatabaseSync) {
          results.push(
            await runNativeSqliteBenchmark(
              path.join(temporaryDirectory, "index.sqlite"),
              entries,
              DatabaseSync,
            ),
          );
        } else if (options.backend === "sqlite") {
          throw new Error(
            "The requested SQLite backend requires node:sqlite on the current runtime.",
          );
        } else {
          results.push({
            backend: "native-sqlite",
            status: "unavailable",
            reason:
              "node:sqlite is unavailable on this runtime; no native dependency was installed.",
          });
        }
      }
      if (options.backend === "all") {
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
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  if (options.scenario === "all") assertDurableEvidence(results);
  else assertFocusedEvidence(results[0], options.scenario);

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
      targets: await detectRuntimeMatrix(),
    },
    packaging: {
      lifecycle_scripts_disabled: /enableScripts:\s*false/.test(yarnConfig),
      isolated_tarball_install:
        options.skipPackageSmoke || options.scenario !== "all"
          ? {
              status: "skipped",
              reason:
                options.scenario === "all"
                  ? "--skip-package-smoke was requested."
                  : "Focused scenarios do not run package smoke.",
            }
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
    selection: { backend: options.backend, scenario: options.scenario },
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
