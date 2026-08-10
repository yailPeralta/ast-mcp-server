import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemorySymbolIndex,
  MAX_SYMBOL_INDEX_FILE_ENTRIES,
  MAX_SYMBOL_INDEX_QUERY_CANDIDATES,
  MAX_SYMBOL_INDEX_SCANNED_SYMBOLS,
  SYMBOL_INDEX_SCHEMA_VERSION,
  createSymbolIndexFileEntry,
  createSymbolIndexRefreshPlan,
  createSymbolIndexSymbol,
  symbolProjectionJsonByteLength,
  type SymbolIndexStore,
} from "../src/services/symbol-index.js";
import { sourceFileIndexSymbols } from "../src/services/symbols.js";
import { createFreshProject } from "../src/services/project.js";
import { hashBytes } from "../src/services/file-fingerprints.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const project = {
  project_id: `project_${"a".repeat(64)}`,
  config_id: `config_${"b".repeat(64)}`,
};

const symbol = createSymbolIndexSymbol({
  name: "createServer",
  symbol_path: "createServer",
  selector: "createServer@4",
  kind: "FunctionDeclaration",
  signature: "export function createServer(): Server",
  line: 4,
  range: {
    start_line: 4,
    start_column: 1,
    end_line: 8,
    end_column: 2,
  },
});

describe("symbol index contracts", () => {
  it("creates a versioned file entry with project and fingerprint metadata", () => {
    const entry = createSymbolIndexFileEntry({
      project,
      file_path: "src/server.ts",
      content_hash: "c".repeat(64),
      config_digest: "d".repeat(64),
      symbols: [symbol],
      last_indexed_at: "2026-08-06T00:00:00.000Z",
    });

    expect(entry).toEqual({
      index_schema_version: SYMBOL_INDEX_SCHEMA_VERSION,
      project,
      file_path: "src/server.ts",
      content_hash: "c".repeat(64),
      config_digest: "d".repeat(64),
      symbols: [symbol],
      last_indexed_at: "2026-08-06T00:00:00.000Z",
    });
    expect(JSON.stringify(entry)).not.toContain("source_body");
    expect(JSON.stringify(entry)).not.toContain("implementation");
  });

  it("projects symbol metadata without allowing source bodies into entries", () => {
    const indexed = createSymbolIndexSymbol({
      name: "value",
      symbol_path: "value",
      selector: "value@1",
      kind: "VariableDeclaration",
      signature: "const value = 1",
      line: 1,
      range: { start_line: 1 },
      source_body: "const value = 1;\nsecret implementation text",
    } as never);

    expect(indexed).toEqual({
      name: "value",
      symbol_path: "value",
      selector: "value@1",
      kind: "VariableDeclaration",
      signature: "const value = 1",
      line: 1,
      range: { start_line: 1 },
    });
    expect(indexed).not.toHaveProperty("source_body");
  });

  it("rejects unsafe paths, invalid hashes and non-canonical timestamps", () => {
    expect(() =>
      createSymbolIndexFileEntry({
        project,
        file_path: "/home/yail/project/src/server.ts",
        content_hash: "c".repeat(64),
        config_digest: "d".repeat(64),
        symbols: [],
        last_indexed_at: "2026-08-06T00:00:00.000Z",
      }),
    ).toThrow(/project-relative/i);
    expect(() =>
      createSymbolIndexFileEntry({
        project,
        file_path: "src/server.ts",
        content_hash: "not-a-digest",
        config_digest: "d".repeat(64),
        symbols: [],
        last_indexed_at: "2026-08-06T00:00:00.000Z",
      }),
    ).toThrow(/content_hash/i);
    expect(() =>
      createSymbolIndexFileEntry({
        project,
        file_path: "src/server.ts",
        content_hash: "c".repeat(64),
        config_digest: "d".repeat(64),
        symbols: [],
        last_indexed_at: "2026-08-06T00:00:00Z",
      }),
    ).toThrow(/timestamp/i);
  });

  it("defines an async store boundary for memory and future persistence", async () => {
    const store: SymbolIndexStore = {
      load: async () => [],
      upsert: async () => undefined,
      remove: async () => undefined,
      countSymbols: async () => 0,
      querySymbols: async () => [],
      queryAllSymbols: async () => [],
      clear: async () => undefined,
      flush: async () => undefined,
      refresh: async () => ({ rebuilt_files: [], reused_files: [], removed_files: [] }),
    };

    await expect(store.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).resolves.toEqual([]);
    await expect(
      store.querySymbols({
        project,
        query: "createServer",
        filters: { kinds: ["FunctionDeclaration"] },
        limit: 10,
      }),
    ).resolves.toEqual([]);
    await expect(store.countSymbols({ project, query: "createServer" })).resolves.toBe(0);
  });

  it("bounds all-symbol candidate reads before consumer pagination", async () => {
    const index = new InMemorySymbolIndex();
    const symbols = Array.from({ length: MAX_SYMBOL_INDEX_QUERY_CANDIDATES + 1 }, (_, offset) =>
      createSymbolIndexSymbol({
        name: `symbol${offset}`,
        symbol_path: `symbol${offset}`,
        selector: `symbol${offset}@${offset + 1}`,
        kind: "VariableDeclaration",
        signature: `const symbol${offset}: number`,
        line: offset + 1,
        range: { start_line: offset + 1 },
      }),
    );
    await index.upsert(
      createSymbolIndexFileEntry({
        project,
        file_path: "src/many.ts",
        content_hash: "c".repeat(64),
        config_digest: "d".repeat(64),
        symbols,
        last_indexed_at: "2026-08-06T00:00:00.000Z",
      }),
    );

    await expect(index.queryAllSymbols({ project, query: "symbol" })).resolves.toHaveLength(
      MAX_SYMBOL_INDEX_QUERY_CANDIDATES,
    );
  });

  it("rejects direct query limits above the candidate cap", async () => {
    const index = new InMemorySymbolIndex();
    await expect(
      index.querySymbols({
        project,
        query: "value",
        limit: MAX_SYMBOL_INDEX_QUERY_CANDIDATES + 1,
      }),
    ).rejects.toThrow("between 1 and");
  });

  it("abandons an over-capacity scan for canonical compiler fallback", async () => {
    const index = new InMemorySymbolIndex();
    const symbolsPerEntry = 10_000;
    for (let chunk = 0; chunk < MAX_SYMBOL_INDEX_SCANNED_SYMBOLS / symbolsPerEntry; chunk += 1) {
      const symbols = Array.from({ length: symbolsPerEntry }, (_, offset) => {
        const ordinal = chunk * symbolsPerEntry + offset;
        return createSymbolIndexSymbol({
          name: `item${ordinal}`,
          symbol_path: `item${ordinal}`,
          selector: `item${ordinal}@${offset + 1}`,
          kind: "VariableDeclaration",
          signature: `const item${ordinal}: number`,
          line: offset + 1,
          range: { start_line: offset + 1 },
        });
      });
      await index.upsert(
        createSymbolIndexFileEntry({
          project,
          file_path: `src/capacity-${chunk}.ts`,
          content_hash: `${chunk}`.repeat(64),
          config_digest: "f".repeat(64),
          symbols,
          last_indexed_at: "2026-08-06T00:00:00.000Z",
        }),
      );
    }
    await index.upsert(
      createSymbolIndexFileEntry({
        project,
        file_path: "src/over-capacity.ts",
        content_hash: "e".repeat(64),
        config_digest: "f".repeat(64),
        symbols: [symbol],
        last_indexed_at: "2026-08-06T00:00:00.000Z",
      }),
    );

    await expect(index.queryAllSymbols({ project, query: "item" })).rejects.toMatchObject({
      code: "scan_limit_exceeded",
    });
  });

  it("rejects oversized collections before reading or mapping their elements", () => {
    let symbolReads = 0;
    const oversizedSymbols = new Array(MAX_SYMBOL_INDEX_SCANNED_SYMBOLS + 1);
    Object.defineProperty(oversizedSymbols, 0, {
      get() {
        symbolReads += 1;
        return symbol;
      },
    });
    expect(() =>
      createSymbolIndexFileEntry({
        project,
        file_path: "src/oversized.ts",
        content_hash: "e".repeat(64),
        config_digest: "f".repeat(64),
        symbols: oversizedSymbols,
        last_indexed_at: "2026-08-06T00:00:00.000Z",
      }),
    ).toThrow("symbol limit");
    expect(symbolReads).toBe(0);

    let fileReads = 0;
    const oversizedFiles = new Array(MAX_SYMBOL_INDEX_FILE_ENTRIES + 1);
    Object.defineProperty(oversizedFiles, 0, {
      get() {
        fileReads += 1;
        return { file_path: "src/value.ts", content_hash: "e".repeat(64) };
      },
    });
    expect(() =>
      createSymbolIndexRefreshPlan(
        {
          project,
          config_digest: "f".repeat(64),
          current_files: oversizedFiles,
          files: [],
          last_indexed_at: "2026-08-06T00:00:00.000Z",
        },
        [],
      ),
    ).toThrow("file-entry limit");
    expect(fileReads).toBe(0);
  });

  it("accounts projection JSON bytes exactly before serialization", () => {
    const escaped = createSymbolIndexSymbol({
      name: 'quote"\\\n',
      symbol_path: "emoji.😀",
      selector: "lone-\ud800@42",
      kind: "MethodDeclaration",
      signature: "control\u0001é",
      line: 42,
      range: { start_line: 42, start_column: 3, end_line: 44, end_column: 7 },
    });
    const serialized = JSON.stringify([escaped]);

    expect(symbolProjectionJsonByteLength([escaped])).toBe(Buffer.byteLength(serialized, "utf8"));
  });

  it("indexes compiler symbols and reuses the existing ranking semantics", async () => {
    const fixture = await createProjectFixture({
      "src/first.ts": "export function createServer(): void {}\n",
      "src/second.ts": "export function createWorker(): void {}\n",
    });
    fixtures.push(fixture);
    const context = createFreshProject(fixture.root);
    const index = new InMemorySymbolIndex();
    const files = context.project.getSourceFiles().map((sourceFile) => ({
      file_path: path.relative(context.projectRoot, sourceFile.getFilePath()),
      content_hash: hashBytes(readFileSync(sourceFile.getFilePath())),
      symbols: sourceFileIndexSymbols(sourceFile, context.projectRoot),
    }));

    await index.refresh({
      project,
      config_digest: "e".repeat(64),
      current_files: files.map(({ file_path, content_hash }) => ({ file_path, content_hash })),
      files,
      last_indexed_at: "2026-08-06T00:00:00.000Z",
    });

    const matches = await index.querySymbols({ project, query: "createServer", limit: 10 });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      file_path: "src/first.ts",
      symbol_path: "createServer",
      selector: "createServer@1",
      content_hash: files[0].content_hash,
    });
    expect(JSON.stringify(matches[0])).not.toContain("function createServer(): void {}");
  });

  it("rebuilds only affected files and preserves unchanged entries", async () => {
    const index = new InMemorySymbolIndex();
    const firstSymbol = createSymbolIndexSymbol({
      name: "first",
      symbol_path: "first",
      selector: "first@1",
      kind: "VariableDeclaration",
      signature: "const first: number;",
      line: 1,
      range: { start_line: 1 },
    });
    const secondSymbol = createSymbolIndexSymbol({
      name: "second",
      symbol_path: "second",
      selector: "second@1",
      kind: "VariableDeclaration",
      signature: "const second: number;",
      line: 1,
      range: { start_line: 1 },
    });
    const initialFiles = [
      { file_path: "src/first.ts", content_hash: "f".repeat(64), symbols: [firstSymbol] },
      { file_path: "src/second.ts", content_hash: "0".repeat(64), symbols: [secondSymbol] },
    ];

    await index.refresh({
      project,
      config_digest: "e".repeat(64),
      current_files: initialFiles.map(({ file_path, content_hash }) => ({
        file_path,
        content_hash,
      })),
      files: initialFiles,
      last_indexed_at: "2026-08-06T00:00:00.000Z",
    });
    const rebuild = await index.refresh({
      project,
      config_digest: "e".repeat(64),
      current_files: [
        { file_path: "src/first.ts", content_hash: "1".repeat(64) },
        { file_path: "src/second.ts", content_hash: "0".repeat(64) },
      ],
      files: [
        {
          ...initialFiles[0],
          content_hash: "1".repeat(64),
          symbols: [secondSymbol],
        },
      ],
      last_indexed_at: "2026-08-06T00:01:00.000Z",
    });

    expect(rebuild).toEqual({
      rebuilt_files: ["src/first.ts"],
      reused_files: ["src/second.ts"],
      removed_files: [],
    });
    const secondMatches = await index.querySymbols({ project, query: "second", limit: 10 });
    expect(secondMatches.find((match) => match.file_path === "src/second.ts")).toMatchObject({
      selector: "second@1",
    });
  });

  it("removes deleted entries during a refresh", async () => {
    const index = new InMemorySymbolIndex();
    const entry = (file_path: string, name: string) =>
      createSymbolIndexFileEntry({
        project,
        file_path,
        content_hash: "a".repeat(64),
        config_digest: "e".repeat(64),
        symbols: [
          createSymbolIndexSymbol({
            name,
            symbol_path: name,
            selector: `${name}@1`,
            kind: "VariableDeclaration",
            signature: `const ${name}: number;`,
            line: 1,
            range: { start_line: 1 },
          }),
        ],
        last_indexed_at: "2026-08-06T00:00:00.000Z",
      });

    await index.upsert(entry("src/kept.ts", "kept"));
    await index.upsert(entry("src/deleted.ts", "deleted"));
    const result = await index.refresh({
      project,
      config_digest: "e".repeat(64),
      current_files: [{ file_path: "src/kept.ts", content_hash: "a".repeat(64) }],
      files: [
        {
          file_path: "src/kept.ts",
          content_hash: "a".repeat(64),
          symbols: (await index.load(project, SYMBOL_INDEX_SCHEMA_VERSION)).find(
            (candidate) => candidate.file_path === "src/kept.ts",
          )!.symbols,
        },
      ],
      last_indexed_at: "2026-08-06T00:01:00.000Z",
    });

    expect(result.removed_files).toEqual(["src/deleted.ts"]);
    expect(await index.querySymbols({ project, query: "deleted", limit: 10 })).toEqual([]);
  });

  it("returns defensive snapshots that cannot mutate in-memory index state", async () => {
    const index = new InMemorySymbolIndex();
    await index.upsert(
      createSymbolIndexFileEntry({
        project,
        file_path: "src/value.ts",
        content_hash: "a".repeat(64),
        config_digest: "e".repeat(64),
        symbols: [symbol],
        last_indexed_at: "2026-08-06T00:00:00.000Z",
      }),
    );

    const loaded = await index.load(project, SYMBOL_INDEX_SCHEMA_VERSION);
    (loaded[0].project as { project_id: string }).project_id = "mutated";
    (loaded[0].symbols[0].range as { start_line: number }).start_line = 99;

    const reloaded = await index.load(project, SYMBOL_INDEX_SCHEMA_VERSION);
    expect(reloaded[0].project).toEqual(project);
    expect(reloaded[0].symbols[0].range.start_line).toBe(4);

    const queried = await index.querySymbols({ project, query: "createServer", limit: 1 });
    (queried[0].project as { project_id: string }).project_id = "mutated";
    (queried[0].range as { start_line: number }).start_line = 99;

    const requeried = await index.querySymbols({ project, query: "createServer", limit: 1 });
    expect(requeried[0].project).toEqual(project);
    expect(requeried[0].range.start_line).toBe(4);
  });
});
