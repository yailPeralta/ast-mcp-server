import { z } from "zod";
import { FRESHNESS_CAUSES, SNAPSHOT_STATES } from "../services/read-contracts.js";
import {
  RELATIONSHIP_CONFIDENCES,
  RELATIONSHIP_EDGE_KINDS,
  RELATIONSHIP_PROVENANCES,
  RELATIONSHIP_RESOLUTIONS,
} from "../services/relationships.js";

export const SourceRangeSchema = z.object({
  start_line: z.number().int().positive(),
  start_column: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  end_column: z.number().int().positive().optional(),
});

export const RelationshipEndpointSchema = z.object({
  file: z.string(),
  symbol_path: z.string(),
  selector: z.string(),
  range: SourceRangeSchema.optional(),
});

export const FreshnessSchema = z.object({
  state: z.enum(SNAPSHOT_STATES),
  causes: z.array(z.enum(FRESHNESS_CAUSES)),
  checked_at: z.string().nullable(),
});

export const RelationshipEdgeSchema = z.object({
  relationship_id: z.string(),
  source: RelationshipEndpointSchema,
  target: RelationshipEndpointSchema,
  kind: z.enum(RELATIONSHIP_EDGE_KINDS),
  provenance: z.enum(RELATIONSHIP_PROVENANCES),
  confidence: z.enum(RELATIONSHIP_CONFIDENCES),
  resolution: z.enum(RELATIONSHIP_RESOLUTIONS),
  compiler_authoritative: z.boolean(),
  freshness: FreshnessSchema,
});
