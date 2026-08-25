export type ShutdownTrigger =
  "requested" | "parent_exit" | "stdin_eof" | "transport_closed" | "sigint" | "sigterm";

export interface RuntimeDrainSnapshot {
  readonly active_operations: number;
  readonly queued_operations: number;
  readonly completion_critical_operations: number;
}

export type ShutdownResult = Readonly<{
  state: "complete" | "forced_noncritical";
  trigger: ShutdownTrigger;
}>;

export interface ShutdownCoordinatorOptions {
  readonly drainTimeoutMs: number;
  readonly stopAdmissionAndCancel: () => RuntimeDrainSnapshot;
  readonly getDrainSnapshot: () => RuntimeDrainSnapshot;
  readonly waitForDrain: () => Promise<void>;
  readonly waitForCompletionCriticalOperationsToDrain: () => Promise<void>;
  readonly closeMcp: () => Promise<void>;
  readonly closeProjects: () => Promise<void> | void;
  readonly emitIncompleteShutdown: (
    trigger: ShutdownTrigger,
    snapshot: RuntimeDrainSnapshot,
  ) => void;
  readonly onCompletionCriticalWait?: (snapshot: RuntimeDrainSnapshot) => void;
}

export interface IncompleteShutdownEvent {
  readonly event: "shutdown_incomplete";
  readonly version: 1;
  readonly state: "forced_noncritical";
  readonly trigger: ShutdownTrigger;
  readonly active_operations: number;
  readonly queued_operations: number;
  readonly completion_critical_operations: number;
}

function assertDrainTimeout(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) {
    throw new RangeError("drainTimeoutMs must be an integer in 1..300000.");
  }
}

function boundedCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, 2_147_483_647);
}

export function renderIncompleteShutdownEvent(
  trigger: ShutdownTrigger,
  snapshot: RuntimeDrainSnapshot,
): string {
  const event: IncompleteShutdownEvent = {
    event: "shutdown_incomplete",
    version: 1,
    state: "forced_noncritical",
    trigger,
    active_operations: boundedCount(snapshot.active_operations),
    queued_operations: boundedCount(snapshot.queued_operations),
    completion_critical_operations: boundedCount(snapshot.completion_critical_operations),
  };
  return JSON.stringify(event);
}

export function emitIncompleteShutdownEvent(
  trigger: ShutdownTrigger,
  snapshot: RuntimeDrainSnapshot,
): void {
  process.stderr.write(`${renderIncompleteShutdownEvent(trigger, snapshot)}\n`);
}

export class ShutdownCoordinator {
  readonly #options: ShutdownCoordinatorOptions;
  #completion: Promise<ShutdownResult> | undefined;

  constructor(options: ShutdownCoordinatorOptions) {
    assertDrainTimeout(options.drainTimeoutMs);
    this.#options = options;
  }

  shutdown(trigger: ShutdownTrigger): Promise<ShutdownResult> {
    this.#completion ??= this.#execute(trigger);
    return this.#completion;
  }

  async #execute(trigger: ShutdownTrigger): Promise<ShutdownResult> {
    this.#options.stopAdmissionAndCancel();
    const drain = this.#options.waitForDrain();

    while (true) {
      const drainedWithinGrace = await this.#waitForBoundedDrain(drain);
      if (drainedWithinGrace) break;

      const snapshot = this.#options.getDrainSnapshot();
      if (snapshot.completion_critical_operations === 0) {
        this.#options.emitIncompleteShutdown(trigger, snapshot);
        return Object.freeze({ state: "forced_noncritical", trigger });
      }

      this.#observeCompletionCriticalWait(snapshot);
      await this.#options.waitForCompletionCriticalOperationsToDrain();
    }

    await this.#closeResources();
    return Object.freeze({ state: "complete", trigger });
  }

  #observeCompletionCriticalWait(snapshot: RuntimeDrainSnapshot): void {
    try {
      this.#options.onCompletionCriticalWait?.(snapshot);
    } catch {
      // Runtime observation is non-authoritative and must never interrupt shutdown.
    }
  }

  async #waitForBoundedDrain(drain: Promise<void>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const graceExpired = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), this.#options.drainTimeoutMs);
    });
    try {
      return await Promise.race([drain.then(() => true as const), graceExpired]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async #closeResources(): Promise<void> {
    let firstError: unknown;
    try {
      await this.#options.closeMcp();
    } catch (error) {
      firstError = error;
    }
    try {
      await this.#options.closeProjects();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) throw firstError;
  }
}
