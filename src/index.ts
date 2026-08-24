#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { readRuntimePolicy, type RuntimePolicy } from "./services/runtime-policy.js";
import type { RunStdioServerOptions } from "./worker-runtime.js";
export type { RunStdioServerOptions, StdioRuntimeHandle } from "./worker-runtime.js";
export async function loadRuntimeModule<T>(
  policy: RuntimePolicy,
  loaders: { readonly inProcess: () => Promise<T>; readonly supervised: () => Promise<T> },
) {
  return {
    mode: policy.compilerWorkerMode,
    module: await (policy.compilerWorkerMode === "supervised"
      ? loaders.supervised()
      : loaders.inProcess()),
  };
}
export async function runStdioServer(options: RunStdioServerOptions = {}) {
  return (await import("./worker-runtime.js")).runStdioServer(options);
}
async function runConfiguredStdioServer(): Promise<void> {
  const policy = readRuntimePolicy();
  const selected = await loadRuntimeModule(policy, {
    inProcess: async () => ({ run: () => runStdioServer({ runtimePolicy: policy }) }),
    supervised: async () => {
      await import("./compiler-worker-entry.js");
      return { run: async () => Promise.reject(new Error("Compiler worker startup failed.")) };
    },
  });
  await selected.module.run();
}
const entry = process.argv[1];
if (entry && fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  runConfiguredStdioServer().catch(() => {
    process.stderr.write("Fatal ast-mcp-server startup error.\n");
    process.exit(1);
  });
}
