import fs from "node:fs";
import path from "node:path";
import { Project, type Node, type SourceFile } from "ts-morph";
import type { FileFingerprint } from "./file-fingerprints.js";
// prettier-ignore
import { bindConfiguredH03Error, captureConfiguredH03Command, captureConfiguredH05Command, runConfiguredH03Fixture, runConfiguredH05Fixture } from "./h03-timeout-fixture.js";
import {
  InMemorySymbolIndex,
  SYMBOL_INDEX_SCHEMA_VERSION,
  type SymbolIndexCurrentFile,
  type SymbolIndexRefreshFile,
  type SymbolIndexStore,
} from "./symbol-index.js";
import {
  addSymbolIndexRuntimeCount,
  createInitialSymbolIndexRuntimeObservability,
  readSymbolIndexPersistencePolicy,
  symbolIndexCachePath,
  symbolIndexPolicyKey,
  type SymbolIndexPersistencePolicy,
  type SymbolIndexRuntimeObservability,
} from "./symbol-index-policy.js";
import {
  openSQLiteSymbolIndexStore,
  quarantineSQLiteSymbolIndexFile,
  type SQLiteSymbolIndexStore,
  type SymbolIndexStorageError,
} from "./symbol-index-sqlite.js";
import { findDeclaration, sourceFileIndexSymbols } from "./symbols.js";
import {
  createProjectWatcher,
  selectProjectWatchDirectories,
  type ProjectWatcher,
} from "./project-watcher.js";
import { createConfigSnapshot, createWorkspaceSnapshot } from "./workspace.js";
import {
  createInitialProjectStatus,
  createProjectIdentity,
  projectOperationQueueToProjection,
  projectStatusToProjection,
  type ProjectOperationQueueProjection,
  transitionProjectStatus,
  type ProjectStatus,
  type ProjectStatusProjection,
  type SynchronizationCause,
} from "./project-status.js";
import {
  ProjectOperationScheduler,
  ProjectOperationSchedulerError,
  type ProjectOperationContext,
} from "./project-operation-scheduler.js";
import {
  isCooperativeInterruption,
  NO_REQUEST_CONTEXT,
  type RequestContext,
} from "./request-context.js";
import { readRuntimePolicy, type RuntimePolicy } from "./runtime-policy.js";

export interface ProjectContext {
  project: Project;
  projectRoot: string;
  tsConfigFilePath: string;
  status: ProjectStatus;
  symbolIndex: SymbolIndexStore;
  symbolIndexReady: boolean;
  symbolIndexBackend: "memory" | "sqlite";
  symbolIndexFallbackReason: string | null;
  symbolIndexObservability: SymbolIndexRuntimeObservability;
}

interface ProjectSession {
  context: ProjectContext;
  watcher: ProjectWatcher;
  watchDirectories: readonly string[];
  configDigest: string;
  fingerprints: ReadonlyMap<string, FileFingerprint>;
  compilerStateUntrusted: boolean;
  scheduler: ProjectOperationScheduler;
  lastAccessSequence: bigint;
  symbolIndexPolicy: SymbolIndexPersistencePolicy;
  persistentSymbolIndex?: SQLiteSymbolIndexStore;
}

export interface ProjectStatusSnapshot extends ProjectStatusProjection {
  readonly operation_queue: ProjectOperationQueueProjection;
  readonly index_observability: SymbolIndexRuntimeObservability;
}

export interface DiagnosticProjectStatusSnapshot {
  readonly authority: "registered" | "isolated" | "unavailable";
  readonly runtime_admission: "open" | "closed";
  readonly session_capacity: number;
  readonly status?: ProjectStatusSnapshot;
}

export interface ProjectSessionRegistrySnapshot {
  readonly session_count: number;
  readonly active_sessions: number;
  readonly idle_sessions: number;
  readonly session_capacity: number;
}

export class ProjectCapacityError extends Error {
  readonly code = "PROJECT_CAPACITY_EXCEEDED";

  constructor() {
    super("Project session capacity exceeded.");
    this.name = "ProjectCapacityError";
  }
}

const projectSessions = new Map<string, ProjectSession>();
const projectRoots = new WeakMap<Project, string>();
let projectSessionAccessSequence = 0n;
let projectRuntimePolicy: RuntimePolicy | undefined;
let projectRuntimeAdmission: "open" | "closed" = "open";
let projectMutationHistory = false;

function nextProjectSessionAccessSequence(): bigint {
  projectSessionAccessSequence += 1n;
  return projectSessionAccessSequence;
}

function getProjectRuntimePolicy(): RuntimePolicy {
  projectRuntimePolicy ??= readRuntimePolicy();
  return projectRuntimePolicy;
}

function closePersistentSymbolIndex(session: ProjectSession): void {
  const persistentSymbolIndex = session.persistentSymbolIndex;
  session.persistentSymbolIndex = undefined;
  try {
    persistentSymbolIndex?.close();
  } catch {
    // Detachment is authoritative; a stale SQLite store must not survive cleanup failure.
  }
}

function symbolIndexFailureOperation(reason: string): SymbolIndexRuntimeObservability["operation"] {
  if (reason === "corrupt_storage") return "corruption";
  if (reason === "migration_failed" || reason === "unsupported_schema") return "migration";
  if (reason === "read_failed" || reason === "sqlite_read_failed") return "read_failure";
  if (reason === "write_failed" || reason === "sqlite_write_failed" || reason === "contention") {
    return "write_failure";
  }
  return "fallback";
}

function fallbackToMemory(session: ProjectSession, reason: string): void {
  const persistentSymbolIndex = session.persistentSymbolIndex;
  session.persistentSymbolIndex = undefined;
  const boundedReason = reason.slice(0, 128);
  const operation = symbolIndexFailureOperation(boundedReason);
  const previous = session.context.symbolIndexObservability;
  session.context = {
    ...session.context,
    status: transitionProjectStatus(session.context.status, {
      type: "index_disabled",
    }),
    symbolIndex: new InMemorySymbolIndex(),
    symbolIndexBackend: "memory",
    symbolIndexFallbackReason: boundedReason,
    symbolIndexReady: false,
    symbolIndexObservability: {
      ...session.context.symbolIndexObservability,
      policy: session.symbolIndexPolicy.mode,
      policy_reason: session.symbolIndexPolicy.reason,
      backend: "memory",
      state: "failed",
      operation,
      last_operation: operation,
      rejected_entries: addSymbolIndexRuntimeCount(previous.rejected_entries),
      fallback_count: addSymbolIndexRuntimeCount(previous.fallback_count),
      migration_count: addSymbolIndexRuntimeCount(
        previous.migration_count,
        operation === "migration" ? 1 : 0,
      ),
      corruption_count: addSymbolIndexRuntimeCount(
        previous.corruption_count,
        operation === "corruption" ? 1 : 0,
      ),
      write_failure_count: addSymbolIndexRuntimeCount(
        previous.write_failure_count,
        operation === "write_failure" ? 1 : 0,
      ),
      last_error: boundedReason,
    },
  };
  try {
    persistentSymbolIndex?.close();
  } catch {
    // The compiler-backed memory context was already installed; cleanup is best effort.
  }
}

export async function reportSymbolIndexFailure(
  projectRoot: string,
  reason: string,
): Promise<ProjectContext | undefined> {
  const session = projectSessions.get(resolveTsConfigPath(projectRoot));
  if (!session) return undefined;
  const cachePath = symbolIndexCachePath(session.symbolIndexPolicy, session.context.status.project);
  fallbackToMemory(session, reason);
  if (cachePath && reason === "corrupt_storage") {
    try {
      await quarantineSQLiteSymbolIndexFile(cachePath);
    } catch {
      // The compiler-backed memory fallback remains authoritative if quarantine fails.
    }
  }
  return session.context;
}

async function ensureSessionSymbolIndex(
  session: ProjectSession,
  requestContext: ProjectOperationContext,
): Promise<void> {
  requestContext.checkpoint();
  const policy = readSymbolIndexPersistencePolicy();
  if (symbolIndexPolicyKey(policy) !== symbolIndexPolicyKey(session.symbolIndexPolicy)) {
    closePersistentSymbolIndex(session);
    session.symbolIndexPolicy = policy;
    session.context = {
      ...session.context,
      status: transitionProjectStatus(session.context.status, { type: "index_disabled" }),
      symbolIndex: new InMemorySymbolIndex(),
      symbolIndexBackend: "memory",
      symbolIndexFallbackReason: null,
      symbolIndexReady: false,
      symbolIndexObservability: createInitialSymbolIndexRuntimeObservability(policy),
    };
  }
  if (
    session.context.symbolIndexFallbackReason === "capability_unavailable" ||
    (session.context.symbolIndexFallbackReason !== null && policy.backend === "memory")
  ) {
    return;
  }
  if (policy.backend === "memory") {
    if (policy.mode === "enabled" || policy.mode === "canary") {
      fallbackToMemory(session, policy.reason);
    }
    return;
  }
  if (session.persistentSymbolIndex) return;

  const cachePath = symbolIndexCachePath(policy, session.context.status.project);
  if (!cachePath) return;
  try {
    requestContext.checkpoint();
    const store = await openSQLiteSymbolIndexStore(cachePath, {
      busyTimeoutMs: policy.busy_timeout_ms,
    });
    try {
      requestContext.checkpoint();
    } catch (error) {
      store.close();
      throw error;
    }
    session.persistentSymbolIndex = store;
    const migrationPerformed = store.migrationPerformed;
    session.context = {
      ...session.context,
      status: session.context.status.causes.includes("index_failure")
        ? transitionProjectStatus(session.context.status, { type: "index_recovered" })
        : transitionProjectStatus(session.context.status, { type: "index_ready" }),
      symbolIndex: store,
      symbolIndexBackend: "sqlite",
      symbolIndexFallbackReason: null,
      symbolIndexReady: false,
      symbolIndexObservability: {
        ...session.context.symbolIndexObservability,
        policy: policy.mode,
        policy_reason: policy.reason,
        backend: "sqlite",
        state: "rebuilding",
        operation: "miss",
        last_operation: migrationPerformed ? "migration" : "miss",
        migration_count: addSymbolIndexRuntimeCount(
          session.context.symbolIndexObservability.migration_count,
          migrationPerformed ? 1 : 0,
        ),
        last_error: null,
      },
    };
  } catch (error) {
    if (isCooperativeInterruption(error)) throw error;
    const reason = (error as Partial<SymbolIndexStorageError>).code ?? "sqlite_open_failed";
    if (
      reason === "corrupt_storage" ||
      reason === "unsupported_schema" ||
      reason === "migration_failed" ||
      reason === "read_failed"
    ) {
      try {
        await quarantineSQLiteSymbolIndexFile(cachePath);
      } catch {
        // Keep the memory fallback even when the corrupt artifact cannot be moved.
      }
    }
    fallbackToMemory(session, String(reason));
  }
}

export function resolveTsConfigPath(projectRoot: string): string {
  const abs = path.resolve(projectRoot);
  const stat = fs.existsSync(abs) ? fs.statSync(abs) : null;

  if (stat?.isFile() && abs.endsWith(".json")) {
    return fs.realpathSync(abs);
  }

  const candidate = path.join(abs, "tsconfig.json");
  if (fs.existsSync(candidate)) {
    return fs.realpathSync(candidate);
  }

  throw new Error(
    `No tsconfig.json found at "${abs}". Pass a project directory containing tsconfig.json or the config file itself.`,
  );
}

function buildProjectContext(tsConfigFilePath: string): ProjectContext {
  const project = new Project({
    tsConfigFilePath,
    skipAddingFilesFromTsConfig: false,
  });
  const projectRoot = path.dirname(tsConfigFilePath);
  projectRoots.set(project, projectRoot);
  const status = createInitialProjectStatus(
    createProjectIdentity({ projectRoot, configPath: tsConfigFilePath }),
    { sourceCount: project.getSourceFiles().length },
  );
  return {
    project,
    projectRoot,
    tsConfigFilePath,
    status,
    symbolIndex: new InMemorySymbolIndex(),
    symbolIndexReady: false,
    symbolIndexBackend: "memory",
    symbolIndexFallbackReason: null,
    symbolIndexObservability: createInitialSymbolIndexRuntimeObservability(),
  };
}

export function createFreshProject(projectRoot: string): ProjectContext {
  return buildProjectContext(resolveTsConfigPath(projectRoot));
}

function closeProjectSession(session: ProjectSession): void {
  session.watcher.close();
  closePersistentSymbolIndex(session);
}

function createSessionWatcher(
  getSession: () => ProjectSession,
  projectRoot: string,
  directories: readonly string[],
): ProjectWatcher {
  return createProjectWatcher({
    projectRoot,
    directories,
    onChange: (files) => {
      const session = getSession();
      const cachePath = symbolIndexCachePath(
        session.symbolIndexPolicy,
        session.context.status.project,
      );
      let sourceFiles = files;
      if (cachePath) {
        const relativeCachePath = path
          .relative(session.context.projectRoot, cachePath)
          .split(path.sep)
          .join("/");
        if (!relativeCachePath.startsWith("../") && !path.isAbsolute(relativeCachePath)) {
          const relativeCacheDirectory = path.posix.dirname(relativeCachePath);
          const quarantinePrefix = `${relativeCachePath}.corrupt-`;
          sourceFiles = files.filter((file) => {
            if (relativeCacheDirectory !== "." && file === relativeCacheDirectory) return false;
            if (
              file === relativeCachePath ||
              file === `${relativeCachePath}-wal` ||
              file === `${relativeCachePath}-shm`
            ) {
              return false;
            }
            return !(
              file.startsWith(quarantinePrefix) &&
              /^\d+-\d+$/u.test(file.slice(quarantinePrefix.length))
            );
          });
        }
      }
      if (sourceFiles.length === 0) return;
      session.context = {
        ...session.context,
        status: transitionProjectStatus(session.context.status, {
          type: "source_changed",
          files: sourceFiles,
        }),
      };
    },
    onError: (error) => {
      const session = getSession();
      session.context = {
        ...session.context,
        status: transitionProjectStatus(session.context.status, {
          type: "watcher_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      };
    },
  });
}

function sameDirectories(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((directory, index) => directory === right[index])
  );
}

function replaceSessionWatcher(session: ProjectSession, directories: readonly string[]): void {
  if (
    sameDirectories(session.watchDirectories, directories) &&
    session.watcher.snapshot().state !== "failed"
  ) {
    return;
  }
  const previous = session.watcher;
  const replacement = createSessionWatcher(() => session, session.context.projectRoot, directories);
  session.watcher = replacement;
  session.watchDirectories = directories;
  replacement.start();
  previous.close();
  if (replacement.snapshot().state === "ready") {
    session.context = {
      ...session.context,
      status: transitionProjectStatus(session.context.status, { type: "watcher_recovered" }),
    };
  }
}

function sessionHasAdmittedOperations(session: ProjectSession): boolean {
  const snapshot = session.scheduler.snapshot();
  return snapshot.active_operations + snapshot.queued_operations > 0;
}

function ensureProjectSessionCapacity(sessionCapacity: number): void {
  while (projectSessions.size >= sessionCapacity) {
    const candidate = [...projectSessions.entries()]
      .filter(([, session]) => !sessionHasAdmittedOperations(session))
      .sort((left, right) =>
        left[1].lastAccessSequence < right[1].lastAccessSequence
          ? -1
          : left[1].lastAccessSequence > right[1].lastAccessSequence
            ? 1
            : 0,
      )[0];

    if (!candidate) throw new ProjectCapacityError();
    closeProjectSession(candidate[1]);
    projectSessions.delete(candidate[0]);
  }
}

function assertProjectRuntimeAdmissionOpen(): void {
  if (projectRuntimeAdmission === "closed") {
    throw new ProjectOperationSchedulerError("SERVER_SHUTTING_DOWN");
  }
}

function createProjectSession(
  projectRoot: string,
  runtimePolicy: RuntimePolicy,
  symbolIndexPolicy: SymbolIndexPersistencePolicy,
  requestContext: RequestContext,
  lastAccessSequence: bigint,
): ProjectSession {
  requestContext.checkpoint();
  const tsConfigFilePath = resolveTsConfigPath(projectRoot);
  const baseContext = buildProjectContext(tsConfigFilePath);
  const context: ProjectContext = {
    ...baseContext,
    symbolIndexObservability: createInitialSymbolIndexRuntimeObservability(symbolIndexPolicy),
  };
  const watchDirectories = selectProjectWatchDirectories(
    context.projectRoot,
    context.project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath()),
  );
  const owner: { session?: ProjectSession } = {};
  const watcher = createSessionWatcher(() => owner.session!, context.projectRoot, watchDirectories);
  const session: ProjectSession = {
    context,
    watcher,
    watchDirectories,
    configDigest: createConfigSnapshot(tsConfigFilePath).digest,
    fingerprints: new Map(),
    compilerStateUntrusted: false,
    scheduler: new ProjectOperationScheduler({
      queueCapacity: runtimePolicy.maxQueuedOperationsPerProject,
      queueWaitTimeoutMs: runtimePolicy.queueWaitTimeoutMs,
      operationDeadlineMs: runtimePolicy.operationDeadlineMs,
    }),
    lastAccessSequence,
    symbolIndexPolicy,
  };
  owner.session = session;
  watcher.start();
  if (watcher.snapshot().state === "ready") {
    session.context = {
      ...session.context,
      status: transitionProjectStatus(session.context.status, { type: "watcher_recovered" }),
    };
  }
  return session;
}

function getOrCreateSession(
  projectRoot: string,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): ProjectSession {
  assertProjectRuntimeAdmissionOpen();
  requestContext.checkpoint();
  const tsConfigFilePath = resolveTsConfigPath(projectRoot);
  const existing = projectSessions.get(tsConfigFilePath);
  if (existing) return existing;

  const runtimePolicy = getProjectRuntimePolicy();
  ensureProjectSessionCapacity(runtimePolicy.maxProjectSessions);
  const symbolIndexPolicy = readSymbolIndexPersistencePolicy();
  const session = createProjectSession(
    projectRoot,
    runtimePolicy,
    symbolIndexPolicy,
    requestContext,
    nextProjectSessionAccessSequence(),
  );
  projectSessions.set(tsConfigFilePath, session);
  return session;
}

function getQueueStatus(session: ProjectSession): ProjectOperationQueueProjection {
  const snapshot = session.scheduler.snapshot();
  return projectOperationQueueToProjection(snapshot, snapshot.queue_capacity);
}

export function getProjectOperationQueueSnapshot(
  projectRoot: string,
): ProjectOperationQueueProjection {
  const session = projectSessions.get(resolveTsConfigPath(projectRoot));
  if (!session) throw new Error("Project session not found.");
  return getQueueStatus(session);
}

export function getProjectSessionRegistrySnapshot(): ProjectSessionRegistrySnapshot {
  const activeSessions = [...projectSessions.values()].filter((session) =>
    sessionHasAdmittedOperations(session),
  ).length;
  return Object.freeze({
    session_count: projectSessions.size,
    active_sessions: activeSessions,
    idle_sessions: projectSessions.size - activeSessions,
    session_capacity: getProjectRuntimePolicy().maxProjectSessions,
  });
}

async function synchronizeSession(
  session: ProjectSession,
  requestContext: ProjectOperationContext,
): Promise<void> {
  let syncFailureCause: SynchronizationCause = "compiler_rebuild";
  let currentConfigDigest: string;
  let compilerStateMayHaveAdvanced = false;
  try {
    requestContext.checkpoint();
    currentConfigDigest = createConfigSnapshot(session.context.tsConfigFilePath).digest;
    const compilerConfigChanged = currentConfigDigest !== session.configDigest;
    if (compilerConfigChanged || session.compilerStateUntrusted) {
      let status = session.context.status;
      if (compilerConfigChanged) {
        status = transitionProjectStatus(status, { type: "config_changed" });
      }
      status = transitionProjectStatus(status, { type: "compiler_rebuild_started" });
      const symbolIndexObservability = session.context.symbolIndexObservability;
      closePersistentSymbolIndex(session);
      const rebuilt = buildProjectContext(session.context.tsConfigFilePath);
      session.context = { ...rebuilt, status, symbolIndexObservability };
      session.compilerStateUntrusted = false;
    }

    const { project, tsConfigFilePath } = session.context;
    syncFailureCause = "source_change";
    requestContext.checkpoint();
    compilerStateMayHaveAdvanced = true;
    project.addSourceFilesFromTsConfig(tsConfigFilePath);
    for (const sourceFile of project.getSourceFiles()) {
      requestContext.checkpoint();
      if (!fs.existsSync(sourceFile.getFilePath())) project.removeSourceFile(sourceFile);
    }
    requestContext.checkpoint();
    replaceSessionWatcher(
      session,
      selectProjectWatchDirectories(
        session.context.projectRoot,
        project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath()),
      ),
    );
    requestContext.checkpoint();

    const snapshot = createWorkspaceSnapshot(session.context, {
      previousFingerprints: session.fingerprints,
      verifyContentHash: true,
    });
    if (snapshot.configDigest !== currentConfigDigest) {
      syncFailureCause = "config_change";
      throw new Error("Project configuration changed during synchronization. Retry the operation.");
    }

    const changedPaths = new Set([
      ...snapshot.fingerprintChanges.added,
      ...snapshot.fingerprintChanges.changed,
    ]);
    requestContext.checkpoint();
    await Promise.all(
      project.getSourceFiles().map(async (sourceFile) => {
        requestContext.checkpoint();
        const absoluteFilePath = fs.realpathSync(sourceFile.getFilePath());
        if (changedPaths.has(absoluteFilePath)) await sourceFile.refreshFromFileSystem();
      }),
    );
    requestContext.checkpoint();
    const verificationSnapshot = createWorkspaceSnapshot(session.context, {
      previousFingerprints: snapshot.fingerprints,
      verifyContentHash: true,
    });
    requestContext.checkpoint();
    if (verificationSnapshot.configDigest !== currentConfigDigest) {
      syncFailureCause = "config_change";
      throw new Error("Project configuration changed during synchronization. Retry the operation.");
    }
    if (verificationSnapshot.sourceDigest !== snapshot.sourceDigest) {
      syncFailureCause = "source_change";
      throw new Error("Project source changed during synchronization. Retry the operation.");
    }

    requestContext.checkpoint();
    await ensureSessionSymbolIndex(session, requestContext);

    const sourceFiles = session.context.project.getSourceFiles();
    const currentIndexFiles: SymbolIndexCurrentFile[] = sourceFiles.map((sourceFile) => {
      requestContext.checkpoint();
      const absoluteFilePath = fs.realpathSync(sourceFile.getFilePath());
      const fingerprint = verificationSnapshot.fingerprints.get(absoluteFilePath);
      if (!fingerprint) {
        throw new Error(`No verified fingerprint found for ${absoluteFilePath}.`);
      }
      return {
        file_path: path
          .relative(session.context.projectRoot, sourceFile.getFilePath())
          .replaceAll(path.sep, "/"),
        content_hash: fingerprint.content_hash,
      };
    });
    let existingIndexEntries;
    try {
      requestContext.checkpoint();
      existingIndexEntries = await session.context.symbolIndex.load(
        session.context.status.project,
        SYMBOL_INDEX_SCHEMA_VERSION,
      );
      requestContext.checkpoint();
    } catch (error) {
      if (isCooperativeInterruption(error)) throw error;
      if (session.context.symbolIndexBackend !== "sqlite") throw error;
      fallbackToMemory(
        session,
        (error as Partial<SymbolIndexStorageError>).code ?? "sqlite_read_failed",
      );
      requestContext.checkpoint();
      existingIndexEntries = await session.context.symbolIndex.load(
        session.context.status.project,
        SYMBOL_INDEX_SCHEMA_VERSION,
      );
      requestContext.checkpoint();
    }
    if (session.context.symbolIndexBackend === "sqlite") {
      const cacheWarm = existingIndexEntries.length > 0;
      session.context = {
        ...session.context,
        symbolIndexObservability: {
          ...session.context.symbolIndexObservability,
          state: "rebuilding",
          operation: cacheWarm ? "hit" : "miss",
          last_operation: cacheWarm ? "hit" : "miss",
          loaded_entries: addSymbolIndexRuntimeCount(
            session.context.symbolIndexObservability.loaded_entries,
            existingIndexEntries.length,
          ),
          accepted_entries: addSymbolIndexRuntimeCount(
            session.context.symbolIndexObservability.accepted_entries,
            existingIndexEntries.length,
          ),
          cache_hits: addSymbolIndexRuntimeCount(
            session.context.symbolIndexObservability.cache_hits,
            cacheWarm ? 1 : 0,
          ),
          cache_misses: addSymbolIndexRuntimeCount(
            session.context.symbolIndexObservability.cache_misses,
            cacheWarm ? 0 : 1,
          ),
        },
      };
    }
    const existingByPath = new Map(existingIndexEntries.map((entry) => [entry.file_path, entry]));
    const fingerprintChangedFiles = new Set(
      [
        ...verificationSnapshot.fingerprintChanges.added,
        ...verificationSnapshot.fingerprintChanges.changed,
      ].map((filePath) =>
        path.relative(session.context.projectRoot, filePath).replaceAll(path.sep, "/"),
      ),
    );
    const configChanged = existingIndexEntries.some(
      (entry) => entry.config_digest !== verificationSnapshot.configDigest,
    );
    const filesToRebuild = new Set(
      currentIndexFiles
        .filter((file) => {
          const previous = existingByPath.get(file.file_path);
          return (
            configChanged ||
            fingerprintChangedFiles.has(file.file_path) ||
            !previous ||
            previous.content_hash !== file.content_hash ||
            previous.config_digest !== verificationSnapshot.configDigest
          );
        })
        .map((file) => file.file_path),
    );
    const indexFiles: SymbolIndexRefreshFile[] = sourceFiles
      .filter((sourceFile) => {
        requestContext.checkpoint();
        const filePath = path
          .relative(session.context.projectRoot, sourceFile.getFilePath())
          .replaceAll(path.sep, "/");
        return filesToRebuild.has(filePath);
      })
      .map((sourceFile) => {
        requestContext.checkpoint();
        const absoluteFilePath = fs.realpathSync(sourceFile.getFilePath());
        const fingerprint = verificationSnapshot.fingerprints.get(absoluteFilePath);
        if (!fingerprint) {
          throw new Error(`No verified fingerprint found for ${absoluteFilePath}.`);
        }
        return {
          file_path: path
            .relative(session.context.projectRoot, sourceFile.getFilePath())
            .replaceAll(path.sep, "/"),
          content_hash: fingerprint.content_hash,
          symbols: sourceFileIndexSymbols(sourceFile, session.context.projectRoot),
        };
      });

    try {
      requestContext.checkpoint();
      const refreshResult = await session.context.symbolIndex.refresh({
        project: session.context.status.project,
        config_digest: verificationSnapshot.configDigest,
        current_files: currentIndexFiles,
        files: indexFiles,
        last_indexed_at: new Date().toISOString(),
      });
      requestContext.checkpoint();
      await session.context.symbolIndex.flush();
      requestContext.checkpoint();
      session.context = {
        ...session.context,
        symbolIndexReady: true,
        symbolIndexObservability:
          session.context.symbolIndexBackend === "sqlite"
            ? {
                ...session.context.symbolIndexObservability,
                state: "ready",
                operation: refreshResult.rebuilt_files.length > 0 ? "rebuild" : "hit",
                last_operation: refreshResult.rebuilt_files.length > 0 ? "rebuild" : "hit",
                last_successful_persistence_at: new Date().toISOString(),
                rebuilt_files: addSymbolIndexRuntimeCount(
                  session.context.symbolIndexObservability.rebuilt_files,
                  refreshResult.rebuilt_files.length,
                ),
                reused_files: addSymbolIndexRuntimeCount(
                  session.context.symbolIndexObservability.reused_files,
                  refreshResult.reused_files.length,
                ),
                removed_files: addSymbolIndexRuntimeCount(
                  session.context.symbolIndexObservability.removed_files,
                  refreshResult.removed_files.length,
                ),
              }
            : session.context.symbolIndexObservability,
      };
    } catch (error) {
      if (isCooperativeInterruption(error)) throw error;
      if (session.context.symbolIndexBackend === "sqlite") {
        fallbackToMemory(
          session,
          (error as Partial<SymbolIndexStorageError>).code ?? "sqlite_write_failed",
        );
        try {
          const fallbackFiles: SymbolIndexRefreshFile[] = sourceFiles.map((sourceFile) => {
            requestContext.checkpoint();
            const absoluteFilePath = fs.realpathSync(sourceFile.getFilePath());
            const fingerprint = verificationSnapshot.fingerprints.get(absoluteFilePath);
            if (!fingerprint) {
              throw new Error(`No verified fingerprint found for ${absoluteFilePath}.`);
            }
            return {
              file_path: path
                .relative(session.context.projectRoot, sourceFile.getFilePath())
                .replaceAll(path.sep, "/"),
              content_hash: fingerprint.content_hash,
              symbols: sourceFileIndexSymbols(sourceFile, session.context.projectRoot),
            };
          });
          requestContext.checkpoint();
          await session.context.symbolIndex.refresh({
            project: session.context.status.project,
            config_digest: verificationSnapshot.configDigest,
            current_files: currentIndexFiles,
            files: fallbackFiles,
            last_indexed_at: new Date().toISOString(),
          });
          requestContext.checkpoint();
          session.context = { ...session.context, symbolIndexReady: true };
        } catch (fallbackError) {
          if (isCooperativeInterruption(fallbackError)) throw fallbackError;
          session.context = { ...session.context, symbolIndexReady: false };
        }
      } else {
        session.context = { ...session.context, symbolIndexReady: false };
      }
    }

    const status = transitionProjectStatus(session.context.status, {
      type: "sync_succeeded",
      sourceCount: verificationSnapshot.sourceFileCount,
      indexedCount: 0,
      sourceSnapshotFingerprint: `source_${verificationSnapshot.sourceDigest}`,
      configSnapshotFingerprint: `config_${verificationSnapshot.configDigest}`,
      canonicalSnapshotFingerprint: `snapshot_${verificationSnapshot.digest}`,
      at: new Date().toISOString(),
    });
    session.context = { ...session.context, status };
    session.configDigest = verificationSnapshot.configDigest;
    session.fingerprints = verificationSnapshot.fingerprints;
    session.compilerStateUntrusted = false;
  } catch (error) {
    if (compilerStateMayHaveAdvanced) session.compilerStateUntrusted = true;
    if (isCooperativeInterruption(error)) throw error;
    const status = transitionProjectStatus(session.context.status, {
      type: "sync_failed",
      cause: syncFailureCause,
      error: error instanceof Error ? error.message : String(error),
    });
    session.context = { ...session.context, status };
    throw error;
  }
}

async function runSessionWithSyncPolicy<T>(
  session: ProjectSession,
  operation: (context: ProjectContext, requestContext: ProjectOperationContext) => Promise<T> | T,
  allowSynchronizationFailure: boolean,
  requestContext: RequestContext,
  h03Fixture = false,
): Promise<T> {
  requestContext.checkpoint();
  const h05Command = h03Fixture ? captureConfiguredH05Command() : undefined;
  // prettier-ignore
  const h03Command = h05Command ? undefined : h03Fixture ? captureConfiguredH03Command() : undefined;
  // prettier-ignore
  try { return await session.scheduler.run(
    async (operationContext) => {
      operationContext.checkpoint();
      try {
        await synchronizeSession(session, operationContext);
      } catch (error) {
        if (!allowSynchronizationFailure || isCooperativeInterruption(error)) throw error;
      }
      operationContext.checkpoint();
      operationContext.markExecuting();
      session.lastAccessSequence = nextProjectSessionAccessSequence();
      const execute = (context: ProjectOperationContext) => operation(session.context, context);
      return h05Command ? runConfiguredH05Fixture(operationContext, execute, h05Command) : h03Command ? runConfiguredH03Fixture(operationContext, execute, h03Command) : execute(operationContext);
    }, { signal: requestContext.signal },
  ); } catch (error) { bindConfiguredH03Error(error, h05Command ?? h03Command); throw error; }
}

export async function withProject<T>(
  projectRoot: string,
  operation: (context: ProjectContext, requestContext: ProjectOperationContext) => Promise<T> | T,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<T> {
  requestContext.checkpoint();
  return runSessionWithSyncPolicy(
    getOrCreateSession(projectRoot, requestContext),
    operation,
    false,
    requestContext,
  );
}

export async function withProjectOperation<T>(
  projectRoot: string,
  operation: (requestContext: ProjectOperationContext) => Promise<T> | T,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<T> {
  requestContext.checkpoint();
  const session = getOrCreateSession(projectRoot, requestContext);
  return session.scheduler.run(
    (operationContext) => {
      operationContext.checkpoint();
      operationContext.markExecuting();
      session.lastAccessSequence = nextProjectSessionAccessSequence();
      return operation(operationContext);
    },
    { signal: requestContext.signal },
  );
}

function readProjectStatus(
  session: ProjectSession,
  requestContext: RequestContext,
): Promise<ProjectStatusSnapshot> {
  return runSessionWithSyncPolicy(
    session,
    async (context, operationContext) => {
      let effectiveContext = context;
      let indexedCount = 0;
      if (context.symbolIndexBackend === "sqlite" && context.symbolIndexReady) {
        try {
          operationContext.checkpoint();
          indexedCount = (
            await context.symbolIndex.load(context.status.project, SYMBOL_INDEX_SCHEMA_VERSION)
          ).length;
          operationContext.checkpoint();
        } catch (error) {
          if (isCooperativeInterruption(error)) throw error;
          fallbackToMemory(
            session,
            (error as Partial<SymbolIndexStorageError>).code ?? "sqlite_read_failed",
          );
          effectiveContext = session.context;
          indexedCount = 0;
        }
      }
      return {
        ...projectStatusToProjection(effectiveContext.status),
        index: { state: effectiveContext.symbolIndexObservability.state },
        indexed_count: indexedCount,
        last_successful_index_at:
          effectiveContext.symbolIndexObservability.last_successful_persistence_at,
        index_observability: { ...effectiveContext.symbolIndexObservability },
        operation_queue: getQueueStatus(session),
      };
    },
    true,
    requestContext,
    true,
  );
}

function peekSessionStatus(session: ProjectSession): ProjectStatusSnapshot {
  const context = session.context;
  return {
    ...projectStatusToProjection(context.status),
    index: { state: context.symbolIndexObservability.state },
    indexed_count: 0,
    last_successful_index_at: context.symbolIndexObservability.last_successful_persistence_at,
    index_observability: { ...context.symbolIndexObservability },
    operation_queue: getQueueStatus(session),
  };
}

export function peekRegisteredProjectStatus(
  projectRoot: string,
): ProjectStatusSnapshot | undefined {
  const session = projectSessions.get(resolveTsConfigPath(projectRoot));
  return session ? peekSessionStatus(session) : undefined;
}

export async function getProjectStatus(
  projectRoot: string,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<ProjectStatusSnapshot> {
  requestContext.checkpoint();
  return readProjectStatus(getOrCreateSession(projectRoot, requestContext), requestContext);
}

export async function getDiagnosticProjectStatus(
  projectRoot: string,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<DiagnosticProjectStatusSnapshot> {
  requestContext.checkpoint();
  const runtimePolicy = getProjectRuntimePolicy();
  const registered = peekRegisteredProjectStatus(projectRoot);
  if (registered)
    return {
      authority: "registered",
      runtime_admission: projectRuntimeAdmission,
      session_capacity: runtimePolicy.maxProjectSessions,
      status: registered,
    };
  if (projectRuntimeAdmission === "closed")
    return {
      authority: "unavailable",
      runtime_admission: "closed",
      session_capacity: runtimePolicy.maxProjectSessions,
    };
  const session = createProjectSession(
    projectRoot,
    runtimePolicy,
    readSymbolIndexPersistencePolicy({ AST_SYMBOL_INDEX_PERSISTENCE: "disabled" }),
    requestContext,
    0n,
  );
  try {
    return {
      authority: "isolated",
      runtime_admission: projectRuntimeAdmission,
      session_capacity: runtimePolicy.maxProjectSessions,
      status: await readProjectStatus(session, requestContext),
    };
  } finally {
    closeProjectSession(session);
  }
}

// Compatibility API for internal scripts. MCP tools should use withProject().
export function getProject(projectRoot: string): Project {
  return createFreshProject(projectRoot).project;
}

export function invalidateProject(projectRoot: string): void {
  const tsConfigFilePath = resolveTsConfigPath(projectRoot);
  const session = projectSessions.get(tsConfigFilePath);
  if (session) closeProjectSession(session);
  projectSessions.delete(tsConfigFilePath);
}

export function invalidateProjectIfIdle(
  projectRoot: string,
  options: { readonly preserveCancellationTelemetry?: boolean } = {},
): boolean {
  const tsConfigFilePath = resolveTsConfigPath(projectRoot);
  const session = projectSessions.get(tsConfigFilePath);
  if (!session) return true;
  const queue = session.scheduler.snapshot();
  if (
    queue.active_operations > 0 ||
    queue.queued_operations > 0 ||
    (options.preserveCancellationTelemetry === true && queue.cancelled_operations > 0)
  ) {
    return false;
  }
  closeProjectSession(session);
  projectSessions.delete(tsConfigFilePath);
  return true;
}

export function clearProjectSessions(): void {
  for (const session of projectSessions.values()) {
    closeProjectSession(session);
  }
  projectSessions.clear();
  projectSessionAccessSequence = 0n;
  projectRuntimePolicy = undefined;
  projectRuntimeAdmission = "open";
  projectMutationHistory = false;
}

export interface ProjectRuntimeShutdownSnapshot {
  readonly admission: "open" | "closed";
  readonly session_count: number;
  readonly active_operations: number;
  readonly queued_operations: number;
  readonly completion_critical_operations: number;
  readonly mutation_history: boolean;
}

export function recordProjectMutationHistory(): void {
  projectMutationHistory = true;
}

export function prepareProjectRuntimeForStartup(): void {
  if (projectSessions.size !== 0) {
    throw new Error("Cannot start a project runtime while sessions remain open.");
  }
  projectRuntimeAdmission = "open";
  projectMutationHistory = false;
}

export function getProjectRuntimeShutdownSnapshot(): ProjectRuntimeShutdownSnapshot {
  let activeOperations = 0;
  let queuedOperations = 0;
  let completionCriticalOperations = 0;
  for (const session of projectSessions.values()) {
    const snapshot = session.scheduler.shutdownSnapshot();
    activeOperations += snapshot.active_operations;
    queuedOperations += snapshot.queued_operations;
    completionCriticalOperations += snapshot.completion_critical_operations;
  }
  return Object.freeze({
    admission: projectRuntimeAdmission,
    session_count: projectSessions.size,
    active_operations: activeOperations,
    queued_operations: queuedOperations,
    completion_critical_operations: completionCriticalOperations,
    mutation_history: projectMutationHistory,
  });
}

export function beginProjectShutdown(): ProjectRuntimeShutdownSnapshot {
  projectRuntimeAdmission = "closed";
  for (const session of projectSessions.values()) session.scheduler.beginShutdown();
  return getProjectRuntimeShutdownSnapshot();
}

export async function waitForProjectOperationsToDrain(): Promise<void> {
  await Promise.all(
    [...projectSessions.values()].map((session) => session.scheduler.waitForIdle()),
  );
}

export async function waitForProjectCompletionCriticalOperationsToDrain(): Promise<void> {
  await Promise.all(
    [...projectSessions.values()].map((session) =>
      session.scheduler.waitForCompletionCriticalOperationsToDrain(),
    ),
  );
}

export function closeDrainedProjectSessions(): void {
  const snapshot = getProjectRuntimeShutdownSnapshot();
  if (snapshot.active_operations !== 0 || snapshot.queued_operations !== 0) {
    throw new Error("Cannot close project sessions while operations are active.");
  }
  for (const session of projectSessions.values()) closeProjectSession(session);
  projectSessions.clear();
  projectSessionAccessSequence = 0n;
  projectRuntimePolicy = undefined;
}

export function getSourceFileOrThrow(project: Project, filePath: string): SourceFile {
  const projectRoot = projectRoots.get(project) ?? process.cwd();
  const normalizedInput = path.normalize(filePath);
  const exactPath = path.isAbsolute(normalizedInput)
    ? normalizedInput
    : path.resolve(projectRoot, normalizedInput);
  const sourceFiles = project.getSourceFiles();
  const exact = sourceFiles.find(
    (sourceFile) => path.normalize(sourceFile.getFilePath()) === exactPath,
  );
  if (exact) return exact;

  const suffix = normalizedInput.split(path.sep).join("/");
  const candidates = sourceFiles.filter((sourceFile) =>
    sourceFile.getFilePath().split(path.sep).join("/").endsWith(`/${suffix}`),
  );

  if (candidates.length === 1) return candidates[0];

  if (candidates.length > 1) {
    const relativeCandidates = candidates
      .map((sourceFile) => path.relative(projectRoot, sourceFile.getFilePath()))
      .sort();
    throw new Error(
      `Ambiguous source file "${filePath}". Use one of: ${relativeCandidates.join(", ")}.`,
    );
  }

  throw new Error(
    `Source file "${filePath}" was not found in the project. Use a project-relative or absolute path returned by ast_list_files.`,
  );
}

export function findDeclarationByName(sourceFile: SourceFile, symbolPath: string): Node {
  return findDeclaration(sourceFile, symbolPath);
}
