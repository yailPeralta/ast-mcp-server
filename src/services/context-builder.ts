import { Buffer } from "node:buffer";
import path from "node:path";
import { Node, type SourceFile } from "ts-morph";
import { buildFileOutline, nodeSourceWithLocation, type OutlineSymbol } from "./outline.js";
import { paginate } from "./pagination.js";
import {
  isCooperativeInterruption,
  NO_REQUEST_CONTEXT,
  type RequestContext,
} from "./request-context.js";
import {
  findDeclarationByName,
  getSourceFileOrThrow,
  reportSymbolIndexFailure,
  type ProjectContext,
} from "./project.js";
import { collectSymbolReferences, type SymbolReferences } from "./references.js";
import {
  searchProjectSymbolsWithIndex,
  searchProjectSymbols,
  sourceFileSymbols,
  symbolMatchRank,
  type ProjectSymbolRecord,
} from "./symbols.js";
import type { FreshnessCause, SnapshotState, TruncationReason } from "./read-contracts.js";

export const EXPLORE_DEFAULT_LIMIT = 20;
export const EXPLORE_DEFAULT_REFERENCE_LIMIT = 20;
export const EXPLORE_DEFAULT_MAX_BYTES = 64 * 1024;
export const EXPLORE_MAX_BYTES = 1024 * 1024;

export type ExploreDetail = "selectors" | "summary" | "context" | "full";
export type ExploreRoute = "query" | "file" | "symbol";

export interface ExploreRequest {
  readonly query?: string;
  readonly filePath?: string;
  readonly symbolPath?: string;
  readonly kinds?: readonly string[];
  readonly fileFilter?: string;
  readonly detail: ExploreDetail;
  readonly includeSource?: boolean;
  readonly includeReferences?: boolean;
  readonly referenceDetail: "locations" | "context";
  readonly offset: number;
  readonly limit: number;
  readonly referenceLimit: number;
  readonly maxBytes: number;
}

export interface ExploreSymbol {
  readonly file: string;
  readonly selector: string;
  readonly kind: string;
  readonly symbol_path?: string;
  readonly name?: string;
  readonly line?: number;
  readonly signature?: string;
}

export interface ExploreEvidence {
  readonly selector: string;
  readonly source?: ReturnType<typeof nodeSourceWithLocation>;
  readonly references?: SymbolReferences;
}

export interface ExploreUnresolvedItem {
  readonly selector: string;
  readonly reason: "source_unresolved" | "references_unresolved";
}

export interface ExploreResult {
  readonly route: ExploreRoute;
  readonly query: string | null;
  readonly file: string | null;
  readonly symbol: string | null;
  readonly detail: ExploreDetail;
  readonly symbols: readonly ExploreSymbol[];
  readonly evidence: readonly ExploreEvidence[];
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
  readonly has_more: boolean;
  readonly next_offset: number | null;
  readonly freshness: {
    readonly state: SnapshotState;
    readonly causes: readonly FreshnessCause[];
    readonly checked_at: string | null;
  };
  readonly completeness: {
    readonly complete: boolean;
    readonly symbols_complete: boolean;
    readonly evidence_complete: boolean;
    readonly unresolved: readonly ExploreUnresolvedItem[];
  };
  readonly budget: {
    readonly max_records: number;
    readonly max_bytes: number;
    readonly max_depth: null;
    readonly max_edges: null;
    readonly max_invocations: number;
    readonly used_bytes: number;
  };
  readonly truncation: {
    readonly truncated: boolean;
    readonly reason: TruncationReason | null;
  };
}

function matchesQuery(record: ProjectSymbolRecord, query: string): boolean {
  const normalizedQuery = query.toLowerCase();
  return (
    record.name.toLowerCase().includes(normalizedQuery) ||
    record.symbol_path.toLowerCase().includes(normalizedQuery) ||
    record.selector.toLowerCase().includes(normalizedQuery)
  );
}

function sortRecords(records: ProjectSymbolRecord[], query?: string): ProjectSymbolRecord[] {
  return records.sort((left, right) => {
    if (query) {
      const rank =
        symbolMatchRank(query, {
          symbolPath: left.symbol_path,
          name: left.name,
          line: left.line,
        }) -
        symbolMatchRank(query, {
          symbolPath: right.symbol_path,
          name: right.name,
          line: right.line,
        });
      if (rank !== 0) return rank;
    }
    return (
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.symbol_path.localeCompare(right.symbol_path) ||
      left.kind.localeCompare(right.kind)
    );
  });
}

function recordFromOutlineSymbol(
  sourceFile: SourceFile,
  projectRoot: string,
  symbol: OutlineSymbol,
): ProjectSymbolRecord {
  return {
    file: path.relative(projectRoot, sourceFile.getFilePath()).replaceAll("\\", "/"),
    symbol_path: symbol.symbolPath,
    selector: `${symbol.symbolPath}@${symbol.startLine}`,
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.startLine,
    signature: symbol.signature,
  };
}

function fileRecords(
  sourceFile: SourceFile,
  projectRoot: string,
  requestContext: RequestContext,
): ProjectSymbolRecord[] {
  const outline = buildFileOutline(sourceFile, requestContext);
  if (outline.symbols.length > 0) {
    return outline.symbols.map((symbol) =>
      recordFromOutlineSymbol(sourceFile, projectRoot, symbol),
    );
  }
  return sourceFileSymbols(sourceFile, projectRoot, requestContext);
}

async function projectRecords(
  context: ProjectContext,
  request: ExploreRequest,
  requestContext: RequestContext,
): Promise<{
  context: ProjectContext;
  route: ExploreRoute;
  file: string | null;
  symbol: string | null;
  records: ProjectSymbolRecord[];
}> {
  const { project, projectRoot } = context;
  if (request.filePath) {
    const sourceFile = getSourceFileOrThrow(project, request.filePath);
    const file = path.relative(projectRoot, sourceFile.getFilePath()).replaceAll("\\", "/");

    const requestedSymbolPath = request.symbolPath;
    if (requestedSymbolPath) {
      const node = findDeclarationByName(sourceFile, requestedSymbolPath);
      const record = fileRecords(sourceFile, projectRoot, requestContext).find(
        (candidate) =>
          candidate.symbol_path === requestedSymbolPath ||
          candidate.selector === requestedSymbolPath ||
          (candidate.symbol_path === requestedSymbolPath.split("@")[0] &&
            candidate.line === node.getStartLineNumber()),
      );
      if (!record) {
        throw new Error(`Symbol "${requestedSymbolPath}" could not be projected from ${file}.`);
      }
      return {
        context,
        route: "symbol",
        file,
        symbol: record.selector,
        records: [record],
      };
    }

    const records = fileRecords(sourceFile, projectRoot, requestContext)
      .filter((record) => !request.query || matchesQuery(record, request.query))
      .filter((record) => !request.kinds || request.kinds.includes(record.kind));
    return {
      context,
      route: "file",
      file,
      symbol: null,
      records: sortRecords(records, request.query),
    };
  }

  if (!request.query) {
    throw new Error("ast_explore requires query, file_path, or both file_path and symbol_path.");
  }
  let effectiveContext = context;
  const indexedRecords = await searchProjectSymbolsWithIndex(
    project,
    projectRoot,
    context.status.project,
    context.symbolIndex,
    context.symbolIndexReady,
    {
      query: request.query,
      kinds: request.kinds,
      fileFilter: request.fileFilter,
    },
    async (reason) => {
      effectiveContext = (await reportSymbolIndexFailure(projectRoot, reason)) ?? effectiveContext;
    },
    requestContext,
  );
  return {
    context: effectiveContext,
    route: "query",
    file: null,
    symbol: null,
    records:
      indexedRecords ??
      searchProjectSymbols(
        effectiveContext.project,
        effectiveContext.projectRoot,
        {
          query: request.query,
          kinds: request.kinds,
          fileFilter: request.fileFilter,
        },
        requestContext,
      ),
  };
}

function projectSymbol(detail: ExploreDetail, record: ProjectSymbolRecord): ExploreSymbol {
  const base = { file: record.file, selector: record.selector, kind: record.kind };
  if (detail === "selectors") return base;
  if (detail === "summary" || detail === "context") {
    return { ...base, signature: record.signature };
  }
  return {
    ...base,
    symbol_path: record.symbol_path,
    name: record.name,
    line: record.line,
    signature: record.signature,
  };
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function effectiveExpansion(request: ExploreRequest): { source: boolean; references: boolean } {
  return {
    source: request.includeSource ?? (request.detail === "context" || request.detail === "full"),
    references: request.includeReferences ?? request.detail === "full",
  };
}

export async function buildExploreContext(
  context: ProjectContext,
  request: ExploreRequest,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): Promise<ExploreResult> {
  requestContext.checkpoint();
  const routed = await projectRecords(context, request, requestContext);
  requestContext.checkpoint();
  const effectiveContext = routed.context;
  const page = paginate(routed.records, request.offset, request.limit);
  const expansion = effectiveExpansion(request);
  const unresolved: ExploreUnresolvedItem[] = [];
  const evidence: ExploreEvidence[] = [];

  for (const record of page.items) {
    requestContext.checkpoint();
    let sourceFile: SourceFile;
    try {
      sourceFile = getSourceFileOrThrow(effectiveContext.project, record.file);
    } catch {
      unresolved.push({ selector: record.selector, reason: "source_unresolved" });
      continue;
    }
    let node: Node;
    try {
      node = findDeclarationByName(sourceFile, record.selector);
    } catch {
      unresolved.push({ selector: record.selector, reason: "source_unresolved" });
      continue;
    }
    let source: ReturnType<typeof nodeSourceWithLocation> | undefined;
    let references: SymbolReferences | undefined;
    if (expansion.source) {
      source = nodeSourceWithLocation(node, effectiveContext.projectRoot, requestContext);
    }
    if (expansion.references) {
      try {
        references = collectSymbolReferences(
          node,
          effectiveContext.projectRoot,
          record.selector,
          true,
          request.referenceDetail,
          0,
          request.referenceLimit,
          requestContext,
        );
      } catch (error) {
        if (isCooperativeInterruption(error)) throw error;
        unresolved.push({ selector: record.selector, reason: "references_unresolved" });
      }
    }
    if (source || references) {
      evidence.push({
        selector: record.selector,
        ...(source ? { source } : {}),
        ...(references ? { references } : {}),
      });
    }
  }

  const symbols = page.items.map((record) => projectSymbol(request.detail, record));
  let returnedSymbols = [...symbols];
  let returnedEvidence = [...evidence];
  let reason: TruncationReason | null = page.has_more ? "record_limit" : null;
  let result = createResult(
    effectiveContext,
    request,
    routed.route,
    routed.file,
    routed.symbol,
    returnedSymbols,
    returnedEvidence,
    page.total,
    unresolved,
    reason,
  );

  while (
    jsonBytes(result) > request.maxBytes &&
    (returnedEvidence.length > 0 || returnedSymbols.length > 0)
  ) {
    requestContext.checkpoint();
    reason = "byte_limit";
    if (returnedEvidence.length > 0) {
      returnedEvidence = returnedEvidence.slice(0, -1);
    } else {
      returnedSymbols = returnedSymbols.slice(0, -1);
      const selectors = new Set(returnedSymbols.map((symbol) => symbol.selector));
      returnedEvidence = returnedEvidence.filter((item) => selectors.has(item.selector));
    }
    result = createResult(
      effectiveContext,
      request,
      routed.route,
      routed.file,
      routed.symbol,
      returnedSymbols,
      returnedEvidence,
      page.total,
      unresolved,
      reason,
    );
  }

  requestContext.checkpoint();
  const usedBytes = jsonBytes(result);
  return {
    ...result,
    budget: { ...result.budget, used_bytes: usedBytes },
  };
}

function createResult(
  context: ProjectContext,
  request: ExploreRequest,
  route: ExploreRoute,
  file: string | null,
  symbol: string | null,
  symbols: readonly ExploreSymbol[],
  evidence: readonly ExploreEvidence[],
  total: number,
  unresolved: readonly ExploreUnresolvedItem[],
  reason: TruncationReason | null,
): ExploreResult {
  const hasMore = request.offset + symbols.length < total;
  const nextOffset = hasMore ? request.offset + symbols.length : null;
  const expansion = effectiveExpansion(request);
  const evidenceComplete =
    unresolved.length === 0 &&
    evidence.length >= (expansion.source || expansion.references ? symbols.length : 0);
  const symbolsComplete = !hasMore;
  return {
    route,
    query: request.query ?? null,
    file,
    symbol,
    detail: request.detail,
    symbols,
    evidence,
    offset: request.offset,
    limit: request.limit,
    total,
    has_more: hasMore,
    next_offset: nextOffset,
    freshness: {
      state: context.status.state,
      causes: context.status.causes,
      checked_at: context.status.lastSuccessfulSyncAt,
    },
    completeness: {
      complete: symbolsComplete && evidenceComplete,
      symbols_complete: symbolsComplete,
      evidence_complete: evidenceComplete,
      unresolved,
    },
    budget: {
      max_records: request.limit,
      max_bytes: request.maxBytes,
      max_depth: null,
      max_edges: null,
      max_invocations: 1,
      used_bytes: 0,
    },
    truncation: {
      truncated: reason !== null || hasMore,
      reason: reason ?? (hasMore ? "record_limit" : null),
    },
  };
}
