import { describe, expect, it, vi } from "vitest";
import {
  COMPILER_WORKER_MAX_REQUEST_ID_BYTES,
  decodeCompilerWorkerEnvelope,
  decodeCompilerWorkerResponse,
  fitsCompilerWorkerResponseResult,
  isCompilerWorkerRequestIdWithinBudget,
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
  it("decodes bounded responses and ignores compatible worker notifications", () => {
    expect(decodeCompilerWorkerResponse('{"jsonrpc":"2.0","id":1,"result":null}')).toMatchObject({
      ok: true,
      kind: "response",
    });
    expect(
      decodeCompilerWorkerResponse(
        '{"jsonrpc":"2.0","id":"a","error":{"code":-32001,"message":"bounded","extension":true}}',
      ),
    ).toMatchObject({ ok: true, kind: "response" });
    expect(
      decodeCompilerWorkerResponse(
        '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
      ),
    ).toMatchObject({ ok: true, kind: "notification" });
    for (const [frame, reason] of [
      ["null", "invalid_response"],
      ["1", "invalid_response"],
      ['{"jsonrpc":"2.0","id":1}', "invalid_response"],
      ['{"jsonrpc":"2.0","id":1,"result":{},"error":{}}', "invalid_response"],
      ['{"jsonrpc":"2.0","id":null,"result":{}}', "invalid_id"],
      ['{"jsonrpc":"2.0","id":1,"error":{"code":"x","message":1}}', "invalid_error"],
    ] as const) {
      expect(decodeCompilerWorkerResponse(frame)).toEqual({ ok: false, reason });
    }
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
  it("shares exact request-id and complete response-frame budgets", () => {
    expect(
      isCompilerWorkerRequestIdWithinBudget("x".repeat(COMPILER_WORKER_MAX_REQUEST_ID_BYTES - 2)),
    ).toBe(true);
    expect(
      isCompilerWorkerRequestIdWithinBudget("x".repeat(COMPILER_WORKER_MAX_REQUEST_ID_BYTES - 1)),
    ).toBe(false);
    expect(fitsCompilerWorkerResponseResult({ content: [], structuredContent: { ok: true } })).toBe(
      true,
    );
    expect(fitsCompilerWorkerResponseResult({ value: "x".repeat(256 * 1024) })).toBe(false);
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
