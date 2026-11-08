import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const MIN_COMPILER_MAJOR = 18;
export const MAX_COMPILER_MAJOR = 22;

/** Resolves `request` the way the project's own tooling would, or `undefined` when absent. */
export function resolveFrom(tsConfigFilePath: string, request: string): string | undefined {
  try {
    const resolved = createRequire(tsConfigFilePath).resolve(request);
    return existsSync(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** True when `packageDir` sits in a node_modules directory owned by `projectDir` or an ancestor. */
export function isUnderAncestorNodeModules(packageDir: string, projectDir: string): boolean {
  const segments = packageDir.split(path.sep);
  return segments.some(
    (segment, index) =>
      segment === "node_modules" &&
      isWithin(segments.slice(0, index).join(path.sep) || path.sep, projectDir),
  );
}

export function isSupportedVersion(version: unknown): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+.*)?$/u.exec(String(version));
  if (!match) return false;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number) as [
    number,
    number,
    number,
  ];
  const belowFloor = major === MIN_COMPILER_MAJOR && minor === 0 && patch === 0 && !!match[4];
  return major >= MIN_COMPILER_MAJOR && major <= MAX_COMPILER_MAJOR && !belowFloor;
}
