import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import {
  COMPILER_WORKER_MAX_FRAME_BYTES,
  decodeCompilerWorkerEnvelope,
  decodeCompilerWorkerResponse,
  isCompilerWorkerRequestIdWithinBudget,
  startCompilerWorker,
} from "./compiler-worker-protocol.js";
import {
  createCompilerWorkerSpawnSpec,
  readRuntimePolicy,
  type RuntimePolicyEnvironment,
} from "./runtime-policy.js";
import { emitCompilerWorkerEvent } from "./runtime-logger.js";
import { PublicOperationalError, renderPublicError } from "./public-errors.js";
type Trigger = "requested" | "parent_exit" | "protocol";
type Ready = { readonly generation: number; readonly sequence: number };
export class CompilerWorkerHostError extends Error {
  constructor(
    readonly kind: "startup" | "protocol" | "worker_exit" | "ambiguous_apply",
    readonly recovery?: { readonly correlation_id: string; readonly expires_at: number },
  ) {
    super("Compiler worker request failed.");
  }
}
const bounded = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value)) <= COMPILER_WORKER_MAX_FRAME_BYTES;
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
  const snapshots: ReturnType<typeof deferred<Record<string, unknown>>>[] = [];
  const acknowledgements = new Map<number, ReturnType<typeof deferred<void>>>();
  let outbound = 0;
  let inbound = 0;
  let controlInbound = 0;
  let writes = 0;
  const fail = (error: Error) => {
    ready.reject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    for (const snapshot of snapshots.splice(0)) snapshot.reject(error);
    for (const acknowledged of acknowledgements.values()) acknowledged.reject(error);
    acknowledgements.clear();
  };
  child.once("close", () => fail(new CompilerWorkerHostError("worker_exit")));
  child.on("message", (message) => {
    const frame = JSON.stringify(message);
    const decoded = decodeCompilerWorkerEnvelope(frame);
    if (
      !decoded.ok ||
      decoded.value.generation !== options.generation ||
      (decoded.value.sequence as number) <= controlInbound ||
      !["ready", "snapshot", "settled"].includes(decoded.value.type as string)
    )
      return fail(new CompilerWorkerHostError("protocol"));
    controlInbound = decoded.value.sequence as number;
    if (decoded.value.type === "settled") {
      const writeSequence = (decoded.value.payload as Record<string, unknown>).write_sequence;
      if (!Number.isSafeInteger(writeSequence))
        return fail(new CompilerWorkerHostError("protocol"));
      acknowledgements.get(writeSequence as number)?.resolve();
      acknowledgements.delete(writeSequence as number);
    } else if (decoded.value.type === "ready") {
      inbound = 1;
      ready.resolve(frame);
    } else snapshots.shift()?.resolve(decoded.value);
  });
  createInterface({ input: child.stdout! }).on("line", (line) => {
    const decoded = decodeCompilerWorkerResponse(line);
    if (!decoded.ok) return fail(new CompilerWorkerHostError("protocol"));
    if (decoded.kind === "notification") return;
    const message = decoded.value as JSONRPCMessage & { readonly id: RequestId };
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    request.resolve({
      generation: options.generation,
      sequence: ++inbound,
      payload: { request_id: message.id, message },
    });
  });
  const write = (message: JSONRPCMessage, acknowledge = false) => {
    const requestIdWithinBudget =
      !("id" in message) ||
      message.id === undefined ||
      isCompilerWorkerRequestIdWithinBudget(message.id);
    if (!requestIdWithinBudget || !bounded(message) || !child.stdin?.writable)
      return Promise.reject(new CompilerWorkerHostError("protocol"));
    options.beforeWrite?.(message);
    const writeSequence = ++writes,
      processed = acknowledge ? deferred<void>() : undefined;
    if (processed) {
      acknowledgements.set(writeSequence, processed);
      void processed.promise.catch(() => undefined);
    }
    const written = new Promise<void>((resolve, reject) =>
      child.stdin!.write(`${JSON.stringify(message)}\n`, (error) =>
        error ? (acknowledgements.delete(writeSequence), reject(error)) : resolve(),
      ),
    );
    return processed ? written.then(() => processed.promise) : written;
  };
  const control = (
    type: "handshake" | "snapshot" | "shutdown",
    payload: Record<string, unknown>,
  ) => {
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
      await ready.promise;
      for (const frame of frames) await write(frame as JSONRPCMessage);
    },
    forward(message: JSONRPCMessage) {
      if (!("id" in message)) return write(message, true).then(() => undefined);
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
      void write(
        { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } },
        true,
      ).catch(() => undefined);
      return true;
    },
    async snapshot() {
      await Promise.all([...acknowledgements.values()].map(({ promise }) => promise));
      const result = deferred<Record<string, unknown>>();
      snapshots.push(result);
      await control("snapshot", {});
      return (await result.promise).payload as Record<string, unknown>;
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
  private readonly leases = new Map<string, number>();
  private initialization: unknown[] = [];
  private activity = 0;
  private parentWork = 0;
  private parentAdmission: "open" | "closed" = "open";
  private idleTimer?: ReturnType<typeof setTimeout>;
  private retiring?: Promise<void>;
  constructor(
    private readonly spawn: (generation: number) => ReturnType<typeof spawnCompilerWorkerProcess>,
    private readonly timeoutMs = 10_000,
    private readonly lifecycle: {
      readonly idleTtlMs?: number;
      readonly leaseLimit?: number;
      readonly leaseTtlMs?: number;
      readonly now?: () => number;
    } = {},
  ) {}
  private now() {
    return (this.lifecycle.now ?? Date.now)();
  }
  // prettier-ignore
  private pruneLeases() { const now = this.now(); for (const [id, expiry] of this.leases) if (expiry <= now) this.leases.delete(id); }
  // prettier-ignore
  private addLease(id: unknown) { if (typeof id !== "string" || !id || !bounded(id)) return; this.pruneLeases(); this.leases.set(id, this.now() + (this.lifecycle.leaseTtlMs ?? 15 * 60_000)); while (this.leases.size > (this.lifecycle.leaseLimit ?? 128)) this.leases.delete(this.leases.keys().next().value!); }
  // prettier-ignore
  private scheduleIdle() { clearTimeout(this.idleTimer); const ttl = this.lifecycle.idleTtlMs ?? 0; if (ttl > 0 && this.child) this.idleTimer = setTimeout(() => { this.retiring = this.recycle(this.activity).catch(async () => { const child = this.child; await child?.reap().catch(() => undefined); if (this.child === child) this.child = undefined; }).finally(() => { this.retiring = undefined; }); }, ttl); }
  // prettier-ignore
  private static quiescent(value: Record<string, unknown>) { return value.runtime_admission === "open" && value.project_admission === "open" && ["active_requests", "active_sends", "active_operations", "queued_operations", "completion_critical_operations"].every((key) => value[key] === 0) && value.mutation_history === false; }
  // prettier-ignore
  private async recycle(activity: number) { this.pruneLeases(); const child = this.child, generation = this.generation, sequence = this.sequence; if (!child || this.parentWork || this.leases.size || child.generation !== generation) return this.scheduleIdle(); const first = await child.snapshot(); if (!CompilerWorkerHost.quiescent(first) || activity !== this.activity || sequence !== this.sequence) return this.scheduleIdle(); this.parentAdmission = "closed"; const second = await child.snapshot(); if (child !== this.child || generation !== this.generation || sequence !== this.sequence || activity !== this.activity || !CompilerWorkerHost.quiescent(second)) { this.parentAdmission = "open"; return this.scheduleIdle(); } await this.stopChild(child, "requested"); emitCompilerWorkerEvent({ kind: "idle", generation }); this.parentAdmission = "open"; }
  // prettier-ignore
  private async stopChild(child: ReturnType<typeof spawnCompilerWorkerProcess>, trigger: Trigger): Promise<"complete" | "forced"> { const completion = child.shutdown(trigger); try { await within(completion, this.timeoutMs); if (this.child === child) this.child = undefined; return "complete"; } catch { const snapshot = await child.snapshot().catch(() => undefined); if (snapshot?.completion_critical_operations) { await completion; if (this.child === child) this.child = undefined; return "complete"; } child.terminate(); await child.reap().catch(() => undefined); if (this.child === child) this.child = undefined; return "forced"; } }
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
        this.parentAdmission = "open";
        this.scheduleIdle();
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
    await this.retiring;
    this.activity += 1;
    await this.start(this.initialization.length === 2 ? this.initialization : []);
    this.parentWork += 1;
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
      const response = payload.message as JSONRPCMessage;
      const result =
        "result" in response ? (response.result as Record<string, unknown>) : undefined;
      this.addLease(
        result?.operation_id ??
          (result?.structuredContent as Record<string, unknown> | undefined)?.operation_id,
      );
      return response;
    } catch (error) {
      if (error instanceof CompilerWorkerHostError && error.kind === "worker_exit") {
        const child = this.child;
        await child?.reap().catch(() => undefined);
        if (this.child === child) this.child = undefined;
        emitCompilerWorkerEvent({
          kind: "crash",
          generation: child?.generation ?? this.generation,
        });
        const params =
          "params" in message
            ? (message.params as { name?: unknown; arguments?: { operation_id?: unknown } })
            : undefined;
        const operationId =
          params?.name === "ast_apply_operation" ? params.arguments?.operation_id : undefined;
        if (typeof operationId === "string") {
          this.addLease(operationId);
          const correlationId = randomUUID();
          emitCompilerWorkerEvent({
            kind: "ambiguity",
            generation: child?.generation ?? this.generation,
            correlationId,
            count: this.leases.size,
          });
          throw new CompilerWorkerHostError("ambiguous_apply", {
            correlation_id: correlationId,
            expires_at: this.leases.get(operationId)!,
          });
        }
      }
      throw error instanceof CompilerWorkerHostError
        ? error
        : new CompilerWorkerHostError("worker_exit");
    } finally {
      if (id !== undefined) this.active.delete(id);
      this.parentWork -= 1;
      this.scheduleIdle();
    }
  }
  cancel(id: RequestId): "not_found" | "forwarded" {
    if (this.active.get(id) !== this.generation || !this.child) return "not_found";
    return this.child.cancel(id) ? "forwarded" : "not_found";
  }
  async shutdown(trigger: Trigger): Promise<"complete" | "forced"> {
    clearTimeout(this.idleTimer);
    await this.starting?.catch(() => undefined);
    if (!this.child) return "complete";
    const child = this.child;
    this.parentAdmission = "closed";
    return this.stopChild(child, trigger);
  }
  snapshot() {
    this.pruneLeases();
    return {
      generation: this.generation,
      sequence: this.sequence,
      state: this.child ? "ready" : this.starting ? "starting" : "idle",
      active_requests: this.active.size,
      parent_work: this.parentWork,
      parent_admission: this.parentAdmission,
      lease_tombstones: this.leases.size,
    } as const;
  }
}
export async function runSupervisedStdioServer() {
  const entry = fileURLToPath(new URL("../compiler-worker-entry.js", import.meta.url));
  const policy = readRuntimePolicy(process.env);
  const host = new CompilerWorkerHost(
    (generation) =>
      spawnCompilerWorkerProcess({ generation, workerEntryPath: entry, environment: process.env }),
    10_000,
    { idleTtlMs: policy.compilerWorkerIdleTtlMs },
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
    } catch (error) {
      if ("id" in message) {
        const ambiguous =
          error instanceof CompilerWorkerHostError &&
          error.kind === "ambiguous_apply" &&
          error.recovery;
        const rendered = ambiguous
          ? renderPublicError(
              new PublicOperationalError("AMBIGUOUS_APPLY", "The apply outcome is ambiguous."),
              ambiguous.correlation_id,
            ).envelope.error
          : undefined;
        const responseId = isCompilerWorkerRequestIdWithinBudget(message.id) ? message.id : null;
        const candidate = {
          jsonrpc: "2.0",
          id: responseId,
          error: {
            code: -32603,
            message: rendered?.message ?? "Compiler worker request failed.",
            ...(ambiguous ? { data: { code: "AMBIGUOUS_APPLY", ...ambiguous } } : {}),
          },
        };
        const response = bounded(candidate)
          ? candidate
          : {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32603, message: "Compiler worker request failed." },
            };
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  };
  lines.on("line", (line) => void relay(line));
  lines.once("close", () => void host.shutdown("parent_exit"));
  return { shutdown: () => host.shutdown("requested"), snapshot: () => host.snapshot() };
}
