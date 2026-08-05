import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ts } from "ts-morph";
import type { ProjectContext } from "./project.js";

export interface WorkspaceSnapshot {
  digest: string;
  sourceDigest: string;
  configDigest: string;
  sourceFileCount: number;
  fileCount: number;
  files: ReadonlyMap<string, string>;
}

export interface ConfigSnapshot {
  digest: string;
  files: readonly string[];
}

export function hashBytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashWorkspaceFiles(files: ReadonlyMap<string, string>): string {
  const digest = createHash("sha256");
  for (const [filePath, fileHash] of [...files].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    digest.update(filePath);
    digest.update("\0");
    digest.update(fileHash);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function canonicalPath(filePath: string): string {
  return fs.realpathSync(filePath);
}

function parseConfig(configPath: string): {
  extendedSourceFiles: string[];
  projectReferences: string[];
} {
  const source = ts.readJsonConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(source, ts.sys, path.dirname(configPath));
  return {
    extendedSourceFiles: source.extendedSourceFiles ?? [],
    projectReferences: (parsed.projectReferences ?? []).map((reference) => reference.path),
  };
}

function collectConfigPaths(rootConfigPath: string): string[] {
  const pending = [canonicalPath(rootConfigPath)];
  const collected = new Set<string>();

  while (pending.length > 0) {
    const configPath = pending.pop()!;
    if (collected.has(configPath)) continue;
    collected.add(configPath);

    const { extendedSourceFiles, projectReferences } = parseConfig(configPath);
    for (const extendedPath of extendedSourceFiles) {
      if (fs.existsSync(extendedPath)) pending.push(canonicalPath(extendedPath));
    }
    for (const referencePath of projectReferences) {
      if (!fs.existsSync(referencePath)) continue;
      const candidate = fs.statSync(referencePath).isDirectory()
        ? path.join(referencePath, "tsconfig.json")
        : referencePath;
      if (fs.existsSync(candidate)) pending.push(canonicalPath(candidate));
    }
  }

  return [...collected].sort();
}

export function createConfigSnapshot(rootConfigPath: string): ConfigSnapshot {
  const files = collectConfigPaths(rootConfigPath);
  const digest = createHash("sha256");
  for (const filePath of files) {
    digest.update(filePath);
    digest.update("\0");
    digest.update(hashBytes(fs.readFileSync(filePath)));
    digest.update("\0");
  }
  return { digest: digest.digest("hex"), files };
}

export function createWorkspaceSnapshot(context: ProjectContext): WorkspaceSnapshot {
  const sourcePaths = context.project
    .getSourceFiles()
    .map((sourceFile) => canonicalPath(sourceFile.getFilePath()));
  const configSnapshot = createConfigSnapshot(context.tsConfigFilePath);
  const sourceFiles = new Map<string, string>();

  for (const filePath of [...new Set(sourcePaths)].sort()) {
    const digest = hashBytes(fs.readFileSync(filePath));
    sourceFiles.set(filePath, digest);
  }

  const files = new Map(sourceFiles);
  for (const filePath of configSnapshot.files) {
    const digest = hashBytes(fs.readFileSync(filePath));
    const previous = files.get(filePath);
    if (previous && previous !== digest) {
      throw new Error(`Workspace identity collision for ${filePath}.`);
    }
    files.set(filePath, digest);
  }

  return {
    digest: hashWorkspaceFiles(files),
    sourceDigest: hashWorkspaceFiles(sourceFiles),
    configDigest: configSnapshot.digest,
    sourceFileCount: sourceFiles.size,
    fileCount: files.size,
    files,
  };
}
