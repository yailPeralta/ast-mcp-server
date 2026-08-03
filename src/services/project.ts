import fs from "node:fs";
import path from "node:path";
import { Project, type Node, type SourceFile } from "ts-morph";
import { findDeclaration } from "./symbols.js";
import { createConfigSnapshot } from "./workspace.js";

export interface ProjectContext {
  project: Project;
  projectRoot: string;
  tsConfigFilePath: string;
}

interface ProjectSession {
  context: ProjectContext;
  configDigest: string;
  queue: Promise<void>;
  activeOperations: number;
  lastAccessedAt: number;
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
  return { project, projectRoot, tsConfigFilePath };
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
    queue: Promise.resolve(),
    activeOperations: 0,
    lastAccessedAt: Date.now(),
  };
  projectSessions.set(tsConfigFilePath, session);
  return session;
}

async function synchronizeSession(session: ProjectSession): Promise<void> {
  const currentConfigDigest = createConfigSnapshot(session.context.tsConfigFilePath).digest;
  if (currentConfigDigest !== session.configDigest) {
    session.context = buildProjectContext(session.context.tsConfigFilePath);
    session.configDigest = currentConfigDigest;
    return;
  }

  const { project, tsConfigFilePath } = session.context;
  project.addSourceFilesFromTsConfig(tsConfigFilePath);
  await Promise.all(
    project.getSourceFiles().map((sourceFile) => sourceFile.refreshFromFileSystem()),
  );
}

export async function withProject<T>(
  projectRoot: string,
  operation: (context: ProjectContext) => Promise<T> | T,
): Promise<T> {
  const session = getOrCreateSession(projectRoot);
  session.activeOperations += 1;

  let release: (() => void) | undefined;
  const previous = session.queue;
  session.queue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    await synchronizeSession(session);
    session.lastAccessedAt = Date.now();
    return await operation(session.context);
  } finally {
    session.activeOperations -= 1;
    release?.();
  }
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
