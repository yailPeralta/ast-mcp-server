#!/usr/bin/env node

import { Buffer } from "node:buffer";
import process from "node:process";
import { createToolErrorContext, errorResult } from "../dist/tools/result.js";

const hostileValues = [
  "/home/yail/private/source.ts",
  "C:\\Users\\Yail\\private\\source.ts",
  "\\\\server\\share\\private\\source.ts",
  "opaque-compiled-token",
  "mongodb://user:opaque-password@localhost/private",
  'export const leaked = "source-body";',
  "Error: hostile stack",
];
const hostileError = new Error(
  [
    "failed to inspect source",
    ...hostileValues,
    "Authorization: Bearer opaque-compiled-token",
    "    at privateFrame (/home/yail/private/source.ts:42:1)",
  ].join("\n"),
);
Object.defineProperty(hostileError, "stack", {
  configurable: true,
  value: hostileValues.join("\n"),
});

const stderrWrites = [];
const originalStderrWrite = process.stderr.write;
process.stderr.write = (chunk) => {
  stderrWrites.push(String(chunk));
  return true;
};

let result;
try {
  result = errorResult(
    hostileError,
    createToolErrorContext("ast_get_file", "/home/yail/private/project"),
  );
} finally {
  process.stderr.write = originalStderrWrite;
}

if (
  result.isError !== true ||
  result.structuredContent !== undefined ||
  result.content.length !== 1 ||
  result.content[0]?.type !== "text"
) {
  throw new Error(`Unexpected compiled public error result: ${JSON.stringify(result)}`);
}
const responseText = result.content[0].text;
if (Buffer.byteLength(responseText, "utf8") > 4096 || responseText.includes("\n")) {
  throw new Error("Compiled public error response exceeded its compact JSON contract.");
}
const publicError = JSON.parse(responseText).error;
if (
  publicError?.code !== "INTERNAL_ERROR" ||
  publicError?.message !== "An internal error occurred." ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    publicError?.correlation_id,
  )
) {
  throw new Error(`Unexpected compiled public error envelope: ${responseText}`);
}
if (stderrWrites.length !== 1 || !stderrWrites[0].endsWith("\n")) {
  throw new Error(`Expected exactly one structured stderr line, got ${stderrWrites.length}.`);
}
const stderrLine = stderrWrites[0];
if (Buffer.byteLength(stderrLine, "utf8") > 8192) {
  throw new Error("Compiled tool failure stderr event exceeded 8192 bytes.");
}
const failureEvent = JSON.parse(stderrLine.trim());
if (
  failureEvent.event !== "tool_failure" ||
  failureEvent.version !== 1 ||
  failureEvent.correlation_id !== publicError.correlation_id ||
  failureEvent.tool !== "ast_get_file" ||
  failureEvent.code !== publicError.code ||
  failureEvent.message !== publicError.message ||
  !/^project_[0-9a-f]{20}$/.test(failureEvent.project_id)
) {
  throw new Error(`Unexpected compiled stderr event: ${stderrLine}`);
}
const publicArtifacts = `${responseText}\n${stderrLine}`;
for (const hostileValue of hostileValues) {
  if (publicArtifacts.includes(hostileValue)) {
    throw new Error("Hostile data leaked from the compiled public error boundary.");
  }
}

process.stdout.write(
  `${JSON.stringify({ status: "ok", compiled: true, hostile_error: true, stderr_correlation: true })}\n`,
);
