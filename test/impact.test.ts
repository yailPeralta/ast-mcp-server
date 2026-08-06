import path from "node:path";
import { Project } from "ts-morph";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectCompilerRelationships,
  type RelationshipEdge,
} from "../src/services/relationships.js";
import {
  resolveImpactRoot,
  traverseImpact,
  type ImpactRootRequest,
  type ImpactTraversalOptions,
} from "../src/services/impact.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

const freshness = {
  state: "fresh" as const,
  causes: [] as const,
  checked_at: "2026-08-06T00:00:00.000Z",
};

const rootRequest = (symbol_path: string, file_path = "src/chain.ts"): ImpactRootRequest => ({
  file_path,
  symbol_path,
});

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

async function graphFixture(): Promise<{
  fixture: ProjectFixture;
  project: Project;
  edges: RelationshipEdge[];
}> {
  const fixture = await createProjectFixture({
    "src/leaf.ts": "export function leaf(): number { return 1; }\n",
    "src/middle.ts": [
      'import { leaf } from "./leaf.js";',
      "export function middle(): number { return leaf(); }",
    ].join("\n"),
    "src/chain.ts": [
      'import { middle } from "./middle.js";',
      "export function chain(): number { return middle(); }",
    ].join("\n"),
  });
  fixtures.push(fixture);
  const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
  return {
    fixture,
    project,
    edges: collectCompilerRelationships(project, fixture.root, freshness),
  };
}

describe("impact root resolution", () => {
  it("resolves an exact compiler declaration and rejects missing roots", async () => {
    const { fixture, project } = await graphFixture();

    expect(resolveImpactRoot(project, fixture.root, rootRequest("chain"))).toMatchObject({
      file: "src/chain.ts",
      symbol_path: "chain",
      selector: "chain@2",
    });
    expect(() => resolveImpactRoot(project, fixture.root, rootRequest("missing"))).toThrow(
      "was not found",
    );
  });
});

describe("bounded impact traversal", () => {
  it("walks outgoing exact references deterministically", async () => {
    const { fixture, project, edges } = await graphFixture();
    const root = resolveImpactRoot(project, fixture.root, rootRequest("chain"));

    const result = traverseImpact(root, edges, {
      direction: "outgoing",
      max_depth: 2,
      max_nodes: 10,
      max_edges: 10,
    });

    expect(result.nodes.map((node) => [node.depth, node.endpoint.symbol_path])).toEqual([
      [0, "chain"],
      [1, "middle"],
      [2, "leaf"],
    ]);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reference",
          source: expect.objectContaining({ symbol_path: "chain" }),
        }),
        expect.objectContaining({
          kind: "reference",
          source: expect.objectContaining({ symbol_path: "middle" }),
        }),
      ]),
    );
    expect(result.truncation).toEqual({ truncated: false, reason: null });
    expect(result.incomplete).toBe(false);
  });

  it("supports direction and relationship-kind filters", async () => {
    const { fixture, project, edges } = await graphFixture();
    const root = resolveImpactRoot(project, fixture.root, rootRequest("middle", "src/middle.ts"));

    const incoming = traverseImpact(root, edges, {
      direction: "incoming",
      max_depth: 1,
      max_nodes: 10,
      max_edges: 10,
      relationship_kinds: ["reference"],
    });
    const outgoing = traverseImpact(root, edges, {
      direction: "outgoing",
      max_depth: 1,
      max_nodes: 10,
      max_edges: 10,
      relationship_kinds: ["reference"],
    });

    expect(incoming.nodes.map((node) => node.endpoint.symbol_path)).toEqual(["middle", "chain"]);
    expect(outgoing.nodes.map((node) => node.endpoint.symbol_path)).toEqual(["middle", "leaf"]);
    expect(incoming.edges.every((edge) => edge.kind === "reference")).toBe(true);
  });

  it("reports depth, node, and edge truncation instead of hiding evidence", async () => {
    const { fixture, project, edges } = await graphFixture();
    const root = resolveImpactRoot(project, fixture.root, rootRequest("chain"));

    const depthLimited = traverseImpact(root, edges, {
      direction: "outgoing",
      max_depth: 1,
      max_nodes: 10,
      max_edges: 10,
    });
    const nodeLimited = traverseImpact(root, edges, {
      direction: "outgoing",
      max_depth: 2,
      max_nodes: 2,
      max_edges: 10,
    });
    const edgeLimited = traverseImpact(root, edges, {
      direction: "outgoing",
      max_depth: 2,
      max_nodes: 10,
      max_edges: 1,
    });

    expect(depthLimited).toMatchObject({
      incomplete: true,
      truncation: { truncated: true, reason: "depth_limit" },
    });
    expect(nodeLimited).toMatchObject({
      incomplete: true,
      truncation: { truncated: true, reason: "record_limit" },
    });
    expect(
      nodeLimited.edges.every(
        (edge) =>
          nodeLimited.nodes.some((node) => sameEndpoint(node.endpoint, edge.source)) &&
          nodeLimited.nodes.some((node) => sameEndpoint(node.endpoint, edge.target)),
      ),
    ).toBe(true);
    expect(edgeLimited).toMatchObject({
      incomplete: true,
      truncation: { truncated: true, reason: "edge_limit" },
    });
  });

  it.each([
    ["direction", { direction: "sideways" }],
    ["max_depth", { max_depth: -1 }],
    ["max_nodes", { max_nodes: 0 }],
    ["max_edges", { max_edges: 0 }],
    ["relationship kind", { relationship_kinds: ["guessed"] }],
  ])("rejects invalid %s traversal options", async (_field, override) => {
    const { fixture, project, edges } = await graphFixture();
    const root = resolveImpactRoot(project, fixture.root, rootRequest("chain"));

    expect(() =>
      traverseImpact(root, edges, override as unknown as ImpactTraversalOptions),
    ).toThrow();
  });
});

function sameEndpoint(
  left: { file: string; symbol_path: string; selector: string },
  right: { file: string; symbol_path: string; selector: string },
): boolean {
  return (
    left.file === right.file &&
    left.symbol_path === right.symbol_path &&
    left.selector === right.selector
  );
}
