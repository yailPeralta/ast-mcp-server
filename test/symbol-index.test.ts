import { describe, expect, it } from "vitest";
import {
  SYMBOL_INDEX_SCHEMA_VERSION,
  createSymbolIndexFileEntry,
  createSymbolIndexSymbol,
  type SymbolIndexStore,
} from "../src/services/symbol-index.js";

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
      querySymbols: async () => [],
      clear: async () => undefined,
      flush: async () => undefined,
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
  });
});
