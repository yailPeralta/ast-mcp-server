#!/usr/bin/env node
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { admitAgentFixture, verifyAgentFixtureDirectory } from "./lib/agent-fixtures.mjs";

const execute = promisify(execFile);
const fixtureDirectory = path.resolve("test/fixtures/agent-targets");

if (process.argv.includes("--check")) {
  const result = await verifyAgentFixtureDirectory(fixtureDirectory);
  process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
  process.exit(0);
}

const agent = process.argv[2];
const operation = process.argv[3];
const command = process.argv.slice(4);
if ((agent !== "gemini" && agent !== "copilot") || !operation || command.length === 0) {
  throw new Error("Usage: admit-agent-fixtures.mjs gemini|copilot <operation> <command...>");
}
const versionResult = await execute(command[0], ["--version"], {
  timeout: 10_000,
  maxBuffer: 256_000,
});
let result;
try {
  result = await execute(command[0], command.slice(1), { timeout: 15_000, maxBuffer: 1024 * 1024 });
} catch (error) {
  result = { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code ?? 1 };
}
const admitted = await admitAgentFixture(fixtureDirectory, {
  agent,
  operation,
  version: versionResult.stdout.trim(),
  command,
  cwd: process.cwd(),
  stdout: result.stdout,
  stderr: result.stderr,
  exitCode: typeof result.code === "number" ? result.code : 0,
});
process.stdout.write(`${JSON.stringify({ status: "admitted", file: admitted.fileName })}\n`);
