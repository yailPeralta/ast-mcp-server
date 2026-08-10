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
    const next = await store.querySymbols({ ...query, offset: 1 });

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(next).toEqual([expect.objectContaining({ name: "runBeta" })]);
    await expect(store.countSymbols({ project, query: "run" })).resolves.toBe(2);
    await expect(store.querySymbols({ ...query, limit: 0 })).rejects.toThrow(
      /between 1 and 10000/i,
    );
    await expect(
      store.querySymbols({ ...query, limit: MAX_SYMBOL_INDEX_QUERY_CANDIDATES + 1 }),
    ).rejects.toThrow(/between 1 and 10000/i);
    await expect(
      store.querySymbols({ ...query, offset: Number.MAX_SAFE_INTEGER + 1 }),
    ).rejects.toThrow(/safe integer/i);
  });

  it("uses canonical code-point and source ordering independent of insertion order", async () => {
    const store = await create();
    await store.upsert(entry(project, "src/K.ts", "a", [symbol("sharedKelvin")]));
    await store.upsert(entry(project, "src/a.ts", "b", [symbol("sharedLowercase")]));
    await store.upsert(entry(project, "src/Ω.ts", "c", [symbol("sharedOmega")]));
    await store.upsert(
      entry(project, "src/Z.ts", "d", [
        symbol("sharedZeta", "VariableDeclaration", 1),
        symbol("sharedAlpha", "VariableDeclaration", 1),
      ]),
    );

    const pages = await Promise.all(
      [0, 1, 2, 3, 4].map((offset) =>
        store.querySymbols({ project, query: "shared", offset, limit: 1 }),
      ),
    );

    expect(pages.map((page) => page[0]?.file_path)).toEqual([
      "src/Z.ts",
      "src/Z.ts",
      "src/a.ts",
      "src/Ω.ts",
      "src/K.ts",
    ]);
    expect(pages.slice(0, 2).map((page) => page[0]?.name)).toEqual(["sharedZeta", "sharedAlpha"]);
  });

  it("applies JavaScript Unicode case folding to file filters", async () => {
    const store = await create();
    await store.upsert(entry(project, "src/Über.ts", "a", [symbol("runUnicode")]));
    await store.upsert(entry(project, "src/Key.ts", "b", [symbol("runKelvin")]));

    const query = {
      project,
      query: "unicode",
      filters: { file_path: "über" },
    } as const;
    await expect(store.countSymbols(query)).resolves.toBe(1);
    await expect(store.querySymbols({ ...query, limit: 10 })).resolves.toEqual([
      expect.objectContaining({ file_path: "src/Über.ts", name: "runUnicode" }),
    ]);

    const asciiFoldQuery = {
      project,
      query: "kelvin",
      filters: { file_path: "k" },
    } as const;
    await expect(store.countSymbols(asciiFoldQuery)).resolves.toBe(1);
    await expect(store.querySymbols({ ...asciiFoldQuery, limit: 10 })).resolves.toEqual([
      expect.objectContaining({ file_path: "src/Key.ts", name: "runKelvin" }),
    ]);
  });

  it("continues bounded pages across the 10,000-result boundary", async () => {
    const store = await create();
    const symbols = Array.from({ length: 10_001 }, (_, index) =>
      symbol(`target${String(index).padStart(5, "0")}`, "VariableDeclaration", index + 1),
    );
    await store.upsert(entry(project, "src/many.ts", "a", symbols));

    const first = await store.querySymbols({
      project,
      query: "target",
      offset: 9_999,
      limit: 1,
    });
    const continuation = await store.querySymbols({
      project,
      query: "target",
      offset: 10_000,
      limit: 1,
    });

    expect(first).toEqual([expect.objectContaining({ name: "target09999" })]);
    expect(continuation).toEqual([expect.objectContaining({ name: "target10000" })]);
    await expect(store.countSymbols({ project, query: "target" })).resolves.toBe(10_001);
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
