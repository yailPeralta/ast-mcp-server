#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { countTokens } from "gpt-tokenizer";
import { format as prettierFormat, resolveConfig as resolvePrettierConfig } from "prettier";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultCorpus = path.join(repositoryRoot, "benchmark/context-corpus.json");
const defaultImpactCorpus = path.join(repositoryRoot, "benchmark/impact-corpus.json");
const defaultOutput = path.join(repositoryRoot, "benchmark/results/self-agent-workflows.json");
const defaultObservationsOutput = path.join(
  repositoryRoot,
  "benchmark/results/runtime/self-agent-workflows.json",
);

export function parseArgs(argv) {
  const options = {
    corpus: defaultCorpus,
    impactCorpus: defaultImpactCorpus,
    output: defaultOutput,
    observationsOutput: defaultObservationsOutput,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--corpus") options.corpus = path.resolve(argv[++index]);
    else if (value === "--impact-corpus") options.impactCorpus = path.resolve(argv[++index]);
    else if (value === "--output") options.output = path.resolve(argv[++index]);
    else if (value === "--observations-output")
      options.observationsOutput = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (Object.values(options).some((value) => value.endsWith("undefined"))) {
    throw new Error("Every benchmark path option requires a value.");
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
  if (scenario.include_references === true || scenario.id === "multi_file_references") {
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
    detail: scenario.id === "multi_file_references" ? "full" : "context",
    reference_detail: "context",
    limit: 20,
    reference_limit: 100,
    ...(scenario.explore_arguments ?? { query: scenario.query }),
  });
  const requiredExploreEvidence = [
    ...scenario.required_evidence,
    ...(scenario.required_explore_evidence ?? []),
  ];
  const exploreResult = {
    model_round_trips: 1,
    tool_invocations: 1,
    duration_ms: performance.now() - exploreStarted,
    payload: measurePayload([explore]),
    evidence_pass:
      containsEvidence([explore], requiredExploreEvidence) &&
      explore.completeness?.complete === true,
    call_bound_pass: 1 <= scenario.accepted_call_bound,
    fallback: explore.completeness?.complete === true ? "none" : "incomplete_evidence",
    unresolved_count: explore.completeness?.unresolved?.length ?? 0,
  };

  return { full_file: full, primitives: primitive, ast_explore: exploreResult };
}

async function runIndexLifecycleBenchmark(projectRoot, runtime) {
  const {
    clearProjectSessions,
    createFreshProject,
    searchProjectSymbols,
    searchProjectSymbolsWithIndex,
    withProject,
  } = runtime;
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

async function runImpactCorpus(impactCorpus, runtime) {
  const {
    collectCompilerRelationships,
    createFreshProject,
    findTestCandidates,
    isExactImpactEdge,
    resolveImpactRoot,
    traverseImpact,
  } = runtime;
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

const pick = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));
const workflowKeys = [
  "model_round_trips",
  "tool_invocations",
  "evidence_pass",
  "call_bound_pass",
  "fallback",
  "unresolved_count",
];
const gateKeys = [
  "evidence_preserved",
  "call_bounds_respected",
  "impact_corpus_pass",
  "impact_no_heuristic_authority",
  "impact_negative_controls_pass",
  "impact_candidate_fail_closed",
];
const impactGateKeys = [
  "all_scenarios_pass",
  "no_heuristic_presented_as_exact",
  "negative_controls_pass",
  "candidate_fail_closed",
];

export function projectDeterministicReport(report) {
  const projectWorkflowSet = (workflows) =>
    Object.fromEntries(
      Object.entries(workflows)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, workflow]) => [name, pick(workflow, workflowKeys)]),
    );
  const impactScenarios = report.impact_corpus.scenarios
    .map((scenario) => ({
      id: scenario.id,
      description: scenario.description,
      root: pick(scenario.root, ["file_path", "symbol_path"]),
      expected: pick(scenario.expected, [
        "candidate_files",
        "candidate_error",
        "exact_edge_count",
        "incomplete",
        "forbidden_edge_files",
      ]),
      observed: pick(scenario.observed, [
        "candidate_files",
        "candidate_error",
        "exact_edge_count",
        "heuristic_edge_count",
        "heuristic_authority_violation_count",
        "forbidden_edge_count",
        "incomplete",
        "truncation_reasons",
        "visited_nodes",
        "visited_edges",
      ]),
      pass: scenario.pass,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schema_version: 4,
    project_root: report.project_root,
    methodology: pick(report.methodology, [
      "corpus",
      "note",
      "model_round_trips",
      "fallback",
      "impact_corpus",
    ]),
    static_tool_metadata: pick(report.static_tool_metadata, ["tool_count", "characters", "bytes"]),
    index_lifecycle: pick(report.index_lifecycle, [
      "schema_version",
      "query",
      "indexed_files",
      "warm_match_count",
      "compiler_fallback",
      "compiler_fallback_match_count",
    ]),
    impact_corpus: {
      schema_version: report.impact_corpus.schema_version,
      corpus: report.impact_corpus.corpus,
      scenario_count: report.impact_corpus.scenario_count,
      scenarios: impactScenarios,
      gates: pick(report.impact_corpus.gates, impactGateKeys),
    },
    scenarios: report.scenarios
      .map((scenario) => ({
        id: scenario.id,
        description: scenario.description,
        workflows: projectWorkflowSet(scenario.workflows),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    gates: pick(report.gates, gateKeys),
  };
}

export async function formatDeterministicReport(report) {
  return prettierFormat(JSON.stringify(projectDeterministicReport(report)), {
    ...(await resolvePrettierConfig(defaultOutput)),
    filepath: defaultOutput,
  });
}

export function projectObservationReport(report, candidateEvidence) {
  return {
    schema_version: 1,
    generated_at: report.generated_at,
    node_version: report.node_version,
    candidate_evidence: candidateEvidence,
    index_lifecycle: { timings_ms: report.index_lifecycle.timings_ms },
    scenarios: report.scenarios
      .map((scenario) => ({
        id: scenario.id,
        workflows: Object.fromEntries(
          Object.entries(scenario.workflows)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, workflow]) => [
              name,
              {
                duration_ms: workflow.duration_ms,
                payload: pick(workflow.payload, ["characters", "bytes", "tokens_o200k_base"]),
              },
            ]),
        ),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    gates: pick(report.gates, gateKeys),
  };
}

async function outputIdentity(filePath) {
  const absolute = path.resolve(filePath);
  let ancestor = absolute;
  const missing = [];
  while (true) {
    try {
      const canonical = path.join(await realpath(ancestor), ...missing);
      const metadata = await stat(absolute).catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      return { canonical, file: metadata && `${metadata.dev}:${metadata.ino}` };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
}

export async function assertDistinctOutputPaths(output, observationsOutput) {
  const [evidence, observation] = await Promise.all([
    outputIdentity(output),
    outputIdentity(observationsOutput),
  ]);
  if (
    evidence.canonical === observation.canonical ||
    (evidence.file !== undefined && evidence.file === observation.file)
  ) {
    throw new Error("Benchmark evidence and observation outputs must be distinct.");
  }
}

async function writeIfChanged(filePath, bytes) {
  const current = await readFile(filePath).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (current?.equals(Buffer.from(bytes))) return false;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return true;
}

export async function publishBenchmarkReports({
  report,
  output,
  observationsOutput,
  beforeTrackedPublication,
}) {
  await assertDistinctOutputPaths(output, observationsOutput);
  const evidenceBytes = await formatDeterministicReport(report);
  const candidateEvidence = {
    path: path.relative(repositoryRoot, path.resolve(output)),
    sha256: createHash("sha256").update(evidenceBytes).digest("hex"),
  };
  const observationBytes = `${JSON.stringify(
    projectObservationReport(report, candidateEvidence),
    null,
    2,
  )}\n`;
  await assertDistinctOutputPaths(output, observationsOutput);
  await mkdir(path.dirname(observationsOutput), { recursive: true });
  await writeFile(observationsOutput, observationBytes);
  if (Object.values(report.gates).some((gate) => gate !== true)) {
    throw new Error(`Benchmark gates failed: ${JSON.stringify(report.gates)}`);
  }
  await beforeTrackedPublication?.();
  await assertDistinctOutputPaths(output, observationsOutput);
  return { candidateEvidence, changed: await writeIfChanged(output, evidenceBytes) };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  await assertDistinctOutputPaths(options.output, options.observationsOutput);
  const corpus = JSON.parse(await readFile(options.corpus, "utf8"));
  if (!Array.isArray(corpus.scenarios) || corpus.scenarios.length === 0) {
    throw new Error("Context corpus must contain at least one scenario.");
  }
  const impactCorpus = JSON.parse(await readFile(options.impactCorpus, "utf8"));
  const [
    serverModule,
    projectModule,
    testCandidatesModule,
    relationshipsModule,
    impactModule,
    symbolsModule,
  ] = await Promise.all([
    import("../dist/server.js"),
    import("../dist/services/project.js"),
    import("../dist/services/test-candidates.js"),
    import("../dist/services/relationships.js"),
    import("../dist/services/impact.js"),
    import("../dist/services/symbols.js"),
  ]);
  const runtime = {
    ...projectModule,
    ...testCandidatesModule,
    ...relationshipsModule,
    ...impactModule,
    ...symbolsModule,
  };
  const projectRoot = await createFixture();
  const server = serverModule.createServer();
  const client = new Client({ name: "ast-agent-workflow-benchmark", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const indexLifecycle = await runIndexLifecycleBenchmark(projectRoot, runtime);
    const impactReport = await runImpactCorpus(impactCorpus, runtime);
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
    const publication = await publishBenchmarkReports({
      report,
      output: options.output,
      observationsOutput: options.observationsOutput,
    });
    process.stdout.write(
      `${JSON.stringify({ status: "ok", output: options.output, observations_output: options.observationsOutput, evidence_sha256: publication.candidateEvidence.sha256, changed: publication.changed, tool_count: tools.tools.length, gates: report.gates })}\n`,
    );
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
    await rm(projectRoot, { recursive: true, force: true });
  }
}

const entryPath = process.argv[1] === undefined ? undefined : path.resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
