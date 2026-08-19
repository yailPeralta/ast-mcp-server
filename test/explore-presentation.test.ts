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
  overrides: { maxBytes?: number; omissions?: ExploreOmission[] } = {},
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
