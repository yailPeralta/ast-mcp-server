#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createServer } from "./server.js";
import {
  beginProjectShutdown,
  closeDrainedProjectSessions,
  getProjectRuntimeShutdownSnapshot,
  prepareProjectRuntimeForStartup,
  waitForProjectCompletionCriticalOperationsToDrain,
  waitForProjectOperationsToDrain,
} from "./services/project.js";
import { RuntimeActivityTracker } from "./services/runtime-activity.js";
import { readRuntimePolicy, type RuntimePolicy } from "./services/runtime-policy.js";
import {
  emitIncompleteShutdownEvent,
  ShutdownCoordinator,
  type ShutdownResult,
  type ShutdownTrigger,
} from "./services/shutdown.js";

export interface RunStdioServerOptions {
  readonly server?: McpServer;
  readonly transport?: Transport;
  readonly runtimePolicy?: RuntimePolicy;
  readonly runtimeActivity?: RuntimeActivityTracker;
  readonly installProcessHandlers?: boolean;
  readonly logStartup?: boolean;
  readonly exit?: (code: number) => void;
  readonly onRuntimeTrigger?: (trigger: ShutdownTrigger) => void;
  readonly onCompletionCriticalWait?: () => void;
}

export interface StdioRuntimeHandle {
  shutdown(trigger?: ShutdownTrigger): Promise<ShutdownResult>;
}

function emitShutdownFailureEvent(): void {
  process.stderr.write(`${JSON.stringify({ event: "shutdown_failed", version: 1 })}\n`);
}

export async function runStdioServer(
  options: RunStdioServerOptions = {},
): Promise<StdioRuntimeHandle> {
  if (options.server && !options.runtimeActivity) {
    throw new Error("An injected MCP server requires its runtime activity tracker.");
  }
  prepareProjectRuntimeForStartup();
  const runtimeActivity = options.runtimeActivity ?? new RuntimeActivityTracker();
  runtimeActivity.prepareForStartup();
  const server = options.server ?? createServer({ runtimeActivity });
  const transport = options.transport ?? new StdioServerTransport();
  const send = transport.send.bind(transport);
  transport.send = (message, sendOptions) =>
    runtimeActivity.trackSend(() => send(message, sendOptions));
  const runtimePolicy = options.runtimePolicy ?? readRuntimePolicy();
  const installProcessHandlers = options.installProcessHandlers ?? true;
  const exit = options.exit ?? ((code: number): void => process.exit(code));
  const protocol = server.server;
  const previousTransportClose = protocol.onclose;
  let listenersInstalled = false;
  let terminalHandlerInstalled = false;

  const onSigint = (): void => requestFromRuntime("sigint");
  const onSigterm = (): void => requestFromRuntime("sigterm");
  const onStdinEnd = (): void => requestFromRuntime("stdin_eof");
  const onStdinClose = (): void => requestFromRuntime("stdin_eof");
  const onTransportClose = (): void => {
    previousTransportClose?.();
    requestFromRuntime("transport_closed");
  };

  const removeLifecycleListeners = (): void => {
    if (listenersInstalled) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      process.stdin.off("end", onStdinEnd);
      process.stdin.off("close", onStdinClose);
      listenersInstalled = false;
    }
    if (protocol.onclose === onTransportClose) protocol.onclose = previousTransportClose;
  };

  const coordinator = new ShutdownCoordinator({
    drainTimeoutMs: runtimePolicy.shutdownDrainTimeoutMs,
    stopAdmissionAndCancel: () => {
      runtimeActivity.beginShutdown();
      return beginProjectShutdown();
    },
    getDrainSnapshot: getProjectRuntimeShutdownSnapshot,
    waitForDrain: async () => {
      await Promise.all([waitForProjectOperationsToDrain(), runtimeActivity.waitForIdle()]);
    },
    waitForCompletionCriticalOperationsToDrain: waitForProjectCompletionCriticalOperationsToDrain,
    closeMcp: async () => {
      await server.close();
    },
    closeProjects: closeDrainedProjectSessions,
    emitIncompleteShutdown: emitIncompleteShutdownEvent,
    onCompletionCriticalWait: options.onCompletionCriticalWait,
  });
  let lifecycleCompletion: Promise<ShutdownResult> | undefined;

  function requestShutdown(trigger: ShutdownTrigger): Promise<ShutdownResult> {
    lifecycleCompletion ??= coordinator.shutdown(trigger).finally(removeLifecycleListeners);
    return lifecycleCompletion;
  }

  function requestFromRuntime(trigger: ShutdownTrigger): void {
    try {
      options.onRuntimeTrigger?.(trigger);
    } catch {
      // Runtime observation is non-authoritative and must never interrupt shutdown.
    }
    const completion = requestShutdown(trigger);
    if (terminalHandlerInstalled) return;
    terminalHandlerInstalled = true;
    void completion
      .then((result) => {
        if (result.state === "forced_noncritical") exit(1);
      })
      .catch(() => {
        emitShutdownFailureEvent();
        exit(1);
      });
  }

  protocol.onclose = onTransportClose;
  if (installProcessHandlers) {
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    process.stdin.once("end", onStdinEnd);
    process.stdin.once("close", onStdinClose);
    listenersInstalled = true;
  }

  try {
    await server.connect(transport);
  } catch (error) {
    await requestShutdown("requested").catch(() => undefined);
    throw error;
  }
  if (options.logStartup ?? true) process.stderr.write("ast-mcp-server running over stdio.\n");

  return Object.freeze({
    shutdown: (trigger: ShutdownTrigger = "requested") => requestShutdown(trigger),
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  }
}

if (isMainModule()) {
  runStdioServer().catch(() => {
    process.stderr.write("Fatal ast-mcp-server startup error.\n");
    process.exit(1);
  });
}
