import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  bindConfiguredH03Error,
  captureConfiguredH05Command,
  emitConfiguredH03ErrorEvidence,
  H05LifecycleFixtureController,
  runConfiguredH05Fixture,
} from "../src/services/h03-timeout-fixture.js";
import { ProjectOperationScheduler } from "../src/services/project-operation-scheduler.js";
import { parseH05FixtureDescriptor } from "../src/services/runtime-policy.js";

const controlDirectory = mkdtempSync(path.join(tmpdir(), "ast-h05-"));
afterAll(() => rmSync(controlDirectory, { recursive: true, force: true }));
const descriptor = {
  controlDirectory,
  generation: 7,
  nonce: "n-0123456789abcdef",
  ownerToken: "owner-0123456789abcdef",
} as const;
const command = {
  callId: "call-1",
  correlationId: "123e4567-e89b-42d3-a456-426614174000",
  fixtureId: "held-1",
} as const;

// prettier-ignore
function harness() { const scheduler = new ProjectOperationScheduler({ queueCapacity: 4, queueWaitTimeoutMs: 30_000, operationDeadlineMs: 120_000 }); const controller = new H05LifecycleFixtureController(descriptor); const run = <T>(captured: ReturnType<typeof controller.capture>, operation: Parameters<typeof controller.run<T>>[2], signal?: AbortSignal) => scheduler.run((context) => { context.markExecuting(); return controller.run(captured, context, operation); }, { signal }); return { controller, run, scheduler }; }

describe("H-05 private lifecycle fixture seam", () => {
  it("parses only the closed lifecycle descriptor and captures immutable ownership", () => {
    expect(parseH05FixtureDescriptor(JSON.stringify(descriptor))).toEqual(descriptor);
    for (const value of [
      { ...descriptor, ownerToken: "bad token" },
      { ...descriptor, correlationId: command.correlationId },
      { ...descriptor, generation: 0 },
    ])
      expect(parseH05FixtureDescriptor(JSON.stringify(value))).toBeUndefined();
    const prior = process.env.AST_H05_FIXTURE;
    process.env.AST_H05_FIXTURE = "{}";
    expect(() => captureConfiguredH05Command()).toThrow(/descriptor/i);
    if (prior === undefined) delete process.env.AST_H05_FIXTURE;
    else process.env.AST_H05_FIXTURE = prior;
    const controller = new H05LifecycleFixtureController(descriptor);
    const mutable: { callId: string; correlationId: string; fixtureId: string } = { ...command };
    const captured = controller.capture(mutable);
    mutable.callId = "relabelled";
    mutable.correlationId = "123e4567-e89b-42d3-a456-426614174999";
    mutable.fixtureId = "relabelled";
    expect(captured).toEqual({ ...command, generation: 7, ownerToken: descriptor.ownerToken });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Reflect.set(captured, "generation", 99)).toBe(false);
    expect(Reflect.set(captured, "ownerToken", "owner-fedcba9876543210")).toBe(false);
  });

  // prettier-ignore
  it("keeps queued pre-enqueue identity and reports zero readback counters", async () => { const prior = process.env.AST_H05_FIXTURE, commandPath = path.join(controlDirectory, "command.json"); process.env.AST_H05_FIXTURE = JSON.stringify(descriptor); writeFileSync(commandPath, JSON.stringify({ ...command, mode: "readback", nonce: descriptor.nonce, ownerToken: descriptor.ownerToken })); const captured = captureConfiguredH05Command()!, scheduler = new ProjectOperationScheduler({ queueCapacity: 1, queueWaitTimeoutMs: 30_000, operationDeadlineMs: 120_000 }); let release!: () => void; const gate = new Promise<void>((resolve) => (release = resolve)), blocker = scheduler.run(async (context) => { context.markExecuting(); await gate; }); await Promise.resolve(); const queued = scheduler.run((context) => runConfiguredH05Fixture(context, () => "ok", captured)); writeFileSync(commandPath, JSON.stringify({ ...command, callId: "relabelled", mode: "readback", nonce: descriptor.nonce, ownerToken: descriptor.ownerToken })); release(); await blocker; await queued; const readback = JSON.parse(readFileSync(path.join(controlDirectory, "events.jsonl"), "utf8").trim().split("\n").at(-1)!) as Record<string, unknown>; expect(readback).toMatchObject({ abortListeners: 0, active: 0, callId: command.callId, eventsDrained: 0, held: 0, staleSettlements: 0, timers: 0 }); if (prior === undefined) delete process.env.AST_H05_FIXTURE; else process.env.AST_H05_FIXTURE = prior; });

  it("emits exactly one bounded sanitized terminal when a held call is cancelled", async () => {
    const { controller, run, scheduler } = harness();
    const captured = controller.capture(command);
    controller.hold(captured);
    const abort = new AbortController();
    const pending = run(captured, () => "unreachable", abort.signal);
    await Promise.resolve();
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    const events = controller.drainEvents();
    expect(events.filter(({ phase }) => phase === "terminal")).toEqual([
      expect.objectContaining({ ...command, generation: 7, outcome: "REQUEST_CANCELLED" }),
    ]);
    const encoded = JSON.stringify(events);
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(4096);
    expect(encoded).not.toContain(descriptor.ownerToken);
    expect(encoded).not.toContain(descriptor.nonce);
    expect(scheduler.snapshot()).toMatchObject({
      active_operations: 0,
      queued_operations: 0,
      queue_abort_listeners: 0,
      queue_timers: 0,
      execution_abort_listeners: 0,
      execution_timers: 0,
    });
    expect(controller.snapshot()).toEqual({
      active: 0,
      held: 0,
      abortListeners: 0,
      timers: 0,
      staleSettlements: 0,
    });
  });

  // prettier-ignore
  it("preserves failures and prioritizes an actual deadline over its aborted signal", async () => { const ordinary = harness(), failure = new Error("ordinary failure"); await expect(ordinary.run(ordinary.controller.capture(command), () => { throw failure; })).rejects.toBe(failure); expect(ordinary.controller.drainEvents().at(-1)).toMatchObject({ outcome: "failed" }); let now = 0, aborted = false; const controller = new H05LifecycleFixtureController(descriptor), scheduler = new ProjectOperationScheduler({ queueCapacity: 1, queueWaitTimeoutMs: 30_000, operationDeadlineMs: 1_000, now: () => now }); const pending = scheduler.run((context) => { context.markExecuting(); return controller.run(controller.capture(command), context, (hooked) => { now = 1_000; try { hooked.checkpoint(); } catch (error) { aborted = hooked.signal.aborted; throw error; } }); }); await expect(pending).rejects.toMatchObject({ code: "OPERATION_DEADLINE_EXCEEDED" }); expect(aborted).toBe(true); expect(controller.drainEvents().at(-1)).toMatchObject({ outcome: "OPERATION_DEADLINE_EXCEEDED" }); });

  // prettier-ignore
  it("retires held work before a fallible configured rollover", async () => { const prior = process.env.AST_H05_FIXTURE, commandPath = path.join(controlDirectory, "command.json"); process.env.AST_H05_FIXTURE = JSON.stringify(descriptor); writeFileSync(commandPath, JSON.stringify({ ...command, mode: "hold", nonce: descriptor.nonce, ownerToken: descriptor.ownerToken })); const configured = captureConfiguredH05Command()!, scheduler = new ProjectOperationScheduler({ queueCapacity: 1, queueWaitTimeoutMs: 30_000, operationDeadlineMs: 120_000 }), abort = new AbortController(); const pending = scheduler.run((context) => runConfiguredH05Fixture(context, () => "late-success", configured), { signal: abort.signal }); await Promise.resolve(); for (const drift of [{ ownerToken: "owner-fedcba9876543210" }, { nonce: "n-fedcba9876543210" }, { controlDirectory: path.join(controlDirectory, "other") }]) { process.env.AST_H05_FIXTURE = JSON.stringify({ ...descriptor, ...drift }); expect(() => captureConfiguredH05Command()).toThrow(/drift/i); } process.env.AST_H05_FIXTURE = JSON.stringify({ ...descriptor, controlDirectory: path.join(controlDirectory, "missing"), generation: 8 }); expect(() => captureConfiguredH05Command()).toThrow(/existing directory/i); const outcome = pending.then(() => "late-success", (error: { code?: string }) => error.code), settled = await Promise.race([outcome, new Promise<string>((resolve) => setTimeout(() => resolve("still-active"), 10))]); if (settled === "still-active") abort.abort(); await pending.catch(() => undefined); expect(settled).toBe("STALE_GENERATION"); expect(configured.controller.drainEvents().filter(({ phase }) => phase === "terminal")).toEqual([expect.objectContaining({ outcome: "STALE_GENERATION" })]); if (prior === undefined) delete process.env.AST_H05_FIXTURE; else process.env.AST_H05_FIXTURE = prior; });

  // prettier-ignore
  it("keeps a failed replacement generation as a monotonic tombstone", async () => { vi.resetModules(); const { captureConfiguredH05Command: freshCapture } = await import("../src/services/h03-timeout-fixture.js"); const prior = process.env.AST_H05_FIXTURE, commandPath = path.join(controlDirectory, "command.json"); writeFileSync(commandPath, JSON.stringify({ ...command, mode: "pass", nonce: descriptor.nonce, ownerToken: descriptor.ownerToken })); let successes = 0; const admit = () => { const value = freshCapture(); successes += 1; return value; }; process.env.AST_H05_FIXTURE = JSON.stringify(descriptor); expect(admit()?.descriptor.generation).toBe(7); process.env.AST_H05_FIXTURE = JSON.stringify({ ...descriptor, controlDirectory: path.join(controlDirectory, "missing"), generation: 8 }); expect(admit).toThrow(/existing directory/i); for (const generation of [7, 8]) { process.env.AST_H05_FIXTURE = JSON.stringify({ ...descriptor, generation }); expect(admit).toThrow(/regressed|drift/i); } process.env.AST_H05_FIXTURE = JSON.stringify({ ...descriptor, generation: 9 }); expect(admit()?.descriptor.generation).toBe(9); expect(successes).toBe(2); if (prior === undefined) delete process.env.AST_H05_FIXTURE; else process.env.AST_H05_FIXTURE = prior; });

  // prettier-ignore
  it("rejects a readback that rolls over while its operation is awaited", async () => { const prior = process.env.AST_H05_FIXTURE, commandPath = path.join(controlDirectory, "command.json"), generation = 20; process.env.AST_H05_FIXTURE = JSON.stringify({ ...descriptor, generation }); writeFileSync(commandPath, JSON.stringify({ ...command, mode: "readback", nonce: descriptor.nonce, ownerToken: descriptor.ownerToken })); const configured = captureConfiguredH05Command()!; let settle!: () => void; const pending = runConfiguredH05Fixture({ checkpoint() {} } as never, () => new Promise<string>((resolve) => (settle = () => resolve("stale-readback"))), configured); await Promise.resolve(); process.env.AST_H05_FIXTURE = JSON.stringify({ ...descriptor, generation: generation + 1 }); writeFileSync(commandPath, JSON.stringify({ ...command, callId: "call-2", mode: "pass", nonce: descriptor.nonce, ownerToken: descriptor.ownerToken })); captureConfiguredH05Command(); settle(); await expect(pending).rejects.toMatchObject({ code: "STALE_GENERATION" }); if (prior === undefined) delete process.env.AST_H05_FIXTURE; else process.env.AST_H05_FIXTURE = prior; });

  // prettier-ignore
  it("bounds and sanitizes H-05 error evidence while suppressing retired effects", async () => { const prior = process.env.AST_H05_FIXTURE, commandPath = path.join(controlDirectory, "command.json"); process.env.AST_H05_FIXTURE = JSON.stringify({ ...descriptor, generation: 22 }); writeFileSync(commandPath, JSON.stringify({ ...command, mode: "pass", nonce: descriptor.nonce, ownerToken: descriptor.ownerToken })); const configured = captureConfiguredH05Command()!, error = Object.assign(new Error("failure"), { name: "Bad /secret/path token=abc", code: "BAD /secret/path token=abc" }); bindConfiguredH03Error(error, configured); emitConfiguredH03ErrorEvidence(JSON.stringify({ error: { code: "ARBITRARY_UPPERCASE", message: "Authorization: Bearer abc; api-key=xyz token=abc /secret/path", correlation_id: command.correlationId } }), error); const sanitized = readFileSync(path.join(controlDirectory, "events.jsonl"), "utf8").split("\n").at(-2)!; expect(JSON.parse(sanitized)).toMatchObject({ result: { error: { code: "INTERNAL_ERROR" } } }); expect(sanitized).not.toMatch(/ARBITRARY_UPPERCASE|Bearer abc|api-key=xyz|secret|token=abc/); emitConfiguredH03ErrorEvidence(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "x".repeat(5000), correlation_id: command.correlationId } }), error); const record = readFileSync(path.join(controlDirectory, "events.jsonl"), "utf8").trim().split("\n").at(-1)!; expect(Buffer.byteLength(record)).toBeLessThanOrEqual(4096); expect(JSON.parse(record)).toMatchObject({ result: { error: { code: "INTERNAL_ERROR", info: { name: "Error" } } } }); expect(Object.keys(JSON.parse(record).result.error)).toEqual(["code", "message", "correlation_id", "info"]); expect(record).not.toMatch(/secret|token=abc/); process.env.AST_H05_FIXTURE = JSON.stringify({ ...descriptor, generation: 23 }); writeFileSync(commandPath, JSON.stringify({ ...command, mode: "readback", nonce: descriptor.nonce, ownerToken: descriptor.ownerToken })); captureConfiguredH05Command(); const before = readFileSync(path.join(controlDirectory, "events.jsonl"), "utf8"); emitConfiguredH03ErrorEvidence("{}", error); await expect(runConfiguredH05Fixture({} as never, () => "no", configured)).rejects.toMatchObject({ code: "STALE_GENERATION" }); expect(readFileSync(path.join(controlDirectory, "events.jsonl"), "utf8")).toBe(before); if (prior === undefined) delete process.env.AST_H05_FIXTURE; else process.env.AST_H05_FIXTURE = prior; });

  it("rejects retired and post-await stale effects while a fresh owner can publish", async () => {
    const { controller, run } = harness();
    const retired = controller.capture(command);
    let settle!: (value: string) => void;
    const pending = run(retired, () => new Promise<string>((resolve) => (settle = resolve)));
    await Promise.resolve();
    controller.advance({ ...descriptor, generation: 8, ownerToken: "owner-fedcba9876543210" });
    settle("late-success");
    await expect(pending).rejects.toMatchObject({ code: "STALE_GENERATION" });
    const fresh = controller.capture({ ...command, callId: "call-2", fixtureId: "fresh-2" });
    await expect(run(fresh, () => "fresh-success")).resolves.toBe("fresh-success");
    const events = controller.drainEvents();
    expect(events).not.toContainEqual(expect.objectContaining({ outcome: "late-success" }));
    expect(events.filter(({ phase }) => phase === "terminal")).toEqual([
      expect.objectContaining({ callId: "call-1", outcome: "STALE_GENERATION" }),
      expect.objectContaining({ callId: "call-2", generation: 8, outcome: "succeeded" }),
    ]);
    expect(controller.snapshot()).toEqual({
      active: 0,
      held: 0,
      abortListeners: 0,
      timers: 0,
      staleSettlements: 0,
    });
  });
});
