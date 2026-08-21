import { Buffer } from "node:buffer";
import type { TruncationReason } from "./read-contracts.js";

export type ExploreOmissionCategory = "budget" | "incomplete" | "untrusted";
export type ExploreOmissionComponent = "signature" | "source" | "references" | "call_spine";
export const EXPLORE_OMISSION_REASONS = [
  "byte_limit",
  "reference_limit",
  "source_unresolved",
  "references_unresolved",
  "non_exact_evidence",
  "call_discovery_incomplete",
  "depth_limit",
  "node_limit",
  "edge_limit",
] as const;
export type ExploreOmissionReason = (typeof EXPLORE_OMISSION_REASONS)[number];

export interface ExploreOmission {
  readonly subject: string;
  readonly category: ExploreOmissionCategory;
  readonly component: ExploreOmissionComponent;
  readonly reason: ExploreOmissionReason;
}

interface PresentedSymbol {
  readonly file: string;
  readonly selector: string;
  readonly kind: string;
  readonly signature?: string;
}

interface PresentedEvidence {
  readonly selector: string;
  readonly source?: unknown;
  readonly references?: unknown;
}

interface PresentationInput<
  TBase extends object,
  TSymbol extends PresentedSymbol,
  TEvidence extends PresentedEvidence,
> {
  readonly base: TBase;
  readonly clusters: readonly { readonly symbol: TSymbol; readonly evidence?: TEvidence }[];
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
  readonly maxBytes: number;
  readonly omissions: readonly ExploreOmission[];
  readonly omissionDetailLimit: number;
  readonly spinesComplete?: boolean;
  readonly unresolved?: readonly unknown[];
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function summarize(omissions: readonly ExploreOmission[], detailLimit: number) {
  const details = [...omissions].sort((left, right) =>
    [left.subject, left.category, left.component, left.reason]
      .join("\0")
      .localeCompare([right.subject, right.category, right.component, right.reason].join("\0")),
  );
  const countMap = new Map<string, number>();
  for (const item of omissions) {
    const key = `${item.category}\0${item.component}`;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }
  const counts = [...countMap]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => {
      const [category, component] = key.split("\0") as [
        ExploreOmissionCategory,
        ExploreOmissionComponent,
      ];
      return { category, component, count };
    });
  return {
    counts,
    details: details.slice(0, detailLimit),
    total: omissions.length,
    has_more: details.length > detailLimit,
  };
}

function selectorOnly<TSymbol extends PresentedSymbol>(symbol: TSymbol): TSymbol {
  return { file: symbol.file, selector: symbol.selector, kind: symbol.kind } as TSymbol;
}

function omittedClusterParts<TSymbol extends PresentedSymbol, TEvidence extends PresentedEvidence>(
  symbol: TSymbol,
  evidence: TEvidence | undefined,
): ExploreOmission[] {
  const component = (value: ExploreOmissionComponent): ExploreOmission => ({
    subject: symbol.selector,
    category: "budget",
    component: value,
    reason: "byte_limit",
  });
  return [
    ...(symbol.signature === undefined ? [] : [component("signature")]),
    ...(evidence?.source === undefined ? [] : [component("source")]),
    ...(evidence?.references === undefined ? [] : [component("references")]),
  ];
}

export function presentExploreClusters<
  TBase extends object,
  TSymbol extends PresentedSymbol,
  TEvidence extends PresentedEvidence,
>(input: PresentationInput<TBase, TSymbol, TEvidence>) {
  const symbols: TSymbol[] = [];
  const evidence: TEvidence[] = [];
  let omissions = [...input.omissions];
  let consumed = 0;
  let byteLimited = false;

  const build = (detailLimit: number) => {
    const hasMore = input.offset + consumed < input.total;
    const evidenceComplete =
      omissions.length === 0 &&
      (input.unresolved?.length ?? 0) === 0 &&
      input.spinesComplete !== false;
    const reason: TruncationReason | null = byteLimited
      ? "byte_limit"
      : hasMore
        ? "record_limit"
        : null;
    const result = {
      ...input.base,
      symbols,
      evidence,
      offset: input.offset,
      limit: input.limit,
      total: input.total,
      has_more: hasMore,
      next_offset: hasMore ? input.offset + consumed : null,
      omissions: summarize(omissions, detailLimit),
      completeness: {
        complete: !hasMore && evidenceComplete,
        symbols_complete: !hasMore,
        evidence_complete: evidenceComplete,
        ...(input.spinesComplete === undefined ? {} : { spines_complete: input.spinesComplete }),
        unresolved: input.unresolved ?? [],
      },
      budget: {
        max_records: input.limit,
        max_bytes: input.maxBytes,
        max_depth: null,
        max_edges: null,
        max_invocations: 1,
        used_bytes: 0,
      },
      truncation: { truncated: reason !== null, reason },
    };
    let usedBytes = 0;
    let fixed = result;
    for (let index = 0; index < 10; index += 1) {
      fixed = { ...result, budget: { ...result.budget, used_bytes: usedBytes } };
      const next = jsonBytes(fixed);
      if (next === usedBytes) return fixed;
      usedBytes = next;
    }
    return { ...fixed, budget: { ...fixed.budget, used_bytes: jsonBytes(fixed) } };
  };

  const fittingResult = () => {
    for (let detailLimit = input.omissionDetailLimit; detailLimit >= 0; detailLimit -= 1) {
      const result = build(detailLimit);
      if (result.budget.used_bytes <= input.maxBytes) return result;
    }
    return null;
  };

  for (const cluster of input.clusters) {
    const omissionsBeforeCluster = omissions;
    symbols.push(cluster.symbol);
    if (cluster.evidence) evidence.push(cluster.evidence);
    consumed += 1;
    if (fittingResult()) continue;

    symbols[symbols.length - 1] = selectorOnly(cluster.symbol);
    if (cluster.evidence) evidence.pop();
    omissions = [...omissions, ...omittedClusterParts(cluster.symbol, cluster.evidence)];
    byteLimited = true;
    if (fittingResult()) continue;

    if (symbols.length > 1) {
      symbols.pop();
      consumed -= 1;
      omissions = omissionsBeforeCluster;
      break;
    }
    throw new Error(`max_bytes cannot fit selector ${cluster.symbol.selector}.`);
  }

  const result = fittingResult();
  if (!result) throw new Error("max_bytes cannot fit the ast_explore result shell.");
  return result;
}
