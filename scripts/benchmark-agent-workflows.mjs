#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { countTokens } from "gpt-tokenizer";
import { createServer } from "../dist/server.js";
import { clearProjectSessions, createFreshProject, withProject } from "../dist/services/project.js";
import { findTestCandidates } from "../dist/services/test-candidates.js";
import { collectCompilerRelationships } from "../dist/services/relationships.js";
import { isExactImpactEdge, resolveImpactRoot, traverseImpact } from "../dist/services/impact.js";
import { searchProjectSymbols, searchProjectSymbolsWithIndex } from "../dist/services/symbols.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultCorpus = path.join(repositoryRoot, "benchmark/context-corpus.json");
const defaultImpactCorpus = path.join(repositoryRoot, "benchmark/impact-corpus.json");
const defaultOutput = path.join(repositoryRoot, "benchmark/results/self-agent-workflows.json");

function parseArgs(argv) {
  const options = {
    corpus: defaultCorpus,
    impactCorpus: defaultImpactCorpus,
    output: defaultOutput,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--corpus") options.corpus = path.resolve(argv[++index]);
    else if (value === "--impact-corpus") options.impactCorpus = path.resolve(argv[++index]);
    else if (value === "--output") options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function structured(result, label) {
  if (result.isError === true || !result.structuredContent) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`);
  }
  return result.structuredContent;
}

function measurePayload(payloads) {
  const serialized = JSON.stringify(payloads);
  return {
    characters: serialized.length,
    bytes: Buffer.byteLength(serialized, "utf8"),
    tokens_o200k_base: countTokens(serialized),
  };
}

function containsEvidence(payloads, requiredEvidence) {
  const serialized = JSON.stringify(payloads);
  return requiredEvidence.every((fragment) => serialized.includes(fragment));
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-agent-workflows-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        include: ["src/**/*"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, "src/shared.ts"),
    "export function benchmarkTarget(value: number): number { return value + 1; }\n",
  );
  await writeFile(
    path.join(root, "src/use.ts"),
    'import { benchmarkTarget } from "./shared.js";\nexport const result = benchmarkTarget(42);\n',
  );
  return root;
}

async function createImpactFixture(impactCorpus) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-impact-corpus-"));
  const fixture = impactCorpus.fixture;
  if (
    !fixture ||
    typeof fixture !== "object" ||
    !fixture.files ||
    typeof fixture.files !== "object"
  ) {
    throw new Error("Impact corpus fixture.files must be an object.");
  }
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        include: fixture.include ?? ["src/**/*", "test/**/*"],
      },
      null,
      2,
    ),
  );
  await Promise.all(
    Object.entries(fixture.files).map(async ([relativePath, content]) => {
      if (typeof content !== "string")
        throw new Error(`Impact fixture content is invalid: ${relativePath}.`);
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }),
  );
  return root;
}

async function runWorkflows(client, projectRoot, scenario) {
  const call = async (name, arguments_) =>
    structured(
      await client.callTool({ name, arguments: { project_root: projectRoot, ...arguments_ } }),
      name,
    );

  const fullStarted = performance.now();
  const fullPayloads = [];
  for (const filePath of scenario.full_files) {
    fullPayloads.push(await call("ast_get_file", { file_path: filePath, limit: 200 }));
  }
  const full = {
    model_round_trips: 1,
    tool_invocations: fullPayloads.length,
    duration_ms: performance.now() - fullStarted,
    payload: measurePayload(fullPayloads),
    evidence_pass: containsEvidence(fullPayloads, scenario.required_evidence),
    call_bound_pass: fullPayloads.length <= scenario.accepted_call_bound,
    fallback: "none",
    unresolved_count: 0,
  };

  const primitiveStarted = performance.now();
  const search = await call("ast_search_symbols", {
    query: scenario.query,
    detail: "summary",
    limit: 20,
  });
  const symbol = search.symbols?.find((candidate) =>
    candidate.selector.startsWith(`${scenario.symbol_path}@`),
  );
  if (!symbol) throw new Error(`Primitive workflow did not find ${scenario.symbol_path}.`);
  const primitivePayloads = [search];
  if (scenario.id === "multi_file_references") {
    primitivePayloads.push(
      await call("ast_find_references", {
        file_path: symbol.file,
        symbol_path: symbol.selector,
        detail: "context",
        limit: 100,
      }),
    );
  } else {
    primitivePayloads.push(
      await call("ast_get_symbol_source", {
        file_path: symbol.file,
        symbol_path: symbol.selector,
      }),
    );
  }
  const primitive = {
    model_round_trips: 2,
    tool_invocations: primitivePayloads.length,
    duration_ms: performance.now() - primitiveStarted,
    payload: measurePayload(primitivePayloads),
    evidence_pass: containsEvidence(primitivePayloads, scenario.required_evidence),
    call_bound_pass: primitivePayloads.length <= scenario.accepted_call_bound,
    fallback: "none",
    unresolved_count: 0,
  };

  const exploreStarted = performance.now();
  const explore = await call("ast_explore", {
    query: scenario.query,
    detail: scenario.id === "multi_file_references" ? "full" : "context",
    reference_detail: "context",
    limit: 20,
    reference_limit: 100,
  });
  const exploreResult = {
    model_round_trips: 1,
    tool_invocations: 1,
    duration_ms: performance.now() - exploreStarted,
    payload: measurePayload([explore]),
    evidence_pass:
      containsEvidence([explore], scenario.required_evidence) &&
      explore.completeness?.complete === true,
    call_bound_pass: 1 <= scenario.accepted_call_bound,
    fallback: explore.completeness?.complete === true ? "none" : "incomplete_evidence",
    unresolved_count: explore.completeness?.unresolved?.length ?? 0,
  };

  return { full_file: full, primitives: primitive, ast_explore: exploreResult };
}

async function runIndexLifecycleBenchmark(projectRoot) {
  const sourcePath = path.join(projectRoot, "src/shared.ts");
  const configPath = path.join(projectRoot, "tsconfig.json");
  const originalSource = await readFile(sourcePath, "utf8");
  const originalConfig = await readFile(configPath, "utf8");
  const query = "benchmarkTarget";
  const timings = {};

  clearProjectSessions();
  let indexedContext;
  let startedAt = performance.now();
  await withProject(projectRoot, (context) => {
    indexedContext = context;
  });
  timings.initial_build_ms = performance.now() - startedAt;

  startedAt = performance.now();
  const warmMatches = await searchProjectSymbolsWithIndex(
    indexedContext.project,
    indexedContext.projectRoot,
    indexedContext.status.project,
    indexedContext.symbolIndex,
    indexedContext.symbolIndexReady,
    { query },
  );
  timings.warm_query_ms = performance.now() - startedAt;
  if (!warmMatches || warmMatches.length === 0) {
    throw new Error("Warm index benchmark did not return an indexed symbol.");
  }

  await writeFile(sourcePath, originalSource.replace("value + 1", "value + 2"));
  startedAt = performance.now();
  await withProject(projectRoot, () => undefined);
  timings.changed_file_rebuild_ms = performance.now() - startedAt;
  await writeFile(sourcePath, originalSource);
  await withProject(projectRoot, () => undefined);

  const changedConfig = JSON.parse(originalConfig);
  changedConfig.compilerOptions = { ...changedConfig.compilerOptions, noUnusedLocals: true };
  await writeFile(configPath, `${JSON.stringify(changedConfig, null, 2)}\n`);
  startedAt = performance.now();
  await withProject(projectRoot, () => undefined);
  timings.config_rebuild_ms = performance.now() - startedAt;
  await writeFile(configPath, originalConfig);
  await withProject(projectRoot, () => undefined);

  const fallbackContext = createFreshProject(projectRoot);
  startedAt = performance.now();
  const indexedFallback = await searchProjectSymbolsWithIndex(
    fallbackContext.project,
    fallbackContext.projectRoot,
    fallbackContext.status.project,
    fallbackContext.symbolIndex,
    false,
    { query },
  );
  const fallbackMatches =
    indexedFallback ??
    searchProjectSymbols(fallbackContext.project, fallbackContext.projectRoot, { query });
  timings.compiler_fallback_ms = performance.now() - startedAt;

  const result = {
    schema_version: 1,
    query,
    timings_ms: timings,
    indexed_files: new Set(warmMatches.map((match) => match.file_path)).size,
    warm_match_count: warmMatches.length,
    compiler_fallback: indexedFallback === undefined,
    compiler_fallback_match_count: fallbackMatches.length,
  };
  clearProjectSessions();
  return result;
}

function equalStringArrays(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function runImpactCorpus(impactCorpus) {
  if (!Array.isArray(impactCorpus.scenarios) || impactCorpus.scenarios.length === 0) {
    throw new Error("Impact corpus must contain at least one scenario.");
  }

  const projectRoot = await createImpactFixture(impactCorpus);
  const defaultFreshness = {
    state: "fresh",
    causes: [],
    checked_at: "2026-08-06T00:00:00.000Z",
  };
  try {
    const context = createFreshProject(projectRoot);
    const scenarios = [];
    for (const scenario of impactCorpus.scenarios) {
      const freshness = scenario.freshness ?? defaultFreshness;
      const edges = collectCompilerRelationships(context.project, projectRoot, freshness);
      const root = resolveImpactRoot(context.project, projectRoot, scenario.root);
      const impact = traverseImpact(root, edges, {
        direction: scenario.direction,
        max_depth: scenario.max_depth,
        max_nodes: scenario.max_nodes,
        max_edges: scenario.max_edges,
        relationship_kinds: scenario.relationship_kinds,
      });
      const exactEdges = impact.edges.filter(isExactImpactEdge);
      const heuristicAuthorityViolations = impact.edges.filter(
        (edge) => edge.provenance === "heuristic" && edge.compiler_authoritative === true,
      );
      const forbiddenEdgeFiles = scenario.expected.forbidden_edge_files ?? [];
      const forbiddenEdges = impact.edges.filter(
        (edge) =>
          forbiddenEdgeFiles.includes(edge.source.file) ||
          forbiddenEdgeFiles.includes(edge.target.file),
      );
      let candidates = [];
      let candidateError = false;
      try {
        candidates = [...findTestCandidates(impact)].map((candidate) => candidate.file).sort();
      } catch {
        candidateError = true;
      }

      const expected = scenario.expected;
      const observed = {
        candidate_files: candidates,
        candidate_error: candidateError,
        exact_edge_count: exactEdges.length,
        heuristic_edge_count: impact.edges.filter((edge) => edge.provenance === "heuristic").length,
        heuristic_authority_violation_count: heuristicAuthorityViolations.length,
        forbidden_edge_count: forbiddenEdges.length,
        incomplete: impact.incomplete,
        truncation_reasons: impact.truncation_reasons,
        visited_nodes: impact.visited_nodes,
        visited_edges: impact.visited_edges,
      };
      const pass =
        equalStringArrays(observed.candidate_files, [...(expected.candidate_files ?? [])].sort()) &&
        observed.candidate_error === expected.candidate_error &&
        observed.exact_edge_count === expected.exact_edge_count &&
        observed.incomplete === expected.incomplete &&
        observed.forbidden_edge_count === 0 &&
        observed.heuristic_authority_violation_count === 0;
      scenarios.push({
        id: scenario.id,
        description: scenario.description,
        root: scenario.root,
        expected,
        observed,
        pass,
      });
    }

    const gates = {
      all_scenarios_pass: scenarios.every((scenario) => scenario.pass),
      no_heuristic_presented_as_exact: scenarios.every(
        (scenario) => scenario.observed.heuristic_authority_violation_count === 0,
      ),
      negative_controls_pass: scenarios.every(
        (scenario) => scenario.observed.forbidden_edge_count === 0,
      ),
      candidate_fail_closed: scenarios.every(
        (scenario) => !scenario.expected.candidate_error || scenario.observed.candidate_error,
      ),
    };
    return {
      schema_version: 1,
      corpus: "benchmark/impact-corpus.json",
      scenario_count: scenarios.length,
      scenarios,
      gates,
    };
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv.slice(2));
const corpus = JSON.parse(await readFile(options.corpus, "utf8"));
if (!Array.isArray(corpus.scenarios) || corpus.scenarios.length === 0) {
  throw new Error("Context corpus must contain at least one scenario.");
}
const impactCorpus = JSON.parse(await readFile(options.impactCorpus, "utf8"));
const projectRoot = await createFixture();
const server = createServer();
const client = new Client({ name: "ast-agent-workflow-benchmark", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const indexLifecycle = await runIndexLifecycleBenchmark(projectRoot);
  const impactReport = await runImpactCorpus(impactCorpus);
  const tools = await client.listTools();
  const scenarios = [];
  for (const scenario of corpus.scenarios) {
    scenarios.push({
      id: scenario.id,
      description: scenario.description,
      workflows: await runWorkflows(client, projectRoot, scenario),
    });
  }
  const report = {
    schema_version: 3,
    generated_at: new Date().toISOString(),
    node_version: process.version,
    project_root: "[deterministic-fixture]",
    methodology: {
      corpus: path.relative(repositoryRoot, options.corpus),
      note: "Characters, bytes and o200k_base values are local serialized-payload measurements, not provider billing or latency guarantees.",
      model_round_trips:
        "Conceptual agent turns required by each workflow; tool_invocations are actual MCP calls.",
      fallback:
        "Any incomplete ast_explore evidence is reported; it is never treated as a successful complete context.",
      impact_corpus:
        "Compiler-backed relationships are checked against exact, stale, same-name, dynamic-dispatch and bounded-traversal controls; candidate tests are never executed.",
    },
    static_tool_metadata: {
      tool_count: tools.tools.length,
      characters: JSON.stringify(tools.tools).length,
      bytes: Buffer.byteLength(JSON.stringify(tools.tools), "utf8"),
    },
    index_lifecycle: indexLifecycle,
    impact_corpus: impactReport,
    scenarios,
    gates: {
      evidence_preserved: scenarios.every((scenario) =>
        Object.values(scenario.workflows).every((workflow) => workflow.evidence_pass),
      ),
      call_bounds_respected: scenarios.every((scenario) =>
        Object.values(scenario.workflows).every((workflow) => workflow.call_bound_pass),
      ),
      impact_corpus_pass: impactReport.gates.all_scenarios_pass,
      impact_no_heuristic_authority: impactReport.gates.no_heuristic_presented_as_exact,
      impact_negative_controls_pass: impactReport.gates.negative_controls_pass,
      impact_candidate_fail_closed: impactReport.gates.candidate_fail_closed,
    },
  };
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  execFileSync("yarn", ["prettier", "--write", options.output], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  if (Object.values(report.gates).some((gate) => gate !== true)) {
    throw new Error(`Benchmark gates failed: ${JSON.stringify(report.gates)}`);
  }
  process.stdout.write(
    `${JSON.stringify({ status: "ok", output: options.output, tool_count: tools.tools.length, gates: report.gates })}\n`,
  );
} finally {
  await Promise.allSettled([client.close(), server.close()]);
  await rm(projectRoot, { recursive: true, force: true });
}
