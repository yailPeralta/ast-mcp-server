import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSymbolIndexFileEntry,
  createSymbolIndexSymbol,
  MAX_SYMBOL_INDEX_QUERY_CANDIDATES,
  MAX_SYMBOL_INDEX_SCANNED_SYMBOLS,
  SYMBOL_INDEX_SCHEMA_VERSION,
  type SymbolIndexFileEntry,
  type SymbolIndexRefreshInput,
} from "../src/services/symbol-index.js";
import {
  openSQLiteSymbolIndexStore,
  quarantineSQLiteSymbolIndexFile,
  type SQLiteSymbolIndexStore,
} from "../src/services/symbol-index-sqlite.js";

const project = {
  project_id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  config_id: "config_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function entry(filePath: string, name: string, content = filePath) {
  return createSymbolIndexFileEntry({
    project,
    file_path: filePath,
    content_hash: digest(content),
    config_digest: digest("config"),
    symbols: [
      createSymbolIndexSymbol({
        name,
        symbol_path: name,
        selector: `${name}@1`,
        kind: "FunctionDeclaration",
        signature: `function ${name}(): void;`,
        line: 1,
        range: { start_line: 1 },
      }),
    ],
    last_indexed_at: "2026-08-07T00:00:00.000Z",
  });
}

function refreshInput(
  files: readonly ReturnType<typeof entry>[],
  rebuildFiles = files,
): SymbolIndexRefreshInput {
  return {
    project,
    config_digest: digest("config"),
    current_files: files.map(({ file_path, content_hash }) => ({ file_path, content_hash })),
    files: rebuildFiles.map(({ file_path, content_hash, symbols }) => ({
      file_path,
      content_hash,
      symbols,
    })),
    last_indexed_at: "2026-08-07T00:00:00.000Z",
  };
}

describe("SQLite symbol index store", () => {
  let root: string;
  let store: SQLiteSymbolIndexStore | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "ast-symbol-index-"));
  });

  afterEach(async () => {
    store?.close();
    store = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it("persists entries across close and reopen", async () => {
    const databasePath = path.join(root, "nested", "index.sqlite");
    store = await openSQLiteSymbolIndexStore(databasePath);
    const value = entry("src/server.ts", "createServer");
    await store.upsert(value);
    await store.close();

    store = await openSQLiteSymbolIndexStore(databasePath);
    await expect(store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([value]);
    await expect(
      store.querySymbols({ project, query: "createServer", limit: 10 }),
    ).resolves.toMatchObject([{ file_path: "src/server.ts", name: "createServer" }]);
  });

  it("refreshes only changed files and removes deleted files atomically", async () => {
    store = await openSQLiteSymbolIndexStore(path.join(root, "index.sqlite"));
    const first = entry("src/first.ts", "first");
    const second = entry("src/second.ts", "second");
    await store.refresh(refreshInput([first, second]));

    const changedFirst = entry("src/first.ts", "changedFirst", "src/first-v2.ts");
    const result = await store.refresh(refreshInput([changedFirst], [changedFirst]));

    expect(result).toEqual({
      rebuilt_files: ["src/first.ts"],
      reused_files: [],
      removed_files: ["src/second.ts"],
    });
    await expect(store.querySymbols({ project, query: "second", limit: 10 })).resolves.toEqual([]);
    await expect(
      store.querySymbols({ project, query: "changedFirst", limit: 10 }),
    ).resolves.toMatchObject([{ file_path: "src/first.ts" }]);
  });

  it("adds and populates the projection checksum when migrating a v1 table", async () => {
    const databasePath = path.join(root, "index.sqlite");
    await mkdir(path.dirname(databasePath), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '1');
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
    const value = entry("src/legacy.ts", "legacy");
    database
      .prepare(
        `INSERT INTO symbol_index
          (project_id, config_id, file_path, content_hash, config_digest, symbols_json, last_indexed_at, schema_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        project.project_id,
        project.config_id,
        value.file_path,
        value.content_hash,
        value.config_digest,
        JSON.stringify(value.symbols),
        value.last_indexed_at,
      );
    database.close();

    store = await openSQLiteSymbolIndexStore(databasePath);
    expect(store.migrationPerformed).toBe(true);
    await expect(store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([value]);
  });

  it("locks the legacy snapshot before reading rows so a concurrent writer cannot be lost", async () => {
    const databasePath = path.join(root, "migration-concurrent.sqlite");
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '1');
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
    const first = entry("src/first.ts", "first");
    const second = entry("src/second.ts", "second");
    const insertLegacy = database.prepare(
      `INSERT INTO symbol_index
        (project_id, config_id, file_path, content_hash, config_digest, symbols_json, last_indexed_at, schema_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    );
    insertLegacy.run(
      project.project_id,
      project.config_id,
      first.file_path,
      first.content_hash,
      first.config_digest,
      JSON.stringify(first.symbols),
      first.last_indexed_at,
    );
    database.close();

    let immediateTransactions = 0;
    let concurrentWriteAttempted = false;
    let concurrentWriteBlocked = false;
    class ConcurrentMigrationProbeDatabase {
      private readonly database: InstanceType<typeof DatabaseSync>;
      private readonly writer: InstanceType<typeof DatabaseSync>;

      constructor(filePath: string) {
        this.database = new DatabaseSync(filePath);
        this.writer = new DatabaseSync(filePath);
        this.writer.exec("PRAGMA busy_timeout = 1");
      }

      exec(sql: string): void {
        this.database.exec(sql);
        if (sql === "BEGIN IMMEDIATE") immediateTransactions += 1;
      }

      prepare(sql: string) {
        const statement = this.database.prepare(sql);
        if (!sql.includes("FROM symbol_index") || !sql.includes("ORDER BY project_id")) {
          return statement;
        }
        return {
          all: (...parameters: Array<string | number>) => {
            expect(immediateTransactions).toBe(2);
            if (!concurrentWriteAttempted) {
              concurrentWriteAttempted = true;
              try {
                this.writer
                  .prepare(
                    `INSERT INTO symbol_index
                      (project_id, config_id, file_path, content_hash, config_digest, symbols_json, last_indexed_at, schema_version)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
                  )
                  .run(
                    project.project_id,
                    project.config_id,
                    second.file_path,
                    second.content_hash,
                    second.config_digest,
                    JSON.stringify(second.symbols),
                    second.last_indexed_at,
                  );
              } catch {
                concurrentWriteBlocked = true;
              }
            }
            return statement.all(...parameters);
          },
        };
      }

      close(): void {
        this.writer.close();
        this.database.close();
      }
    }

    store = await openSQLiteSymbolIndexStore(databasePath, {
      DatabaseSync: ConcurrentMigrationProbeDatabase as never,
    });
    expect(concurrentWriteAttempted).toBe(true);
    expect(concurrentWriteBlocked).toBe(true);
    await store.upsert(second);
    await expect(store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([
      first,
      second,
    ]);
  });

  it("rejects unsupported and malformed legacy rows instead of relabeling them", async () => {
    const databasePath = path.join(root, "legacy-invalid.sqlite");
    store = await openSQLiteSymbolIndexStore(databasePath);
    await store.upsert(entry("src/legacy.ts", "legacy"));
    store.close();
    store = undefined;

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec("UPDATE metadata SET value = '0' WHERE key = 'schema_version'");
    database.exec("UPDATE symbol_index SET schema_version = 3");
    database.close();
    await expect(openSQLiteSymbolIndexStore(databasePath)).rejects.toMatchObject({
      code: "unsupported_schema",
    });

    const malformedPath = path.join(root, "legacy-malformed.sqlite");
    store = await openSQLiteSymbolIndexStore(malformedPath);
    await store.upsert(entry("src/malformed.ts", "malformed"));
    store.close();
    store = undefined;
    const malformed = new DatabaseSync(malformedPath);
    malformed.exec("UPDATE metadata SET value = '0' WHERE key = 'schema_version'");
    malformed.exec("UPDATE symbol_index SET schema_version = 0, symbols_json = 'not-json'");
    malformed.close();
    await expect(openSQLiteSymbolIndexStore(malformedPath)).rejects.toMatchObject({
      code: "corrupt_storage",
    });
  });

  it("rejects an existing SQLite database with incompatible table shapes", async () => {
    const databasePath = path.join(root, "schema-incompatible.sqlite");
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY);
      CREATE TABLE symbol_index (project_id TEXT PRIMARY KEY);
    `);
    database.close();

    await expect(openSQLiteSymbolIndexStore(databasePath)).rejects.toMatchObject({
      code: "unsupported_schema",
    });
  });

  it("rejects same-column tables with incompatible constraints", async () => {
    const databasePath = path.join(root, "schema-constraints.sqlite");
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE symbol_index (
        project_id TEXT,
        config_id TEXT,
        file_path TEXT,
        content_hash TEXT,
        config_digest TEXT,
        symbols_json TEXT,
        symbols_digest TEXT,
        last_indexed_at TEXT,
        schema_version INTEGER
      );
    `);
    database.close();

    await expect(openSQLiteSymbolIndexStore(databasePath)).rejects.toMatchObject({
      code: "unsupported_schema",
    });
  });

  it("rolls back an interrupted schema creation and reopens cleanly", async () => {
    const databasePath = path.join(root, "schema-interrupted.sqlite");
    const { DatabaseSync } = await import("node:sqlite");
    class SchemaFailureDatabase {
      private readonly database: InstanceType<typeof DatabaseSync>;

      constructor(filePath: string) {
        this.database = new DatabaseSync(filePath);
      }

      exec(sql: string): void {
        if (sql === "COMMIT") throw new Error("injected schema commit failure");
        this.database.exec(sql);
      }

      prepare(sql: string) {
        return this.database.prepare(sql);
      }

      close(): void {
        this.database.close();
      }
    }

    await expect(
      openSQLiteSymbolIndexStore(databasePath, {
        DatabaseSync: SchemaFailureDatabase as never,
      }),
    ).rejects.toMatchObject({ code: "write_failed" });
    store = await openSQLiteSymbolIndexStore(databasePath);
    await expect(store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([]);
  });

  it("classifies corrupt storage and closed lifecycle operations", async () => {
    await expect(
      openSQLiteSymbolIndexStore(path.join(root, "unsupported.sqlite"), { DatabaseSync: null }),
    ).rejects.toMatchObject({ code: "capability_unavailable" });
    await expect(openSQLiteSymbolIndexStore(`${root}/../outside.sqlite`)).rejects.toMatchObject({
      code: "invalid_path",
    });
    const databasePath = path.join(root, "corrupt.sqlite");
    await writeFile(databasePath, "not sqlite");
    await expect(openSQLiteSymbolIndexStore(databasePath)).rejects.toMatchObject({
      code: "corrupt_storage",
    });

    store = await openSQLiteSymbolIndexStore(path.join(root, "closed.sqlite"));
    store.close();
    await expect(store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).rejects.toMatchObject({
      code: "closed",
    });
  });

  it("checks SQLite capability before creating cache directories", async () => {
    const databasePath = path.join(root, "missing", "nested", "index.sqlite");

    await expect(
      openSQLiteSymbolIndexStore(databasePath, { DatabaseSync: null }),
    ).rejects.toMatchObject({ code: "capability_unavailable" });
    await expect(access(path.join(root, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked database target outside the declared cache file", async () => {
    const targetPath = path.join(root, "target.sqlite");
    store = await openSQLiteSymbolIndexStore(targetPath);
    store.close();
    store = undefined;
    const linkPath = path.join(root, "link.sqlite");
    await symlink(targetPath, linkPath);

    await expect(openSQLiteSymbolIndexStore(linkPath)).rejects.toMatchObject({
      code: "invalid_path",
    });
  });

  it("rejects a symlinked directory ancestor before creating an outside suffix", async () => {
    const cacheRoot = path.join(root, "cache");
    const outside = path.join(root, "outside");
    await mkdir(cacheRoot);
    await mkdir(outside);
    await symlink(outside, path.join(cacheRoot, "linked"), "dir");

    await expect(
      openSQLiteSymbolIndexStore(path.join(cacheRoot, "linked", "created", "index.sqlite")),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(access(path.join(outside, "created"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symbol projection whose payload no longer matches its checksum", async () => {
    const databasePath = path.join(root, "forged.sqlite");
    store = await openSQLiteSymbolIndexStore(databasePath);
    await store.upsert(entry("src/value.ts", "value"));
    store.close();
    store = undefined;

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec("UPDATE symbol_index SET symbols_json = '[]'");
    database.close();

    await expect(openSQLiteSymbolIndexStore(databasePath)).rejects.toMatchObject({
      code: "corrupt_storage",
    });
  });

  it("quarantines the database and removes WAL/SHM sidecars", async () => {
    const databasePath = path.join(root, "quarantine.sqlite");
    store = await openSQLiteSymbolIndexStore(databasePath);
    await store.upsert(entry("src/value.ts", "value"));
    await writeFile(`${databasePath}-wal`, "orphan wal");
    await writeFile(`${databasePath}-shm`, "orphan shm");

    store.close();
    const quarantined = await quarantineSQLiteSymbolIndexFile(databasePath);
    store = undefined;

    expect(quarantined).toMatch(/\.sqlite\.corrupt-/);
    await expect(rm(databasePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(rm(`${databasePath}-wal`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(rm(`${databasePath}-shm`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back a non-contention COMMIT failure and preserves prior state after reopen", async () => {
    const databasePath = path.join(root, "commit-failure.sqlite");
    const { DatabaseSync } = await import("node:sqlite");
    let failNextCommit = false;
    class CommitFailureDatabase {
      private readonly database = new DatabaseSync(databasePath);

      exec(sql: string) {
        if (sql === "COMMIT" && failNextCommit) {
          failNextCommit = false;
          throw new Error("injected non-contention commit failure");
        }
        return this.database.exec(sql);
      }

      prepare(sql: string) {
        return this.database.prepare(sql);
      }

      close() {
        this.database.close();
      }
    }

    store = await openSQLiteSymbolIndexStore(databasePath, {
      DatabaseSync: CommitFailureDatabase as never,
    });
    await store.upsert(entry("src/value.ts", "before"));
    failNextCommit = true;
    await expect(store.upsert(entry("src/value.ts", "after"))).rejects.toMatchObject({
      code: "write_failed",
    });
    store.close();
    store = await openSQLiteSymbolIndexStore(databasePath);

    await expect(store.queryAllSymbols({ project, query: "before" })).resolves.toHaveLength(1);
    await expect(store.queryAllSymbols({ project, query: "after" })).resolves.toEqual([]);
  });

  it("classifies bounded writer contention", async () => {
    const databasePath = path.join(root, "contention.sqlite");
    store = await openSQLiteSymbolIndexStore(databasePath, { busyTimeoutMs: 50 });
    const { DatabaseSync } = await import("node:sqlite");
    const blocker = new DatabaseSync(databasePath);
    blocker.exec("BEGIN IMMEDIATE");

    await expect(store.upsert(entry("src/blocked.ts", "blocked"))).rejects.toMatchObject({
      code: "contention",
    });

    blocker.exec("ROLLBACK");
    blocker.close();
  });

  it("bounds decoded SQLite scan work before returning candidates", async () => {
    const databasePath = path.join(root, "bounded-scan.sqlite");
    store = await openSQLiteSymbolIndexStore(databasePath);
    const symbolsPerFile = 1_000;
    const fileCount = Math.ceil(MAX_SYMBOL_INDEX_SCANNED_SYMBOLS / symbolsPerFile) + 1;
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    const insert = database.prepare(
      `INSERT INTO symbol_index
        (project_id, config_id, file_path, content_hash, config_digest, symbols_json, symbols_digest, last_indexed_at, schema_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    database.exec("BEGIN IMMEDIATE");
    try {
      for (let file = 0; file < fileCount; file += 1) {
        const symbolsJson = JSON.stringify(
          Array.from({ length: symbolsPerFile }, (_, offset) =>
            createSymbolIndexSymbol({
              name: `item${file}_${offset}`,
              symbol_path: `item${file}_${offset}`,
              selector: `item${file}_${offset}@${offset + 1}`,
              kind: "VariableDeclaration",
              signature: `const item${file}_${offset}: number`,
              line: offset + 1,
              range: { start_line: offset + 1 },
            }),
          ),
        );
        insert.run(
          project.project_id,
          project.config_id,
          `src/file-${file}.ts`,
          digest(`file-${file}`),
          digest("config"),
          symbolsJson,
          digest(symbolsJson),
          "2026-08-07T00:00:00.000Z",
          SYMBOL_INDEX_SCHEMA_VERSION,
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      database.close();
    }

    const parse = vi.spyOn(JSON, "parse");
    try {
      await expect(store.queryAllSymbols({ project, query: "item" })).rejects.toMatchObject({
        code: "scan_limit_exceeded",
      });
      expect(parse).toHaveBeenCalledTimes(fileCount - 1);
    } finally {
      parse.mockRestore();
    }
  });

  it("rejects direct query limits above the candidate cap", async () => {
    store = await openSQLiteSymbolIndexStore(path.join(root, "query-limit.sqlite"));
    await expect(
      store.querySymbols({
        project,
        query: "value",
        limit: MAX_SYMBOL_INDEX_QUERY_CANDIDATES + 1,
      }),
    ).rejects.toThrow("between 1 and");
  });

  it("applies the file filter in SQLite before decoding irrelevant payloads", async () => {
    const databasePath = path.join(root, "filtered-query.sqlite");
    store = await openSQLiteSymbolIndexStore(databasePath);
    await store.upsert(entry("src/target.ts", "target"));

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    const invalidPayload = "not-json";
    database
      .prepare(
        `INSERT INTO symbol_index
          (project_id, config_id, file_path, content_hash, config_digest, symbols_json, symbols_digest, last_indexed_at, schema_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.project_id,
        project.config_id,
        "src/irrelevant.ts",
        digest("irrelevant"),
        digest("config"),
        invalidPayload,
        digest(invalidPayload),
        "2026-08-07T00:00:00.000Z",
        SYMBOL_INDEX_SCHEMA_VERSION,
      );
    database.close();

    await expect(
      store.querySymbols({
        project,
        query: "target",
        filters: { file_path: "target.ts" },
        limit: 10,
      }),
    ).resolves.toEqual([expect.objectContaining({ file_path: "src/target.ts" })]);
    await expect(store.querySymbols({ project, query: "", limit: 10 })).rejects.toMatchObject({
      code: "corrupt_storage",
    });
  });

  it("rejects oversized persisted payloads during open", async () => {
    const databasePath = path.join(root, "oversized-read.sqlite");
    store = await openSQLiteSymbolIndexStore(databasePath);
    store.close();
    store = undefined;

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);
    const oversizedPayload = `[${" ".repeat(4 * 1024 * 1024)}]`;
    database
      .prepare(
        `INSERT INTO symbol_index
          (project_id, config_id, file_path, content_hash, config_digest, symbols_json, symbols_digest, last_indexed_at, schema_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.project_id,
        project.config_id,
        "src/oversized.ts",
        digest("oversized"),
        digest("config"),
        oversizedPayload,
        digest(oversizedPayload),
        "2026-08-07T00:00:00.000Z",
        SYMBOL_INDEX_SCHEMA_VERSION,
      );
    database.close();

    await expect(openSQLiteSymbolIndexStore(databasePath)).rejects.toMatchObject({
      code: "corrupt_storage",
    });
  });

  it("rejects oversized row payloads before persisting them", async () => {
    store = await openSQLiteSymbolIndexStore(path.join(root, "oversized-write.sqlite"));
    const base = entry("src/oversized.ts", "oversized");
    const oversized: SymbolIndexFileEntry = {
      ...base,
      symbols: [
        {
          ...base.symbols[0],
          signature: "x".repeat(4 * 1024 * 1024),
        },
      ],
    };

    const stringify = vi.spyOn(JSON, "stringify");
    try {
      await expect(store.upsert(oversized)).rejects.toMatchObject({ code: "write_failed" });
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
    await expect(store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([]);
  });

  it("returns defensive query snapshots", async () => {
    store = await openSQLiteSymbolIndexStore(path.join(root, "query-snapshots.sqlite"));
    await store.upsert(entry("src/value.ts", "value"));
    const first = await store.querySymbols({ project, query: "value", limit: 1 });
    (first[0].project as { project_id: string }).project_id = "mutated";
    (first[0].range as { start_line: number }).start_line = 99;

    const second = await store.querySymbols({ project, query: "value", limit: 1 });
    expect(second[0].project).toEqual(project);
    expect(second[0].range.start_line).toBe(1);
  });

  it("flushes WAL state and classifies a blocked checkpoint", async () => {
    const databasePath = path.join(root, "flush.sqlite");
    store = await openSQLiteSymbolIndexStore(databasePath, { busyTimeoutMs: 50 });
    await store.upsert(entry("src/value.ts", "value"));
    await expect(store.flush()).resolves.toBeUndefined();

    const { DatabaseSync } = await import("node:sqlite");
    const blocker = new DatabaseSync(databasePath);
    blocker.exec("BEGIN IMMEDIATE");
    try {
      blocker.exec("UPDATE metadata SET value = value");
      await expect(store.flush()).rejects.toMatchObject({ code: "contention" });
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }
  });
});
