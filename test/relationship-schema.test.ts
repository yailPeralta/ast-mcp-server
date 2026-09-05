import { describe, expect, it } from "vitest";
import { RELATIONSHIP_EDGE_KINDS } from "../src/services/relationships.js";
import {
  CompilerImpactWorkSchema,
  RelationshipCoverageSchema,
} from "../src/tools/relationship-schema.js";

const fourteenCells = RELATIONSHIP_EDGE_KINDS.flatMap((kind) =>
  (["incoming", "outgoing"] as const).map((direction) => ({
    kind,
    direction,
    endpoint_class: "symbol" as const,
    status: "completed" as const,
  })),
);

describe("public relationship coverage schemas", () => {
  it("accepts exactly the bounded canonical fourteen-cell root-class contract", () => {
    expect(RelationshipCoverageSchema.parse(fourteenCells)).toEqual(fourteenCells);
    expect(() => RelationshipCoverageSchema.parse([...fourteenCells, fourteenCells[0]])).toThrow();
    expect(() => RelationshipCoverageSchema.parse([...fourteenCells].reverse())).toThrow();
  });

  it("requires safe bounded compiler work counters", () => {
    const maximum = {
      consumed_items: Number.MAX_SAFE_INTEGER,
      max_items: Number.MAX_SAFE_INTEGER,
      exhausted: true,
    };
    expect(CompilerImpactWorkSchema.parse(maximum)).toEqual(maximum);
    expect(() =>
      CompilerImpactWorkSchema.parse({ ...maximum, consumed_items: maximum.max_items + 1 }),
    ).toThrow();
    expect(() =>
      CompilerImpactWorkSchema.parse({ max_items: 10, consumed_items: 11, exhausted: false }),
    ).toThrow();
  });
});
