import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { StdioRuntimeHandle } from "./worker-runtime.js";
import { decodeCompilerWorkerEnvelope } from "./services/compiler-worker-protocol.js";
type RunCompilerRuntime = () => Promise<StdioRuntimeHandle>;
async function runDefaultCompilerRuntime(): Promise<StdioRuntimeHandle> {
  return (await import("./worker-runtime.js")).runStdioServer();
}
export function runCompilerWorkerChild(
  runRuntime: RunCompilerRuntime = runDefaultCompilerRuntime,
): Promise<StdioRuntimeHandle> {
  return runRuntime();
}
function installPrivateControl(runtime: Promise<StdioRuntimeHandle>): void {
  process.on("message", (message) => {
    const decoded = decodeCompilerWorkerEnvelope(JSON.stringify(message));
    if (!decoded.ok) return;
    if (decoded.value.type === "handshake") {
      void runtime.then(() => process.send?.({ ...decoded.value, type: "ready", payload: {} }));
    }
    if (decoded.value.type === "shutdown") {
      void runtime
        .then((handle) => handle.shutdown("requested"))
        .finally(() => process.disconnect());
    }
  });
}
const entry = process.argv[1];
if (entry && fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const runtime = runCompilerWorkerChild();
  if (process.send) installPrivateControl(runtime);
  runtime.catch(() => {
    process.stderr.write("Fatal compiler worker startup error.\n");
    process.exit(1);
  });
}
