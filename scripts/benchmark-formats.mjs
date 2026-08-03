#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decode, encode as encodeToon } from "@toon-format/toon";
import { countTokens } from "gpt-tokenizer";
import { createServer } from "../dist/server.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V030_TOOL_METADATA_CHARS = 19_101;
const ENCODE_ITERATIONS = 50;

function parseArguments(argv) {
  const options = {
    projectRoot: repositoryRoot,
    output: path.join(repositoryRoot, "benchmark/results/self-formats.json"),
    query: "a",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (argument === "--query") options.query = argv[++index];
    else if (!argument.startsWith("--")) options.projectRoot = path.resolve(argument);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.query) throw new Error("--query must not be empty.");
  return options;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function timedMedian(operation) {
  operation();
  const samples = [];
  for (let index = 0; index < ENCODE_ITERATIONS; index += 1) {
    const startedAt = performance.now();
    operation();
    samples.push(performance.now() - startedAt);
  }
  return median(samples);
}

function percentReduction(baseline, candidate) {
  return ((baseline - candidate) / baseline) * 100;
}

function measurePayload(name, value, eligible, source) {
  const normalized = JSON.parse(JSON.stringify(value));
  const json = JSON.stringify(normalized);
  const toon = encodeToon(normalized);
  const envelope = JSON.stringify({ format: "toon", data: toon });
  const decoded = decode(toon);
  return {
    name,
    eligible,
    source,
    record_count:
      normalized.symbols?.length ??
      normalized.references?.length ??
      normalized.diagnostics?.length ??
      normalized.files?.length ??
      null,
    round_trip_equal: isDeepStrictEqual(decoded, normalized),
    json: {
      characters: json.length,
      bytes: Buffer.byteLength(json),
      tokens_o200k_base: countTokens(json),
    },
    toon: {
      characters: toon.length,
      bytes: Buffer.byteLength(toon),
      tokens_o200k_base: countTokens(toon),
    },
    mcp_envelope: {
      characters: envelope.length,
      bytes: Buffer.byteLength(envelope),
      tokens_o200k_base: countTokens(envelope),
    },
    reduction_percent: {
      cli_tokens: percentReduction(countTokens(json), countTokens(toon)),
      mcp_tokens: percentReduction(countTokens(json), countTokens(envelope)),
      cli_bytes: percentReduction(Buffer.byteLength(json), Buffer.byteLength(toon)),
      mcp_bytes: percentReduction(Buffer.byteLength(json), Buffer.byteLength(envelope)),
    },
    latency_ms: {
      encode_p50: timedMedian(() => encodeToon(normalized)),
      decode_p50: timedMedian(() => decode(toon)),
    },
  };
}

function structured(result, label) {
  if (result.isError === true || !result.structuredContent) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`);
  }
  if (result.structuredContent.format === "toon") {
    throw new Error(`${label} unexpectedly returned TOON.`);
  }
  return result.structuredContent;
}

async function callJson(client, name, args) {
  return structured(await client.callTool({ name, arguments: args }), name);
}

async function createCollectionFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-toon-benchmark-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "CommonJS" },
      include: ["src/**/*"],
    }),
  );
  await writeFile(
    path.join(root, "src/shared.ts"),
    "export function benchmarkTarget(value: number): number { return value + 1; }\n",
  );
  for (let fileIndex = 0; fileIndex < 10; fileIndex += 1) {
    const calls = Array.from(
      { length: 6 },
      (_, callIndex) =>
        `export const value${fileIndex}_${callIndex} = benchmarkTarget(${fileIndex * 10 + callIndex});`,
    ).join("\n");
    await writeFile(
      path.join(root, `src/use-${fileIndex}.ts`),
      `import { benchmarkTarget } from "./shared";\n${calls}\n`,
    );
  }
  const diagnostics = Array.from(
    { length: 30 },
    (_, index) => `export const wrong${index}: string = ${index};`,
  ).join("\n");
  await writeFile(path.join(root, "src/diagnostics.ts"), `${diagnostics}\n`);
  return root;
}

async function collectPayloads(client, projectRoot, fixtureRoot, query) {
  const broadSearch = await callJson(client, "ast_search_symbols", {
    project_root: projectRoot,
    query,
    limit: 100,
  });
  if (!Array.isArray(broadSearch.symbols) || broadSearch.symbols.length < 10) {
    throw new Error(`Broad search query ${JSON.stringify(query)} returned fewer than 10 symbols.`);
  }

  const fixtureSearch = await callJson(client, "ast_search_symbols", {
    project_root: fixtureRoot,
    query: "benchmarkTarget",
    limit: 10,
  });
  const declaration = fixtureSearch.symbols?.find((symbol) => symbol.name === "benchmarkTarget");
  if (!declaration) throw new Error("Reference benchmark declaration was not found.");

  const references = await callJson(client, "ast_find_references", {
    project_root: fixtureRoot,
    file_path: declaration.file,
    symbol_path: declaration.symbol_path,
    limit: 100,
  });
  const diagnostics = await callJson(client, "ast_get_diagnostics", {
    project_root: fixtureRoot,
    limit: 100,
  });
  const files = await callJson(client, "ast_list_files", {
    project_root: projectRoot,
    limit: 100,
  });
  const outline = await callJson(client, "ast_get_outline", {
    project_root: projectRoot,
    file_path: "src/tools/search_symbols.ts",
  });
  const source = await callJson(client, "ast_get_symbol_source", {
    project_root: projectRoot,
    file_path: "src/tools/search_symbols.ts",
    symbol_path: "registerSearchSymbols",
  });
  const prepared = await callJson(client, "ast_rename_symbol", {
    project_root: fixtureRoot,
    file_path: declaration.file,
    symbol_path: declaration.symbol_path,
    new_name: "renamedBenchmarkTarget",
    dry_run: true,
  });

  return [
    measurePayload("broad_symbol_search", broadSearch, true, "repository tool output"),
    measurePayload("references", references, true, "deterministic fixture tool output"),
    measurePayload("diagnostics", diagnostics, true, "deterministic fixture tool output"),
    measurePayload("file_list_negative_control", files, false, "repository tool output"),
    measurePayload("outline_negative_control", outline, false, "repository tool output"),
    measurePayload("source_negative_control", source, false, "repository tool output"),
    measurePayload(
      "prepare_negative_control",
      prepared,
      false,
      "deterministic fixture tool output",
    ),
  ];
}

const options = parseArguments(process.argv.slice(2));
const fixtureRoot = await createCollectionFixture();
const server = createServer();
const client = new Client({ name: "ast-toon-benchmark", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = await client.listTools();
  const payloads = await collectPayloads(client, options.projectRoot, fixtureRoot, options.query);
  const eligible = payloads.filter((payload) => payload.eligible);
  const aggregateJsonTokens = eligible.reduce(
    (total, payload) => total + payload.json.tokens_o200k_base,
    0,
  );
  const aggregateEnvelopeTokens = eligible.reduce(
    (total, payload) => total + payload.mcp_envelope.tokens_o200k_base,
    0,
  );
  const broad = payloads.find((payload) => payload.name === "broad_symbol_search");
  const roundTripPass = payloads.every((payload) => payload.round_trip_equal);
  const broadSavingsPass = broad.reduction_percent.mcp_tokens >= 20;
  const aggregateSavings = percentReduction(aggregateJsonTokens, aggregateEnvelopeTokens);
  const aggregateSavingsPass = aggregateSavings >= 15;
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const currentToolMetadataChars = JSON.stringify(tools.tools).length;
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    node_version: process.version,
    project_root:
      options.projectRoot === repositoryRoot ? "<repository-root>" : options.projectRoot,
    methodology: {
      tokenizer: "gpt-tokenizer o200k_base",
      tokenizer_package_version: packageJson.devDependencies["gpt-tokenizer"],
      toon_package_version: packageJson.dependencies["@toon-format/toon"],
      json_representation: "JSON.stringify of the validated logical result",
      cli_toon_representation: "plain TOON text",
      mcp_toon_representation: "JSON.stringify of {format:'toon',data:<TOON>} structuredContent",
      latency_iterations: ENCODE_ITERATIONS,
      billing_claim:
        "Tokenizer counts are local estimates only. No provider-side billed-token or cache claim is made.",
    },
    tool_metadata: {
      baseline_version: "0.3.0",
      baseline_serialized_characters: V030_TOOL_METADATA_CHARS,
      current_serialized_characters: currentToolMetadataChars,
      delta_characters: currentToolMetadataChars - V030_TOOL_METADATA_CHARS,
      delta_percent: percentReduction(V030_TOOL_METADATA_CHARS, currentToolMetadataChars) * -1,
    },
    payloads,
    aggregate: {
      eligible_json_tokens_o200k_base: aggregateJsonTokens,
      eligible_mcp_toon_tokens_o200k_base: aggregateEnvelopeTokens,
      eligible_mcp_token_reduction_percent: aggregateSavings,
    },
    gates: {
      round_trip_all_payloads: roundTripPass,
      broad_search_mcp_token_reduction_at_least_20_percent: broadSavingsPass,
      aggregate_eligible_mcp_token_reduction_at_least_15_percent: aggregateSavingsPass,
      passed: roundTripPass && broadSavingsPass && aggregateSavingsPass,
    },
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ status: report.gates.passed ? "ok" : "failed", output: options.output, broad_search_mcp_token_reduction_percent: broad.reduction_percent.mcp_tokens, aggregate_eligible_mcp_token_reduction_percent: aggregateSavings, tool_metadata_delta_characters: report.tool_metadata.delta_characters })}\n`,
  );
  if (!report.gates.passed) process.exitCode = 1;
} finally {
  await Promise.allSettled([client.close(), server.close()]);
  await rm(fixtureRoot, { recursive: true, force: true });
}
