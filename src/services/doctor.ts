import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { detectInstalledAgents } from "./agent-setup.js";
import { resolveCliBatchProject, CliProjectDiscoveryError } from "./cli-project-discovery.js";
import { buildDoctorConfigContinuation } from "./doctor-continuation.js";
import { evaluateDoctor, type DoctorEvidence, type DoctorResult } from "./doctor-model.js";
import { getDiagnosticProjectStatus, type DiagnosticProjectStatusSnapshot } from "./project.js";
import { readRuntimePolicy, type RuntimePolicy } from "./runtime-policy.js";
import {
  planBundledSkillInstallation,
  resolveBundledSkillAssets,
  SkillConflictError,
  type SkillTarget,
} from "./skill-installer.js";
import {
  inspectSymbolIndexCache,
  type SymbolIndexCacheInspectResult,
} from "./symbol-index-cache.js";

type PackageEvidence = DoctorEvidence["package"];
type SetupEvidence = DoctorEvidence["setup"];
export interface DoctorDependencies {
  resolveProject(project: string | undefined, cwd: string): Promise<string>;
  projectStatus(project: string): Promise<DiagnosticProjectStatusSnapshot>;
  cache(environment: NodeJS.ProcessEnv): Promise<SymbolIndexCacheInspectResult>;
  package(executable: string): Promise<PackageEvidence>;
  setup(executable: string, cwd: string, environment: NodeJS.ProcessEnv): Promise<SetupEvidence>;
  runtime(environment: NodeJS.ProcessEnv): RuntimePolicy;
}
export interface DoctorOptions {
  project?: string;
  cwd: string;
  executable: string;
  environment?: NodeJS.ProcessEnv;
}

async function resolveProject(project: string | undefined, cwd: string): Promise<string> {
  const resolved = (await resolveCliBatchProject(
    { ...(project ? { project_root: project } : {}) },
    cwd,
  )) as Record<string, unknown>;
  return resolved.project_root as string;
}

async function inspectPackage(executable: string): Promise<PackageEvidence> {
  const cli = await realpath(executable);
  const root = path.resolve(path.dirname(cli), "..");
  const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const bins = metadata.bin as Record<string, unknown> | undefined;
  if (
    metadata.name !== "ast-mcp-server" ||
    typeof metadata.version !== "string" ||
    typeof bins?.["ast-tool"] !== "string" ||
    (await realpath(path.resolve(root, bins["ast-tool"]))) !== cli
  )
    return { state: "unsupported" };
  return { state: "ready", version: metadata.version };
}

async function inspectSetup(
  executable: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<SetupEvidence> {
  const detections = await detectInstalledAgents({ environment, commandTimeoutMs: 5000 });
  const installed = detections.filter((agent) => agent.installed);
  if (installed.length === 0) return { state: "ready" };
  if (installed.some((agent) => agent.compatibility?.status !== "compatible"))
    return { state: "outdated" };
  const assets = await resolveBundledSkillAssets(executable);
  try {
    const plan = await planBundledSkillInstallation({
      target: installed.map((agent) => agent.id) as SkillTarget[],
      scope: "user",
      sourceSkillPath: assets.skillPath,
      releaseManifestPath: assets.releasesPath,
      environment,
      ...(environment.HOME ? { homeDirectory: environment.HOME } : {}),
      workingDirectory: cwd,
    });
    if (plan.installations.every((item) => item.status === "unchanged")) return { state: "ready" };
    return {
      state: plan.installations.some((item) => item.status === "updated") ? "outdated" : "missing",
    };
  } catch (error) {
    if (error instanceof SkillConflictError) return { state: "conflict" };
    throw error;
  }
}

const defaults: DoctorDependencies = {
  resolveProject,
  projectStatus: getDiagnosticProjectStatus,
  cache: (environment) => inspectSymbolIndexCache({ environment }),
  package: inspectPackage,
  setup: inspectSetup,
  runtime: readRuntimePolicy,
};

export async function runDoctor(
  options: DoctorOptions,
  overrides: Partial<DoctorDependencies> = {},
): Promise<DoctorResult> {
  const dependencies = { ...defaults, ...overrides };
  const environment = options.environment ?? process.env;
  const policy = dependencies.runtime(environment);
  const runtimeInvalid = Object.values(policy.reasons).some(
    (reason) => reason === "invalid_integer" || reason === "out_of_range",
  );
  let config: DoctorEvidence["config"] = { state: "ready" };
  let projectRoot: string | undefined;
  try {
    projectRoot = await dependencies.resolveProject(options.project, options.cwd);
  } catch (error) {
    const discovery = error instanceof CliProjectDiscoveryError ? error : undefined;
    const state = discovery?.code.endsWith("AMBIGUOUS")
      ? "ambiguous"
      : discovery?.code.endsWith("UNSAFE")
        ? "unsafe"
        : "missing";
    config = {
      state,
      continuation: buildDoctorConfigContinuation(
        state,
        discovery?.continuation,
        options.project,
        options.cwd,
      ),
      continuation_trusted: true,
    };
  }
  let diagnostic: DiagnosticProjectStatusSnapshot | undefined;
  if (projectRoot)
    diagnostic = await dependencies.projectStatus(projectRoot).catch(() => undefined);
  const [cache, packageEvidence, setup] = await Promise.all([
    dependencies
      .cache(environment)
      .then((result) => ({ state: result.state, unsafe_entry_count: result.unsafe_entry_count }))
      .catch(() => ({ state: "failed" as const, unsafe_entry_count: 0 })),
    dependencies.package(options.executable).catch(() => ({ state: "failed" as const })),
    dependencies
      .setup(options.executable, options.cwd, environment)
      .catch(() => ({ state: "failed" as const })),
  ]);
  return evaluateDoctor({
    runtime_invalid: runtimeInvalid,
    project_authority: diagnostic?.authority ?? (projectRoot ? "failed" : "unavailable"),
    runtime_admission: diagnostic?.runtime_admission ?? "open",
    config,
    ...(diagnostic?.status ? { project: diagnostic.status } : {}),
    cache,
    package: packageEvidence,
    setup,
  });
}
