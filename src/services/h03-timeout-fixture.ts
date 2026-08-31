import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ProjectOperationContext } from "./project-operation-scheduler.js";
import { PUBLIC_ERROR_CODES, sanitizePublicText } from "./public-errors.js";
import {
  parseH03FixtureDescriptor,
  parseH05FixtureDescriptor,
  type H03FixtureDescriptor,
  type H05FixtureDescriptor,
} from "./runtime-policy.js";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type H05Command = {
  readonly callId: string;
  readonly correlationId: string;
  readonly fixtureId: string;
};
type H05Identity = H05Command & { readonly generation: number; readonly ownerToken: string };
// prettier-ignore
type H05Event = H05Identity & { readonly phase: "started" | "terminal"; readonly outcome?: "succeeded" | "failed" | "REQUEST_CANCELLED" | "OPERATION_DEADLINE_EXCEEDED" | "STALE_GENERATION"; };

/** Closed test-only lifecycle controller used by H-05 through ast_get_project_status. */
export class H05LifecycleFixtureController {
  #descriptor: H05FixtureDescriptor;
  #generationAbort = new AbortController();
  readonly #gates = new Map<string, Gate>();
  #events: H05Event[] = [];
  #active = 0;
  #abortListeners = 0;
  #staleSettlements = 0;

  // prettier-ignore
  constructor(descriptor: H05FixtureDescriptor) { if (!statSync(descriptor.controlDirectory, { throwIfNoEntry: false })?.isDirectory()) throw new Error("H-05 fixture control path must be an existing directory."); this.#descriptor = Object.freeze({ ...descriptor }); }
  // prettier-ignore
  capture(command: H05Command): H05Identity { if (Object.keys(command).sort().join(",") !== "callId,correlationId,fixtureId" || !FIXTURE_ID.test(command.callId) || !FIXTURE_ID.test(command.fixtureId) || !UUID.test(command.correlationId)) throw new Error("Invalid H-05 fixture command."); return Object.freeze({ ...command, generation: this.#descriptor.generation, ownerToken: this.#descriptor.ownerToken }); }
  // prettier-ignore
  hold(identity: H05Identity): void { this.#assertCurrent(identity); const key = this.#key(identity); if (this.#gates.has(key)) throw new Error("Invalid or duplicate H-05 fixture id."); let release!: () => void; const promise = new Promise<void>((resolve) => (release = resolve)); this.#gates.set(key, { promise, release }); }
  // prettier-ignore
  advance(descriptor: H05FixtureDescriptor): void { if (descriptor.generation <= this.#descriptor.generation) throw new Error("H-05 fixture generation must increase."); this.#descriptor = Object.freeze({ ...descriptor }); this.#generationAbort.abort(); this.#generationAbort = new AbortController(); for (const gate of this.#gates.values()) gate.release(); this.#gates.clear(); }

  // prettier-ignore
  async run<T>(identity: H05Identity, context: ProjectOperationContext, operation: (context: ProjectOperationContext) => Promise<T> | T): Promise<T> {
    this.#assertIdentity(identity);
    const eventIdentity = { callId: identity.callId, correlationId: identity.correlationId, fixtureId: identity.fixtureId, generation: identity.generation, ownerToken: identity.ownerToken };
    const generationSignal = this.#generationAbort.signal, signal = AbortSignal.any([context.signal, generationSignal]);
    const checkpoint = () => { if (!this.accepts(identity) || generationSignal.aborted) throw new H03TimeoutFixtureError(); context.checkpoint(); };
    const hooked = Object.freeze({ get sequence() { return context.sequence; }, get phase() { return context.phase; }, signal, checkpoint, markExecuting: () => context.markExecuting(), enterCompletionCritical: () => { checkpoint(); context.enterCompletionCritical(); } });
    this.#active += 1; this.#emit({ ...eventIdentity, phase: "started" });
    try { const gate = this.#gates.get(this.#key(identity)); if (gate) await this.#awaitGate(identity, gate, hooked); checkpoint(); const result = await operation(hooked); checkpoint(); this.#emit({ ...eventIdentity, phase: "terminal", outcome: "succeeded" }); return result; }
    catch (error) { const code = (error as { code?: unknown } | null)?.code, stale = !this.accepts(identity) || generationSignal.aborted, deadline = code === "OPERATION_DEADLINE_EXCEEDED", cancelled = code === "REQUEST_CANCELLED" || context.signal.aborted; if (stale) this.#staleSettlements += 1; this.#emit({ ...eventIdentity, phase: "terminal", outcome: stale ? "STALE_GENERATION" : deadline ? code : cancelled ? "REQUEST_CANCELLED" : "failed" }); if (stale) this.#staleSettlements -= 1; throw stale ? new H03TimeoutFixtureError() : error; }
    finally { this.#active -= 1; }
  }

  // prettier-ignore
  drainEvents(): readonly H05Event[] { const events = Object.freeze(this.#events); this.#events = []; return events; }
  // prettier-ignore
  snapshot() { return Object.freeze({ active: this.#active, held: this.#gates.size, abortListeners: this.#abortListeners, timers: 0, staleSettlements: this.#staleSettlements }); }
  // prettier-ignore
  async #awaitGate(identity: H05Identity, gate: Gate, context: ProjectOperationContext) { let rejectAbort!: (error: unknown) => void; const aborted = new Promise<never>((_, reject) => (rejectAbort = reject)); const abort = () => { this.#gates.delete(this.#key(identity)); try { context.checkpoint(); } catch (error) { rejectAbort(error); } }; context.signal.addEventListener("abort", abort, { once: true }); this.#abortListeners += 1; try { if (context.signal.aborted) abort(); await Promise.race([gate.promise, aborted]); } finally { context.signal.removeEventListener("abort", abort); this.#abortListeners -= 1; } }
  // prettier-ignore
  #emit(event: H05Event): void { const normalized = Object.freeze(Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) as unknown as H05Event); this.#events.push(normalized); appendFileSync(path.join(this.#descriptor.controlDirectory, "events.jsonl"), `${JSON.stringify(normalized)}\n`, { encoding: "utf8", flag: "a" }); }
  // prettier-ignore
  accepts(identity: H05Identity) { return identity.generation === this.#descriptor.generation && identity.ownerToken === this.#descriptor.ownerToken; }
  // prettier-ignore
  #assertCurrent(identity: H05Identity) { this.#assertIdentity(identity); if (!this.accepts(identity)) throw new H03TimeoutFixtureError(); }
  // prettier-ignore
  #assertIdentity(identity: H05Identity) { if (!Object.isFrozen(identity) || !FIXTURE_ID.test(identity.callId) || !FIXTURE_ID.test(identity.fixtureId) || !UUID.test(identity.correlationId)) throw new Error("Invalid H-05 lifecycle identity."); }
  // prettier-ignore
  #key(identity: H05Identity) { return `${identity.generation}:${identity.fixtureId}`; }
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

type H05FixtureCommand = H05Command & {
  readonly mode: "hold" | "pass" | "readback";
  readonly nonce: string;
  readonly ownerToken: string;
};
type H05CommandContext = {
  readonly controller: H05LifecycleFixtureController;
  readonly descriptor: H05FixtureDescriptor;
  readonly command: H05FixtureCommand;
  readonly captured: H05Identity;
};
let configuredH05Controller: H05LifecycleFixtureController | undefined;
let configuredH05Descriptor: H05FixtureDescriptor | undefined;

// Capture the closed command once before scheduler enqueue; mutable files cannot relabel it.
// prettier-ignore
export function captureConfiguredH05Command(): H05CommandContext | undefined { const raw = process.env.AST_H05_FIXTURE; if (raw === undefined) return undefined; const descriptor = parseH05FixtureDescriptor(raw); if (!descriptor) throw new Error("Invalid H-05 fixture descriptor."); if (configuredH05Descriptor) { const sameGeneration = descriptor.generation === configuredH05Descriptor.generation, sameIdentity = descriptor.controlDirectory === configuredH05Descriptor.controlDirectory && descriptor.nonce === configuredH05Descriptor.nonce && descriptor.ownerToken === configuredH05Descriptor.ownerToken; if (sameGeneration && !sameIdentity) throw new Error("H-05 fixture descriptor drift."); if (descriptor.generation < configuredH05Descriptor.generation) throw new Error("H-05 fixture generation regressed."); if (descriptor.generation > configuredH05Descriptor.generation) { configuredH05Controller?.advance({ ...configuredH05Descriptor, generation: descriptor.generation }); configuredH05Controller = undefined; configuredH05Descriptor = descriptor; const replacement = new H05LifecycleFixtureController(descriptor); configuredH05Controller = replacement; } } else { configuredH05Controller = new H05LifecycleFixtureController(descriptor); configuredH05Descriptor = descriptor; } if (!configuredH05Controller) throw new Error("H-05 fixture generation is retired."); const value = JSON.parse(readFileSync(path.join(descriptor.controlDirectory, "command.json"), "utf8")) as H05FixtureCommand; if (Object.keys(value).sort().join(",") !== "callId,correlationId,fixtureId,mode,nonce,ownerToken" || value.nonce !== descriptor.nonce || value.ownerToken !== descriptor.ownerToken || !["hold", "pass", "readback"].includes(value.mode)) throw new Error("Invalid H-05 fixture command."); const command = Object.freeze({ ...value }); const captured = configuredH05Controller.capture({ callId: command.callId, correlationId: command.correlationId, fixtureId: command.fixtureId }); return Object.freeze({ controller: configuredH05Controller, descriptor, command, captured }); }
// prettier-ignore
export async function runConfiguredH05Fixture<T>(context: ProjectOperationContext, operation: (context: ProjectOperationContext) => Promise<T> | T, configured: H05CommandContext): Promise<T> { const { controller, descriptor, command, captured } = configured; if (!controller.accepts(captured)) throw new H03TimeoutFixtureError(); if (command.mode === "readback") { const snapshot = controller.snapshot(), eventsDrained = controller.drainEvents().length; appendFileSync(path.join(descriptor.controlDirectory, "events.jsonl"), `${JSON.stringify({ ...snapshot, callId: captured.callId, correlationId: captured.correlationId, eventsDrained, fixtureId: captured.fixtureId, generation: captured.generation, phase: "readback" })}\n`); const result = await operation(context); if (!controller.accepts(captured)) throw new H03TimeoutFixtureError(); context.checkpoint(); return result; } if (command.mode === "hold") controller.hold(captured); return controller.run(captured, context, operation); }

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
const errorCommands = new WeakMap<object, H03CommandContext | H05CommandContext>();
// Compact closed test-only wiring preserves PR3's hard review budget.
// prettier-ignore
function configuredFixture(): ConfiguredFixture | undefined { const descriptor = parseH03FixtureDescriptor(process.env.AST_H03_FIXTURE); if (!descriptor) return undefined; if (!configuredController || configuredDescriptor?.generation !== descriptor.generation) { configuredDescriptor = descriptor; configuredController = new H03TimeoutFixtureController(descriptor); } return { controller: configuredController, descriptor }; }

// prettier-ignore
function readCommand(descriptor: H03FixtureDescriptor): H03FixtureCommand { const value = JSON.parse(readFileSync(path.join(descriptor.controlDirectory, "command.json"), "utf8")) as Record<string, unknown>; if (Object.keys(value).sort().join(",") !== "callId,fixtureId,mode,nonce" || typeof value.callId !== "string" || !FIXTURE_ID.test(value.callId) || typeof value.fixtureId !== "string" || !FIXTURE_ID.test(value.fixtureId) || value.nonce !== descriptor.nonce || !["hold", "pass", "readback"].includes(value.mode as string)) throw new Error("Invalid H-03 fixture command."); return value as unknown as H03FixtureCommand; }

// Capture once before scheduler enqueue; later command.json writes cannot relabel this request.
// prettier-ignore
export function captureConfiguredH03Command(): H03CommandContext | undefined { const fixture = configuredFixture(); return fixture && Object.freeze({ ...fixture, command: readCommand(fixture.descriptor) }); }
// prettier-ignore
export function bindConfiguredH03Error(error: unknown, captured: H03CommandContext | H05CommandContext | undefined): void { if (captured && typeof error === "object" && error !== null) errorCommands.set(error, captured); }
export function configuredH05CorrelationId(error: unknown): string | undefined {
  const configured =
    typeof error === "object" && error !== null ? errorCommands.get(error) : undefined;
  return configured && "captured" in configured ? configured.captured.correlationId : undefined;
}
// prettier-ignore
export async function runConfiguredH03Fixture<T>(context: ProjectOperationContext, operation: (context: ProjectOperationContext) => Promise<T> | T, captured: H03CommandContext): Promise<T> { const { controller, descriptor, command } = captured; if (command.mode === "readback") { const snapshot = controller.snapshot(), eventsDrained = controller.drainEvents().length; appendFileSync(path.join(descriptor.controlDirectory, "events.jsonl"), `${JSON.stringify({ ...snapshot, callId: command.callId, eventsDrained, fixtureId: command.fixtureId, generation: descriptor.generation, nonce: descriptor.nonce, phase: "readback" })}\n`); return operation(context); } if (command.mode === "hold") controller.hold(command.fixtureId); return controller.run(command.fixtureId, descriptor.generation, context, operation, command.callId); }

// prettier-ignore
export function emitConfiguredH03HostEvent(phase: "recycled", generation: number): void { const descriptor = parseH03FixtureDescriptor(process.env.AST_H03_FIXTURE); if (!descriptor) return; appendFileSync(path.join(descriptor.controlDirectory, "events.jsonl"), `${JSON.stringify({ fixtureId: "host", generation, nonce: descriptor.nonce, phase })}\n`, { encoding: "utf8", flag: "a" }); }

// prettier-ignore
export function emitConfiguredH03ErrorEvidence(text: string, error: unknown): void { const configured = typeof error === "object" && error !== null ? errorCommands.get(error) : undefined; if (!configured) return; const { descriptor, command } = configured; if (!("captured" in configured)) { appendFileSync(path.join(descriptor.controlDirectory, "events.jsonl"), `${JSON.stringify({ callId: command.callId, fixtureId: command.fixtureId, generation: descriptor.generation, nonce: descriptor.nonce, phase: "error", result: { isError: true, error: { info: { name: error instanceof Error ? error.name : "Error" }, message: text } } })}\n`); return; } const { controller, captured } = configured; if (!controller.accepts(captured)) return; let publicError: unknown; try { publicError = JSON.parse(text); } catch { publicError = undefined; } const source = (publicError as { error?: Record<string, unknown> } | undefined)?.error, code = typeof source?.code === "string" && PUBLIC_ERROR_CODES.some((value) => value === source.code) ? source.code : "INTERNAL_ERROR", correlation_id = typeof source?.correlation_id === "string" && UUID.test(source.correlation_id) ? source.correlation_id : captured.correlationId, name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "Error", message = typeof source?.message === "string" ? sanitizePublicText(source.message) : "An internal error occurred."; const identity = { callId: captured.callId, correlationId: captured.correlationId, fixtureId: captured.fixtureId, generation: captured.generation, ownerToken: captured.ownerToken, phase: "error", resources: controller.snapshot(), result: { isError: true, error: { code, message, correlation_id, info: { name } } } }; let serialized = JSON.stringify(identity); if (Buffer.byteLength(serialized) > 4096) serialized = JSON.stringify({ ...identity, result: { ...identity.result, error: { ...identity.result.error, message: "Evidence message omitted: bounded record exceeded." } } }); appendFileSync(path.join(descriptor.controlDirectory, "events.jsonl"), `${serialized}\n`); }
