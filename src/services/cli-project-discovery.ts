import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

type DiscoveryCode =
  "PROJECT_CONFIG_AMBIGUOUS" | "PROJECT_CONFIG_NOT_FOUND" | "PROJECT_CONFIG_UNSAFE";

const EXPLICIT = "Set project_root to a direct config file.";

export class CliProjectDiscoveryError extends Error {
  constructor(
    readonly code: DiscoveryCode,
    message: string,
    readonly continuation: string,
  ) {
    super(message);
    this.name = "CliProjectDiscoveryError";
  }
}

function fail(code: DiscoveryCode, message: string, continuation: string): never {
  throw new CliProjectDiscoveryError(code, message, continuation);
}

function same(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function directPath(value: string): Promise<{ path: string; file: boolean }> {
  let info;
  try {
    info = await lstat(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      fail(
        "PROJECT_CONFIG_UNSAFE",
        "The requested CLI project location could not be inspected safely.",
        EXPLICIT,
      );
    fail(
      "PROJECT_CONFIG_NOT_FOUND",
      "The requested CLI project location does not exist.",
      "Set project_root to an existing config file.",
    );
  }
  if (info.isSymbolicLink())
    fail("PROJECT_CONFIG_UNSAFE", "Symlinked CLI project locations are unsupported.", EXPLICIT);
  const canonical = await realpath(value).catch(() =>
    fail("PROJECT_CONFIG_UNSAFE", "CLI project identity could not be proven.", EXPLICIT),
  );
  if (!same(value, canonical))
    fail("PROJECT_CONFIG_UNSAFE", "Symlinked CLI project ancestors are unsupported.", EXPLICIT);
  return { path: canonical, file: info.isFile() };
}

async function configAt(directory: string, name: string): Promise<string | undefined> {
  const candidate = path.join(directory, name);
  try {
    const direct = await directPath(candidate);
    return direct.file ? direct.path : undefined;
  } catch (error) {
    if (error instanceof CliProjectDiscoveryError && error.code === "PROJECT_CONFIG_NOT_FOUND")
      return;
    throw error;
  }
}

async function hasGitBoundary(directory: string): Promise<boolean> {
  return lstat(path.join(directory, ".git")).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      fail(
        "PROJECT_CONFIG_UNSAFE",
        "The repository boundary could not be inspected safely.",
        EXPLICIT,
      );
    },
  );
}

function relativeConfig(from: string, config: string): string {
  const relative = path.relative(from, config).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

async function discover(start: string, relativeTo: string): Promise<string> {
  const visited = new Set<string>();
  let directory = start;
  while (!visited.has(directory)) {
    visited.add(directory);
    const [tsconfig, jsconfig] = await Promise.all([
      configAt(directory, "tsconfig.json"),
      configAt(directory, "jsconfig.json"),
    ]);
    if (tsconfig && jsconfig)
      fail(
        "PROJECT_CONFIG_AMBIGUOUS",
        "Both supported project configs exist at the nearest CLI project level.",
        `Set project_root to "${relativeConfig(relativeTo, tsconfig)}" or "${relativeConfig(relativeTo, jsconfig)}".`,
      );
    if (tsconfig || jsconfig) return tsconfig ?? jsconfig!;
    if (await hasGitBoundary(directory)) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  fail(
    "PROJECT_CONFIG_NOT_FOUND",
    "No supported project config was found within the CLI discovery boundary.",
    "Set project_root to a config file.",
  );
}

export async function resolveCliBatchProject(input: unknown, cwd: string): Promise<unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const document = input as Record<string, unknown>;
  const requested = document.project_root;
  if (requested !== undefined && typeof requested !== "string") return input;
  const absolute = path.resolve(cwd, requested ?? cwd);
  const direct = await directPath(absolute);
  const projectRoot = direct.file
    ? absolute.endsWith(".json")
      ? direct.path
      : fail(
          "PROJECT_CONFIG_NOT_FOUND",
          "The explicit CLI project file is not a JSON config.",
          "Set project_root to a config file.",
        )
    : await discover(direct.path, cwd);
  return { ...document, project_root: projectRoot };
}
