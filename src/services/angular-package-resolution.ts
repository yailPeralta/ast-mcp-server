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

export type RangeVerdict = "satisfied" | "unsatisfied" | "unsupported";

const MAX_COMPARATORS = 4;
const COMPARATOR = /^(>=|<)(\d+)\.(\d+)(?:\.(\d+))?$/u;
const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;

type Triple = readonly [number, number, number];

function compareTriples(left: Triple, right: Triple): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/**
 * Evaluates a plain `x.y.z` version against a space-joined list of `>=x.y[.z]` and `<x.y[.z]`
 * comparators, the only grammar the Angular peer ranges need. Anything else (`||`, `^`, `~`,
 * wildcards, prereleases, other operators) is `unsupported` so callers fail closed.
 */
export function rangeVerdict(version: string, range: string): RangeVerdict {
  const plain = PLAIN_VERSION.exec(version);
  const tokens = range.trim().split(/\s+/u);
  if (!plain || tokens.length === 0 || tokens.length > MAX_COMPARATORS) return "unsupported";
  const actual = [Number(plain[1]), Number(plain[2]), Number(plain[3])] as const;
  let satisfied = true;
  for (const token of tokens) {
    const match = COMPARATOR.exec(token);
    if (!match) return "unsupported";
    const bound = [Number(match[2]), Number(match[3]), Number(match[4] ?? 0)] as const;
    const order = compareTriples(actual, bound);
    if (match[1] === ">=" ? order < 0 : order >= 0) satisfied = false;
  }
  return satisfied ? "satisfied" : "unsatisfied";
}
