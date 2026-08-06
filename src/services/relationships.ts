import path from "node:path";
import { Node, type Project, type SourceFile, type Symbol as MorphSymbol } from "ts-morph";
import {
  createSourceLocation,
  isFreshnessCause,
  isSnapshotState,
  type FreshnessMetadata,
  type SourceRange,
} from "./read-contracts.js";
import { collectSymbols, containingSymbol, type LocatedSymbol } from "./symbols.js";

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
): LocatedSymbol[] {
  const unique = new Set<LocatedSymbol>();
  for (const declaration of declarations) {
    const sourceFile = declaration.getSourceFile();
    if (!state.sourceFiles.has(sourceFileKey(sourceFile.getFilePath()))) continue;
    const located = state.locatedSymbols.get(declaration);
    if (located) unique.add(located);
  }
  return [...unique];
}

function addReferenceEdges(state: CompilerRelationshipState): void {
  for (const target of new Set(state.locatedSymbols.values())) {
    if (!Node.isReferenceFindable(target.node)) continue;
    for (const reference of target.node.findReferencesAsNodes()) {
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

function addHeritageEdges(state: CompilerRelationshipState): void {
  for (const source of new Set(state.locatedSymbols.values())) {
    if (Node.isClassDeclaration(source.node)) {
      const base = source.node.getExtends();
      if (base) {
        for (const target of projectLocatedDeclarations(
          state,
          declarationsForType(base.getType()),
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
        for (const target of projectLocatedDeclarations(
          state,
          declarationsForType(implemented.getType()),
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
        for (const target of projectLocatedDeclarations(state, declarationsForType(base))) {
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

function addModuleEdges(state: CompilerRelationshipState): void {
  for (const sourceFile of state.sourceFiles.values()) {
    for (const declaration of sourceFile.getImportDeclarations()) {
      const targetFile = declaration.getModuleSpecifierSourceFile();
      if (!targetFile || !state.sourceFiles.has(sourceFileKey(targetFile.getFilePath()))) continue;
      const source = moduleEndpoint(sourceFile, state.projectRoot, declaration);
      let emitted = false;
      for (const specifier of declaration.getNamedImports()) {
        const targets = projectLocatedDeclarations(
          state,
          declarationsForSymbol(symbolFromNameNode(specifier.getNameNode())),
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
        )) {
          addEdge(state, source, symbolEndpoint(target, state.projectRoot), "import");
          emitted = true;
        }
      }
      if (!emitted) addEdge(state, source, moduleEndpoint(targetFile, state.projectRoot), "import");
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
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
        for (const target of projectLocatedDeclarations(state, declarations)) {
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

export function collectCompilerRelationships(
  project: Project,
  projectRoot: string,
  freshness: FreshnessMetadata,
): RelationshipEdge[] {
  const sourceFiles = project
    .getSourceFiles()
    .sort((left, right) => left.getFilePath().localeCompare(right.getFilePath()));
  const locatedSymbols = new Map<Node, LocatedSymbol>();
  for (const sourceFile of sourceFiles) {
    for (const symbol of collectSymbols(sourceFile)) locatedSymbols.set(symbol.node, symbol);
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
  addReferenceEdges(state);
  addModuleEdges(state);
  addHeritageEdges(state);

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
