import { assertExactImpactEvidence, type CompilerImpactResult } from "./impact.js";
import type { RelationshipEdge, RelationshipEndpoint } from "./relationships.js";

export const DEFAULT_TEST_FILE_PATTERNS = Object.freeze(["**/*.test.*", "**/*.spec.*"] as const);
export const DEFAULT_TEST_DIRECTORIES = Object.freeze(["test", "tests", "__tests__"] as const);

export const TEST_CANDIDATE_REASONS = Object.freeze([
  "direct_compiler_reference",
  "transitive_compiler_reference",
  "convention_match",
] as const);
export type TestCandidateReason = (typeof TEST_CANDIDATE_REASONS)[number];

export const TEST_CANDIDATE_CONFIDENCES = Object.freeze(["exact", "high"] as const);
export type TestCandidateConfidence = (typeof TEST_CANDIDATE_CONFIDENCES)[number];

export interface TestCandidateConventions {
  readonly test_file_patterns?: readonly string[];
  readonly test_directories?: readonly string[];
}

export interface TestCandidateEvidence {
  readonly depth: number;
  readonly direct: boolean;
  readonly compiler_authoritative: true;
  readonly relationship_ids: readonly string[];
  readonly relationships: readonly RelationshipEdge[];
}

export interface TestCandidate {
  readonly file: string;
  readonly reason: TestCandidateReason;
  readonly confidence: TestCandidateConfidence;
  readonly evidence: TestCandidateEvidence;
}

export const MAX_TEST_CANDIDATE_CONVENTION_ITEMS = 32;
export const MAX_TEST_CANDIDATE_CONVENTION_LENGTH = 256;

function normalizeConventionValues(
  values: readonly string[] | undefined,
  defaults: readonly string[],
  label: string,
): readonly string[] {
  const selected = values ?? defaults;
  if (!Array.isArray(selected) || selected.length > MAX_TEST_CANDIDATE_CONVENTION_ITEMS) {
    throw new Error(
      `${label} must contain at most ${MAX_TEST_CANDIDATE_CONVENTION_ITEMS} entries.`,
    );
  }

  const normalized = selected.map((value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${label} entries must be non-empty strings.`);
    }
    if (value.length > MAX_TEST_CANDIDATE_CONVENTION_LENGTH) {
      throw new Error(
        `${label} entries must not exceed ${MAX_TEST_CANDIDATE_CONVENTION_LENGTH} characters.`,
      );
    }
    return value.trim().replaceAll("\\", "/");
  });
  return [...new Set(normalized)];
}

function assertSafePattern(pattern: string): void {
  if (
    pattern.startsWith("/") ||
    /^[A-Za-z]:\//u.test(pattern) ||
    pattern.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Test file patterns must be project-relative.");
  }
}

function assertSafeDirectory(directory: string): void {
  if (
    directory.startsWith("/") ||
    /^[A-Za-z]:\//u.test(directory) ||
    directory.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Test directories must be project-relative.");
  }
}

function normalizeConventions(conventions: TestCandidateConventions = {}): {
  readonly patterns: readonly string[];
  readonly directories: readonly string[];
} {
  if (typeof conventions !== "object" || conventions === null) {
    throw new Error("Test candidate conventions are invalid.");
  }
  const patterns = normalizeConventionValues(
    conventions.test_file_patterns,
    DEFAULT_TEST_FILE_PATTERNS,
    "test_file_patterns",
  );
  const directories = normalizeConventionValues(
    conventions.test_directories,
    DEFAULT_TEST_DIRECTORIES,
    "test_directories",
  );
  patterns.forEach(assertSafePattern);
  directories.forEach(assertSafeDirectory);
  return { patterns, directories };
}

function escapeRegexCharacter(character: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        index += 1;
        source += "(?:[^/]+/)*";
      } else {
        source += ".*";
      }
      continue;
    }
    if (character === "*") {
      source += "[^/]*";
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegexCharacter(character);
  }
  return new RegExp(`${source}$`, "u");
}

function matchesFilePattern(file: string, pattern: string): boolean {
  const matcher = globToRegExp(pattern);
  const basename = file.slice(file.lastIndexOf("/") + 1);
  return matcher.test(file) || matcher.test(basename);
}

function pathContainsDirectory(file: string, directory: string): boolean {
  const fileSegments = file.split("/");
  const directorySegments = directory.split("/").filter(Boolean);
  if (directorySegments.length === 0) return false;
  return fileSegments.some((_, index) =>
    directorySegments.every((segment, offset) => fileSegments[index + offset] === segment),
  );
}

function isProjectRelativeFile(file: string): boolean {
  return (
    file.length > 0 &&
    !file.startsWith("/") &&
    !/^[A-Za-z]:[\\/]/u.test(file) &&
    !file.split("/").some((segment) => segment === ".." || segment.length === 0)
  );
}

function isTestFile(
  file: string,
  conventions: { readonly patterns: readonly string[]; readonly directories: readonly string[] },
): boolean {
  if (!isProjectRelativeFile(file)) return false;
  return (
    conventions.patterns.some((pattern) => matchesFilePattern(file, pattern)) ||
    conventions.directories.some((directory) => pathContainsDirectory(file, directory))
  );
}

function endpointKey(endpoint: RelationshipEndpoint): string {
  return `${endpoint.file}\u0000${endpoint.symbol_path}\u0000${endpoint.selector}`;
}

function edgeOrder(left: RelationshipEdge, right: RelationshipEdge): number {
  return (
    left.relationship_id.localeCompare(right.relationship_id) ||
    left.source.file.localeCompare(right.source.file) ||
    left.source.selector.localeCompare(right.source.selector) ||
    left.target.file.localeCompare(right.target.file) ||
    left.target.selector.localeCompare(right.target.selector)
  );
}

function candidateReason(file: string, depth: number): TestCandidateReason {
  if (
    !isTestFile(file, {
      patterns: DEFAULT_TEST_FILE_PATTERNS,
      directories: DEFAULT_TEST_DIRECTORIES,
    })
  ) {
    return "convention_match";
  }
  return depth === 1 ? "direct_compiler_reference" : "transitive_compiler_reference";
}

function candidateConfidence(depth: number): TestCandidateConfidence {
  return depth === 1 ? "exact" : "high";
}

interface CandidateAccumulator {
  depth: number;
  readonly endpointKeys: Set<string>;
}

interface PathStep {
  readonly edge: RelationshipEdge;
  readonly nextKey: string;
}

function findPathToRoot(
  startKeys: readonly string[],
  rootKey: string,
  edges: readonly RelationshipEdge[],
): readonly RelationshipEdge[] | null {
  const queue: Array<{ readonly key: string; readonly path: readonly RelationshipEdge[] }> = [
    ...startKeys,
  ]
    .sort()
    .map((key) => ({ key, path: [] }));
  const visited = new Set(startKeys);
  const orderedEdges = [...edges].sort(edgeOrder);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.key === rootKey && current.path.length > 0) return current.path;

    const steps: PathStep[] = [];
    for (const edge of orderedEdges) {
      const sourceKey = endpointKey(edge.source);
      const targetKey = endpointKey(edge.target);
      if (sourceKey === current.key) steps.push({ edge, nextKey: targetKey });
      if (targetKey === current.key) steps.push({ edge, nextKey: sourceKey });
    }
    steps.sort(
      (left, right) =>
        edgeOrder(left.edge, right.edge) || left.nextKey.localeCompare(right.nextKey),
    );
    for (const step of steps) {
      if (visited.has(step.nextKey)) continue;
      visited.add(step.nextKey);
      queue.push({ key: step.nextKey, path: [...current.path, step.edge] });
    }
  }
  return null;
}

export function findTestCandidates(
  impact: CompilerImpactResult,
  conventions: TestCandidateConventions = {},
): readonly TestCandidate[] {
  assertExactImpactEvidence(impact);
  if (
    typeof impact.root !== "object" ||
    impact.root === null ||
    !Array.isArray(impact.nodes) ||
    !impact.nodes.every((node) => typeof node === "object" && node !== null)
  ) {
    throw new Error("Impact nodes are invalid.");
  }

  const normalized = normalizeConventions(conventions);
  const nodesByEndpoint = new Map(impact.nodes.map((node) => [endpointKey(node.endpoint), node]));
  const rootFile = impact.root.file;
  const rootKey = endpointKey(impact.root);
  const candidatesByFile = new Map<string, CandidateAccumulator>();

  for (const node of impact.nodes) {
    const file = node.endpoint.file;
    if (file === rootFile || !isTestFile(file, normalized)) continue;
    const candidate = candidatesByFile.get(file);
    if (candidate) {
      candidate.depth = Math.min(candidate.depth, node.depth);
      candidate.endpointKeys.add(endpointKey(node.endpoint));
    } else {
      candidatesByFile.set(file, {
        depth: node.depth,
        endpointKeys: new Set([endpointKey(node.endpoint)]),
      });
    }
  }

  for (const edge of impact.edges) {
    const sourceNode = nodesByEndpoint.get(endpointKey(edge.source));
    const targetNode = nodesByEndpoint.get(endpointKey(edge.target));
    if (!sourceNode || !targetNode) {
      throw new Error("Impact edge does not have matching bounded nodes.");
    }
  }

  return [...candidatesByFile.entries()]
    .map(([file, candidate]) => {
      const relationships = findPathToRoot([...candidate.endpointKeys], rootKey, impact.edges);
      if (!relationships) {
        throw new Error(`Test candidate "${file}" has no exact impact path to the root.`);
      }
      const depth = candidate.depth;
      return {
        file,
        reason: candidateReason(file, depth),
        confidence: candidateConfidence(depth),
        evidence: {
          depth,
          direct: depth === 1,
          compiler_authoritative: true,
          relationship_ids: relationships.map((edge) => edge.relationship_id),
          relationships,
        },
      } satisfies TestCandidate;
    })
    .sort(
      (left, right) =>
        left.evidence.depth - right.evidence.depth || left.file.localeCompare(right.file),
    );
}
