import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { StdioRuntimeHandle } from "./worker-runtime.js";
type RunCompilerRuntime = () => Promise<StdioRuntimeHandle>;
async function runDefaultCompilerRuntime(): Promise<StdioRuntimeHandle> {
  return (await import("./worker-runtime.js")).runStdioServer();
}
export function runCompilerWorkerChild(
  runRuntime: RunCompilerRuntime = runDefaultCompilerRuntime,
): Promise<StdioRuntimeHandle> {
  return runRuntime();
}
const entry = process.argv[1];
if (entry && fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  runCompilerWorkerChild().catch(() => {
    process.stderr.write("Fatal compiler worker startup error.\n");
    process.exit(1);
  });
}
