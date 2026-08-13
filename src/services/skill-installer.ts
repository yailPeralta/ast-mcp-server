import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SKILL_NAME = "structural-code-editing";
export type SkillTarget = "claude" | "hermes" | "opencode" | "codex" | "gemini" | "copilot";
export type SkillTargetSelection = SkillTarget | "all" | readonly SkillTarget[];
export type SkillScope = "user" | "project";
type InstallationStatus = "installed" | "unchanged" | "updated";

interface SkillInstallerEnvironment {
  CLAUDE_CONFIG_DIR?: string;
  HERMES_HOME?: string;
}
export interface InstallBundledSkillOptions {
  target: SkillTargetSelection;
  scope: SkillScope;
  sourceSkillPath: string;
  projectRoot?: string;
  force?: boolean;
  environment?: SkillInstallerEnvironment;
  homeDirectory?: string;
  workingDirectory?: string;
}
export interface SkillInstallation {
  target: SkillTarget;
  scope: SkillScope;
  status: InstallationStatus;
  path: string;
}
export interface SkillInstallationResult {
  version: 1;
  status: "ok";
  skill: typeof SKILL_NAME;
  installations: SkillInstallation[];
  physicalWrites: Array<{ path: string; status: InstallationStatus }>;
}

export class SkillConflictError extends Error {
  constructor(readonly destination: string) {
    super(
      `Skill already exists with different content at ${destination}; pass --force to replace it.`,
    );
    this.name = "SkillConflictError";
  }
}

export async function resolveBundledSkillPath(executablePath: string): Promise<string> {
  return path.resolve(
    path.dirname(await realpath(executablePath)),
    "..",
    "skills",
    SKILL_NAME,
    "SKILL.md",
  );
}

function configured(value: string | undefined, fallback: string, cwd: string): string {
  return path.resolve(cwd, value ?? fallback);
}

async function canonicalizeFuturePath(target: string): Promise<string> {
  const suffix: string[] = [];
  let cursor = path.resolve(target);
  for (;;) {
    try {
      return path.join(await realpath(cursor), ...suffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function destinations(
  options: InstallBundledSkillOptions,
): Promise<Array<{ target: SkillTarget; scope: SkillScope; path: string }>> {
  const targets: SkillTarget[] =
    options.target === "all"
      ? ["claude", "hermes"]
      : Array.isArray(options.target)
        ? [...options.target]
        : [options.target as SkillTarget];
  if (options.scope === "project" && targets.some((target) => target !== "claude"))
    throw new Error("Project scope is supported only for Claude Code skills.");
  const home = options.homeDirectory ?? os.homedir();
  const cwd = options.workingDirectory ?? process.cwd();
  const env = options.environment ?? process.env;
  let projectRoot: string | undefined;
  if (options.scope === "project") {
    projectRoot = path.resolve(cwd, options.projectRoot ?? cwd);
    const info = await stat(projectRoot).catch(() => undefined);
    if (!info?.isDirectory())
      throw new Error(`Project root does not exist or is not a directory: ${projectRoot}`);
  }
  const result = targets.map((target) => {
    let destination: string;
    if (target === "claude") {
      const root =
        options.scope === "project"
          ? path.join(projectRoot!, ".claude")
          : configured(env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"), cwd);
      destination = path.join(root, "skills", SKILL_NAME, "SKILL.md");
    } else if (target === "hermes") {
      destination = path.join(
        configured(env.HERMES_HOME, path.join(home, ".hermes"), cwd),
        "skills",
        "software-development",
        SKILL_NAME,
        "SKILL.md",
      );
    } else {
      destination = path.join(home, ".agents", "skills", SKILL_NAME, "SKILL.md");
    }
    return {
      target,
      scope: target === "claude" ? options.scope : ("user" as const),
      path: destination,
    };
  });
  return Promise.all(
    result.map(async (item) => ({ ...item, path: await canonicalizeFuturePath(item.path) })),
  );
}

async function classify(
  destination: string,
  content: string,
  force: boolean,
): Promise<InstallationStatus> {
  try {
    const existing = await readFile(destination, "utf8");
    if (existing === content) return "unchanged";
    if (!force) throw new SkillConflictError(destination);
    return "updated";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "installed";
    throw error;
  }
}

async function write(
  destination: string,
  content: string,
  status: InstallationStatus,
): Promise<void> {
  if (status === "unchanged") return;
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
  try {
    if (status === "installed") {
      await link(temporary, destination).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new Error(`Skill appeared concurrently at ${destination}; no files were replaced.`);
        throw error;
      });
      await rm(temporary);
    } else await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function installBundledSkill(
  options: InstallBundledSkillOptions,
): Promise<SkillInstallationResult> {
  const content = await readFile(path.resolve(options.sourceSkillPath), "utf8");
  const logical = await destinations(options);
  const statusByPath = new Map<string, InstallationStatus>();
  for (const item of logical)
    if (!statusByPath.has(item.path))
      statusByPath.set(item.path, await classify(item.path, content, options.force ?? false));
  for (const [destination, status] of statusByPath) await write(destination, content, status);
  return {
    version: 1,
    status: "ok",
    skill: SKILL_NAME,
    installations: logical.map((item) => ({ ...item, status: statusByPath.get(item.path)! })),
    physicalWrites: [...statusByPath]
      .filter(([, status]) => status !== "unchanged")
      .map(([destination, status]) => ({ path: destination, status })),
  };
}
