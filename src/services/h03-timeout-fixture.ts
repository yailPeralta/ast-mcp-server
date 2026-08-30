import { statSync } from "node:fs";
import type { ProjectOperationContext } from "./project-operation-scheduler.js";
import type { H03FixtureDescriptor } from "./runtime-policy.js";

const FIXTURE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export interface H03FixtureEvent {
  readonly fixtureId: string;
  readonly generation: number;
  readonly nonce: string;
  readonly phase: "started" | "terminal" | "stale";
}
export interface H03FixtureHook {
  run<T>(
    fixtureId: string,
    generation: number,
    admittedContext: ProjectOperationContext,
    operation: (context: ProjectOperationContext) => Promise<T> | T,
  ): Promise<T>;
}

export class H03TimeoutFixtureError extends Error {
  readonly name = "H03TimeoutFixtureError";
  readonly code = "STALE_GENERATION";
}

interface Gate {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

export class H03TimeoutFixtureController implements H03FixtureHook {
  readonly #descriptor: H03FixtureDescriptor;
  readonly #gates = new Map<string, Gate>();
  #events: H03FixtureEvent[] = [];
  #generation: number;
  #generationAbort = new AbortController();
  #active = 0;
  #abortListeners = 0;
  #staleSettlements = 0;

  constructor(descriptor: H03FixtureDescriptor) {
    const directory = statSync(descriptor.controlDirectory, { throwIfNoEntry: false });
    if (!directory?.isDirectory())
      throw new Error("H-03 fixture control path must be an existing directory.");
    this.#descriptor = descriptor;
    this.#generation = descriptor.generation;
  }

  hold(fixtureId: string): void {
    this.#assertId(fixtureId);
    const key = this.#key(fixtureId, this.#generation);
    if (this.#gates.has(key)) throw new Error("Invalid or duplicate H-03 fixture id.");
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    this.#gates.set(key, { promise, release });
  }

  release(fixtureId: string, generation: number): boolean {
    if (!FIXTURE_ID.test(fixtureId) || generation !== this.#generation) return false;
    const key = this.#key(fixtureId, generation);
    const gate = this.#gates.get(key);
    if (!gate) return false;
    this.#gates.delete(key);
    gate.release();
    return true;
  }

  advanceGeneration(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation <= this.#generation)
      throw new Error("H-03 fixture generation must increase.");
    this.#generation = generation;
    this.#generationAbort.abort();
    this.#generationAbort = new AbortController();
    for (const gate of this.#gates.values()) gate.release();
    this.#gates.clear();
  }

  async run<T>(
    fixtureId: string,
    generation: number,
    context: ProjectOperationContext,
    operation: (context: ProjectOperationContext) => Promise<T> | T,
  ): Promise<T> {
    this.#assertId(fixtureId);
    if (generation !== this.#generation) return this.#stale(fixtureId, generation);
    const generationSignal = this.#generationAbort.signal;
    const signal = AbortSignal.any([context.signal, generationSignal]);
    const hooked = this.#context(context, signal, generationSignal, fixtureId, generation);
    this.#active += 1;
    this.#emit({ fixtureId, generation, nonce: this.#descriptor.nonce, phase: "started" });
    try {
      const gate = this.#gates.get(this.#key(fixtureId, generation));
      if (gate) await this.#awaitGate(this.#key(fixtureId, generation), gate, hooked);
      hooked.checkpoint();
      const result = await operation(hooked);
      hooked.checkpoint();
      return result;
    } finally {
      this.#active -= 1;
      this.#emit({ fixtureId, generation, nonce: this.#descriptor.nonce, phase: "terminal" });
    }
  }

  drainEvents(): readonly H03FixtureEvent[] {
    const events = Object.freeze(this.#events);
    this.#events = [];
    return events;
  }

  snapshot() {
    return Object.freeze({
      active: this.#active,
      held: this.#gates.size,
      abortListeners: this.#abortListeners,
      staleSettlements: this.#staleSettlements,
    });
  }

  #context(
    context: ProjectOperationContext,
    signal: AbortSignal,
    generationSignal: AbortSignal,
    fixtureId: string,
    generation: number,
  ): ProjectOperationContext {
    const checkpoint = () => {
      if (generationSignal.aborted || generation !== this.#generation)
        this.#stale(fixtureId, generation);
      context.checkpoint();
    };
    return {
      get sequence() {
        return context.sequence;
      },
      get phase() {
        return context.phase;
      },
      signal,
      checkpoint,
      markExecuting: () => context.markExecuting(),
      enterCompletionCritical: () => {
        checkpoint();
        context.enterCompletionCritical();
      },
    };
  }

  async #awaitGate(key: string, gate: Gate, context: ProjectOperationContext): Promise<void> {
    let rejectAbort!: (error: unknown) => void;
    const aborted = new Promise<never>((_, reject) => (rejectAbort = reject));
    const abort = () => {
      if (this.#gates.get(key) === gate) this.#gates.delete(key);
      try {
        context.checkpoint();
      } catch (error) {
        rejectAbort(error);
      }
    };
    context.signal.addEventListener("abort", abort, { once: true });
    this.#abortListeners += 1;
    try {
      if (context.signal.aborted) abort();
      await Promise.race([gate.promise, aborted]);
    } finally {
      context.signal.removeEventListener("abort", abort);
      this.#abortListeners -= 1;
    }
  }

  #stale(fixtureId: string, generation: number): never {
    this.#staleSettlements += 1;
    this.#emit({ fixtureId, generation, nonce: this.#descriptor.nonce, phase: "stale" });
    throw new H03TimeoutFixtureError();
  }

  #emit(event: H03FixtureEvent): void {
    this.#events.push(Object.freeze(event));
  }

  #assertId(fixtureId: string): void {
    if (!FIXTURE_ID.test(fixtureId)) throw new Error("Invalid H-03 fixture id.");
  }

  #key(fixtureId: string, generation: number): string {
    return `${generation}:${fixtureId}`;
  }
}
