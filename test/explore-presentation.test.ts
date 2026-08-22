import { describe, expect, it } from "vitest";
import {
  presentExploreClusters,
  type ExploreOmission,
} from "../src/services/explore-presentation.js";

const symbol = (selector: string, signature = `function ${selector}(): void`) => ({
  file: "src/value.ts",
  selector,
  kind: "FunctionDeclaration",
  signature,
});

const present = (
  clusters: Array<{
    symbol: ReturnType<typeof symbol>;
    evidence?: { selector: string; source?: { text: string }; references?: { has_more: boolean } };
  }>,
  overrides: {
    maxBytes?: number;
    omissions?: ExploreOmission[];
    callSpines?: { root: { selector: string }; incomplete: boolean; paths: unknown[] };
  } = {},
) =>
  presentExploreClusters({
    base: { route: "query" as const },
    clusters,
    offset: 0,
    limit: clusters.length,
    total: clusters.length,
    maxBytes: overrides.maxBytes ?? 4096,
    omissions: overrides.omissions ?? [],
    omissionDetailLimit: 20,
    callSpines: overrides.callSpines,
  });

describe("explore presentation", () => {
  it("produces a stable atomic page with exact fixed-point bytes", () => {
    const clusters = [
      { symbol: symbol("alpha"), evidence: { selector: "alpha", source: { text: "α" } } },
      { symbol: symbol("beta"), evidence: { selector: "beta", source: { text: "β" } } },
    ];

    const first = present(clusters);
    const second = present(clusters);

    expect(second).toEqual(first);
    expect(Buffer.byteLength(JSON.stringify(first), "utf8")).toBe(first.budget.used_bytes);
    expect(first.evidence.map((item) => item.selector)).toEqual(["alpha", "beta"]);
  });

  it("downgrades an oversized cluster atomically and advances by the consumed symbol", () => {
    const cluster = {
      symbol: symbol("huge", "x".repeat(2000)),
      evidence: { selector: "huge", source: { text: "y".repeat(2000) } },
    };
    const selectorOnlyBytes =
      Buffer.byteLength(JSON.stringify(present([{ symbol: symbol("huge") }]))) + 300;

    const result = present([cluster], { maxBytes: selectorOnlyBytes });

    expect(result.symbols).toEqual([
      { file: "src/value.ts", selector: "huge", kind: "FunctionDeclaration" },
    ]);
    expect(result.evidence).toEqual([]);
    expect(result.next_offset).toBeNull();
    expect(result.budget.used_bytes).toBeLessThanOrEqual(selectorOnlyBytes);
    expect(result.omissions.counts).toEqual([
      { category: "budget", component: "signature", count: 1 },
      { category: "budget", component: "source", count: 1 },
    ]);
  });

  it("omits a requested call-spine aggregate atomically when its full JSON cannot fit", () => {
    const callSpines = {
      root: { selector: "root" },
      incomplete: false,
      paths: [{ relationship_ids: ["edge".repeat(1000)] }],
    };

    const tight = present([{ symbol: symbol("root") }], { maxBytes: 1024, callSpines });

    expect(tight).not.toHaveProperty("call_spines");
    expect(tight.omissions).toMatchObject({
      counts: [{ category: "budget", component: "call_spine", count: 1 }],
      details: [
        {
          subject: "root",
          category: "budget",
          component: "call_spine",
          reason: "byte_limit",
        },
      ],
      total: 1,
      has_more: false,
    });
    expect(tight.completeness).toMatchObject({
      complete: false,
      evidence_complete: false,
      spines_complete: false,
    });
    expect(tight.truncation).toEqual({ truncated: true, reason: "byte_limit" });
    expect(Buffer.byteLength(JSON.stringify(tight), "utf8")).toBe(tight.budget.used_bytes);
    expect(tight.budget.used_bytes).toBeLessThanOrEqual(1024);

    const ample = present([{ symbol: symbol("root") }], { maxBytes: 8192, callSpines });
    expect(ample.call_spines).toEqual(callSpines);
    expect(ample.completeness).toMatchObject({
      complete: true,
      evidence_complete: true,
      spines_complete: true,
    });
  });

  it.each([
    ["budget", "references", "reference_limit"],
    ["incomplete", "source", "source_unresolved"],
    ["untrusted", "call_spine", "non_exact_evidence"],
  ] as const)(
    "reports %s omissions without presenting missing evidence as complete",
    (category, component, reason) => {
      const result = present([{ symbol: symbol("value") }], {
        omissions: [{ subject: "value", category, component, reason }],
      });

      expect(result.omissions).toMatchObject({
        counts: [{ category, component, count: 1 }],
        total: 1,
        has_more: false,
      });
      expect(result.completeness.evidence_complete).toBe(false);
      expect(result).not.toHaveProperty("call_spines");
    },
  );
});
