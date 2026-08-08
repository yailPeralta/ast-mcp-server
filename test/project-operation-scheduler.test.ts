import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PROJECT_OPERATION_COUNTER,
  ProjectOperationScheduler,
  addProjectOperationCount,
} from "../src/services/project-operation-scheduler.js";

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

function createScheduler(
  overrides: {
    readonly queueCapacity?: number;
    readonly queueWaitTimeoutMs?: number;
    readonly operationDeadlineMs?: number;
    readonly now?: () => number;
  } = {},
): ProjectOperationScheduler {
  return new ProjectOperationScheduler({
    queueCapacity: overrides.queueCapacity ?? 2,
    queueWaitTimeoutMs: overrides.queueWaitTimeoutMs ?? 100,
    operationDeadlineMs: overrides.operationDeadlineMs ?? 1_000,
    now: overrides.now,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("project operation scheduler", () => {
  it("preserves FIFO, tracks running separately and rejects before retaining overflow", async () => {
    const scheduler = createScheduler({ queueCapacity: 2 });
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const events: string[] = [];
    const sequences: number[] = [];

    const first = scheduler.run(async (context) => {
      events.push("first:start");
      sequences.push(context.sequence);
      firstStarted.resolve();
      await releaseFirst.promise;
      events.push("first:end");
    });
    await firstStarted.promise;
    const second = scheduler.run((context) => {
      events.push("second");
      sequences.push(context.sequence);
    });
    const third = scheduler.run((context) => {
      events.push("third");
      sequences.push(context.sequence);
    });

    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 1,
      queued_operations: 2,
      retained_queue_nodes: 2,
      queue_abort_listeners: 2,
      queue_timers: 2,
    });
    await expect(scheduler.run(() => undefined)).rejects.toMatchObject({
      code: "PROJECT_QUEUE_FULL",
      message: "Project operation queue is full.",
    });
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 1,
      queued_operations: 2,
      retained_queue_nodes: 2,
      rejected_operations: 1,
      last_outcome: "rejected",
    });

    releaseFirst.resolve();
    await Promise.all([first, second, third]);
    expect(events).toEqual(["first:start", "first:end", "second", "third"]);
    expect(sequences).toEqual([1, 2, 3]);
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 0,
      queued_operations: 0,
      retained_queue_nodes: 0,
      queue_abort_listeners: 0,
      queue_timers: 0,
      execution_abort_listeners: 0,
      execution_timers: 0,
      last_outcome: "succeeded",
    });
  });

  it("unlinks repeated queued cancellations without tombstones or retained callbacks", async () => {
    const scheduler = createScheduler({ queueCapacity: 1 });
    const runningStarted = createDeferred();
    const releaseRunning = createDeferred();
    const running = scheduler.run(async () => {
      runningStarted.resolve();
      await releaseRunning.promise;
    });
    await runningStarted.promise;
    let callbackCalls = 0;

    for (let index = 0; index < 50; index += 1) {
      const controller = new AbortController();
      const queued = scheduler.run(
        () => {
          callbackCalls += 1;
        },
        { signal: controller.signal },
      );
      expect(scheduler.snapshot()).toMatchObject({
        queued_operations: 1,
        retained_queue_nodes: 1,
        queue_abort_listeners: 1,
        queue_timers: 1,
      });
      controller.abort();
      await expect(queued).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
      expect(scheduler.snapshot()).toMatchObject({
        queued_operations: 0,
        retained_queue_nodes: 0,
        queue_abort_listeners: 0,
        queue_timers: 0,
      });
    }

    expect(callbackCalls).toBe(0);
    expect(scheduler.snapshot().cancelled_operations).toBe(50);
    releaseRunning.resolve();
    await running;
  });

  it("settles a pre-aborted admission without retaining queue resources", async () => {
    const scheduler = createScheduler();
    const controller = new AbortController();
    controller.abort();
    let callbackCalled = false;

    await expect(
      scheduler.run(
        () => {
          callbackCalled = true;
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(callbackCalled).toBe(false);
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 0,
      queued_operations: 0,
      retained_queue_nodes: 0,
      queue_abort_listeners: 0,
      queue_timers: 0,
      cancelled_operations: 1,
    });
  });

  it("expires queue wait immediately, frees the slot and does not block later work", async () => {
    vi.useFakeTimers();
    let now = 0;
    const scheduler = createScheduler({
      queueCapacity: 1,
      queueWaitTimeoutMs: 100,
      now: () => now,
    });
    const runningStarted = createDeferred();
    const releaseRunning = createDeferred();
    const running = scheduler.run(async () => {
      runningStarted.resolve();
      await releaseRunning.promise;
    });
    await runningStarted.promise;
    let expiredCallbackCalled = false;
    const expired = scheduler.run(() => {
      expiredCallbackCalled = true;
    });
    const expiredExpectation = expect(expired).rejects.toMatchObject({
      code: "QUEUE_WAIT_TIMEOUT",
      message: "Project operation queue wait timed out.",
    });

    now = 100;
    await vi.advanceTimersByTimeAsync(100);
    await expiredExpectation;
    expect(expiredCallbackCalled).toBe(false);
    expect(scheduler.snapshot()).toMatchObject({
      queued_operations: 0,
      retained_queue_nodes: 0,
      queue_abort_listeners: 0,
      queue_timers: 0,
      queue_timeout_operations: 1,
      max_queue_wait_ms: 100,
    });

    const later = scheduler.run(() => "later");
    releaseRunning.resolve();
    await expect(running).resolves.toBeUndefined();
    await expect(later).resolves.toBe("later");
  });

  it("rejects a monotonically expired queue head before its timer callback runs", async () => {
    vi.useFakeTimers();
    let now = 0;
    const scheduler = createScheduler({ queueWaitTimeoutMs: 100, now: () => now });
    const runningStarted = createDeferred();
    const releaseRunning = createDeferred();
    const running = scheduler.run(async () => {
      runningStarted.resolve();
      await releaseRunning.promise;
    });
    await runningStarted.promise;
    let expiredCallbackCalled = false;
    const expired = scheduler.run(() => {
      expiredCallbackCalled = true;
    });
    const expiredExpectation = expect(expired).rejects.toMatchObject({
      code: "QUEUE_WAIT_TIMEOUT",
    });

    now = 100;
    releaseRunning.resolve();
    await running;
    await expiredExpectation;

    expect(expiredCallbackCalled).toBe(false);
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 0,
      queued_operations: 0,
      queue_timeout_operations: 1,
      last_outcome: "queue_timeout",
    });
  });

  it("classifies active client cancellation only at a cooperative checkpoint", async () => {
    const scheduler = createScheduler();
    const controller = new AbortController();
    const started = createDeferred();
    const operation = scheduler.run(
      async (context) => {
        context.markExecuting();
        started.resolve();
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        context.checkpoint();
      },
      { signal: controller.signal },
    );

    await started.promise;
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 1,
      execution_abort_listeners: 1,
      execution_timers: 1,
    });
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 0,
      execution_abort_listeners: 0,
      execution_timers: 0,
      cancelled_operations: 1,
      last_outcome: "cancelled",
    });
  });

  it("classifies a cooperative execution deadline without returning ahead of work", async () => {
    vi.useFakeTimers();
    let now = 0;
    const scheduler = createScheduler({ operationDeadlineMs: 1_000, now: () => now });
    const started = createDeferred();
    const deadlineObserved = createDeferred();
    const releaseAfterDeadline = createDeferred();
    let callbackFinished = false;
    let operationSettled = false;
    const operation = scheduler.run(async (context) => {
      started.resolve();
      await new Promise<void>((resolve) => {
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      deadlineObserved.resolve();
      await releaseAfterDeadline.promise;
      callbackFinished = true;
      context.checkpoint();
    });
    void operation.then(
      () => {
        operationSettled = true;
      },
      () => {
        operationSettled = true;
      },
    );
    const operationExpectation = expect(operation).rejects.toMatchObject({
      code: "OPERATION_DEADLINE_EXCEEDED",
      message: "Project operation deadline exceeded.",
    });

    await started.promise;
    now = 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    await deadlineObserved.promise;
    expect(callbackFinished).toBe(false);
    expect(operationSettled).toBe(false);
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 1,
      execution_abort_listeners: 0,
      execution_timers: 0,
    });

    releaseAfterDeadline.resolve();
    await operationExpectation;
    expect(callbackFinished).toBe(true);
    expect(operationSettled).toBe(true);
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 0,
      execution_abort_listeners: 0,
      execution_timers: 0,
      deadline_exceeded_operations: 1,
      max_execution_ms: 1_000,
      last_outcome: "deadline_exceeded",
    });
  });

  it("rejects a synchronous monotonic deadline overrun before timer delivery", async () => {
    vi.useFakeTimers();
    let now = 0;
    const scheduler = createScheduler({ operationDeadlineMs: 1_000, now: () => now });
    const operation = scheduler.run(() => {
      now = 1_000;
      return "overdue";
    });

    await expect(operation).rejects.toMatchObject({
      code: "OPERATION_DEADLINE_EXCEEDED",
    });
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 0,
      deadline_exceeded_operations: 1,
      max_execution_ms: 1_000,
      last_outcome: "deadline_exceeded",
    });
  });

  it("preserves terminal work after entering completion-critical phase", async () => {
    vi.useFakeTimers();
    let now = 0;
    const scheduler = createScheduler({ operationDeadlineMs: 1_000, now: () => now });
    const controller = new AbortController();
    const critical = createDeferred();
    const inspectCriticalSignal = createDeferred();
    const criticalSignalInspected = createDeferred();
    const release = createDeferred();
    let abortEvents = 0;
    let phaseAtCriticalEntry: string | undefined;
    let signalAbortedAtCriticalEntry: boolean | undefined;
    let inspectedSignalAborted: boolean | undefined;
    let inspectedAbortEvents: number | undefined;
    const operation = scheduler.run(
      async (context) => {
        context.markExecuting();
        context.enterCompletionCritical();
        context.signal.addEventListener(
          "abort",
          () => {
            abortEvents += 1;
          },
          { once: true },
        );
        phaseAtCriticalEntry = context.phase;
        signalAbortedAtCriticalEntry = context.signal.aborted;
        critical.resolve();
        await inspectCriticalSignal.promise;
        try {
          inspectedSignalAborted = context.signal.aborted;
          inspectedAbortEvents = abortEvents;
        } finally {
          criticalSignalInspected.resolve();
        }
        await release.promise;
        return "committed";
      },
      { signal: controller.signal },
    );
    const operationExpectation = expect(operation).resolves.toBe("committed");

    await critical.promise;
    expect(phaseAtCriticalEntry).toBe("completion_critical");
    expect(signalAbortedAtCriticalEntry).toBe(false);
    controller.abort();
    now = 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    inspectCriticalSignal.resolve();
    await criticalSignalInspected.promise;
    expect(inspectedSignalAborted).toBe(false);
    expect(inspectedAbortEvents).toBe(0);
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 1,
      execution_abort_listeners: 0,
      execution_timers: 0,
      cancelled_operations: 1,
    });
    expect(abortEvents).toBe(0);
    release.resolve();
    await operationExpectation;
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 0,
      queued_operations: 0,
      retained_queue_nodes: 0,
      queue_abort_listeners: 0,
      queue_timers: 0,
      execution_abort_listeners: 0,
      execution_timers: 0,
      cancelled_operations: 1,
      deadline_exceeded_operations: 0,
      last_outcome: "succeeded",
    });
  });

  it("recovers after callback failure and starts the next queued operation", async () => {
    const scheduler = createScheduler({ queueCapacity: 1 });
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const first = scheduler.run(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      throw new Error("callback failed");
    });
    await firstStarted.promise;
    const second = scheduler.run(() => "recovered");

    releaseFirst.resolve();
    await expect(first).rejects.toThrow("callback failed");
    await expect(second).resolves.toBe("recovered");
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 0,
      queued_operations: 0,
      execution_abort_listeners: 0,
      execution_timers: 0,
      last_outcome: "succeeded",
    });
  });

  it("closes admission without interrupting already admitted work", async () => {
    const scheduler = createScheduler({ queueCapacity: 1 });
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const first = scheduler.run(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return "first";
    });
    await firstStarted.promise;
    const queued = scheduler.run(() => "queued");

    scheduler.closeAdmission();
    expect(scheduler.snapshot().admission).toBe("closed");
    await expect(scheduler.run(() => "rejected")).rejects.toMatchObject({
      code: "SERVER_SHUTTING_DOWN",
      message: "Server is shutting down.",
    });
    releaseFirst.resolve();
    await expect(first).resolves.toBe("first");
    await expect(queued).resolves.toBe("queued");
  });

  it("saturates counters and measured durations at approved ceilings", async () => {
    expect(addProjectOperationCount(MAX_PROJECT_OPERATION_COUNTER - 1, 10)).toBe(
      MAX_PROJECT_OPERATION_COUNTER,
    );
    expect(addProjectOperationCount(Number.NaN)).toBe(MAX_PROJECT_OPERATION_COUNTER);
    expect(addProjectOperationCount(0, -1)).toBe(MAX_PROJECT_OPERATION_COUNTER);

    let now = 0;
    const scheduler = createScheduler({ now: () => now });
    await expect(
      scheduler.run(() => {
        now = 100_000_000;
      }),
    ).rejects.toMatchObject({ code: "OPERATION_DEADLINE_EXCEEDED" });
    expect(scheduler.snapshot()).toMatchObject({
      deadline_exceeded_operations: 1,
      max_execution_ms: 86_400_000,
    });
    expect(Object.isFrozen(scheduler.snapshot())).toBe(true);
  });
});
