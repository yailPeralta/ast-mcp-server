export type RuntimeActivityAdmission = "open" | "closed";

export interface RuntimeActivitySnapshot {
  readonly admission: RuntimeActivityAdmission;
  readonly active_requests: number;
  readonly active_sends: number;
}

export class RuntimeActivityTracker {
  #admission: RuntimeActivityAdmission = "open";
  #activeRequests = 0;
  #activeSends = 0;
  readonly #idleWaiters = new Set<() => void>();
  #idleCheck: ReturnType<typeof setImmediate> | undefined;

  get admission(): RuntimeActivityAdmission {
    return this.#admission;
  }

  prepareForStartup(): void {
    if (this.#activeRequests !== 0 || this.#activeSends !== 0 || this.#idleWaiters.size !== 0) {
      throw new Error("Cannot start runtime activity tracking while work remains active.");
    }
    this.#admission = "open";
  }

  beginShutdown(): void {
    this.#admission = "closed";
  }

  async trackRequest<T>(callback: () => Promise<T> | T): Promise<T> {
    this.#activeRequests += 1;
    try {
      return await callback();
    } finally {
      this.#activeRequests -= 1;
      this.#scheduleIdleCheck();
    }
  }

  async trackSend<T>(callback: () => Promise<T>): Promise<T> {
    this.#activeSends += 1;
    try {
      return await callback();
    } finally {
      this.#activeSends -= 1;
      this.#scheduleIdleCheck();
    }
  }

  waitForIdle(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#idleWaiters.add(resolve);
      this.#scheduleIdleCheck();
    });
  }

  snapshot(): RuntimeActivitySnapshot {
    return Object.freeze({
      admission: this.#admission,
      active_requests: this.#activeRequests,
      active_sends: this.#activeSends,
    });
  }

  #scheduleIdleCheck(): void {
    if (this.#idleWaiters.size === 0 || this.#idleCheck !== undefined) return;
    this.#idleCheck = setImmediate(() => {
      this.#idleCheck = undefined;
      if (this.#activeRequests !== 0 || this.#activeSends !== 0) return;
      const waiters = [...this.#idleWaiters];
      this.#idleWaiters.clear();
      for (const resolve of waiters) resolve();
    });
  }
}
