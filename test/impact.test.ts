import path from "node:path";
import { Project } from "ts-morph";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregateRelationshipCoverage,
  collectCompilerRelationships,
  createCompilerRelationshipResolver,
  createRelationshipEdge,
  RELATIONSHIP_EDGE_KINDS,
  type RelationshipCoverageEntry,
  type RelationshipEdge,
} from "../src/services/relationships.js";
import {
  resolveImpactRoot,
  traverseCompilerImpact,
  traverseImpact,
  type ImpactRootRequest,
  type ImpactTraversalOptions,
} from "../src/services/impact.js";
import { createRequestContext } from "../src/services/request-context.js";
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
  it("resolves transitive impact without scanning unrelated declarations", async () => {
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
      "src/unrelated.ts": "export function unrelated(): number { return 0; }\n",
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const unrelated = project
      .getSourceFileOrThrow(path.join(fixture.root, "src/unrelated.ts"))
      .getFunctionOrThrow("unrelated");
    const unrelatedReferenceScan = vi
      .spyOn(unrelated, "findReferencesAsNodes")
      .mockImplementation(() => {
        throw new Error("unrelated declaration was scanned");
      });
    const root = resolveImpactRoot(project, fixture.root, rootRequest("chain"));

    const result = traverseCompilerImpact(project, fixture.root, root, freshness, {
      direction: "outgoing",
      max_depth: 2,
      max_nodes: 10,
      max_edges: 10,
      relationship_kinds: ["reference"],
    });

    expect(unrelatedReferenceScan).not.toHaveBeenCalled();
    expect(result.nodes.map((node) => [node.depth, node.endpoint.symbol_path])).toEqual([
      [0, "chain"],
      [1, "middle"],
      [2, "leaf"],
    ]);
    expect(result.incomplete).toBe(false);
  });

  it.each([
    ["edge", { max_nodes: 10, max_edges: 1 }, "edge_limit"],
    ["node", { max_nodes: 2, max_edges: 10 }, "record_limit"],
  ] as const)(
    "stops compiler relationship discovery after bounded %s overflow",
    async (_limit, budgets, reason) => {
      const fixture = await createProjectFixture({
        "src/target.ts": "export function target(): number { return 1; }\n",
        "src/a.ts": 'import { target } from "./target.js"; export const a = target();\n',
        "src/b.ts": 'import { target } from "./target.js"; export const b = target();\n',
        "src/z.ts": 'import { target } from "./target.js"; export const z = target();\n',
      });
      fixtures.push(fixture);
      const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
      const lateSource = project.getSourceFileOrThrow(path.join(fixture.root, "src/z.ts"));
      const lateScan = vi.spyOn(lateSource, "forEachDescendant");
      const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/target.ts"));

      try {
        const result = traverseCompilerImpact(project, fixture.root, root, freshness, {
          direction: "incoming",
          max_depth: 1,
          ...budgets,
          relationship_kinds: ["reference"],
        });

        expect(lateScan).toHaveBeenCalled();
        expect(result).toMatchObject({
          visited_edges: 1,
          incomplete: true,
          truncation: { truncated: true, reason },
        });
      } finally {
        lateScan.mockRestore();
      }
    },
  );

  it("keeps an exact edge-cap result complete until a distinct overflow is proven", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export function target(): number { return 1; }\n",
      "src/a.ts": 'import { target } from "./target.js"; export const a = target();\n',
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/target.ts"));

    const result = traverseCompilerImpact(project, fixture.root, root, freshness, {
      direction: "incoming",
      max_depth: 1,
      max_nodes: 10,
      max_edges: 1,
      relationship_kinds: ["reference"],
    });

    expect(result).toMatchObject({
      visited_nodes: 2,
      visited_edges: 1,
      incomplete: false,
      truncation_reasons: [],
    });
  });

  it("does not spend remaining node capacity as an edge-discovery limit", () => {
    const endpoint = (name: string) => ({
      file: `src/${name}.ts`,
      symbol_path: name,
      selector: `${name}@1`,
    });
    const root = endpoint("root");
    const first = endpoint("first");
    const second = endpoint("second");
    const edge = (relationshipId: string, target: typeof first): RelationshipEdge => ({
      ...createRelationshipEdge({
        source: root,
        target,
        kind: "reference",
        provenance: "compiler",
        confidence: "exact",
        resolution: "resolved",
        freshness,
      }),
      relationship_id: relationshipId,
    });

    const result = traverseImpact(
      root,
      [edge("a-first", first), edge("b-first", first), edge("c-second", second)],
      {
        direction: "outgoing",
        max_depth: 1,
        max_nodes: 3,
        max_edges: 3,
        relationship_kinds: ["reference"],
      },
    );

    expect(result.nodes.map((node) => node.endpoint.symbol_path)).toEqual([
      "root",
      "first",
      "second",
    ]);
    expect(result.visited_edges).toBe(3);
  });

  it.each([
    ["depth", { max_depth: 1, max_nodes: 10 }, ["depth_limit", "edge_limit"]],
    ["node", { max_depth: 10, max_nodes: 2 }, ["record_limit", "edge_limit"]],
  ] as const)("reports edge and %s overflow independently", (_limit, budgets, reasons) => {
    const endpoint = (name: string) => ({
      file: `src/${name}.ts`,
      symbol_path: name,
      selector: `${name}@1`,
    });
    const root = endpoint("root");
    const first = endpoint("first");
    const second = endpoint("second");
    const edge = (
      relationshipId: string,
      source: typeof root,
      target: typeof root,
    ): RelationshipEdge => ({
      ...createRelationshipEdge({
        source,
        target,
        kind: "reference",
        provenance: "compiler",
        confidence: "exact",
        resolution: "resolved",
        freshness,
      }),
      relationship_id: relationshipId,
    });

    const result = traverseImpact(
      root,
      [
        edge("root-first", root, first),
        edge("first-root", first, root),
        edge("first-second", first, second),
      ],
      {
        direction: "outgoing",
        max_edges: 2,
        relationship_kinds: ["reference"],
        ...budgets,
      },
    );

    expect(result.truncation_reasons).toEqual(reasons);
  });

  it("reports depth and node limits when an admitted node has an incoming neighbor", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export function target(): number { return 1; }\n",
      "src/a.ts": 'import { target } from "./target.js"; export const a = target();\n',
      "src/b.ts": 'import { target } from "./target.js"; export const b = target();\n',
      "src/c.ts": 'import { a } from "./a.js"; export const c = a;\n',
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/target.ts"));

    const result = traverseCompilerImpact(project, fixture.root, root, freshness, {
      direction: "incoming",
      max_depth: 1,
      max_nodes: 2,
      max_edges: 10,
      relationship_kinds: ["reference"],
    });

    expect(result.truncation_reasons).toEqual(["depth_limit", "record_limit"]);
  });

  it("probes bounded compiler discovery at a zero-depth traversal", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export function target(): number { return 1; }\n",
      "src/a.ts": 'import { target } from "./target.js"; export const a = target();\n',
      "src/z.ts": 'import { target } from "./target.js"; export const z = target();\n',
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const lateSource = project.getSourceFileOrThrow(path.join(fixture.root, "src/z.ts"));
    const lateScan = vi.spyOn(lateSource, "forEachDescendant");
    const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/target.ts"));

    try {
      const result = traverseCompilerImpact(project, fixture.root, root, freshness, {
        direction: "incoming",
        max_depth: 0,
        max_nodes: 10,
        max_edges: 10,
        relationship_kinds: ["reference"],
      });

      expect(lateScan).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        visited_nodes: 1,
        visited_edges: 0,
        incomplete: true,
        truncation: { truncated: true, reason: "depth_limit" },
      });
    } finally {
      lateScan.mockRestore();
    }
  });

  it("does not scan references for excluded relationship kinds", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export function target(): number { return 1; }\n",
      "src/unrelated.ts": "export function unrelated(): number { return 0; }\n",
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const unrelated = project.getSourceFileOrThrow(path.join(fixture.root, "src/unrelated.ts"));
    const referenceScan = vi.spyOn(unrelated, "forEachDescendant").mockImplementation(() => {
      throw new Error("excluded reference relationship was scanned");
    });
    const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/target.ts"));

    try {
      const result = traverseCompilerImpact(project, fixture.root, root, freshness, {
        direction: "incoming",
        max_depth: 1,
        max_nodes: 10,
        max_edges: 10,
        relationship_kinds: ["extends"],
      });

      expect(referenceScan).not.toHaveBeenCalled();
      expect(result).toMatchObject({ visited_edges: 0, incomplete: false });
    } finally {
      referenceScan.mockRestore();
    }
  });

  it("matches full-graph direct compiler evidence for references, modules, and heritage", async () => {
    const fixture = await createProjectFixture({
      "src/base.ts": [
        "export interface Base { run(): void; }",
        "export class Parent {}",
        "export function formatValue(value: number): string { return String(value); }",
      ].join("\n"),
      "src/child.ts": [
        'import { Base, Parent, formatValue } from "./base.js";',
        "export class Child extends Parent implements Base {",
        "  run(): void { formatValue(1); }",
        "}",
        'export { formatValue as reExported } from "./base.js";',
      ].join("\n"),
      "src/use.ts": [
        'import { formatValue } from "./base.js";',
        "export const result = formatValue(42);",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const cases = [
      rootRequest("formatValue", "src/base.ts"),
      rootRequest("Parent", "src/base.ts"),
      rootRequest("Base", "src/base.ts"),
    ];

    for (const request of cases) {
      const root = resolveImpactRoot(project, fixture.root, request);
      const options = {
        direction: "incoming" as const,
        max_depth: 1,
        max_nodes: 20,
        max_edges: 30,
        relationship_kinds: RELATIONSHIP_EDGE_KINDS.filter(
          (kind) => kind !== "call" && kind !== "contains",
        ),
      };
      const expected = traverseImpact(root, edges, options);
      const actual = traverseCompilerImpact(project, fixture.root, root, freshness, options);

      expect(actual.nodes).toEqual(expected.nodes);
      expect(actual.edges).toEqual(expected.edges);
      expect(actual.truncation_reasons).toEqual(expected.truncation_reasons);
    }
  });

  it("matches full-graph member evidence across interface and override chains", async () => {
    const fixture = await createProjectFixture({
      "src/base.ts": "export interface Contract { run(): void; }\n",
      "src/middle.ts": [
        'import { Contract } from "./base.js";',
        "export class Middle implements Contract {",
        "  run(): void {}",
        "}",
      ].join("\n"),
      "src/leaf.ts": [
        'import { Middle } from "./middle.js";',
        "export class Leaf extends Middle {",
        "  run(): void { super.run(); }",
        "}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const cases = [
      rootRequest("Contract.run", "src/base.ts"),
      rootRequest("Middle.run", "src/middle.ts"),
      rootRequest("Leaf.run", "src/leaf.ts"),
    ];

    for (const request of cases) {
      const root = resolveImpactRoot(project, fixture.root, request);
      const options = {
        direction: "both" as const,
        max_depth: 1,
        max_nodes: 20,
        max_edges: 30,
        relationship_kinds: ["reference" as const],
      };
      const expected = traverseImpact(root, edges, options);
      const actual = traverseCompilerImpact(project, fixture.root, root, freshness, options);

      expect(actual.nodes).toEqual(expected.nodes);
      expect(actual.edges).toEqual(expected.edges);
      expect(actual.truncation_reasons).toEqual(expected.truncation_reasons);

      const boundedOptions = { ...options, max_nodes: 2 };
      const boundedExpected = traverseImpact(root, edges, boundedOptions);
      const boundedActual = traverseCompilerImpact(
        project,
        fixture.root,
        root,
        freshness,
        boundedOptions,
      );
      expect(boundedActual.nodes).toEqual(boundedExpected.nodes);
      expect(boundedActual.edges).toEqual(boundedExpected.edges);
      expect(boundedActual.truncation_reasons).toEqual(boundedExpected.truncation_reasons);
    }
  });

  it("does not infer a member reference across incompatible static and instance declarations", async () => {
    const fixture = await createProjectFixture({
      "src/base.ts": ["export class Base {", "  static run(): void {}", "}"].join("\n"),
      "src/child.ts": [
        'import { Base } from "./base.js";',
        "export class Child extends Base {",
        "  run(): void {}",
        "}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const options = {
      direction: "both" as const,
      max_depth: 1,
      max_nodes: 10,
      max_edges: 10,
      relationship_kinds: ["reference" as const],
    };

    for (const request of [
      rootRequest("Base.run", "src/base.ts"),
      rootRequest("Child.run", "src/child.ts"),
    ]) {
      const root = resolveImpactRoot(project, fixture.root, request);
      expect(traverseCompilerImpact(project, fixture.root, root, freshness, options)).toMatchObject(
        traverseImpact(root, edges, options),
      );
    }
  });

  it("does not infer member references between static declarations in related classes", async () => {
    const fixture = await createProjectFixture({
      "src/base.ts": ["export class Base {", "  static launch(): void {}", "}"].join("\n"),
      "src/child.ts": [
        'import { Base } from "./base.js";',
        "export class Child extends Base {",
        "  static override launch(): void {}",
        "}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const options = {
      direction: "both" as const,
      max_depth: 1,
      max_nodes: 10,
      max_edges: 10,
      relationship_kinds: ["reference" as const],
    };

    for (const request of [
      rootRequest("Base.launch", "src/base.ts"),
      rootRequest("Child.launch", "src/child.ts"),
    ]) {
      const root = resolveImpactRoot(project, fixture.root, request);
      const expected = traverseImpact(root, edges, options);
      const actual = traverseCompilerImpact(project, fixture.root, root, freshness, options);

      expect(expected.edges).toEqual([]);
      expect(actual).toMatchObject(expected);
    }
  });

  it("does not infer member references between private declarations in related classes", async () => {
    const fixture = await createProjectFixture({
      "src/base.ts": [
        "export class Base {",
        "  #run(): void {}",
        "  private legacyRun(): void {}",
        "}",
      ].join("\n"),
      "src/child.ts": [
        'import { Base } from "./base.js";',
        "export class Child extends Base {",
        "  #run(): void {}",
        "}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const options = {
      direction: "both" as const,
      max_depth: 1,
      max_nodes: 10,
      max_edges: 10,
      relationship_kinds: ["reference" as const],
    };

    for (const request of [
      rootRequest("Base.#run", "src/base.ts"),
      rootRequest("Child.#run", "src/child.ts"),
      rootRequest("Base.legacyRun", "src/base.ts"),
    ]) {
      const root = resolveImpactRoot(project, fixture.root, request);
      const expected = traverseImpact(root, edges, options);
      const actual = traverseCompilerImpact(project, fixture.root, root, freshness, options);

      expect(expected.edges).toEqual([]);
      expect(actual).toMatchObject(expected);
    }
  });

  it("matches full compiler evidence for computed members, accessors, and overloads", async () => {
    const fixture = await createProjectFixture({
      "src/computed.ts": [
        'const key = "run" as const;',
        "export class ComputedBase { [key](): void {} }",
        "export class ComputedChild extends ComputedBase { override [key](): void {} }",
      ].join("\n"),
      "src/accessors.ts": [
        "export class AccessorBase {",
        "  get value(): number { return 1; }",
        "}",
        "export class AccessorChild extends AccessorBase {",
        "  override get value(): number { return 2; }",
        "  override set value(value: number) {}",
        "}",
      ].join("\n"),
      "src/overloads.ts": [
        "export class OverloadBase {",
        "  run(value: string): string;",
        "  run(value: number): number;",
        "  run(value: string | number): string | number { return value; }",
        "}",
        "export class OverloadChild extends OverloadBase {",
        "  override run(value: string): string;",
        "  override run(value: number): number;",
        "  override run(value: string | number): string | number { return value; }",
        "}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const options = {
      direction: "both" as const,
      max_depth: 1,
      max_nodes: 50,
      max_edges: 100,
      relationship_kinds: ["reference" as const],
    };
    const requests = [
      rootRequest("ComputedBase.[key]", "src/computed.ts"),
      rootRequest("ComputedChild.[key]", "src/computed.ts"),
      rootRequest("AccessorBase.value", "src/accessors.ts"),
      rootRequest("AccessorChild.value@5", "src/accessors.ts"),
      rootRequest("AccessorChild.value@6", "src/accessors.ts"),
      rootRequest("OverloadBase.run", "src/overloads.ts"),
      rootRequest("OverloadChild.run", "src/overloads.ts"),
    ];

    for (const request of requests) {
      const root = resolveImpactRoot(project, fixture.root, request);
      const expected = traverseImpact(root, edges, options);
      const actual = traverseCompilerImpact(project, fixture.root, root, freshness, options);

      expect(actual.nodes, request.symbol_path).toEqual(expected.nodes);
      expect(actual.edges, request.symbol_path).toEqual(expected.edges);
      expect(actual.truncation_reasons).toEqual(expected.truncation_reasons);
      if (request.file_path === "src/computed.ts") {
        expect(expected.edges.some((edge) => edge.target.symbol_path === "key")).toBe(true);
      }
    }
  });

  it("matches compiler references whose declaration and use are string literals", async () => {
    const fixture = await createProjectFixture({
      "src/box.ts": [
        "export class Box {",
        '  "foo"(): number { return 1; }',
        "}",
        'export function use(box: Box): number { return box["foo"](); }',
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const options = {
      direction: "both" as const,
      max_depth: 1,
      max_nodes: 10,
      max_edges: 10,
      relationship_kinds: ["reference" as const],
    };

    for (const request of [
      rootRequest('Box."foo"', "src/box.ts"),
      rootRequest("use", "src/box.ts"),
    ]) {
      const root = resolveImpactRoot(project, fixture.root, request);
      expect(traverseCompilerImpact(project, fixture.root, root, freshness, options)).toMatchObject(
        traverseImpact(root, edges, options),
      );
    }
  });

  it("matches compiler evidence for shorthand value symbols and this expressions", async () => {
    const fixture = await createProjectFixture({
      "src/reference-forms.ts": [
        "export const shared = 1;",
        "export class Box {",
        "  direct = shared;",
        "  object = { shared };",
        "  same = this.direct;",
        "}",
        "export function build() { return { shared }; }",
        "export class Base {",
        "  static launch(): void {}",
        "  static used(): void { this.launch(); }",
        "  static field = this.launch;",
        "  static staticArrow(): void { const call = () => this.launch(); call(); }",
        "}",
        "export class Child extends Base {",
        "  static override launch(): void {}",
        "  instance(): void { Child.launch(); }",
        "}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const options = {
      direction: "both" as const,
      max_depth: 1,
      max_nodes: 50,
      max_edges: 100,
      relationship_kinds: ["reference" as const],
    };

    expect(
      edges.some(
        (edge) => edge.source.symbol_path === "Box.object" && edge.target.symbol_path === "shared",
      ),
    ).toBe(true);
    expect(
      edges.some(
        (edge) => edge.source.symbol_path === "Base.used" && edge.target.symbol_path === "Base",
      ),
    ).toBe(true);
    for (const [source, target] of [
      ["Box.same", "Box"],
      ["Base.field", "Base"],
      ["Base.staticArrow", "Base"],
    ]) {
      expect(
        edges.some(
          (edge) => edge.source.symbol_path === source && edge.target.symbol_path === target,
        ),
        source,
      ).toBe(false);
    }

    for (const request of [
      rootRequest("shared", "src/reference-forms.ts"),
      rootRequest("Box.direct", "src/reference-forms.ts"),
      rootRequest("Box.object", "src/reference-forms.ts"),
      rootRequest("Box.same", "src/reference-forms.ts"),
      rootRequest("build", "src/reference-forms.ts"),
      rootRequest("Base", "src/reference-forms.ts"),
      rootRequest("Base.launch", "src/reference-forms.ts"),
      rootRequest("Base.used", "src/reference-forms.ts"),
      rootRequest("Base.field", "src/reference-forms.ts"),
      rootRequest("Base.staticArrow", "src/reference-forms.ts"),
      rootRequest("Child.launch", "src/reference-forms.ts"),
      rootRequest("Child.instance", "src/reference-forms.ts"),
    ]) {
      const root = resolveImpactRoot(project, fixture.root, request);
      const expected = traverseImpact(root, edges, options);
      const actual = traverseCompilerImpact(project, fixture.root, root, freshness, options);

      expect(actual.nodes, request.symbol_path).toEqual(expected.nodes);
      expect(actual.edges, request.symbol_path).toEqual(expected.edges);
      expect(actual.truncation_reasons, request.symbol_path).toEqual(expected.truncation_reasons);
    }
  });

  it("includes compiler-loaded project sources that are not program roots", async () => {
    const fixture = await createProjectFixture({
      "src/root.ts": [
        'import { useTarget } from "./dep.js";',
        "export function target(): number { return 1; }",
        "export const result = useTarget();",
      ].join("\n"),
      "src/dep.ts": [
        'import { target } from "./root.js";',
        "export function useTarget(): number { return target(); }",
      ].join("\n"),
    });
    await fixture.write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        files: ["src/root.ts"],
      }),
    );
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    expect(project.getProgram().compilerObject.getRootFileNames()).toHaveLength(1);
    expect(
      project.getSourceFiles().map((sourceFile) => path.basename(sourceFile.getFilePath())),
    ).toEqual(expect.arrayContaining(["root.ts", "dep.ts"]));
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/root.ts"));
    const options = {
      direction: "incoming" as const,
      max_depth: 1,
      max_nodes: 10,
      max_edges: 10,
      relationship_kinds: ["reference" as const],
    };

    expect(traverseCompilerImpact(project, fixture.root, root, freshness, options)).toMatchObject(
      traverseImpact(root, edges, options),
    );
  });

  it("does not expose dependency declarations as project impact endpoints", async () => {
    const fixture = await createProjectFixture({
      "node_modules/external-package/package.json": JSON.stringify({
        name: "external-package",
        type: "module",
        types: "index.d.ts",
      }),
      "node_modules/external-package/index.d.ts": "export declare class ExternalValue {}\n",
      "src/root.ts": [
        'import { ExternalValue } from "external-package";',
        "export function createValue(): ExternalValue { return new ExternalValue(); }",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const root = resolveImpactRoot(
      project,
      fixture.root,
      rootRequest("createValue", "src/root.ts"),
    );

    const result = traverseCompilerImpact(project, fixture.root, root, freshness, {
      direction: "outgoing",
      max_depth: 1,
      max_nodes: 10,
      max_edges: 10,
      relationship_kinds: ["reference", "import"],
    });

    expect(result.nodes).toEqual([{ endpoint: root, depth: 0, direct: false }]);
    expect(result.edges).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("node_modules");
  });

  it("matches full-graph neighbor ordering under a tight heterogeneous heritage budget", async () => {
    const fixture = await createProjectFixture({
      "src/base.ts": ["export interface Base {}", "export class Parent {}"].join("\n"),
      "src/child.ts": [
        'import { Base, Parent } from "./base.js";',
        "export class Child extends Parent implements Base {}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const root = resolveImpactRoot(project, fixture.root, rootRequest("Child", "src/child.ts"));
    const options = {
      direction: "outgoing" as const,
      max_depth: 1,
      max_nodes: 2,
      max_edges: 10,
      relationship_kinds: ["extends" as const, "implements" as const],
    };

    const expected = traverseImpact(root, edges, options);
    const actual = traverseCompilerImpact(project, fixture.root, root, freshness, options);

    expect(actual.nodes).toEqual(expected.nodes);
    expect(actual.edges).toEqual(expected.edges);
    expect(actual.truncation_reasons).toEqual(expected.truncation_reasons);
  });

  it("selects the deterministic top import neighbor instead of source declaration order", async () => {
    const fixture = await createProjectFixture({
      "src/a.ts": "export const alpha = 1;\n",
      "src/z.ts": "export const zeta = 1;\n",
      "src/root.ts": [
        'import { zeta } from "./z.js";',
        'import { alpha } from "./a.js";',
        "export const value = zeta + alpha;",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const root = edges.find(
      (edge) => edge.kind === "import" && edge.source.file === "src/root.ts",
    )?.source;
    expect(root).toBeDefined();
    const expected = edges
      .filter(
        (edge) =>
          edge.kind === "import" &&
          edge.source.file === root?.file &&
          edge.source.selector === root.selector,
      )
      .sort(
        (left, right) =>
          left.target.file.localeCompare(right.target.file) ||
          left.target.selector.localeCompare(right.target.selector) ||
          left.relationship_id.localeCompare(right.relationship_id),
      )
      .slice(0, 1);

    const actual = createCompilerRelationshipResolver(project, fixture.root, freshness).edgesFor(
      root!,
      {
        direction: "outgoing",
        relationship_kinds: ["import"],
        max_edges: 1,
      },
    );

    expect(actual.edges).toEqual(expected);
    expect(actual.incomplete).toBe(true);
  });

  it("matches incoming module imports for side effects and namespace bindings", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export {};\n",
      "src/namespace.ts": 'import * as targetNs from "./target.js"; export { targetNs };\n',
      "src/side-effect.ts": 'import "./target.js";\n',
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const target = edges.find(
      (edge) =>
        edge.kind === "import" &&
        edge.target.file === "src/target.ts" &&
        edge.target.symbol_path === "<module>",
    )?.target;
    expect(target).toBeDefined();
    const expected = edges
      .filter(
        (edge) =>
          edge.kind === "import" &&
          edge.target.file === target?.file &&
          edge.target.selector === target.selector,
      )
      .sort((left, right) => left.relationship_id.localeCompare(right.relationship_id));

    const actual = createCompilerRelationshipResolver(project, fixture.root, freshness).edgesFor(
      target!,
      {
        direction: "incoming",
        relationship_kinds: ["import"],
        max_edges: 10,
        max_work_items: 5_000,
      },
    );

    expect(expected.map((edge) => edge.source.file)).toEqual([
      "src/namespace.ts",
      "src/side-effect.ts",
    ]);
    expect(actual.edges).toEqual(expected);
    expect(actual.incomplete).toBe(false);
  });

  it("stops before inspecting compiler source records beyond the work budget", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export {};\n",
      "src/importer.ts": 'import "./target.js";\n',
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const target = edges.find(
      (edge) => edge.kind === "import" && edge.target.file === "src/target.ts",
    )?.target;
    expect(target).toBeDefined();
    const compilerSourceFiles = project.getProgram().compilerObject.getSourceFiles();
    const guardedSourceFile = compilerSourceFiles[1]!;
    const fileNameDescriptor = Object.getOwnPropertyDescriptor(guardedSourceFile, "fileName");
    expect(fileNameDescriptor?.configurable).toBe(true);
    Object.defineProperty(guardedSourceFile, "fileName", {
      configurable: true,
      get: () => {
        throw new Error("inspected a compiler source record beyond max_work_items");
      },
    });

    try {
      const actual = createCompilerRelationshipResolver(project, fixture.root, freshness).edgesFor(
        target!,
        {
          direction: "incoming",
          relationship_kinds: ["import"],
          max_edges: 10,
          max_work_items: 2,
        },
      );

      expect(actual.edges).toEqual([]);
      expect(actual.work_items).toBe(2);
      expect(actual.work_limit_reached).toBe(true);
      expect(actual.incomplete).toBe(true);
    } finally {
      Object.defineProperty(guardedSourceFile, "fileName", fileNameDescriptor!);
    }
  });

  it("does not let excluded module relationship kinds consume the bounded candidate page", async () => {
    const fixture = await createProjectFixture({
      "src/a.ts": "export const alpha = 1;\n",
      "src/b.ts": "export const beta = 1;\n",
      "src/z.ts": "export const zeta = 1;\n",
      "src/root.ts": [
        'import { zeta } from "./z.js";',
        'export { alpha } from "./a.js";',
        'export { beta } from "./b.js";',
        "export const value = zeta;",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const root = edges.find(
      (edge) => edge.kind === "import" && edge.source.file === "src/root.ts",
    )?.source;
    expect(root).toBeDefined();
    const expected = edges.filter(
      (edge) =>
        edge.kind === "import" &&
        edge.source.file === root?.file &&
        edge.source.selector === root.selector,
    );

    const actual = createCompilerRelationshipResolver(project, fixture.root, freshness).edgesFor(
      root!,
      {
        direction: "outgoing",
        relationship_kinds: ["import"],
        max_edges: 1,
      },
    );

    expect(actual.edges).toEqual(expected);
    expect(actual.incomplete).toBe(false);
  });

  it("selects the deterministic top incoming reference within one source file", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export function target(): number { return 1; }\n",
      "src/caller.ts": [
        'import { target } from "./target.js";',
        "export function zUse(): number { return target(); }",
        "export function aUse(): number { return target(); }",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/target.ts"));
    const expected = edges
      .filter(
        (edge) =>
          edge.kind === "reference" &&
          edge.target.file === root.file &&
          edge.target.selector === root.selector,
      )
      .sort(
        (left, right) =>
          left.source.file.localeCompare(right.source.file) ||
          left.source.selector.localeCompare(right.source.selector) ||
          left.relationship_id.localeCompare(right.relationship_id),
      )
      .slice(0, 1);

    const actual = createCompilerRelationshipResolver(project, fixture.root, freshness).edgesFor(
      root,
      {
        direction: "incoming",
        relationship_kinds: ["reference"],
        max_edges: 1,
      },
    );

    expect(actual.edges).toEqual(expected);
    expect(actual.incomplete).toBe(true);
  });

  it("uses relationship ordering before spending a bounded cross-file work budget", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export function target(): number { return 1; }\n",
      "src/Z.ts": [
        'import { target } from "./target.js";',
        "export function upperUse(): number { return target(); }",
      ].join("\n"),
      "src/a.ts": [
        'import { target } from "./target.js";',
        "export function lowerUse(): number { return target(); }",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/target.ts"));
    const expected = edges
      .filter(
        (edge) =>
          edge.kind === "reference" &&
          edge.target.file === root.file &&
          edge.target.selector === root.selector,
      )
      .sort(
        (left, right) =>
          left.source.file.localeCompare(right.source.file) ||
          left.source.selector.localeCompare(right.source.selector) ||
          left.relationship_id.localeCompare(right.relationship_id),
      )
      .slice(0, 1);

    const actual = createCompilerRelationshipResolver(project, fixture.root, freshness).edgesFor(
      root,
      {
        direction: "incoming",
        relationship_kinds: ["reference"],
        max_edges: 1,
        max_work_items: 5_000,
      },
    );

    expect(expected[0]?.source.file).toBe("src/a.ts");
    expect(actual.edges).toEqual(expected);
    expect(actual.incomplete).toBe(true);
    expect(actual.work_items).toBeLessThanOrEqual(5_000);
  });

  it("selects the deterministic top outgoing reference instead of AST descendant order", async () => {
    const fixture = await createProjectFixture({
      "src/functions.ts": [
        "export function a(): number { return 1; }",
        "export function z(): number { return 1; }",
        "export function root(): number { return z() + a(); }",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const edges = collectCompilerRelationships(project, fixture.root, freshness);
    const root = resolveImpactRoot(project, fixture.root, rootRequest("root", "src/functions.ts"));
    const expected = edges
      .filter(
        (edge) =>
          edge.kind === "reference" &&
          edge.source.file === root.file &&
          edge.source.selector === root.selector,
      )
      .sort(
        (left, right) =>
          left.target.file.localeCompare(right.target.file) ||
          left.target.selector.localeCompare(right.target.selector) ||
          left.relationship_id.localeCompare(right.relationship_id),
      )
      .slice(0, 1);

    const actual = createCompilerRelationshipResolver(project, fixture.root, freshness).edgesFor(
      root,
      {
        direction: "outgoing",
        relationship_kinds: ["reference"],
        max_edges: 1,
      },
    );

    expect(actual.edges).toEqual(expected);
    expect(actual.incomplete).toBe(true);
  });

  it.each(["import", "export"] as const)(
    "does not run reference-style descendant scans for incoming %s-only discovery",
    async (relationshipKind) => {
      const fixture = await createProjectFixture({
        "src/target.ts": "export function target(): number { return 1; }\n",
        "src/importer.ts": 'import { target } from "./target.js"; export const value = target();\n',
        "src/reexport.ts": 'export { target } from "./target.js";\n',
        "src/z-unrelated.ts": "export const unrelated = 0;\n",
      });
      fixtures.push(fixture);
      const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
      const edges = collectCompilerRelationships(project, fixture.root, freshness);
      const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/target.ts"));
      const unrelated = project.getSourceFileOrThrow(path.join(fixture.root, "src/z-unrelated.ts"));
      const descendantScan = vi.spyOn(unrelated, "forEachDescendant").mockImplementation(() => {
        throw new Error("unrelated reference-style descendant scan was invoked");
      });
      const unrelatedDeclarationScan = vi
        .spyOn(
          unrelated,
          relationshipKind === "import" ? "getExportDeclarations" : "getImportDeclarations",
        )
        .mockImplementation(() => {
          throw new Error("excluded module declaration scan was invoked");
        });
      const options = {
        direction: "incoming" as const,
        max_depth: 1,
        max_nodes: 10,
        max_edges: 10,
        relationship_kinds: [relationshipKind],
      };

      try {
        const expected = traverseImpact(root, edges, options);
        const actual = traverseCompilerImpact(project, fixture.root, root, freshness, options);

        expect(descendantScan).not.toHaveBeenCalled();
        expect(unrelatedDeclarationScan).not.toHaveBeenCalled();
        expect(actual.nodes).toEqual(expected.nodes);
        expect(actual.edges).toEqual(expected.edges);
        expect(actual.truncation_reasons).toEqual(expected.truncation_reasons);
      } finally {
        descendantScan.mockRestore();
        unrelatedDeclarationScan.mockRestore();
      }
    },
  );

  it.each([
    ["depth", { max_depth: 1, max_nodes: 10 }],
    ["node", { max_depth: 2, max_nodes: 2 }],
  ] as const)(
    "preserves cycle edges between admitted nodes at the %s budget",
    async (_limit, budget) => {
      const fixture = await createProjectFixture({
        "src/cycle.ts": [
          "export function a(): number { return b(); }",
          "export function b(): number { return a(); }",
        ].join("\n"),
      });
      fixtures.push(fixture);
      const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
      const root = resolveImpactRoot(project, fixture.root, rootRequest("a", "src/cycle.ts"));
      const actual = traverseCompilerImpact(project, fixture.root, root, freshness, {
        direction: "outgoing",
        max_edges: 10,
        relationship_kinds: ["reference"],
        ...budget,
      });

      expect(actual.nodes.map((node) => node.endpoint.symbol_path)).toEqual(["a", "b"]);
      expect(actual.edges).toHaveLength(2);
      expect(
        actual.edges.map((edge) => [edge.source.symbol_path, edge.target.symbol_path]),
      ).toEqual([
        ["a", "b"],
        ["b", "a"],
      ]);
      expect(actual.incomplete).toBe(false);
    },
  );

  it("bounds sparse no-hit reference discovery with an explicit work budget", async () => {
    const fixture = await createProjectFixture({
      "src/a.ts": "export const a = 1;\n",
      "src/target.ts": "export function target(): number { return 1; }\n",
      "src/z.ts": "export const z = 1;\n",
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const lateSource = project.getSourceFileOrThrow(path.join(fixture.root, "src/z.ts"));
    const lateScan = vi.spyOn(lateSource, "forEachDescendant").mockImplementation(() => {
      throw new Error("sparse relationship discovery exceeded its work budget");
    });
    const root = resolveImpactRoot(project, fixture.root, rootRequest("target", "src/target.ts"));
    const globalSourceFileScan = vi.spyOn(project, "getSourceFiles").mockImplementation(() => {
      throw new Error("relationship resolver materialized every project source file");
    });

    try {
      const resolution = createCompilerRelationshipResolver(
        project,
        fixture.root,
        freshness,
      ).edgesFor(root, {
        direction: "incoming",
        relationship_kinds: ["reference"],
        max_edges: 1,
        max_work_items: 1,
      });

      expect(lateScan).not.toHaveBeenCalled();
      expect(globalSourceFileScan).not.toHaveBeenCalled();
      expect(resolution.edges).toEqual([]);
      expect(resolution.incomplete).toBe(true);
      expect(resolution.work_limit_reached).toBe(true);
      expect(resolution.work_items).toBe(1);
    } finally {
      lateScan.mockRestore();
      globalSourceFileScan.mockRestore();
    }
  });

  it("resolves an exact endpoint without materializing whole-file symbol arrays", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": [
        "export class TargetContainer {",
        "  target(): number { return 1; }",
        ...Array.from(
          { length: 2_000 },
          (_, index) => `  member${index}(): number { return ${index}; }`,
        ),
        "}",
        ...Array.from({ length: 2_000 }, (_, index) => `export const tail${index} = ${index};`),
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const sourceFile = project.getSourceFileOrThrow(path.join(fixture.root, "src/target.ts"));
    const targetClass = sourceFile.getClassOrThrow("TargetContainer");
    const lateMemberName = vi
      .spyOn(targetClass.getMethodOrThrow("member1999"), "getName")
      .mockImplementation(() => {
        throw new Error("endpoint lookup inspected a later class member");
      });
    const lateDeclarationName = vi
      .spyOn(sourceFile.getVariableDeclarationOrThrow("tail1999"), "getName")
      .mockImplementation(() => {
        throw new Error("endpoint lookup inspected a later declaration");
      });
    const statementMaterialization = vi
      .spyOn(sourceFile, "getStatements")
      .mockImplementation(() => {
        throw new Error("endpoint lookup materialized every source-file statement");
      });
    const memberMaterialization = vi.spyOn(targetClass, "getMembers").mockImplementation(() => {
      throw new Error("endpoint lookup materialized every class member");
    });

    try {
      const root = resolveImpactRoot(
        project,
        fixture.root,
        rootRequest("TargetContainer.target", "src/target.ts"),
      );
      const resolution = createCompilerRelationshipResolver(
        project,
        fixture.root,
        freshness,
      ).edgesFor(root, {
        direction: "outgoing",
        relationship_kinds: ["reference"],
        max_edges: 1,
        max_work_items: 3,
      });

      expect(statementMaterialization).not.toHaveBeenCalled();
      expect(memberMaterialization).not.toHaveBeenCalled();
      expect(lateMemberName).not.toHaveBeenCalled();
      expect(lateDeclarationName).not.toHaveBeenCalled();
      expect(resolution.edges).toEqual([]);
      expect(resolution.work_items).toBe(3);
      expect(resolution.work_limit_reached).toBe(true);
    } finally {
      statementMaterialization.mockRestore();
      memberMaterialization.mockRestore();
      lateMemberName.mockRestore();
      lateDeclarationName.mockRestore();
    }
  });

  it("keeps compiler work capacity independent from the requested edge capacity", async () => {
    const fixture = await createProjectFixture({
      "src/matrix.ts": [
        "export const shared = 1;",
        "export class Matrix {",
        "  static target = 0;",
        "  static methodDirect(): number { return this.target; }",
        "  static methodArrow(): number { const read = () => this.target; return read(); }",
        "  static get getterDirect(): number { return this.target; }",
        "  static set setterDirect(value: number) { this.target = value; }",
        "  static fieldDirect = this.target;",
        "  shorthand = { shared };",
        "  static { this.target; }",
        "}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const oracle = collectCompilerRelationships(project, fixture.root, freshness);
    const root = resolveImpactRoot(project, fixture.root, {
      file_path: "src/matrix.ts",
      symbol_path: "Matrix",
    });
    const target = resolveImpactRoot(project, fixture.root, {
      file_path: "src/matrix.ts",
      symbol_path: "Matrix.target",
    });
    const edgeLimitedOptions = {
      direction: "outgoing" as const,
      relationship_kinds: ["reference" as const],
      max_depth: 1,
      max_nodes: 200,
      max_edges: 1,
    };
    const completeOptions = {
      direction: "incoming" as const,
      relationship_kinds: ["reference" as const],
      max_depth: 1,
      max_nodes: 200,
      max_edges: 400,
    };

    expect(
      traverseCompilerImpact(project, fixture.root, root, freshness, edgeLimitedOptions),
    ).toMatchObject(traverseImpact(root, oracle, edgeLimitedOptions));
    expect(
      traverseCompilerImpact(project, fixture.root, target, freshness, completeOptions),
    ).toMatchObject(traverseImpact(target, oracle, completeOptions));
  });

  it("reports simultaneous node and edge exhaustion independently", async () => {
    const fixture = await createProjectFixture({
      "src/base.ts": ["export interface Base {}", "export class Parent {}"].join("\n"),
      "src/child.ts": [
        'import { Base, Parent } from "./base.js";',
        "export class Child extends Parent implements Base {}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const oracle = collectCompilerRelationships(project, fixture.root, freshness);
    const root = resolveImpactRoot(project, fixture.root, {
      file_path: "src/child.ts",
      symbol_path: "Child",
    });
    const options = {
      direction: "outgoing" as const,
      relationship_kinds: ["extends" as const, "implements" as const, "reference" as const],
      max_depth: 1,
      max_nodes: 2,
      max_edges: 2,
    };
    const actual = traverseCompilerImpact(project, fixture.root, root, freshness, options);

    expect(actual.truncation_reasons).toEqual(["record_limit", "edge_limit"]);
    expect(actual).toMatchObject(traverseImpact(root, oracle, options));
  });

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

describe("compiler impact coverage and request work", () => {
  it("covers RCR-001..004 with fourteen ordered root-class cells and fail-closed precedence", async () => {
    const { fixture, project } = await graphFixture();
    const root = resolveImpactRoot(project, fixture.root, rootRequest("chain"));
    const result = traverseCompilerImpact(project, fixture.root, root, freshness, {
      direction: "both",
      relationship_kinds: [...RELATIONSHIP_EDGE_KINDS].reverse(),
    });

    expect(result.coverage.map(({ kind, direction }) => `${kind}/${direction}`)).toEqual(
      RELATIONSHIP_EDGE_KINDS.flatMap((kind) => [`${kind}/incoming`, `${kind}/outgoing`]),
    );
    expect(result.coverage.every(({ endpoint_class }) => endpoint_class === "symbol")).toBe(true);
    const statuses = Object.fromEntries(
      result.coverage.map(({ kind, direction, status }) => [`${kind}/${direction}`, status]),
    );
    expect(statuses).toMatchObject({
      "reference/incoming": "completed",
      "import/outgoing": "not_applicable",
      "contains/outgoing": "completed",
    });
    expect(result).toMatchObject({ incomplete: false, proven_empty: false });

    const observations: RelationshipCoverageEntry[] = [
      { kind: "reference", direction: "incoming", endpoint_class: "symbol", status: "completed" },
      { kind: "reference", direction: "incoming", endpoint_class: "symbol", status: "unsupported" },
      { kind: "reference", direction: "incoming", endpoint_class: "symbol", status: "unfinished" },
    ];
    expect(aggregateRelationshipCoverage(observations, "symbol")).toEqual([
      { kind: "reference", direction: "incoming", endpoint_class: "symbol", status: "unfinished" },
    ]);

    const safe = traverseCompilerImpact(project, fixture.root, root, freshness, {
      direction: "outgoing",
      relationship_kinds: ["import"],
    });
    expect(safe.coverage).toEqual([
      { kind: "import", direction: "outgoing", endpoint_class: "symbol", status: "not_applicable" },
    ]);
    expect(safe).toMatchObject({ incomplete: false, proven_empty: true });
  });

  it("covers RCR-005..006 with one shared work record and typed cancellation", async () => {
    const { fixture, project } = await graphFixture();
    const root = resolveImpactRoot(project, fixture.root, rootRequest("chain"));
    const exhausted = traverseCompilerImpact(
      project,
      fixture.root,
      root,
      freshness,
      { direction: "outgoing", max_depth: 2, relationship_kinds: ["reference"] },
      undefined,
      { max_work_items: 5 },
    );

    expect(exhausted.work).toEqual({ max_items: 5, consumed_items: 5, exhausted: true });
    expect(exhausted.truncation_reasons).toEqual(["work_limit"]);
    expect(exhausted.coverage.some(({ status }) => status === "unfinished")).toBe(true);
    expect(exhausted.incomplete).toBe(true);

    expect(() =>
      traverseCompilerImpact(
        project,
        fixture.root,
        root,
        freshness,
        {},
        createRequestContext(AbortSignal.abort()),
      ),
    ).toThrow(expect.objectContaining({ code: "REQUEST_CANCELLED" }));
  });
});

describe("scoped direct contains relationships", () => {
  it("emits direct module and symbol children with exact inverse edges", async () => {
    const fixture = await createProjectFixture({
      "src/tree.ts": [
        'import type { External } from "./types.js";',
        "export const top = 1;",
        "export class Outer<T> {",
        "  field = 1;",
        "  constructor() {}",
        "  method(param: T): void {",
        "    const localArrow = () => param;",
        "    function hiddenFunction(): void {}",
        "    class HiddenClass {}",
        "    void localArrow; void hiddenFunction; void HiddenClass;",
        "  }",
        "}",
        "export namespace Space {",
        "  export class Inner {",
        "    constructor() {}",
        "    method(): void {}",
        "  }",
        "}",
        "export const anonymousClass = class { hidden(): void {} };",
        "export default class {}",
      ].join("\n"),
      "src/types.ts": "export interface External {}\n",
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const contains = (symbolPath: string, direction: "incoming" | "outgoing", maxDepth = 1) =>
      traverseCompilerImpact(
        project,
        fixture.root,
        resolveImpactRoot(project, fixture.root, rootRequest(symbolPath, "src/tree.ts")),
        freshness,
        {
          direction,
          max_depth: maxDepth,
          max_nodes: 30,
          max_edges: 30,
          relationship_kinds: ["contains"],
        },
        undefined,
        { max_work_items: 100_000 },
      );

    const resolver = createCompilerRelationshipResolver(project, fixture.root, freshness);
    const moduleOutgoing = resolver.edgesFor(
      { file: "src/tree.ts", symbol_path: "<module>", selector: "<module>@1" },
      {
        direction: "outgoing",
        relationship_kinds: ["contains"],
        max_edges: 30,
        max_work_items: 100_000,
      },
    );
    expect(moduleOutgoing.edges.map(({ target }) => target.symbol_path)).toEqual([
      "anonymousClass",
      "Outer",
      "Space",
      "top",
    ]);
    expect(moduleOutgoing.coverage).toEqual([
      { kind: "contains", direction: "outgoing", endpoint_class: "module", status: "completed" },
    ]);
    expect(moduleOutgoing.incomplete).toBe(false);

    const outerOutgoing = contains("Outer", "outgoing");
    expect(outerOutgoing.edges.map(({ target }) => target.symbol_path)).toEqual([
      "Outer.constructor",
      "Outer.field",
      "Outer.method",
    ]);
    expect(
      contains("Outer.method", "incoming").edges.map(({ source }) => source.symbol_path),
    ).toEqual(["Outer"]);
    expect(contains("Outer", "incoming").edges.map(({ source }) => source.symbol_path)).toEqual([
      "<module>",
    ]);

    const namespaceTraversal = contains("Space", "outgoing", 2);
    expect(
      namespaceTraversal.edges.map(({ source, target }) => [
        source.symbol_path,
        target.symbol_path,
      ]),
    ).toEqual([
      ["Space.Inner", "Space.Inner.constructor"],
      ["Space.Inner", "Space.Inner.method"],
      ["Space", "Space.Inner"],
    ]);
    expect(
      namespaceTraversal.edges.some(
        ({ source, target }) =>
          source.symbol_path === "Space" && target.symbol_path === "Space.Inner.method",
      ),
    ).toBe(false);
    expect(
      namespaceTraversal.edges.every(
        ({ provenance, confidence, resolution, compiler_authoritative }) =>
          provenance === "compiler" &&
          confidence === "exact" &&
          resolution === "resolved" &&
          compiler_authoritative,
      ),
    ).toBe(true);
  });

  it("excludes non-symbol children and preserves bounds, cancellation, filters, and empty results", async () => {
    const fixture = await createProjectFixture({
      "src/tree.ts": [
        "export class Owner<T> {",
        "  constructor(_value?: T) {}",
        "  method(parameter: T): void {",
        "    const callback = function namedRuntimeOwner(): void {};",
        "    class RuntimeNested {}",
        "    callback(); void RuntimeNested;",
        "  }",
        "}",
        "export class Empty {}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const root = resolveImpactRoot(project, fixture.root, rootRequest("Owner", "src/tree.ts"));
    const resolver = createCompilerRelationshipResolver(project, fixture.root, freshness);
    const query = {
      direction: "outgoing" as const,
      relationship_kinds: ["contains" as const],
      max_work_items: 100_000,
    };
    const all = resolver.edgesFor(root, { ...query, max_edges: 10 });

    expect(all.edges.map(({ target }) => target.symbol_path)).toEqual([
      "Owner.constructor",
      "Owner.method",
    ]);
    expect(JSON.stringify(all.edges)).not.toMatch(
      /parameter|<T>|callback|namedRuntimeOwner|RuntimeNested/,
    );
    expect(all.edges.map(({ relationship_id }) => relationship_id)).toEqual(
      [...all.edges].map(({ relationship_id }) => relationship_id).sort(),
    );
    const first = all.edges[0]!;
    const firstKey = `${first.target.file}\u0000${first.target.symbol_path}\u0000${first.target.selector}`;
    expect(
      resolver.edgesFor(root, { ...query, max_edges: 10, allowed_neighbor_keys: [firstKey] }).edges,
    ).toEqual([first]);
    expect(
      resolver.edgesFor(root, {
        ...query,
        max_edges: 10,
        excluded_relationship_ids: [first.relationship_id],
      }).edges,
    ).toHaveLength(1);
    expect(resolver.edgesFor(root, { ...query, max_edges: 1 })).toMatchObject({
      edges: [first],
      incomplete: true,
      edge_limit_reached: true,
    });
    expect(
      createCompilerRelationshipResolver(project, fixture.root, freshness).edgesFor(root, {
        ...query,
        max_edges: 10,
        max_work_items: 3,
      }),
    ).toMatchObject({ edges: [], incomplete: true, work_limit_reached: true });
    expect(() =>
      createCompilerRelationshipResolver(
        project,
        fixture.root,
        freshness,
        createRequestContext(AbortSignal.abort()),
      ).edgesFor(root, { ...query, max_edges: 10 }),
    ).toThrow(expect.objectContaining({ code: "REQUEST_CANCELLED" }));

    const empty = traverseCompilerImpact(
      project,
      fixture.root,
      resolveImpactRoot(project, fixture.root, rootRequest("Empty", "src/tree.ts")),
      freshness,
      { direction: "outgoing", relationship_kinds: ["contains"] },
      undefined,
      { max_work_items: 100_000 },
    );
    expect(empty).toMatchObject({ edges: [], incomplete: false, proven_empty: true });

    const moduleIncoming = resolver.edgesFor(
      { file: "src/tree.ts", symbol_path: "<module>", selector: "<module>@1" },
      { direction: "incoming", relationship_kinds: ["contains"], max_edges: 10 },
    );
    expect(moduleIncoming).toMatchObject({ edges: [], incomplete: false });
    expect(moduleIncoming.coverage[0]?.status).toBe("not_applicable");
  });
});

describe("scoped exact call relationships", () => {
  it("emits stable directional edges while excluding unrelated, repeated, and nested sites", async () => {
    const fixture = await createProjectFixture({
      "src/targets.ts": [
        "export function format(value: string): string;",
        "export function format(value: number): number;",
        "export function format(value: string | number): string | number { return value; }",
        "export function unrelated(): void {}",
      ].join("\n"),
      "src/callers.ts": [
        'import { format, unrelated } from "./targets.js";',
        "export function alpha(): void {",
        "  format(1); format(2);",
        '  function nested(): void { format("nested"); }',
        "  void nested;",
        "}",
        "export function other(): void { unrelated(); }",
      ].join("\n"),
      "src/zed.ts": [
        'import { format } from "./targets.js";',
        'export function zed(): void { format("z"); }',
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const impact = (symbol_path: string, file_path: string, direction: "incoming" | "outgoing") =>
      traverseCompilerImpact(
        project,
        fixture.root,
        resolveImpactRoot(project, fixture.root, rootRequest(symbol_path, file_path)),
        freshness,
        {
          direction,
          max_depth: 1,
          max_nodes: 20,
          max_edges: 20,
          relationship_kinds: ["call"],
        },
        undefined,
        { max_work_items: 100_000 },
      );

    const outgoing = impact("alpha", "src/callers.ts", "outgoing");
    expect(outgoing.coverage).toEqual([
      { kind: "call", direction: "outgoing", endpoint_class: "symbol", status: "completed" },
    ]);
    expect(outgoing.edges.map(({ relationship_id }) => relationship_id)).toEqual([
      'call:["src/callers.ts","alpha","alpha@2"]->["src/targets.ts","format","format@3"]',
    ]);
    expect(outgoing.edges.every(({ compiler_authoritative }) => compiler_authoritative)).toBe(true);

    const incoming = impact("format", "src/targets.ts", "incoming");
    expect(incoming.coverage).toEqual([
      { kind: "call", direction: "incoming", endpoint_class: "symbol", status: "completed" },
    ]);
    expect(incoming.edges.map(({ relationship_id }) => relationship_id)).toEqual([
      'call:["src/callers.ts","alpha","alpha@2"]->["src/targets.ts","format","format@3"]',
      'call:["src/zed.ts","zed","zed@2"]->["src/targets.ts","format","format@3"]',
    ]);

    const formatEdge = outgoing.edges[0]!;
    const alpha = resolveImpactRoot(project, fixture.root, rootRequest("alpha", "src/callers.ts"));
    const resolver = createCompilerRelationshipResolver(project, fixture.root, freshness);
    const scopedQuery = {
      direction: "outgoing" as const,
      relationship_kinds: ["call" as const],
      max_edges: 20,
      max_work_items: 100_000,
      allow_provisional_call: true,
    };
    expect(
      resolver
        .edgesFor(alpha, {
          ...scopedQuery,
          allowed_neighbor_keys: [
            `${formatEdge.target.file}\u0000${formatEdge.target.symbol_path}\u0000${formatEdge.target.selector}`,
          ],
        })
        .edges.map(({ relationship_id }) => relationship_id),
    ).toEqual([formatEdge.relationship_id]);
    expect(
      resolver.edgesFor(alpha, {
        ...scopedQuery,
        excluded_relationship_ids: [formatEdge.relationship_id],
      }).edges,
    ).toEqual([]);
  });

  it("isolates unfinished compiler ambiguity to the applicable call direction", async () => {
    const fixture = await createProjectFixture({
      "src/targets.ts": "export function target(): void {}\nexport function other(): void {}\n",
      "src/use.ts": [
        'import { other } from "./targets.js";',
        "export function exactOnly(): void { other(); }",
        "export function uncertain(dynamic: unknown): void {",
        '  if (typeof dynamic === "function") dynamic();',
        "}",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const resolver = createCompilerRelationshipResolver(project, fixture.root, freshness);
    const resolve = (symbol_path: string, file_path: string, direction: "incoming" | "outgoing") =>
      resolver.edgesFor(
        resolveImpactRoot(project, fixture.root, rootRequest(symbol_path, file_path)),
        {
          direction,
          relationship_kinds: ["call"],
          max_edges: 20,
          max_work_items: 100_000,
          allow_provisional_call: true,
        },
      );

    const incoming = resolve("target", "src/targets.ts", "incoming");
    expect(incoming.edges).toEqual([]);
    expect(incoming.coverage).toEqual([
      { kind: "call", direction: "incoming", endpoint_class: "symbol", status: "unfinished" },
    ]);
    expect(incoming.incomplete).toBe(true);
    const both = resolver.edgesFor(
      resolveImpactRoot(project, fixture.root, rootRequest("target", "src/targets.ts")),
      {
        direction: "both",
        relationship_kinds: ["call"],
        max_edges: 20,
        max_work_items: 100_000,
        allow_provisional_call: true,
      },
    );
    expect(both.coverage.map(({ direction, status }) => `${direction}/${status}`)).toEqual([
      "incoming/unfinished",
      "outgoing/completed",
    ]);

    const outgoing = resolve("exactOnly", "src/use.ts", "outgoing");
    expect(outgoing.coverage).toEqual([
      { kind: "call", direction: "outgoing", endpoint_class: "symbol", status: "completed" },
    ]);
    expect(outgoing.edges.map(({ target }) => target.symbol_path)).toEqual(["other"]);

    const unsupported = resolver.edgesFor(
      resolveImpactRoot(project, fixture.root, rootRequest("exactOnly", "src/use.ts")),
      { direction: "outgoing", relationship_kinds: ["call"], max_edges: 20 },
    );
    expect(unsupported.edges).toEqual([]);
    expect(unsupported.coverage[0]?.status).toBe("unsupported");
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
