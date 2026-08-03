#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildFileOutline } from "../dist/services/outline.js";
import { createFreshProject, getSourceFileOrThrow } from "../dist/services/project.js";
import { findDeclaration } from "../dist/services/symbols.js";

const corpusPath = path.resolve(process.argv[2] ?? "benchmark/task-corpus.json");
const outputArgumentIndex = process.argv.indexOf("--output");
const outputPath =
  outputArgumentIndex >= 0 ? path.resolve(process.argv[outputArgumentIndex + 1]) : undefined;
const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
const projectRoot = path.resolve(path.dirname(corpusPath), corpus.project_root ?? ".");
const context = createFreshProject(projectRoot);

const tasks = corpus.tasks.map((task) => {
  const sources = task.files.map((file) => getSourceFileOrThrow(context.project, file));
  const fullSource = sources
    .map((sourceFile) => `${sourceFile.getFilePath()}\n${sourceFile.getFullText()}`)
    .join("\n");
  const outlines = sources.map((sourceFile) => {
    const outline = buildFileOutline(sourceFile);
    return {
      file: path.relative(context.projectRoot, sourceFile.getFilePath()),
      outline: outline.text,
    };
  });
  const symbolSources = (task.symbol_sources ?? []).map(({ file, symbol }) => {
    const sourceFile = getSourceFileOrThrow(context.project, file);
    const declaration = findDeclaration(sourceFile, symbol);
    if (!declaration) throw new Error(`Task ${task.id}: symbol not found: ${file}#${symbol}`);
    return {
      file,
      symbol,
      start_line: declaration.getStartLineNumber(),
      end_line: declaration.getEndLineNumber(),
      text: declaration.getText(),
    };
  });
  const compactPayload = { outlines, symbol_sources: symbolSources };
  const serializedCompact = JSON.stringify(compactPayload);
  const missingEvidence = task.expected_evidence.filter(
    (evidence) => !serializedCompact.includes(evidence),
  );
  return {
    id: task.id,
    question: task.question,
    file_count: task.files.length,
    full_source_chars: fullSource.length,
    compact_payload_chars: serializedCompact.length,
    reduction_percent:
      fullSource.length === 0
        ? 0
        : ((fullSource.length - serializedCompact.length) / fullSource.length) * 100,
    evidence_pass: missingEvidence.length === 0,
    missing_evidence: missingEvidence,
  };
});
const totals = tasks.reduce(
  (accumulator, task) => ({
    full: accumulator.full + task.full_source_chars,
    compact: accumulator.compact + task.compact_payload_chars,
  }),
  { full: 0, compact: 0 },
);
const report = {
  schema_version: 2,
  generated_at: new Date().toISOString(),
  project_root: context.projectRoot,
  methodology: {
    baseline: "Complete text of every file declared by each task.",
    compact:
      "Serialized default ast_get_outline-equivalent text plus only the ast_get_symbol_source-equivalent declarations named by each task.",
    correctness_check:
      "Each compact payload must contain the predefined evidence strings needed to answer the task. This is a reproducible evidence check, not a claim of general semantic equivalence or tokenizer-specific savings.",
  },
  task_count: tasks.length,
  evidence_pass_count: tasks.filter((task) => task.evidence_pass).length,
  payload: {
    full_source_chars: totals.full,
    compact_payload_chars: totals.compact,
    reduction_percent: totals.full === 0 ? 0 : ((totals.full - totals.compact) / totals.full) * 100,
  },
  tasks,
};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}
process.stdout.write(output);
if (report.evidence_pass_count !== report.task_count) process.exitCode = 1;
