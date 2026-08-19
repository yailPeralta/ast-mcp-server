import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { format as prettierFormat } from "prettier";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error The benchmark is intentionally shipped as a standalone ESM script.
const benchmarkModule = await import("../scripts/benchmark-agent-workflows.mjs");
const {
  assertDistinctOutputPaths,
  formatDeterministicReport,
  projectObservationReport,
  publishBenchmarkReports,
} = benchmarkModule;

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repositoryRoot, "scripts", "benchmark-agent-workflows.mjs");
const temporaryDirectories: string[] = [];
const gateNames = [
  "evidence_preserved",
  "call_bounds_respected",
  "impact_corpus_pass",
  "impact_no_heuristic_authority",
  "impact_negative_controls_pass",
  "impact_candidate_fail_closed",
] as const;

function facts(generatedAt: string, nodeVersion: string, duration: number, payloadBytes = 10) {
  const gates = Object.fromEntries(gateNames.map((name) => [name, true]));
  return JSON.parse(
    `{"schema_version":3,"generated_at":"${generatedAt}","node_version":"${nodeVersion}","project_root":"[deterministic-fixture]","methodology":{"corpus":"benchmark/context-corpus.json","note":"bounded","model_round_trips":"turns","fallback":"fail closed","impact_corpus":"exact"},"static_tool_metadata":{"tool_count":16,"characters":50,"bytes":50},"index_lifecycle":{"schema_version":1,"query":"target","timings_ms":{"warm_query_ms":${duration}},"indexed_files":1,"warm_match_count":1,"compiler_fallback":true,"compiler_fallback_match_count":1},"impact_corpus":{"schema_version":1,"corpus":"benchmark/impact-corpus.json","scenario_count":1,"scenarios":[{"id":"exact","description":"exact edge","root":{"file_path":"src/a.ts","symbol_path":"a"},"expected":{"candidate_files":["test/a.test.ts"],"candidate_error":false,"exact_edge_count":1,"incomplete":false,"forbidden_edge_files":[]},"observed":{"candidate_files":["test/a.test.ts"],"candidate_error":false,"exact_edge_count":1,"heuristic_edge_count":0,"heuristic_authority_violation_count":0,"forbidden_edge_count":0,"incomplete":false,"truncation_reasons":[],"visited_nodes":2,"visited_edges":1},"pass":true}],"gates":{"all_scenarios_pass":true,"no_heuristic_presented_as_exact":true,"negative_controls_pass":true,"candidate_fail_closed":true}},"scenarios":[{"id":"search","description":"search","workflows":{"ast_explore":{"model_round_trips":1,"tool_invocations":1,"duration_ms":${duration},"payload":{"characters":${payloadBytes},"bytes":${payloadBytes},"tokens_o200k_base":3},"evidence_pass":true,"call_bound_pass":true,"fallback":"none","unresolved_count":0}}}],"gates":${JSON.stringify(gates)}}`,
  );
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ast-agent-benchmark-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("deterministic agent workflow benchmark publication", () => {
  it("separates volatile observations from identical Prettier-clean schema-v4 bytes", async () => {
    const first = facts("2026-08-19T00:00:00.000Z", "v22.13.0", 1.25, 10);
    const second = facts("2026-08-20T00:00:00.000Z", "v24.16.0", 99.5, 99);
    const firstBytes = await formatDeterministicReport(first);
    expect(firstBytes).toBe(await formatDeterministicReport(second));
    const deterministic = JSON.parse(firstBytes);
    expect(deterministic.schema_version).toBe(4);
    expect(deterministic.scenarios[0].workflows.ast_explore).not.toHaveProperty("payload");
    const firstObservation = projectObservationReport(first, {
      path: "evidence.json",
      sha256: "a",
    });
    const secondObservation = projectObservationReport(second, {
      path: "evidence.json",
      sha256: "a",
    });
    expect(firstObservation).not.toEqual(secondObservation);
    expect(firstObservation.scenarios[0].workflows.ast_explore.payload.bytes).toBe(10);
    expect(secondObservation.scenarios[0].workflows.ast_explore.payload.bytes).toBe(99);
    expect(firstBytes).toBe(await prettierFormat(firstBytes, { filepath: "evidence.json" }));
    expect(firstBytes).not.toMatch(/generated_at|node_version|timings_ms|duration_ms|payload/u);
    expect(await readFile(scriptPath, "utf8")).not.toContain("// prettier-ignore");
  });

  it("keeps tracked bytes and mtime unchanged on an identical second publication", async () => {
    const root = await temporaryDirectory();
    const output = path.join(root, "evidence.json");
    const observationsOutput = path.join(root, "runtime", "observation.json");
    await publishBenchmarkReports({
      report: facts("2026-08-19T00:00:00.000Z", "v22.13.0", 1),
      output,
      observationsOutput,
    });
    const retainedRunOne = path.join(root, "runtime", "run-1-evidence.json");
    const before = { bytes: await readFile(output), stat: await stat(output) };
    await writeFile(retainedRunOne, before.bytes);
    await publishBenchmarkReports({
      report: facts("2026-08-20T00:00:00.000Z", "v24.16.0", 2, 99),
      output,
      observationsOutput,
    });
    const after = { bytes: await readFile(output), stat: await stat(output) };
    expect(after.bytes.equals(await readFile(retainedRunOne))).toBe(true);
    expect(createHash("sha256").update(after.bytes).digest("hex")).toBe(
      createHash("sha256").update(before.bytes).digest("hex"),
    );
    expect(after.stat.mtimeMs).toBe(before.stat.mtimeMs);
  });

  it.each(gateNames)(
    "preserves last-known-good evidence and records a false %s gate",
    async (gate) => {
      const root = await temporaryDirectory();
      const output = path.join(root, "evidence.json");
      const observationsOutput = path.join(root, "observation.json");
      await writeFile(output, "last-known-good\n");
      const report = facts("2026-08-19T00:00:00.000Z", "v24.16.0", 1);
      report.gates[gate] = false;
      await expect(publishBenchmarkReports({ report, output, observationsOutput })).rejects.toThrow(
        /Benchmark gates failed/u,
      );
      expect(await readFile(output, "utf8")).toBe("last-known-good\n");
      expect(JSON.parse(await readFile(observationsOutput, "utf8")).gates[gate]).toBe(false);
    },
  );

  it("rejects normalized, symlink-ancestry, and hard-link output aliases", async () => {
    const root = await temporaryDirectory();
    const real = path.join(root, "real");
    const alias = path.join(root, "alias");
    await mkdir(real);
    await symlink(real, alias, "dir");
    const output = path.join(real, "evidence.json");
    await expect(
      assertDistinctOutputPaths(path.relative(process.cwd(), output), output),
    ).rejects.toThrow(/distinct/u);
    await expect(
      assertDistinctOutputPaths(output, path.join(alias, "evidence.json")),
    ).rejects.toThrow(/distinct/u);
    await writeFile(output, "good\n");
    const hardLink = path.join(root, "hard-link.json");
    await link(output, hardLink);
    await expect(assertDistinctOutputPaths(output, hardLink)).rejects.toThrow(/distinct/u);
  });

  it("revalidates file identity immediately before tracked publication", async () => {
    const root = await temporaryDirectory();
    const output = path.join(root, "evidence.json");
    const observationsOutput = path.join(root, "observation.json");
    await writeFile(output, "last-known-good\n");
    await expect(
      publishBenchmarkReports({
        report: facts("2026-08-19T00:00:00.000Z", "v24.16.0", 1),
        output,
        observationsOutput,
        beforeTrackedPublication: async () => {
          await rm(observationsOutput);
          await link(output, observationsOutput);
        },
      }),
    ).rejects.toThrow(/distinct/u);
    expect(await readFile(output, "utf8")).toBe("last-known-good\n");
  });

  it("is import-safe and treats hostile-looking CLI values as argv data", async () => {
    const root = await temporaryDirectory();
    const sentinel = path.join(root, "executed");
    const moduleUrl = pathToFileURL(scriptPath).href;
    const imported = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", `import(${JSON.stringify(moduleUrl)})`],
      { cwd: repositoryRoot },
    );
    expect(imported).toEqual(expect.objectContaining({ stdout: "", stderr: "" }));
    const hostile = path.join(root, `same;touch ${sentinel}`);
    await expect(
      execFileAsync(
        process.execPath,
        [scriptPath, "--output", hostile, "--observations-output", hostile],
        { cwd: repositoryRoot },
      ),
    ).rejects.toMatchObject({ code: 1 });
    await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
