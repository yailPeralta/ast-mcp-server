import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertExpectedNodeVersion,
  assertRepositoryStatusUnchanged,
  canonicalizeCanaryReport,
  canonicalizeToolResult,
  freezeCanaryReport,
  inspectCacheTree,
  parseCanaryArguments,
  validateWorkloadManifest,
} from "../scripts/canary-local-mcp.mjs";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
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
      package: {
        name: "ast-mcp-server",
        version: "0.6.0",
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
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
      path.join(os.tmpdir(), "ast-canary.raw.json"),
    ];
    const parsed = parseCanaryArguments(validArguments);

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
        path.join(os.tmpdir(), "invalid.raw.json"),
      ]),
    ).toThrow(/node.*absolute|iterations.*20/i);
    const invalidExpectedNode = [...validArguments];
    invalidExpectedNode[invalidExpectedNode.indexOf("--expected-node") + 1] = "23";
    expect(() => parseCanaryArguments(invalidExpectedNode)).toThrow(/22\.5\.0.*24/);
    expect(() =>
      parseCanaryArguments([...validArguments, "--output", "/tmp/duplicate.raw.json"]),
    ).toThrow(/duplicate.*--output/i);
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

  it("rejects non-allowlisted freeze destinations and symbolic raw inputs", async () => {
    const root = await temporaryDirectory("ast-canary-report-");
    const input = path.join(root, "raw.json");
    const output = path.join(root, "frozen.json");
    await writeFile(input, `${JSON.stringify(passingReport())}\n`, "utf8");
    await expect(freezeCanaryReport(input, output)).rejects.toThrow(/allowlisted/i);

    const linkedInput = path.join(root, "linked.json");
    await symlink(input, linkedInput);
    const allowedOutput = path.resolve(
      "benchmark/results/production-readiness/ast-mcp-server-node24.json",
    );
    await expect(freezeCanaryReport(linkedInput, allowedOutput)).rejects.toThrow(/non-regular/i);
  });
});
