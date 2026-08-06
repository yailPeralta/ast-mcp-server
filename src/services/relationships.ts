import {
  createSourceLocation,
  isFreshnessCause,
  isSnapshotState,
  type FreshnessMetadata,
  type SourceRange,
} from "./read-contracts.js";

export const RELATIONSHIP_EDGE_KINDS = Object.freeze([
  "reference",
  "import",
  "export",
  "extends",
  "implements",
  "call",
  "contains",
] as const);

export type RelationshipEdgeKind = (typeof RELATIONSHIP_EDGE_KINDS)[number];

export const RELATIONSHIP_PROVENANCES = Object.freeze(["compiler", "syntax", "heuristic"] as const);

export type RelationshipProvenance = (typeof RELATIONSHIP_PROVENANCES)[number];

export const RELATIONSHIP_CONFIDENCES = Object.freeze(["exact", "high", "medium", "low"] as const);

export type RelationshipConfidence = (typeof RELATIONSHIP_CONFIDENCES)[number];

export const RELATIONSHIP_RESOLUTIONS = Object.freeze([
  "resolved",
  "unresolved",
  "ambiguous",
] as const);

export type RelationshipResolution = (typeof RELATIONSHIP_RESOLUTIONS)[number];

export interface RelationshipEndpointInput {
  readonly file: string;
  readonly symbol_path: string;
  readonly selector: string;
  readonly range?: SourceRange;
}

export interface RelationshipEndpoint {
  readonly file: string;
  readonly symbol_path: string;
  readonly selector: string;
  readonly range?: SourceRange;
}

export interface RelationshipEdgeInput {
  readonly source: RelationshipEndpointInput;
  readonly target: RelationshipEndpointInput;
  readonly kind: RelationshipEdgeKind;
  readonly provenance: RelationshipProvenance;
  readonly confidence: RelationshipConfidence;
  readonly resolution: RelationshipResolution;
  readonly freshness: FreshnessMetadata;
}

export interface RelationshipEdge {
  readonly relationship_id: string;
  readonly source: RelationshipEndpoint;
  readonly target: RelationshipEndpoint;
  readonly kind: RelationshipEdgeKind;
  readonly provenance: RelationshipProvenance;
  readonly confidence: RelationshipConfidence;
  readonly resolution: RelationshipResolution;
  readonly freshness: FreshnessMetadata;
  readonly compiler_authoritative: boolean;
}

function assertNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Relationship ${name} must be a non-empty string.`);
  }
  return value.trim();
}

function assertEnum<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (!values.includes(value as T)) {
    throw new Error(`Relationship ${name} is invalid.`);
  }
  return value as T;
}

function normalizeFreshness(input: FreshnessMetadata): FreshnessMetadata {
  if (
    typeof input !== "object" ||
    input === null ||
    !isSnapshotState(input.state) ||
    !Array.isArray(input.causes) ||
    (input.checked_at !== null && typeof input.checked_at !== "string")
  ) {
    throw new Error("Relationship freshness metadata is invalid.");
  }

  const causes = [...new Set(input.causes)];
  if (!causes.every((cause) => isFreshnessCause(cause))) {
    throw new Error("Relationship freshness contains an invalid cause.");
  }
  if (input.state === "fresh" && causes.length > 0) {
    throw new Error("Fresh relationship evidence cannot carry freshness causes.");
  }

  return Object.freeze({
    state: input.state,
    causes: Object.freeze(causes.sort()),
    checked_at: input.checked_at,
  });
}

function normalizeEndpoint(input: RelationshipEndpointInput): RelationshipEndpoint {
  if (typeof input !== "object" || input === null) {
    throw new Error("Relationship endpoint is invalid.");
  }

  const location = createSourceLocation(input.file, input.range ?? { start_line: 1 });
  const symbolPath = assertNonEmptyString(input.symbol_path, "endpoint symbol_path");
  const selector = assertNonEmptyString(input.selector, "endpoint selector");
  const { file, ...range } = location;

  return Object.freeze({
    file,
    symbol_path: symbolPath,
    selector,
    ...(input.range === undefined ? {} : { range }),
  });
}

function endpointIdentity(endpoint: RelationshipEndpoint): readonly string[] {
  return [endpoint.file, endpoint.symbol_path, endpoint.selector];
}

export function createRelationshipEdge(input: RelationshipEdgeInput): RelationshipEdge {
  if (typeof input !== "object" || input === null) {
    throw new Error("Relationship edge input is invalid.");
  }

  const source = normalizeEndpoint(input.source);
  const target = normalizeEndpoint(input.target);
  const kind = assertEnum(input.kind, RELATIONSHIP_EDGE_KINDS, "edge kind");
  const provenance = assertEnum(input.provenance, RELATIONSHIP_PROVENANCES, "provenance");
  const confidence = assertEnum(input.confidence, RELATIONSHIP_CONFIDENCES, "confidence");
  const resolution = assertEnum(input.resolution, RELATIONSHIP_RESOLUTIONS, "resolution");
  const freshness = normalizeFreshness(input.freshness);
  const compilerAuthoritative =
    provenance === "compiler" &&
    confidence === "exact" &&
    resolution === "resolved" &&
    freshness.state === "fresh";

  return Object.freeze({
    relationship_id: `${kind}:${JSON.stringify(endpointIdentity(source))}->${JSON.stringify(endpointIdentity(target))}`,
    source,
    target,
    kind,
    provenance,
    confidence,
    resolution,
    freshness,
    compiler_authoritative: compilerAuthoritative,
  });
}
