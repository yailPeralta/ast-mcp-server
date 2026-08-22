import path from "node:path";

const PACKAGE = "ast-mcp-server";
const CONTINUATION =
  "After reinstalling through its owning toolchain, run: ast-tool upgrade --check";

interface PackageRecord {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
}
export type UpgradeProvenance = "npm" | "volta";
export interface UpgradeRuntime {
  packageRoot: string;
  cliExecutable: string;
  nodeExecutable: string;
  npmCliExecutable?: string;
  voltaExecutable?: string;
  platform: NodeJS.Platform;
  realpath(path: string): Promise<string>;
  directDirectory(path: string): Promise<boolean>;
  readPackage(packageRoot: string): Promise<PackageRecord>;
  latestVersion(provenance: UpgradeProvenance): Promise<string>;
  run(executable: string, args: readonly string[]): Promise<string>;
}
export interface UpgradeInspection {
  version: 1;
  status: "ok";
  current_version: string;
  latest_version: string;
  provenance: UpgradeProvenance;
  update_available: boolean;
  action: "ast-tool upgrade";
  restart_required: boolean;
}
export interface UpgradePlan extends UpgradeInspection {
  package_root: string;
  cli_executable: string;
  install_executable: string;
  install_args: string[];
}

type UpgradeErrorCode = "UPGRADE_PROVENANCE_UNSUPPORTED" | "UPGRADE_INSPECTION_FAILED";
export class UpgradeError extends Error {
  constructor(
    readonly code: UpgradeErrorCode,
    message: string,
    readonly continuation = CONTINUATION,
  ) {
    super(message);
    this.name = "UpgradeError";
  }
}

function fail(code: UpgradeErrorCode, message: string): never {
  throw new UpgradeError(code, message);
}
function paths(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix;
}
function same(a: string, b: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function inside(root: string, target: string, platform: NodeJS.Platform): boolean {
  const p = paths(platform);
  const relative = p.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${p.sep}`) && !p.isAbsolute(relative);
}
async function canonical(runtime: UpgradeRuntime, value: string): Promise<string> {
  return runtime
    .realpath(value)
    .catch(() => fail("UPGRADE_PROVENANCE_UNSUPPORTED", "Package ownership could not be proven."));
}

function packageFields(record: PackageRecord, platform: NodeJS.Platform) {
  const bins = record.bin as Record<string, unknown> | null;
  if (
    record.name !== PACKAGE ||
    typeof record.version !== "string" ||
    !record.version ||
    !bins ||
    typeof bins["ast-tool"] !== "string" ||
    typeof bins["ast-mcp-server"] !== "string"
  ) {
    fail("UPGRADE_PROVENANCE_UNSUPPORTED", "Package identity or bins are unsupported.");
  }
  const p = paths(platform);
  for (const value of [bins["ast-tool"], bins["ast-mcp-server"]] as string[]) {
    if (p.isAbsolute(value) || p.normalize(value).startsWith(`..${p.sep}`)) {
      fail("UPGRADE_PROVENANCE_UNSUPPORTED", "Package executable location is unsafe.");
    }
  }
  return { version: record.version, cli: bins["ast-tool"], server: bins["ast-mcp-server"] };
}
async function readPackage(runtime: UpgradeRuntime, root: string) {
  try {
    return packageFields(await runtime.readPackage(root), runtime.platform);
  } catch (error) {
    if (error instanceof UpgradeError) throw error;
    fail("UPGRADE_PROVENANCE_UNSUPPORTED", "Package metadata could not be verified.");
  }
}

interface Proof {
  kind: UpgradeProvenance;
  executable: string;
  args: string[];
}
async function proveNpm(runtime: UpgradeRuntime, packageRoot: string): Promise<Proof | undefined> {
  if (!runtime.npmCliExecutable) return;
  const p = paths(runtime.platform);
  try {
    const node = await canonical(runtime, runtime.nodeExecutable);
    const npmCli = await canonical(runtime, runtime.npmCliExecutable);
    const toolchainRoot =
      runtime.platform === "win32" ? p.dirname(node) : p.resolve(p.dirname(node), "..");
    if (
      p.basename(npmCli).toLowerCase() !== "npm-cli.js" ||
      !inside(toolchainRoot, npmCli, runtime.platform)
    )
      return;
    const [rootText, prefixText] = await Promise.all([
      runtime.run(node, [npmCli, "root", "--global"]),
      runtime.run(node, [npmCli, "prefix", "--global"]),
    ]);
    const lexicalRoot = p.resolve(rootText.trim());
    const lexicalPackage = p.join(lexicalRoot, PACKAGE);
    if (!p.isAbsolute(rootText.trim()) || !(await runtime.directDirectory(lexicalPackage))) return;
    const root = await canonical(runtime, lexicalRoot);
    const prefix = await canonical(runtime, prefixText.trim());
    const expectedRoot = await canonical(
      runtime,
      runtime.platform === "win32"
        ? p.join(prefix, "node_modules")
        : p.join(prefix, "lib", "node_modules"),
    );
    const expectedPackage = await canonical(runtime, lexicalPackage);
    if (
      !same(root, expectedRoot, runtime.platform) ||
      !same(expectedPackage, packageRoot, runtime.platform)
    )
      return;
    return {
      kind: "npm",
      executable: node,
      args: [npmCli, "install", "--global", `${PACKAGE}@latest`, "--ignore-scripts"],
    };
  } catch {
    return;
  }
}

async function proveVolta(runtime: UpgradeRuntime): Promise<Proof | undefined> {
  if (!runtime.voltaExecutable) return;
  try {
    const [tool, node] = await Promise.all([
      runtime.run(runtime.voltaExecutable, ["which", "ast-tool"]),
      runtime.run(runtime.voltaExecutable, ["which", "node"]),
    ]);
    if (
      !same(
        await canonical(runtime, tool.trim()),
        await canonical(runtime, runtime.cliExecutable),
        runtime.platform,
      ) ||
      !same(
        await canonical(runtime, node.trim()),
        await canonical(runtime, runtime.nodeExecutable),
        runtime.platform,
      )
    )
      return;
    return {
      kind: "volta",
      executable: runtime.voltaExecutable,
      args: ["install", `${PACKAGE}@latest`],
    };
  } catch {
    return;
  }
}

function versionParts(value: string): [number, number, number, string] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  return match ? [+match[1]!, +match[2]!, +match[3]!, match[4] ?? ""] : undefined;
}
function updateAvailable(current: string, latest: string): boolean {
  const left = versionParts(current);
  const right = versionParts(latest);
  if (!left || !right) fail("UPGRADE_INSPECTION_FAILED", "Package version is invalid.");
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index]! < right[index]!;
  }
  if (!left[3] || !right[3]) return Boolean(left[3]);
  return left[3].localeCompare(right[3], "en", { numeric: true }) < 0;
}

export async function planUpgrade(runtime: UpgradeRuntime): Promise<UpgradePlan> {
  const p = paths(runtime.platform);
  const root = await canonical(runtime, runtime.packageRoot);
  const current = await readPackage(runtime, root);
  const cli = await canonical(runtime, p.resolve(root, current.cli));
  if (
    !inside(root, cli, runtime.platform) ||
    !same(cli, await canonical(runtime, runtime.cliExecutable), runtime.platform)
  ) {
    fail("UPGRADE_PROVENANCE_UNSUPPORTED", "The running CLI does not belong to this package.");
  }
  const proofs = (await Promise.all([proveNpm(runtime, root), proveVolta(runtime)])).filter(
    (proof): proof is Proof => proof !== undefined,
  );
  if (proofs.length !== 1)
    fail("UPGRADE_PROVENANCE_UNSUPPORTED", "Package ownership is ambiguous or unsupported.");
  const proof = proofs[0]!;
  let latest: string;
  try {
    latest = await runtime.latestVersion(proof.kind);
  } catch {
    fail("UPGRADE_INSPECTION_FAILED", "Latest package version could not be verified.");
  }
  const update = updateAvailable(current.version, latest);
  return {
    version: 1,
    status: "ok",
    current_version: current.version,
    latest_version: latest,
    provenance: proof.kind,
    update_available: update,
    action: "ast-tool upgrade",
    restart_required: update,
    package_root: root,
    cli_executable: cli,
    install_executable: proof.executable,
    install_args: proof.args,
  };
}

export async function inspectUpgrade(runtime: UpgradeRuntime): Promise<UpgradeInspection> {
  const plan = await planUpgrade(runtime);
  return {
    version: plan.version,
    status: plan.status,
    current_version: plan.current_version,
    latest_version: plan.latest_version,
    provenance: plan.provenance,
    update_available: plan.update_available,
    action: plan.action,
    restart_required: plan.restart_required,
  };
}
