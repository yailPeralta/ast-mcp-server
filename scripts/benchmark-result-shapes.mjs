#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decode, encode } from "@toon-format/toon";
import { countTokens } from "gpt-tokenizer";
import { format } from "prettier";
import { createServer } from "../dist/server.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = path.resolve(
  outputIndex >= 0
    ? process.argv[outputIndex + 1]
    : path.join(repositoryRoot, "benchmark/results/self-result-shapes.json"),
);
const V040_TOOL_METADATA_CHARACTERS = 16_650;
const MINIMUM_TOON_TOKEN_REDUCTION_PERCENT = 35;

function percentReduction(baseline, candidate) {
  return baseline === 0 ? 0 : ((baseline - candidate) / baseline) * 100;
}

function measureSerialized(serialized) {
  return {
    characters: serialized.length,
    bytes: Buffer.byteLength(serialized),
    tokens_o200k_base: countTokens(serialized),
  };
}

function logicalResult(result, label) {
  if (result.isError === true || !result.structuredContent) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`);
  }
  if (result.structuredContent.format === "toon") {
    return decode(result.structuredContent.data);
  }
  return result.structuredContent;
}

function semanticValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "duration_ms"));
}

async function measuredCall(client, name, args) {
  const [jsonResult, toonResult] = await Promise.all([
    client.callTool({ name, arguments: { ...args, output_format: "json" } }),
    client.callTool({ name, arguments: { ...args, output_format: "toon" } }),
  ]);
  const jsonLogical = logicalResult(jsonResult, `${name}/json`);
  const toonLogical = logicalResult(toonResult, `${name}/toon`);
  if (JSON.stringify(semanticValue(jsonLogical)) !== JSON.stringify(semanticValue(toonLogical))) {
    throw new Error(`${name} JSON and decoded TOON values differ.`);
  }
  const semantic = semanticValue(jsonLogical);
  return {
    logical: jsonLogical,
    json: measureSerialized(JSON.stringify(semantic)),
    toon: measureSerialized(JSON.stringify({ format: "toon", data: encode(semantic) })),
  };
}

function sourceLineIndex(lines, fragment) {
  const lineIndex = lines.findIndex((line) => line.includes(fragment));
  if (lineIndex < 0) throw new Error(`Fixture fragment not found: ${fragment}`);
  return lineIndex + 1;
}

async function createCorpusFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-result-shapes-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "CommonJS" },
      include: ["src/**/*"],
    }),
  );

  const searchLines = [
    "export function helperCreateServer(): void {}",
    "export function createServer(): void {}",
    "export namespace Api {",
    "  export class Client {",
    "    request(value: string): string { return value; }",
    "    reset(): void {}",
    "  }",
    "}",
    ...Array.from(
      { length: 120 },
      (_, index) =>
        `export function item${String(index).padStart(3, "0")}(): number { return ${index}; }`,
    ),
  ];
  await writeFile(path.join(root, "src/search.ts"), `${searchLines.join("\n")}\n`);

  const sharedLine = "export function benchmarkTarget(value: number): number { return value + 1; }";
  await writeFile(path.join(root, "src/shared.ts"), `${sharedLine}\n`);
  const referenceFiles = [];
  for (let fileIndex = 0; fileIndex < 4; fileIndex += 1) {
    const lines = [
      'import { benchmarkTarget } from "./shared";',
      ...Array.from(
        { length: 5 },
        (_, callIndex) =>
          `export const result${fileIndex}_${callIndex} = benchmarkTarget(${fileIndex * 5 + callIndex});`,
      ),
    ];
    const file = `src/use-${fileIndex}.ts`;
    referenceFiles.push({ file, lines });
    await writeFile(path.join(root, file), `${lines.join("\n")}\n`);
  }

  const searchTasks = [
    {
      id: "exact-name",
      query: "createServer",
      expected: [`createServer@${sourceLineIndex(searchLines, "function createServer")}`],
    },
    {
      id: "exact-path",
      query: "Api.Client.request",
      expected: [`Api.Client.request@${sourceLineIndex(searchLines, "request(value")}`],
    },
    {
      id: "prefix",
      query: "Api.Cl",
      expected: [`Api.Client@${sourceLineIndex(searchLines, "class Client")}`],
    },
    {
      id: "broad-substring",
      query: "item",
      expected: Array.from(
        { length: 20 },
        (_, index) => `item${String(index).padStart(3, "0")}@${9 + index}`,
      ),
    },
  ];
  const expectedReferences = [
    {
      file: "src/shared.ts",
      line: 1,
      column: 1,
      is_declaration: true,
    },
    ...referenceFiles.flatMap(({ file, lines }) =>
      lines.map((line, index) => ({
        file,
        line: index + 1,
        column: line.indexOf("benchmarkTarget") + 1,
        is_declaration: false,
      })),
    ),
  ].sort((left, right) =>
    `${left.file}:${left.line}:${left.column}`.localeCompare(
      `${right.file}:${right.line}:${right.column}`,
    ),
  );

  return { root, searchTasks, expectedReferences };
}

function containsSelectors(logical, expected) {
  const selectors = new Set(logical.symbols.map((symbol) => symbol.selector));
  return expected.every((selector) => selectors.has(selector));
}

function containsReferences(logical, expected) {
  const coordinates = new Set(
    logical.references.map(
      (reference) =>
        `${reference.file}:${reference.line}:${reference.column}:${reference.is_declaration}`,
    ),
  );
  return expected.every((reference) =>
    coordinates.has(
      `${reference.file}:${reference.line}:${reference.column}:${reference.is_declaration}`,
    ),
  );
}

const fixture = await createCorpusFixture();
const server = createServer();
const client = new Client({ name: "ast-result-shape-benchmark", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const toolList = await client.listTools();
  const tasks = [];

  for (const task of fixture.searchTasks) {
    const common = { project_root: fixture.root, query: task.query };
    const [baseline, candidate] = await Promise.all([
      measuredCall(client, "ast_search_symbols", { ...common, detail: "full", limit: 100 }),
      measuredCall(client, "ast_search_symbols", common),
    ]);
    tasks.push({
      id: task.id,
      kind: "symbol_search",
      expected_evidence: task.expected,
      baseline_calls: 1,
      candidate_calls: 1,
      baseline: { json: baseline.json, toon: baseline.toon },
      candidate: { json: candidate.json, toon: candidate.toon },
      evidence_pass:
        containsSelectors(baseline.logical, task.expected) &&
        containsSelectors(candidate.logical, task.expected),
      call_bound_pass: true,
    });
  }

  const declarationResult = await client.callTool({
    name: "ast_search_symbols",
    arguments: {
      project_root: fixture.root,
      query: "benchmarkTarget",
      detail: "summary",
    },
  });
  const declarationLogical = logicalResult(declarationResult, "reference declaration search");
  const declaration = declarationLogical.symbols.find(
    (symbol) => symbol.selector.split("@")[0] === "benchmarkTarget",
  );
  if (!declaration) throw new Error("Reference fixture declaration was not found.");
  const referenceCommon = {
    project_root: fixture.root,
    file_path: declaration.file,
    symbol_path: declaration.selector,
  };
  const [referenceBaseline, referenceCandidate] = await Promise.all([
    measuredCall(client, "ast_find_references", { ...referenceCommon, detail: "context" }),
    measuredCall(client, "ast_find_references", referenceCommon),
  ]);
  const scopePass =
    referenceBaseline.logical.total === referenceCandidate.logical.total &&
    JSON.stringify(referenceBaseline.logical.affected_files) ===
      JSON.stringify(referenceCandidate.logical.affected_files) &&
    referenceBaseline.logical.include_declaration ===
      referenceCandidate.logical.include_declaration;
  tasks.push({
    id: "multi-file-references",
    kind: "references",
    expected_evidence: fixture.expectedReferences,
    baseline_calls: 2,
    candidate_calls: 2,
    baseline: { json: referenceBaseline.json, toon: referenceBaseline.toon },
    candidate: { json: referenceCandidate.json, toon: referenceCandidate.toon },
    evidence_pass:
      scopePass &&
      containsReferences(referenceBaseline.logical, fixture.expectedReferences) &&
      containsReferences(referenceCandidate.logical, fixture.expectedReferences),
    call_bound_pass: true,
  });

  const totals = tasks.reduce(
    (aggregate, task) => {
      for (const profile of ["baseline", "candidate"]) {
        aggregate[profile].calls += task[`${profile}_calls`];
        for (const format of ["json", "toon"]) {
          for (const metric of ["characters", "bytes", "tokens_o200k_base"]) {
            aggregate[profile][format][metric] += task[profile][format][metric];
          }
        }
      }
      return aggregate;
    },
    {
      baseline: {
        calls: 0,
        json: { characters: 0, bytes: 0, tokens_o200k_base: 0 },
        toon: { characters: 0, bytes: 0, tokens_o200k_base: 0 },
      },
      candidate: {
        calls: 0,
        json: { characters: 0, bytes: 0, tokens_o200k_base: 0 },
        toon: { characters: 0, bytes: 0, tokens_o200k_base: 0 },
      },
    },
  );
  const toonReduction = percentReduction(
    totals.baseline.toon.tokens_o200k_base,
    totals.candidate.toon.tokens_o200k_base,
  );
  const evidencePass = tasks.every((task) => task.evidence_pass && task.call_bound_pass);
  const currentToolMetadata = JSON.stringify(toolList.tools);
  const toolsWithoutScaffold = toolList.tools.filter((tool) => tool.name !== "ast_scaffold_class");
  if (toolsWithoutScaffold.length !== toolList.tools.length - 1) {
    throw new Error("Expected exactly one ast_scaffold_class tool definition.");
  }
  const metadataWithoutScaffold = JSON.stringify(toolsWithoutScaffold);
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    node_version: process.version,
    methodology: {
      corpus:
        "deterministic exact-name, exact-path, prefix, broad-substring and multi-file reference workflows",
      baseline: "search detail=full/limit=100 and references detail=context",
      candidate: "omitted search/reference detail and search limit (public defaults)",
      tokenizer: "gpt-tokenizer o200k_base",
      representation:
        "serialized MCP structuredContent with duration_ms omitted for deterministic measurement; TOON includes its {format,data} envelope",
      correctness:
        "Every declared selector/coordinate must remain present, reference scope metadata must match and required logical calls must not increase.",
      billing_claim:
        "Local serializer/tokenizer estimates only; no provider billing or cache-cost claim.",
    },
    threshold: {
      minimum_aggregate_toon_token_reduction_percent: MINIMUM_TOON_TOKEN_REDUCTION_PERCENT,
    },
    tasks,
    aggregate: {
      baseline: totals.baseline,
      candidate: totals.candidate,
      toon_token_reduction_percent: toonReduction,
    },
    tool_metadata: {
      baseline_version: "0.4.0",
      baseline_serialized_characters: V040_TOOL_METADATA_CHARACTERS,
      current_tool_count: toolList.tools.length,
      current_serialized_characters: currentToolMetadata.length,
      current_tokens_o200k_base: countTokens(currentToolMetadata),
      character_delta: currentToolMetadata.length - V040_TOOL_METADATA_CHARACTERS,
      scaffold_marginal_characters: currentToolMetadata.length - metadataWithoutScaffold.length,
      scaffold_marginal_tokens_o200k_base:
        countTokens(currentToolMetadata) - countTokens(metadataWithoutScaffold),
      historical_token_delta: null,
      note: "No retained v0.4.0 tokenizer count exists; historical token delta is intentionally not fabricated.",
    },
    checks: {
      evidence_and_calls: evidencePass,
      aggregate_toon_reduction: toonReduction >= MINIMUM_TOON_TOKEN_REDUCTION_PERCENT,
      complete_tool_list: toolList.tools.length === 14,
    },
  };
  report.pass = Object.values(report.checks).every(Boolean);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await format(`${JSON.stringify(report)}\n`, { parser: "json" }));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
} finally {
  await client.close();
  await server.close();
  await rm(fixture.root, { recursive: true, force: true });
}
