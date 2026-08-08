import type { CompletionCriticalRequestContext } from "./request-context.js";

export const MAX_PROJECT_OPERATION_COUNTER = 2_147_483_647;
export const MAX_PROJECT_OPERATION_DURATION_MS = 86_400_000;

export type ProjectOperationPhase =
  "queued" | "synchronizing" | "executing" | "completion_critical" | "complete";
export type ProjectOperationAdmission = "open" | "closed";
export type ProjectOperationOutcome =
  | "none"
  | "succeeded"
  | "failed"
  | "rejected"
  | "cancelled"
  | "queue_timeout"
  | "deadline_exceeded"
  | "internal_error";
export type ProjectOperationErrorCode =
  | "PROJECT_QUEUE_FULL"
  | "QUEUE_WAIT_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "OPERATION_DEADLINE_EXCEEDED"
  | "SERVER_SHUTTING_DOWN";

const ERROR_MESSAGES: Readonly<Record<ProjectOperationErrorCode, string>> = Object.freeze({
  PROJECT_QUEUE_FULL: "Project operation queue is full.",
  QUEUE_WAIT_TIMEOUT: "Project operation queue wait timed out.",
  REQUEST_CANCELLED: "Project operation was cancelled.",
  OPERATION_DEADLINE_EXCEEDED: "Project operation deadline exceeded.",
  SERVER_SHUTTING_DOWN: "Server is shutting down.",
});

export class ProjectOperationSchedulerError extends Error {
  constructor(readonly code: ProjectOperationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ProjectOperationSchedulerError";
  }
}

export interface ProjectOperationContext extends CompletionCriticalRequestContext {
  readonly sequence: number;
  readonly phase: ProjectOperationPhase;
  markExecuting(): void;
}

export interface ProjectOperationSchedulerOptions {
  readonly queueCapacity: number;
  readonly queueWaitTimeoutMs: number;
  readonly operationDeadlineMs: number;
  readonly now?: () => number;
}

export interface ProjectOperationRunOptions {
  readonly signal?: AbortSignal;
}

export interface ProjectOperationSchedulerSnapshot {
  readonly admission: ProjectOperationAdmission;
  readonly queue_capacity: number;
  readonly active_operations: number;
  readonly queued_operations: number;
  readonly retained_queue_nodes: number;
  readonly queue_abort_listeners: number;
  readonly queue_timers: number;
  readonly execution_abort_listeners: number;
  readonly execution_timers: number;
  readonly rejected_operations: number;
  readonly cancelled_operations: number;
  readonly queue_timeout_operations: number;
  readonly deadline_exceeded_operations: number;
  readonly last_outcome: ProjectOperationOutcome;
  readonly max_queue_wait_ms: number;
  readonly max_execution_ms: number;
}

export interface ProjectOperationSchedulerShutdownSnapshot {
  readonly active_operations: 0 | 1;
  readonly queued_operations: number;
  readonly completion_critical_operations: 0 | 1;
}

type OperationCallback = (context: ProjectOperationContext) => Promise<unknown> | unknown;
type OperationResolver = (value: unknown) => void;
type OperationRejecter = (reason: unknown) => void;
type OperationTimer = ReturnType<typeof setTimeout>;
type AbortKind = "client" | "deadline" | "shutdown";

interface QueueNode {
  readonly sequence: number;
  readonly clientSignal: AbortSignal;
  readonly enqueuedAt: number;
  previous: QueueNode | undefined;
  next: QueueNode | undefined;
  phase: ProjectOperationPhase;
  operation: OperationCallback | undefined;
  resolve: OperationResolver | undefined;
  reject: OperationRejecter | undefined;
  queueAbortListener: (() => void) | undefined;
  queueTimer: OperationTimer | undefined;
  executionAbortListener: (() => void) | undefined;
  executionTimer: OperationTimer | undefined;
  executionController: AbortController | undefined;
  executionStartedAt: number | undefined;
  abortKind: AbortKind | undefined;
}

export function addProjectOperationCount(current: number, increment = 1): number {
  if (!Number.isSafeInteger(current) || current < 0) return MAX_PROJECT_OPERATION_COUNTER;
  if (!Number.isSafeInteger(increment) || increment < 0) return MAX_PROJECT_OPERATION_COUNTER;
  return Math.min(MAX_PROJECT_OPERATION_COUNTER, current + increment);
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_PROJECT_OPERATION_DURATION_MS, Math.floor(value));
}

function assertIntegerRange(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in ${minimum}..${maximum}.`);
  }
}

export class ProjectOperationScheduler {
  readonly #queueCapacity: number;
  readonly #queueWaitTimeoutMs: number;
  readonly #operationDeadlineMs: number;
  readonly #now: () => number;

  #admission: ProjectOperationAdmission = "open";
  #head: QueueNode | undefined;
  #tail: QueueNode | undefined;
  #running: QueueNode | undefined;
  #waiting = 0;
  readonly #idleWaiters = new Set<() => void>();
  readonly #completionCriticalWaiters = new Set<() => void>();
  #nextSequence = 0;
  #queueAbortListeners = 0;
  #queueTimers = 0;
  #executionAbortListeners = 0;
  #executionTimers = 0;
  #rejectedOperations = 0;
  #cancelledOperations = 0;
  #queueTimeoutOperations = 0;
  #deadlineExceededOperations = 0;
  #lastOutcome: ProjectOperationOutcome = "none";
  #maxQueueWaitMs = 0;
  #maxExecutionMs = 0;

  constructor(options: ProjectOperationSchedulerOptions) {
    assertIntegerRange("queueCapacity", options.queueCapacity, 1, 256);
    assertIntegerRange("queueWaitTimeoutMs", options.queueWaitTimeoutMs, 100, 300_000);
    assertIntegerRange("operationDeadlineMs", options.operationDeadlineMs, 1_000, 900_000);
    this.#queueCapacity = options.queueCapacity;
    this.#queueWaitTimeoutMs = options.queueWaitTimeoutMs;
    this.#operationDeadlineMs = options.operationDeadlineMs;
    this.#now = options.now ?? (() => performance.now());
  }

  run<T>(
    operation: (context: ProjectOperationContext) => Promise<T> | T,
    options: ProjectOperationRunOptions = {},
  ): Promise<T> {
    if (this.#admission === "closed") {
      return this.#rejectAdmission<T>("SERVER_SHUTTING_DOWN");
    }
    if (this.#waiting >= this.#queueCapacity) {
      return this.#rejectAdmission<T>("PROJECT_QUEUE_FULL");
    }

    const clientSignal = options.signal ?? new AbortController().signal;
    const sequence = this.#nextOperationSequence();
    let node!: QueueNode;
    const result = new Promise<T>((resolve, reject) => {
      node = {
        sequence,
        clientSignal,
        enqueuedAt: this.#readNow(),
        previous: undefined,
        next: undefined,
        phase: "queued",
        operation: operation as OperationCallback,
        resolve: (value) => resolve(value as T),
        reject,
        queueAbortListener: undefined,
        queueTimer: undefined,
        executionAbortListener: undefined,
        executionTimer: undefined,
        executionController: undefined,
        executionStartedAt: undefined,
        abortKind: undefined,
      };
    });

    this.#append(node);
    this.#installQueueResources(node);
    if (clientSignal.aborted) {
      this.#rejectQueued(node, "REQUEST_CANCELLED");
    }
    this.#startNext();
    return result;
  }

  closeAdmission(): void {
    this.#admission = "closed";
  }

  beginShutdown(): void {
    this.#admission = "closed";

    let queued = this.#head;
    while (queued) {
      const next = queued.next;
      this.#rejectQueued(queued, "SERVER_SHUTTING_DOWN");
      queued = next;
    }

    const running = this.#running;
    if (running && running.phase !== "completion_critical" && running.phase !== "complete") {
      running.abortKind ??= "shutdown";
      this.#clearExecutionResources(running);
      running.executionController?.abort();
    }
    this.#notifyIdleIfNeeded();
  }

  waitForIdle(): Promise<void> {
    if (!this.#running && this.#waiting === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#idleWaiters.add(resolve);
    });
  }

  waitForCompletionCriticalOperationsToDrain(): Promise<void> {
    if (this.#running?.phase !== "completion_critical") return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#completionCriticalWaiters.add(resolve);
    });
  }

  shutdownSnapshot(): ProjectOperationSchedulerShutdownSnapshot {
    return Object.freeze({
      active_operations: this.#running ? 1 : 0,
      queued_operations: this.#waiting,
      completion_critical_operations: this.#running?.phase === "completion_critical" ? 1 : 0,
    });
  }

  snapshot(): ProjectOperationSchedulerSnapshot {
    return Object.freeze({
      admission: this.#admission,
      queue_capacity: this.#queueCapacity,
      active_operations: this.#running ? 1 : 0,
      queued_operations: this.#waiting,
      retained_queue_nodes: this.#waiting,
      queue_abort_listeners: this.#queueAbortListeners,
      queue_timers: this.#queueTimers,
      execution_abort_listeners: this.#executionAbortListeners,
      execution_timers: this.#executionTimers,
      rejected_operations: this.#rejectedOperations,
      cancelled_operations: this.#cancelledOperations,
      queue_timeout_operations: this.#queueTimeoutOperations,
      deadline_exceeded_operations: this.#deadlineExceededOperations,
      last_outcome: this.#lastOutcome,
      max_queue_wait_ms: this.#maxQueueWaitMs,
      max_execution_ms: this.#maxExecutionMs,
    });
  }

  #readNow(): number {
    const value = this.#now();
    return Number.isFinite(value) ? value : 0;
  }

  #nextOperationSequence(): number {
    if (this.#nextSequence >= Number.MAX_SAFE_INTEGER) {
      throw new ProjectOperationSchedulerError("PROJECT_QUEUE_FULL");
    }
    this.#nextSequence += 1;
    return this.#nextSequence;
  }

  #rejectAdmission<T>(code: "PROJECT_QUEUE_FULL" | "SERVER_SHUTTING_DOWN"): Promise<T> {
    this.#rejectedOperations = addProjectOperationCount(this.#rejectedOperations);
    this.#lastOutcome = "rejected";
    return Promise.reject(new ProjectOperationSchedulerError(code));
  }

  #append(node: QueueNode): void {
    node.previous = this.#tail;
    if (this.#tail) this.#tail.next = node;
    else this.#head = node;
    this.#tail = node;
    this.#waiting += 1;
  }

  #unlink(node: QueueNode): void {
    if (node.previous) node.previous.next = node.next;
    else this.#head = node.next;
    if (node.next) node.next.previous = node.previous;
    else this.#tail = node.previous;
    node.previous = undefined;
    node.next = undefined;
    this.#waiting -= 1;
  }

  #installQueueResources(node: QueueNode): void {
    const abortListener = (): void => {
      this.#rejectQueued(node, "REQUEST_CANCELLED");
      this.#startNext();
    };
    node.queueAbortListener = abortListener;
    node.clientSignal.addEventListener("abort", abortListener, { once: true });
    this.#queueAbortListeners += 1;

    node.queueTimer = setTimeout(() => {
      this.#rejectQueued(node, "QUEUE_WAIT_TIMEOUT");
      this.#startNext();
    }, this.#queueWaitTimeoutMs);
    this.#queueTimers += 1;
  }

  #clearQueueResources(node: QueueNode): void {
    if (node.queueAbortListener) {
      node.clientSignal.removeEventListener("abort", node.queueAbortListener);
      node.queueAbortListener = undefined;
      this.#queueAbortListeners -= 1;
    }
    if (node.queueTimer) {
      clearTimeout(node.queueTimer);
      node.queueTimer = undefined;
      this.#queueTimers -= 1;
    }
  }

  #rejectQueued(
    node: QueueNode,
    code: "REQUEST_CANCELLED" | "QUEUE_WAIT_TIMEOUT" | "SERVER_SHUTTING_DOWN",
  ): void {
    if (node.phase !== "queued") return;
    const reject = node.reject;
    this.#recordQueueWait(node);
    this.#unlink(node);
    this.#clearQueueResources(node);
    node.phase = "complete";
    node.operation = undefined;
    node.resolve = undefined;
    node.reject = undefined;

    if (code === "REQUEST_CANCELLED" || code === "SERVER_SHUTTING_DOWN") {
      this.#cancelledOperations = addProjectOperationCount(this.#cancelledOperations);
      this.#lastOutcome = "cancelled";
    } else {
      this.#queueTimeoutOperations = addProjectOperationCount(this.#queueTimeoutOperations);
      this.#lastOutcome = "queue_timeout";
    }
    reject?.(new ProjectOperationSchedulerError(code));
    this.#notifyIdleIfNeeded();
  }

  #recordQueueWait(node: QueueNode): void {
    const duration = boundedDuration(this.#readNow() - node.enqueuedAt);
    this.#maxQueueWaitMs = Math.max(this.#maxQueueWaitMs, duration);
  }

  #startNext(): void {
    if (this.#running) return;
    let node = this.#head;
    while (node && this.#readNow() - node.enqueuedAt >= this.#queueWaitTimeoutMs) {
      this.#rejectQueued(node, "QUEUE_WAIT_TIMEOUT");
      node = this.#head;
    }
    if (!node) return;
    this.#recordQueueWait(node);
    this.#unlink(node);
    this.#clearQueueResources(node);
    node.phase = "synchronizing";
    node.executionStartedAt = this.#readNow();
    this.#running = node;
    this.#installExecutionResources(node);
    void this.#execute(node);
  }

  #installExecutionResources(node: QueueNode): void {
    const controller = new AbortController();
    node.executionController = controller;
    const abortListener = (): void => {
      this.#clearExecutionAbortListener(node);
      if (node.phase === "complete") return;
      if (node.phase === "completion_critical") {
        this.#cancelledOperations = addProjectOperationCount(this.#cancelledOperations);
        return;
      }
      node.abortKind ??= "client";
      controller.abort();
    };
    node.executionAbortListener = abortListener;
    node.clientSignal.addEventListener("abort", abortListener, { once: true });
    this.#executionAbortListeners += 1;

    node.executionTimer = setTimeout(() => {
      this.#expireExecutionDeadline(node);
    }, this.#operationDeadlineMs);
    this.#executionTimers += 1;

    if (node.clientSignal.aborted) abortListener();
  }

  #clearExecutionResources(node: QueueNode): void {
    this.#clearExecutionAbortListener(node);
    this.#clearExecutionTimer(node);
  }

  #clearExecutionAbortListener(node: QueueNode): void {
    if (node.executionAbortListener) {
      node.clientSignal.removeEventListener("abort", node.executionAbortListener);
      node.executionAbortListener = undefined;
      this.#executionAbortListeners -= 1;
    }
  }

  #clearExecutionTimer(node: QueueNode): void {
    if (node.executionTimer) {
      clearTimeout(node.executionTimer);
      node.executionTimer = undefined;
      this.#executionTimers -= 1;
    }
  }

  #expireExecutionDeadline(node: QueueNode): void {
    if (node.phase === "completion_critical" || node.phase === "complete" || node.abortKind) return;
    node.abortKind = "deadline";
    this.#clearExecutionResources(node);
    node.executionController?.abort();
  }

  #checkpoint(node: QueueNode): void {
    if (node.phase === "completion_critical") return;
    const startedAt = node.executionStartedAt;
    if (
      node.abortKind === undefined &&
      startedAt !== undefined &&
      this.#readNow() - startedAt >= this.#operationDeadlineMs
    ) {
      this.#expireExecutionDeadline(node);
    }
    if (node.abortKind === "deadline") {
      throw new ProjectOperationSchedulerError("OPERATION_DEADLINE_EXCEEDED");
    }
    if (node.abortKind === "shutdown") {
      throw new ProjectOperationSchedulerError("SERVER_SHUTTING_DOWN");
    }
    if (node.abortKind === "client" || node.clientSignal.aborted) {
      throw new ProjectOperationSchedulerError("REQUEST_CANCELLED");
    }
  }

  #createContext(node: QueueNode): ProjectOperationContext {
    return Object.freeze({
      sequence: node.sequence,
      get signal(): AbortSignal {
        if (!node.executionController) throw new Error("Operation signal is unavailable.");
        return node.executionController.signal;
      },
      get phase(): ProjectOperationPhase {
        return node.phase;
      },
      checkpoint: (): void => {
        this.#checkpoint(node);
      },
      markExecuting: (): void => {
        this.#checkpoint(node);
        if (node.phase !== "synchronizing") {
          throw new Error("Operation can enter executing only from synchronizing.");
        }
        node.phase = "executing";
      },
      enterCompletionCritical: (): void => {
        this.#checkpoint(node);
        if (node.phase !== "executing") {
          throw new Error("Operation can enter completion-critical only from executing.");
        }
        node.phase = "completion_critical";
        this.#clearExecutionTimer(node);
      },
    });
  }

  async #execute(node: QueueNode): Promise<void> {
    const operation = node.operation;
    const resolve = node.resolve;
    const reject = node.reject;
    if (!operation || !resolve || !reject) {
      this.#finishExecution(node, "internal_error");
      reject?.(new Error("Operation state is unavailable."));
      return;
    }

    const context = this.#createContext(node);
    try {
      context.checkpoint();
      const value = await operation(context);
      context.checkpoint();
      this.#lastOutcome = "succeeded";
      resolve(value);
    } catch (error) {
      const failure = this.#classifyExecutionFailure(node, error);
      reject(failure.error);
      this.#lastOutcome = failure.outcome;
      if (failure.outcome === "cancelled") {
        this.#cancelledOperations = addProjectOperationCount(this.#cancelledOperations);
      } else if (failure.outcome === "deadline_exceeded") {
        this.#deadlineExceededOperations = addProjectOperationCount(
          this.#deadlineExceededOperations,
        );
      }
    } finally {
      this.#finishExecution(node, this.#lastOutcome);
    }
  }

  #classifyExecutionFailure(
    node: QueueNode,
    error: unknown,
  ): { readonly error: unknown; readonly outcome: ProjectOperationOutcome } {
    if (node.phase !== "completion_critical") {
      if (node.abortKind === "deadline") {
        return {
          error: new ProjectOperationSchedulerError("OPERATION_DEADLINE_EXCEEDED"),
          outcome: "deadline_exceeded",
        };
      }
      if (node.abortKind === "shutdown") {
        return {
          error: new ProjectOperationSchedulerError("SERVER_SHUTTING_DOWN"),
          outcome: "cancelled",
        };
      }
      if (node.abortKind === "client" || node.clientSignal.aborted) {
        return {
          error: new ProjectOperationSchedulerError("REQUEST_CANCELLED"),
          outcome: "cancelled",
        };
      }
    }
    if (error instanceof ProjectOperationSchedulerError) {
      if (error.code === "REQUEST_CANCELLED") return { error, outcome: "cancelled" };
      if (error.code === "OPERATION_DEADLINE_EXCEEDED") {
        return { error, outcome: "deadline_exceeded" };
      }
    }
    return { error, outcome: "failed" };
  }

  #finishExecution(node: QueueNode, outcome: ProjectOperationOutcome): void {
    const wasCompletionCritical = node.phase === "completion_critical";
    const startedAt = node.executionStartedAt ?? this.#readNow();
    const duration = boundedDuration(this.#readNow() - startedAt);
    this.#maxExecutionMs = Math.max(this.#maxExecutionMs, duration);
    this.#clearExecutionResources(node);
    node.phase = "complete";
    node.operation = undefined;
    node.resolve = undefined;
    node.reject = undefined;
    node.executionController = undefined;
    node.executionStartedAt = undefined;
    node.abortKind = undefined;
    if (this.#running === node) this.#running = undefined;
    this.#lastOutcome = outcome;
    this.#startNext();
    if (wasCompletionCritical) this.#notifyCompletionCriticalWaiters();
    this.#notifyIdleIfNeeded();
  }

  #notifyCompletionCriticalWaiters(): void {
    if (
      this.#running?.phase === "completion_critical" ||
      this.#completionCriticalWaiters.size === 0
    ) {
      return;
    }
    const waiters = [...this.#completionCriticalWaiters];
    this.#completionCriticalWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  #notifyIdleIfNeeded(): void {
    if (this.#running || this.#waiting !== 0 || this.#idleWaiters.size === 0) return;
    const waiters = [...this.#idleWaiters];
    this.#idleWaiters.clear();
    for (const resolve of waiters) resolve();
  }
}
