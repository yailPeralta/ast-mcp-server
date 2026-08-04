#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runBatchDocument, parseBatchDocument } from "../dist/batch/runner.js";
import { createServer } from "../dist/server.js";

const executeFile = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

function parseArguments(argv) {
  const options = {
    projectRoot: repositoryRoot,
    iterations: 5,
    output: path.join(repositoryRoot, "benchmark/results/self-batch.json"),
    worker: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--worker") options.worker = argv[++index];
    else if (argument === "--iterations") options.iterations = Number(argv[++index]);
    else if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (!argument.startsWith("--")) options.projectRoot = path.resolve(argument);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 30) {
    throw new Error("--iterations must be an integer between 1 and 30.");
  }
  return options;
}

function structured(result, label) {
  if (result.isError || !result.structuredContent) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`);
  }
  return result.structuredContent;
}

async function runSeparate(projectRoot) {
  const server = createServer();
  const client = new Client({ name: "ast-batch-benchmark-separate", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const startedAt = performance.now();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const search = structured(
      await client.callTool({
        name: "ast_search_symbols",
        arguments: { project_root: projectRoot, query: "Batch", limit: 100 },
      }),
      "search",
    );
    const symbol = search.symbols?.[0];
    if (!symbol) throw new Error("Benchmark symbol was not found.");
    const source = structured(
      await client.callTool({
        name: "ast_get_symbol_source",
        arguments: {
          project_root: projectRoot,
          file_path: symbol.file,
          symbol_path: symbol.selector,
        },
      }),
      "source",
    );
    return {
      duration_ms: performance.now() - startedAt,
      model_round_trips: 2,
      tool_invocations: 2,
      context_characters: JSON.stringify(search).length + JSON.stringify(source).length,
      final_result_characters: JSON.stringify(source).length,
      max_rss_bytes: process.resourceUsage().maxRSS * 1024,
    };
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

async function runBatch(projectRoot) {
  const document = parseBatchDocument({
    version: 1,
    project_root: projectRoot,
    steps: [
      {
        id: "search",
        tool: "ast_search_symbols",
        input: { query: "Batch", limit: 100 },
      },
      {
        id: "source",
        tool: "ast_get_symbol_source",
        input: {
          file_path: { $ref: "#/steps/search/symbols/0/file" },
          symbol_path: { $ref: "#/steps/search/symbols/0/selector" },
        },
      },
    ],
    emit: { $ref: "#/steps/source" },
  });
  const output = await runBatchDocument(document);
  return {
    duration_ms: output.duration_ms,
    model_round_trips: 1,
    tool_invocations: output.invocation_count,
    context_characters: JSON.stringify(output).length,
    final_result_characters: JSON.stringify(output.result).length,
    max_rss_bytes: process.resourceUsage().maxRSS * 1024,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function worker(options) {
  const result =
    options.worker === "separate"
      ? await runSeparate(options.projectRoot)
      : await runBatch(options.projectRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function runWorker(mode, projectRoot) {
  const { stdout, stderr } = await executeFile(
    process.execPath,
    [scriptPath, projectRoot, "--worker", mode],
    { cwd: repositoryRoot, maxBuffer: 12 * 1024 * 1024 },
  );
  if (stderr !== "") throw new Error(`Benchmark worker stderr: ${stderr}`);
  return JSON.parse(stdout);
}

async function parent(options) {
  const samples = { separate: [], batch: [] };
  for (let index = 0; index < options.iterations; index += 1) {
    samples.separate.push(await runWorker("separate", options.projectRoot));
    samples.batch.push(await runWorker("batch", options.projectRoot));
  }
  const summarize = (items) => ({
    median_duration_ms: median(items.map((item) => item.duration_ms)),
    median_max_rss_bytes: median(items.map((item) => item.max_rss_bytes)),
    model_round_trips: items[0].model_round_trips,
    tool_invocations: items[0].tool_invocations,
    context_characters: items[0].context_characters,
    final_result_characters: items[0].final_result_characters,
  });
  const separate = summarize(samples.separate);
  const batch = summarize(samples.batch);
  const report = {
    generated_at: new Date().toISOString(),
    node: process.version,
    project_root: options.projectRoot,
    iterations: options.iterations,
    scenario: "search the broad term Batch, then read the first exact symbol source",
    methodology:
      "Each sample runs in a fresh Node process. Characters are JSON string lengths, not tokenizer estimates.",
    separate,
    batch,
    reduction: {
      model_round_trips_percent:
        ((separate.model_round_trips - batch.model_round_trips) / separate.model_round_trips) * 100,
      context_characters_percent:
        ((separate.context_characters - batch.context_characters) / separate.context_characters) *
        100,
      duration_percent:
        ((separate.median_duration_ms - batch.median_duration_ms) / separate.median_duration_ms) *
        100,
      max_rss_percent:
        ((separate.median_max_rss_bytes - batch.median_max_rss_bytes) /
          separate.median_max_rss_bytes) *
        100,
    },
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ status: "ok", output: options.output, reduction: report.reduction })}\n`,
  );
}

const options = parseArguments(process.argv.slice(2));
if (options.worker) await worker(options);
else await parent(options);
