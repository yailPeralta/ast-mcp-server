import path from "node:path";
import { type Node, type Project } from "ts-morph";
import {
  createTruncationMetadata,
  createSourceLocation,
  type FreshnessMetadata,
  type TruncationMetadata,
  type TruncationReason,
} from "./read-contracts.js";
import { getSourceFileOrThrow } from "./project.js";
import { findLocatedDeclaration } from "./symbols.js";
import { NO_REQUEST_CONTEXT, type RequestContext } from "./request-context.js";
import {
  aggregateRelationshipCoverage,
  CompilerImpactWorkTracker,
  createCompilerRelationshipResolver,
  RELATIONSHIP_EDGE_KINDS,
  type CompilerImpactWork,
  type RelationshipCoverageEntry,
  type RelationshipEdge,
  type RelationshipEdgeKind,
  type RelationshipEndpoint,
} from "./relationships.js";

export const IMPACT_DIRECTIONS = Object.freeze(["incoming", "outgoing", "both"] as const);
export type ImpactDirection = (typeof IMPACT_DIRECTIONS)[number];

export const DEFAULT_IMPACT_MAX_DEPTH = 3;
export const DEFAULT_IMPACT_MAX_NODES = 100;
export const DEFAULT_IMPACT_MAX_EDGES = 200;
export const MAX_IMPACT_DEPTH = 32;
export const MAX_IMPACT_NODES = 1_000;
export const MAX_IMPACT_EDGES = 5_000;

export interface ImpactRootRequest {
  readonly file_path: string;
  readonly symbol_path: string;
}

export interface ImpactTraversalOptions {
  readonly direction?: ImpactDirection;
  readonly max_depth?: number;
  readonly max_nodes?: number;
  readonly max_edges?: number;
  readonly relationship_kinds?: readonly RelationshipEdgeKind[];
}

export interface ImpactNode {
  readonly endpoint: RelationshipEndpoint;
  readonly depth: number;
  readonly direct: boolean;
}

export interface ImpactResult {
  readonly root: RelationshipEndpoint;
  readonly direction: ImpactDirection;
  readonly relationship_kinds: readonly RelationshipEdgeKind[];
  readonly nodes: readonly ImpactNode[];
  readonly edges: readonly RelationshipEdge[];
  readonly visited_nodes: number;
  readonly visited_edges: number;
  readonly max_depth_reached: number;
  readonly max_depth: number;
  readonly max_nodes: number;
  readonly max_edges: number;
  readonly incomplete: boolean;
  readonly truncation: TruncationMetadata;
  readonly truncation_reasons: readonly TruncationReason[];
}

export interface CompilerImpactResult extends ImpactResult {
  readonly coverage: readonly RelationshipCoverageEntry[];
  readonly work: CompilerImpactWork;
}
interface NormalizedImpactOptions {
  readonly direction: ImpactDirection;
  readonly max_depth: number;
  readonly max_nodes: number;
  readonly max_edges: number;
  readonly relationship_kinds: readonly RelationshipEdgeKind[];
}

interface Neighbor {
  readonly edge: RelationshipEdge;
  readonly endpoint: RelationshipEndpoint;
}

export function isExactImpactEdge(edge: RelationshipEdge): boolean {
  return (
    typeof edge === "object" &&
    edge !== null &&
    edge.provenance === "compiler" &&
    edge.confidence === "exact" &&
    edge.resolution === "resolved" &&
    edge.compiler_authoritative === true &&
    typeof edge.freshness === "object" &&
    edge.freshness !== null &&
    edge.freshness.state === "fresh" &&
    Array.isArray(edge.freshness.causes) &&
    edge.freshness.causes.length === 0
  );
}

export function assertExactImpactEvidence(
  impact: Pick<ImpactResult, "incomplete" | "edges">,
): void {
  if (typeof impact !== "object" || impact === null || !Array.isArray(impact.edges)) {
    throw new Error("Impact evidence is invalid.");
  }
  if (impact.incomplete) {
    throw new Error("Test candidates require complete impact evidence.");
  }
  if (!impact.edges.every(isExactImpactEdge)) {
    throw new Error("Test candidates require fresh exact compiler impact evidence.");
  }
}

interface QueuedNode {
  readonly key: string;
  readonly endpoint: RelationshipEndpoint;
  readonly depth: number;
}

const IMPACT_PROBE_WORK_ITEMS = 1_024;
const IMPACT_RELATIONSHIP_WORK_ITEMS = 100_000;

function assertIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function assertDirection(value: unknown): ImpactDirection {
  if (!IMPACT_DIRECTIONS.includes(value as ImpactDirection)) {
    throw new Error("Impact direction is invalid.");
  }
  return value as ImpactDirection;
}

function normalizeRelationshipKinds(
  kinds: readonly RelationshipEdgeKind[] | undefined,
): readonly RelationshipEdgeKind[] {
  if (kinds === undefined) return [...RELATIONSHIP_EDGE_KINDS];
  if (!Array.isArray(kinds)) throw new Error("Impact relationship_kinds must be an array.");
  const unique = new Set<RelationshipEdgeKind>();
  for (const kind of kinds) {
    if (!RELATIONSHIP_EDGE_KINDS.includes(kind)) {
      throw new Error("Impact relationship kind is invalid.");
    }
    unique.add(kind);
  }
  return [...unique].sort(
    (left, right) => RELATIONSHIP_EDGE_KINDS.indexOf(left) - RELATIONSHIP_EDGE_KINDS.indexOf(right),
  );
}

function normalizeOptions(options: ImpactTraversalOptions = {}): NormalizedImpactOptions {
  if (typeof options !== "object" || options === null) {
    throw new Error("Impact traversal options are invalid.");
  }
  return {
    direction: assertDirection(options.direction ?? "both"),
    max_depth: assertIntegerInRange(
      options.max_depth ?? DEFAULT_IMPACT_MAX_DEPTH,
      0,
      MAX_IMPACT_DEPTH,
      "Impact max_depth",
    ),
    max_nodes: assertIntegerInRange(
      options.max_nodes ?? DEFAULT_IMPACT_MAX_NODES,
      1,
      MAX_IMPACT_NODES,
      "Impact max_nodes",
    ),
    max_edges: assertIntegerInRange(
      options.max_edges ?? DEFAULT_IMPACT_MAX_EDGES,
      1,
      MAX_IMPACT_EDGES,
      "Impact max_edges",
    ),
    relationship_kinds: normalizeRelationshipKinds(options.relationship_kinds),
  };
}

function projectRelativeFile(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function nodeRange(node: Node): {
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
} {
  const sourceFile = node.getSourceFile();
  const start = sourceFile.getLineAndColumnAtPos(node.getStart());
  const end = sourceFile.getLineAndColumnAtPos(Math.max(node.getStart(), node.getEnd() - 1));
  return {
    start_line: start.line,
    start_column: start.column,
    end_line: end.line,
    end_column: end.column,
  };
}

export function resolveImpactRoot(
  project: Project,
  projectRoot: string,
  request: ImpactRootRequest,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): RelationshipEndpoint {
  requestContext.checkpoint();
  if (
    typeof request !== "object" ||
    request === null ||
    typeof request.file_path !== "string" ||
    typeof request.symbol_path !== "string"
  ) {
    throw new Error("Impact root is invalid.");
  }
  const sourceFile = getSourceFileOrThrow(project, request.file_path);
  const located = findLocatedDeclaration(sourceFile, request.symbol_path, () =>
    requestContext.checkpoint(),
  );
  const node = located.node;
  const location = createSourceLocation(
    projectRelativeFile(projectRoot, sourceFile.getFilePath()),
    nodeRange(node),
  );
  const { file, ...range } = location;
  return Object.freeze({
    file,
    symbol_path: located.symbolPath,
    selector: `${located.symbolPath}@${located.line}`,
    range,
  });
}

function endpointKey(endpoint: RelationshipEndpoint): string {
  return `${endpoint.file}\u0000${endpoint.symbol_path}\u0000${endpoint.selector}`;
}

function edgeOrder(left: RelationshipEdge, right: RelationshipEdge): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.source.file.localeCompare(right.source.file) ||
    left.source.selector.localeCompare(right.source.selector) ||
    left.target.file.localeCompare(right.target.file) ||
    left.target.selector.localeCompare(right.target.selector) ||
    left.relationship_id.localeCompare(right.relationship_id)
  );
}

function neighborOrder(left: Neighbor, right: Neighbor): number {
  return (
    left.endpoint.file.localeCompare(right.endpoint.file) ||
    left.endpoint.selector.localeCompare(right.endpoint.selector) ||
    left.endpoint.symbol_path.localeCompare(right.endpoint.symbol_path) ||
    edgeOrder(left.edge, right.edge)
  );
}

function collectNeighbors(
  current: RelationshipEndpoint,
  edges: readonly RelationshipEdge[],
  options: NormalizedImpactOptions,
  requestContext: RequestContext,
): Neighbor[] {
  const currentKey = endpointKey(current);
  const kinds = new Set(options.relationship_kinds);
  const neighbors = new Map<string, Neighbor>();
  const orderedEdges = [...edges].sort(edgeOrder);

  for (const edge of orderedEdges) {
    requestContext.checkpoint();
    if (!kinds.has(edge.kind)) continue;
    const matchesSource = endpointKey(edge.source) === currentKey;
    const matchesTarget = endpointKey(edge.target) === currentKey;
    if ((options.direction === "outgoing" || options.direction === "both") && matchesSource) {
      neighbors.set(`${edge.relationship_id}\u0000${endpointKey(edge.target)}`, {
        edge,
        endpoint: edge.target,
      });
    }
    if ((options.direction === "incoming" || options.direction === "both") && matchesTarget) {
      neighbors.set(`${edge.relationship_id}\u0000${endpointKey(edge.source)}`, {
        edge,
        endpoint: edge.source,
      });
    }
  }

  return [...neighbors.values()].sort(neighborOrder);
}

type NeighborProvider = (
  current: RelationshipEndpoint,
  options: NormalizedImpactOptions,
  requestContext: RequestContext,
  maxEdges: number,
  stopAfterFirst: boolean,
  allowedNeighborKeys?: ReadonlySet<string>,
  excludedRelationshipIds?: ReadonlySet<string>,
  maxWorkItems?: number,
) => {
  readonly neighbors: readonly Neighbor[];
  readonly incomplete: boolean;
  readonly excludedNeighbors: boolean;
  readonly workLimitReached: boolean;
};

function traverseWithNeighborProvider(
  root: RelationshipEndpoint,
  neighborsFor: NeighborProvider,
  options: ImpactTraversalOptions = {},
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): ImpactResult {
  requestContext.checkpoint();
  if (typeof root !== "object" || root === null) {
    throw new Error("Impact traversal input is invalid.");
  }
  const normalized = normalizeOptions(options);
  const nodes = new Map<string, ImpactNode>([
    [endpointKey(root), { endpoint: root, depth: 0, direct: false }],
  ]);
  const selectedEdges = new Map<string, RelationshipEdge>();
  const queue: QueuedNode[] = [{ key: endpointKey(root), endpoint: root, depth: 0 }];
  const truncationReasons = new Set<TruncationReason>();
  let maxDepthReached = 0;
  const classifyObservedNeighbor = (
    current: QueuedNode,
    neighbor: Neighbor,
    edgeBlocked: boolean,
  ): void => {
    const nextKey = endpointKey(neighbor.endpoint);
    const isKnownNode = nodes.has(nextKey);
    if (edgeBlocked) truncationReasons.add("edge_limit");
    if (!isKnownNode && current.depth + 1 > normalized.max_depth) {
      truncationReasons.add("depth_limit");
    }
    if (!isKnownNode && nodes.size >= normalized.max_nodes) {
      truncationReasons.add("record_limit");
    }
  };

  while (queue.length > 0) {
    requestContext.checkpoint();
    const current = queue.shift()!;
    const remainingEdges = normalized.max_edges - selectedEdges.size;
    if (remainingEdges <= 0) {
      const probe = neighborsFor(
        current.endpoint,
        normalized,
        requestContext,
        1,
        true,
        undefined,
        new Set(selectedEdges.keys()),
        IMPACT_PROBE_WORK_ITEMS,
      );
      for (const neighbor of probe.neighbors) {
        classifyObservedNeighbor(current, neighbor, true);
      }
      if (probe.workLimitReached) truncationReasons.add("work_limit");
      if (probe.incomplete && !probe.workLimitReached) truncationReasons.add("edge_limit");
      continue;
    }

    const restrictionReason: TruncationReason | undefined =
      current.depth >= normalized.max_depth
        ? "depth_limit"
        : nodes.size >= normalized.max_nodes
          ? "record_limit"
          : undefined;
    const allowedNeighborKeys = restrictionReason ? new Set(nodes.keys()) : undefined;
    const batch = neighborsFor(
      current.endpoint,
      normalized,
      requestContext,
      remainingEdges,
      false,
      allowedNeighborKeys,
      new Set(selectedEdges.keys()),
    );
    if (batch.excludedNeighbors && restrictionReason) truncationReasons.add(restrictionReason);
    if (batch.workLimitReached) truncationReasons.add("work_limit");
    let skippedNewNode = false;
    for (const neighbor of batch.neighbors) {
      requestContext.checkpoint();
      const nextKey = endpointKey(neighbor.endpoint);
      const nextDepth = current.depth + 1;
      const isKnownNode = nodes.has(nextKey);
      if (nextDepth > normalized.max_depth && !isKnownNode) {
        truncationReasons.add("depth_limit");
        continue;
      }
      if (!isKnownNode && nodes.size >= normalized.max_nodes) {
        truncationReasons.add("record_limit");
        skippedNewNode = true;
        continue;
      }
      if (!selectedEdges.has(neighbor.edge.relationship_id)) {
        if (selectedEdges.size >= normalized.max_edges) {
          truncationReasons.add("edge_limit");
          continue;
        }
        selectedEdges.set(neighbor.edge.relationship_id, neighbor.edge);
      }
      if (isKnownNode) continue;
      nodes.set(nextKey, {
        endpoint: neighbor.endpoint,
        depth: nextDepth,
        direct: nextDepth === 1,
      });
      queue.push({ key: nextKey, endpoint: neighbor.endpoint, depth: nextDepth });
      maxDepthReached = Math.max(maxDepthReached, nextDepth);
    }

    if (restrictionReason) {
      if (batch.incomplete && !batch.workLimitReached) truncationReasons.add("edge_limit");
      const probe = neighborsFor(
        current.endpoint,
        normalized,
        requestContext,
        1,
        true,
        undefined,
        new Set(selectedEdges.keys()),
        IMPACT_PROBE_WORK_ITEMS,
      );
      if (probe.workLimitReached) truncationReasons.add("work_limit");
      for (const neighbor of probe.neighbors) {
        classifyObservedNeighbor(current, neighbor, selectedEdges.size >= normalized.max_edges);
      }
      continue;
    }

    if (
      (skippedNewNode || nodes.size >= normalized.max_nodes) &&
      selectedEdges.size < normalized.max_edges
    ) {
      const knownBatch = neighborsFor(
        current.endpoint,
        normalized,
        requestContext,
        normalized.max_edges - selectedEdges.size,
        false,
        new Set(nodes.keys()),
        new Set(selectedEdges.keys()),
      );
      if (knownBatch.excludedNeighbors) truncationReasons.add("record_limit");
      if (knownBatch.workLimitReached) truncationReasons.add("work_limit");
      for (const neighbor of knownBatch.neighbors) {
        requestContext.checkpoint();
        if (selectedEdges.size >= normalized.max_edges) {
          truncationReasons.add("edge_limit");
          break;
        }
        selectedEdges.set(neighbor.edge.relationship_id, neighbor.edge);
      }
      if (knownBatch.incomplete && !knownBatch.workLimitReached) {
        truncationReasons.add("edge_limit");
      }
    } else if (batch.incomplete && !batch.workLimitReached) {
      truncationReasons.add("edge_limit");
      const overflowProbe = neighborsFor(
        current.endpoint,
        normalized,
        requestContext,
        1,
        true,
        undefined,
        new Set(selectedEdges.keys()),
        IMPACT_PROBE_WORK_ITEMS,
      );
      if (overflowProbe.workLimitReached) truncationReasons.add("work_limit");
      for (const neighbor of overflowProbe.neighbors) {
        classifyObservedNeighbor(current, neighbor, true);
      }
    }
  }

  const orderedReasons = ["depth_limit", "record_limit", "work_limit", "edge_limit"].filter(
    (reason) => truncationReasons.has(reason as TruncationReason),
  ) as TruncationReason[];
  const truncated = orderedReasons.length > 0;
  requestContext.checkpoint();
  return {
    root,
    direction: normalized.direction,
    relationship_kinds: normalized.relationship_kinds,
    nodes: [...nodes.values()].sort(
      (left, right) =>
        left.depth - right.depth ||
        left.endpoint.file.localeCompare(right.endpoint.file) ||
        left.endpoint.selector.localeCompare(right.endpoint.selector) ||
        left.endpoint.symbol_path.localeCompare(right.endpoint.symbol_path),
    ),
    edges: [...selectedEdges.values()].sort(edgeOrder),
    visited_nodes: nodes.size,
    visited_edges: selectedEdges.size,
    max_depth_reached: maxDepthReached,
    max_depth: normalized.max_depth,
    max_nodes: normalized.max_nodes,
    max_edges: normalized.max_edges,
    incomplete: truncated,
    truncation: createTruncationMetadata(truncated, truncated ? orderedReasons[0] : null),
    truncation_reasons: orderedReasons,
  };
}

export function traverseImpact(
  root: RelationshipEndpoint,
  edges: readonly RelationshipEdge[],
  options: ImpactTraversalOptions = {},
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): ImpactResult {
  if (!Array.isArray(edges)) throw new Error("Impact traversal input is invalid.");
  return traverseWithNeighborProvider(
    root,
    (
      current,
      normalized,
      _context,
      maxEdges,
      _stopAfterFirst,
      allowedNeighborKeys,
      excludedRelationshipIds,
    ) => {
      const allNeighbors = collectNeighbors(current, edges, normalized, requestContext).filter(
        (neighbor) => !excludedRelationshipIds?.has(neighbor.edge.relationship_id),
      );
      const neighbors = allowedNeighborKeys
        ? allNeighbors.filter((neighbor) => allowedNeighborKeys.has(endpointKey(neighbor.endpoint)))
        : allNeighbors;
      return {
        neighbors: neighbors.slice(0, maxEdges),
        incomplete: neighbors.length > maxEdges,
        excludedNeighbors: allowedNeighborKeys
          ? allNeighbors.some(
              (neighbor) => !allowedNeighborKeys.has(endpointKey(neighbor.endpoint)),
            )
          : false,
        workLimitReached: false,
      };
    },
    options,
    requestContext,
  );
}

export function traverseCompilerImpact(
  project: Project,
  projectRoot: string,
  root: RelationshipEndpoint,
  freshness: FreshnessMetadata,
  options: ImpactTraversalOptions = {},
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
  controls: { readonly max_work_items?: number } = {},
): CompilerImpactResult {
  const tracker = new CompilerImpactWorkTracker(
    controls.max_work_items ?? IMPACT_RELATIONSHIP_WORK_ITEMS,
  );
  const observations: RelationshipCoverageEntry[] = [];
  const resolver = createCompilerRelationshipResolver(
    project,
    projectRoot,
    freshness,
    requestContext,
    tracker,
  );
  const impact = traverseWithNeighborProvider(
    root,
    (
      current,
      normalized,
      _context,
      maxEdges,
      stopAfterFirst,
      allowedNeighborKeys,
      excludedRelationshipIds,
    ) => {
      const resolution = resolver.edgesFor(current, {
        direction: normalized.direction,
        relationship_kinds: normalized.relationship_kinds,
        max_edges: maxEdges,
        allowed_neighbor_keys: allowedNeighborKeys ? [...allowedNeighborKeys] : undefined,
        excluded_relationship_ids: excludedRelationshipIds
          ? [...excludedRelationshipIds]
          : undefined,
        stop_after_first: stopAfterFirst,
      });
      observations.push(...resolution.coverage);
      return {
        neighbors: collectNeighbors(current, resolution.edges, normalized, requestContext),
        incomplete: resolution.edge_limit_reached,
        excludedNeighbors: resolution.excluded_neighbors,
        workLimitReached: resolution.work_limit_reached,
      };
    },
    options,
    requestContext,
  );
  const coverage = aggregateRelationshipCoverage(observations);
  const coverageComplete = coverage.every(
    ({ status }) => status === "completed" || status === "not_applicable",
  );
  return {
    ...impact,
    coverage,
    work: tracker.snapshot(),
    incomplete: impact.incomplete || !coverageComplete,
  };
}
