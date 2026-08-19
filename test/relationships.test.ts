import path from "node:path";
import { Project } from "ts-morph";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectCompilerCallRelationships,
  collectCompilerRelationships,
  createRelationshipEdge,
  type RelationshipEdge,
  type RelationshipEdgeInput,
} from "../src/services/relationships.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

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

describe("compiler-backed relationships", () => {
  it("collects exact references, resolved imports/exports, inheritance, and interfaces", async () => {
    const fixture = await createProjectFixture({
      "src/base.ts": [
        "export interface Base { run(): void; }",
        "export class Parent {}",
        "export function formatValue(value: number): number { return value; }",
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
      "src/unresolved.ts": [
        'import { missing } from "./missing.js";',
        "export const result = missing;",
      ].join("\n"),
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });

    const edges = collectCompilerRelationships(project, fixture.root, freshness());
    const edge = (
      kind: string,
      targetPath: string,
      sourceFile?: string,
    ): RelationshipEdge | undefined =>
      edges.find(
        (candidate) =>
          candidate.kind === kind &&
          candidate.target.symbol_path === targetPath &&
          (!sourceFile || candidate.source.file === sourceFile),
      );

    expect(
      edges.some(
        (candidate) =>
          candidate.kind === "reference" &&
          candidate.source.file === "src/use.ts" &&
          candidate.source.symbol_path === "result" &&
          candidate.target.file === "src/base.ts" &&
          candidate.target.symbol_path === "formatValue",
      ),
    ).toBe(true);

    expect(edge("import", "formatValue", "src/use.ts")).toMatchObject({
      source: { file: "src/use.ts", symbol_path: "<module>" },
      target: { file: "src/base.ts", symbol_path: "formatValue" },
      provenance: "compiler",
      confidence: "exact",
      resolution: "resolved",
      compiler_authoritative: true,
    });
    expect(edge("export", "formatValue")).toMatchObject({
      source: { file: "src/child.ts", symbol_path: "<module>" },
      target: { file: "src/base.ts", symbol_path: "formatValue" },
    });
    expect(edge("extends", "Parent")).toMatchObject({
      source: { file: "src/child.ts", symbol_path: "Child" },
      target: { file: "src/base.ts", symbol_path: "Parent" },
    });
    expect(edge("implements", "Base")).toMatchObject({
      source: { file: "src/child.ts", symbol_path: "Child" },
      target: { file: "src/base.ts", symbol_path: "Base" },
    });

    expect(
      edges.some(
        (candidate) =>
          candidate.source.file === "src/unresolved.ts" ||
          candidate.target.file === "src/unresolved.ts" ||
          candidate.target.symbol_path === "missing",
      ),
    ).toBe(false);
    expect(edges.every((candidate) => candidate.provenance === "compiler")).toBe(true);
  });

  it("classifies only compiler-resolved call, constructor, and tagged-template sites", async () => {
    const fixture = await createProjectFixture({
      "src/targets.ts":
        "export function target(): void {}\nexport class Box {}\nexport function tag(parts: TemplateStringsArray): string { return parts[0]; }",
      "src/use.ts":
        'import { Box, tag, target } from "./targets.js";\ntype Target = typeof target;\nfunction accepts(_callback: () => void): void {}\nexport function caller(dynamic: unknown): void {\n  (((target! as () => void)))();\n  new (Box)();\n  (tag)`value`;\n  const value: Target = target;\n  accepts(target);\n  if (typeof dynamic === "function") dynamic();\n  void value;\n}',
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });

    const calls = collectCompilerCallRelationships(project, fixture.root, freshness());
    const callerCalls = calls.edges.filter((edge) => edge.source.symbol_path === "caller");
    expect(callerCalls.map((edge) => edge.target.symbol_path).sort()).toEqual([
      "Box",
      "accepts",
      "tag",
      "target",
    ]);
    expect(callerCalls.filter((edge) => edge.target.symbol_path === "target")).toHaveLength(1);
    expect(callerCalls.every((edge) => edge.kind === "call" && edge.compiler_authoritative)).toBe(
      true,
    );
    expect(calls.incomplete).toBe(false);

    const generic = collectCompilerRelationships(project, fixture.root, freshness());
    expect(generic.map((edge) => `${edge.kind}:${edge.target.symbol_path}`)).toContain(
      "reference:target",
    );
    expect(generic.some((edge) => edge.kind === "call")).toBe(false);
  });
});
