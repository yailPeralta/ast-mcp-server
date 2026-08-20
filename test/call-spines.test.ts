import { describe, expect, it } from "vitest";
import { planCallSpines } from "../src/services/call-spines.js";
import { createRelationshipEdge } from "../src/services/relationships.js";

const fresh = { state: "fresh" as const, causes: [] as const, checked_at: "2026-08-18T00:00:00Z" };
const endpoint = (name: string) => ({
  file: `src/${name}.ts`,
  symbol_path: name,
  selector: `${name}@1`,
});
const edge = (id: string, source: string, target: string) => ({
  ...createRelationshipEdge({
    source: endpoint(source),
    target: endpoint(target),
    kind: "call",
    provenance: "compiler",
    confidence: "exact",
    resolution: "resolved",
    freshness: fresh,
  }),
  relationship_id: id,
});
const options = { direction: "outgoing" as const, max_depth: 3, max_nodes: 10, max_edges: 10 };
const stale = { ...fresh, state: "stale" as const, causes: ["source_change"] as const };

describe("canonical call spines", () => {
  it("selects the stable shortest tie without repeating cycle endpoints", () => {
    const result = planCallSpines(
      endpoint("root"),
      [
        edge("z-root-a", "root", "a"),
        edge("a-root-b", "root", "b"),
        edge("a-a-leaf", "a", "leaf"),
        edge("z-b-leaf", "b", "leaf"),
        edge("cycle", "leaf", "root"),
      ],
      options,
    );

    expect(result.paths.map((path) => [path.endpoint.symbol_path, path.relationship_ids])).toEqual([
      ["a", ["z-root-a"]],
      ["b", ["a-root-b"]],
      ["leaf", ["a-root-b", "z-b-leaf"]],
    ]);
    expect(result.paths.at(-1)?.endpoints).toHaveLength(3);
    expect(result).toMatchObject({ incomplete: false, visited: { nodes: 4, edges: 5 } });
  });

  it("emits incoming paths in caller-to-root order", () => {
    const result = planCallSpines(
      endpoint("root"),
      [edge("middle-root", "middle", "root"), edge("caller-middle", "caller", "middle")],
      { ...options, direction: "incoming", max_depth: 2 },
    );

    expect(result.paths.at(-1)?.endpoints.map((item) => item.symbol_path)).toEqual([
      "caller",
      "middle",
      "root",
    ]);
    expect(result.paths.at(-1)?.relationship_ids).toEqual(["caller-middle", "middle-root"]);
  });

  it.each([
    [{ max_depth: 1 }, "depth_limit"],
    [{ max_nodes: 2 }, "node_limit"],
    [{ max_edges: 1 }, "edge_limit"],
  ] as const)("makes bounded exhaustion explicit", (limit, reason) => {
    const result = planCallSpines(
      endpoint("root"),
      [edge("root-a", "root", "a"), edge("a-leaf", "a", "leaf")],
      { ...options, ...limit },
    );
    expect(result).toMatchObject({ incomplete: true });
    expect(result.truncation_reasons).toContain(reason);
  });

  it.each([
    [true, fresh, "authoritative", true],
    [false, fresh, "incomplete", false],
    [true, stale, "untrusted", false],
  ] as const)(
    "classifies empty authority",
    (discovery_complete, freshness, authority_state, empty_proven) => {
      expect(
        planCallSpines(endpoint("root"), [], {
          ...options,
          discovery_complete,
          freshness,
        }),
      ).toMatchObject({ paths: [], authority_state, empty_proven, incomplete: !empty_proven });
    },
  );
});
