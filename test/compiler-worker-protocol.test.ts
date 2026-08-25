import { describe, expect, it, vi } from "vitest";
import {
  decodeCompilerWorkerEnvelope,
  startCompilerWorker,
  validateInitializationReplay,
} from "../src/services/compiler-worker-protocol.js";
import { runCompilerWorkerChild } from "../src/compiler-worker-entry.js";
import type { CompilerWorkerConnection } from "../src/services/compiler-worker-protocol.js";
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };
const envelope = (overrides = {}) =>
  JSON.stringify({ v: 1, generation: 2, sequence: 3, type: "ready", payload: {}, ...overrides });
const pendingChild = (): CompilerWorkerConnection => ({
  ready: new Promise(() => undefined),
  replay: vi.fn(async () => undefined),
  terminate: vi.fn(),
  reap: vi.fn(async () => undefined),
});
describe("compiler worker protocol", () => {
  it("starts the existing compiler runtime from the child entry", async () => {
    const handle = {
      shutdown: vi.fn(async () => ({ state: "complete" as const, trigger: "requested" as const })),
    };
    const runRuntime = vi.fn(async () => handle);
    await expect(runCompilerWorkerChild(runRuntime)).resolves.toBe(handle);
    expect(runRuntime).toHaveBeenCalledOnce();
  });
  it("accepts only bounded v1 envelopes with closed fields and types", () => {
    expect(decodeCompilerWorkerEnvelope(envelope()).ok).toBe(true);
    for (const [frame, reason] of [
      [envelope().slice(0, -1), "malformed"],
      [envelope({ extra: true }), "unknown_field"],
      [envelope({ type: "secret" }), "unknown_type"],
      [envelope({ v: 2 }), "version_drift"],
      ["x".repeat(256 * 1024 + 1), "oversized"],
    ] as const)
      expect(decodeCompilerWorkerEnvelope(frame)).toEqual({ ok: false, reason });
  });
  it("retains exactly initialize and initialized within 256 KiB", () => {
    expect(validateInitializationReplay([initialize, initialized]).ok).toBe(true);
    for (const [frames, reason] of [
      [[initialize], "missing_replay"],
      [[initialize, initialized, initialized], "unexpected_replay"],
      [
        [{ ...initialize, params: { value: "x".repeat(256 * 1024) } }, initialized],
        "oversized_replay",
      ],
    ] as const)
      expect(validateInitializationReplay(frames)).toEqual({ ok: false, reason });
  });
  it("kills and reaps both timed-out pre-request attempts", async () => {
    vi.useFakeTimers();
    const children = [pendingChild(), pendingChild()];
    let next = 0;
    const started = startCompilerWorker({
      frames: [initialize, initialized],
      spawn: () => children[next++]!,
      timeoutMs: 10,
    });
    const rejected = expect(started).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(children.every((child) => vi.mocked(child.terminate).mock.calls.length === 1)).toBe(
      true,
    );
    expect(children.every((child) => vi.mocked(child.reap).mock.calls.length === 1)).toBe(true);
    vi.useRealTimers();
  });
});
