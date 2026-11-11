#!/usr/bin/env node
// Latency of Angular template evidence in ast_explore (#380).
//
//   yarn benchmark:explore-templates                 501 and 2001 components, 10 measured runs
//   options: --widgets 167,667 --runs 10 --json <file>
//   past the template scan limit of 10 000 components: --widgets 3334 (10 002 components)
//
// Each fixture size runs twice: the matrix project without `@angular/core` (baseline, template
// coverage `not_applicable`) and the same tree as an Angular project. Run on demand only; it is
// not part of `yarn test`. Needs Node with native TypeScript type stripping (>=22.18) because it
// imports the fixture generators from test/helpers. Exit code: 0 pass, 1 threshold failed,
// 2 harness error.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const SELF = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(SELF), "..");
const REQUEST = Object.freeze({ query: "label", detail: "full", limit: 20 });
const THRESHOLD_COMPONENTS = 501;
const MAX_ADDED_P95_MS = 2000;

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};

/** Counts `template_coverage` verdicts by reason, or by status when there is no reason. */
function coverageTally(content) {
  const tally = {};
  for (const item of content?.evidence ?? []) {
    const coverage = item.references?.template_coverage;
    if (!coverage) continue;
    const key = coverage.reason ?? coverage.status;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

async function measureCase(name, components, fixture, runs, deps) {
  const server = deps.createServer();
  const client = new Client({ name: "ast-explore-template-benchmark", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listing the tools makes the SDK client validate every structured result against the declared
    // `ast_explore` output schema, so an untyped response throws instead of being counted.
    await client.listTools();
    let typed = true;
    let last;
    const timed = async () => {
      const started = performance.now();
      try {
        const result = await client.callTool({
          name: "ast_explore",
          arguments: { project_root: fixture.root, ...REQUEST },
        });
        if (result.isError || !result.structuredContent) typed = false;
        else last = result.structuredContent;
      } catch {
        typed = false;
      }
      return performance.now() - started;
    };
    // The cold first call loads the project; it is the single warm-up and is reported apart.
    const coldMs = await timed();
    const samples = [];
    for (let index = 0; index < runs; index += 1) samples.push(await timed());
    return {
      name,
      components,
      symbols: last?.symbols.length ?? 0,
      cold_ms: coldMs,
      p50_ms: percentile(samples, 50),
      p95_ms: percentile(samples, 95),
      // Process high-water mark when the case ends: cumulative across the cases run so far.
      peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
      typed_result: typed,
      coverage: coverageTally(last),
    };
  } finally {
    await Promise.all([client.close(), server.close()]);
    deps.clearProjectSessions();
  }
}

/**
 * Runs the baseline and Angular case for each widget count. `deps` supplies the server factory
 * and the fixture helpers, so the same code runs against `dist/` here and `src/` under vitest.
 */
export async function runExploreTemplateBenchmark({ widgets, runs, ...deps }) {
  const cases = [];
  const added = [];
  for (const count of widgets) {
    const project = deps.generateMatrixProject({ components: count });
    const pair = [];
    for (const [kind, create] of [
      ["baseline", deps.createBaselineFixture],
      ["angular", deps.createAngularFixture],
    ]) {
      const fixture = await create(project.files);
      try {
        pair.push(
          await measureCase(
            `${kind}-${project.componentCount}`,
            project.componentCount,
            fixture,
            runs,
            deps,
          ),
        );
      } finally {
        await fixture.cleanup();
      }
    }
    cases.push(...pair);
    added.push({
      components: project.componentCount,
      added_p50_ms: pair[1].p50_ms - pair[0].p50_ms,
      added_p95_ms: pair[1].p95_ms - pair[0].p95_ms,
    });
  }
  return { request: { ...REQUEST }, runs, cases, added };
}

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function parseArgs(argv) {
  const args = { widgets: [167, 667], runs: 10, json: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--widgets") args.widgets = argv[++index].split(",").map(Number);
    else if (arg === "--runs") args.runs = Number(argv[++index]);
    else if (arg === "--json") args.json = argv[++index];
    else throw new Error(`unknown argument ${arg}`);
  }
  const positive = (value) => Number.isInteger(value) && value > 0;
  if (!args.widgets.every(positive) || !positive(args.runs)) {
    throw new Error("--widgets and --runs take positive integers");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // The test helpers import each other with `.js` specifiers; map them to the `.ts` sources.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith(".") || !specifier.endsWith(".js")) throw error;
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
    },
  });
  const [server, sessions, angular, matrix, plain] = await Promise.all([
    import("../dist/server.js"),
    import("../dist/services/project.js"),
    import("../test/helpers/angular-fixture.ts"),
    import("../test/helpers/angular-matrix-fixture.ts"),
    import("../test/helpers/project-fixture.ts"),
  ]);
  const measured = await runExploreTemplateBenchmark({
    widgets: args.widgets,
    runs: args.runs,
    createServer: server.createServer,
    clearProjectSessions: sessions.clearProjectSessions,
    generateMatrixProject: matrix.generateMatrixProject,
    createAngularFixture: (files) => angular.createAngularFixture(files, { compiler: "v21" }),
    createBaselineFixture: (files) =>
      plain.createProjectFixture(files, { parentDir: angular.ANGULAR_FIXTURE_ROOT }),
  });

  const failures = [];
  for (const item of measured.cases) {
    if (!item.typed_result) failures.push(`${item.name}: a request did not return a typed result`);
  }
  const gated = measured.added.find((item) => item.components === THRESHOLD_COMPONENTS);
  if (gated && gated.added_p95_ms > MAX_ADDED_P95_MS) {
    failures.push(
      `added p95 ${Math.round(gated.added_p95_ms)} ms exceeds ${MAX_ADDED_P95_MS} ms at ${THRESHOLD_COMPONENTS} components`,
    );
  }
  const report = {
    machine: {
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      memGiB: Math.round(os.totalmem() / 2 ** 30),
      platform: `${os.platform()} ${os.release()}`,
    },
    node: process.version,
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
    threshold: { components: THRESHOLD_COMPONENTS, max_added_p95_ms: MAX_ADDED_P95_MS },
    ...measured,
    verdict: failures.length === 0 ? "pass" : "fail",
    failures,
  };
  if (args.json) writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
