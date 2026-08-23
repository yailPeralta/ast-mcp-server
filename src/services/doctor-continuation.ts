import { existsSync } from "node:fs";
import path from "node:path";

export type DoctorConfigState = "ready" | "missing" | "ambiguous" | "unsafe";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function relativeArgument(project: string | undefined, cwd: string): string {
  const requested = project ?? ".";
  if (/[\0\r\n]/u.test(requested)) return ".";
  const relative =
    path.relative(cwd, path.resolve(cwd, requested)).split(path.sep).join("/") || ".";
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function ambiguousArgument(project: string | undefined, cwd: string): string {
  let directory = path.resolve(cwd, project ?? ".");
  while (true) {
    const candidate = path.join(directory, "tsconfig.json");
    if (existsSync(candidate) && existsSync(path.join(directory, "jsconfig.json")))
      return relativeArgument(candidate, cwd);
    if (existsSync(path.join(directory, ".git"))) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return relativeArgument(path.join(project ?? ".", "tsconfig.json"), cwd);
}

export function buildDoctorConfigContinuation(
  state: DoctorConfigState,
  discoveryContinuation: string | undefined,
  project: string | undefined,
  cwd: string,
): string {
  void discoveryContinuation;
  const requested =
    state === "ambiguous" ? ambiguousArgument(project, cwd) : relativeArgument(project, cwd);
  const command = `ast-tool doctor --project ${shellQuote(requested)}`;
  if (state === "ambiguous") return `Run: ${command}`;
  return state === "unsafe"
    ? `Replace the requested project location with a direct config, then run: ${command}`
    : `Create the requested project location and a supported config, then run: ${command}`;
}
