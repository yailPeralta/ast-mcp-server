import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import { decodeCompilerWorkerEnvelope, startCompilerWorker } from "./compiler-worker-protocol.js";
import { createCompilerWorkerSpawnSpec, type RuntimePolicyEnvironment } from "./runtime-policy.js";
type Trigger = "requested" | "parent_exit" | "protocol";
type Ready = { readonly generation: number; readonly sequence: number };
export class CompilerWorkerHostError extends Error {
  constructor(readonly kind: "startup" | "protocol" | "worker_exit") {
    super("Compiler worker request failed.");
  }
}
const bounded = (value: unknown) => Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024;
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    delay(ms, undefined, { ref: false }).then(() => {
      throw new CompilerWorkerHostError("startup");
    }),
  ]);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function spawnCompilerWorkerProcess(options: {
  generation: number;
  workerEntryPath: string;
  environment: RuntimePolicyEnvironment;
  beforeWrite?: (message: JSONRPCMessage) => void;
}) {
  const spec = createCompilerWorkerSpawnSpec(options.workerEntryPath, options.environment);
  if (!spec.ok || !spec.command) throw new CompilerWorkerHostError("startup");
  const child = spawn(spec.command, spec.args, {
    ...spec.options,
    stdio: ["pipe", "pipe", "inherit", "ipc"] as const,
  });
  const ready = deferred<string>();
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const pending = new Map<RequestId, ReturnType<typeof deferred<Record<string, unknown>>>>();
  let outbound = 0;
  let inbound = 0;
  const fail = (error: Error) => {
    ready.reject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.once("close", () => fail(new CompilerWorkerHostError("worker_exit")));
  child.on("message", (message) => {
    const frame = JSON.stringify(message);
    const decoded = decodeCompilerWorkerEnvelope(frame);
    if (
      !decoded.ok ||
      decoded.value.generation !== options.generation ||
      (decoded.value.sequence as number) <= inbound ||
      decoded.value.type !== "ready"
    )
      return fail(new CompilerWorkerHostError("protocol"));
    inbound = decoded.value.sequence as number;
    ready.resolve(frame);
  });
  createInterface({ input: child.stdout! }).on("line", (line) => {
    if (Buffer.byteLength(line) > 256 * 1024) return fail(new CompilerWorkerHostError("protocol"));
    let message: JSONRPCMessage;
    try {
      message = JSON.parse(line) as JSONRPCMessage;
    } catch {
      return fail(new CompilerWorkerHostError("protocol"));
    }
    if (!("id" in message) || message.id === undefined) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    request.resolve({
      generation: options.generation,
      sequence: ++inbound,
      payload: { request_id: message.id, message },
    });
  });
  const write = (message: JSONRPCMessage) => {
    if (!bounded(message) || !child.stdin?.writable)
      return Promise.reject(new CompilerWorkerHostError("protocol"));
    options.beforeWrite?.(message);
    return new Promise<void>((resolve, reject) =>
      child.stdin!.write(`${JSON.stringify(message)}\n`, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  };
  const control = (type: "handshake" | "shutdown", payload: Record<string, unknown>) => {
    const frame = { v: 1, generation: options.generation, sequence: ++outbound, type, payload };
    if (!bounded(frame) || !child.connected)
      return Promise.reject(new CompilerWorkerHostError("protocol"));
    return new Promise<void>((resolve, reject) =>
      child.send!(frame, (error) => (error ? reject(error) : resolve())),
    );
  };
  return {
    generation: options.generation,
    ready: ready.promise,
    async replay(frames: readonly [unknown, unknown]) {
      await control("handshake", {});
      for (const frame of frames) await write(frame as JSONRPCMessage);
    },
    forward(message: JSONRPCMessage) {
      if (!("id" in message)) return write(message).then(() => undefined);
      if (message.id === undefined) return Promise.reject(new CompilerWorkerHostError("protocol"));
      const result = deferred<Record<string, unknown>>();
      const id = message.id;
      pending.set(id, result);
      void write(message).catch((error) => {
        pending.delete(id);
        result.reject(error);
      });
      return result.promise;
    },
    cancel(id: RequestId) {
      if (!pending.has(id)) return false;
      void write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } });
      return true;
    },
    terminate: () => {
      child.kill("SIGKILL");
    },
    reap: () => closed,
    async shutdown(trigger: Trigger) {
      await control("shutdown", { trigger }).catch(() => undefined);
      child.stdin?.end();
      await closed;
      return "complete" as const;
    },
  };
}
export class CompilerWorkerHost {
  private generation = 0;
  private sequence = 0;
  private child?: ReturnType<typeof spawnCompilerWorkerProcess>;
  private starting?: Promise<Ready>;
  private readonly active = new Map<RequestId, number>();
  private initialization: unknown[] = [];
  constructor(
    private readonly spawn: (generation: number) => ReturnType<typeof spawnCompilerWorkerProcess>,
    private readonly timeoutMs = 10_000,
  ) {}
  async start(initialization: readonly unknown[]): Promise<Ready> {
    if (this.child) return { generation: this.child.generation, sequence: this.sequence };
    if (this.starting) return this.starting;
    this.starting = (async () => {
      let child: ReturnType<typeof spawnCompilerWorkerProcess> | undefined;
      try {
        const envelope =
          initialization.length === 2
            ? await startCompilerWorker({
                frames: initialization,
                timeoutMs: this.timeoutMs,
                spawn: () => (child = this.spawn(++this.generation)),
              })
            : await (async () => {
                child = this.spawn(++this.generation);
                await child.replay([] as unknown as readonly [unknown, unknown]);
                const decoded = decodeCompilerWorkerEnvelope(
                  await within(child.ready, this.timeoutMs),
                );
                if (!decoded.ok || decoded.value.type !== "ready") throw new Error();
                return decoded.value;
              })();
        if (!child || envelope.generation !== child.generation) throw new Error();
        this.child = child;
        this.sequence = envelope.sequence as number;
        return { generation: child.generation, sequence: this.sequence };
      } catch {
        child?.terminate();
        await child?.reap().catch(() => undefined);
        throw new CompilerWorkerHostError("startup");
      }
    })().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
  async forward(message: JSONRPCMessage): Promise<JSONRPCMessage | undefined> {
    if (!bounded(message)) throw new CompilerWorkerHostError("protocol");
    await this.start(this.initialization.length === 2 ? this.initialization : []);
    const id = "id" in message ? message.id : undefined;
    if (id !== undefined) this.active.set(id, this.generation);
    try {
      const settled = await this.child!.forward(message);
      if ("method" in message && message.method === "initialize") this.initialization = [message];
      if (
        "method" in message &&
        message.method === "notifications/initialized" &&
        this.initialization.length === 1
      )
        this.initialization.push(message);
      if (!settled) return undefined;
      const payload = settled.payload as Record<string, unknown>;
      if (
        settled.generation !== this.generation ||
        (settled.sequence as number) <= this.sequence ||
        payload.request_id !== id ||
        !payload.message
      )
        throw new CompilerWorkerHostError("protocol");
      this.sequence = settled.sequence as number;
      return payload.message as JSONRPCMessage;
    } catch (error) {
      throw error instanceof CompilerWorkerHostError
        ? error
        : new CompilerWorkerHostError("worker_exit");
    } finally {
      if (id !== undefined) this.active.delete(id);
    }
  }
  cancel(id: RequestId): "not_found" | "forwarded" {
    if (this.active.get(id) !== this.generation || !this.child) return "not_found";
    return this.child.cancel(id) ? "forwarded" : "not_found";
  }
  async shutdown(trigger: Trigger): Promise<"complete"> {
    await this.starting?.catch(() => undefined);
    if (!this.child) return "complete";
    const child = this.child;
    const result = await child.shutdown(trigger);
    if (this.child === child) {
      this.child = undefined;
    }
    return result;
  }
  snapshot() {
    return {
      generation: this.generation,
      sequence: this.sequence,
      state: this.child ? "ready" : this.starting ? "starting" : "idle",
      active_requests: this.active.size,
    } as const;
  }
}
export async function runSupervisedStdioServer() {
  const entry = fileURLToPath(new URL("../compiler-worker-entry.js", import.meta.url));
  const host = new CompilerWorkerHost((generation) =>
    spawnCompilerWorkerProcess({ generation, workerEntryPath: entry, environment: process.env }),
  );
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const relay = async (line: string) => {
    let message: JSONRPCMessage;
    try {
      message = JSON.parse(line) as JSONRPCMessage;
    } catch {
      return;
    }
    // prettier-ignore
    if ("method" in message && message.method === "notifications/cancelled") { const id = (message.params as { requestId?: unknown } | undefined)?.requestId; if ((typeof id === "string" || typeof id === "number") && bounded(id)) host.cancel(id); return; }
    try {
      const response = await host.forward(message);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch {
      if ("id" in message)
        process.stdout.write(
          `{"jsonrpc":"2.0","id":${JSON.stringify(message.id)},"error":{"code":-32603,"message":"Compiler worker request failed."}}\n`,
        );
    }
  };
  lines.on("line", (line) => void relay(line));
  lines.once("close", () => void host.shutdown("parent_exit"));
  return { shutdown: () => host.shutdown("requested"), snapshot: () => host.snapshot() };
}
