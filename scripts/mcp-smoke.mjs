#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { decode } from "@toon-format/toon";
import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = createRequire(import.meta.url)("../package.json").version;
const serverPath = path.join(repositoryRoot, "dist/index.js");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ast-mcp-stdio-"));
const client = new Client({ name: "ast-mcp-stdio-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: "pipe",
});
const stderrLines = [];
const stderrWaiters = [];

function queueStderrLine(line) {
  const waiter = stderrWaiters.shift();
  if (waiter === undefined) {
    stderrLines.push(line);
    return;
  }
  clearTimeout(waiter.timeout);
  waiter.resolve(line);
}

function nextStderrLine(timeoutMs = 5000) {
  const line = stderrLines.shift();
  if (line !== undefined) return Promise.resolve(line);
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      timeout: setTimeout(() => {
        const index = stderrWaiters.indexOf(waiter);
        if (index >= 0) stderrWaiters.splice(index, 1);
        reject(new Error("Timed out waiting for the server stderr event."));
      }, timeoutMs),
    };
    stderrWaiters.push(waiter);
  });
}

async function nextToolFailureEvent() {
  for (let lineCount = 0; lineCount < 10; lineCount += 1) {
    const line = await nextStderrLine();
    try {
      const event = JSON.parse(line);
      if (event?.event === "tool_failure") return { event, line };
    } catch {
      // Non-JSON dependency diagnostics are not tool failure events.
    }
  }
  throw new Error("No structured tool_failure event was observed on stderr.");
}

try {
  await mkdir(path.join(fixtureRoot, "src"), { recursive: true });
  await writeFile(
    path.join(fixtureRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, target: "ES2022" }, include: ["src/**/*"] }),
  );
  await writeFile(path.join(fixtureRoot, "src/value.ts"), "export const value = 1;\n");

  await client.connect(transport);
  const serverStderr = transport.stderr;
  if (serverStderr === null) {
    throw new Error("Expected the stdio transport to expose piped server stderr.");
  }
  let stderrBuffer = "";
  serverStderr.setEncoding("utf8");
  serverStderr.on("data", (chunk) => {
    stderrBuffer += chunk;
    let newlineIndex = stderrBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      queueStderrLine(stderrBuffer.slice(0, newlineIndex));
      stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
      newlineIndex = stderrBuffer.indexOf("\n");
    }
  });
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  if (
    names.length !== 15 ||
    !names.includes("ast_list_files") ||
    !names.includes("ast_get_project_status") ||
    !names.includes("ast_get_file") ||
    !names.includes("ast_explore") ||
    !names.includes("ast_get_impact") ||
    !names.includes("ast_scaffold_class") ||
    !names.includes("ast_apply_operation")
  ) {
    throw new Error(`Expected AST tools were not registered: ${names.join(", ")}`);
  }
  if (client.getServerVersion()?.version !== packageVersion) {
    throw new Error(
      `Expected stdio server version ${packageVersion}, got ${client.getServerVersion()?.version ?? "missing"}.`,
    );
  }

  const result = await client.callTool({
    name: "ast_list_files",
    arguments: { project_root: fixtureRoot, limit: 10 },
  });
  const files = result.structuredContent?.files;
  if (!Array.isArray(files) || !files.includes("src/value.ts")) {
    throw new Error(`Unexpected ast_list_files response: ${JSON.stringify(result)}`);
  }

  const statusResult = await client.callTool({
    name: "ast_get_project_status",
    arguments: { project_root: fixtureRoot },
  });
  const status = statusResult.structuredContent;
  if (
    statusResult.isError === true ||
    status?.state !== "fresh" ||
    status?.indexed_count !== 0 ||
    status?.operation_queue?.state !== "running"
  ) {
    throw new Error(`Unexpected ast_get_project_status response: ${JSON.stringify(statusResult)}`);
  }

  const fileResult = await client.callTool({
    name: "ast_get_file",
    arguments: { project_root: fixtureRoot, file_path: "src/value.ts", limit: 10 },
  });
  if (
    fileResult.isError === true ||
    fileResult.structuredContent?.mode !== "source" ||
    fileResult.structuredContent?.snapshot_state !== "fresh" ||
    fileResult.structuredContent?.lines?.[0]?.text !== "export const value = 1;"
  ) {
    throw new Error(`Unexpected ast_get_file response: ${JSON.stringify(fileResult)}`);
  }

  const exploreResult = await client.callTool({
    name: "ast_explore",
    arguments: { project_root: fixtureRoot, query: "value", detail: "summary" },
  });
  if (
    exploreResult.isError === true ||
    exploreResult.structuredContent?.route !== "query" ||
    exploreResult.structuredContent?.total !== 1 ||
    exploreResult.structuredContent?.symbols?.[0]?.selector !== "value@1"
  ) {
    throw new Error(`Unexpected ast_explore response: ${JSON.stringify(exploreResult)}`);
  }

  const toonResult = await client.callTool({
    name: "ast_search_symbols",
    arguments: { project_root: fixtureRoot, query: "value", output_format: "toon" },
  });
  const envelope = toonResult.structuredContent;
  if (
    toonResult.isError === true ||
    envelope?.format !== "toon" ||
    typeof envelope.data !== "string"
  ) {
    throw new Error(`Unexpected TOON response: ${JSON.stringify(toonResult)}`);
  }
  const toonPayload = decode(envelope.data);
  if (
    toonPayload.total !== 1 ||
    toonPayload.limit !== 20 ||
    toonPayload.symbols?.[0]?.selector !== "value@1"
  ) {
    throw new Error(`Unexpected decoded TOON payload: ${JSON.stringify(toonPayload)}`);
  }

  const hostileValues = [
    "/home/yail/private/source.ts",
    "opaque-stdio-token",
    'export const leaked = "source-body";',
    "Error: hostile stack",
  ];
  const hostileFilePath = [
    "src/missing.ts",
    "Authorization: Bearer opaque-stdio-token",
    "Error: hostile stack",
    "    at /home/yail/private/source.ts:42:1",
    'export const leaked = "source-body";',
  ].join("\n");
  const failureEventPromise = nextToolFailureEvent();
  const [hostileResult, { event: failureEvent, line: failureEventLine }] = await Promise.all([
    client.callTool({
      name: "ast_get_file",
      arguments: { project_root: fixtureRoot, file_path: hostileFilePath, limit: 10 },
    }),
    failureEventPromise,
  ]);
  const errorText = hostileResult.content?.[0]?.text;
  if (
    hostileResult.isError !== true ||
    hostileResult.structuredContent !== undefined ||
    hostileResult.content?.length !== 1 ||
    hostileResult.content?.[0]?.type !== "text" ||
    typeof errorText !== "string" ||
    Buffer.byteLength(errorText, "utf8") > 4096
  ) {
    throw new Error(`Unexpected hostile error response: ${JSON.stringify(hostileResult)}`);
  }
  const publicError = JSON.parse(errorText).error;
  if (
    publicError?.code !== "INTERNAL_ERROR" ||
    publicError?.message !== "An internal error occurred." ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      publicError?.correlation_id,
    )
  ) {
    throw new Error(`Unexpected public error envelope: ${errorText}`);
  }
  if (
    Buffer.byteLength(`${failureEventLine}\n`, "utf8") > 8192 ||
    failureEvent.correlation_id !== publicError.correlation_id ||
    failureEvent.tool !== "ast_get_file" ||
    failureEvent.code !== publicError.code ||
    failureEvent.message !== publicError.message ||
    !/^project_[0-9a-f]{20}$/.test(failureEvent.project_id)
  ) {
    throw new Error(`Unexpected correlated stderr event: ${failureEventLine}`);
  }
  const publicArtifacts = `${errorText}\n${failureEventLine}`;
  for (const hostileValue of [...hostileValues, fixtureRoot]) {
    if (publicArtifacts.includes(hostileValue)) {
      throw new Error("Hostile input leaked through the public error boundary.");
    }
  }

  process.stdout.write(
    `${JSON.stringify({ status: "ok", transport: "stdio", tool_count: names.length, fixture_files: files.length, toon_output: true, hostile_error: true, stderr_correlation: true })}\n`,
  );
} finally {
  await client.close().catch(() => undefined);
  await rm(fixtureRoot, { recursive: true, force: true });
}
