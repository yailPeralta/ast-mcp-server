import { describe, expect, it } from "vitest";
import {
  createRelationshipEdge,
  type RelationshipEdgeInput,
} from "../src/services/relationships.js";

function freshness(state: "fresh" | "stale" = "fresh"): RelationshipEdgeInput["freshness"] {
  return {
    state,
    causes: state === "fresh" ? [] : ["source_change"],
    checked_at: "2026-08-06T00:00:00.000Z",
  };
}

function edgeInput(overrides: Partial<RelationshipEdgeInput> = {}): RelationshipEdgeInput {
  return {
    source: {
      file: "src/index.ts",
      symbol_path: "createServer",
      selector: "createServer@4",
    },
    target: {
      file: "src/server.ts",
      symbol_path: "Server",
      selector: "Server@8",
    },
    kind: "reference",
    provenance: "compiler",
    confidence: "exact",
    resolution: "resolved",
    freshness: freshness(),
    ...overrides,
  };
}

describe("normalized relationship edges", () => {
  it("normalizes endpoints and derives a stable identity", () => {
    const edge = createRelationshipEdge(
      edgeInput({
        source: { ...edgeInput().source, file: ".\\src\\index.ts" },
      }),
    );

    expect(edge).toMatchObject({
      relationship_id:
        'reference:["src/index.ts","createServer","createServer@4"]->["src/server.ts","Server","Server@8"]',
      source: { file: "src/index.ts" },
      target: { file: "src/server.ts" },
      compiler_authoritative: true,
    });
    expect(createRelationshipEdge(edgeInput())).toEqual(edge);
  });

  it("never marks syntax or heuristic evidence compiler-authoritative", () => {
    const syntax = createRelationshipEdge(edgeInput({ provenance: "syntax", confidence: "exact" }));
    const heuristic = createRelationshipEdge(
      edgeInput({ provenance: "heuristic", confidence: "high" }),
    );

    expect(syntax.compiler_authoritative).toBe(false);
    expect(heuristic.compiler_authoritative).toBe(false);
    expect(JSON.stringify(syntax)).toContain('"compiler_authoritative":false');
    expect(JSON.stringify(heuristic)).toContain('"compiler_authoritative":false');
  });

  it("does not treat stale compiler evidence as authoritative", () => {
    const edge = createRelationshipEdge(edgeInput({ freshness: freshness("stale") }));

    expect(edge.compiler_authoritative).toBe(false);
    expect(edge.freshness).toEqual({
      state: "stale",
      causes: ["source_change"],
      checked_at: "2026-08-06T00:00:00.000Z",
    });
  });

  it.each([
    ["kind", { kind: "unknown" }],
    ["provenance", { provenance: "guessed" }],
    ["confidence", { confidence: "maybe" }],
    ["resolution", { resolution: "partial" }],
  ])("rejects an invalid %s", (_field, override) => {
    expect(() => createRelationshipEdge(edgeInput(override as never))).toThrow();
  });

  it("rejects unsafe endpoint paths and invalid freshness metadata", () => {
    expect(() =>
      createRelationshipEdge(
        edgeInput({ source: { ...edgeInput().source, file: "../outside.ts" } }),
      ),
    ).toThrow("project-relative");
    expect(() =>
      createRelationshipEdge(
        edgeInput({
          freshness: { state: "fresh", causes: ["source_change"], checked_at: null },
        }),
      ),
    ).toThrow("freshness");
  });
});
