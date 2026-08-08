import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStdioServer } from "../src/index.js";
import { ProjectOperationScheduler } from "../src/services/project-operation-scheduler.js";
import {
  beginProjectShutdown,
  clearProjectSessions,
  closeDrainedProjectSessions,
  getProjectRuntimeShutdownSnapshot,
  prepareProjectRuntimeForStartup,
  waitForProjectCompletionCriticalOperationsToDrain,
  waitForProjectOperationsToDrain,
  withProject,
} from "../src/services/project.js";
import { RuntimeActivityTracker } from "../src/services/runtime-activity.js";
import { parseRuntimePolicy } from "../src/services/runtime-policy.js";
import { ShutdownCoordinator, type RuntimeDrainSnapshot } from "../src/services/shutdown.js";

function createDeferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createScheduler(): ProjectOperationScheduler {
  return new ProjectOperationScheduler({
    queueCapacity: 2,
    queueWaitTimeoutMs: 1_000,
    operationDeadlineMs: 10_000,
  });
}

const idleSnapshot = (): RuntimeDrainSnapshot => ({
  active_operations: 0,
  queued_operations: 0,
  completion_critical_operations: 0,
});

const activeSnapshot = (completionCritical = false): RuntimeDrainSnapshot => ({
  active_operations: 1,
  queued_operations: 0,
  completion_critical_operations: completionCritical ? 1 : 0,
});

afterEach(() => {
  vi.useRealTimers();
  clearProjectSessions();
});

describe("project shutdown admission and cancellation", () => {
  it("closes admission before project resolution and resets only for a new runtime", async () => {
    prepareProjectRuntimeForStartup();
    beginProjectShutdown();

    expect(getProjectRuntimeShutdownSnapshot()).toMatchObject({
      admission: "closed",
      session_count: 0,
    });
    await expect(withProject("/definitely/missing/project", () => undefined)).rejects.toMatchObject(
      {
        code: "SERVER_SHUTTING_DOWN",
        message: "Server is shutting down.",
      },
    );

    await waitForProjectCompletionCriticalOperationsToDrain();
    await waitForProjectOperationsToDrain();
    closeDrainedProjectSessions();
    prepareProjectRuntimeForStartup();
    expect(getProjectRuntimeShutdownSnapshot().admission).toBe("open");
  });

  it("unlinks queued work and cooperatively cancels active non-critical work", async () => {
    const scheduler = createScheduler();
    const started = createDeferred();
    let queuedCalls = 0;
    const running = scheduler.run(async (context) => {
      context.markExecuting();
      started.resolve();
      await new Promise<void>((resolve) => {
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      context.checkpoint();
    });
    await started.promise;
    const queued = scheduler.run(() => {
      queuedCalls += 1;
    });

    const idle = scheduler.waitForIdle();
    scheduler.beginShutdown();

    await expect(queued).rejects.toMatchObject({ code: "SERVER_SHUTTING_DOWN" });
    await expect(running).rejects.toMatchObject({ code: "SERVER_SHUTTING_DOWN" });
    await idle;
    expect(queuedCalls).toBe(0);
    expect(scheduler.shutdownSnapshot()).toEqual(idleSnapshot());
    expect(scheduler.snapshot()).toMatchObject({
      admission: "closed",
      active_operations: 0,
      queued_operations: 0,
      retained_queue_nodes: 0,
      queue_abort_listeners: 0,
      queue_timers: 0,
      execution_abort_listeners: 0,
      execution_timers: 0,
      cancelled_operations: 2,
      last_outcome: "cancelled",
    });
    await expect(scheduler.run(() => undefined)).rejects.toMatchObject({
      code: "SERVER_SHUTTING_DOWN",
    });
  });

  it("does not abort or bound completion-critical terminal work", async () => {
    const scheduler = createScheduler();
    const critical = createDeferred();
    const release = createDeferred();
    let signalAbortedAfterShutdown: boolean | undefined;
    const operation = scheduler.run(async (context) => {
      context.markExecuting();
      context.enterCompletionCritical();
      critical.resolve();
      await release.promise;
      signalAbortedAfterShutdown = context.signal.aborted;
      return "terminal";
    });
    await critical.promise;

    scheduler.beginShutdown();
    const idle = scheduler.waitForIdle();
    const criticalDrained = scheduler.waitForCompletionCriticalOperationsToDrain();
    let idleSettled = false;
    void idle.then(() => {
      idleSettled = true;
    });
    await Promise.resolve();

    expect(idleSettled).toBe(false);
    expect(scheduler.shutdownSnapshot()).toEqual(activeSnapshot(true));
    release.resolve();
    await expect(operation).resolves.toBe("terminal");
    await criticalDrained;
    await idle;
    expect(signalAbortedAfterShutdown).toBe(false);
    expect(scheduler.shutdownSnapshot()).toEqual(idleSnapshot());
  });
});

describe("shutdown coordinator", () => {
  it("stops admission synchronously, shares one promise and closes once after safe drain", async () => {
    const drain = createDeferred();
    const events: string[] = [];
    let snapshot = activeSnapshot();
    const coordinator = new ShutdownCoordinator({
      drainTimeoutMs: 1_000,
      stopAdmissionAndCancel: () => {
        events.push("stop");
        return snapshot;
      },
      getDrainSnapshot: () => snapshot,
      waitForDrain: async () => {
        events.push("wait");
        await drain.promise;
      },
      waitForCompletionCriticalOperationsToDrain: async () => undefined,
      closeMcp: async () => {
        events.push("close:mcp");
      },
      closeProjects: () => {
        events.push("close:projects");
      },
      emitIncompleteShutdown: () => {
        events.push("incomplete");
      },
    });

    const first = coordinator.shutdown("sigterm");
    const second = coordinator.shutdown("sigint");
    expect(first).toBe(second);
    expect(events).toEqual(["stop", "wait"]);

    snapshot = idleSnapshot();
    drain.resolve();
    await expect(first).resolves.toEqual({ state: "complete", trigger: "sigterm" });
    expect(events).toEqual(["stop", "wait", "close:mcp", "close:projects"]);
  });

  it("returns forced_noncritical at grace expiry without closing resources under use", async () => {
    vi.useFakeTimers();
    const drain = createDeferred();
    const closeMcp = vi.fn(async () => undefined);
    const closeProjects = vi.fn();
    const emitIncompleteShutdown = vi.fn();
    const coordinator = new ShutdownCoordinator({
      drainTimeoutMs: 100,
      stopAdmissionAndCancel: () => activeSnapshot(),
      getDrainSnapshot: () => activeSnapshot(),
      waitForDrain: () => drain.promise,
      waitForCompletionCriticalOperationsToDrain: async () => undefined,
      closeMcp,
      closeProjects,
      emitIncompleteShutdown,
    });

    const shutdown = coordinator.shutdown("stdin_eof");
    const shutdownExpectation = expect(shutdown).resolves.toEqual({
      state: "forced_noncritical",
      trigger: "stdin_eof",
    });
    await vi.advanceTimersByTimeAsync(100);
    await shutdownExpectation;

    expect(emitIncompleteShutdown).toHaveBeenCalledTimes(1);
    expect(emitIncompleteShutdown).toHaveBeenCalledWith("stdin_eof", activeSnapshot());
    expect(closeMcp).not.toHaveBeenCalled();
    expect(closeProjects).not.toHaveBeenCalled();
  });

  it("forces timeout when MCP callback activity remains outside project scheduling", async () => {
    vi.useFakeTimers();
    const closeMcp = vi.fn(async () => undefined);
    const closeProjects = vi.fn();
    const emitIncompleteShutdown = vi.fn();
    const coordinator = new ShutdownCoordinator({
      drainTimeoutMs: 50,
      stopAdmissionAndCancel: idleSnapshot,
      getDrainSnapshot: idleSnapshot,
      waitForDrain: () => new Promise(() => undefined),
      waitForCompletionCriticalOperationsToDrain: async () => undefined,
      closeMcp,
      closeProjects,
      emitIncompleteShutdown,
    });

    const shutdown = coordinator.shutdown("sigterm");
    const shutdownExpectation = expect(shutdown).resolves.toEqual({
      state: "forced_noncritical",
      trigger: "sigterm",
    });
    await vi.advanceTimersByTimeAsync(50);
    await shutdownExpectation;

    expect(emitIncompleteShutdown).toHaveBeenCalledOnce();
    expect(closeMcp).not.toHaveBeenCalled();
    expect(closeProjects).not.toHaveBeenCalled();
  });

  it("waits beyond the grace while completion-critical work is active", async () => {
    vi.useFakeTimers();
    const drain = createDeferred();
    const criticalDrain = createDeferred();
    let snapshot = activeSnapshot(true);
    const closeMcp = vi.fn(async () => undefined);
    const closeProjects = vi.fn();
    const emitIncompleteShutdown = vi.fn();
    const coordinator = new ShutdownCoordinator({
      drainTimeoutMs: 100,
      stopAdmissionAndCancel: () => snapshot,
      getDrainSnapshot: () => snapshot,
      waitForDrain: () => drain.promise,
      waitForCompletionCriticalOperationsToDrain: () => criticalDrain.promise,
      closeMcp,
      closeProjects,
      emitIncompleteShutdown,
    });

    const shutdown = coordinator.shutdown("sigterm");
    let settled = false;
    void shutdown.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    expect(closeMcp).not.toHaveBeenCalled();
    expect(closeProjects).not.toHaveBeenCalled();
    expect(emitIncompleteShutdown).not.toHaveBeenCalled();

    snapshot = idleSnapshot();
    criticalDrain.resolve();
    drain.resolve();
    await expect(shutdown).resolves.toEqual({ state: "complete", trigger: "sigterm" });
    expect(closeMcp).toHaveBeenCalledTimes(1);
    expect(closeProjects).toHaveBeenCalledTimes(1);
  });

  it("re-enables bounded grace for stalled non-critical work after critical drain", async () => {
    vi.useFakeTimers();
    const drain = createDeferred();
    const criticalDrain = createDeferred();
    let snapshot = activeSnapshot(true);
    const closeMcp = vi.fn(async () => undefined);
    const closeProjects = vi.fn();
    const emitIncompleteShutdown = vi.fn();
    const onCompletionCriticalWait = vi.fn();
    const coordinator = new ShutdownCoordinator({
      drainTimeoutMs: 100,
      stopAdmissionAndCancel: () => snapshot,
      getDrainSnapshot: () => snapshot,
      waitForDrain: () => drain.promise,
      waitForCompletionCriticalOperationsToDrain: () => criticalDrain.promise,
      closeMcp,
      closeProjects,
      emitIncompleteShutdown,
      onCompletionCriticalWait,
    });

    const shutdown = coordinator.shutdown("sigterm");
    const shutdownExpectation = expect(shutdown).resolves.toEqual({
      state: "forced_noncritical",
      trigger: "sigterm",
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(onCompletionCriticalWait).toHaveBeenCalledOnce();
    expect(emitIncompleteShutdown).not.toHaveBeenCalled();

    snapshot = activeSnapshot(false);
    criticalDrain.resolve();
    await vi.advanceTimersByTimeAsync(99);
    expect(emitIncompleteShutdown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await shutdownExpectation;

    expect(emitIncompleteShutdown).toHaveBeenCalledOnce();
    expect(emitIncompleteShutdown).toHaveBeenCalledWith("sigterm", activeSnapshot(false));
    expect(closeMcp).not.toHaveBeenCalled();
    expect(closeProjects).not.toHaveBeenCalled();
  });

  it("attempts project cleanup when MCP close fails", async () => {
    const closeError = new Error("close failed");
    const closeProjects = vi.fn();
    const coordinator = new ShutdownCoordinator({
      drainTimeoutMs: 100,
      stopAdmissionAndCancel: idleSnapshot,
      getDrainSnapshot: idleSnapshot,
      waitForDrain: async () => undefined,
      waitForCompletionCriticalOperationsToDrain: async () => undefined,
      closeMcp: async () => {
        throw closeError;
      },
      closeProjects,
      emitIncompleteShutdown: vi.fn(),
    });

    await expect(coordinator.shutdown("requested")).rejects.toBe(closeError);
    expect(closeProjects).toHaveBeenCalledTimes(1);
  });
});

describe("runtime activity drain", () => {
  it("waits for the protocol send scheduled after a tool callback settles", async () => {
    const tracker = new RuntimeActivityTracker();
    tracker.prepareForStartup();
    const sendRelease = createDeferred();
    const request = tracker.trackRequest(async () => "response");
    const idle = tracker.waitForIdle();

    await expect(request).resolves.toBe("response");
    const send = tracker.trackSend(() => sendRelease.promise);
    let idleSettled = false;
    void idle.then(() => {
      idleSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(idleSettled).toBe(false);
    expect(tracker.snapshot()).toMatchObject({ active_requests: 0, active_sends: 1 });
    sendRelease.resolve();
    await send;
    await idle;
    expect(tracker.snapshot()).toMatchObject({ active_requests: 0, active_sends: 0 });
  });
});

describe("stdio startup", () => {
  it("returns a testable handle and closes the owned MCP transport exactly once", async () => {
    const transport: Transport = {
      start: vi.fn(async () => undefined),
      send: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const protocol = { onclose: undefined as (() => void) | undefined };
    const server = {
      server: protocol,
      connect: vi.fn(async (connectedTransport: Transport) => {
        await connectedTransport.start();
      }),
      close: vi.fn(async () => {
        await transport.close();
        protocol.onclose?.();
      }),
    } as unknown as McpServer;
    const runtimePolicy = parseRuntimePolicy({ AST_SHUTDOWN_DRAIN_TIMEOUT_MS: "100" });
    const runtimeActivity = new RuntimeActivityTracker();

    const handle = await runStdioServer({
      server,
      transport,
      runtimePolicy,
      runtimeActivity,
      installProcessHandlers: false,
      logStartup: false,
    });
    const first = handle.shutdown("requested");
    const second = handle.shutdown("sigterm");

    expect(first).toBe(second);
    await expect(first).resolves.toEqual({ state: "complete", trigger: "requested" });
    expect(server.connect).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });
});
