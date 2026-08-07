import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addSymbolIndexRuntimeCount,
  MAX_SYMBOL_INDEX_RUNTIME_COUNT,
  readSymbolIndexPersistencePolicy,
  symbolIndexCachePath,
} from "../src/services/symbol-index-policy.js";

const project = {
  project_id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  config_id: "config_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

describe("symbol index persistence policy", () => {
  it("is disabled by default and does not derive a cache path", () => {
    const policy = readSymbolIndexPersistencePolicy({});

    expect(policy).toMatchObject({
      mode: "disabled",
      backend: "memory",
      cache_root: null,
      reason: "default",
    });
    expect(symbolIndexCachePath(policy, project)).toBeNull();
  });

  it("requires an absolute cache root for canary mode", () => {
    expect(
      readSymbolIndexPersistencePolicy({ AST_SYMBOL_INDEX_PERSISTENCE: "canary" }),
    ).toMatchObject({ mode: "disabled", reason: "cache_root_missing" });
    expect(
      readSymbolIndexPersistencePolicy({
        AST_SYMBOL_INDEX_PERSISTENCE: "canary",
        AST_SYMBOL_INDEX_CACHE_ROOT: "relative/cache",
      }),
    ).toMatchObject({ mode: "disabled", reason: "cache_root_invalid" });
  });

  it("derives an opaque per-project SQLite path for explicit opt-in", () => {
    const policy = readSymbolIndexPersistencePolicy({
      AST_SYMBOL_INDEX_PERSISTENCE: "canary",
      AST_SYMBOL_INDEX_CACHE_ROOT: "/tmp/ast-index-cache",
      AST_SYMBOL_INDEX_BUSY_TIMEOUT_MS: "2500",
    });
    const cachePath = symbolIndexCachePath(policy, project);

    expect(policy).toMatchObject({
      mode: "canary",
      backend: "sqlite",
      cache_root: "/tmp/ast-index-cache",
      busy_timeout_ms: 2500,
      reason: "default",
    });
    expect(cachePath).toMatch(/^\/tmp\/ast-index-cache\/symbol-index-[0-9a-f]{64}\.sqlite$/);
    expect(cachePath).not.toContain(project.project_id);
    expect(path.dirname(cachePath!)).toBe("/tmp/ast-index-cache");
  });

  it("fails closed for unknown modes and the unreleased enabled gate", () => {
    expect(
      readSymbolIndexPersistencePolicy({
        AST_SYMBOL_INDEX_PERSISTENCE: "experimental",
        AST_SYMBOL_INDEX_CACHE_ROOT: "/tmp/ast-index-cache",
      }),
    ).toMatchObject({ mode: "disabled", reason: "invalid_mode" });

    expect(
      readSymbolIndexPersistencePolicy({
        AST_SYMBOL_INDEX_PERSISTENCE: "enabled",
        AST_SYMBOL_INDEX_CACHE_ROOT: "/tmp/ast-index-cache",
      }),
    ).toMatchObject({ mode: "disabled", backend: "memory", reason: "enabled_not_released" });
  });

  it("uses a bounded timeout and saturating observability counters", () => {
    const policy = readSymbolIndexPersistencePolicy({
      AST_SYMBOL_INDEX_PERSISTENCE: "canary",
      AST_SYMBOL_INDEX_CACHE_ROOT: "/tmp/ast-index-cache",
      AST_SYMBOL_INDEX_BUSY_TIMEOUT_MS: "not-a-number",
    });
    expect(policy.busy_timeout_ms).toBe(1000);
    expect(addSymbolIndexRuntimeCount(MAX_SYMBOL_INDEX_RUNTIME_COUNT, 1)).toBe(
      MAX_SYMBOL_INDEX_RUNTIME_COUNT,
    );
    expect(addSymbolIndexRuntimeCount(Number.POSITIVE_INFINITY, 1)).toBe(
      MAX_SYMBOL_INDEX_RUNTIME_COUNT,
    );
  });
});
