import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type { ProjectIdentity } from "./project-status.js";

export type SymbolIndexPersistenceMode = "disabled" | "canary" | "enabled";
export type SymbolIndexPersistencePolicyReason =
  "default" | "invalid_mode" | "enabled_not_released" | "cache_root_missing" | "cache_root_invalid";

export type SymbolIndexRuntimeState = "disabled" | "ready" | "rebuilding" | "failed";
export type SymbolIndexRuntimeOperation =
  | "disabled"
  | "hit"
  | "miss"
  | "rebuild"
  | "fallback"
  | "migration"
  | "corruption"
  | "read_failure"
  | "write_failure";

export interface SymbolIndexRuntimeObservability {
  readonly policy: SymbolIndexPersistenceMode;
  readonly policy_reason: SymbolIndexPersistencePolicyReason;
  readonly backend: "memory" | "sqlite";
  readonly state: SymbolIndexRuntimeState;
  readonly operation: SymbolIndexRuntimeOperation;
  readonly last_operation: SymbolIndexRuntimeOperation;
  readonly loaded_entries: number;
  readonly accepted_entries: number;
  readonly rejected_entries: number;
  readonly cache_hits: number;
  readonly cache_misses: number;
  readonly fallback_count: number;
  readonly migration_count: number;
  readonly corruption_count: number;
  readonly write_failure_count: number;
  readonly rebuilt_files: number;
  readonly reused_files: number;
  readonly removed_files: number;
  readonly last_error: string | null;
  readonly last_successful_persistence_at: string | null;
}

export interface SymbolIndexPersistencePolicy {
  readonly mode: SymbolIndexPersistenceMode;
  readonly backend: "memory" | "sqlite";
  readonly cache_root: string | null;
  readonly busy_timeout_ms: number;
  readonly reason: SymbolIndexPersistencePolicyReason;
}

const DEFAULT_BUSY_TIMEOUT_MS = 1_000;
export const MAX_SYMBOL_INDEX_RUNTIME_COUNT = 1_000_000;

export function addSymbolIndexRuntimeCount(current: number, increment = 1): number {
  if (!Number.isSafeInteger(current) || current < 0) return MAX_SYMBOL_INDEX_RUNTIME_COUNT;
  if (!Number.isSafeInteger(increment) || increment < 0) return MAX_SYMBOL_INDEX_RUNTIME_COUNT;
  return Math.min(MAX_SYMBOL_INDEX_RUNTIME_COUNT, current + increment);
}

export function createInitialSymbolIndexRuntimeObservability(
  policy: SymbolIndexPersistencePolicy = disabledPolicy("default"),
): SymbolIndexRuntimeObservability {
  return {
    policy: policy.mode,
    policy_reason: policy.reason,
    backend: policy.backend,
    state: "disabled",
    operation: policy.backend === "sqlite" ? "miss" : "disabled",
    last_operation: policy.backend === "sqlite" ? "miss" : "disabled",
    loaded_entries: 0,
    accepted_entries: 0,
    rejected_entries: 0,
    cache_hits: 0,
    cache_misses: 0,
    fallback_count: 0,
    migration_count: 0,
    corruption_count: 0,
    write_failure_count: 0,
    rebuilt_files: 0,
    reused_files: 0,
    removed_files: 0,
    last_error: null,
    last_successful_persistence_at: null,
  };
}

function disabledPolicy(
  reason: SymbolIndexPersistencePolicy["reason"],
): SymbolIndexPersistencePolicy {
  return memoryPolicy("disabled", reason);
}

function memoryPolicy(
  mode: SymbolIndexPersistenceMode,
  reason: SymbolIndexPersistencePolicy["reason"],
): SymbolIndexPersistencePolicy {
  return {
    mode,
    backend: "memory",
    cache_root: null,
    busy_timeout_ms: DEFAULT_BUSY_TIMEOUT_MS,
    reason,
  };
}

function readBusyTimeout(value: string | undefined): number {
  if (!value) return DEFAULT_BUSY_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 60_000
    ? parsed
    : DEFAULT_BUSY_TIMEOUT_MS;
}

function isAbsoluteNormalizedPath(value: string): boolean {
  return !value.includes("\u0000") && path.isAbsolute(value) && path.normalize(value) === value;
}

function sqlitePolicy(
  mode: "canary" | "enabled",
  cacheRoot: string,
  environment: NodeJS.ProcessEnv,
): SymbolIndexPersistencePolicy {
  return {
    mode,
    backend: "sqlite",
    cache_root: cacheRoot,
    busy_timeout_ms: readBusyTimeout(environment.AST_SYMBOL_INDEX_BUSY_TIMEOUT_MS),
    reason: "default",
  };
}

export function readSymbolIndexPersistencePolicy(
  environment: NodeJS.ProcessEnv = process.env,
  resolveHomeDirectory: () => string = homedir,
): SymbolIndexPersistencePolicy {
  const mode = environment.AST_SYMBOL_INDEX_PERSISTENCE ?? "enabled";
  if (mode === "disabled") return disabledPolicy("default");
  if (mode !== "canary" && mode !== "enabled") return disabledPolicy("invalid_mode");

  const explicitCacheRoot = environment.AST_SYMBOL_INDEX_CACHE_ROOT;
  if (mode === "canary") {
    if (!explicitCacheRoot) return memoryPolicy(mode, "cache_root_missing");
    if (!isAbsoluteNormalizedPath(explicitCacheRoot)) {
      return memoryPolicy(mode, "cache_root_invalid");
    }
    return sqlitePolicy(mode, explicitCacheRoot, environment);
  }

  if (explicitCacheRoot !== undefined) {
    if (!isAbsoluteNormalizedPath(explicitCacheRoot)) {
      return memoryPolicy(mode, "cache_root_invalid");
    }
    return sqlitePolicy(mode, explicitCacheRoot, environment);
  }

  const xdgCacheHome = environment.XDG_CACHE_HOME;
  if (xdgCacheHome && isAbsoluteNormalizedPath(xdgCacheHome)) {
    return sqlitePolicy(
      mode,
      path.join(xdgCacheHome, "ast-mcp-server", "symbol-index"),
      environment,
    );
  }

  let homeDirectory: string;
  try {
    homeDirectory = resolveHomeDirectory();
  } catch {
    return memoryPolicy(mode, "cache_root_missing");
  }
  if (!homeDirectory) return memoryPolicy(mode, "cache_root_missing");
  if (!isAbsoluteNormalizedPath(homeDirectory)) {
    return memoryPolicy(mode, "cache_root_invalid");
  }

  return sqlitePolicy(
    mode,
    path.join(homeDirectory, ".cache", "ast-mcp-server", "symbol-index"),
    environment,
  );
}

export function symbolIndexPolicyKey(policy: SymbolIndexPersistencePolicy): string {
  return [
    policy.mode,
    policy.backend,
    policy.reason,
    policy.cache_root ?? "",
    policy.busy_timeout_ms,
  ].join("\u0000");
}

export function symbolIndexCachePath(
  policy: SymbolIndexPersistencePolicy,
  project: ProjectIdentity,
): string | null {
  if (policy.backend !== "sqlite" || !policy.cache_root) return null;
  const opaqueProjectKey = createHash("sha256")
    .update(`${project.project_id}\u0000${project.config_id ?? ""}`)
    .digest("hex");
  return path.join(policy.cache_root, `symbol-index-${opaqueProjectKey}.sqlite`);
}
