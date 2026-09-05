import path from "node:path";
import { Project } from "ts-morph";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectCompilerCallRelationships,
  collectCompilerRelationships,
  CompilerImpactWorkTracker,
  createCompilerRelationshipResolver,
  createRelationshipEdge,
  type RelationshipEdge,
  type RelationshipEdgeInput,
} from "../src/services/relationships.js";
import { resolveImpactRoot } from "../src/services/impact.js";
import { createRequestContext } from "../src/services/request-context.js";
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

type WorkEvent = {
  readonly stage: string;
  readonly count: number;
  readonly before: number;
  readonly after: number;
};

function stageCounts(events: readonly WorkEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.stage] = (counts[event.stage] ?? 0) + event.count;
  return counts;
}

describe("request-wide relationship work accounting", () => {
  it("charges the two-item member-reference pair sort before sorting and fails closed one below", async () => {
    const fixture = await createProjectFixture({
      "src/base.ts": "export interface Base { target(): void; }\n",
      "src/impl.ts":
        'import { Base } from "./base.js"; export class Impl implements Base { target(): void {} }\n',
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const target = resolveImpactRoot(project, fixture.root, {
      file_path: "src/base.ts",
      symbol_path: "Base.target",
    });
    const run = (max: number) => {
      const events: WorkEvent[] = [];
      const tracker = new CompilerImpactWorkTracker(max, (event: WorkEvent) => events.push(event));
      const originalSort = Array.prototype.sort;
      Array.prototype.sort = function (
        this: unknown[],
        compareFn?: (left: unknown, right: unknown) => number,
      ) {
        if (
          this.length === 2 &&
          this.every(
            (pair) =>
              Array.isArray(pair) &&
              pair.length === 2 &&
              pair.every(
                (endpoint) =>
                  typeof endpoint === "object" && endpoint !== null && "file" in endpoint,
              ),
          )
        ) {
          expect(events.at(-1)).toMatchObject({ stage: "candidate.sort", count: 2 });
        }
        return originalSort.call(this, compareFn);
      } as typeof Array.prototype.sort;
      try {
        const resolver = createCompilerRelationshipResolver(
          project,
          fixture.root,
          freshness(),
          undefined,
          tracker,
        );
        const result = resolver.edgesFor(target, {
          direction: "both",
          relationship_kinds: ["reference"],
          max_edges: 10,
        });
        return { events, result, tracker };
      } finally {
        Array.prototype.sort = originalSort;
      }
    };

    const generous = run(100_000);
    expect(generous.result.edges).toHaveLength(2);
    expect(
      generous.events
        .filter(({ stage, count }) => stage === "candidate.sort" && count > 0)
        .map(({ count }) => count),
    ).toEqual([2, 2]);

    const required = generous.tracker.consumed;
    expect(required).toBe(235);
    const exact = run(required);
    expect(exact.result).toEqual(generous.result);

    const below = run(required - 1);
    expect(below.result).toMatchObject({
      edges: [],
      incomplete: true,
      work_limit_reached: true,
      work_items: required - 1,
    });
    expect(below.tracker.exhausted).toBe(true);
  });

  it("uses a fixed exact relationship finalization bound and saturates one below", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export function target(): void {}\n",
      "src/a.ts": 'import { target } from "./target.js"; export function a(): void { target(); }\n',
      "src/b.ts": 'import { target } from "./target.js"; export function b(): void { target(); }\n',
      "src/tree.ts": "export class Owner { first(): void {} second(): void {} third(): void {} }\n",
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const target = resolveImpactRoot(project, fixture.root, {
      file_path: "src/target.ts",
      symbol_path: "target",
    });
    const run = (max: number) => {
      const events: WorkEvent[] = [];
      const tracker = new CompilerImpactWorkTracker(max, (event: WorkEvent) => events.push(event));
      const resolver = createCompilerRelationshipResolver(
        project,
        fixture.root,
        freshness(),
        undefined,
        tracker,
      );
      const result = resolver.edgesFor(target, {
        direction: "both",
        relationship_kinds: ["call"],
        max_edges: 10,
        allow_provisional_call: true,
      });
      return { events, resolver, result, tracker };
    };

    const generous = run(100_000);
    expect(generous.tracker.consumed).toBe(160);
    const exact = run(generous.tracker.consumed);
    const below = run(generous.tracker.consumed - 1);
    expect(stageCounts(generous.events)).toMatchObject({
      "source.enumerate": 67,
      "source.path_sort": 4,
      "source.lookup_emit": 4,
      "producer.dispatch": 2,
      "candidate.retain_attempt": 2,
      "candidate.sort": 2,
      "candidate.emit": 2,
      "merge.scan_retain": 2,
      "merge.sort": 2,
      "selection.scan": 2,
      "selected_id.sort": 2,
      "edge.emit": 2,
    });
    expect(exact.result).toEqual(generous.result);
    expect(exact.events).toEqual(generous.events);
    expect(exact.tracker.snapshot()).toEqual({
      max_items: generous.tracker.consumed,
      consumed_items: generous.tracker.consumed,
      exhausted: false,
    });
    expect(below.result).toMatchObject({
      edges: [],
      incomplete: true,
      work_limit_reached: true,
      work_items: generous.tracker.consumed - 1,
    });

    const priorEvents = generous.events.length;
    const owner = resolveImpactRoot(project, fixture.root, {
      file_path: "src/tree.ts",
      symbol_path: "Owner",
    });
    const contains = generous.resolver.edgesFor(owner, {
      direction: "outgoing",
      relationship_kinds: ["contains"],
      max_edges: 10,
    });
    expect(contains.edges).toHaveLength(3);
    expect(stageCounts(generous.events.slice(priorEvents))).toMatchObject({
      "producer.dispatch": 1,
      "contains.candidate_sort": 3,
      "merge.scan_retain": 3,
      "merge.sort": 3,
      "selection.scan": 3,
      "selected_id.sort": 3,
      "edge.emit": 3,
    });
    expect(
      generous.events.every(
        (event, index) =>
          event.before + event.count === event.after &&
          (index === 0 || event.before === generous.events[index - 1]!.after),
      ),
    ).toBe(true);
  });

  it("accounts the legacy compiler-call collector and lets cancellation win before mutation", async () => {
    const fixture = await createProjectFixture({
      "src/target.ts": "export function target(): void {}\n",
      "src/use.ts":
        'import { target } from "./target.js"; export function use(): void { target(); }\n',
    });
    fixtures.push(fixture);
    const project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    const run = (max: number) => {
      const events: WorkEvent[] = [];
      const tracker = new CompilerImpactWorkTracker(max, (event: WorkEvent) => events.push(event));
      return {
        events,
        tracker,
        result: collectCompilerCallRelationships(project, fixture.root, freshness(), {
          max_edges: 10,
          work_tracker: tracker,
        }),
      };
    };

    const generous = run(100_000);
    expect(generous.tracker.consumed).toBe(27);
    const exact = run(generous.tracker.consumed);
    const below = run(generous.tracker.consumed - 1);
    expect(stageCounts(generous.events)).toMatchObject({
      "legacy.source_sort": 2,
      "legacy.node_scan": 21,
      "legacy.edge_retain": 1,
      "legacy.edge_sort": 1,
      "legacy.selection_scan": 1,
      "legacy.edge_emit": 1,
    });
    expect(exact.result).toEqual(generous.result);
    expect(exact.events).toEqual(generous.events);
    expect(below.result).toEqual({ edges: [], incomplete: true });

    const cancelledEvents: WorkEvent[] = [];
    const cancelled = new CompilerImpactWorkTracker(1, (event: WorkEvent) =>
      cancelledEvents.push(event),
    );
    expect(() =>
      cancelled.charge(createRequestContext(AbortSignal.abort()), 1, "producer.dispatch"),
    ).toThrow(expect.objectContaining({ code: "REQUEST_CANCELLED" }));
    expect(cancelled.snapshot()).toEqual({ max_items: 1, consumed_items: 0, exhausted: false });
    expect(cancelledEvents).toEqual([]);
  });
});
