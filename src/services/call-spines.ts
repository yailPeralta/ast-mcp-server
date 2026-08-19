import type { FreshnessMetadata } from "./read-contracts.js";
import type { RelationshipEdge, RelationshipEndpoint } from "./relationships.js";

export type CallSpineDirection = "incoming" | "outgoing";
export interface CallSpineOptions {
  readonly direction: CallSpineDirection;
  readonly max_depth: number;
  readonly max_nodes: number;
  readonly max_edges: number;
  readonly discovery_complete?: boolean;
  readonly freshness?: FreshnessMetadata;
}
export interface CallSpinePath {
  readonly endpoint: RelationshipEndpoint;
  readonly endpoints: readonly RelationshipEndpoint[];
  readonly relationship_ids: readonly string[];
}
export interface CallSpineResult {
  readonly root: RelationshipEndpoint;
  readonly direction: CallSpineDirection;
  readonly paths: readonly CallSpinePath[];
  readonly visited: { readonly nodes: number; readonly edges: number; readonly max_depth: number };
  readonly budget: {
    readonly max_depth: number;
    readonly max_nodes: number;
    readonly max_edges: number;
  };
  readonly incomplete: boolean;
  readonly truncation_reasons: readonly ("depth_limit" | "node_limit" | "edge_limit")[];
  readonly authority_state: "authoritative" | "incomplete" | "untrusted";
  readonly empty_proven: boolean;
}

interface PathRecord {
  readonly endpoint: RelationshipEndpoint;
  readonly endpoints: readonly RelationshipEndpoint[];
  readonly relationshipIds: readonly string[];
  readonly depth: number;
}

const endpointKey = (endpoint: RelationshipEndpoint): string =>
  [endpoint.file, endpoint.symbol_path, endpoint.selector].join("\u0000");
const sequenceKey = (values: readonly string[]): string => JSON.stringify(values);
const exactCall = (edge: RelationshipEdge): boolean =>
  edge.kind === "call" &&
  edge.provenance === "compiler" &&
  edge.confidence === "exact" &&
  edge.resolution === "resolved" &&
  edge.freshness.state === "fresh" &&
  edge.compiler_authoritative;

function assertLimit(value: number, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`Call spine ${name} is invalid.`);
  return value;
}

export function planCallSpines(
  root: RelationshipEndpoint,
  edges: readonly RelationshipEdge[],
  options: CallSpineOptions,
): CallSpineResult {
  const maxDepth = assertLimit(options.max_depth, 0, "max_depth");
  const maxNodes = assertLimit(options.max_nodes, 1, "max_nodes");
  const maxEdges = assertLimit(options.max_edges, 1, "max_edges");
  const accepted = edges.filter(exactCall);
  const freshness = options.freshness?.state ?? edges[0]?.freshness.state;
  const authorityState =
    freshness !== "fresh" || accepted.length !== edges.length
      ? "untrusted"
      : options.discovery_complete === false
        ? "incomplete"
        : "authoritative";
  const reasons = new Set<"depth_limit" | "node_limit" | "edge_limit">();
  const rootKey = endpointKey(root);
  const initial = { endpoint: root, endpoints: [root], relationshipIds: [], depth: 0 };
  const records = new Map<string, PathRecord>([[rootKey, initial]]);
  const observedEdges = new Set<string>();
  let layer: PathRecord[] = [initial];

  while (layer.length > 0) {
    const candidates = new Map<string, PathRecord>();
    for (const current of layer.sort((left, right) =>
      endpointKey(left.endpoint).localeCompare(endpointKey(right.endpoint)),
    )) {
      const incident = accepted
        .filter((edge) =>
          options.direction === "outgoing"
            ? endpointKey(edge.source) === endpointKey(current.endpoint)
            : endpointKey(edge.target) === endpointKey(current.endpoint),
        )
        .sort((left, right) => left.relationship_id.localeCompare(right.relationship_id));
      for (const edge of incident) {
        if (!observedEdges.has(edge.relationship_id) && observedEdges.size >= maxEdges) {
          reasons.add("edge_limit");
          continue;
        }
        observedEdges.add(edge.relationship_id);
        const next = options.direction === "outgoing" ? edge.target : edge.source;
        const key = endpointKey(next);
        if (current.endpoints.some((endpoint) => endpointKey(endpoint) === key) || records.has(key))
          continue;
        if (current.depth >= maxDepth) {
          reasons.add("depth_limit");
          continue;
        }
        const outgoing = options.direction === "outgoing";
        const candidate: PathRecord = {
          endpoint: next,
          endpoints: outgoing ? [...current.endpoints, next] : [next, ...current.endpoints],
          relationshipIds: outgoing
            ? [...current.relationshipIds, edge.relationship_id]
            : [edge.relationship_id, ...current.relationshipIds],
          depth: current.depth + 1,
        };
        const previous = candidates.get(key);
        if (
          !previous ||
          sequenceKey(candidate.relationshipIds) < sequenceKey(previous.relationshipIds)
        )
          candidates.set(key, candidate);
      }
    }
    const ordered = [...candidates.values()].sort((left, right) =>
      endpointKey(left.endpoint).localeCompare(endpointKey(right.endpoint)),
    );
    const available = maxNodes - records.size;
    if (ordered.length > available) reasons.add("node_limit");
    layer = ordered.slice(0, Math.max(0, available));
    for (const record of layer) records.set(endpointKey(record.endpoint), record);
  }

  const paths = [...records.values()]
    .filter((record) => record.depth > 0)
    .sort(
      (left, right) =>
        left.depth - right.depth ||
        endpointKey(left.endpoint).localeCompare(endpointKey(right.endpoint)),
    )
    .map((record): CallSpinePath => ({
      endpoint: record.endpoint,
      endpoints: record.endpoints,
      relationship_ids: record.relationshipIds,
    }));
  const incomplete = authorityState !== "authoritative" || reasons.size > 0;
  return {
    root,
    direction: options.direction,
    paths,
    visited: {
      nodes: records.size,
      edges: observedEdges.size,
      max_depth: Math.max(0, ...paths.map((path) => path.relationship_ids.length)),
    },
    budget: { max_depth: maxDepth, max_nodes: maxNodes, max_edges: maxEdges },
    incomplete,
    truncation_reasons: ["depth_limit", "node_limit", "edge_limit"].filter((reason) =>
      reasons.has(reason as never),
    ) as Array<"depth_limit" | "node_limit" | "edge_limit">,
    authority_state: authorityState,
    empty_proven: paths.length === 0 && !incomplete,
  };
}
