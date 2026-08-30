import { appendFileSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ProjectOperationContext } from "./project-operation-scheduler.js";
import { parseH03FixtureDescriptor, type H03FixtureDescriptor } from "./runtime-policy.js";

const FIXTURE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export interface H03FixtureEvent {
  readonly fixtureId: string;
  readonly callId: string;
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
    callId?: string,
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
    callId = fixtureId,
  ): Promise<T> {
    this.#assertId(fixtureId);
    this.#assertId(callId);
    if (generation !== this.#generation) return this.#stale(fixtureId, generation, callId);
    const generationSignal = this.#generationAbort.signal;
    const signal = AbortSignal.any([context.signal, generationSignal]);
    const hooked = this.#context(context, signal, generationSignal, fixtureId, generation, callId);
    this.#active += 1;
    this.#emit({ callId, fixtureId, generation, nonce: this.#descriptor.nonce, phase: "started" });
    try {
      const gate = this.#gates.get(this.#key(fixtureId, generation));
      if (gate) await this.#awaitGate(this.#key(fixtureId, generation), gate, hooked);
      hooked.checkpoint();
      const result = await operation(hooked);
      hooked.checkpoint();
      return result;
    } finally {
      this.#active -= 1;
      this.#emit({
        callId,
        fixtureId,
        generation,
        nonce: this.#descriptor.nonce,
        phase: "terminal",
      });
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
    callId: string,
  ): ProjectOperationContext {
    const checkpoint = () => {
      if (generationSignal.aborted || generation !== this.#generation)
        this.#stale(fixtureId, generation, callId);
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

  #stale(fixtureId: string, generation: number, callId: string): never {
    this.#staleSettlements += 1;
    this.#emit({ callId, fixtureId, generation, nonce: this.#descriptor.nonce, phase: "stale" });
    throw new H03TimeoutFixtureError();
  }

  #emit(event: H03FixtureEvent): void {
    this.#events.push(Object.freeze(event));
    appendFileSync(
      path.join(this.#descriptor.controlDirectory, "events.jsonl"),
      `${JSON.stringify(event)}\n`,
      { encoding: "utf8", flag: "a" },
    );
  }

  #assertId(fixtureId: string): void {
    if (!FIXTURE_ID.test(fixtureId)) throw new Error("Invalid H-03 fixture id.");
  }

  #key(fixtureId: string, generation: number): string {
    return `${generation}:${fixtureId}`;
  }
}

interface H03FixtureCommand {
  readonly callId: string;
  readonly fixtureId: string;
  readonly nonce: string;
  readonly mode: "hold" | "pass" | "readback";
}

let configuredController: H03TimeoutFixtureController | undefined;
let configuredDescriptor: H03FixtureDescriptor | undefined;

// prettier-ignore
type ConfiguredFixture = { readonly controller: H03TimeoutFixtureController; readonly descriptor: H03FixtureDescriptor };
export type H03CommandContext = ConfiguredFixture & { readonly command: H03FixtureCommand };
const errorCommands = new WeakMap<object, H03CommandContext>();
// Compact closed test-only wiring preserves PR3's hard review budget.
// prettier-ignore
function configuredFixture(): ConfiguredFixture | undefined { const descriptor = parseH03FixtureDescriptor(process.env.AST_H03_FIXTURE); if (!descriptor) return undefined; if (!configuredController || configuredDescriptor?.generation !== descriptor.generation) { configuredDescriptor = descriptor; configuredController = new H03TimeoutFixtureController(descriptor); } return { controller: configuredController, descriptor }; }

// prettier-ignore
function readCommand(descriptor: H03FixtureDescriptor): H03FixtureCommand { const value = JSON.parse(readFileSync(path.join(descriptor.controlDirectory, "command.json"), "utf8")) as Record<string, unknown>; if (Object.keys(value).sort().join(",") !== "callId,fixtureId,mode,nonce" || typeof value.callId !== "string" || !FIXTURE_ID.test(value.callId) || typeof value.fixtureId !== "string" || !FIXTURE_ID.test(value.fixtureId) || value.nonce !== descriptor.nonce || !["hold", "pass", "readback"].includes(value.mode as string)) throw new Error("Invalid H-03 fixture command."); return value as unknown as H03FixtureCommand; }

// Capture once before scheduler enqueue; later command.json writes cannot relabel this request.
// prettier-ignore
export function captureConfiguredH03Command(): H03CommandContext | undefined { const fixture = configuredFixture(); return fixture && Object.freeze({ ...fixture, command: readCommand(fixture.descriptor) }); }
// prettier-ignore
export function bindConfiguredH03Error(error: unknown, captured: H03CommandContext | undefined): void { if (captured && typeof error === "object" && error !== null) errorCommands.set(error, captured); }
// prettier-ignore
export async function runConfiguredH03Fixture<T>(context: ProjectOperationContext, operation: (context: ProjectOperationContext) => Promise<T> | T, captured: H03CommandContext): Promise<T> { const { controller, descriptor, command } = captured; if (command.mode === "readback") { const snapshot = controller.snapshot(), eventsDrained = controller.drainEvents().length; appendFileSync(path.join(descriptor.controlDirectory, "events.jsonl"), `${JSON.stringify({ ...snapshot, callId: command.callId, eventsDrained, fixtureId: command.fixtureId, generation: descriptor.generation, nonce: descriptor.nonce, phase: "readback" })}\n`); return operation(context); } if (command.mode === "hold") controller.hold(command.fixtureId); return controller.run(command.fixtureId, descriptor.generation, context, operation, command.callId); }

// prettier-ignore
export function emitConfiguredH03HostEvent(phase: "recycled", generation: number): void { const descriptor = parseH03FixtureDescriptor(process.env.AST_H03_FIXTURE); if (!descriptor) return; appendFileSync(path.join(descriptor.controlDirectory, "events.jsonl"), `${JSON.stringify({ fixtureId: "host", generation, nonce: descriptor.nonce, phase })}\n`, { encoding: "utf8", flag: "a" }); }

// prettier-ignore
export function emitConfiguredH03ErrorEvidence(text: string, error: unknown): void { const captured = typeof error === "object" && error !== null ? errorCommands.get(error) : undefined; if (!captured) return; const { descriptor, command } = captured; appendFileSync(path.join(descriptor.controlDirectory, "events.jsonl"), `${JSON.stringify({ callId: command.callId, fixtureId: command.fixtureId, generation: descriptor.generation, nonce: descriptor.nonce, phase: "error", result: { isError: true, error: { info: { name: error instanceof Error ? error.name : "Error" }, message: text } } })}\n`); }
