import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolDescriptor as applyOperation } from "./apply_operation.js";
import { toolDescriptor as explore } from "./explore.js";
import { toolDescriptor as findReferences } from "./find_references.js";
import { toolDescriptor as findTestCandidates } from "./find_test_candidates.js";
import { toolDescriptor as getDiagnostics } from "./get_diagnostics.js";
import { toolDescriptor as getFile } from "./get_file.js";
import { toolDescriptor as getImpact } from "./get_impact.js";
import { toolDescriptor as getOperationPreview } from "./get_operation_preview.js";
import { toolDescriptor as getOutline } from "./get_outline.js";
import { toolDescriptor as getProjectStatus } from "./get_project_status.js";
import { toolDescriptor as getSymbolSource } from "./get_symbol_source.js";
import { toolDescriptor as listFiles } from "./list_files.js";
import { toolDescriptor as renameSymbol } from "./rename_symbol.js";
import { toolDescriptor as replaceSymbolBody } from "./replace_symbol_body.js";
import { toolDescriptor as scaffoldClass } from "./scaffold_class.js";
import { toolDescriptor as searchSymbols } from "./search_symbols.js";

export type ToolName = `ast_${string}`;
type Base<N extends ToolName> = {
  readonly name: N;
  readonly register: (server: McpServer) => void;
  readonly compatibility: "required" | "optional";
};
type Capability<E, B, F> = {
  readonly effect: E;
  readonly batch: B;
  readonly directOutputFormats: F;
};
export type ToolDescriptor<N extends ToolName = ToolName> = Base<N> &
  (
    | Capability<"read", "none" | "read", readonly ["json"] | readonly ["json", "toon"]>
    | Capability<"prepare", "prepare", readonly ["json"]>
    | Capability<"apply", "none", readonly ["json"]>
  );

type NamesWith<T extends readonly ToolDescriptor[], P> = Extract<T[number], P>["name"];
type Catalog<T extends readonly ToolDescriptor[]> = Readonly<{
  descriptors: Readonly<T>;
  batch: Readonly<{
    read: readonly NamesWith<T, { batch: "read" }>[];
    prepare: readonly NamesWith<T, { batch: "prepare" }>[];
    excluded: readonly NamesWith<T, { batch: "none" }>[];
  }>;
  compatibility: Readonly<{
    required: readonly NamesWith<T, { compatibility: "required" }>[];
    optional: readonly NamesWith<T, { compatibility: "optional" }>[];
  }>;
  byEffect: Readonly<{
    read: readonly NamesWith<T, { effect: "read" }>[];
    prepare: readonly NamesWith<T, { effect: "prepare" }>[];
    apply: readonly NamesWith<T, { effect: "apply" }>[];
  }>;
  directToon: readonly NamesWith<T, { directOutputFormats: readonly ["json", "toon"] }>[];
  registerAll(server: McpServer): void;
}>;

function validateDescriptor(descriptor: ToolDescriptor): void {
  const formats = descriptor.directOutputFormats.join(",");
  const valid =
    (descriptor.effect === "read" &&
      (descriptor.batch === "none" || descriptor.batch === "read") &&
      (formats === "json" || formats === "json,toon")) ||
    (descriptor.effect === "prepare" && descriptor.batch === "prepare" && formats === "json") ||
    (descriptor.effect === "apply" && descriptor.batch === "none" && formats === "json");
  if (!valid) throw new Error(`Contradictory capability descriptor: ${descriptor.name}`);
}

export function defineToolCatalog<const T extends readonly ToolDescriptor[]>(input: T): Catalog<T> {
  const seen = new Set<ToolName>();
  for (const descriptor of input) {
    if (seen.has(descriptor.name)) throw new Error(`Duplicate tool name: ${descriptor.name}`);
    seen.add(descriptor.name);
    validateDescriptor(descriptor);
  }
  const descriptors = Object.freeze(
    input.map((descriptor) =>
      Object.freeze({
        ...descriptor,
        directOutputFormats: Object.freeze([...descriptor.directOutputFormats]),
      }),
    ),
  ) as unknown as Readonly<T>;
  const names = <P>(predicate: (descriptor: T[number]) => boolean) =>
    Object.freeze(descriptors.filter(predicate).map(({ name }) => name)) as readonly NamesWith<
      T,
      P
    >[];
  return Object.freeze({
    descriptors,
    batch: Object.freeze({
      read: names<{ batch: "read" }>((item) => item.batch === "read"),
      prepare: names<{ batch: "prepare" }>((item) => item.batch === "prepare"),
      excluded: names<{ batch: "none" }>((item) => item.batch === "none"),
    }),
    compatibility: Object.freeze({
      required: names<{ compatibility: "required" }>((item) => item.compatibility === "required"),
      optional: names<{ compatibility: "optional" }>((item) => item.compatibility === "optional"),
    }),
    byEffect: Object.freeze({
      read: names<{ effect: "read" }>((item) => item.effect === "read"),
      prepare: names<{ effect: "prepare" }>((item) => item.effect === "prepare"),
      apply: names<{ effect: "apply" }>((item) => item.effect === "apply"),
    }),
    directToon: names<{ directOutputFormats: readonly ["json", "toon"] }>(
      (item) => item.directOutputFormats.length === 2,
    ),
    registerAll(server: McpServer) {
      for (const descriptor of descriptors) descriptor.register(server);
    },
  });
}

export const toolCatalog = defineToolCatalog([
  listFiles,
  getProjectStatus,
  explore,
  getOutline,
  getSymbolSource,
  searchSymbols,
  findReferences,
  getImpact,
  findTestCandidates,
  getDiagnostics,
  getFile,
  renameSymbol,
  replaceSymbolBody,
  scaffoldClass,
  getOperationPreview,
  applyOperation,
] as const);
