#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { decode } from "@toon-format/toon";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repositoryRoot, "dist/index.js");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ast-mcp-stdio-"));
const client = new Client({ name: "ast-mcp-stdio-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: "pipe",
});

try {
  await mkdir(path.join(fixtureRoot, "src"), { recursive: true });
  await writeFile(
    path.join(fixtureRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, target: "ES2022" }, include: ["src/**/*"] }),
  );
  await writeFile(path.join(fixtureRoot, "src/value.ts"), "export const value = 1;\n");

  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  if (!names.includes("ast_list_files") || !names.includes("ast_apply_operation")) {
    throw new Error(`Expected AST tools were not registered: ${names.join(", ")}`);
  }

  const result = await client.callTool({
    name: "ast_list_files",
    arguments: { project_root: fixtureRoot, limit: 10 },
  });
  const files = result.structuredContent?.files;
  if (!Array.isArray(files) || !files.includes("src/value.ts")) {
    throw new Error(`Unexpected ast_list_files response: ${JSON.stringify(result)}`);
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
  if (toonPayload.total !== 1 || toonPayload.symbols?.[0]?.name !== "value") {
    throw new Error(`Unexpected decoded TOON payload: ${JSON.stringify(toonPayload)}`);
  }

  process.stdout.write(
    `${JSON.stringify({ status: "ok", transport: "stdio", tool_count: names.length, fixture_files: files.length, toon_output: true })}\n`,
  );
} finally {
  await client.close().catch(() => undefined);
  await rm(fixtureRoot, { recursive: true, force: true });
}
