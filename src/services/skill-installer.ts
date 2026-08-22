import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  canonicalizeFuturePath,
  createManagedFileApplyContext,
  type ManagedFileApplyContext,
  type ManagedFileApplyHooks,
  type ManagedFilePlan,
  type ManagedFileStatus,
} from "./managed-file.js";
import {
  applyManagedBundle,
  ManagedBundleConflictError,
  planManagedBundle,
} from "./managed-bundle.js";

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
const SkillFileSchema = z
  .object({ path: z.string().min(1), sha256: z.string().regex(SHA256_PATTERN) })
  .strict();
const BundleReleaseSchema = z
  .object({
    version: z.string().min(1),
    files: z.array(SkillFileSchema).min(1),
  })
  .strict();
const BundleSkillReleaseManifestSchema = z
  .object({
    schema_version: z.literal(2),
    algorithm: z.literal("sha256"),
    current: BundleReleaseSchema,
    predecessors: z.array(
      z.union([
        ReleaseRecordSchema,
        BundleReleaseSchema.extend({ npm_versions: z.array(z.string().min(1)).min(1) }),
      ]),
    ),
  })
  .strict();
type SkillFile = z.infer<typeof SkillFileSchema>;
interface SkillReleaseManifest {
  current: { version: string; files: SkillFile[] };
  predecessors: Array<{ version: string; files: SkillFile[]; npm_versions: string[] }>;
}

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
  const result = BundleSkillReleaseManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Skill release manifest is invalid: ${result.error.issues[0]?.message ?? "unknown error"}`,
    );
  }
  const manifest: SkillReleaseManifest = {
    current: result.data.current,
    predecessors: result.data.predecessors.map((item) =>
      "files" in item
        ? item
        : {
            version: item.version,
            npm_versions: item.npm_versions,
            files: [{ path: "SKILL.md", sha256: item.sha256 }],
          },
    ),
  };
  if (!manifest.current.files.some((file) => file.path === "SKILL.md")) {
    throw new Error("Skill release manifest current bundle must include SKILL.md.");
  }
  const predecessorVersions = result.data.predecessors.flatMap((item) => item.npm_versions);
  if (new Set(predecessorVersions).size !== predecessorVersions.length) {
    throw new Error("Skill release manifest contains a duplicate npm version provenance entry.");
  }
  return manifest;
}

export async function planBundledSkillInstallation(
  options: InstallBundledSkillOptions,
): Promise<SkillInstallationPlan> {
  const sourcePath = path.resolve(options.sourceSkillPath);
  const sourceRoot = path.dirname(sourcePath);
  const canonicalSourceRoot = await realpath(sourceRoot);
  const manifestPath = path.resolve(
    options.releaseManifestPath ?? path.join(sourceRoot, "releases.json"),
  );
  const manifest = await readReleaseManifest(manifestPath);
  const sources = [];
  for (const file of manifest.current.files) {
    const assetPath = path.resolve(sourceRoot, file.path);
    const assetRealPath = await realpath(assetPath).catch(() => undefined);
    if (
      assetRealPath === undefined ||
      (assetRealPath !== canonicalSourceRoot &&
        !assetRealPath.startsWith(`${canonicalSourceRoot}${path.sep}`)) ||
      !(await stat(assetPath)).isFile()
    ) {
      throw new Error(
        `Skill release manifest asset is missing or escapes the bundle: ${file.path}`,
      );
    }
    sources.push({ ...file, content: await readFile(assetPath) });
  }
  const logical = await destinations(options);
  const filesByPath = new Map<string, ManagedFilePlan>();
  const statusesByRoot = new Map<string, InstallationStatus>();

  for (const item of logical) {
    const destinationRoot = path.dirname(item.path);
    if (statusesByRoot.has(destinationRoot)) continue;
    let plan;
    try {
      plan = await planManagedBundle({
        destinationRoot,
        current: { files: sources },
        predecessors: manifest.predecessors,
        force: options.force,
      });
    } catch (error) {
      if (error instanceof ManagedBundleConflictError)
        throw new SkillConflictError(error.destination);
      if (error instanceof Error && error.message.startsWith("Managed bundle")) {
        throw new Error(error.message.replace("Managed bundle", "Skill release manifest"), {
          cause: error,
        });
      }
      throw error;
    }
    statusesByRoot.set(destinationRoot, plan.status);
    for (const file of plan.files) filesByPath.set(file.path, file);
  }

  return {
    installations: logical.map((item) => ({
      ...item,
      status: statusesByRoot.get(path.dirname(item.path))!,
    })),
    files: [...filesByPath.values()],
  };
}

export async function applySkillInstallationPlan(
  plan: SkillInstallationPlan,
  onApplied?: (file: ManagedFilePlan) => void | Promise<void>,
  context: ManagedFileApplyContext = createManagedFileApplyContext(),
  hooks: ManagedFileApplyHooks = {},
): Promise<void> {
  await applyManagedBundle(plan, onApplied, context, hooks);
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
