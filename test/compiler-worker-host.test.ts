import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, expect, it, vi } from "vitest";
// prettier-ignore
import { CompilerWorkerHost, CompilerWorkerHostError, runSupervisedStdioServer, spawnCompilerWorkerProcess } from "../src/services/compiler-worker-host.js";
// prettier-ignore
const replay = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", method: "notifications/initialized" }] as const;
const roots: string[] = [];
// prettier-ignore
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => (resolve = done)); return { promise, resolve }; }
// prettier-ignore
function adapter(generation: number, forward = vi.fn()) { const ready = JSON.stringify({ v: 1, generation, sequence: 1, type: "ready", payload: {} }); return { generation, ready: Promise.resolve(ready), replay: vi.fn(), forward, cancel: vi.fn(() => true), snapshot: vi.fn(async () => idleChild), shutdown: vi.fn(async () => "complete" as const), terminate: vi.fn(), reap: vi.fn(async () => undefined) }; }
const idleChild = {
  runtime_admission: "open",
  project_admission: "open",
  active_requests: 0,
  active_sends: 0,
  active_operations: 0,
  queued_operations: 0,
  completion_critical_operations: 0,
  mutation_history: false,
} as const;
// prettier-ignore
async function fixturePath(ignoreShutdown = false, criticalDelay = 0, acknowledge = false, readyDelay = 0, acknowledgeReplay = false) { const root = await mkdtemp(path.join(os.tmpdir(), "ast-worker-host-")), file = path.join(root, "worker.mjs"); roots.push(root); await writeFile(file, `import{createInterface}from"node:readline";let generation=0,sequence=0,writes=0,critical=${criticalDelay > 0};const send=(type,payload)=>process.send({v:1,generation,sequence:++sequence,type,payload});process.on("message",frame=>{if(frame.type==="handshake"){generation=frame.generation;setTimeout(()=>send("ready",{}),${readyDelay});}if(frame.type==="snapshot")send("snapshot",{runtime_admission:"open",project_admission:"open",active_requests:0,active_sends:0,active_operations:critical?1:0,queued_operations:0,completion_critical_operations:critical?1:0,mutation_history:false});if(frame.type==="shutdown"&&!${ignoreShutdown})setTimeout(()=>{critical=false;process.disconnect()},${criticalDelay});});createInterface({input:process.stdin}).on("line",line=>{const message=JSON.parse(line),write=++writes;if(${acknowledgeReplay}&&write<=2)send("settled",{write_sequence:write});if(${acknowledge}&&message.method==="notify-ack")setTimeout(()=>send("settled",{write_sequence:write}),50);if(message.method==="crash")process.exit(17);if(message.id===undefined)return;console.log(JSON.stringify(message.method==="error"?{jsonrpc:"2.0",id:message.id,error:{code:-32001,message:"bounded"}}:{jsonrpc:"2.0",id:message.id,result:{method:message.method}}));});`); return file; }
// prettier-ignore
async function host(beforeWrite?: (message: JSONRPCMessage) => void) { const workerEntryPath = await fixturePath(); return new CompilerWorkerHost((generation) => spawnCompilerWorkerProcess({ generation, workerEntryPath, environment: {}, beforeWrite }), 500); }
// prettier-ignore
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
it("routes production cancellation through its generation-safe host method", async () => {
  const input = new PassThrough();
  vi.spyOn(process, "stdin", "get").mockReturnValue(input as unknown as typeof process.stdin);
  const cancel = vi.spyOn(CompilerWorkerHost.prototype, "cancel").mockReturnValue("not_found");
  // prettier-ignore
  const forward = vi.spyOn(CompilerWorkerHost.prototype, "forward").mockRejectedValue(new Error("must not forward"));
  await runSupervisedStdioServer();
  // prettier-ignore
  input.write('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"old"}}\n');
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith("old"));
  // prettier-ignore
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "x".repeat(300_000) } })}\n`);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect([cancel.mock.calls.length, forward.mock.calls.length]).toEqual([1, 0]);
  input.end();
});
it("spawns through private IPC and relays bounded JSON-RPC result and error payloads", async () => {
  let causal: string | undefined;
  const worker = await host((message) => {
    if ("id" in message && message.id === "ok") causal = worker.cancel("ok");
  });
  await worker.start(replay);
  // prettier-ignore
  expect(await worker.forward({ jsonrpc: "2.0", id: "ok", method: "read" })).toMatchObject({ result: { method: "read" } });
  expect(causal).toBe("forwarded");
  // prettier-ignore
  expect(await worker.forward({ jsonrpc: "2.0", id: 2, method: "error" })).toMatchObject({ error: { code: -32001, message: "bounded" } });
  // prettier-ignore
  await expect(worker.forward({ jsonrpc: "2.0", id: 3, method: "x", params: { value: "x".repeat(300_000) } })).rejects.toMatchObject({ kind: "protocol" });
  await worker.shutdown("requested");
});
it("maps before write, targets cancellation to its generation, and rejects stale settlement", async () => {
  const old = deferred<Record<string, unknown>>();
  // prettier-ignore
  const first = adapter(1, vi.fn(() => old.promise));
  // prettier-ignore
  const second = adapter(2, vi.fn(async (message) => ({ generation: 2, sequence: 1, payload: { request_id: message.id, message: { jsonrpc: "2.0", id: message.id, result: {} } } })));
  // prettier-ignore
  const worker = new CompilerWorkerHost(vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second), 500);
  await worker.start(replay);
  const pending = worker.forward({ jsonrpc: "2.0", id: "old", method: "hold" });
  await expect.poll(() => worker.snapshot().active_requests).toBe(1);
  await worker.shutdown("requested");
  await worker.start(replay);
  expect(worker.cancel("old")).toBe("not_found");
  expect(second.cancel).not.toHaveBeenCalled();
  // prettier-ignore
  old.resolve({ generation: 1, sequence: 2, payload: { request_id: "old", message: { jsonrpc: "2.0", id: "old", result: {} } } });
  await expect(pending).rejects.toMatchObject({ kind: "protocol" });
  // prettier-ignore
  await expect(worker.forward({ jsonrpc: "2.0", id: "new", method: "read" })).rejects.toMatchObject({ kind: "protocol" });
  await worker.shutdown("requested");
});
it("settles a real child exit once with a bounded failure and no forwarded retry", async () => {
  const workerEntryPath = await fixturePath();
  let spawns = 0;
  // prettier-ignore
  const worker = new CompilerWorkerHost((generation) => { spawns += 1; return spawnCompilerWorkerProcess({ generation, workerEntryPath, environment: {} }); }, 500);
  await worker.start(replay);
  // prettier-ignore
  await expect(worker.forward({ jsonrpc: "2.0", id: "crash", method: "crash" })).rejects.toMatchObject({ kind: "worker_exit" });
  expect(spawns).toBe(1);
});
// prettier-ignore
it("requires stable two-phase quiescence and closes admission before idle shutdown", async () => {
  vi.useFakeTimers(); const child = { ...adapter(1), snapshot: vi.fn(async () => idleChild) }; const worker = new CompilerWorkerHost(() => child, 50, { idleTtlMs: 10 }); let admissionDuringShutdown: unknown;
  child.shutdown.mockImplementation(async () => { admissionDuringShutdown = worker.snapshot().parent_admission; return "complete" as const; }); await worker.start(replay);
  child.snapshot.mockImplementationOnce(async () => { await worker.forward({ jsonrpc: "2.0", method: "late" }); return idleChild; }); await vi.advanceTimersByTimeAsync(10); expect(child.shutdown).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10); await vi.waitFor(() => expect(child.shutdown).toHaveBeenCalledOnce()); expect([admissionDuringShutdown, worker.snapshot().state]).toEqual(["closed", "idle"]); vi.useRealTimers();
});
// prettier-ignore
it("pins mutation generations and bounds crash ambiguity, leases, and forced reap", async () => {
  let now = 0; const crashed = adapter(1, vi.fn(async () => { throw new CompilerWorkerHostError("worker_exit"); })); Object.assign(crashed, { snapshot: vi.fn(async () => ({ ...idleChild, mutation_history: true })) });
  const ambiguous = adapter(2, vi.fn(async () => { throw new CompilerWorkerHostError("worker_exit"); })); let sequence = 1, calls = 0;
  const next = adapter(3, vi.fn(async (message: JSONRPCMessage) => ({ generation: 3, sequence: ++sequence, payload: { request_id: "id" in message ? message.id : undefined, message: { jsonrpc: "2.0", id: "id" in message ? message.id : null, result: { operation_id: `safe-${++calls}`, expires_at: "bounded" } } } }))); Object.assign(next, { snapshot: vi.fn(async () => idleChild), shutdown: vi.fn(() => new Promise(() => undefined)) });
  const spawn = vi.fn().mockReturnValueOnce(crashed).mockReturnValueOnce(ambiguous).mockReturnValue(next); const worker = new CompilerWorkerHost(spawn, 20, { idleTtlMs: 5, leaseLimit: 2, leaseTtlMs: 10, now: () => now }); await worker.start(replay);
  await expect(worker.forward({ jsonrpc: "2.0", id: "read", method: "tools/list" })).rejects.toMatchObject({ kind: "worker_exit" }); expect(crashed.reap).toHaveBeenCalledOnce();
  const ambiguousApply = await worker.forward({ jsonrpc: "2.0", id: "apply", method: "tools/call", params: { name: "ast_apply_operation", arguments: { operation_id: "safe-op" } } }).catch((error: unknown) => error); expect(ambiguousApply).toMatchObject({ kind: "ambiguous_apply", recovery: { correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/), expires_at: 10 } }); expect(JSON.stringify(ambiguousApply)).not.toContain("safe-op"); expect(spawn).toHaveBeenCalledTimes(2);
  for (let index = 0; index < 3; index++) await worker.forward({ jsonrpc: "2.0", id: `p${index}`, method: "tools/call", params: { name: "ast_prepare_rename" } }); expect(worker.snapshot().lease_tombstones).toBe(2); now = 11; expect(worker.snapshot().lease_tombstones).toBe(0);
  await expect(worker.shutdown("requested")).resolves.toBe("forced"); expect([next.terminate.mock.calls.length, next.reap.mock.calls.length]).toEqual([1, 1]);
});
// prettier-ignore
it("reaps real processes after idle and forced exits without an orphan", async () => {
  const idleEntry = await fixturePath(), stuckEntry = await fixturePath(true), criticalEntry = await fixturePath(false, 600); const idle = new CompilerWorkerHost((generation) => spawnCompilerWorkerProcess({ generation, workerEntryPath: idleEntry, environment: {} }), 500, { idleTtlMs: 5 });
  await idle.start(replay); await vi.waitFor(() => expect(idle.snapshot().state).toBe("idle"), { timeout: 1000 }); const stuck = new CompilerWorkerHost((generation) => spawnCompilerWorkerProcess({ generation, workerEntryPath: stuckEntry, environment: {} }), 500);
  await stuck.start(replay); await expect(stuck.shutdown("parent_exit")).resolves.toBe("forced"); expect(stuck.snapshot().state).toBe("idle"); const critical = new CompilerWorkerHost((generation) => spawnCompilerWorkerProcess({ generation, workerEntryPath: criticalEntry, environment: {} }), 500);
  await critical.start(replay); await expect(critical.shutdown("parent_exit")).resolves.toBe("complete"); expect(critical.snapshot().state).toBe("idle");
});
// prettier-ignore
it("blocks idle recycle until the live operation lease expires", async () => {
  vi.useFakeTimers(); let now = 0, sequence = 1; const child = adapter(1, vi.fn(async (message: JSONRPCMessage) => ({ generation: 1, sequence: ++sequence, payload: { request_id: "id" in message ? message.id : undefined, message: { jsonrpc: "2.0", id: "id" in message ? message.id : null, result: { operation_id: "live" } } } }))); const leased = new CompilerWorkerHost(() => child, 100, { idleTtlMs: 5, leaseTtlMs: 10, now: () => now }); await leased.start(replay); await leased.forward({ jsonrpc: "2.0", id: "lease", method: "tools/call" }); await vi.advanceTimersByTimeAsync(5); const blocked = child.shutdown.mock.calls.length === 0; now = 11; await vi.advanceTimersByTimeAsync(5); const recycled = child.shutdown.mock.calls.length === 1; vi.useRealTimers(); expect([blocked, recycled]).toEqual([true, true]);
});
// prettier-ignore
it("waits for a causal child-processed acknowledgement before resolving id-less writes", async () => {
  const entry = await fixturePath(false, 0, true), worker = new CompilerWorkerHost((generation) => spawnCompilerWorkerProcess({ generation, workerEntryPath: entry, environment: {} }), 500); await worker.start(replay); let resolved = false; const sent = worker.forward({ jsonrpc: "2.0", method: "notify-ack" }).then(() => { resolved = true; }); await new Promise((done) => setTimeout(done, 10)); const resolvedBeforeChildAck = resolved; await sent.catch(() => undefined); await worker.shutdown("requested").catch(() => undefined); expect(resolvedBeforeChildAck).toBe(false);
});
// prettier-ignore
it("waits for ready before replay can advance the control sequence", async () => {
  const entry = await fixturePath(false, 0, false, 50, true), worker = new CompilerWorkerHost((generation) => spawnCompilerWorkerProcess({ generation, workerEntryPath: entry, environment: {} }), 500); await worker.start(replay); await expect(worker.forward({ jsonrpc: "2.0", id: "first", method: "read" })).resolves.toMatchObject({ result: { method: "read" } }); await worker.shutdown("requested");
});
