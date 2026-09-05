import path from "node:path";
import {
  Node,
  SyntaxKind,
  type ExportDeclaration,
  type ExportSpecifier,
  type ImportDeclaration,
  type ImportSpecifier,
  type Project,
  type SourceFile,
  type Symbol as MorphSymbol,
  type Type,
  type TypeChecker,
} from "ts-morph";
import {
  createSourceLocation,
  isFreshnessCause,
  isSnapshotState,
  type FreshnessMetadata,
  type SourceRange,
} from "./read-contracts.js";
import {
  collectSymbols,
  containingSymbol,
  findLocatedSymbol,
  forEachLocatedSymbol,
  type LocatedSymbol,
} from "./symbols.js";
import { NO_REQUEST_CONTEXT, type RequestContext } from "./request-context.js";

export const RELATIONSHIP_EDGE_KINDS = Object.freeze([
  "reference",
  "import",
  "export",
  "extends",
  "implements",
  "call",
  "contains",
] as const);

export type RelationshipEdgeKind = (typeof RELATIONSHIP_EDGE_KINDS)[number];

export const RELATIONSHIP_PROVENANCES = Object.freeze(["compiler", "syntax", "heuristic"] as const);

export type RelationshipProvenance = (typeof RELATIONSHIP_PROVENANCES)[number];

export const RELATIONSHIP_CONFIDENCES = Object.freeze(["exact", "high", "medium", "low"] as const);

export type RelationshipConfidence = (typeof RELATIONSHIP_CONFIDENCES)[number];

export const RELATIONSHIP_RESOLUTIONS = Object.freeze([
  "resolved",
  "unresolved",
  "ambiguous",
] as const);

export type RelationshipResolution = (typeof RELATIONSHIP_RESOLUTIONS)[number];

export interface RelationshipEndpointInput {
  readonly file: string;
  readonly symbol_path: string;
  readonly selector: string;
  readonly range?: SourceRange;
}

export interface RelationshipEndpoint {
  readonly file: string;
  readonly symbol_path: string;
  readonly selector: string;
  readonly range?: SourceRange;
}

export interface RelationshipEdgeInput {
  readonly source: RelationshipEndpointInput;
  readonly target: RelationshipEndpointInput;
  readonly kind: RelationshipEdgeKind;
  readonly provenance: RelationshipProvenance;
  readonly confidence: RelationshipConfidence;
  readonly resolution: RelationshipResolution;
  readonly freshness: FreshnessMetadata;
}

export interface RelationshipEdge {
  readonly relationship_id: string;
  readonly source: RelationshipEndpoint;
  readonly target: RelationshipEndpoint;
  readonly kind: RelationshipEdgeKind;
  readonly provenance: RelationshipProvenance;
  readonly confidence: RelationshipConfidence;
  readonly resolution: RelationshipResolution;
  readonly freshness: FreshnessMetadata;
  readonly compiler_authoritative: boolean;
}

function assertNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Relationship ${name} must be a non-empty string.`);
  }
  return value.trim();
}

function assertEnum<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (!values.includes(value as T)) {
    throw new Error(`Relationship ${name} is invalid.`);
  }
  return value as T;
}

function normalizeFreshness(input: FreshnessMetadata): FreshnessMetadata {
  if (
    typeof input !== "object" ||
    input === null ||
    !isSnapshotState(input.state) ||
    !Array.isArray(input.causes) ||
    (input.checked_at !== null && typeof input.checked_at !== "string")
  ) {
    throw new Error("Relationship freshness metadata is invalid.");
  }

  const causes = [...new Set(input.causes)];
  if (!causes.every((cause) => isFreshnessCause(cause))) {
    throw new Error("Relationship freshness contains an invalid cause.");
  }
  if (input.state === "fresh" && causes.length > 0) {
    throw new Error("Fresh relationship evidence cannot carry freshness causes.");
  }

  return Object.freeze({
    state: input.state,
    causes: Object.freeze(causes.sort()),
    checked_at: input.checked_at,
  });
}

function normalizeEndpoint(input: RelationshipEndpointInput): RelationshipEndpoint {
  if (typeof input !== "object" || input === null) {
    throw new Error("Relationship endpoint is invalid.");
  }

  const location = createSourceLocation(input.file, input.range ?? { start_line: 1 });
  const symbolPath = assertNonEmptyString(input.symbol_path, "endpoint symbol_path");
  const selector = assertNonEmptyString(input.selector, "endpoint selector");
  const { file, ...range } = location;

  return Object.freeze({
    file,
    symbol_path: symbolPath,
    selector,
    ...(input.range === undefined ? {} : { range }),
  });
}

function endpointIdentity(endpoint: RelationshipEndpoint): readonly string[] {
  return [endpoint.file, endpoint.symbol_path, endpoint.selector];
}

export function createRelationshipEdge(input: RelationshipEdgeInput): RelationshipEdge {
  if (typeof input !== "object" || input === null) {
    throw new Error("Relationship edge input is invalid.");
  }

  const source = normalizeEndpoint(input.source);
  const target = normalizeEndpoint(input.target);
  const kind = assertEnum(input.kind, RELATIONSHIP_EDGE_KINDS, "edge kind");
  const provenance = assertEnum(input.provenance, RELATIONSHIP_PROVENANCES, "provenance");
  const confidence = assertEnum(input.confidence, RELATIONSHIP_CONFIDENCES, "confidence");
  const resolution = assertEnum(input.resolution, RELATIONSHIP_RESOLUTIONS, "resolution");
  const freshness = normalizeFreshness(input.freshness);
  const compilerAuthoritative =
    provenance === "compiler" &&
    confidence === "exact" &&
    resolution === "resolved" &&
    freshness.state === "fresh";

  return Object.freeze({
    relationship_id: `${kind}:${JSON.stringify(endpointIdentity(source))}->${JSON.stringify(endpointIdentity(target))}`,
    source,
    target,
    kind,
    provenance,
    confidence,
    resolution,
    freshness,
    compiler_authoritative: compilerAuthoritative,
  });
}

interface CompilerRelationshipState {
  readonly projectRoot: string;
  readonly sourceFiles: ReadonlyMap<string, SourceFile>;
  readonly locatedSymbols: ReadonlyMap<Node, LocatedSymbol>;
  readonly freshness: FreshnessMetadata;
  readonly edges: Map<string, RelationshipEdge>;
}

function sourceFileKey(filePath: string): string {
  return path.normalize(filePath);
}

function isProjectScopedFile(projectRoot: string, filePath: string): boolean {
  const relative = path.relative(projectRoot, filePath);
  const insideProject =
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  return insideProject && !relative.split(path.sep).includes("node_modules");
}

function projectRelativeFile(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function nodeRange(node: Node): SourceRange {
  const sourceFile = node.getSourceFile();
  const start = sourceFile.getLineAndColumnAtPos(node.getStart());
  const end = sourceFile.getLineAndColumnAtPos(Math.max(node.getStart(), node.getEnd() - 1));
  return {
    start_line: start.line,
    start_column: start.column,
    end_line: end.line,
    end_column: end.column,
  };
}

function symbolEndpoint(symbol: LocatedSymbol, projectRoot: string): RelationshipEndpointInput {
  return {
    file: projectRelativeFile(projectRoot, symbol.node.getSourceFile().getFilePath()),
    symbol_path: symbol.symbolPath,
    selector: `${symbol.symbolPath}@${symbol.line}`,
    range: nodeRange(symbol.node),
  };
}

function moduleEndpoint(
  sourceFile: SourceFile,
  projectRoot: string,
  anchor?: Node,
): RelationshipEndpointInput {
  return {
    file: projectRelativeFile(projectRoot, sourceFile.getFilePath()),
    symbol_path: "<module>",
    selector: "<module>@1",
    ...(anchor ? { range: nodeRange(anchor) } : {}),
  };
}

function declarationsForSymbol(symbol: MorphSymbol | undefined): Node[] {
  if (!symbol) return [];
  const resolved = symbol.getAliasedSymbol() ?? symbol;
  return resolved.getDeclarations();
}

function declarationsForType(type: {
  getAliasSymbol(): MorphSymbol | undefined;
  getSymbol(): MorphSymbol | undefined;
}): Node[] {
  return declarationsForSymbol(type.getSymbol()).concat(
    declarationsForSymbol(type.getAliasSymbol()),
  );
}

function symbolFromNameNode(node: Node): MorphSymbol | undefined {
  if (!Node.isIdentifier(node) && !Node.isStringLiteral(node)) return undefined;
  return node.getSymbol();
}

function addEdge(
  state: CompilerRelationshipState,
  source: RelationshipEndpointInput,
  target: RelationshipEndpointInput,
  kind: RelationshipEdgeKind,
): void {
  const edge = createRelationshipEdge({
    source,
    target,
    kind,
    provenance: "compiler",
    confidence: "exact",
    resolution: "resolved",
    freshness: state.freshness,
  });
  state.edges.set(edge.relationship_id, edge);
}

function projectLocatedDeclarations(
  state: CompilerRelationshipState,
  declarations: readonly Node[],
  requestContext: RequestContext,
): LocatedSymbol[] {
  const unique = new Set<LocatedSymbol>();
  for (const declaration of declarations) {
    requestContext.checkpoint();
    const sourceFile = declaration.getSourceFile();
    if (!state.sourceFiles.has(sourceFileKey(sourceFile.getFilePath()))) continue;
    const located = state.locatedSymbols.get(declaration);
    if (located) unique.add(located);
  }
  return [...unique];
}

function addReferenceEdges(state: CompilerRelationshipState, requestContext: RequestContext): void {
  for (const target of new Set(state.locatedSymbols.values())) {
    requestContext.checkpoint();
    if (!Node.isReferenceFindable(target.node)) continue;
    for (const reference of target.node.findReferencesAsNodes()) {
      requestContext.checkpoint();
      const sourceFile = reference.getSourceFile();
      if (!state.sourceFiles.has(sourceFileKey(sourceFile.getFilePath()))) continue;
      const source = containingSymbol(sourceFile, reference);
      if (!source || source.node === target.node) continue;
      addEdge(
        state,
        symbolEndpoint(source, state.projectRoot),
        symbolEndpoint(target, state.projectRoot),
        "reference",
      );
    }
  }
}

function addHeritageEdges(state: CompilerRelationshipState, requestContext: RequestContext): void {
  for (const source of new Set(state.locatedSymbols.values())) {
    requestContext.checkpoint();
    if (Node.isClassDeclaration(source.node)) {
      const base = source.node.getExtends();
      if (base) {
        for (const target of projectLocatedDeclarations(
          state,
          declarationsForType(base.getType()),
          requestContext,
        )) {
          addEdge(
            state,
            symbolEndpoint(source, state.projectRoot),
            symbolEndpoint(target, state.projectRoot),
            "extends",
          );
        }
      }
      for (const implemented of source.node.getImplements()) {
        requestContext.checkpoint();
        for (const target of projectLocatedDeclarations(
          state,
          declarationsForType(implemented.getType()),
          requestContext,
        )) {
          addEdge(
            state,
            symbolEndpoint(source, state.projectRoot),
            symbolEndpoint(target, state.projectRoot),
            "implements",
          );
        }
      }
    }

    if (Node.isInterfaceDeclaration(source.node)) {
      for (const base of source.node.getBaseTypes()) {
        requestContext.checkpoint();
        for (const target of projectLocatedDeclarations(
          state,
          declarationsForType(base),
          requestContext,
        )) {
          addEdge(
            state,
            symbolEndpoint(source, state.projectRoot),
            symbolEndpoint(target, state.projectRoot),
            "extends",
          );
        }
      }
    }
  }
}

function addModuleEdges(state: CompilerRelationshipState, requestContext: RequestContext): void {
  for (const sourceFile of state.sourceFiles.values()) {
    requestContext.checkpoint();
    for (const declaration of sourceFile.getImportDeclarations()) {
      requestContext.checkpoint();
      const targetFile = declaration.getModuleSpecifierSourceFile();
      if (!targetFile || !state.sourceFiles.has(sourceFileKey(targetFile.getFilePath()))) continue;
      const source = moduleEndpoint(sourceFile, state.projectRoot, declaration);
      let emitted = false;
      for (const specifier of declaration.getNamedImports()) {
        const targets = projectLocatedDeclarations(
          state,
          declarationsForSymbol(symbolFromNameNode(specifier.getNameNode())),
          requestContext,
        );
        for (const target of targets) {
          addEdge(state, source, symbolEndpoint(target, state.projectRoot), "import");
          emitted = true;
        }
      }
      for (const identifier of [declaration.getDefaultImport(), declaration.getNamespaceImport()]) {
        if (!identifier) continue;
        for (const target of projectLocatedDeclarations(
          state,
          declarationsForSymbol(identifier.getSymbol()),
          requestContext,
        )) {
          addEdge(state, source, symbolEndpoint(target, state.projectRoot), "import");
          emitted = true;
        }
      }
      if (!emitted) addEdge(state, source, moduleEndpoint(targetFile, state.projectRoot), "import");
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
      requestContext.checkpoint();
      const targetFile = declaration.getModuleSpecifierSourceFile();
      const source = moduleEndpoint(sourceFile, state.projectRoot, declaration);
      let emitted = false;
      for (const specifier of declaration.getNamedExports()) {
        const declarations: Node[] = [...specifier.getLocalTargetDeclarations()];
        if (targetFile) {
          declarations.push(
            ...(targetFile.getExportedDeclarations().get(specifier.getName()) ?? []),
          );
        }
        for (const target of projectLocatedDeclarations(state, declarations, requestContext)) {
          addEdge(state, source, symbolEndpoint(target, state.projectRoot), "export");
          emitted = true;
        }
      }
      if (!emitted && declaration.getNamedExports().length === 0 && targetFile) {
        addEdge(state, source, moduleEndpoint(targetFile, state.projectRoot), "export");
      }
    }
  }
}

interface ScopedCompilerRelationshipState {
  readonly project: Project;
  readonly projectRoot: string;
  readonly freshness: FreshnessMetadata;
  readonly requestContext: RequestContext;
}

export type CompilerRelationshipDirection = "incoming" | "outgoing" | "both";
export type EffectiveRelationshipDirection = Exclude<CompilerRelationshipDirection, "both">;
export type RelationshipEndpointClass = "module" | "symbol";
export const RELATIONSHIP_COVERAGE_STATUSES = Object.freeze([
  "not_applicable",
  "completed",
  "unsupported",
  "unfinished",
] as const);
export type RelationshipCoverageStatus = (typeof RELATIONSHIP_COVERAGE_STATUSES)[number];
export interface RelationshipCoverageEntry {
  readonly kind: RelationshipEdgeKind;
  readonly direction: EffectiveRelationshipDirection;
  readonly endpoint_class: RelationshipEndpointClass;
  readonly status: RelationshipCoverageStatus;
}
export interface CompilerImpactWork {
  readonly max_items: number;
  readonly consumed_items: number;
  readonly exhausted: boolean;
}
class CompilerImpactWorkExhausted extends Error {}
export class CompilerImpactWorkTracker {
  consumed = 0;
  exhausted = false;
  constructor(readonly max: number) {
    if (!Number.isSafeInteger(max) || max < 1) {
      throw new Error("Compiler impact max_work_items must be a positive safe integer.");
    }
  }
  charge(requestContext: RequestContext, count = 1): void {
    requestContext.checkpoint();
    if (count > this.max - this.consumed) {
      this.consumed = this.max;
      this.exhausted = true;
      throw new CompilerImpactWorkExhausted();
    }
    this.consumed += count;
  }

  snapshot(): CompilerImpactWork {
    return { max_items: this.max, consumed_items: this.consumed, exhausted: this.exhausted };
  }
}

export function aggregateRelationshipCoverage(
  entries: readonly RelationshipCoverageEntry[],
  endpointClass: RelationshipEndpointClass,
): readonly RelationshipCoverageEntry[] {
  const rank = (status: RelationshipCoverageStatus) =>
    RELATIONSHIP_COVERAGE_STATUSES.indexOf(status);
  const merged = new Map<string, RelationshipCoverageEntry>();
  for (const observed of entries) {
    if (observed.endpoint_class !== endpointClass) continue;
    const entry = observed;
    const key = `${entry.kind}/${entry.direction}`;
    const prior = merged.get(key);
    if (!prior || rank(entry.status) > rank(prior.status)) merged.set(key, entry);
  }
  return [...merged.values()].sort(
    (left, right) =>
      RELATIONSHIP_EDGE_KINDS.indexOf(left.kind) - RELATIONSHIP_EDGE_KINDS.indexOf(right.kind) ||
      (left.direction === right.direction ? 0 : left.direction === "incoming" ? -1 : 1),
  );
}

export interface CompilerRelationshipQuery {
  readonly direction: CompilerRelationshipDirection;
  readonly relationship_kinds: readonly RelationshipEdgeKind[];
  readonly max_edges: number;
  readonly max_work_items?: number;
  readonly allowed_neighbor_keys?: readonly string[];
  readonly excluded_relationship_ids?: readonly string[];
  readonly stop_after_first?: boolean;
  readonly allow_provisional_call?: boolean;
}

export interface CompilerRelationshipResolution {
  readonly edges: readonly RelationshipEdge[];
  readonly coverage: readonly RelationshipCoverageEntry[];
  readonly incomplete: boolean;
  readonly edge_limit_reached: boolean;
  readonly work_items: number;
  readonly work_limit_reached: boolean;
  readonly excluded_neighbors: boolean;
}

export interface CompilerRelationshipResolver {
  edgesFor(
    endpoint: RelationshipEndpoint,
    query: CompilerRelationshipQuery,
  ): CompilerRelationshipResolution;
}

interface ScopedEdgeCollector {
  readonly edges: Map<string, RelationshipEdge>;
  readonly endpointKey: string;
  readonly direction: CompilerRelationshipDirection;
  readonly relationshipKinds: ReadonlySet<RelationshipEdgeKind>;
  readonly maxEdges: number;
  readonly stopAfterFirst: boolean;
  readonly allowedNeighborKeys?: ReadonlySet<string>;
  readonly allowedNeighborFilePaths?: readonly string[];
  readonly excludedRelationshipIds: ReadonlySet<string>;
  readonly workBudget: ScopedRelationshipWorkBudget;
  excludedNeighbors: boolean;
}

type ScopedRelationshipWorkBudget = CompilerImpactWorkTracker;

const DEFAULT_COMPILER_RELATIONSHIP_WORK_ITEMS = 100_000;

class ScopedRelationshipLimitReached extends Error {
  constructor() {
    super("Scoped compiler relationship discovery reached its edge limit.");
    this.name = "ScopedRelationshipLimitReached";
  }
}
class ScopedCallCoverageUnfinished extends Error {}

function consumeRelationshipWork(
  state: ScopedCompilerRelationshipState,
  budget: ScopedRelationshipWorkBudget,
): void {
  budget.charge(state.requestContext);
}

function consumeScopedWork(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
): void {
  consumeRelationshipWork(state, collector.workBudget);
}

function reserveScopedWork(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  count: number,
): void {
  collector.workBudget.charge(state.requestContext, count);
}

function scopedDeclarationsForSymbol(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  symbol: MorphSymbol | undefined,
): readonly Node[] {
  if (!symbol) return [];
  consumeScopedWork(state, collector);
  const resolved = symbol.getAliasedSymbol() ?? symbol;
  const declarationCount = resolved.compilerSymbol.declarations?.length ?? 0;
  reserveScopedWork(state, collector, declarationCount);
  const declarations = resolved.getDeclarations();
  if (declarations.length !== declarationCount) {
    throw new Error("Compiler symbol declarations changed during scoped relationship discovery.");
  }
  return declarations;
}

function scopedDeclarationsForType(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  type: {
    getAliasSymbol(): MorphSymbol | undefined;
    getSymbol(): MorphSymbol | undefined;
  },
): readonly Node[] {
  consumeScopedWork(state, collector);
  const declarations = new Map<Node, Node>();
  for (const symbol of [type.getSymbol(), type.getAliasSymbol()]) {
    for (const declaration of scopedDeclarationsForSymbol(state, collector, symbol)) {
      declarations.set(declaration, declaration);
    }
  }
  return [...declarations.values()];
}

function forEachScopedBaseType(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  node: Node,
  visit: (type: Type) => void,
): void {
  if (!Node.isClassDeclaration(node) && !Node.isInterfaceDeclaration(node)) return;
  consumeScopedWork(state, collector);
  const baseTypeCount = node.getType().compilerType.getBaseTypes()?.length ?? 0;
  reserveScopedWork(state, collector, baseTypeCount);
  const baseTypes = node.getBaseTypes();
  if (baseTypes.length !== baseTypeCount) {
    throw new Error("Compiler base types changed during scoped relationship discovery.");
  }
  for (const baseType of baseTypes) visit(baseType);
}

function forEachScopedImplementedType(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  node: Node,
  visit: (type: Type) => void,
): void {
  if (!Node.isClassDeclaration(node)) return;
  consumeScopedWork(state, collector);
  const implementationCount =
    node.compilerNode.heritageClauses?.find(
      (clause) => clause.token === SyntaxKind.ImplementsKeyword,
    )?.types.length ?? 0;
  reserveScopedWork(state, collector, implementationCount);
  const implementations = node.getImplements();
  if (implementations.length !== implementationCount) {
    throw new Error("Compiler implementations changed during scoped relationship discovery.");
  }
  for (const implementation of implementations) {
    consumeScopedWork(state, collector);
    visit(implementation.getType());
  }
}

function scopedSourceFiles(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
): readonly SourceFile[] {
  const sourceFiles: SourceFile[] = [];
  if (collector.allowedNeighborFilePaths) {
    for (const filePath of collector.allowedNeighborFilePaths) {
      consumeScopedWork(state, collector);
      const sourceFile = state.project.getSourceFile(filePath);
      if (sourceFile) sourceFiles.push(sourceFile);
    }
    return sourceFiles;
  }

  const program = state.project.getProgram().compilerObject;
  const filePaths: string[] = [];
  for (const compilerSourceFile of program.getSourceFiles()) {
    consumeScopedWork(state, collector);
    const filePath = compilerSourceFile.fileName;
    if (!isProjectScopedFile(state.projectRoot, filePath)) continue;
    filePaths.push(filePath);
  }
  filePaths.sort((left, right) => left.localeCompare(right));
  for (const filePath of filePaths) {
    const sourceFile = state.project.getSourceFile(filePath);
    if (sourceFile) sourceFiles.push(sourceFile);
  }
  return sourceFiles;
}

function forEachScopedSymbol(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  sourceFile: SourceFile,
  visit: (symbol: LocatedSymbol) => void,
): void {
  forEachLocatedSymbol(sourceFile, (candidate) => {
    consumeScopedWork(state, collector);
    visit(candidate);
  });
}

function scopedContainingSymbol(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  sourceFile: SourceFile,
  node: Node,
): LocatedSymbol | undefined {
  let selected: LocatedSymbol | undefined;
  const nodeStart = node.getStart();
  const nodeEnd = node.getEnd();
  forEachLocatedSymbol(sourceFile, (symbol) => {
    consumeScopedWork(state, collector);
    if (symbol.node.getStart() > nodeStart) return false;
    if (symbol.node.getEnd() < nodeEnd) return;
    if (!selected) {
      selected = symbol;
      return;
    }
    const order = (() => {
      const left = symbol;
      const right = selected!;
      const leftSize = left.node.getEnd() - left.node.getStart();
      const rightSize = right.node.getEnd() - right.node.getStart();
      return (
        leftSize - rightSize ||
        left.line - right.line ||
        left.symbolPath.localeCompare(right.symbolPath)
      );
    })();
    if (order < 0) selected = symbol;
  });
  return selected;
}

function scopedLocatedDeclarations(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  declarations: readonly Node[],
): LocatedSymbol[] {
  const unique = new Map<Node, LocatedSymbol>();
  for (const declaration of declarations) {
    state.requestContext.checkpoint();
    consumeScopedWork(state, collector);
    const sourceFile = declaration.getSourceFile();
    if (!isProjectScopedFile(state.projectRoot, sourceFile.getFilePath())) continue;
    if (state.project.getSourceFile(sourceFile.getFilePath()) !== sourceFile) continue;
    forEachLocatedSymbol(sourceFile, (candidate) => {
      consumeScopedWork(state, collector);
      if (candidate.node !== declaration) return;
      unique.set(declaration, candidate);
      return false;
    });
  }
  return [...unique.values()];
}

function addScopedEdge(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  source: RelationshipEndpointInput,
  target: RelationshipEndpointInput,
  kind: RelationshipEdgeKind,
): void {
  addScopedResolvedEdge(
    collector,
    createRelationshipEdge({
      source,
      target,
      kind,
      provenance: "compiler",
      confidence: "exact",
      resolution: "resolved",
      freshness: state.freshness,
    }),
  );
}

function createScopedEdge(
  state: ScopedCompilerRelationshipState,
  source: RelationshipEndpointInput,
  target: RelationshipEndpointInput,
  kind: RelationshipEdgeKind,
): RelationshipEdge {
  return createRelationshipEdge({
    source,
    target,
    kind,
    provenance: "compiler",
    confidence: "exact",
    resolution: "resolved",
    freshness: state.freshness,
  });
}

function scopedIncidentNeighborKey(
  collector: ScopedEdgeCollector,
  edge: RelationshipEdge,
): string | undefined {
  const sourceKey = endpointKey(edge.source);
  const targetKey = endpointKey(edge.target);
  if (collector.direction !== "incoming" && sourceKey === collector.endpointKey) return targetKey;
  if (collector.direction !== "outgoing" && targetKey === collector.endpointKey) return sourceKey;
  return undefined;
}

function addScopedResolvedEdge(collector: ScopedEdgeCollector, edge: RelationshipEdge): void {
  if (!collector.relationshipKinds.has(edge.kind)) return;
  if (collector.excludedRelationshipIds.has(edge.relationship_id)) return;
  const neighborKey = scopedIncidentNeighborKey(collector, edge);
  if (!neighborKey || collector.edges.has(edge.relationship_id)) return;
  if (collector.allowedNeighborKeys && !collector.allowedNeighborKeys.has(neighborKey)) {
    collector.excludedNeighbors = true;
    return;
  }
  if (collector.edges.size >= collector.maxEdges) throw new ScopedRelationshipLimitReached();
  collector.edges.set(edge.relationship_id, edge);
  if (collector.stopAfterFirst) throw new ScopedRelationshipLimitReached();
}

function scopedEdgeOrder(left: RelationshipEdge, right: RelationshipEdge): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.source.file.localeCompare(right.source.file) ||
    left.source.selector.localeCompare(right.source.selector) ||
    left.target.file.localeCompare(right.target.file) ||
    left.target.selector.localeCompare(right.target.selector) ||
    left.relationship_id.localeCompare(right.relationship_id)
  );
}

function scopedNeighborOrder(
  rootKey: string,
  left: RelationshipEdge,
  right: RelationshipEdge,
): number {
  const leftEndpoint = endpointKey(left.source) === rootKey ? left.target : left.source;
  const rightEndpoint = endpointKey(right.source) === rootKey ? right.target : right.source;
  return (
    leftEndpoint.file.localeCompare(rightEndpoint.file) ||
    leftEndpoint.selector.localeCompare(rightEndpoint.selector) ||
    leftEndpoint.symbol_path.localeCompare(rightEndpoint.symbol_path) ||
    scopedEdgeOrder(left, right)
  );
}

interface ScopedCandidateSet {
  readonly collector: ScopedEdgeCollector;
  readonly indexes: Map<string, number>;
  readonly values: RelationshipEdge[];
  readonly capacity: number;
  push(candidate: RelationshipEdge): void;
}

function createScopedCandidateSet(collector: ScopedEdgeCollector): ScopedCandidateSet {
  const candidates: ScopedCandidateSet = {
    collector,
    indexes: new Map(),
    values: [],
    capacity: collector.stopAfterFirst ? 1 : collector.maxEdges + 1,
    push(candidate) {
      retainScopedCandidate(candidates, candidate);
    },
  };
  return candidates;
}

function swapScopedCandidates(candidates: ScopedCandidateSet, left: number, right: number): void {
  [candidates.values[left], candidates.values[right]] = [
    candidates.values[right],
    candidates.values[left],
  ];
  candidates.indexes.set(candidates.values[left].relationship_id, left);
  candidates.indexes.set(candidates.values[right].relationship_id, right);
}

function retainScopedCandidate(candidates: ScopedCandidateSet, candidate: RelationshipEdge): void {
  if (!candidates.collector.relationshipKinds.has(candidate.kind)) return;
  if (candidates.collector.excludedRelationshipIds.has(candidate.relationship_id)) return;
  const neighborKey = scopedIncidentNeighborKey(candidates.collector, candidate);
  if (!neighborKey) return;
  if (
    candidates.collector.allowedNeighborKeys &&
    !candidates.collector.allowedNeighborKeys.has(neighborKey)
  ) {
    candidates.collector.excludedNeighbors = true;
    return;
  }
  if (candidates.indexes.has(candidate.relationship_id)) return;
  const order = (left: RelationshipEdge, right: RelationshipEdge) =>
    scopedNeighborOrder(candidates.collector.endpointKey, left, right);
  if (candidates.values.length < candidates.capacity) {
    candidates.values.push(candidate);
    let index = candidates.values.length - 1;
    candidates.indexes.set(candidate.relationship_id, index);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (order(candidates.values[parent], candidates.values[index]) >= 0) break;
      swapScopedCandidates(candidates, parent, index);
      index = parent;
    }
    return;
  }
  if (order(candidate, candidates.values[0]) >= 0) return;
  candidates.indexes.delete(candidates.values[0].relationship_id);
  candidates.values[0] = candidate;
  candidates.indexes.set(candidate.relationship_id, 0);
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= candidates.values.length) return;
    let worst = left;
    if (
      right < candidates.values.length &&
      order(candidates.values[right], candidates.values[left]) > 0
    ) {
      worst = right;
    }
    if (order(candidates.values[index], candidates.values[worst]) >= 0) return;
    swapScopedCandidates(candidates, index, worst);
    index = worst;
  }
}

function flushScopedCandidates(candidates: ScopedCandidateSet): void {
  candidates.values.sort((left, right) =>
    scopedNeighborOrder(candidates.collector.endpointKey, left, right),
  );
  for (const candidate of candidates.values) {
    addScopedResolvedEdge(candidates.collector, candidate);
  }
}

function addScopedCandidates(collector: ScopedEdgeCollector, candidates: ScopedCandidateSet): void {
  if (candidates.collector !== collector) {
    throw new Error("Scoped relationship candidates belong to a different collector.");
  }
  flushScopedCandidates(candidates);
}

function collectScopedHeritageEdges(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
  source: LocatedSymbol,
  candidates: ScopedCandidateSet,
): void {
  consumeScopedWork(state, edges);
  const sourceEndpoint = symbolEndpoint(source, state.projectRoot);
  if (Node.isClassDeclaration(source.node)) {
    const base = source.node.getExtends();
    if (base && edges.relationshipKinds.has("extends")) {
      for (const target of scopedLocatedDeclarations(
        state,
        edges,
        scopedDeclarationsForType(state, edges, base.getType()),
      )) {
        candidates.push(
          createScopedEdge(
            state,
            sourceEndpoint,
            symbolEndpoint(target, state.projectRoot),
            "extends",
          ),
        );
      }
    }
    if (edges.relationshipKinds.has("implements")) {
      forEachScopedImplementedType(state, edges, source.node, (implementedType) => {
        for (const target of scopedLocatedDeclarations(
          state,
          edges,
          scopedDeclarationsForType(state, edges, implementedType),
        )) {
          candidates.push(
            createScopedEdge(
              state,
              sourceEndpoint,
              symbolEndpoint(target, state.projectRoot),
              "implements",
            ),
          );
        }
      });
    }
  }

  if (Node.isInterfaceDeclaration(source.node) && edges.relationshipKinds.has("extends")) {
    forEachScopedBaseType(state, edges, source.node, (base) => {
      for (const target of scopedLocatedDeclarations(
        state,
        edges,
        scopedDeclarationsForType(state, edges, base),
      )) {
        candidates.push(
          createScopedEdge(
            state,
            sourceEndpoint,
            symbolEndpoint(target, state.projectRoot),
            "extends",
          ),
        );
      }
    });
  }
}

function addScopedHeritageEdges(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
  source: LocatedSymbol,
): void {
  const candidates = createScopedCandidateSet(edges);
  collectScopedHeritageEdges(state, edges, source, candidates);
  addScopedCandidates(edges, candidates);
}

function forEachNamedImportSpecifier(
  declaration: ImportDeclaration,
  visit: (specifier: ImportSpecifier) => void,
): void {
  const namedBindings = declaration.getImportClause()?.getNamedBindings();
  if (!Node.isNamedImports(namedBindings)) return;
  namedBindings.forEachChild((specifier) => {
    if (Node.isImportSpecifier(specifier)) visit(specifier);
  });
}

function forEachNamedExportSpecifier(
  declaration: ExportDeclaration,
  visit: (specifier: ExportSpecifier) => void,
): void {
  declaration.forEachChild((namedExports) => {
    if (!Node.isNamedExports(namedExports)) return;
    namedExports.forEachChild((specifier) => {
      if (Node.isExportSpecifier(specifier)) visit(specifier);
    });
  });
}

function addScopedModuleEdges(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
  sourceFile: SourceFile,
): void {
  const candidates = createScopedCandidateSet(edges);
  sourceFile.forEachChild((declaration) => {
    consumeScopedWork(state, edges);
    if (Node.isImportDeclaration(declaration) && edges.relationshipKinds.has("import")) {
      const targetFile = declaration.getModuleSpecifierSourceFile();
      if (
        !targetFile ||
        !isProjectScopedFile(state.projectRoot, targetFile.getFilePath()) ||
        state.project.getSourceFile(targetFile.getFilePath()) !== targetFile
      )
        return;
      const source = moduleEndpoint(sourceFile, state.projectRoot, declaration);
      let emitted = false;
      forEachNamedImportSpecifier(declaration, (specifier) => {
        consumeScopedWork(state, edges);
        for (const target of scopedLocatedDeclarations(
          state,
          edges,
          scopedDeclarationsForSymbol(state, edges, symbolFromNameNode(specifier.getNameNode())),
        )) {
          candidates.push(
            createScopedEdge(state, source, symbolEndpoint(target, state.projectRoot), "import"),
          );
          emitted = true;
        }
      });
      for (const identifier of [declaration.getDefaultImport(), declaration.getNamespaceImport()]) {
        if (!identifier) continue;
        consumeScopedWork(state, edges);
        for (const target of scopedLocatedDeclarations(
          state,
          edges,
          scopedDeclarationsForSymbol(state, edges, identifier.getSymbol()),
        )) {
          candidates.push(
            createScopedEdge(state, source, symbolEndpoint(target, state.projectRoot), "import"),
          );
          emitted = true;
        }
      }
      if (!emitted) {
        candidates.push(
          createScopedEdge(state, source, moduleEndpoint(targetFile, state.projectRoot), "import"),
        );
      }
      return;
    }

    if (Node.isExportDeclaration(declaration) && edges.relationshipKinds.has("export")) {
      const targetFile = declaration.getModuleSpecifierSourceFile();
      if (targetFile && !isProjectScopedFile(state.projectRoot, targetFile.getFilePath())) return;
      const source = moduleEndpoint(sourceFile, state.projectRoot, declaration);
      let emitted = false;
      let hasNamedExports = false;
      forEachNamedExportSpecifier(declaration, (specifier) => {
        hasNamedExports = true;
        consumeScopedWork(state, edges);
        for (const target of scopedLocatedDeclarations(
          state,
          edges,
          scopedDeclarationsForSymbol(state, edges, specifier.getLocalTargetSymbol()),
        )) {
          candidates.push(
            createScopedEdge(state, source, symbolEndpoint(target, state.projectRoot), "export"),
          );
          emitted = true;
        }
      });
      if (!emitted && !hasNamedExports && targetFile) {
        candidates.push(
          createScopedEdge(state, source, moduleEndpoint(targetFile, state.projectRoot), "export"),
        );
      }
    }
  });
  addScopedCandidates(edges, candidates);
}

function addScopedOutgoingReferences(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
  source: LocatedSymbol,
): void {
  const candidates = createScopedCandidateSet(edges);
  const sourceFile = source.node.getSourceFile();
  source.node.forEachDescendant((reference) => {
    consumeScopedWork(state, edges);
    if (!isCompilerReferenceNode(reference)) return;
    if (scopedContainingSymbol(state, edges, sourceFile, reference)?.node !== source.node) return;
    const declarations = scopedDeclarationsForSymbol(
      state,
      edges,
      compilerReferenceSymbol(reference),
    );
    const declarationOwner = referenceDeclarationNameOwner(reference);
    const referencedDeclarations = declarationOwner
      ? compilerDeclarationNameTargets(declarationOwner, declarations)
      : declarations;
    for (const target of scopedLocatedDeclarations(state, edges, referencedDeclarations)) {
      if (target.node === source.node) continue;
      candidates.push(
        createScopedEdge(
          state,
          symbolEndpoint(source, state.projectRoot),
          symbolEndpoint(target, state.projectRoot),
          "reference",
        ),
      );
    }
  });
  addScopedCandidates(edges, candidates);
}

function isCompilerReferenceNode(node: Node): boolean {
  return (
    Node.isReferenceFindable(node) ||
    Node.isStringLiteral(node) ||
    (Node.isThisExpression(node) && isStaticThisReference(node))
  );
}

function isStaticThisReference(node: Node): boolean {
  for (let current = node.getParent(); current; current = current.getParent()) {
    if (
      Node.isArrowFunction(current) ||
      Node.isFunctionExpression(current) ||
      Node.isFunctionDeclaration(current)
    ) {
      return false;
    }
    if (current.getKind() === SyntaxKind.ClassStaticBlockDeclaration) return true;
    if (
      Node.isMethodDeclaration(current) ||
      Node.isGetAccessorDeclaration(current) ||
      Node.isSetAccessorDeclaration(current)
    ) {
      const modifiers = (current.compilerNode as { modifiers?: readonly { kind: SyntaxKind }[] })
        .modifiers;
      return modifiers?.some((modifier) => modifier.kind === SyntaxKind.StaticKeyword) ?? false;
    }
    if (Node.isPropertyDeclaration(current)) return false;
    if (Node.isClassDeclaration(current) || Node.isClassExpression(current)) return false;
  }
  return false;
}

function compilerReferenceSymbol(node: Node): MorphSymbol | undefined {
  if (Node.isShorthandPropertyAssignment(node)) return node.getValueSymbol();
  const parent = node.getParent();
  if (parent && Node.isShorthandPropertyAssignment(parent)) return parent.getValueSymbol();
  return node.getSymbol();
}

function isReferenceDeclaration(node: Node): boolean {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isMethodSignature(node) ||
    Node.isPropertyDeclaration(node) ||
    Node.isPropertySignature(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  );
}

function referenceDeclarationNameOwner(reference: Node): Node | undefined {
  if (isReferenceDeclaration(reference)) return reference;
  const parent = reference.getParent();
  if (!parent || !isReferenceDeclaration(parent)) return undefined;
  const nameNode = (parent.compilerNode as { name?: { kind: number; pos: number; end: number } })
    .name;
  const referenceNode = reference.compilerNode;
  return nameNode &&
    nameNode.kind === referenceNode.kind &&
    nameNode.pos === referenceNode.pos &&
    nameNode.end === referenceNode.end
    ? parent
    : undefined;
}

function sameCompilerNode(left: Node, right: Node): boolean {
  return (
    left.getSourceFile().getFilePath() === right.getSourceFile().getFilePath() &&
    left.getKind() === right.getKind() &&
    left.getStart() === right.getStart() &&
    left.getEnd() === right.getEnd()
  );
}

function compilerDeclarationNameTargets(source: Node, declarations: readonly Node[]): Node[] {
  const sourceIndex = declarations.findIndex((declaration) =>
    sameCompilerNode(declaration, source),
  );
  if (sourceIndex <= 0) return [];
  return declarations.filter((declaration) => !sameCompilerNode(declaration, source));
}

function scopedMemberName(node: Node): string | undefined {
  if (
    Node.isMethodDeclaration(node) ||
    Node.isMethodSignature(node) ||
    Node.isPropertyDeclaration(node) ||
    Node.isPropertySignature(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  ) {
    const nameNode = node.getNameNode();
    if (
      nameNode.getKind() === SyntaxKind.ComputedPropertyName ||
      nameNode.getKind() === SyntaxKind.PrivateIdentifier ||
      (Node.isModifierable(node) && node.hasModifier(SyntaxKind.PrivateKeyword)) ||
      (Node.isStaticable(node) && node.isStatic())
    ) {
      return undefined;
    }
    return node.getName();
  }
  return undefined;
}

function scopedMemberContainer(node: Node): Node | undefined {
  return node.getFirstAncestor(
    (ancestor) => Node.isClassDeclaration(ancestor) || Node.isInterfaceDeclaration(ancestor),
  );
}

function scopedBaseContainers(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  container: Node,
): Set<Node> {
  const discovered = new Set<Node>();
  const pending: Node[] = [container];
  while (pending.length > 0) {
    consumeScopedWork(state, collector);
    const current = pending.pop()!;
    const discoverType = (type: Type): void => {
      for (const declaration of scopedDeclarationsForType(state, collector, type)) {
        if (
          (Node.isClassDeclaration(declaration) || Node.isInterfaceDeclaration(declaration)) &&
          !discovered.has(declaration)
        ) {
          discovered.add(declaration);
          pending.push(declaration);
        }
      }
    };
    if (Node.isClassDeclaration(current) || Node.isInterfaceDeclaration(current)) {
      forEachScopedBaseType(state, collector, current, discoverType);
      forEachScopedImplementedType(state, collector, current, discoverType);
    }
  }
  return discovered;
}

function addScopedMemberRelationships(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
  target: LocatedSymbol,
): void {
  const targetName = scopedMemberName(target.node);
  const targetContainer = scopedMemberContainer(target.node);
  if (!targetName || !targetContainer) return;
  const targetBases = scopedBaseContainers(state, edges, targetContainer);
  const candidates = createScopedCandidateSet(edges);

  for (const sourceFile of scopedSourceFiles(state, edges)) {
    consumeScopedWork(state, edges);
    forEachScopedSymbol(state, edges, sourceFile, (candidate) => {
      if (candidate.node === target.node || scopedMemberName(candidate.node) !== targetName) {
        return;
      }
      const candidateContainer = scopedMemberContainer(candidate.node);
      if (!candidateContainer) return;
      const related =
        targetBases.has(candidateContainer) ||
        scopedBaseContainers(state, edges, candidateContainer).has(targetContainer);
      if (!related) return;
      const candidateEndpoint = symbolEndpoint(candidate, state.projectRoot);
      const targetEndpoint = symbolEndpoint(target, state.projectRoot);
      const pairs: [RelationshipEndpointInput, RelationshipEndpointInput][] = [
        [candidateEndpoint, targetEndpoint],
        [targetEndpoint, candidateEndpoint],
      ];
      pairs.sort((left, right) =>
        [left[0].file, left[0].selector, left[1].file, left[1].selector]
          .join("\u0000")
          .localeCompare(
            [right[0].file, right[0].selector, right[1].file, right[1].selector].join("\u0000"),
          ),
      );
      for (const [sourceEndpoint, targetEndpoint] of pairs) {
        candidates.push(createScopedEdge(state, sourceEndpoint, targetEndpoint, "reference"));
      }
    });
  }
  addScopedCandidates(edges, candidates);
}

function addScopedIncomingHeritageRelationships(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
): void {
  const candidates = createScopedCandidateSet(edges);
  for (const sourceFile of scopedSourceFiles(state, edges)) {
    consumeScopedWork(state, edges);
    forEachScopedSymbol(state, edges, sourceFile, (candidate) => {
      collectScopedHeritageEdges(state, edges, candidate, candidates);
    });
  }
  addScopedCandidates(edges, candidates);
}

function addScopedIncomingReferences(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
  target: LocatedSymbol,
): void {
  for (const sourceFile of scopedSourceFiles(state, edges)) {
    consumeScopedWork(state, edges);
    const candidates = createScopedCandidateSet(edges);
    sourceFile.forEachDescendant((reference) => {
      consumeScopedWork(state, edges);
      if (!isCompilerReferenceNode(reference)) return;
      const declarations = scopedDeclarationsForSymbol(
        state,
        edges,
        compilerReferenceSymbol(reference),
      );
      const declarationOwner = referenceDeclarationNameOwner(reference);
      if (
        declarationOwner &&
        !compilerDeclarationNameTargets(declarationOwner, declarations).some((declaration) =>
          sameCompilerNode(declaration, target.node),
        )
      ) {
        return;
      }
      if (
        !declarationOwner &&
        !declarations.some((declaration) => sameCompilerNode(declaration, target.node))
      ) {
        return;
      }
      const source = scopedContainingSymbol(state, edges, sourceFile, reference);
      if (source && source.node !== target.node) {
        candidates.push(
          createScopedEdge(
            state,
            symbolEndpoint(source, state.projectRoot),
            symbolEndpoint(target, state.projectRoot),
            "reference",
          ),
        );
      }
    });
    addScopedCandidates(edges, candidates);
  }
}

function addScopedIncomingImports(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
  target: LocatedSymbol,
): void {
  const targetEndpoint = symbolEndpoint(target, state.projectRoot);
  for (const sourceFile of scopedSourceFiles(state, edges)) {
    consumeScopedWork(state, edges);
    sourceFile.forEachChild((declaration) => {
      consumeScopedWork(state, edges);
      if (!Node.isImportDeclaration(declaration)) return;
      let resolvesTarget = false;
      forEachNamedImportSpecifier(declaration, (specifier) => {
        consumeScopedWork(state, edges);
        resolvesTarget ||= scopedDeclarationsForSymbol(
          state,
          edges,
          specifier.getNameNode().getSymbol(),
        ).some((candidate) => candidate === target.node);
      });
      for (const identifier of [declaration.getDefaultImport(), declaration.getNamespaceImport()]) {
        if (!identifier) continue;
        consumeScopedWork(state, edges);
        resolvesTarget ||= scopedDeclarationsForSymbol(state, edges, identifier.getSymbol()).some(
          (candidate) => candidate === target.node,
        );
      }
      if (resolvesTarget) {
        addScopedEdge(
          state,
          edges,
          moduleEndpoint(sourceFile, state.projectRoot, declaration),
          targetEndpoint,
          "import",
        );
      }
    });
  }
}

function addScopedIncomingExports(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
  target: LocatedSymbol,
): void {
  const targetEndpoint = symbolEndpoint(target, state.projectRoot);
  for (const sourceFile of scopedSourceFiles(state, edges)) {
    consumeScopedWork(state, edges);
    sourceFile.forEachChild((declaration) => {
      consumeScopedWork(state, edges);
      if (!Node.isExportDeclaration(declaration)) return;
      let resolvesTarget = false;
      forEachNamedExportSpecifier(declaration, (specifier) => {
        consumeScopedWork(state, edges);
        resolvesTarget ||= scopedDeclarationsForSymbol(
          state,
          edges,
          specifier.getLocalTargetSymbol(),
        ).some((candidate) => candidate === target.node);
      });
      if (resolvesTarget) {
        addScopedEdge(
          state,
          edges,
          moduleEndpoint(sourceFile, state.projectRoot, declaration),
          targetEndpoint,
          "export",
        );
      }
    });
  }
}

function endpointKey(endpoint: RelationshipEndpoint): string {
  return `${endpoint.file}\u0000${endpoint.symbol_path}\u0000${endpoint.selector}`;
}

function scopedLocatedEndpoint(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  endpoint: RelationshipEndpoint,
): { readonly sourceFile: SourceFile; readonly symbol?: LocatedSymbol } {
  consumeScopedWork(state, collector);
  const sourceFile = state.project.getSourceFile(path.resolve(state.projectRoot, endpoint.file));
  if (!sourceFile) throw new Error("Impact relationship endpoint is outside the compiler project.");
  if (endpoint.symbol_path === "<module>") return { sourceFile };
  const symbol = findLocatedSymbol(sourceFile, endpoint.selector, () =>
    consumeScopedWork(state, collector),
  );
  if (!symbol || endpointKey(symbolEndpoint(symbol, state.projectRoot)) !== endpointKey(endpoint)) {
    throw new Error("Impact relationship endpoint no longer resolves to the same declaration.");
  }
  return { sourceFile, symbol };
}

function addScopedIncomingModuleEdges(
  state: ScopedCompilerRelationshipState,
  edges: ScopedEdgeCollector,
): void {
  for (const sourceFile of scopedSourceFiles(state, edges)) {
    addScopedModuleEdges(state, edges, sourceFile);
  }
}

function hasNestedNamedCallOwner(node: Node, owner: Node): boolean {
  for (
    let current = node.getParent();
    current && current !== owner;
    current = current.getParent()
  ) {
    if (
      (Node.isFunctionDeclaration(current) && current.getName()) ||
      Node.isMethodDeclaration(current) ||
      Node.isConstructorDeclaration(current) ||
      Node.isGetAccessorDeclaration(current) ||
      Node.isSetAccessorDeclaration(current)
    ) {
      return true;
    }
  }
  return false;
}

function addScopedCallCandidate(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  caller: LocatedSymbol,
  target: LocatedSymbol,
  candidates: ScopedCandidateSet,
): void {
  consumeScopedWork(state, collector);
  candidates.push(
    createScopedEdge(
      state,
      symbolEndpoint(caller, state.projectRoot),
      symbolEndpoint(target, state.projectRoot),
      "call",
    ),
  );
}

function addScopedOutgoingCalls(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  caller: LocatedSymbol,
): void {
  const checker = state.project.getTypeChecker();
  const candidates = createScopedCandidateSet(collector);
  let unfinished = false;
  caller.node.forEachDescendant((node) => {
    consumeScopedWork(state, collector);
    const invocation = classifyCompilerInvocation(checker, state.projectRoot, node);
    if (invocation.state === "not_call" || hasNestedNamedCallOwner(node, caller.node)) return;
    if (invocation.state === "unfinished") {
      unfinished = true;
      return;
    }
    if (invocation.state === "exact") {
      addScopedCallCandidate(state, collector, caller, invocation.target, candidates);
    }
  });
  addScopedCandidates(collector, candidates);
  if (unfinished) throw new ScopedCallCoverageUnfinished();
}

function addScopedIncomingCalls(
  state: ScopedCompilerRelationshipState,
  collector: ScopedEdgeCollector,
  target: LocatedSymbol,
): void {
  const checker = state.project.getTypeChecker();
  const candidates = createScopedCandidateSet(collector);
  let unfinished = false;
  for (const sourceFile of scopedSourceFiles(state, collector)) {
    consumeScopedWork(state, collector);
    sourceFile.forEachDescendant((node) => {
      consumeScopedWork(state, collector);
      const invocation = classifyCompilerInvocation(checker, state.projectRoot, node);
      if (invocation.state === "unfinished") {
        unfinished = true;
        return;
      }
      if (invocation.state !== "exact" || invocation.target.node !== target.node) return;
      const caller = scopedContainingSymbol(state, collector, sourceFile, node);
      if (!caller || caller.node === target.node || hasNestedNamedCallOwner(node, caller.node))
        return;
      addScopedCallCandidate(state, collector, caller, target, candidates);
    });
  }
  addScopedCandidates(collector, candidates);
  if (unfinished) throw new ScopedCallCoverageUnfinished();
}

function registryCoverageStatus(
  endpointClass: RelationshipEndpointClass,
  direction: EffectiveRelationshipDirection,
  kind: RelationshipEdgeKind,
): RelationshipCoverageStatus {
  if (endpointClass === "module") {
    if (kind === "import" || kind === "export") return "unfinished";
    if (kind === "contains" && direction === "outgoing") return "unsupported";
    return "not_applicable";
  }
  if ((kind === "import" || kind === "export") && direction === "outgoing") {
    return "not_applicable";
  }
  if (kind === "contains") return "unsupported";
  return "unfinished";
}

export function createCompilerRelationshipResolver(
  project: Project,
  projectRoot: string,
  freshness: FreshnessMetadata,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
  workTracker?: CompilerImpactWorkTracker,
): CompilerRelationshipResolver {
  requestContext.checkpoint();
  const state: ScopedCompilerRelationshipState = {
    project,
    projectRoot,
    freshness: normalizeFreshness(freshness),
    requestContext,
  };

  return {
    edgesFor(endpoint, query) {
      requestContext.checkpoint();
      const key = endpointKey(endpoint);
      if (!Number.isSafeInteger(query.max_edges) || query.max_edges < 1) {
        throw new Error("Compiler relationship max_edges must be a positive safe integer.");
      }
      const workBudget = (workTracker ??= new CompilerImpactWorkTracker(
        query.max_work_items ?? DEFAULT_COMPILER_RELATIONSHIP_WORK_ITEMS,
      ));
      const workAtStart = workBudget.consumed;
      const direction = assertEnum(
        query.direction,
        ["incoming", "outgoing", "both"] as const,
        "direction",
      );
      const relationshipKinds = new Set(
        query.relationship_kinds.map((kind) =>
          assertEnum(kind, RELATIONSHIP_EDGE_KINDS, "edge kind"),
        ),
      );
      const endpointClass = endpoint.symbol_path === "<module>" ? "module" : "symbol";
      const directions: readonly EffectiveRelationshipDirection[] =
        direction === "both" ? ["incoming", "outgoing"] : [direction];
      const coverage: RelationshipCoverageEntry[] = RELATIONSHIP_EDGE_KINDS.flatMap((kind) =>
        relationshipKinds.has(kind)
          ? directions.map((effectiveDirection) => ({
              kind,
              direction: effectiveDirection,
              endpoint_class: endpointClass,
              status:
                kind === "call" && query.allow_provisional_call !== true
                  ? "unsupported"
                  : registryCoverageStatus(endpointClass, effectiveDirection, kind),
            }))
          : [],
      );
      const allowedNeighborKeys = query.allowed_neighbor_keys
        ? new Set(query.allowed_neighbor_keys)
        : undefined;
      const allowedNeighborFilePaths = allowedNeighborKeys ? new Set<string>() : undefined;
      try {
        consumeRelationshipWork(state, workBudget);
        for (const neighborKey of query.allowed_neighbor_keys ?? []) {
          consumeRelationshipWork(state, workBudget);
          allowedNeighborFilePaths!.add(
            path.resolve(projectRoot, neighborKey.split("\u0000", 1)[0]),
          );
        }
      } catch (error) {
        if (!(error instanceof CompilerImpactWorkExhausted)) throw error;
        return {
          edges: [],
          coverage,
          incomplete: true,
          edge_limit_reached: false,
          work_items: workBudget.consumed - workAtStart,
          work_limit_reached: true,
          excluded_neighbors: false,
        };
      }
      const excludedRelationshipIds = new Set(query.excluded_relationship_ids ?? []);
      const endpointCollector: ScopedEdgeCollector = {
        edges: new Map(),
        endpointKey: key,
        direction,
        relationshipKinds,
        maxEdges: query.max_edges,
        stopAfterFirst: query.stop_after_first === true,
        allowedNeighborKeys,
        allowedNeighborFilePaths: allowedNeighborFilePaths
          ? [...allowedNeighborFilePaths].sort((left, right) => left.localeCompare(right))
          : undefined,
        excludedRelationshipIds,
        workBudget,
        excludedNeighbors: false,
      };
      let located: { readonly sourceFile: SourceFile; readonly symbol?: LocatedSymbol };
      try {
        located = scopedLocatedEndpoint(state, endpointCollector, endpoint);
      } catch (error) {
        if (!(error instanceof CompilerImpactWorkExhausted)) throw error;
        return {
          edges: [],
          coverage,
          incomplete: true,
          edge_limit_reached: false,
          work_items: workBudget.consumed - workAtStart,
          work_limit_reached: true,
          excluded_neighbors: false,
        };
      }
      const outgoing = direction === "outgoing" || direction === "both";
      const incoming = direction === "incoming" || direction === "both";
      const producers: Array<{
        readonly kinds: readonly RelationshipEdgeKind[];
        readonly directions?: readonly EffectiveRelationshipDirection[];
        readonly collect: (collector: ScopedEdgeCollector) => void;
      }> = [];
      if (located.symbol) {
        if (outgoing && (relationshipKinds.has("extends") || relationshipKinds.has("implements"))) {
          producers.push({
            kinds: ["extends", "implements"],
            collect: (collector) => addScopedHeritageEdges(state, collector, located.symbol!),
          });
        }
        if (
          incoming &&
          (Node.isClassDeclaration(located.symbol.node) ||
            Node.isInterfaceDeclaration(located.symbol.node)) &&
          (relationshipKinds.has("extends") || relationshipKinds.has("implements"))
        ) {
          producers.push({
            kinds: ["extends", "implements"],
            collect: (collector) => addScopedIncomingHeritageRelationships(state, collector),
          });
        }
        if (relationshipKinds.has("reference")) {
          producers.push({
            kinds: ["reference"],
            collect: (collector) => addScopedMemberRelationships(state, collector, located.symbol!),
          });
        }
        if (outgoing && relationshipKinds.has("reference")) {
          producers.push({
            kinds: ["reference"],
            collect: (collector) => addScopedOutgoingReferences(state, collector, located.symbol!),
          });
        }
        if (incoming && relationshipKinds.has("reference")) {
          producers.push({
            kinds: ["reference"],
            collect: (collector) => addScopedIncomingReferences(state, collector, located.symbol!),
          });
        }
        if (incoming && relationshipKinds.has("import")) {
          producers.push({
            kinds: ["import"],
            collect: (collector) => addScopedIncomingImports(state, collector, located.symbol!),
          });
        }
        if (incoming && relationshipKinds.has("export")) {
          producers.push({
            kinds: ["export"],
            collect: (collector) => addScopedIncomingExports(state, collector, located.symbol!),
          });
        }
        if (query.allow_provisional_call === true) {
          if (outgoing && relationshipKinds.has("call")) {
            producers.push({
              kinds: ["call"],
              directions: ["outgoing"],
              collect: (collector) => addScopedOutgoingCalls(state, collector, located.symbol!),
            });
          }
          if (incoming && relationshipKinds.has("call")) {
            producers.push({
              kinds: ["call"],
              directions: ["incoming"],
              collect: (collector) => addScopedIncomingCalls(state, collector, located.symbol!),
            });
          }
        }
      } else {
        for (const kind of ["import", "export"] as const) {
          if (!relationshipKinds.has(kind)) continue;
          if (outgoing) {
            producers.push({
              kinds: [kind],
              collect: (collector) => addScopedModuleEdges(state, collector, located.sourceFile),
            });
          }
          if (incoming) {
            producers.push({
              kinds: [kind],
              collect: (collector) => addScopedIncomingModuleEdges(state, collector),
            });
          }
        }
      }

      const merged = new Map<string, RelationshipEdge>();
      let incomplete = false;
      let edgeLimitReached = false;
      let excludedNeighbors = false;
      const unfinishedCells = new Set<string>();
      for (const producer of producers) {
        const collector: ScopedEdgeCollector = {
          edges: new Map(),
          endpointKey: key,
          direction,
          relationshipKinds: new Set(producer.kinds.filter((kind) => relationshipKinds.has(kind))),
          maxEdges: query.max_edges,
          stopAfterFirst: query.stop_after_first === true,
          allowedNeighborKeys,
          allowedNeighborFilePaths: endpointCollector.allowedNeighborFilePaths,
          excludedRelationshipIds,
          workBudget,
          excludedNeighbors: false,
        };
        try {
          producer.collect(collector);
        } catch (error) {
          if (
            !(error instanceof ScopedRelationshipLimitReached) &&
            !(error instanceof CompilerImpactWorkExhausted) &&
            !(error instanceof ScopedCallCoverageUnfinished)
          ) {
            throw error;
          }
          incomplete = true;
          for (const kind of producer.kinds) {
            for (const producerDirection of producer.directions ?? directions) {
              unfinishedCells.add(`${kind}/${producerDirection}`);
            }
          }
          edgeLimitReached ||= error instanceof ScopedRelationshipLimitReached;
        }
        for (const edge of collector.edges.values()) merged.set(edge.relationship_id, edge);
        excludedNeighbors ||= collector.excludedNeighbors;
        if (workBudget.exhausted) break;
      }
      const ordered = [...merged.values()].sort((left, right) =>
        scopedNeighborOrder(key, left, right),
      );
      if (ordered.length > query.max_edges) {
        incomplete = true;
        edgeLimitReached = true;
      }
      const finalCoverage = coverage.map((entry) =>
        entry.status === "unfinished" &&
        !workBudget.exhausted &&
        !unfinishedCells.has(`${entry.kind}/${entry.direction}`)
          ? { ...entry, status: "completed" as const }
          : entry,
      );
      incomplete ||= finalCoverage.some(
        ({ status }) => status === "unsupported" || status === "unfinished",
      );
      const selected = ordered.slice(0, query.max_edges);
      return {
        edges: selected.sort((left, right) =>
          left.relationship_id.localeCompare(right.relationship_id),
        ),
        coverage: finalCoverage,
        incomplete,
        edge_limit_reached: edgeLimitReached,
        work_items: workBudget.consumed - workAtStart,
        work_limit_reached: workBudget.exhausted,
        excluded_neighbors: excludedNeighbors,
      };
    },
  };
}

function callLikeExpression(node: Node): Node | undefined {
  if (Node.isCallExpression(node) || Node.isNewExpression(node)) return node.getExpression();
  if (Node.isTaggedTemplateExpression(node)) return node.getTag();
  return undefined;
}

function unwrapInvocationExpression(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function locatedCallTarget(projectRoot: string, declaration: Node): LocatedSymbol | undefined {
  if (Node.isParameterDeclaration(declaration) || Node.isMethodSignature(declaration))
    return undefined;
  let targetNode = Node.isConstructorDeclaration(declaration)
    ? declaration.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)
    : declaration;
  if (
    targetNode &&
    (Node.isFunctionDeclaration(targetNode) || Node.isMethodDeclaration(targetNode)) &&
    !targetNode.getBody()
  ) {
    const implementations = declarationsForSymbol(targetNode.getSymbol()).filter(
      (candidate) =>
        ((Node.isFunctionDeclaration(targetNode) && Node.isFunctionDeclaration(candidate)) ||
          (Node.isMethodDeclaration(targetNode) && Node.isMethodDeclaration(candidate))) &&
        candidate.getBody(),
    );
    targetNode = implementations.length === 1 ? implementations[0] : undefined;
  }
  if (!targetNode) return undefined;
  const sourceFile = targetNode.getSourceFile();
  if (!isProjectScopedFile(projectRoot, sourceFile.getFilePath())) return undefined;
  return (
    collectSymbols(sourceFile).find((symbol) => symbol.node === targetNode) ??
    containingSymbol(sourceFile, targetNode)
  );
}

type CompilerInvocation =
  | { readonly state: "exact"; readonly target: LocatedSymbol }
  | { readonly state: "not_call" | "disjoint" | "unfinished" };

function classifyCompilerInvocation(
  checker: TypeChecker,
  projectRoot: string,
  node: Node,
): CompilerInvocation {
  const expression = callLikeExpression(node);
  if (!expression) return { state: "not_call" };
  const invoked = unwrapInvocationExpression(expression);
  const invokedDeclarations = declarationsForSymbol(invoked.getSymbol());
  if (invokedDeclarations.some(Node.isParameterDeclaration)) return { state: "unfinished" };
  const signature = checker.getResolvedSignature(node as never);
  const implicit = Node.isNewExpression(node) ? invoked.getType().getConstructSignatures() : [];
  if (!signature && implicit.length !== 1) return { state: "unfinished" };
  const declarations =
    invokedDeclarations.length > 0
      ? invokedDeclarations
      : signature
        ? [signature.getDeclaration()]
        : [];
  const targets = new Map<string, LocatedSymbol>();
  for (const candidate of declarations) {
    const target = locatedCallTarget(projectRoot, candidate);
    if (target) targets.set(symbolEndpoint(target, projectRoot).selector, target);
  }
  if (targets.size === 1) return { state: "exact", target: [...targets.values()][0] };
  return declarations.length > 0 && targets.size === 0
    ? { state: "disjoint" }
    : { state: "unfinished" };
}

export function collectCompilerCallRelationships(
  project: Project,
  projectRoot: string,
  freshness: FreshnessMetadata,
  options: {
    readonly max_edges?: number;
    readonly max_work_items?: number;
    readonly work_tracker?: CompilerImpactWorkTracker;
  } = {},
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
) {
  const maxEdges = options.max_edges ?? 5_000;
  const maxWorkItems = options.max_work_items ?? 100_000;
  if (!Number.isSafeInteger(maxEdges) || maxEdges < 1) {
    throw new Error("Compiler call max_edges must be a positive safe integer.");
  }
  const tracker = options.work_tracker ?? new CompilerImpactWorkTracker(maxWorkItems);

  const normalizedFreshness = normalizeFreshness(freshness);
  const checker = project.getTypeChecker();
  const edges = new Map<string, RelationshipEdge>();
  let workLimitReached = false;
  for (const sourceFile of project
    .getSourceFiles()
    .sort((left, right) => left.getFilePath().localeCompare(right.getFilePath()))) {
    sourceFile.forEachDescendant((node, traversal) => {
      try {
        tracker.charge(requestContext);
      } catch (error) {
        if (!(error instanceof CompilerImpactWorkExhausted)) throw error;
        workLimitReached = true;
        traversal.stop();
        return;
      }
      const invocation = classifyCompilerInvocation(checker, projectRoot, node);
      if (invocation.state !== "exact") return;
      const caller = containingSymbol(sourceFile, node);
      if (!caller) return;
      const target = invocation.target;
      const edge = createRelationshipEdge({
        source: symbolEndpoint(caller, projectRoot),
        target: symbolEndpoint(target, projectRoot),
        kind: "call",
        provenance: "compiler",
        confidence: "exact",
        resolution: "resolved",
        freshness: normalizedFreshness,
      });
      edges.set(edge.relationship_id, edge);
    });
    if (workLimitReached) break;
  }
  const ordered = [...edges.values()].sort((left, right) =>
    left.relationship_id.localeCompare(right.relationship_id),
  );
  return Object.freeze({
    edges: Object.freeze(ordered.slice(0, maxEdges)),
    incomplete: workLimitReached || ordered.length > maxEdges,
  });
}

export function collectCompilerRelationships(
  project: Project,
  projectRoot: string,
  freshness: FreshnessMetadata,
  requestContext: RequestContext = NO_REQUEST_CONTEXT,
): RelationshipEdge[] {
  requestContext.checkpoint();
  const sourceFiles = project
    .getSourceFiles()
    .sort((left, right) => left.getFilePath().localeCompare(right.getFilePath()));
  const locatedSymbols = new Map<Node, LocatedSymbol>();
  for (const sourceFile of sourceFiles) {
    requestContext.checkpoint();
    for (const symbol of collectSymbols(sourceFile)) {
      requestContext.checkpoint();
      locatedSymbols.set(symbol.node, symbol);
    }
  }

  const state: CompilerRelationshipState = {
    projectRoot,
    sourceFiles: new Map(
      sourceFiles.map((sourceFile) => [sourceFileKey(sourceFile.getFilePath()), sourceFile]),
    ),
    locatedSymbols,
    freshness: normalizeFreshness(freshness),
    edges: new Map(),
  };
  requestContext.checkpoint();
  addReferenceEdges(state, requestContext);
  requestContext.checkpoint();
  addModuleEdges(state, requestContext);
  requestContext.checkpoint();
  addHeritageEdges(state, requestContext);

  requestContext.checkpoint();
  return [...state.edges.values()].sort((left, right) =>
    [left.kind, left.source.file, left.source.selector, left.target.file, left.target.selector]
      .join("\u0000")
      .localeCompare(
        [
          right.kind,
          right.source.file,
          right.source.selector,
          right.target.file,
          right.target.selector,
        ].join("\u0000"),
      ),
  );
}
