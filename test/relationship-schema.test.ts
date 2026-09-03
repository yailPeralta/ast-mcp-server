import { describe, expect, it } from "vitest";
import { RELATIONSHIP_EDGE_KINDS } from "../src/services/relationships.js";
import {
  CompilerImpactWorkSchema,
  RelationshipCoverageSchema,
} from "../src/tools/relationship-schema.js";

const completedCoverage = RELATIONSHIP_EDGE_KINDS.flatMap((kind) =>
  (["incoming", "outgoing"] as const).flatMap((direction) =>
    (["module", "symbol"] as const).map((endpoint_class) => ({
      kind,
      direction,
      endpoint_class,
      status: "completed" as const,
    })),
  ),
);

describe("public relationship coverage schemas", () => {
  it("accepts at most 28 uniquely ordered coverage entries", () => {
    expect(RelationshipCoverageSchema.parse(completedCoverage)).toEqual(completedCoverage);
    expect(() =>
      RelationshipCoverageSchema.parse([...completedCoverage, completedCoverage[0]]),
    ).toThrow();
    expect(() => RelationshipCoverageSchema.parse([...completedCoverage].reverse())).toThrow();
  });

  it("requires safe bounded compiler work counters", () => {
    expect(
      CompilerImpactWorkSchema.parse({
        consumed_items: Number.MAX_SAFE_INTEGER,
        max_items: Number.MAX_SAFE_INTEGER,
        exhausted: true,
      }),
    ).toEqual({
      consumed_items: Number.MAX_SAFE_INTEGER,
      max_items: Number.MAX_SAFE_INTEGER,
      exhausted: true,
    });
    expect(() =>
      CompilerImpactWorkSchema.parse({
        consumed_items: Number.MAX_SAFE_INTEGER + 1,
        max_items: Number.MAX_SAFE_INTEGER + 1,
        exhausted: false,
      }),
    ).toThrow();
  });
});
