import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addSymbolIndexRuntimeCount,
  MAX_SYMBOL_INDEX_RUNTIME_COUNT,
  readSymbolIndexPersistencePolicy,
  symbolIndexCachePath,
  symbolIndexPolicyKey,
} from "../src/services/symbol-index-policy.js";

const project = {
  project_id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  config_id: "config_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

describe("symbol index persistence policy", () => {
  it("uses the XDG cache root for absent and explicit enabled policies", () => {
    const environment = { XDG_CACHE_HOME: "/tmp/xdg-cache" };
    const unexpectedHomeLookup = () => {
      throw new Error("home lookup must not run when XDG_CACHE_HOME is valid");
    };
    const defaultPolicy = readSymbolIndexPersistencePolicy(environment, unexpectedHomeLookup);
    const explicitPolicy = readSymbolIndexPersistencePolicy(
      { ...environment, AST_SYMBOL_INDEX_PERSISTENCE: "enabled" },
      unexpectedHomeLookup,
    );

    expect(defaultPolicy).toMatchObject({
      mode: "enabled",
      backend: "sqlite",
      cache_root: "/tmp/xdg-cache/ast-mcp-server/symbol-index",
      reason: "default",
    });
    expect(explicitPolicy).toEqual(defaultPolicy);
    expect(symbolIndexPolicyKey(explicitPolicy)).toBe(symbolIndexPolicyKey(defaultPolicy));
    expect(symbolIndexCachePath(explicitPolicy, project)).toBe(
      symbolIndexCachePath(defaultPolicy, project),
    );
  });

  it("returns memory immediately for disabled without consulting home", () => {
    const policy = readSymbolIndexPersistencePolicy(
      {
        AST_SYMBOL_INDEX_PERSISTENCE: "disabled",
        XDG_CACHE_HOME: "relative/cache",
      },
      () => {
        throw new Error("disabled policy must not resolve home");
      },
    );

    expect(policy).toMatchObject({
      mode: "disabled",
      backend: "memory",
      cache_root: null,
      reason: "default",
    });
    expect(symbolIndexCachePath(policy, project)).toBeNull();
  });

  it("requires an explicit absolute normalized cache root for canary mode", () => {
    expect(
      readSymbolIndexPersistencePolicy({ AST_SYMBOL_INDEX_PERSISTENCE: "canary" }, () => {
        throw new Error("canary policy must not resolve home");
      }),
    ).toMatchObject({
      mode: "canary",
      backend: "memory",
      cache_root: null,
      reason: "cache_root_missing",
    });
    expect(
      readSymbolIndexPersistencePolicy({
        AST_SYMBOL_INDEX_PERSISTENCE: "canary",
        AST_SYMBOL_INDEX_CACHE_ROOT: "relative/cache",
      }),
    ).toMatchObject({ mode: "canary", backend: "memory", reason: "cache_root_invalid" });
    expect(
      readSymbolIndexPersistencePolicy({
        AST_SYMBOL_INDEX_PERSISTENCE: "canary",
        AST_SYMBOL_INDEX_CACHE_ROOT: "/tmp/../ast-index-cache",
      }),
    ).toMatchObject({ mode: "canary", backend: "memory", reason: "cache_root_invalid" });
  });

  it("prefers a valid explicit enabled root over implicit roots", () => {
    expect(
      readSymbolIndexPersistencePolicy(
        {
          AST_SYMBOL_INDEX_PERSISTENCE: "enabled",
          AST_SYMBOL_INDEX_CACHE_ROOT: "/tmp/explicit-cache",
          XDG_CACHE_HOME: "/tmp/xdg-cache",
        },
        () => {
          throw new Error("an explicit root must prevent home fallback");
        },
      ),
    ).toMatchObject({
      mode: "enabled",
      backend: "sqlite",
      cache_root: "/tmp/explicit-cache",
      reason: "default",
    });
  });

  it("fails closed for an invalid explicit enabled override without implicit fallback", () => {
    expect(
      readSymbolIndexPersistencePolicy(
        {
          AST_SYMBOL_INDEX_PERSISTENCE: "enabled",
          AST_SYMBOL_INDEX_CACHE_ROOT: "relative/cache",
          XDG_CACHE_HOME: "/tmp/xdg-cache",
        },
        () => {
          throw new Error("an explicit override must prevent home fallback");
        },
      ),
    ).toMatchObject({
      mode: "enabled",
      backend: "memory",
      cache_root: null,
      reason: "cache_root_invalid",
    });
  });

  it("falls back from an unsafe XDG root to an injected safe home", () => {
    expect(
      readSymbolIndexPersistencePolicy(
        { XDG_CACHE_HOME: "relative/cache" },
        () => "/home/test-user",
      ),
    ).toMatchObject({
      mode: "enabled",
      backend: "sqlite",
      cache_root: "/home/test-user/.cache/ast-mcp-server/symbol-index",
      reason: "default",
    });
  });

  it("fails closed when no safe implicit home root can be resolved", () => {
    expect(readSymbolIndexPersistencePolicy({}, () => "relative/home")).toMatchObject({
      mode: "enabled",
      backend: "memory",
      cache_root: null,
      reason: "cache_root_invalid",
    });
    expect(readSymbolIndexPersistencePolicy({}, () => "/home/test-user\u0000")).toMatchObject({
      mode: "enabled",
      backend: "memory",
      cache_root: null,
      reason: "cache_root_invalid",
    });
    expect(
      readSymbolIndexPersistencePolicy({}, () => {
        throw new Error("home unavailable");
      }),
    ).toMatchObject({
      mode: "enabled",
      backend: "memory",
      cache_root: null,
      reason: "cache_root_missing",
    });
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

  it("fails closed for unknown modes before resolving an implicit root", () => {
    expect(
      readSymbolIndexPersistencePolicy(
        {
          AST_SYMBOL_INDEX_PERSISTENCE: "experimental",
          AST_SYMBOL_INDEX_CACHE_ROOT: "/tmp/ast-index-cache",
        },
        () => {
          throw new Error("unknown policy must not resolve home");
        },
      ),
    ).toMatchObject({ mode: "disabled", reason: "invalid_mode" });
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
