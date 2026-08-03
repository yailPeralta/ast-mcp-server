#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { buildFileOutline } from "../dist/services/outline.js";
import { clearProjectSessions, createFreshProject, withProject } from "../dist/services/project.js";

function parseArgs(argv) {
  const options = { projectRoot: undefined, sample: 20, filter: undefined, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--sample") options.sample = Number(argv[++index]);
    else if (value === "--filter") options.filter = argv[++index];
    else if (value === "--output") options.output = argv[++index];
    else if (!options.projectRoot) options.projectRoot = value;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.projectRoot) {
    throw new Error(
      "Usage: node scripts/benchmark.mjs <project-root|tsconfig> [--sample N] [--filter text] [--output file]",
    );
  }
  if (!Number.isInteger(options.sample) || options.sample < 1) {
    throw new Error("--sample must be a positive integer.");
  }
  return options;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const options = parseArgs(process.argv.slice(2));
const requestedRoot = path.resolve(options.projectRoot);
const loadStarted = performance.now();
const context = createFreshProject(requestedRoot);
const freshLoadMs = performance.now() - loadStarted;
const filter = options.filter?.toLowerCase();
const candidates = context.project
  .getSourceFiles()
  .filter((sourceFile) => !sourceFile.isDeclarationFile())
  .filter((sourceFile) => !sourceFile.getFilePath().includes(`${path.sep}node_modules${path.sep}`))
  .filter((sourceFile) => !filter || sourceFile.getFilePath().toLowerCase().includes(filter))
  .sort((left, right) => left.getFilePath().localeCompare(right.getFilePath()));
const sampled = candidates.slice(0, options.sample);
if (sampled.length === 0) throw new Error("No matching non-declaration source files were found.");

const files = sampled.map((sourceFile) => {
  const startedAt = performance.now();
  const outline = buildFileOutline(sourceFile);
  const durationMs = performance.now() - startedAt;
  const sourceChars = sourceFile.getFullText().length;
  const structuredChars = JSON.stringify({
    file: path.relative(context.projectRoot, sourceFile.getFilePath()),
    outline: outline.text,
  }).length;
  const detailedChars = JSON.stringify({
    file: path.relative(context.projectRoot, sourceFile.getFilePath()),
    outline: outline.text,
    symbols: outline.symbols,
  }).length;
  return {
    file: path.relative(context.projectRoot, sourceFile.getFilePath()),
    source_chars: sourceChars,
    outline_text_chars: outline.text.length,
    structured_result_chars: structuredChars,
    detailed_result_chars: detailedChars,
    reduction_percent:
      sourceChars === 0 ? 0 : ((sourceChars - structuredChars) / sourceChars) * 100,
    symbol_count: outline.symbols.length,
    duration_ms: durationMs,
  };
});

clearProjectSessions();
const firstFile = files[0].file;
const coldStarted = performance.now();
await withProject(requestedRoot, ({ project }) => {
  const sourceFile = project.getSourceFile((entry) =>
    path.relative(context.projectRoot, entry.getFilePath()).endsWith(firstFile),
  );
  if (!sourceFile) throw new Error(`Benchmark source disappeared: ${firstFile}`);
  buildFileOutline(sourceFile);
});
const coldSessionMs = performance.now() - coldStarted;
const warmStarted = performance.now();
await withProject(requestedRoot, ({ project }) => {
  const sourceFile = project.getSourceFile((entry) =>
    path.relative(context.projectRoot, entry.getFilePath()).endsWith(firstFile),
  );
  if (!sourceFile) throw new Error(`Benchmark source disappeared: ${firstFile}`);
  buildFileOutline(sourceFile);
});
const warmSessionMs = performance.now() - warmStarted;

const totals = files.reduce(
  (accumulator, file) => ({
    source: accumulator.source + file.source_chars,
    outline: accumulator.outline + file.structured_result_chars,
    detailed: accumulator.detailed + file.detailed_result_chars,
  }),
  { source: 0, outline: 0, detailed: 0 },
);
const durations = files.map((file) => file.duration_ms);
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  project_root: context.projectRoot,
  tsconfig: context.tsConfigFilePath,
  node_version: process.version,
  methodology: {
    selection:
      "lexicographically first non-declaration project files after optional substring filter",
    sample_requested: options.sample,
    sample_measured: files.length,
    token_claim: "No tokenizer claim. Character counts measure serialized MCP payload size only.",
  },
  latency_ms: {
    fresh_project_load: freshLoadMs,
    cold_cached_session_outline: coldSessionMs,
    warm_cached_session_outline: warmSessionMs,
    outline_p50: percentile(durations, 0.5),
    outline_p95: percentile(durations, 0.95),
  },
  payload: {
    full_source_chars: totals.source,
    default_structured_outline_chars: totals.outline,
    detailed_structured_outline_chars: totals.detailed,
    reduction_percent:
      totals.source === 0 ? 0 : ((totals.source - totals.outline) / totals.source) * 100,
  },
  files,
};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) {
  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}
process.stdout.write(output);
