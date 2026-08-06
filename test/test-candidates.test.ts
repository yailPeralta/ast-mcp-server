import { describe, expect, it } from "vitest";
import {
  createRelationshipEdge,
  type RelationshipEndpoint,
} from "../src/services/relationships.js";
import {
  findTestCandidates,
  type TestCandidateConventions,
} from "../src/services/test-candidates.js";
import type { ImpactResult } from "../src/services/impact.js";

const freshness = {
  state: "fresh" as const,
  causes: [] as const,
  checked_at: "2026-08-06T00:00:00.000Z",
};

function endpoint(file: string, symbolPath: string, selector: string): RelationshipEndpoint {
  return { file, symbol_path: symbolPath, selector };
}

function impactFixture(
  options: {
    readonly testFile?: string;
    readonly testSymbol?: string;
    readonly testSelector?: string;
    readonly intermediate?: boolean;
    readonly incomplete?: boolean;
    readonly stale?: boolean;
  } = {},
): ImpactResult {
  const service = endpoint("src/service.ts", "Service", "Service@1");
  const intermediate = endpoint("src/adapter.ts", "Adapter", "Adapter@1");
  const test = endpoint(
    options.testFile ?? "test/service.test.ts",
    options.testSymbol ?? "<module>",
    options.testSelector ?? "<module>@1",
  );
  const firstTarget = options.intermediate ? intermediate : service;
  const first = createRelationshipEdge({
    source: test,
    target: firstTarget,
    kind: "reference",
    provenance: "compiler",
    confidence: "exact",
    resolution: "resolved",
    freshness: options.stale
      ? { state: "stale", causes: ["source_change"], checked_at: freshness.checked_at }
      : freshness,
  });
  const second = createRelationshipEdge({
    source: intermediate,
    target: service,
    kind: "reference",
    provenance: "compiler",
    confidence: "exact",
    resolution: "resolved",
    freshness,
  });
  const nodes = options.intermediate
    ? [
        { endpoint: service, depth: 0, direct: false },
        { endpoint: intermediate, depth: 1, direct: true },
        { endpoint: test, depth: 2, direct: false },
      ]
    : [
        { endpoint: service, depth: 0, direct: false },
        { endpoint: test, depth: 1, direct: true },
      ];
  return {
    root: service,
    direction: "incoming",
    relationship_kinds: ["reference"],
    nodes,
    edges: options.intermediate ? [first, second] : [first],
    visited_nodes: nodes.length,
    visited_edges: options.intermediate ? 2 : 1,
    max_depth_reached: options.intermediate ? 2 : 1,
    max_depth: 3,
    max_nodes: 10,
    max_edges: 10,
    incomplete: options.incomplete ?? false,
    truncation: options.incomplete
      ? { truncated: true, reason: "depth_limit" }
      : { truncated: false, reason: null },
    truncation_reasons: options.incomplete ? ["depth_limit"] : [],
  };
}

describe("test candidate resolver", () => {
  it("returns a direct candidate with exact compiler evidence", () => {
    const [candidate] = findTestCandidates(impactFixture());

    expect(candidate).toMatchObject({
      file: "test/service.test.ts",
      reason: "direct_compiler_reference",
      confidence: "exact",
      evidence: {
        depth: 1,
        direct: true,
        compiler_authoritative: true,
        relationship_ids: [
          'reference:["test/service.test.ts","<module>","<module>@1"]->["src/service.ts","Service","Service@1"]',
        ],
      },
    });
    expect(candidate.evidence.relationships[0]).toMatchObject({
      kind: "reference",
      provenance: "compiler",
      compiler_authoritative: true,
    });
  });

  it("returns a transitive candidate with lower confidence and complete path evidence", () => {
    const [candidate] = findTestCandidates(impactFixture({ intermediate: true }));

    expect(candidate).toMatchObject({
      file: "test/service.test.ts",
      reason: "transitive_compiler_reference",
      confidence: "high",
      evidence: {
        depth: 2,
        direct: false,
        relationship_ids: expect.arrayContaining([
          'reference:["test/service.test.ts","<module>","<module>@1"]->["src/adapter.ts","Adapter","Adapter@1"]',
          'reference:["src/adapter.ts","Adapter","Adapter@1"]->["src/service.ts","Service","Service@1"]',
        ]),
      },
    });
    expect(candidate.evidence.relationships).toHaveLength(2);
  });

  it("uses configured naming and directory conventions deterministically", () => {
    const conventions: TestCandidateConventions = {
      test_file_patterns: ["**/*.check.ts"],
      test_directories: ["checks"],
    };

    expect(
      findTestCandidates(impactFixture({ testFile: "checks/service.fixture.ts" }), conventions),
    ).toHaveLength(1);
    expect(
      findTestCandidates(impactFixture({ testFile: "fixtures/service.fixture.ts" }), conventions),
    ).toEqual([]);
    expect(
      findTestCandidates(impactFixture({ testFile: "checks/service.check.ts" }), conventions),
    ).toHaveLength(1);
  });

  it.each([
    ["stale evidence", impactFixture({ stale: true })],
    ["truncated impact", impactFixture({ incomplete: true })],
  ])("rejects %s instead of presenting an exact candidate", (_label, impact) => {
    expect(() => findTestCandidates(impact)).toThrow(/exact|complete|fresh/i);
  });
});
