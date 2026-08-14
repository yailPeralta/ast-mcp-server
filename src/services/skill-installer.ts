import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  applyManagedFilePlan,
  canonicalizeFuturePath,
  captureManagedFileSnapshot,
  createManagedFileApplyContext,
  hashBytes,
  verifyManagedFilePostimage,
  type ManagedFileApplyContext,
  type ManagedFilePlan,
  type ManagedFileStatus,
} from "./managed-file.js";

const SKILL_NAME = "structural-code-editing";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export type SkillTarget = "claude" | "hermes" | "opencode" | "codex" | "gemini" | "copilot";
export type SkillTargetSelection = SkillTarget | "all" | readonly SkillTarget[];
export type SkillScope = "user" | "project";
export type InstallationStatus = ManagedFileStatus;

interface SkillInstallerEnvironment {
  CLAUDE_CONFIG_DIR?: string;
  HERMES_HOME?: string;
}
export interface InstallBundledSkillOptions {
  target: SkillTargetSelection;
  scope: SkillScope;
  sourceSkillPath: string;
  releaseManifestPath?: string;
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
export interface BundledSkillAssets {
  skillPath: string;
  guidancePath: string;
  releasesPath: string;
}
export interface SkillInstallationPlan {
  installations: SkillInstallation[];
  files: ManagedFilePlan[];
}

const ReleaseRecordSchema = z
  .object({
    version: z.string().min(1),
    sha256: z.string().regex(SHA256_PATTERN),
    npm_versions: z.array(z.string().min(1)).min(1),
  })
  .strict();
const SkillReleaseManifestSchema = z
  .object({
    schema_version: z.literal(1),
    algorithm: z.literal("sha256"),
    current: z
      .object({
        version: z.string().min(1),
        sha256: z.string().regex(SHA256_PATTERN),
      })
      .strict(),
    predecessors: z.array(ReleaseRecordSchema),
  })
  .strict();
type SkillReleaseManifest = z.infer<typeof SkillReleaseManifestSchema>;

export class SkillConflictError extends Error {
  constructor(readonly destination: string) {
    super(
      `Skill already exists with different content at ${destination}; pass --force to replace it.`,
    );
    this.name = "SkillConflictError";
  }
}

export async function resolveBundledSkillAssets(
  executablePath: string,
): Promise<BundledSkillAssets> {
  const root = path.resolve(
    path.dirname(await realpath(executablePath)),
    "..",
    "skills",
    SKILL_NAME,
  );
  const assets = {
    skillPath: path.join(root, "SKILL.md"),
    guidancePath: path.join(root, "guidance.md"),
    releasesPath: path.join(root, "releases.json"),
  };
  for (const [label, filePath] of Object.entries(assets)) {
    const info = await stat(filePath).catch(() => undefined);
    if (!info?.isFile())
      throw new Error(`Bundled ${label} is missing or not a regular file: ${filePath}`);
  }
  return assets;
}

export async function resolveBundledSkillPath(executablePath: string): Promise<string> {
  return (await resolveBundledSkillAssets(executablePath)).skillPath;
}

function configured(value: string | undefined, fallback: string, cwd: string): string {
  return path.resolve(cwd, value ?? fallback);
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

async function readReleaseManifest(manifestPath: string): Promise<SkillReleaseManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Skill release manifest is unreadable or invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const result = SkillReleaseManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Skill release manifest is invalid: ${result.error.issues[0]?.message ?? "unknown error"}`,
    );
  }
  const digests = [
    result.data.current.sha256,
    ...result.data.predecessors.map((item) => item.sha256),
  ];
  if (new Set(digests).size !== digests.length) {
    throw new Error("Skill release manifest contains a duplicate digest.");
  }
  const predecessorVersions = result.data.predecessors.flatMap((item) => item.npm_versions);
  if (new Set(predecessorVersions).size !== predecessorVersions.length) {
    throw new Error("Skill release manifest contains a duplicate npm version provenance entry.");
  }
  return result.data;
}

export async function planBundledSkillInstallation(
  options: InstallBundledSkillOptions,
): Promise<SkillInstallationPlan> {
  const sourcePath = path.resolve(options.sourceSkillPath);
  const source = await readFile(sourcePath);
  const sourceDigest = hashBytes(source);
  const manifestPath = path.resolve(
    options.releaseManifestPath ?? path.join(path.dirname(sourcePath), "releases.json"),
  );
  const manifest = await readReleaseManifest(manifestPath);
  if (sourceDigest !== manifest.current.sha256) {
    throw new Error(
      `Skill release manifest current digest does not match source skill bytes: ${sourcePath}`,
    );
  }
  const admittedPredecessors = new Set(manifest.predecessors.map((item) => item.sha256));
  const logical = await destinations(options);
  const filesByPath = new Map<string, ManagedFilePlan>();

  for (const item of logical) {
    if (filesByPath.has(item.path)) continue;
    const snapshot = await captureManagedFileSnapshot(item.path);
    let status: InstallationStatus;
    if (!snapshot.exists) status = "installed";
    else if (snapshot.sha256 === sourceDigest) status = "unchanged";
    else if (admittedPredecessors.has(snapshot.sha256) || options.force === true)
      status = "updated";
    else throw new SkillConflictError(item.path);
    filesByPath.set(item.path, {
      path: item.path,
      snapshot,
      postimage: source,
      postimageSha256: sourceDigest,
      status,
    });
  }

  return {
    installations: logical.map((item) => ({
      ...item,
      status: filesByPath.get(item.path)!.status,
    })),
    files: [...filesByPath.values()],
  };
}

export async function applySkillInstallationPlan(
  plan: SkillInstallationPlan,
  onApplied?: (file: ManagedFilePlan) => void | Promise<void>,
  context: ManagedFileApplyContext = createManagedFileApplyContext(),
): Promise<void> {
  const authenticated: ManagedFilePlan[] = [];
  for (const file of plan.files) {
    for (const current of authenticated) {
      await verifyManagedFilePostimage(current, context);
    }
    await applyManagedFilePlan(file, context);
    authenticated.push(file);
    await onApplied?.(file);
  }
  for (const current of authenticated) {
    await verifyManagedFilePostimage(current, context);
  }
}

export async function installBundledSkill(
  options: InstallBundledSkillOptions,
): Promise<SkillInstallationResult> {
  const plan = await planBundledSkillInstallation(options);
  await applySkillInstallationPlan(plan);
  return {
    version: 1,
    status: "ok",
    skill: SKILL_NAME,
    installations: plan.installations,
    physicalWrites: plan.files
      .filter((file) => file.status !== "unchanged")
      .map((file) => ({ path: file.path, status: file.status })),
  };
}
