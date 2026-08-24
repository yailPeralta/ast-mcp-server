import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, expect, it, vi } from "vitest";
// prettier-ignore
import { CompilerWorkerHost, runSupervisedStdioServer, spawnCompilerWorkerProcess } from "../src/services/compiler-worker-host.js";
// prettier-ignore
const replay = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", method: "notifications/initialized" }] as const;
const roots: string[] = [];
// prettier-ignore
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => (resolve = done)); return { promise, resolve }; }
// prettier-ignore
function adapter(generation: number, forward = vi.fn()) { const ready = JSON.stringify({ v: 1, generation, sequence: 1, type: "ready", payload: {} }); return { generation, ready: Promise.resolve(ready), replay: vi.fn(), forward, cancel: vi.fn(() => true), shutdown: vi.fn(async () => "complete" as const), terminate: vi.fn(), reap: vi.fn() } as ReturnType<typeof spawnCompilerWorkerProcess>; }
// prettier-ignore
async function fixturePath() { const root = await mkdtemp(path.join(os.tmpdir(), "ast-worker-host-")), file = path.join(root, "worker.mjs"); roots.push(root); await writeFile(file, `import{createInterface}from"node:readline";let generation=0,sequence=0;const send=(type,payload,stale=false)=>process.send({v:1,generation,sequence:stale?sequence:++sequence,type,payload});process.on("message",frame=>{if(frame.type==="handshake"){generation=frame.generation;send("ready",{});}if(frame.type==="shutdown")process.disconnect();});createInterface({input:process.stdin}).on("line",line=>{const message=JSON.parse(line);if(message.method==="crash")process.exit(17);if(message.id===undefined)return;console.log(JSON.stringify(message.method==="error"?{jsonrpc:"2.0",id:message.id,error:{code:-32001,message:"bounded"}}:{jsonrpc:"2.0",id:message.id,result:{method:message.method}}));});`); return file; }
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
