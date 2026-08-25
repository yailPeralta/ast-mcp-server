import { Buffer } from "node:buffer";
const FIELDS = new Set(["v", "generation", "sequence", "type", "payload"]);
const TYPES = new Set(["handshake", "snapshot", "shutdown", "ready", "settled", "lease", "exit"]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function decodeCompilerWorkerEnvelope(frame: string) {
  if (Buffer.byteLength(frame) > 256 * 1024) {
    return { ok: false as const, reason: "oversized" };
  }
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    return { ok: false as const, reason: "malformed" };
  }
  if (!isRecord(value)) return { ok: false as const, reason: "invalid_envelope" };
  if (Object.keys(value).some((key) => !FIELDS.has(key)))
    return { ok: false as const, reason: "unknown_field" };
  if (value.v !== 1) return { ok: false as const, reason: "version_drift" };
  if (typeof value.type !== "string" || !TYPES.has(value.type)) {
    return { ok: false as const, reason: "unknown_type" };
  }
  if (
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 1 ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !isRecord(value.payload)
  ) {
    return { ok: false as const, reason: "invalid_envelope" };
  }
  return { ok: true as const, value };
}
export function validateInitializationReplay(frames: readonly unknown[]) {
  if (frames.length < 2) return { ok: false as const, reason: "missing_replay" };
  if (frames.length > 2) return { ok: false as const, reason: "unexpected_replay" };
  const [request, notification] = frames;
  if (
    !isRecord(request) ||
    request.method !== "initialize" ||
    !("id" in request) ||
    !isRecord(notification) ||
    notification.method !== "notifications/initialized" ||
    "id" in notification
  ) {
    return { ok: false as const, reason: "missing_replay" };
  }
  if (Buffer.byteLength(JSON.stringify(frames)) > 256 * 1024) {
    return { ok: false as const, reason: "oversized_replay" };
  }
  return { ok: true as const, frames: [request, notification] as readonly [unknown, unknown] };
}
export interface CompilerWorkerConnection {
  readonly ready: Promise<string>;
  replay(frames: readonly [unknown, unknown]): Promise<void>;
  terminate(): void;
  reap(): Promise<void>;
}
interface StartOptions {
  readonly frames: readonly unknown[];
  readonly spawn: () => CompilerWorkerConnection | Promise<CompilerWorkerConnection>;
  readonly timeoutMs?: number;
}
export class CompilerWorkerStartupError extends Error {
  constructor(readonly reason: string) {
    super("Compiler worker startup failed.");
  }
}
async function attempt(options: StartOptions, frames: readonly [unknown, unknown]) {
  const child = await options.spawn();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await child.replay(frames);
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new CompilerWorkerStartupError("timeout")),
        options.timeoutMs ?? 10_000,
      );
    });
    const decoded = decodeCompilerWorkerEnvelope(await Promise.race([child.ready, timedOut]));
    if (!decoded.ok || decoded.value.type !== "ready")
      throw new CompilerWorkerStartupError("protocol");
    return decoded.value;
  } catch (error) {
    child.terminate();
    await child.reap();
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
export async function startCompilerWorker(options: StartOptions) {
  const replay = validateInitializationReplay(options.frames);
  if (!replay.ok) throw new CompilerWorkerStartupError(replay.reason);
  try {
    return await attempt(options, replay.frames);
  } catch {
    return attempt(options, replay.frames);
  }
}
