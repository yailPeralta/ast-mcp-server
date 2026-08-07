import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemorySymbolIndex,
  MAX_SYMBOL_INDEX_QUERY_CANDIDATES,
  SYMBOL_INDEX_SCHEMA_VERSION,
  createSymbolIndexFileEntry,
  createSymbolIndexSymbol,
  type SymbolIndexStore,
} from "../src/services/symbol-index.js";
import {
  openSQLiteSymbolIndexStore,
  type SQLiteSymbolIndexStore,
} from "../src/services/symbol-index-sqlite.js";

const project = {
  project_id: `project_${"a".repeat(64)}`,
  config_id: `config_${"b".repeat(64)}`,
};
const otherProject = {
  project_id: `project_${"c".repeat(64)}`,
  config_id: `config_${"d".repeat(64)}`,
};
const otherConfig = {
  project_id: project.project_id,
  config_id: `config_${"e".repeat(64)}`,
};
const indexedAt = "2026-08-06T00:00:00.000Z";

type StoreFactory = {
  name: string;
  create: () => Promise<SymbolIndexStore>;
};

const sqliteStores: SQLiteSymbolIndexStore[] = [];
const sqliteRoots: string[] = [];

afterEach(async () => {
  for (const store of sqliteStores.splice(0)) store.close();
  await Promise.all(
    sqliteRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const storeFactories: readonly StoreFactory[] = [
  {
    name: "InMemorySymbolIndex",
    create: async () => new InMemorySymbolIndex(),
  },
  {
    name: "SQLiteSymbolIndexStore",
    create: async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ast-index-conformance-"));
      sqliteRoots.push(root);
      const store = await openSQLiteSymbolIndexStore(path.join(root, "index.sqlite"));
      sqliteStores.push(store);
      return store;
    },
  },
];

function symbol(name: string, kind = "FunctionDeclaration", line = 1) {
  return createSymbolIndexSymbol({
    name,
    symbol_path: name,
    selector: `${name}@${line}`,
    kind,
    signature: `export function ${name}(): void;`,
    line,
    range: { start_line: line },
  });
}

function entry(owner = project, filePath = "src/index.ts", hash = "a", symbols = [symbol("run")]) {
  return createSymbolIndexFileEntry({
    project: owner,
    file_path: filePath,
    content_hash: hash.repeat(64),
    config_digest: "f".repeat(64),
    symbols,
    last_indexed_at: indexedAt,
  });
}

describe.each(storeFactories)("$name conformance", ({ create }) => {
  it("preserves project/config isolation and deterministic load ordering", async () => {
    const store = await create();

    await store.upsert(entry(project, "src/z.ts", "a"));
    await store.upsert(entry(project, "src/a.ts", "b"));
    await store.upsert(entry(otherProject, "src/other-project.ts", "c"));
    await store.upsert(entry(otherConfig, "src/other-config.ts", "d"));

    await expect(store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([
      expect.objectContaining({ file_path: "src/a.ts", project }),
      expect.objectContaining({ file_path: "src/z.ts", project }),
    ]);
    await expect(store.load(otherProject, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([
      expect.objectContaining({ file_path: "src/other-project.ts", project: otherProject }),
    ]);
    await expect(store.load(otherConfig, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([
      expect.objectContaining({ file_path: "src/other-config.ts", project: otherConfig }),
    ]);

    const first = await store.load(project, SYMBOL_INDEX_SCHEMA_VERSION);
    const second = await store.load(project, SYMBOL_INDEX_SCHEMA_VERSION);
    expect(second).toEqual(first);
  });

  it("keeps persisted values body-free and filters by file and symbol kind", async () => {
    const store = await create();
    const unsafeEntry = {
      ...entry(project, "src/worker.ts", "a", [
        symbol("runWorker", "FunctionDeclaration", 2),
        symbol("workerState", "VariableDeclaration", 8),
      ]),
      source_body: "implementation must not be persisted",
      compiler_object: { opaque: true },
    } as never;

    await store.upsert(unsafeEntry);

    const loaded = await store.load(project, SYMBOL_INDEX_SCHEMA_VERSION);
    expect(JSON.stringify(loaded)).not.toContain("source_body");
    expect(JSON.stringify(loaded)).not.toContain("implementation must not be persisted");
    expect(JSON.stringify(loaded)).not.toContain("compiler_object");

    await expect(
      store.querySymbols({
        project,
        query: "worker",
        filters: { file_path: "src/worker", kinds: ["FunctionDeclaration"] },
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        file_path: "src/worker.ts",
        name: "runWorker",
        kind: "FunctionDeclaration",
      }),
    ]);
  });

  it("keeps query ordering stable and enforces bounded positive limits", async () => {
    const store = await create();
    await store.upsert(
      entry(project, "src/first.ts", "a", [symbol("runAlpha", "FunctionDeclaration", 1)]),
    );
    await store.upsert(
      entry(project, "src/second.ts", "b", [symbol("runBeta", "FunctionDeclaration", 1)]),
    );

    const query = { project, query: "run", limit: 1 } as const;
    const first = await store.querySymbols(query);
    const second = await store.querySymbols(query);

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    await expect(store.querySymbols({ ...query, limit: 0 })).rejects.toThrow(
      /between 1 and 10000/i,
    );
    await expect(
      store.querySymbols({ ...query, limit: MAX_SYMBOL_INDEX_QUERY_CANDIDATES + 1 }),
    ).rejects.toThrow(/between 1 and 10000/i);
  });

  it("filters schema versions and rejects writes for unsupported versions", async () => {
    const store = await create();
    const validEntry = entry();

    await store.upsert(validEntry);
    await expect(store.load(project, 999 as typeof SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual(
      [],
    );
    await expect(
      store.upsert({
        ...validEntry,
        index_schema_version: 999,
      } as never),
    ).rejects.toThrow(/schema version/i);
  });

  it("supports remove, clear and flush without affecting another project", async () => {
    const store = await create();
    await store.upsert(entry(project, "src/remove.ts", "a"));
    await store.upsert(entry(project, "src/clear.ts", "b"));
    await store.upsert(entry(otherProject, "src/keep.ts", "c"));

    await store.remove(project, "src/remove.ts");
    expect(await store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).toEqual([
      expect.objectContaining({ file_path: "src/clear.ts" }),
    ]);

    await store.clear(project);
    await expect(store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([]);
    await expect(store.load(otherProject, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([
      expect.objectContaining({ file_path: "src/keep.ts", project: otherProject }),
    ]);
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
