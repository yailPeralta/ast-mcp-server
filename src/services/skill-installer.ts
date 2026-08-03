import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SKILL_NAME = "structural-code-editing";

type SkillTarget = "claude" | "hermes";
export type SkillTargetSelection = SkillTarget | "all";
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
}

interface DestinationPlan {
  target: SkillTarget;
  scope: SkillScope;
  path: string;
  status: InstallationStatus;
}

export async function resolveBundledSkillPath(executablePath: string): Promise<string> {
  const resolvedExecutable = await realpath(executablePath);
  return path.resolve(path.dirname(resolvedExecutable), "..", "skills", SKILL_NAME, "SKILL.md");
}

function resolveConfiguredDirectory(
  configured: string | undefined,
  fallback: string,
  workingDirectory: string,
): string {
  return path.resolve(workingDirectory, configured ?? fallback);
}

async function resolveDestinationPlans(
  options: InstallBundledSkillOptions,
): Promise<Array<Omit<DestinationPlan, "status">>> {
  if (options.scope === "project" && options.target !== "claude") {
    throw new Error("Project scope is supported only for Claude Code skills.");
  }

  const homeDirectory = options.homeDirectory ?? os.homedir();
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const environment = options.environment ?? process.env;
  const targets: SkillTarget[] = options.target === "all" ? ["claude", "hermes"] : [options.target];

  let projectRoot: string | undefined;
  if (options.scope === "project") {
    projectRoot = path.resolve(workingDirectory, options.projectRoot ?? workingDirectory);
    const projectStats = await stat(projectRoot).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Project root does not exist: ${projectRoot}`);
      }
      throw error;
    });
    if (!projectStats.isDirectory()) {
      throw new Error(`Project root is not a directory: ${projectRoot}`);
    }
  }

  return targets.map((target) => {
    if (target === "claude") {
      const root =
        options.scope === "project"
          ? path.join(projectRoot!, ".claude")
          : resolveConfiguredDirectory(
              environment.CLAUDE_CONFIG_DIR,
              path.join(homeDirectory, ".claude"),
              workingDirectory,
            );
      return {
        target,
        scope: options.scope,
        path: path.join(root, "skills", SKILL_NAME, "SKILL.md"),
      };
    }

    const hermesHome = resolveConfiguredDirectory(
      environment.HERMES_HOME,
      path.join(homeDirectory, ".hermes"),
      workingDirectory,
    );
    return {
      target,
      scope: "user",
      path: path.join(hermesHome, "skills", "software-development", SKILL_NAME, "SKILL.md"),
    };
  });
}

async function classifyDestination(
  destination: string,
  sourceContent: string,
  force: boolean,
): Promise<InstallationStatus> {
  try {
    const existingContent = await readFile(destination, "utf8");
    if (existingContent === sourceContent) return "unchanged";
    if (!force) {
      throw new Error(
        `Skill already exists with different content at ${destination}; pass --force to replace it.`,
      );
    }
    return "updated";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "installed";
    throw error;
  }
}

async function writeSkill(
  destination: string,
  sourceContent: string,
  status: InstallationStatus,
): Promise<void> {
  if (status === "unchanged") return;

  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, sourceContent, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });

  try {
    if (status === "installed") {
      await link(temporaryPath, destination).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`Skill appeared concurrently at ${destination}; no files were replaced.`);
        }
        throw error;
      });
      await rm(temporaryPath);
      return;
    }
    await rename(temporaryPath, destination);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function installBundledSkill(
  options: InstallBundledSkillOptions,
): Promise<SkillInstallationResult> {
  const sourceContent = await readFile(path.resolve(options.sourceSkillPath), "utf8");
  const destinations = await resolveDestinationPlans(options);
  const force = options.force ?? false;

  const statusByPath = new Map<string, InstallationStatus>();
  for (const destination of destinations) {
    if (!statusByPath.has(destination.path)) {
      statusByPath.set(
        destination.path,
        await classifyDestination(destination.path, sourceContent, force),
      );
    }
  }

  for (const [destination, status] of statusByPath) {
    await writeSkill(destination, sourceContent, status);
  }

  return {
    version: 1,
    status: "ok",
    skill: SKILL_NAME,
    installations: destinations.map((destination) => ({
      ...destination,
      status: statusByPath.get(destination.path)!,
    })),
  };
}
