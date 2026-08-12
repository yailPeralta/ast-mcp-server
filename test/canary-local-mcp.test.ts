import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as canaryModule from "../scripts/canary-local-mcp.mjs";
import {
  assertExpectedNodeVersion,
  assertRepositoryStatusUnchanged,
  canonicalizeToolResult,
  freezeCanaryReportSet,
  inspectCacheTree,
  parseCanaryArguments,
  validateWorkloadManifest,
} from "../scripts/canary-local-mcp.mjs";
import { createGitEnvironment } from "../scripts/git-evidence-authority.mjs";

const temporaryDirectories: string[] = [];
const temporaryFiles: string[] = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
) as { name: string; version: string };

const reportSetMembers = [
  {
    inputKey: "astNode24",
    option: "--ast-node24",
    fileName: "ast-mcp-server-node24.json",
    relativePath: "benchmark/results/production-readiness/ast-mcp-server-node24.json",
    alias: "[ast-mcp-server]",
    runtime: "24",
  },
  {
    inputKey: "astNode22_5",
    option: "--ast-node22.5",
    fileName: "ast-mcp-server-node22.5.json",
    relativePath: "benchmark/results/production-readiness/ast-mcp-server-node22.5.json",
    alias: "[ast-mcp-server]",
    runtime: "22.5.0",
  },
  {
    inputKey: "xScraperNode24",
    option: "--x-scraper-node24",
    fileName: "x-scraper-node24.json",
    relativePath: "benchmark/results/production-readiness/x-scraper-node24.json",
    alias: "[x-scraper]",
    runtime: "24",
  },
  {
    inputKey: "xScraperNode22_5",
    option: "--x-scraper-node22.5",
    fileName: "x-scraper-node22.5.json",
    relativePath: "benchmark/results/production-readiness/x-scraper-node22.5.json",
    alias: "[x-scraper]",
    runtime: "22.5.0",
  },
] as const;

const reportSetInputs = {
  astNode24: "/tmp/ast-mcp-server-node24.raw.json",
  astNode22_5: "/tmp/ast-mcp-server-node22.5.raw.json",
  xScraperNode24: "/tmp/x-scraper-node24.raw.json",
  xScraperNode22_5: "/tmp/x-scraper-node22.5.raw.json",
} as const;
const xScraperAuthorityRoot = path.join(os.tmpdir(), "ast-canary-x-scraper-root");

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function directTemporaryPath(label: string): string {
  const filePath = `/tmp/${label}-${randomUUID()}.json`;
  temporaryFiles.push(filePath);
  return filePath;
}

function canonicalText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

type PrivateAtomicPublisher = (options: {
  anchorRoot: string;
  resultsDirectory: string;
  finalDirectoryName: string;
  files: readonly { name: string; bytes: string }[];
  beforeVisibility?: (context: {
    stageDirectory: string;
    fileNames: readonly string[];
  }) => void | Promise<void>;
}) => Promise<void>;

type PrivateCanaryInternals = {
  readonly publishAtomicDirectorySet: PrivateAtomicPublisher;
  readonly currentWorktreeTreeAttempt: (root: string) => Promise<string>;
  readonly currentWorktreeTree: (
    root: string,
    attempt?: (root: string) => Promise<string>,
  ) => Promise<string>;
  readonly canaryOperationDeadlineMs: number;
  readonly mcpRequestTimeoutMs: number;
  readonly projectEnvironment: (
    policy: string | undefined,
    cacheRoot: string,
    extra?: Readonly<Record<string, string>>,
  ) => Record<string, string>;
  readonly canonicalizeCanaryReport: (
    report: Record<string, any>,
    checkedRelativePath: string,
    rawSha256: string,
  ) => Record<string, any>;
  readonly jsonValuesEqual: (left: unknown, right: unknown) => boolean;
  readonly assertPreparedCanaryReportSet: (preparedReports: readonly PreparedReport[]) => unknown;
};

let privateCanaryInternalsPromise: Promise<PrivateCanaryInternals> | undefined;

function loadPrivateCanaryInternals(): Promise<PrivateCanaryInternals> {
  privateCanaryInternalsPromise ??= (async () => {
    const moduleRoot = await temporaryDirectory("ast-canary-private-module-");
    const scriptsDirectory = path.join(moduleRoot, "scripts");
    await mkdir(scriptsDirectory);
    await symlink(
      path.join(repositoryRoot, "node_modules"),
      path.join(moduleRoot, "node_modules"),
      "dir",
    );
    const [packageMetadata, productionSource, gitAuthoritySource] = await Promise.all([
      readFile(path.join(repositoryRoot, "package.json"), "utf8"),
      readFile(path.join(repositoryRoot, "scripts", "canary-local-mcp.mjs"), "utf8"),
      readFile(path.join(repositoryRoot, "scripts", "git-evidence-authority.mjs"), "utf8"),
    ]);
    await writeFile(path.join(moduleRoot, "package.json"), packageMetadata, "utf8");
    await writeFile(
      path.join(scriptsDirectory, "git-evidence-authority.mjs"),
      gitAuthoritySource,
      "utf8",
    );
    expect(productionSource).not.toMatch(
      /^export\s+(?:(?:async\s+)?function|const)\s+(?:publishAtomicDirectorySet|canonicalizeCanaryReport|assertPreparedCanaryReportSet|projectEnvironment|currentWorktreeTreeAttempt|CANARY_OPERATION_DEADLINE_MS|MCP_REQUEST_TIMEOUT_MS)\b/m,
    );
    const testModulePath = path.join(scriptsDirectory, "canary-local-mcp.private-test.mjs");
    await writeFile(
      testModulePath,
      `${productionSource}\nexport {\n  publishAtomicDirectorySet as __testOnlyPublishAtomicDirectorySet,\n  canonicalizeCanaryReport as __testOnlyCanonicalizeCanaryReport,\n  jsonValuesEqual as __testOnlyJsonValuesEqual,\n  assertPreparedCanaryReportSet as __testOnlyAssertPreparedCanaryReportSet,\n  projectEnvironment as __testOnlyProjectEnvironment,\n  currentWorktreeTreeAttempt as __testOnlyCurrentWorktreeTreeAttempt,\n  currentWorktreeTree as __testOnlyCurrentWorktreeTree,\n  CANARY_OPERATION_DEADLINE_MS as __testOnlyCanaryOperationDeadlineMs,\n  MCP_REQUEST_TIMEOUT_MS as __testOnlyMcpRequestTimeoutMs,\n};\n`,
      "utf8",
    );
    const testModule = await import(`${pathToFileURL(testModulePath).href}?id=${randomUUID()}`);
    for (const name of [
      "__testOnlyPublishAtomicDirectorySet",
      "__testOnlyCanonicalizeCanaryReport",
      "__testOnlyJsonValuesEqual",
      "__testOnlyAssertPreparedCanaryReportSet",
      "__testOnlyProjectEnvironment",
      "__testOnlyCurrentWorktreeTreeAttempt",
      "__testOnlyCurrentWorktreeTree",
    ]) {
      if (typeof testModule[name] !== "function") {
        throw new Error(`Private canary test projection ${name} is unavailable.`);
      }
    }
    return {
      publishAtomicDirectorySet:
        testModule.__testOnlyPublishAtomicDirectorySet as PrivateAtomicPublisher,
      canonicalizeCanaryReport:
        testModule.__testOnlyCanonicalizeCanaryReport as PrivateCanaryInternals["canonicalizeCanaryReport"],
      jsonValuesEqual:
        testModule.__testOnlyJsonValuesEqual as PrivateCanaryInternals["jsonValuesEqual"],
      assertPreparedCanaryReportSet:
        testModule.__testOnlyAssertPreparedCanaryReportSet as PrivateCanaryInternals["assertPreparedCanaryReportSet"],
      projectEnvironment:
        testModule.__testOnlyProjectEnvironment as PrivateCanaryInternals["projectEnvironment"],
      currentWorktreeTreeAttempt:
        testModule.__testOnlyCurrentWorktreeTreeAttempt as PrivateCanaryInternals["currentWorktreeTreeAttempt"],
      currentWorktreeTree:
        testModule.__testOnlyCurrentWorktreeTree as PrivateCanaryInternals["currentWorktreeTree"],
      canaryOperationDeadlineMs: testModule.__testOnlyCanaryOperationDeadlineMs as number,
      mcpRequestTimeoutMs: testModule.__testOnlyMcpRequestTimeoutMs as number,
    };
  })();
  return privateCanaryInternalsPromise;
}

async function loadPrivateAtomicPublisher(): Promise<PrivateAtomicPublisher> {
  return (await loadPrivateCanaryInternals()).publishAtomicDirectorySet;
}

const privateCanaryInternals = await loadPrivateCanaryInternals();

function canonicalizeCanaryReport(
  report: Record<string, any>,
  checkedRelativePath: string,
  rawSha256: string,
): Record<string, any> {
  return privateCanaryInternals.canonicalizeCanaryReport(report, checkedRelativePath, rawSha256);
}

function passingReport() {
  const status = { sha256: "c".repeat(64), bytes: 0, dirty: false };
  const cache = { total_bytes: 6, files: [{ file: "index.sqlite", bytes: 6 }] };
  const queue = {
    state: "idle",
    admission: "open",
    queue_capacity: 1,
    active_operations: 0,
    queued_operations: 0,
    rejected_operations: 1,
    cancelled_operations: 2,
    queue_timeout_operations: 0,
    deadline_exceeded_operations: 0,
    last_outcome: "cancelled",
    max_queue_wait_ms: 1,
    max_execution_ms: 1,
  };
  const counters = {
    policy: "canary",
    policy_reason: "default",
    backend: "sqlite",
    state: "ready",
    operation: "hit",
    last_operation: "hit",
    loaded_entries: 2,
    accepted_entries: 2,
    rejected_entries: 0,
    cache_hits: 1,
    cache_misses: 1,
    rebuilt_files: 2,
    reused_files: 2,
    removed_files: 0,
    fallback_count: 1,
    migration_count: 0,
    corruption_count: 1,
    write_failure_count: 0,
    last_error: null,
  };
  const cleanCounters = { ...counters, fallback_count: 0, corruption_count: 0 };
  const writeFailureCounters = {
    ...cleanCounters,
    backend: "sqlite",
    state: "ready",
    operation: "rebuild",
    last_operation: "rebuild",
    fallback_count: 1,
    write_failure_count: 1,
    last_error: "[observed]",
  };
  const fullCallIds = ["list", "search-exact", "search-broad", "explore", "impact"];
  const run = (iteration: number, callIds = fullCallIds) => ({
    iteration,
    total_duration_ms: 1,
    calls: callIds.map((id) => ({ id, duration_ms: 1, result_sha256: "9".repeat(64) })),
  });
  const runWithRss = (iteration: number, callIds = fullCallIds) => ({
    ...run(iteration, callIds),
    peak_rss_bytes: 1024,
    sample_count: 1,
  });
  const persistenceGates = {
    initial_canary_ready: true,
    changed_only_rebuild: true,
    config_invalidation: true,
    corruption_fallback_counted: true,
    corruption_recovered_in_session: true,
    corruption_compiler_result: true,
    corruption_recovered: true,
    write_failure_fallback_counted: true,
    write_failure_compiler_result: true,
    write_failure_recovered: true,
    disabled_rollback: true,
  };
  const mutationGates = {
    rollback_original_bytes: true,
    applied: true,
    replay: true,
    exact_postimage: true,
    no_cache_side_effect: true,
  };
  const runtimeGates = {
    queue_saturation: true,
    queued_cancellation: true,
    active_cancellation: true,
    public_cancellation: true,
    session_capacity: true,
    queue_drained: true,
    disabled_no_cache: true,
  };
  const resourceGates = {
    exact_warmup_count: true,
    exact_measured_count: true,
    exact_manual_gc_count: true,
    rss_growth_bounded: true,
    cache_growth_bounded: true,
    cache_manifest_stable: true,
    final_restart_ready: true,
  };
  const gates = {
    git_authority: true,
    runtime_identity: true,
    package_tree_identity: true,
    repository_immutable: true,
    package_repository_immutable: true,
    disabled_default: true,
    explicit_canary: true,
    semantic_parity: true,
    restart_count: true,
    restart_reuse: true,
    policy_rollback_memory_only: true,
    ...Object.fromEntries(
      Object.keys(persistenceGates).map((name) => [`persistence_${name}`, true]),
    ),
    ...Object.fromEntries(Object.keys(mutationGates).map((name) => [`mutation_${name}`, true])),
    ...Object.fromEntries(Object.keys(runtimeGates).map((name) => [`runtime_${name}`, true])),
    ...Object.fromEntries(Object.keys(resourceGates).map((name) => [`resources_${name}`, true])),
  };
  const fixtureGates = {
    ...Object.fromEntries(
      Object.keys(persistenceGates).map((name) => [`persistence_${name}`, true]),
    ),
    ...Object.fromEntries(Object.keys(mutationGates).map((name) => [`mutation_${name}`, true])),
    ...Object.fromEntries(Object.keys(runtimeGates).map((name) => [`runtime_${name}`, true])),
    ...Object.fromEntries(Object.keys(resourceGates).map((name) => [`resources_${name}`, true])),
  };
  const exactArgv = [
    "benchmark:production-readiness",
    "--node-bin",
    "/tmp/node24",
    "--expected-node",
    "24",
    "--project",
    "/tmp/ast-mcp-server",
    "--workload",
    "/tmp/ast-mcp-server.json",
    "--iterations",
    "20",
    "--restarts",
    "3",
    "--output",
    "/tmp/ast-mcp-server-node24.raw.json",
  ];
  return {
    schema_version: 1,
    generated_at: "2026-08-08T00:00:00.000Z",
    status: "pass",
    command: {
      argv: [
        "benchmark:production-readiness",
        "--node-bin",
        "[node-bin]",
        "--expected-node",
        "24",
        "--project",
        "[project]",
        "--workload",
        "[workload]",
        "--iterations",
        "20",
        "--restarts",
        "3",
        "--output",
        "[output]",
      ],
      exact_argv: exactArgv,
    },
    identity: {
      git: {
        binary: "[trusted-git]",
        realpath: "[trusted-git]",
        version: "git version 2.53.0",
        sha256: "1".repeat(64),
        environment_keys: Object.keys(createGitEnvironment({ workTree: repositoryRoot })).sort(),
      },
      package: {
        name: packageMetadata.name,
        version: packageMetadata.version,
        commit: "a".repeat(40),
        head_tree: "b".repeat(40),
        tree: "b".repeat(40),
        status,
      },
      runtime: { expected: "24", observed: "v24.16.0", binary_sha256: "d".repeat(64) },
      os: { platform: "linux", release: "test", arch: "x64" },
      project: {
        alias: "[ast-mcp-server]",
        commit: "e".repeat(40),
        head_tree: "f".repeat(40),
        tree: "f".repeat(40),
        status,
      },
      workload: {
        schema_version: 1,
        sha256: "2".repeat(64),
        source_file_count: 42,
        call_count: 5,
        call_ids: fullCallIds,
        measurement_call_id: "search-exact",
      },
      harness: { sha256: "3".repeat(64) },
    },
    parameters: {
      iterations: 20,
      restarts: 3,
      node_options: [],
      real_repository_measurements_are_observational: true,
    },
    real_repository: {
      source_file_count: 42,
      disabled: {
        run: run(0),
        peak_rss_bytes: 1024,
        sample_count: 1,
        policy_variable: "absent",
        cache_created: false,
        index_observability: {
          ...cleanCounters,
          policy: "disabled",
          policy_reason: "default",
          backend: "memory",
          state: "disabled",
          operation: "disabled",
          last_operation: "disabled",
          loaded_entries: 0,
          accepted_entries: 0,
          reused_files: 0,
        },
        operation_queue: queue,
      },
      canary: {
        cold: runWithRss(0),
        warm: Array.from({ length: 20 }, (_, iteration) => run(iteration + 1, ["search-exact"])),
        restarts: Array.from({ length: 3 }, (_, restart) => ({
          restart: restart + 1,
          ...runWithRss(restart + 1),
          index_observability: cleanCounters,
        })),
        first_complete_cache: cache,
        final_cache: cache,
        initial_index_observability: cleanCounters,
        final_index_observability: cleanCounters,
        operation_queue: queue,
      },
      rollback: {
        run: run(0),
        peak_rss_bytes: 1024,
        sample_count: 1,
        cache_unchanged: true,
        index_observability: {
          ...cleanCounters,
          policy: "disabled",
          policy_reason: "default",
          backend: "memory",
          state: "disabled",
          operation: "disabled",
          last_operation: "disabled",
          loaded_entries: 0,
          accepted_entries: 0,
          reused_files: 0,
        },
      },
      semantic_mismatches: [],
    },
    deterministic_fixture: {
      gates: fixtureGates,
      persistence: {
        gates: persistenceGates,
        initial: cleanCounters,
        changed_file: cleanCounters,
        config_invalidation: cleanCounters,
        corruption_fallback: counters,
        corruption_recovery: cleanCounters,
        corruption_compiler_baseline_sha256: "7".repeat(64),
        corruption_result_sha256: "7".repeat(64),
        write_failure_fallback: writeFailureCounters,
        write_failure_recovery: cleanCounters,
        write_failure_compiler_baseline_sha256: "8".repeat(64),
        write_failure_result_sha256: "8".repeat(64),
        rollback: {
          ...cleanCounters,
          policy: "disabled",
          policy_reason: "default",
          backend: "memory",
          state: "disabled",
          operation: "disabled",
          last_operation: "disabled",
        },
        cache,
      },
      mutation: {
        gates: mutationGates,
        failure_outcome: "INTERNAL_ERROR",
        originals_restored: true,
      },
      runtime: {
        cache_created: false,
        gates: runtimeGates,
        outcomes: {
          overflow: "PROJECT_QUEUE_FULL",
          queued_cancellation: "protocol_cancelled",
          active_cancellation: "protocol_cancelled",
          public_cancellation: "REQUEST_CANCELLED",
          session_capacity: "PROJECT_CAPACITY_EXCEEDED",
        },
        operation_queue: queue,
      },
      resources: {
        gates: resourceGates,
        warmup_count: 10,
        measured_count: 50,
        manual_gc_count: 50,
        latency_samples_ms: Array.from({ length: 50 }, () => 1),
        rss_samples_bytes: Array.from({ length: 50 }, () => 1024),
        rss_first_five_median_bytes: 1024,
        rss_final_five_median_bytes: 1024,
        rss_allowed_growth_bytes: 32 * 1024 * 1024,
        cache_allowed_growth_bytes: 1024 * 1024,
        restarts: Array.from({ length: 3 }, (_, restart) => ({
          restart: restart + 1,
          duration_ms: 1,
          peak_rss_bytes: 1024,
          sample_count: 1,
          index_observability: cleanCounters,
        })),
        first_complete_cache: cache,
        final_restart_cache: cache,
        initial_index_observability: cleanCounters,
        final_index_observability: cleanCounters,
      },
    },
    gates,
    overall_pass: true,
  };
}

type ReportSetMember = {
  readonly inputKey: keyof typeof reportSetInputs;
  readonly option: string;
  readonly fileName: string;
  readonly relativePath: string;
  readonly alias: string;
  readonly runtime: "22.5.0" | "24";
};

type PreparedReport = {
  member: ReportSetMember;
  canonical: Record<string, any>;
  output: string;
  verification: { report: Record<string, any> };
};

function passingReportForMember(member: (typeof reportSetMembers)[number]) {
  const report = passingReport();
  report.identity.project.alias = member.alias;
  report.identity.runtime.expected = member.runtime;
  report.identity.runtime.observed = member.runtime === "24" ? "v24.16.0" : "v22.5.0";
  const expectedNodeIndex = report.command.argv.indexOf("--expected-node");
  report.command.argv[expectedNodeIndex + 1] = member.runtime;
  report.command.exact_argv[expectedNodeIndex + 1] = member.runtime;
  const outputIndex = report.command.exact_argv.indexOf("--output");
  report.command.exact_argv[outputIndex + 1] = reportSetInputs[member.inputKey];
  return report;
}

function preparedReportSet(): PreparedReport[] {
  return reportSetMembers.map((member, index) => {
    const report = passingReportForMember(member);
    const canonical = canonicalizeCanaryReport(
      report,
      member.relativePath,
      String(index + 1).repeat(64),
    );
    return { member, canonical, output: canonicalText(canonical), verification: { report } };
  });
}

function refreshPreparedOutput(prepared: PreparedReport): void {
  prepared.output = canonicalText(prepared.canonical);
}

async function publishTemporaryPreparedSet(
  prepared: PreparedReport[],
  resultsDirectory: string,
  beforeVisibility?: (context: {
    stageDirectory: string;
    fileNames: readonly string[];
  }) => Promise<void>,
): Promise<void> {
  const publishAtomicDirectorySet = await loadPrivateAtomicPublisher();
  return publishAtomicDirectorySet({
    anchorRoot: resultsDirectory,
    resultsDirectory,
    finalDirectoryName: "production-readiness",
    files: prepared.map(({ member, output }) => ({ name: member.fileName, bytes: output })),
    beforeVisibility,
  });
}

afterEach(async () => {
  await Promise.all([
    ...temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
    ...temporaryFiles.splice(0).map((filePath) => rm(filePath, { force: true })),
  ]);
});

describe("production-readiness canary contract", () => {
  it("requires the exact production argument contract and aliases path-bearing command values", () => {
    const root = path.join(os.tmpdir(), "ast-canary-contract");
    const validArguments = [
      "run",
      "--node-bin",
      path.join(root, "node"),
      "--expected-node",
      "22.5.0",
      "--node-option=--experimental-sqlite",
      "--project",
      path.join(root, "project"),
      "--workload",
      path.join(root, "workload.json"),
      "--iterations",
      "20",
      "--restarts",
      "3",
      "--output",
      "/tmp/ast-canary.raw.json",
    ];
    const parsed = parseCanaryArguments(validArguments);

    expect(parsed.mode).toBe("run");
    if (parsed.mode !== "run") throw new Error("Expected parsed run arguments.");
    expect(parsed).toMatchObject({
      mode: "run",
      expectedNode: "22.5.0",
      iterations: 20,
      restarts: 3,
      nodeOptions: ["--experimental-sqlite"],
    });
    expect(parsed.reportArgv).toContain("[node-bin]");
    expect(parsed.reportArgv).toContain("[project]");
    expect(parsed.reportArgv).toContain("[workload]");
    expect(parsed.reportArgv).toContain("[output]");
    expect(parsed.reportArgv.join(" ")).not.toContain(root);

    expect(() =>
      parseCanaryArguments([
        "run",
        "--node-bin",
        "node",
        "--expected-node",
        "24",
        "--project",
        path.join(root, "project"),
        "--workload",
        path.join(root, "workload.json"),
        "--iterations",
        "19",
        "--restarts",
        "3",
        "--output",
        "/tmp/invalid.raw.json",
      ]),
    ).toThrow(/node.*absolute|iterations.*20/i);
    const invalidExpectedNode = [...validArguments];
    invalidExpectedNode[invalidExpectedNode.indexOf("--expected-node") + 1] = "23";
    expect(() => parseCanaryArguments(invalidExpectedNode)).toThrow(/22\.5\.0.*24/);
    expect(() =>
      parseCanaryArguments([...validArguments, "--output", "/tmp/duplicate.raw.json"]),
    ).toThrow(/duplicate.*--output/i);
  });

  it("requires one closed four-report freeze-set command", () => {
    const validArguments = [
      "freeze-report-set",
      "--x-scraper-root",
      xScraperAuthorityRoot,
      "--ast-node24",
      reportSetInputs.astNode24,
      "--ast-node22.5",
      reportSetInputs.astNode22_5,
      "--x-scraper-node24",
      reportSetInputs.xScraperNode24,
      "--x-scraper-node22.5",
      reportSetInputs.xScraperNode22_5,
    ];
    const parsed = parseCanaryArguments(validArguments);

    expect(parsed).toEqual({
      mode: "freeze-report-set",
      xScraperRoot: xScraperAuthorityRoot,
      inputs: reportSetInputs,
    });
    expect(() => parseCanaryArguments(validArguments.slice(0, -2))).toThrow(
      /requires exactly one/i,
    );
    expect(() =>
      parseCanaryArguments(
        validArguments.filter(
          (argument, index) =>
            argument !== "--x-scraper-root" && validArguments[index - 1] !== "--x-scraper-root",
        ),
      ),
    ).toThrow(/x-scraper-root.*required/i);
    const nonCanonicalRoot = [...validArguments];
    nonCanonicalRoot[nonCanonicalRoot.indexOf("--x-scraper-root") + 1] =
      `${xScraperAuthorityRoot}/../root`;
    expect(() => parseCanaryArguments(nonCanonicalRoot)).toThrow(/x-scraper-root.*canonical/i);
    expect(() =>
      parseCanaryArguments([...validArguments, "--ast-node24", "/tmp/duplicate-option.raw.json"]),
    ).toThrow(/duplicate.*--ast-node24/i);
    expect(() =>
      parseCanaryArguments(["freeze-report-set", "--unknown", "/tmp/unknown.raw.json"]),
    ).toThrow(/unknown freeze-report-set argument/i);
    const nestedInput = [...validArguments];
    nestedInput[nestedInput.indexOf("--ast-node24") + 1] =
      "/tmp/nested/not-a-direct-child.raw.json";
    expect(() => parseCanaryArguments(nestedInput)).toThrow(/direct child.*\/tmp/i);
    expect(() =>
      parseCanaryArguments([...validArguments.slice(0, -1), reportSetInputs.astNode24]),
    ).toThrow(/input paths must be unique/i);
    expect(() => parseCanaryArguments(["freeze-report", "--input", "/tmp/raw.json"])).toThrow(
      /expected subcommand/i,
    );
    expect(canaryModule).not.toHaveProperty("freezeCanaryReport");
    expect(canaryModule).not.toHaveProperty("canonicalizeCanaryReport");
    expect(canaryModule).not.toHaveProperty("canaryReportSetTestSeams");
    expect(canaryModule).not.toHaveProperty("canaryReportValidationTestSeams");
    expect(canaryModule).not.toHaveProperty("publishAtomicDirectorySet");
  });

  it("keeps the complete production publication surface closed", async () => {
    const scriptsDirectory = path.join(repositoryRoot, "scripts");
    const publicationFiles = (await readdir(scriptsDirectory))
      .filter((name) =>
        /^(?:canary-local-mcp|git-evidence-authority)(?:\.mjs|\.d\.mts)$/.test(name),
      )
      .sort();
    expect(publicationFiles).toEqual([
      "canary-local-mcp.d.mts",
      "canary-local-mcp.mjs",
      "git-evidence-authority.d.mts",
      "git-evidence-authority.mjs",
    ]);
    expect(Object.keys(canaryModule).sort()).toEqual(
      [
        "assertExpectedNodeVersion",
        "assertRepositoryStatusUnchanged",
        "canonicalizeToolResult",
        "freezeCanaryReportSet",
        "inspectCacheTree",
        "parseCanaryArguments",
        "runCanary",
        "runDeterministicFixture",
        "validateWorkloadManifest",
      ].sort(),
    );
    const [declarationSource, runtimeSource] = await Promise.all(
      publicationFiles.map((name) => readFile(path.join(scriptsDirectory, name), "utf8")),
    );
    expect(runtimeSource).not.toMatch(
      /^export\s+(?:async\s+)?function\s+(?:publishAtomicDirectorySet|orchestrateCanaryReportSet)\b/m,
    );
    expect(declarationSource).not.toMatch(
      /publishAtomicDirectorySet|AtomicDirectoryBeforeVisibilityContext|beforeVisibility|canaryReportValidationTestSeams|PreparedCanaryReport/,
    );
  });

  it("rejects ambient Git controls before a PATH-injected Git binary can execute", async () => {
    const root = await temporaryDirectory("ast-canary-hostile-git-");
    const sentinel = path.join(root, "sentinel");
    const forgedGit = path.join(root, "git");
    await writeFile(
      forgedGit,
      `#!/bin/sh\nprintf executed > ${JSON.stringify(sentinel)}\nexit 0\n`,
      "utf8",
    );
    await chmod(forgedGit, 0o700);

    const result = spawnSync(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "canary-local-mcp.mjs"), "run"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_DIR: "/tmp/forged-git-dir",
          PATH: `${root}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/ambient Git controls.*GIT_DIR/i);
    await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clones a source repository without binding the clone child to its existing worktree", async () => {
    await expect(
      privateCanaryInternals.currentWorktreeTreeAttempt(repositoryRoot),
    ).resolves.toMatch(/^[0-9a-f]{40}$/);
  });

  it.each([
    ["snapshot", new Error("snapshot failed")],
    ["cleanup", new Error("cleanup failed")],
  ])("does not retry after a failed first Git %s attempt", async (_phase, firstError) => {
    const attempt = vi
      .fn<(root: string) => Promise<string>>()
      .mockRejectedValueOnce(firstError)
      .mockResolvedValue("a".repeat(40));

    await expect(privateCanaryInternals.currentWorktreeTree(repositoryRoot, attempt)).rejects.toBe(
      firstError,
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("validates runtime identity instead of trusting a label or filename", () => {
    expect(() => assertExpectedNodeVersion("22.5.0", "v22.5.0")).not.toThrow();
    expect(() => assertExpectedNodeVersion("24", "v24.16.0")).not.toThrow();
    expect(() => assertExpectedNodeVersion("22.5.0", "v22.5.1")).toThrow(/v22\.5\.0/);
    expect(() => assertExpectedNodeVersion("24", "v23.11.0")).toThrow(/v24/);
  });

  it("accepts only bounded read-only workload manifests without embedded roots", () => {
    const workload = validateWorkloadManifest({
      schema_version: 1,
      project_alias: "[ast-mcp-server]",
      measurement_call_id: "search-exact",
      calls: [
        {
          id: "list-src",
          tool: "ast_list_files",
          arguments: { glob_filter: "src", offset: 0, limit: 50 },
        },
        {
          id: "search-exact",
          tool: "ast_search_symbols",
          arguments: { query: "createServer", detail: "summary", offset: 0, limit: 20 },
        },
        {
          id: "search-broad",
          tool: "ast_search_symbols",
          arguments: { query: "project", detail: "summary", offset: 0, limit: 20 },
        },
        {
          id: "explore-exact",
          tool: "ast_explore",
          arguments: { query: "createServer", detail: "summary", offset: 0, limit: 10 },
        },
        {
          id: "impact-exact",
          tool: "ast_get_impact",
          arguments: {
            file_path: "src/server.ts",
            symbol_path: "createServer",
            direction: "both",
            max_depth: 1,
            max_nodes: 20,
            max_edges: 40,
          },
        },
      ],
    });

    expect(workload.calls).toHaveLength(5);
    expect(Object.isFrozen(workload)).toBe(true);
    expect(() =>
      validateWorkloadManifest({
        ...workload,
        calls: [
          {
            ...workload.calls[0],
            id: "unsafe",
            arguments: { project_root: "/private/project", limit: 10 },
          },
          ...workload.calls.slice(1),
        ],
      }),
    ).toThrow(/project_root/);
    expect(() =>
      validateWorkloadManifest({
        ...workload,
        calls: [
          {
            ...workload.calls[0],
            id: "mutation",
            tool: "ast_rename_symbol",
            arguments: { file_path: "src/server.ts" },
          },
          ...workload.calls.slice(1),
        ],
      }),
    ).toThrow(/read-only/);
    expect(() =>
      validateWorkloadManifest({
        ...workload,
        calls: [
          ...workload.calls,
          { ...workload.calls[0], arguments: { glob_filter: "test", limit: 10 } },
        ],
      }),
    ).toThrow(/duplicate/i);
    expect(() =>
      validateWorkloadManifest({
        ...workload,
        calls: [
          ...workload.calls.slice(0, -1),
          {
            id: "traversal",
            tool: "ast_get_impact",
            arguments: { file_path: "../outside.ts", symbol_path: "outside" },
          },
        ],
      }),
    ).toThrow(/project-relative/i);
  });

  it("canonicalizes only volatile transport evidence before compiler parity comparison", () => {
    const canonical = canonicalizeToolResult({
      duration_ms: 12.5,
      symbols: [{ file: "src/server.ts", selector: "createServer@70" }],
      freshness: { state: "fresh", causes: [], checked_at: "2026-08-08T00:00:00.000Z" },
      evidence: [{ duration_ms: 1, checked_at: "volatile", selector: "createServer@70" }],
    });

    expect(canonical).toEqual({
      symbols: [{ file: "src/server.ts", selector: "createServer@70" }],
      freshness: { state: "fresh", causes: [] },
      evidence: [{ selector: "createServer@70" }],
    });
  });

  it("compares repository status byte-for-byte rather than assuming a clean checkout", () => {
    const dirty = Buffer.from(" M src/value.ts\0?? src/new.ts\0", "utf8");
    expect(() => assertRepositoryStatusUnchanged(dirty, Buffer.from(dirty))).not.toThrow();
    expect(() =>
      assertRepositoryStatusUnchanged(dirty, Buffer.from(" M src/value.ts\0", "utf8")),
    ).toThrow(/changed during canary/i);
  });

  it("accounts cache bytes recursively with lstat and rejects symbolic entries", async () => {
    const root = await temporaryDirectory("ast-canary-cache-");
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "index.sqlite"), "sqlite", "utf8");
    await writeFile(path.join(root, "nested", "index.sqlite-wal"), "wal", "utf8");

    await expect(inspectCacheTree(root)).resolves.toEqual({
      total_bytes: 9,
      files: [
        { file: "index.sqlite", bytes: 6 },
        { file: "nested/index.sqlite-wal", bytes: 3 },
      ],
    });

    await symlink(path.join(root, "index.sqlite"), path.join(root, "linked.sqlite"));
    await expect(inspectCacheTree(root)).rejects.toThrow(/symbolic link/i);
  });

  it("compares canonicalized identity objects independently of key insertion order", () => {
    expect(
      privateCanaryInternals.jsonValuesEqual(
        { arch: "x64", platform: "linux", release: "test" },
        { platform: "linux", release: "test", arch: "x64" },
      ),
    ).toBe(true);
  });

  it("canonicalizes only closed, bounded, identity-bound passing reports", () => {
    const rawHash = "8".repeat(64);
    const frozen = canonicalizeCanaryReport(
      passingReport(),
      "benchmark/results/production-readiness/ast-mcp-server-node24.json",
      rawHash,
    );
    expect(frozen).toMatchObject({
      schema_version: 1,
      status: "pass",
      overall_pass: true,
      command: { raw_report_sha256: rawHash },
    });
    expect((frozen.command as Record<string, unknown>).exact_argv).toBeUndefined();

    const forgedGit = passingReport();
    forgedGit.identity.git.binary = "/tmp/git";
    expect(() =>
      canonicalizeCanaryReport(
        forgedGit,
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        rawHash,
      ),
    ).toThrow(/Git authority/i);

    const failed = { ...passingReport(), overall_pass: false, status: "fail" };
    expect(() =>
      canonicalizeCanaryReport(
        failed,
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        rawHash,
      ),
    ).toThrow(/overall PASS/i);

    const unknown = { ...passingReport(), forged: true };
    expect(() =>
      canonicalizeCanaryReport(
        unknown,
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        rawHash,
      ),
    ).toThrow(/must contain exactly/i);

    expect(() =>
      canonicalizeCanaryReport(
        passingReport(),
        "benchmark/results/production-readiness/x-scraper-node24.json",
        rawHash,
      ),
    ).toThrow(/does not match.*destination/i);

    const leaking = passingReport();
    leaking.command.argv.push("/home/operator/private-project");
    leaking.command.exact_argv.push("/home/operator/private-project");
    expect(() =>
      canonicalizeCanaryReport(
        leaking,
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        rawHash,
      ),
    ).toThrow(/sensitive|absolute/i);

    const credential = passingReport();
    credential.command.argv.push("Authorization: Bearer ***");
    credential.command.exact_argv.push("Authorization: Bearer ***");
    expect(() =>
      canonicalizeCanaryReport(
        credential,
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        rawHash,
      ),
    ).toThrow(/sensitive|credential/i);

    for (const probe of [
      "/mnt/private/repo",
      '{"token":"DUMMY-CANARY-SECRET"}',
      "postgresql://dummy:***@localhost/db",
      "https://dummy:***@example.test/private",
    ]) {
      const hostile = passingReport();
      hostile.identity.os.release = probe;
      expect(() =>
        canonicalizeCanaryReport(
          hostile,
          "benchmark/results/production-readiness/ast-mcp-server-node24.json",
          rawHash,
        ),
      ).toThrow(/sensitive|credential|absolute/i);
    }

    const parityMismatch = passingReport();
    parityMismatch.real_repository.canary.cold.calls[0].result_sha256 = "6".repeat(64);
    expect(() =>
      canonicalizeCanaryReport(
        parityMismatch,
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        rawHash,
      ),
    ).toThrow(/compiler-authoritative parity/i);

    const fallbackMismatch = passingReport();
    fallbackMismatch.deterministic_fixture.persistence.corruption_result_sha256 = "6".repeat(64);
    expect(() =>
      canonicalizeCanaryReport(
        fallbackMismatch,
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        rawHash,
      ),
    ).toThrow(/persistence fallback\/recovery counters are incomplete/i);

    const mismatchedSourceCount = passingReport();
    mismatchedSourceCount.identity.workload.source_file_count += 1;
    expect(() =>
      canonicalizeCanaryReport(
        mismatchedSourceCount,
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        rawHash,
      ),
    ).toThrow(/source-file count/i);
  });

  it("recomputes runtime gates from closed queue and outcome evidence", () => {
    const corruptions: Array<(report: ReturnType<typeof passingReport>) => void> = [
      (report) => {
        report.deterministic_fixture.runtime.operation_queue.state = "unknown";
      },
      (report) => {
        report.deterministic_fixture.runtime.operation_queue.admission = "unknown";
      },
      (report) => {
        report.deterministic_fixture.runtime.operation_queue.queue_capacity = 0;
      },
      (report) => {
        report.deterministic_fixture.runtime.operation_queue.active_operations = 2;
      },
      (report) => {
        report.deterministic_fixture.runtime.operation_queue.queued_operations = 2;
      },
      (report) => {
        report.deterministic_fixture.runtime.operation_queue.last_outcome = "unknown";
      },
      (report) => {
        report.deterministic_fixture.runtime.operation_queue.max_execution_ms = 86_400_001;
      },
      (report) => {
        report.deterministic_fixture.runtime.outcomes.overflow = "arbitrary";
      },
      (report) => {
        report.deterministic_fixture.runtime.cache_created = true;
      },
      (report) => {
        report.deterministic_fixture.runtime.operation_queue.state = "running";
      },
    ];

    for (const corrupt of corruptions) {
      const report = passingReport();
      corrupt(report);
      expect(() =>
        canonicalizeCanaryReport(
          report,
          "benchmark/results/production-readiness/ast-mcp-server-node24.json",
          "8".repeat(64),
        ),
      ).toThrow(/queue|runtime|integer|operation count/i);
    }
  });

  it("keeps report validation private to the test-only source projection", () => {
    expect(
      privateCanaryInternals.canonicalizeCanaryReport(
        passingReport(),
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        "8".repeat(64),
      ),
    ).toEqual(
      canonicalizeCanaryReport(
        passingReport(),
        "benchmark/results/production-readiness/ast-mcp-server-node24.json",
        "8".repeat(64),
      ),
    );
    expect(() =>
      privateCanaryInternals.assertPreparedCanaryReportSet(preparedReportSet()),
    ).not.toThrow();
  });

  it("preregisters a bounded canary deadline below the MCP client timeout", () => {
    expect(privateCanaryInternals.canaryOperationDeadlineMs).toBe(300_000);
    expect(privateCanaryInternals.mcpRequestTimeoutMs).toBe(330_000);
    expect(privateCanaryInternals.mcpRequestTimeoutMs).toBeGreaterThan(
      privateCanaryInternals.canaryOperationDeadlineMs,
    );
    expect(
      privateCanaryInternals.projectEnvironment("canary", "/tmp/canary-cache", {
        AST_OPERATION_DEADLINE_MS: "1000",
        AST_MAX_PROJECT_SESSIONS: "1",
      }),
    ).toEqual({
      AST_SYMBOL_INDEX_PERSISTENCE: "canary",
      AST_SYMBOL_INDEX_CACHE_ROOT: "/tmp/canary-cache",
      AST_MAX_PROJECT_SESSIONS: "1",
      AST_OPERATION_DEADLINE_MS: "300000",
    });
  });

  it("requires the complete four-member prepared set", () => {
    expect(() =>
      privateCanaryInternals.assertPreparedCanaryReportSet(preparedReportSet().slice(0, 3)),
    ).toThrow(/exactly four prepared members/i);
  });

  it("rejects shared identity and member binding mismatches in the complete set", () => {
    const corruptions: Array<(prepared: PreparedReport[]) => void> = [
      (prepared) => {
        prepared[3].canonical.identity.package.commit = "f".repeat(40);
        refreshPreparedOutput(prepared[3]);
      },
      (prepared) => {
        prepared[2].canonical.identity.harness.sha256 = "e".repeat(64);
        refreshPreparedOutput(prepared[2]);
      },
      (prepared) => {
        prepared[1].member = {
          ...prepared[1].member,
          relativePath: "benchmark/results/wrong.json",
        };
      },
      (prepared) => {
        prepared[2].canonical.identity.project.alias = "[ast-mcp-server]";
        refreshPreparedOutput(prepared[2]);
      },
      (prepared) => {
        prepared[3].canonical.identity.runtime.expected = "24";
        refreshPreparedOutput(prepared[3]);
      },
      (prepared) => {
        prepared[3].canonical.identity.project.commit = "7".repeat(40);
        refreshPreparedOutput(prepared[3]);
      },
      (prepared) => {
        prepared[1].canonical.identity.workload.sha256 = "8".repeat(64);
        refreshPreparedOutput(prepared[1]);
      },
      (prepared) => {
        prepared[0].verification.report.deterministic_fixture.runtime.outcomes.overflow =
          "arbitrary";
      },
    ];

    for (const corrupt of corruptions) {
      const prepared = preparedReportSet();
      corrupt(prepared);
      expect(() => privateCanaryInternals.assertPreparedCanaryReportSet(prepared)).toThrow(
        /canonical|identity|destination|package|harness|preregistered|cohort|runtime/i,
      );
    }
  });

  it("publishes exactly four fixed canonical files as one final directory", async () => {
    const resultsRoot = await temporaryDirectory("ast-canary-results-");
    const prepared = preparedReportSet();
    let observedBeforeVisibility = false;

    await publishTemporaryPreparedSet(
      prepared,
      resultsRoot,
      async ({ stageDirectory }: { stageDirectory: string }) => {
        observedBeforeVisibility = true;
        expect(await readdir(stageDirectory)).toEqual(
          reportSetMembers.map((member) => member.fileName).sort(),
        );
        expect(await readdir(resultsRoot)).not.toContain("production-readiness");
      },
    );

    expect(observedBeforeVisibility).toBe(true);
    expect(await readdir(resultsRoot)).toEqual(["production-readiness"]);
    const finalDirectory = path.join(resultsRoot, "production-readiness");
    expect((await readdir(finalDirectory)).sort()).toEqual(
      reportSetMembers.map((member) => member.fileName).sort(),
    );
    for (const candidate of prepared) {
      await expect(
        readFile(path.join(finalDirectory, candidate.member.fileName), "utf8"),
      ).resolves.toBe(candidate.output);
    }
  });

  it("never overwrites final evidence and cleans owned staging and lock on failure", async () => {
    const existingRoot = await temporaryDirectory("ast-canary-existing-results-");
    const finalDirectory = path.join(existingRoot, "production-readiness");
    const sentinel = path.join(finalDirectory, "sentinel.txt");
    await mkdir(finalDirectory);
    await writeFile(sentinel, "keep", "utf8");

    await expect(publishTemporaryPreparedSet(preparedReportSet(), existingRoot)).rejects.toThrow(
      /already exists|refusing to overwrite/i,
    );
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep");
    expect(await readdir(existingRoot)).toEqual(["production-readiness"]);

    const racingRoot = await temporaryDirectory("ast-canary-racing-results-");
    const racingFinalDirectory = path.join(racingRoot, "production-readiness");
    await expect(
      publishTemporaryPreparedSet(preparedReportSet(), racingRoot, async () => {
        await mkdir(racingFinalDirectory);
      }),
    ).rejects.toThrow(/atomic no-replace publication failed/i);
    expect(await readdir(racingRoot)).toEqual(["production-readiness"]);
    expect(await readdir(racingFinalDirectory)).toEqual([]);

    const failingRoot = await temporaryDirectory("ast-canary-failing-results-");
    await expect(
      publishTemporaryPreparedSet(preparedReportSet(), failingRoot, async () => {
        throw new Error("injected before visibility");
      }),
    ).rejects.toThrow(/injected before visibility/);
    expect(await readdir(failingRoot)).toEqual([]);
  });

  it("revalidates staged bytes and pinned directory identity after the visibility callback", async () => {
    const mutatedRoot = await temporaryDirectory("ast-canary-mutated-stage-");
    await expect(
      publishTemporaryPreparedSet(
        preparedReportSet(),
        mutatedRoot,
        async ({ stageDirectory, fileNames }) => {
          await writeFile(path.join(stageDirectory, fileNames[0]), "mutated", "utf8");
        },
      ),
    ).rejects.toThrow(/does not match its prepared bytes/i);
    expect(await readdir(mutatedRoot)).toEqual([]);

    const replacedRoot = await temporaryDirectory("ast-canary-replaced-stage-");
    let replacementStageDirectory = "";
    await expect(
      publishTemporaryPreparedSet(preparedReportSet(), replacedRoot, async ({ stageDirectory }) => {
        await rename(stageDirectory, `${stageDirectory}.displaced`);
        await mkdir(stageDirectory);
        await writeFile(path.join(stageDirectory, "replacement-sentinel.txt"), "keep", "utf8");
        replacementStageDirectory = stageDirectory;
      }),
    ).rejects.toThrow(/staging directory identity changed/i);
    await expect(
      readFile(path.join(replacementStageDirectory, "replacement-sentinel.txt"), "utf8"),
    ).resolves.toBe("keep");
    expect(await readdir(replacedRoot)).toEqual([path.basename(replacementStageDirectory)]);

    const replacedLockRoot = await temporaryDirectory("ast-canary-replaced-lock-");
    const lockDirectory = path.join(replacedLockRoot, ".production-readiness.lock");
    const displacedLockDirectory = `${lockDirectory}.displaced`;
    await expect(
      publishTemporaryPreparedSet(preparedReportSet(), replacedLockRoot, async () => {
        await rename(lockDirectory, displacedLockDirectory);
        await mkdir(lockDirectory);
        await writeFile(path.join(lockDirectory, "replacement-sentinel.txt"), "keep", "utf8");
        throw new Error("injected after lock replacement");
      }),
    ).rejects.toThrow(/injected after lock replacement/i);
    await expect(
      readFile(path.join(lockDirectory, "replacement-sentinel.txt"), "utf8"),
    ).resolves.toBe("keep");
    await expect(readdir(displacedLockDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(replacedLockRoot)).toEqual([".production-readiness.lock"]);
  });

  it("does not reverse committed publication when owned post-commit cleanup fails", async () => {
    const resultsRoot = await temporaryDirectory("ast-canary-committed-results-");
    const lockDirectory = path.join(resultsRoot, ".production-readiness.lock");

    await expect(
      publishTemporaryPreparedSet(preparedReportSet(), resultsRoot, async () => {
        await writeFile(path.join(lockDirectory, "blocked"), "owned", "utf8");
        await chmod(lockDirectory, 0o000);
      }),
    ).resolves.toBeUndefined();
    await expect(readdir(path.join(resultsRoot, "production-readiness"))).resolves.toHaveLength(4);
    expect(await readdir(resultsRoot)).toContain(".production-readiness.lock");

    if ((await readdir(resultsRoot)).includes(".production-readiness.lock")) {
      await chmod(lockDirectory, 0o700);
      await rm(lockDirectory, { recursive: true });
    }
  });

  it("rejects duplicate, symbolic, and hard-linked direct-/tmp raw inputs before publication", async () => {
    const duplicatePath = directTemporaryPath("ast-canary-duplicate");
    await expect(
      freezeCanaryReportSet(
        {
          astNode24: duplicatePath,
          astNode22_5: duplicatePath,
          xScraperNode24: directTemporaryPath("x-canary-node24"),
          xScraperNode22_5: directTemporaryPath("x-canary-node22"),
        },
        xScraperAuthorityRoot,
      ),
    ).rejects.toThrow(/input paths must be unique/i);

    const hardLinkedInputs = {
      astNode24: directTemporaryPath("ast-canary-hardlink-source"),
      astNode22_5: directTemporaryPath("ast-canary-hardlink-alias"),
      xScraperNode24: directTemporaryPath("x-canary-hardlink-node24"),
      xScraperNode22_5: directTemporaryPath("x-canary-hardlink-node22"),
    };
    await writeFile(hardLinkedInputs.astNode24, "{}", "utf8");
    await link(hardLinkedInputs.astNode24, hardLinkedInputs.astNode22_5);
    await writeFile(hardLinkedInputs.xScraperNode24, "{}", "utf8");
    await writeFile(hardLinkedInputs.xScraperNode22_5, "{}", "utf8");
    await expect(freezeCanaryReportSet(hardLinkedInputs, xScraperAuthorityRoot)).rejects.toThrow(
      /hard-linked|aliased/i,
    );

    const hiddenHardLinkInputs = {
      astNode24: directTemporaryPath("ast-canary-hidden-hardlink-source"),
      astNode22_5: directTemporaryPath("ast-canary-hidden-hardlink-node22"),
      xScraperNode24: directTemporaryPath("x-canary-hidden-hardlink-node24"),
      xScraperNode22_5: directTemporaryPath("x-canary-hidden-hardlink-node22"),
    };
    const hiddenAlias = directTemporaryPath("ast-canary-hidden-hardlink-alias");
    await Promise.all(
      Object.values(hiddenHardLinkInputs).map((inputPath) => writeFile(inputPath, "{}", "utf8")),
    );
    await link(hiddenHardLinkInputs.astNode24, hiddenAlias);
    await expect(
      freezeCanaryReportSet(hiddenHardLinkInputs, xScraperAuthorityRoot),
    ).rejects.toThrow(/non-aliased|hard-linked|aliased/i);

    const symbolicInputs = {
      astNode24: directTemporaryPath("ast-canary-symbolic"),
      astNode22_5: directTemporaryPath("ast-canary-symbol-target"),
      xScraperNode24: directTemporaryPath("x-canary-symbol-node24"),
      xScraperNode22_5: directTemporaryPath("x-canary-symbol-node22"),
    };
    await writeFile(symbolicInputs.astNode22_5, "{}", "utf8");
    await symlink(symbolicInputs.astNode22_5, symbolicInputs.astNode24);
    await writeFile(symbolicInputs.xScraperNode24, "{}", "utf8");
    await writeFile(symbolicInputs.xScraperNode22_5, "{}", "utf8");
    await expect(freezeCanaryReportSet(symbolicInputs, xScraperAuthorityRoot)).rejects.toThrow(
      /symbolic|non-regular/i,
    );
  });
});
