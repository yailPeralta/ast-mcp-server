#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { JSONRPCMessageSchema, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { runSupervisedWorkerEvidence } from "./canary-local-mcp.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const FIXTURE_MODE = "--fixture-server";
const PARENT_MODE = "--supervised-parent-death";
const PROCESS_TIMEOUT_MS = 5_000;

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function emitFixtureEvent(event) {
  process.stderr.write(`${JSON.stringify({ event, version: 1 })}\n`);
}

function parseExpectedProtocolLine(line, hasPendingResponse) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = JSONRPCMessageSchema.safeParse(message);
  if (!parsed.success) return undefined;
  if (!("method" in parsed.data) && !hasPendingResponse(parsed.data.id)) return undefined;
  return parsed.data;
}

function assertProtocolValidator() {
  const noPendingResponses = () => false;
  assert.equal(parseExpectedProtocolLine('{"event":"debug"}', noPendingResponses), undefined);
  assert.equal(
    parseExpectedProtocolLine('{"jsonrpc":"2.0","id":999,"result":{}}', noPendingResponses),
    undefined,
  );
  assert.equal(
    parseExpectedProtocolLine(
      '{"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
      noPendingResponses,
    )?.method,
    "notifications/progress",
  );
}

function waitForFixtureControl(type) {
  return new Promise((resolve) => {
    const onMessage = (message) => {
      if (message?.type !== type) return;
      process.off("message", onMessage);
      resolve();
    };
    process.on("message", onMessage);
  });
}

async function runFixtureServer() {
  const supervisedChild = Boolean(process.send && process.argv[2] !== FIXTURE_MODE);
  const [
    { z },
    { createServer },
    { runStdioServer },
    { RuntimeActivityTracker },
    projectModule,
    operationsModule,
    resultModule,
    { installPrivateControl },
  ] = await Promise.all([
    import("zod"),
    import("../dist/server.js"),
    import("../dist/index.js"),
    import("../dist/services/runtime-activity.js"),
    import("../dist/services/project.js"),
    import("../dist/services/operations.js"),
    import("../dist/tools/result.js"),
    import("../dist/compiler-worker-entry.js"),
  ]);
  const { withProject } = projectModule;
  const { setOperationTestHooksForTests } = operationsModule;
  const { createToolErrorContext, errorResult, structuredResult } = resultModule;
  // prettier-ignore
  const scenario = supervisedChild ? "completion_critical_apply" : process.env.AST_LIFECYCLE_SCENARIO ?? "clean";

  if (
    scenario === "completion_critical_apply" ||
    scenario === "completion_critical_with_noncritical"
  ) {
    setOperationTestHooksForTests({
      afterReplace: async (_file, index) => {
        if (index !== 0) return;
        emitFixtureEvent("lifecycle_critical_apply_entered");
        // prettier-ignore
        await (supervisedChild ? new Promise((resolve) => { const keepAlive = setInterval(() => undefined, 1_000); process.once("SIGUSR1", () => { clearInterval(keepAlive); resolve(); }); }) : waitForFixtureControl("release_critical_apply"));
        emitFixtureEvent("lifecycle_critical_apply_released");
      },
    });
  }

  const runtimeActivity = new RuntimeActivityTracker();
  const server = createServer({ runtimeActivity });
  server.registerTool(
    "ast_lifecycle_hold_read",
    {
      inputSchema: z.object({
        project_root: z.string(),
        mode: z.enum(["cancellable", "ignore_cancellation"]),
      }),
    },
    async ({ project_root, mode }, extra) => {
      if (mode === "ignore_cancellation") {
        emitFixtureEvent("lifecycle_read_active");
        await new Promise(() => undefined);
      }
      try {
        const fileCount = await withProject(
          project_root,
          async ({ project }, operationContext) => {
            emitFixtureEvent("lifecycle_read_active");
            if (!operationContext.signal.aborted) {
              await new Promise((resolve) => {
                operationContext.signal.addEventListener("abort", resolve, { once: true });
              });
            }
            operationContext.checkpoint();
            return project.getSourceFiles().length;
          },
          {
            signal: extra.signal,
            checkpoint() {
              if (extra.signal.aborted) throw new Error("Request cancelled before admission.");
            },
          },
        );
        return structuredResult({ file_count: fileCount });
      } catch (error) {
        return errorResult(error, createToolErrorContext("ast_lifecycle_hold_read", project_root));
      }
    },
  );
  server.registerTool(
    "ast_lifecycle_queue_probe",
    { inputSchema: z.object({ project_root: z.string() }) },
    async ({ project_root }, extra) => {
      emitFixtureEvent("lifecycle_queue_request_received");
      try {
        const fileCount = await withProject(
          project_root,
          ({ project }) => project.getSourceFiles().length,
          {
            signal: extra.signal,
            checkpoint() {
              if (extra.signal.aborted) throw new Error("Request cancelled before admission.");
            },
          },
        );
        return structuredResult({ file_count: fileCount });
      } catch (error) {
        return errorResult(
          error,
          createToolErrorContext("ast_lifecycle_queue_probe", project_root),
        );
      }
    },
  );

  const originalClose = server.close.bind(server);
  let closeCount = 0;
  server.close = async () => {
    closeCount += 1;
    process.stderr.write(
      `${JSON.stringify({ event: "lifecycle_resource_close", version: 1, count: closeCount })}\n`,
    );
    if (scenario === "completion_critical_apply" && !supervisedChild) {
      await waitForFixtureControl("release_mcp_close");
    }
    await originalClose();
    emitFixtureEvent("lifecycle_resource_closed");
  };

  let handledSignalCount = 0;
  const runtime = runStdioServer({
    server,
    runtimeActivity,
    onRuntimeTrigger: (trigger) => {
      if (trigger !== "sigint" && trigger !== "sigterm") return;
      handledSignalCount += 1;
      emitFixtureEvent(`lifecycle_signal_handled_${handledSignalCount}`);
    },
    onCompletionCriticalWait: () => {
      emitFixtureEvent("lifecycle_completion_critical_wait");
    },
  });
  if (supervisedChild) installPrivateControl(runtime);
  await runtime;
  emitFixtureEvent("lifecycle_fixture_ready");
}

// prettier-ignore
async function processChildren(parentPid) { const ids = await readdir("/proc"); const children = []; for (const id of ids) { if (!/^\d+$/.test(id)) continue; try { const stat = await readFile(`/proc/${id}/stat`, "utf8"), match = stat.match(/^\d+ \(.*\) . (\d+)/); if (Number(match?.[1]) === parentPid) children.push(Number(id)); } catch { continue; } } return children; }
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
// prettier-ignore
async function waitFor(check, message, timeout = PROCESS_TIMEOUT_MS) { const started = Date.now(); while (Date.now() - started < timeout) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 25)); } throw new Error(message); }
// prettier-ignore
async function runSupervisedParent(projectRoot) { const [{ CompilerWorkerHost, spawnCompilerWorkerProcess }] = await Promise.all([import("../dist/services/compiler-worker-host.js")]); const host = new CompilerWorkerHost((generation) => spawnCompilerWorkerProcess({ generation, workerEntryPath: scriptPath, environment: { AST_SHUTDOWN_DRAIN_TIMEOUT_MS: "100" } }), 1_000); await host.start([{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "parent-death", version: "1" } } }, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }]); const prepared = await host.forward({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ast_rename_symbol", arguments: { project_root: projectRoot, file_path: "src/value.ts", symbol_path: "renamedValue", new_name: "parentDeathValue", dry_run: true, allow_new_errors: false } } }); const plan = prepared.result.structuredContent; await host.forward({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ast_apply_operation", arguments: { operation_id: plan.operation_id, plan_hash: plan.plan_hash } } }); }

class LifecycleProcess {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.stderrEvents = [];
    this.stderrWaiters = [];
    this.stdoutCorruption = [];
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.closed = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk) => this.consumeStderr(chunk));
    this.exit = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        this.closed = true;
        const error = new Error(`Lifecycle fixture closed with code ${code}, signal ${signal}.`);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        resolve({ code, signal });
      });
    });
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length > 0) this.handleProtocolLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  handleProtocolLine(line) {
    const message = parseExpectedProtocolLine(line, (id) => this.pending.has(id));
    if (!message) {
      this.stdoutCorruption.push(line);
      return;
    }
    if ("method" in message) return;
    const pending = this.pending.get(message.id);
    assert.notEqual(pending, undefined);
    this.pending.delete(message.id);
    if ("error" in message) {
      pending.reject(new Error(`JSON-RPC ${message.error.code}: ${message.error.message}`));
    } else {
      pending.resolve(message.result);
    }
  }

  consumeStderr(chunk) {
    this.stderrBuffer += chunk;
    let newline = this.stderrBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stderrBuffer.slice(0, newline);
      this.stderrBuffer = this.stderrBuffer.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        if (typeof event?.event === "string") {
          this.stderrEvents.push(event);
          const waiters = this.stderrWaiters;
          this.stderrWaiters = [];
          for (const waiter of waiters) waiter();
        }
      } catch {
        // Startup diagnostics are allowed on stderr; protocol stdout remains strict JSONL.
      }
      newline = this.stderrBuffer.indexOf("\n");
    }
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error("Lifecycle fixture is already closed."));
    const id = this.nextId;
    this.nextId += 1;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return withTimeout(response, PROCESS_TIMEOUT_MS, `Timed out waiting for ${method}.`);
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "ast-lifecycle-smoke", version: "1.0.0" },
    });
    this.notify("notifications/initialized", {});
  }

  callTool(name, args) {
    return this.request("tools/call", { name, arguments: args });
  }

  async waitForEvent(eventName) {
    const existing = this.stderrEvents.find((event) => event.event === eventName);
    if (existing) return existing;
    return withTimeout(
      new Promise((resolve) => {
        const inspect = () => {
          const event = this.stderrEvents.find((candidate) => candidate.event === eventName);
          if (event) resolve(event);
          else this.stderrWaiters.push(inspect);
        };
        this.stderrWaiters.push(inspect);
      }),
      PROCESS_TIMEOUT_MS,
      `Timed out waiting for stderr event ${eventName}.`,
    );
  }

  signal(signal) {
    assert.equal(this.child.kill(signal), true, `Failed to deliver ${signal}.`);
  }

  async sendControl(type) {
    assert.equal(this.child.connected, true, "Lifecycle fixture IPC channel is closed.");
    await new Promise((resolve, reject) => {
      this.child.send({ type }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  endStdin() {
    this.child.stdin.end();
  }

  async waitForExit(timeoutMs = PROCESS_TIMEOUT_MS) {
    return withTimeout(this.exit, timeoutMs, "Lifecycle fixture did not exit within the bound.");
  }

  async terminate() {
    if (this.closed) return;
    this.child.kill("SIGKILL");
    await this.exit;
  }

  assertProtocolClean() {
    assert.deepEqual(this.stdoutCorruption, [], "Non-protocol bytes were written to stdout.");
    assert.equal(this.stdoutBuffer, "", "The child left a partial protocol stdout frame.");
  }
}

async function spawnFixture(scenario, extraEnvironment = {}) {
  const child = spawn(process.execPath, [scriptPath, FIXTURE_MODE], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      AST_LIFECYCLE_SCENARIO: scenario,
      AST_SHUTDOWN_DRAIN_TIMEOUT_MS: "100",
      AST_SYMBOL_INDEX_PERSISTENCE: "disabled",
      AST_MCP_APPLY_GUARD: "allow",
      ...extraEnvironment,
    },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });
  const fixture = new LifecycleProcess(child);
  await fixture.waitForEvent("lifecycle_fixture_ready");
  await fixture.initialize();
  return fixture;
}

function publicToolError(result) {
  assert.equal(result?.isError, true, `Expected tool error, received ${JSON.stringify(result)}.`);
  assert.equal(result.content?.length, 1);
  return JSON.parse(result.content[0].text).error;
}

function assertSingleResourceClose(fixture) {
  const closes = fixture.stderrEvents.filter((event) => event.event === "lifecycle_resource_close");
  assert.equal(closes.length, 1, "Expected exactly one MCP resource close.");
  assert.equal(closes[0].count, 1);
}

async function exerciseCleanTrigger(trigger) {
  const fixture = await spawnFixture("clean");
  try {
    if (trigger === "stdin_eof") fixture.endStdin();
    else fixture.signal(trigger);
    const exit = await fixture.waitForExit();
    assert.deepEqual(exit, { code: 0, signal: null });
    assertSingleResourceClose(fixture);
    fixture.assertProtocolClean();
  } finally {
    await fixture.terminate();
  }
}

async function exerciseActiveReadAndQueuedRejection(projectRoot) {
  const fixture = await spawnFixture("active_read");
  try {
    const activeRead = fixture.callTool("ast_lifecycle_hold_read", {
      project_root: projectRoot,
      mode: "cancellable",
    });
    await fixture.waitForEvent("lifecycle_read_active");
    const queuedRead = fixture.callTool("ast_lifecycle_queue_probe", { project_root: projectRoot });
    await fixture.waitForEvent("lifecycle_queue_request_received");
    fixture.signal("SIGTERM");

    const [activeResult, queuedResult] = await Promise.all([activeRead, queuedRead]);
    assert.equal(publicToolError(activeResult).code, "SERVER_SHUTTING_DOWN");
    assert.equal(publicToolError(queuedResult).code, "SERVER_SHUTTING_DOWN");
    const exit = await fixture.waitForExit();
    assert.deepEqual(exit, { code: 0, signal: null });
    assertSingleResourceClose(fixture);
    fixture.assertProtocolClean();
  } finally {
    await fixture.terminate();
  }
}

async function exerciseForcedNoncritical(projectRoot) {
  const fixture = await spawnFixture("forced_noncritical");
  try {
    void fixture
      .callTool("ast_lifecycle_hold_read", {
        project_root: projectRoot,
        mode: "ignore_cancellation",
      })
      .catch(() => undefined);
    await fixture.waitForEvent("lifecycle_read_active");
    fixture.signal("SIGINT");
    const exit = await fixture.waitForExit(2_000);
    assert.deepEqual(exit, { code: 1, signal: null });
    assert.equal(
      fixture.stderrEvents.filter((event) => event.event === "shutdown_incomplete").length,
      1,
      "Expected exactly one incomplete-shutdown event.",
    );
    assert.equal(
      fixture.stderrEvents.some((event) => event.event === "lifecycle_resource_close"),
      false,
      "Forced non-critical shutdown closed an in-use resource.",
    );
    fixture.assertProtocolClean();
  } finally {
    await fixture.terminate();
  }
}

async function exerciseCompletionCriticalApply(projectRoot) {
  const fixture = await spawnFixture("completion_critical_apply");
  try {
    const prepared = await fixture.callTool("ast_rename_symbol", {
      project_root: projectRoot,
      file_path: "src/value.ts",
      symbol_path: "targetValue",
      new_name: "renamedValue",
      dry_run: true,
      allow_new_errors: false,
    });
    assert.notEqual(prepared?.isError, true, JSON.stringify(prepared));
    const operationId = prepared.structuredContent?.operation_id;
    const planHash = prepared.structuredContent?.plan_hash;
    assert.equal(typeof operationId, "string");
    assert.equal(typeof planHash, "string");

    const apply = fixture.callTool("ast_apply_operation", {
      operation_id: operationId,
      plan_hash: planHash,
    });
    await fixture.waitForEvent("lifecycle_critical_apply_entered");
    fixture.signal("SIGTERM");
    await fixture.waitForEvent("lifecycle_signal_handled_1");
    fixture.signal("SIGTERM");
    await fixture.waitForEvent("lifecycle_signal_handled_2");
    await fixture.sendControl("release_critical_apply");
    await fixture.waitForEvent("lifecycle_critical_apply_released");
    assert.equal(
      fixture.stderrEvents.some((event) => event.event === "shutdown_incomplete"),
      false,
    );

    const applied = await apply;
    assert.notEqual(applied?.isError, true, JSON.stringify(applied));
    assert.equal(applied.structuredContent?.status, "applied");
    await fixture.waitForEvent("lifecycle_resource_close");
    fixture.signal("SIGTERM");
    await fixture.waitForEvent("lifecycle_signal_handled_3");
    await fixture.sendControl("release_mcp_close");
    await fixture.waitForEvent("lifecycle_resource_closed");
    const exit = await fixture.waitForExit();
    assert.deepEqual(exit, { code: 0, signal: null });
    assertSingleResourceClose(fixture);
    const criticalEntered = fixture.stderrEvents.findIndex(
      (event) => event.event === "lifecycle_critical_apply_entered",
    );
    const criticalReleased = fixture.stderrEvents.findIndex(
      (event) => event.event === "lifecycle_critical_apply_released",
    );
    const resourcesClosed = fixture.stderrEvents.findIndex(
      (event) => event.event === "lifecycle_resource_close",
    );
    assert.equal(
      criticalEntered < criticalReleased && criticalReleased < resourcesClosed,
      true,
      "Resources closed before the completion-critical apply was released.",
    );
    fixture.assertProtocolClean();
    assert.match(await readFile(path.join(projectRoot, "src/value.ts"), "utf8"), /renamedValue/);
  } finally {
    await fixture.terminate();
  }
}

async function exerciseCriticalWithStalledNoncritical(projectRoot) {
  const fixture = await spawnFixture("completion_critical_with_noncritical");
  try {
    void fixture
      .callTool("ast_lifecycle_hold_read", {
        project_root: projectRoot,
        mode: "ignore_cancellation",
      })
      .catch(() => undefined);
    await fixture.waitForEvent("lifecycle_read_active");

    const prepared = await fixture.callTool("ast_rename_symbol", {
      project_root: projectRoot,
      file_path: "src/value.ts",
      symbol_path: "targetValue",
      new_name: "mixedRenamedValue",
      dry_run: true,
      allow_new_errors: false,
    });
    assert.notEqual(prepared?.isError, true, JSON.stringify(prepared));
    const operationId = prepared.structuredContent?.operation_id;
    const planHash = prepared.structuredContent?.plan_hash;
    assert.equal(typeof operationId, "string");
    assert.equal(typeof planHash, "string");

    const apply = fixture.callTool("ast_apply_operation", {
      operation_id: operationId,
      plan_hash: planHash,
    });
    await fixture.waitForEvent("lifecycle_critical_apply_entered");
    fixture.signal("SIGTERM");
    await fixture.waitForEvent("lifecycle_signal_handled_1");
    await fixture.waitForEvent("lifecycle_completion_critical_wait");
    await fixture.sendControl("release_critical_apply");

    const applied = await apply;
    assert.notEqual(applied?.isError, true, JSON.stringify(applied));
    assert.equal(applied.structuredContent?.status, "applied");
    const exit = await fixture.waitForExit(2_000);
    assert.deepEqual(exit, { code: 1, signal: null });
    assert.equal(
      fixture.stderrEvents.filter((event) => event.event === "shutdown_incomplete").length,
      1,
    );
    assert.equal(
      fixture.stderrEvents.some((event) => event.event === "lifecycle_resource_close"),
      false,
    );
    fixture.assertProtocolClean();
    assert.match(
      await readFile(path.join(projectRoot, "src/value.ts"), "utf8"),
      /mixedRenamedValue/,
    );
  } finally {
    await fixture.terminate();
  }
}

async function listFilesRecursively(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const child of await listFilesRecursively(absolute)) {
        files.push(path.join(entry.name, child));
      }
    } else {
      files.push(entry.name);
    }
  }
  return files.sort();
}

async function exerciseCanaryCloseReopen(projectRoot, cacheRoot) {
  const environment = {
    AST_SYMBOL_INDEX_PERSISTENCE: "canary",
    AST_SYMBOL_INDEX_CACHE_ROOT: cacheRoot,
  };
  for (let restart = 0; restart < 2; restart += 1) {
    const fixture = await spawnFixture("canary", environment);
    try {
      const search = await fixture.callTool("ast_search_symbols", {
        project_root: projectRoot,
        query: "targetValue",
        detail: "summary",
        output_format: "json",
        offset: 0,
        limit: 20,
      });
      assert.notEqual(search?.isError, true, JSON.stringify(search));
      const status = await fixture.callTool("ast_get_project_status", {
        project_root: projectRoot,
      });
      assert.notEqual(status?.isError, true, JSON.stringify(status));
      assert.equal(status.structuredContent?.index_observability?.backend, "sqlite");
      fixture.endStdin();
      const exit = await fixture.waitForExit();
      assert.deepEqual(exit, { code: 0, signal: null });
      assertSingleResourceClose(fixture);
      fixture.assertProtocolClean();
    } finally {
      await fixture.terminate();
    }
  }
  const cacheFiles = await listFilesRecursively(cacheRoot);
  assert.equal(
    cacheFiles.some((file) => file.endsWith(".sqlite")),
    true,
    "Canary lifecycle did not create a reusable SQLite index.",
  );
}

async function createProjectFixture(root, suffix = "", sourceCount = 2) {
  const projectRoot = path.join(root, `project${suffix}`);
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, target: "ES2022" }, include: ["src/**/*"] }),
  );
  if (sourceCount === 2) {
    await writeFile(
      path.join(projectRoot, "src/value.ts"),
      "export function targetValue(value: number): number { return value + 1; }\n",
    );
    await writeFile(
      path.join(projectRoot, "src/use.ts"),
      'import { targetValue } from "./value.js";\nexport const result = targetValue(1);\n',
    );
  } else {
    await Promise.all(
      Array.from({ length: sourceCount }, (_, index) =>
        writeFile(
          path.join(projectRoot, `src/evidence-${index}.ts`),
          `export const evidenceValue${index} = ${index};\n`,
        ),
      ),
    );
  }
  return projectRoot;
}

async function runLifecycleMatrix() {
  assertProtocolValidator();
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-mcp-lifecycle-"));
  try {
    const projectRoot = await createProjectFixture(root);
    const mutationProjectRoot = await createProjectFixture(root, "-mutation");
    const mixedProjectRoot = await createProjectFixture(root, "-mixed");
    const cacheRoot = path.join(root, "cache");
    const evidenceProjectRoot = await createProjectFixture(root, "-evidence", 400);
    await mkdir(cacheRoot, { recursive: true, mode: 0o700 });

    await exerciseCleanTrigger("stdin_eof");
    await exerciseCleanTrigger("SIGINT");
    await exerciseCleanTrigger("SIGTERM");
    await exerciseActiveReadAndQueuedRejection(projectRoot);
    await exerciseForcedNoncritical(projectRoot);
    await exerciseCompletionCriticalApply(mutationProjectRoot);
    await exerciseCriticalWithStalledNoncritical(mixedProjectRoot);
    await exerciseCanaryCloseReopen(projectRoot, cacheRoot);
    const supervised = new LifecycleProcess(
      spawn(process.execPath, [path.join(repositoryRoot, "dist/index.js")], {
        env: {
          ...process.env,
          AST_COMPILER_WORKER_MODE: "supervised",
          AST_MCP_APPLY_GUARD: "allow",
        },
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    await supervised.initialize();
    assert.ok(await supervised.request("tools/list", {}));
    supervised.endStdin();
    await supervised.waitForExit();
    supervised.assertProtocolClean();
    // prettier-ignore
    const orphanProcesses = await (async () => { const parent = new LifecycleProcess(spawn(process.execPath, [scriptPath, PARENT_MODE, mutationProjectRoot], { stdio: ["pipe", "pipe", "pipe"] })); await parent.waitForEvent("lifecycle_critical_apply_entered"); const workerPids = await waitFor(() => processChildren(parent.child.pid).then((ids) => ids.length ? ids : undefined), "Compiler child was not observed."); const parentExited = new Promise((resolve) => parent.child.once("exit", resolve)); parent.child.kill("SIGKILL"); await withTimeout(parentExited, PROCESS_TIMEOUT_MS, "Parent controller did not exit."); await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(workerPids.every(processAlive), true); for (const pid of workerPids) process.kill(pid, "SIGUSR1"); await waitFor(() => workerPids.every((pid) => !processAlive(pid)), "Compiler child remained orphaned after critical release.", 2_000); return workerPids.filter(processAlive).length; })();
    const evidence = await runSupervisedWorkerEvidence({
      nodeBin: process.execPath,
      projectRoot: evidenceProjectRoot,
      cacheRoot: path.join(root, "evidence-cache"),
    });
    assert.equal(
      evidence.minimum_reclaimed_percent >= 80 &&
        evidence.sqlite_hits === 6 &&
        evidence.reused_files === 400 &&
        evidence.rebuilt_files === 0,
      true,
    );

    process.stdout.write(
      `${JSON.stringify({
        status: "ok",
        transport: "stdio",
        stdin_eof: true,
        sigint: true,
        sigterm: true,
        active_read_drain: true,
        queued_rejection: true,
        forced_noncritical: true,
        completion_critical_apply: true,
        completion_critical_with_noncritical: true,
        canary_close_reopen: true,
        supervised_transport: true,
        protocol_stdout_clean: true,
        parent_death_completion_critical: true,
        supervised_worker_evidence: true,
        orphan_processes: orphanProcesses,
      })}\n`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === FIXTURE_MODE) {
  await runFixtureServer();
} else if (process.argv[2] === PARENT_MODE) {
  await runSupervisedParent(process.argv[3]);
} else if (process.send) {
  await runFixtureServer();
} else {
  await runLifecycleMatrix();
}
