import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function taskkill(pid) {
  const child = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForExit(child, 5_000);
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processGroupExists(pid);
}

export async function terminateProcessTree(child) {
  if (process.platform === "win32" && child.pid !== undefined) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await taskkill(child.pid).catch(() => undefined);
    if (await waitForExit(child, 2_000)) return;
    await taskkill(child.pid).catch(() => undefined);
    if (!(await waitForExit(child, 5_000))) {
      throw new Error("process tree did not terminate within the cleanup deadline");
    }
    return;
  }
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      else return;
    }
  } else {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
  }
  const directExited = await waitForExit(child, 2_000);
  const groupExited =
    child.pid === undefined ? directExited : await waitForProcessGroupExit(child.pid, 2_000);
  if (directExited && groupExited) return;
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  } else {
    child.kill("SIGKILL");
  }
  if (
    !(await waitForExit(child, 5_000)) ||
    (child.pid !== undefined && !(await waitForProcessGroupExit(child.pid, 5_000)))
  ) {
    throw new Error("process tree did not terminate within the cleanup deadline");
  }
}

export function runBoundedCommand(command, args, options = {}) {
  const { timeout = 10 * 60 * 1000, maxBuffer = 64 * 1024 * 1024, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exitCleanup;
    const cleanup = () => (exitCleanup ??= terminateProcessTree(child));
    const finishError = async (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await cleanup();
      } catch (cleanupError) {
        error.message += `; cleanup failed: ${cleanupError.message}`;
      }
      reject(error);
    };
    const append = (stream, chunk) => {
      if (settled) return;
      if (stream === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) {
        void finishError(new Error(`${command} exceeded the bounded output limit`));
      }
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.once("error", (error) => void finishError(error));
    child.once("exit", () => {
      if (!settled) void cleanup().catch(() => undefined);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      if (exitCode === 0) {
        settled = true;
        clearTimeout(timer);
        void cleanup().then(
          () => resolve({ stdout, stderr }),
          (cleanupError) =>
            reject(
              new Error(
                `${command} exited successfully but cleanup failed: ${cleanupError.message}`,
              ),
            ),
        );
      } else {
        const error = new Error(
          `${command} exited with ${exitCode ?? `signal ${signal ?? "unknown"}`}`,
        );
        error.stdout = stdout;
        error.stderr = stderr;
        void finishError(error);
      }
    });
    const timer = setTimeout(
      () => void finishError(new Error(`${command} timed out after ${timeout}ms`)),
      timeout,
    );
  });
}

// prettier-ignore
export function requireExactIdentity(observed, expected) { for (const [key, value] of Object.entries(expected)) { if (value === undefined || value === null || value === "") throw new Error(`BLOCKED: expected identity ${key} is missing`); if (observed?.[key] === undefined || observed[key] === null || observed[key] === "") throw new Error(`BLOCKED: observed identity ${key} is missing`); if (observed[key] !== value) throw new Error(`BLOCKED: identity ${key} differs from the pinned value`); } return observed; }
// prettier-ignore
export function createH03CleanupEvidence(h03) { return h03 ? { rawMarkerSha256: h03.rawMarkerSha256, controllerReadback: h03.readback, ownedProcesses: 0, profileAndControlRemoved: true } : undefined; }
// prettier-ignore
export function classifyExactHostToolError(result) { const name = result?.error?.info?.name, hostCode = result?.error?.info?.code; if (name === "ToolTimeoutError" || hostCode === "TOOL_TIMEOUT") throw new Error("generic Harness timeout won ownership"); if (name === "AbortError") throw new Error("unrelated AbortError classified as AST cancellation"); if (result?.isError !== true) throw new Error("exact-host failure must set isError true"); const text = result?.error?.message; if (typeof text !== "string" || Buffer.byteLength(text) > 4096) throw new Error("exact-host tool error did not contain a bounded AST JSON envelope"); let envelope; try { envelope = JSON.parse(text); } catch { throw new Error("exact-host tool error did not contain a bounded AST JSON envelope"); } const detail = envelope?.error; if (Object.keys(envelope ?? {}).join() !== "error" || Object.keys(detail ?? {}).sort().join() !== "code,correlation_id,message") throw new Error("exact-host error envelope has unexpected keys"); const { code, correlation_id: correlationId, message } = detail; if (!["QUEUE_WAIT_TIMEOUT", "OPERATION_DEADLINE_EXCEEDED", "REQUEST_CANCELLED"].includes(code)) throw new Error(`unexpected exact-host error code ${String(code)}`); if (!/^[0-9a-f-]{36}$/u.test(correlationId)) throw new Error("exact-host error omitted its correlation id"); if (typeof message !== "string" || message.length === 0 || Buffer.byteLength(message) > 1024) throw new Error("exact-host error message was not bounded"); return { code, correlationId, message, name, envelopeBytes: Buffer.byteLength(text) }; }

export function parseProbeMarker(stderr) {
  const match = /DSH_PROBE_RESULT:(\{.*\})\n/u.exec(stderr);
  if (!match) return { status: "missing" };
  try {
    return { status: "found", value: JSON.parse(match[1]) };
  } catch (error) {
    return {
      status: "invalid",
      detail: `DSH_PROBE_RESULT contains invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
