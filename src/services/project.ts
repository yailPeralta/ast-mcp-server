import fs from "node:fs";
import path from "node:path";
import { Project, type Node, type SourceFile } from "ts-morph";
import type { FileFingerprint } from "./file-fingerprints.js";
import { InMemorySymbolIndex, type SymbolIndexRefreshFile } from "./symbol-index.js";
import { findDeclaration, sourceFileIndexSymbols } from "./symbols.js";
import { createConfigSnapshot, createWorkspaceSnapshot } from "./workspace.js";
import {
  createInitialProjectStatus,
  createProjectIdentity,
  projectStatusToProjection,
  transitionProjectStatus,
  type ProjectStatus,
  type ProjectStatusProjection,
  type SynchronizationCause,
} from "./project-status.js";

export interface ProjectContext {
  project: Project;
  projectRoot: string;
  tsConfigFilePath: string;
  status: ProjectStatus;
  symbolIndex: InMemorySymbolIndex;
  symbolIndexReady: boolean;
}

interface ProjectSession {
  context: ProjectContext;
  configDigest: string;
  fingerprints: ReadonlyMap<string, FileFingerprint>;
  queue: Promise<void>;
  activeOperations: number;
  runningOperations: number;
  queuedOperations: number;
  lastAccessedAt: number;
}

export type ProjectQueueState = "idle" | "queued" | "running";

export interface ProjectOperationQueueStatus {
  readonly state: ProjectQueueState;
  readonly active_operations: number;
  readonly queued_operations: number;
}

export interface ProjectStatusSnapshot extends ProjectStatusProjection {
  readonly operation_queue: ProjectOperationQueueStatus;
}

const MAX_PROJECT_SESSIONS = 8;
const projectSessions = new Map<string, ProjectSession>();
const projectRoots = new WeakMap<Project, string>();

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
  };
}

export function createFreshProject(projectRoot: string): ProjectContext {
  return buildProjectContext(resolveTsConfigPath(projectRoot));
}

function evictSessions(): void {
  if (projectSessions.size < MAX_PROJECT_SESSIONS) return;

  const candidate = [...projectSessions.entries()]
    .filter(([, session]) => session.activeOperations === 0)
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)[0];

  if (candidate) projectSessions.delete(candidate[0]);
}

function getOrCreateSession(projectRoot: string): ProjectSession {
  const tsConfigFilePath = resolveTsConfigPath(projectRoot);
  const existing = projectSessions.get(tsConfigFilePath);
  if (existing) return existing;

  evictSessions();
  const session: ProjectSession = {
    context: buildProjectContext(tsConfigFilePath),
    configDigest: createConfigSnapshot(tsConfigFilePath).digest,
    fingerprints: new Map(),
    queue: Promise.resolve(),
    activeOperations: 0,
    runningOperations: 0,
    queuedOperations: 0,
    lastAccessedAt: Date.now(),
  };
  projectSessions.set(tsConfigFilePath, session);
  return session;
}

function getQueueStatus(session: ProjectSession): ProjectOperationQueueStatus {
  return {
    state:
      session.runningOperations > 0 ? "running" : session.queuedOperations > 0 ? "queued" : "idle",
    active_operations: session.runningOperations,
    queued_operations: session.queuedOperations,
  };
}

async function synchronizeSession(session: ProjectSession): Promise<void> {
  let syncFailureCause: SynchronizationCause = "compiler_rebuild";
  let currentConfigDigest: string;
  try {
    currentConfigDigest = createConfigSnapshot(session.context.tsConfigFilePath).digest;
    if (currentConfigDigest !== session.configDigest) {
      let status = transitionProjectStatus(session.context.status, { type: "config_changed" });
      status = transitionProjectStatus(status, { type: "compiler_rebuild_started" });
      const rebuilt = buildProjectContext(session.context.tsConfigFilePath);
      session.context = { ...rebuilt, status };
    }

    const { project, tsConfigFilePath } = session.context;
    syncFailureCause = "source_change";
    const refreshSourceFiles = async (): Promise<void> => {
      project.addSourceFilesFromTsConfig(tsConfigFilePath);
      await Promise.all(
        project.getSourceFiles().map((sourceFile) => sourceFile.refreshFromFileSystem()),
      );
    };
    await refreshSourceFiles();

    const snapshot = createWorkspaceSnapshot(session.context, {
      previousFingerprints: session.fingerprints,
    });
    if (snapshot.configDigest !== currentConfigDigest) {
      syncFailureCause = "config_change";
      throw new Error("Project configuration changed during synchronization. Retry the operation.");
    }

    await refreshSourceFiles();
    const verificationSnapshot = createWorkspaceSnapshot(session.context, {
      previousFingerprints: snapshot.fingerprints,
      verifyContentHash: true,
    });
    if (verificationSnapshot.configDigest !== currentConfigDigest) {
      syncFailureCause = "config_change";
      throw new Error("Project configuration changed during synchronization. Retry the operation.");
    }
    if (verificationSnapshot.sourceDigest !== snapshot.sourceDigest) {
      syncFailureCause = "source_change";
      throw new Error("Project source changed during synchronization. Retry the operation.");
    }

    const indexFiles: SymbolIndexRefreshFile[] = session.context.project
      .getSourceFiles()
      .map((sourceFile) => {
        const absoluteFilePath = fs.realpathSync(sourceFile.getFilePath());
        const fingerprint = verificationSnapshot.fingerprints.get(absoluteFilePath);
        if (!fingerprint) {
          throw new Error(`No verified fingerprint found for ${absoluteFilePath}.`);
        }
        return {
          file_path: path.relative(session.context.projectRoot, sourceFile.getFilePath()),
          content_hash: fingerprint.content_hash,
          symbols: sourceFileIndexSymbols(sourceFile, session.context.projectRoot),
        };
      });
    const changedFiles = [
      ...verificationSnapshot.fingerprintChanges.added,
      ...verificationSnapshot.fingerprintChanges.changed,
    ].map((filePath) => path.relative(session.context.projectRoot, filePath));

    try {
      await session.context.symbolIndex.refresh({
        project: session.context.status.project,
        config_digest: verificationSnapshot.configDigest,
        files: indexFiles,
        changed_files: changedFiles,
        last_indexed_at: new Date().toISOString(),
      });
      session.context = { ...session.context, symbolIndexReady: true };
    } catch {
      session.context = { ...session.context, symbolIndexReady: false };
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
  } catch (error) {
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
  operation: (context: ProjectContext) => Promise<T> | T,
  allowSynchronizationFailure: boolean,
): Promise<T> {
  session.activeOperations += 1;
  session.queuedOperations += 1;

  let release: (() => void) | undefined;
  const previous = session.queue;
  session.queue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  session.queuedOperations -= 1;
  session.runningOperations += 1;
  try {
    try {
      await synchronizeSession(session);
    } catch (error) {
      if (!allowSynchronizationFailure) throw error;
    }
    session.lastAccessedAt = Date.now();
    return await operation(session.context);
  } finally {
    session.runningOperations -= 1;
    session.activeOperations -= 1;
    release?.();
  }
}

export async function withProject<T>(
  projectRoot: string,
  operation: (context: ProjectContext) => Promise<T> | T,
): Promise<T> {
  return runSessionWithSyncPolicy(getOrCreateSession(projectRoot), operation, false);
}

export async function getProjectStatus(projectRoot: string): Promise<ProjectStatusSnapshot> {
  const session = getOrCreateSession(projectRoot);
  return runSessionWithSyncPolicy(
    session,
    (context) => ({
      ...projectStatusToProjection(context.status),
      operation_queue: getQueueStatus(session),
    }),
    true,
  );
}

// Compatibility API for internal scripts. MCP tools should use withProject().
export function getProject(projectRoot: string): Project {
  return createFreshProject(projectRoot).project;
}

export function invalidateProject(projectRoot: string): void {
  const tsConfigFilePath = resolveTsConfigPath(projectRoot);
  projectSessions.delete(tsConfigFilePath);
}

export function clearProjectSessions(): void {
  projectSessions.clear();
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
