import fs from "node:fs";
import { createInterface } from "node:readline";
import { PassThrough, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { StdioRuntimeHandle } from "./worker-runtime.js";
import { decodeCompilerWorkerEnvelope } from "./services/compiler-worker-protocol.js";
type RunCompilerRuntime = () => Promise<StdioRuntimeHandle>;
async function runDefaultCompilerRuntime(
  input: Readable = process.stdin,
): Promise<StdioRuntimeHandle> {
  return (await import("./worker-runtime.js")).runStdioServer({
    transport: new StdioServerTransport(input, process.stdout),
  });
}
export function runCompilerWorkerChild(
  runRuntime: RunCompilerRuntime = runDefaultCompilerRuntime,
): Promise<StdioRuntimeHandle> {
  return runRuntime();
}
// prettier-ignore
export function installPrivateControl(runtime: Promise<StdioRuntimeHandle>, input?: PassThrough): void {
  let sequence = 0, generation = 0, writeSequence = 0;
  const send = (generation: number, type: "ready" | "snapshot" | "settled", payload: Record<string, unknown>) => process.send?.({ v: 1, generation, sequence: ++sequence, type, payload });
  const arm = (handle: StdioRuntimeHandle) => { const force = () => { if ((handle.snapshot?.().completion_critical_operations as number) > 0) setTimeout(force, 50).unref(); else process.exit(1); }; setTimeout(force, (handle.shutdownGraceMs ?? 10_000) + 2_000).unref(); };
  const shutdown = (handle: StdioRuntimeHandle, trigger: "requested" | "parent_exit") => { if (trigger === "parent_exit") arm(handle); void handle.shutdown(trigger).finally(() => process.disconnect()); };
  process.on("message", (message) => { const decoded = decodeCompilerWorkerEnvelope(JSON.stringify(message)); if (!decoded.ok) return; if (decoded.value.type === "handshake") { generation = decoded.value.generation as number; void runtime.then(() => send(generation, "ready", {})); } if (decoded.value.type === "snapshot") void runtime.then((handle) => send(generation, "snapshot", (handle.snapshot?.() ?? {}) as Record<string, unknown>)); if (decoded.value.type === "shutdown") { const trigger = (decoded.value.payload as Record<string, unknown>).trigger === "parent_exit" ? "parent_exit" : "requested"; void runtime.then((handle) => shutdown(handle, trigger)); } });
  if (input) { const lines = createInterface({ input: process.stdin }); lines.on("line", (line) => input.write(`${line}\n`, () => send(generation, "settled", { write_sequence: ++writeSequence }))); lines.once("close", () => input.end()); }
  process.once("disconnect", () => void runtime.then((handle) => { arm(handle); void handle.shutdown("parent_exit").then(() => process.exit(0), () => process.exit(1)); }));
}
const entry = process.argv[1];
if (entry && fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const input = process.send ? new PassThrough() : undefined;
  const runtime = input ? runDefaultCompilerRuntime(input) : runCompilerWorkerChild();
  if (process.send) installPrivateControl(runtime, input);
  runtime.catch(() => {
    process.stderr.write("Fatal compiler worker startup error.\n");
    process.exit(1);
  });
}
