import { z } from "zod";
import { FRESHNESS_CAUSES, SNAPSHOT_STATES } from "../services/read-contracts.js";
import {
  MAX_RELATIONSHIP_COVERAGE_ENTRIES,
  RELATIONSHIP_CONFIDENCES,
  RELATIONSHIP_COVERAGE_STATUSES,
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

export { MAX_RELATIONSHIP_COVERAGE_ENTRIES };

export const RelationshipCoverageEntrySchema = z.object({
  kind: z.enum(RELATIONSHIP_EDGE_KINDS),
  direction: z.enum(["incoming", "outgoing"]),
  endpoint_class: z.enum(["module", "symbol"]),
  status: z.enum(RELATIONSHIP_COVERAGE_STATUSES),
});

const COVERAGE_DIRECTIONS = ["incoming", "outgoing"] as const;
const COVERAGE_ENDPOINT_CLASSES = ["module", "symbol"] as const;

function coverageOrder(entry: z.infer<typeof RelationshipCoverageEntrySchema>): number {
  return (
    RELATIONSHIP_EDGE_KINDS.indexOf(entry.kind) * 4 +
    COVERAGE_DIRECTIONS.indexOf(entry.direction) * 2 +
    COVERAGE_ENDPOINT_CLASSES.indexOf(entry.endpoint_class)
  );
}

export const RelationshipCoverageSchema = z
  .array(RelationshipCoverageEntrySchema)
  .max(MAX_RELATIONSHIP_COVERAGE_ENTRIES)
  .superRefine((entries, context) => {
    for (let index = 1; index < entries.length; index += 1) {
      if (coverageOrder(entries[index - 1]!) >= coverageOrder(entries[index]!)) {
        context.addIssue({
          code: "custom",
          message: "Coverage entries must be unique and ordered.",
        });
        return;
      }
    }
  });

const SafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const CompilerImpactWorkSchema = z
  .object({
    max_items: SafeIntegerSchema.min(1),
    consumed_items: SafeIntegerSchema,
    exhausted: z.boolean(),
  })
  .refine(({ consumed_items, max_items }) => consumed_items <= max_items, {
    message: "consumed_items must not exceed max_items",
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
