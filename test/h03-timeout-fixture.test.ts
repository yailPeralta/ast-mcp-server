import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// prettier-ignore
import { bindConfiguredH03Error, captureConfiguredH03Command, emitConfiguredH03ErrorEvidence, H03TimeoutFixtureController } from "../src/services/h03-timeout-fixture.js";
import { ProjectOperationScheduler } from "../src/services/project-operation-scheduler.js";
import {
  createCompilerWorkerSpawnSpec,
  parseH03FixtureDescriptor,
} from "../src/services/runtime-policy.js";

const controlDirectory = mkdtempSync(path.join(tmpdir(), "ast-h03-"));
afterAll(() => rmSync(controlDirectory, { recursive: true, force: true }));
const descriptor = { controlDirectory, nonce: "n-0123456789abcdef", generation: 1 } as const;

function harness() {
  const scheduler = new ProjectOperationScheduler({
    queueCapacity: 4,
    queueWaitTimeoutMs: 30_000,
    operationDeadlineMs: 120_000,
  });
  const controller = new H03TimeoutFixtureController(descriptor);
  const run = <T>(
    id: string,
    operation: Parameters<typeof controller.run<T>>[3],
    signal?: AbortSignal,
    generation = 1,
  ) =>
    scheduler.run(
      (context) => {
        context.markExecuting();
        return controller.run(id, generation, context, operation);
      },
      { signal },
    );
  return { controller, run, scheduler };
}

describe("H-03 timeout fixture seam", () => {
  it("keeps parsing pure and validates the control directory when consumed", () => {
    const valid = JSON.stringify(descriptor);
    expect(parseH03FixtureDescriptor(valid)).toEqual(descriptor);
    expect(
      () =>
        new H03TimeoutFixtureController({
          ...descriptor,
          controlDirectory: path.join(controlDirectory, "missing"),
        }),
    ).toThrow(/directory/i);
    for (const raw of [
      JSON.stringify({ ...descriptor, controlDirectory: "relative" }),
      JSON.stringify({ ...descriptor, nonce: "shell payload" }),
      JSON.stringify({ ...descriptor, payload: "arbitrary" }),
    ]) {
      expect(parseH03FixtureDescriptor(raw)).toBeUndefined();
    }
    expect(
      createCompilerWorkerSpawnSpec("/app/worker.js", { AST_H03_FIXTURE: valid }),
    ).toMatchObject({ options: { shell: false, env: { AST_H03_FIXTURE: valid } } });
    expect(
      createCompilerWorkerSpawnSpec("/app/worker.js", { AST_H03_FIXTURE: "{}" }),
    ).toMatchObject({ ok: false, reason: "invalid_environment" });
  });

  // prettier-ignore
  it("binds queued error evidence to immutable pre-enqueue context without a start", () => { const prior = process.env.AST_H03_FIXTURE; process.env.AST_H03_FIXTURE = JSON.stringify(descriptor); const commandPath = path.join(controlDirectory, "command.json"); writeFileSync(commandPath, JSON.stringify({ callId: "old-call", fixtureId: "old", mode: "hold", nonce: descriptor.nonce })); const captured = captureConfiguredH03Command(); writeFileSync(commandPath, JSON.stringify({ callId: "new-call", fixtureId: "new", mode: "hold", nonce: descriptor.nonce })); const error = new Error("deadline"); bindConfiguredH03Error(error, captured); emitConfiguredH03ErrorEvidence('{"error":{}}', error); const evidence = readFileSync(path.join(controlDirectory, "events.jsonl"), "utf8"); expect(evidence).toContain('"callId":"old-call","fixtureId":"old","generation":1'); expect(evidence).not.toContain('"callId":"old-call","fixtureId":"old","generation":1,"nonce":"n-0123456789abcdef","phase":"started"'); expect(evidence).not.toContain('"callId":"new-call"'); if (prior === undefined) delete process.env.AST_H03_FIXTURE; else process.env.AST_H03_FIXTURE = prior; });

  it("aborts active work on recycle and rejects ignored post-await completion", async () => {
    const { controller, run } = harness();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const pending = run("recycle", (context) => {
      entered();
      return new Promise<string>((resolve) =>
        context.signal.addEventListener("abort", () => resolve("stale"), { once: true }),
      );
    });
    await started;
    controller.advanceGeneration(2);
    await expect(pending).rejects.toMatchObject({ code: "STALE_GENERATION" });
    expect(controller.snapshot()).toMatchObject({ active: 0, staleSettlements: 1 });
  });

  it("isolates same-id gates by generation", async () => {
    const { controller, run } = harness();
    controller.hold("same");
    const old = run("same", () => "old");
    await Promise.resolve();
    controller.advanceGeneration(2);
    controller.hold("same");
    const newRun = run("same", () => "new", undefined, 2);
    await expect(old).rejects.toMatchObject({ code: "STALE_GENERATION" });
    expect(controller.release("same", 1)).toBe(false);
    expect(controller.release("same", 2)).toBe(true);
    await expect(newRun).resolves.toBe("new");
    expect(controller.snapshot()).toMatchObject({ active: 0, held: 0, abortListeners: 0 });
  });

  it("rejects invalid ids, drains events, and never starts cancelled queue work", async () => {
    const { controller, run, scheduler } = harness();
    expect(() => controller.hold("../bad")).toThrow(/fixture id/i);
    controller.hold("blocker");
    const activeAbort = new AbortController();
    const blocker = run("blocker", () => "no", activeAbort.signal);
    const queuedAbort = new AbortController();
    const queued = run("queued", () => "no", queuedAbort.signal);
    await Promise.resolve();
    queuedAbort.abort();
    await expect(queued).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(controller.drainEvents()).toEqual([
      expect.objectContaining({ fixtureId: "blocker", nonce: descriptor.nonce, phase: "started" }),
    ]);
    expect(controller.drainEvents()).toEqual([]);
    expect(scheduler.snapshot()).toMatchObject({ queued_operations: 0, queue_abort_listeners: 0 });
    activeAbort.abort();
    await expect(blocker).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  });
});
