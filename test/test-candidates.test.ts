import { describe, expect, it } from "vitest";
import {
  createRelationshipEdge,
  type RelationshipEndpoint,
} from "../src/services/relationships.js";
import {
  MAX_TEST_CANDIDATE_CONVENTION_ITEMS,
  MAX_TEST_CANDIDATE_CONVENTION_LENGTH,
  TEST_CANDIDATE_RELATIONSHIP_KINDS,
  findTestCandidates,
  type TestCandidateConventions,
} from "../src/services/test-candidates.js";
import type { CompilerImpactResult } from "../src/services/impact.js";
import { paginate } from "../src/services/pagination.js";

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
    readonly freshnessState?: "fresh" | "pending" | "stale" | "rebuilding" | "degraded";
    readonly provenance?: "compiler" | "syntax" | "heuristic";
    readonly resolution?: "resolved" | "unresolved" | "ambiguous";
    readonly coverageStatus?: "completed" | "not_applicable" | "unsupported" | "unfinished";
    readonly exhausted?: boolean;
  } = {},
): CompilerImpactResult {
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
    provenance: options.provenance ?? "compiler",
    confidence: "exact",
    resolution: options.resolution ?? "resolved",
    freshness:
      options.stale || options.freshnessState !== undefined
        ? {
            state: options.freshnessState ?? "stale",
            causes: ["source_change"],
            checked_at: freshness.checked_at,
          }
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
    relationship_kinds: TEST_CANDIDATE_RELATIONSHIP_KINDS,
    nodes,
    edges: options.intermediate ? [first, second] : [first],
    visited_nodes: nodes.length,
    visited_edges: options.intermediate ? 2 : 1,
    max_depth_reached: options.intermediate ? 2 : 1,
    max_depth: 3,
    max_nodes: 10,
    max_edges: 10,
    coverage: TEST_CANDIDATE_RELATIONSHIP_KINDS.map((kind) => ({
      kind,
      direction: "incoming" as const,
      endpoint_class: "symbol" as const,
      status: options.coverageStatus ?? "completed",
    })),
    work: {
      max_items: 100,
      consumed_items: options.exhausted ? 100 : 10,
      exhausted: options.exhausted ?? false,
    },
    freshness,
    incomplete: options.incomplete ?? false,
    proven_empty: false,
    truncation: options.incomplete
      ? { truncated: true, reason: "depth_limit" }
      : { truncated: false, reason: null },
    truncation_reasons: options.incomplete ? ["depth_limit"] : [],
  };
}

describe("test candidate resolver", () => {
  it("freezes exactly six canonical incoming kinds and excludes contains", () => {
    expect(TEST_CANDIDATE_RELATIONSHIP_KINDS).toEqual([
      "reference",
      "import",
      "export",
      "extends",
      "implements",
      "call",
    ]);
    expect(Object.isFrozen(TEST_CANDIDATE_RELATIONSHIP_KINDS)).toBe(true);
    expect(TEST_CANDIDATE_RELATIONSHIP_KINDS).not.toContain("contains");
  });

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
    ).toEqual([
      expect.objectContaining({
        file: "checks/service.fixture.ts",
        reason: "convention_match",
      }),
    ]);
    expect(
      findTestCandidates(impactFixture({ testFile: "fixtures/service.fixture.ts" }), conventions),
    ).toEqual([]);
    expect(
      findTestCandidates(impactFixture({ testFile: "checks/service.check.ts" }), conventions),
    ).toEqual([
      expect.objectContaining({
        file: "checks/service.check.ts",
        reason: "convention_match",
      }),
    ]);

    const overlappingConventions: TestCandidateConventions = {
      test_file_patterns: ["**/*.test.*", "**/*.check.ts"],
      test_directories: [],
    };
    expect(findTestCandidates(impactFixture(), overlappingConventions)[0]?.reason).toBe(
      "direct_compiler_reference",
    );
    expect(
      findTestCandidates(impactFixture({ intermediate: true }), overlappingConventions)[0]?.reason,
    ).toBe("transitive_compiler_reference");
  });

  it("enforces exported convention count and length bounds", () => {
    const tooManyPatterns = Array.from(
      { length: MAX_TEST_CANDIDATE_CONVENTION_ITEMS + 1 },
      (_, index) => `**/*.case-${index}.ts`,
    );
    const tooLongDirectory = "a".repeat(MAX_TEST_CANDIDATE_CONVENTION_LENGTH + 1);

    expect(() =>
      findTestCandidates(impactFixture(), { test_file_patterns: tooManyPatterns }),
    ).toThrow(`at most ${MAX_TEST_CANDIDATE_CONVENTION_ITEMS} entries`);
    expect(() =>
      findTestCandidates(impactFixture(), { test_directories: [tooLongDirectory] }),
    ).toThrow(`must not exceed ${MAX_TEST_CANDIDATE_CONVENTION_LENGTH} characters`);
  });

  it("returns an empty result only with complete six-kind authority", () => {
    const complete = impactFixture({ testFile: "src/service-consumer.ts" });
    expect(findTestCandidates(complete)).toEqual([]);

    for (const coverageStatus of ["unsupported", "unfinished"] as const) {
      expect(() =>
        findTestCandidates({
          ...complete,
          coverage: [
            { ...complete.coverage[0]!, status: coverageStatus },
            ...complete.coverage.slice(1),
          ],
        }),
      ).toThrow(/coverage/i);
    }
    expect(() => findTestCandidates({ ...complete, coverage: complete.coverage.slice(1) })).toThrow(
      /coverage/i,
    );
    expect(() =>
      findTestCandidates({ ...complete, coverage: [...complete.coverage].reverse() }),
    ).toThrow(/coverage/i);
    expect(() =>
      findTestCandidates({ ...complete, work: { ...complete.work, exhausted: true } }),
    ).toThrow(/work/i);
  });

  it("paginates whole candidates without splitting relationship proof", () => {
    const impact = impactFixture({ intermediate: true });
    const directTest = endpoint("test/service.integration.test.ts", "<module>", "<module>@2");
    const directEdge = createRelationshipEdge({
      source: directTest,
      target: impact.root,
      kind: "reference",
      provenance: "compiler",
      confidence: "exact",
      resolution: "resolved",
      freshness,
    });
    const candidates = findTestCandidates({
      ...impact,
      nodes: [...impact.nodes, { endpoint: directTest, depth: 1, direct: true }],
      edges: [...impact.edges, directEdge],
      visited_nodes: impact.visited_nodes + 1,
      visited_edges: impact.visited_edges + 1,
    });

    const page = paginate(candidates, 1, 1);

    expect(page).toMatchObject({ offset: 1, limit: 1, total: 2, has_more: false });
    expect(page.items[0]?.evidence.relationships).toEqual(candidates[1]?.evidence.relationships);
    expect(page.items[0]?.evidence.relationships).toHaveLength(2);
  });

  it.each([
    [
      "excluded contains evidence",
      {
        ...impactFixture(),
        edges: impactFixture().edges.map((edge) => ({ ...edge, kind: "contains" as const })),
      },
    ],
    ["stale evidence", impactFixture({ stale: true })],
    ["rebuilding evidence", impactFixture({ freshnessState: "rebuilding" })],
    ["degraded evidence", impactFixture({ freshnessState: "degraded" })],
    ["truncated impact", impactFixture({ incomplete: true })],
    ["unresolved evidence", impactFixture({ resolution: "unresolved" })],
    ["heuristic evidence", impactFixture({ provenance: "heuristic" })],
    [
      "non-authoritative evidence",
      {
        ...impactFixture(),
        edges: impactFixture().edges.map((edge) => ({
          ...edge,
          compiler_authoritative: false as const,
        })),
      },
    ],
  ])("rejects %s instead of presenting an exact candidate", (_label, impact) => {
    expect(() => findTestCandidates(impact)).toThrow(/exact|complete|fresh/i);
  });
});
