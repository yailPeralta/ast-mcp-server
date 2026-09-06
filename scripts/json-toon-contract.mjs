#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { decode } from "@toon-format/toon";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { clearTimeout, setTimeout } from "node:timers";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_TOOLS = [
  "ast_search_symbols",
  "ast_find_references",
  "ast_get_impact",
  "ast_get_diagnostics",
];
const EXPECTED_CHECKS = [
  "sequential-json-then-toon",
  "identical-semantic-input",
  "json-canonical-schema",
  "empty-content",
  "toon-exact-envelope",
  "lossless-normalized-equality",
  "stable-canonical-bytes",
  "stable-sha256",
  "schema-eligibility",
  "unsupported-omission",
  "timeout",
  "process-cleanup",
];
const EXPECTED_CASES = {
  ast_search_symbols: ["symbols-unicode-page", "symbols-empty"],
  ast_find_references: ["references-context-page", "references-empty-page"],
  ast_get_impact: ["impact-truncated", "impact-depth-zero"],
  ast_get_diagnostics: ["diagnostics-aggregate-page", "diagnostics-clean-empty"],
};

// prettier-ignore
export const CONTRACT_MANIFEST = Object.freeze({
  tools: Object.freeze([
    { name: "ast_search_symbols", cases: [{ id: "symbols-unicode-page" }, { id: "symbols-empty" }] },
    { name: "ast_find_references", cases: [{ id: "references-context-page" }, { id: "references-empty-page" }] },
    { name: "ast_get_impact", cases: [{ id: "impact-truncated" }, { id: "impact-depth-zero" }] },
    { name: "ast_get_diagnostics", cases: [{ id: "diagnostics-aggregate-page" }, { id: "diagnostics-clean-empty" }] },
  ]), checks: Object.freeze(EXPECTED_CHECKS), normalizedKeys: Object.freeze(["duration_ms", "checked_at"]),
});
export const BEHAVIORAL_PROBE_IDS = Object.freeze([
  "json-canonical-rejection",
  "json-content-rejection",
  "toon-envelope-rejection",
  "toon-decode-rejection",
  "semantic-equality-rejection",
  "bounded-cleanup-rejection",
  "two-run-evidence-rejection",
]);

// prettier-ignore
function fail(kind, message) { throw new Error(`F01 ${kind}: ${message}`); }
// prettier-ignore
function exact(actual, expected) { return actual.length === expected.length && actual.every((value, index) => value === expected[index]); }
// prettier-ignore
export function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.tools)) fail("admission", "manifest tools are absent");
  const names = manifest.tools.map(({ name }) => name);
  if (!exact(names, EXPECTED_TOOLS)) fail("admission", "tool inventory is not exact");
  const ids = manifest.tools.flatMap(({ cases }) => Array.isArray(cases) ? cases.map(({ id }) => id) : []);
  if (ids.length !== 8 || new Set(ids).size !== 8 || manifest.tools.some(({ name, cases }) => !Array.isArray(cases) || !exact(cases.map(({ id }) => id), EXPECTED_CASES[name] ?? []))) fail("admission", "case inventory or tool mapping is not exact");
  if (!Array.isArray(manifest.checks) || !exact(manifest.checks, EXPECTED_CHECKS)) fail("admission", "check inventory is not exact");
  if (!Array.isArray(manifest.normalizedKeys) || !exact(manifest.normalizedKeys, ["duration_ms", "checked_at"])) fail("admission", "normalization key inventory is not exact");
}

// prettier-ignore
const INPUTS = {
  "symbols-unicode-page": { query: "caf", detail: "full", offset: 0, limit: 1 },
  "symbols-empty": { query: "不存在", detail: "selectors", offset: 0, limit: 2 },
  "references-context-page": { file_path: "src/api.ts", symbol_path: "café", include_declaration: true, detail: "context", offset: 0, limit: 1 },
  "references-empty-page": { file_path: "src/api.ts", symbol_path: "café", include_declaration: true, detail: "locations", offset: 99, limit: 1 },
  "impact-truncated": { file_path: "src/api.ts", symbol_path: "café", direction: "incoming", max_depth: 3, max_nodes: 1, max_edges: 8 },
  "impact-depth-zero": { file_path: "src/api.ts", symbol_path: "café", direction: "both", max_depth: 0, max_nodes: 8, max_edges: 8, relationship_kinds: [] },
  "diagnostics-aggregate-page": { include_aggregates: true, offset: 0, limit: 1 },
  "diagnostics-clean-empty": { file_path: "src/clean.ts", offset: 0, limit: 2 },
};
// prettier-ignore
const TOP_KEYS = {
  ast_search_symbols: ["duration_ms", "has_more", "limit", "next_offset", "offset", "symbols", "total"],
  ast_find_references: ["affected_files", "declaration_count", "has_more", "include_declaration", "limit", "next_offset", "offset", "reference_count", "references", "symbol", "total"],
  ast_get_impact: ["direction", "edges", "freshness", "incomplete", "max_depth", "max_depth_reached", "max_edges", "max_nodes", "nodes", "relationship_kinds", "root", "truncation", "truncation_reasons", "visited_edges", "visited_nodes"],
  ast_get_diagnostics: ["diagnostics", "duration_ms", "error_count", "has_more", "limit", "next_offset", "offset", "total", "warning_count"],
};

// prettier-ignore
function normalize(value, key = "") {
  if (key === "duration_ms") return 0;
  if (key === "checked_at") return "<normalized>";
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((name) => [name, normalize(value[name], name)]));
  return value;
}
// prettier-ignore
function canonicalBytes(value) { return Buffer.from(JSON.stringify(normalize(value)), "utf8"); }
// prettier-ignore
function assertFinite(value) {
  if (typeof value === "number" && !Number.isFinite(value)) fail("json-shape", "non-finite number");
  if (Array.isArray(value)) value.forEach(assertFinite);
  else if (value && typeof value === "object") Object.values(value).forEach(assertFinite);
}
// prettier-ignore
function assertCanonical(tool, id, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("json-shape", `${id} is not an object`);
  const keys = [...TOP_KEYS[tool], ...(id === "diagnostics-aggregate-page" ? ["aggregates"] : [])].sort();
  if (!exact(Object.keys(value).sort(), keys)) fail("json-shape", `${id} top-level schema inventory drifted`);
  assertFinite(value);
  const collection = value.symbols ?? value.references ?? value.nodes ?? value.diagnostics;
  if (!Array.isArray(collection)) fail("json-shape", `${id} collection is absent`);
  if (id.includes("empty") && collection.length !== 0) fail("json-shape", `${id} must be empty`);
  if (id === "symbols-unicode-page" && !(value.total > 1 && value.limit === 1 && value.has_more === true && JSON.stringify(value).includes("café"))) fail("json-shape", "Unicode pagination was not exercised");
  if (id === "references-context-page" && !(value.references[0]?.context?.includes("café") && typeof value.references[0]?.is_declaration === "boolean")) fail("json-shape", "reference context/boolean was not exercised");
  if (id === "references-empty-page" && value.has_more !== false) fail("json-shape", "empty reference page must be terminal");
  if (id === "impact-truncated" && !(value.incomplete === true && value.truncation?.truncated === true)) fail("json-shape", "impact bound did not truncate");
  if (id === "impact-depth-zero" && !(value.truncation?.reason === null && value.relationship_kinds.length === 0)) fail("json-shape", "impact null/empty shape absent");
  if (id === "diagnostics-aggregate-page" && !(value.aggregates && value.diagnostics.length === 1 && Number.isInteger(value.diagnostics[0]?.code))) fail("json-shape", "diagnostic aggregates/numeric code absent");
  if (id === "diagnostics-clean-empty" && Object.hasOwn(value, "aggregates")) fail("json-shape", "optional aggregates must be omitted");
}
// prettier-ignore
function assertJsonContent(result) { if (!exact(result.content ?? [], [])) fail("json-shape", "JSON content must be empty"); }
// prettier-ignore
function assertToonEnvelope(envelope) {
  if (!envelope || !exact(Object.keys(envelope).sort(), ["data", "format"]) || envelope.format !== "toon" || typeof envelope.data !== "string") fail("toon-envelope/decode", "TOON envelope drifted");
  return envelope;
}
// prettier-ignore
function decodeToon(envelope) { try { return decode(envelope.data); } catch { fail("toon-envelope/decode", "TOON data did not decode"); } }
// prettier-ignore
function assertSemanticEquality(jsonBytes, toonBytes) { if (!jsonBytes.equals(toonBytes)) fail("semantic-mismatch", "canonical values differ"); }
// prettier-ignore
function withTimeout(promise, label, timeoutMs = 20_000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`F01 transport/process: timed out during ${label}`)), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
// prettier-ignore
function processAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
// prettier-ignore
async function cleanupOwned(client, roots, ownedPids, alive = processAlive, timeoutMs = 20_000) {
  let closeError;
  try { await withTimeout(client.close(), "cleanup:client-close", timeoutMs); } catch (error) { closeError = error; }
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  if (closeError) throw closeError;
  if (ownedPids.some(alive)) fail("cleanup", "owned process remained alive after close");
}

// prettier-ignore
async function prepareProject(root) {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", noEmit: true }, include: ["src/**/*"] }));
  await writeFile(path.join(root, "src/api.ts"), "export function café(value: number): string {\n  return `valor:${value}`;\n}\nexport function cafeAux(value: number): string { return café(value); }\n");
  await writeFile(path.join(root, "src/use.ts"), "import { café } from './api.js';\nexport const línea = café(2);\nexport const multiline = café(\n  3,\n);\n");
  await writeFile(path.join(root, "src/error.ts"), "export const número: string = 42;\n");
  await writeFile(path.join(root, "src/clean.ts"), "export const limpio = true;\n");
}

// prettier-ignore
export async function runContract() {
  validateManifest(CONTRACT_MANIFEST);
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ast-f01-project-"));
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "ast-f01-runtime-"));
  const client = new Client({ name: "ast-json-toon-contract", version: "1.0.0" });
  const env = { ...process.env, HOME: path.join(runtimeRoot, "home"), XDG_CACHE_HOME: path.join(runtimeRoot, "cache") };
  delete env.AST_SYMBOL_INDEX_PERSISTENCE;
  delete env.AST_SYMBOL_INDEX_CACHE_ROOT;
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "dist/index.js")], env, stderr: "pipe" });
  const evidence = [];
  try {
    await Promise.all([prepareProject(projectRoot), mkdir(env.HOME, { recursive: true }), mkdir(env.XDG_CACHE_HOME, { recursive: true })]);
    await withTimeout(client.connect(transport), "connect");
    const listed = (await withTimeout(client.listTools(), "tools/list")).tools;
    const eligible = listed.filter((tool) => Object.hasOwn(tool.inputSchema.properties ?? {}, "output_format"));
    if (!exact(eligible.map(({ name }) => name).sort(), [...EXPECTED_TOOLS].sort())) fail("schema-inventory", "registered eligibility is not exact");
    for (const tool of listed) {
      const output = tool.inputSchema.properties?.output_format;
      if (EXPECTED_TOOLS.includes(tool.name)) {
        if (!output || !exact(output.enum ?? [], ["json", "toon"]) || output.default !== "json" || tool.outputSchema !== undefined) fail("schema-inventory", `${tool.name} format schema drifted`);
      } else if (output !== undefined) fail("schema-inventory", `${tool.name} unexpectedly supports output_format`);
    }
    for (const tool of CONTRACT_MANIFEST.tools) for (const { id } of tool.cases) {
      const base = { project_root: projectRoot, ...INPUTS[id] };
      const json = await withTimeout(client.callTool({ name: tool.name, arguments: { ...base, output_format: "json" } }), `${id}:json`);
      const toon = await withTimeout(client.callTool({ name: tool.name, arguments: { ...base, output_format: "toon" } }), `${id}:toon`);
      if (json.isError || toon.isError || !exact(toon.content ?? [], [])) fail("json-shape", `${id} did not return empty-content success`);
      assertJsonContent(json);
      assertCanonical(tool.name, id, json.structuredContent);
      const envelope = assertToonEnvelope(toon.structuredContent);
      const decoded = decodeToon(envelope);
      assertCanonical(tool.name, id, decoded);
      const jsonBytes = canonicalBytes(json.structuredContent);
      const toonBytes = canonicalBytes(decoded);
      assertSemanticEquality(jsonBytes, toonBytes);
      evidence.push({ id, tool: tool.name, bytes: jsonBytes.length, sha256: createHash("sha256").update(jsonBytes).digest("hex") });
    }
    const reportBytes = canonicalBytes({ cases: evidence, calls: evidence.length * 2, normalized_keys: CONTRACT_MANIFEST.normalizedKeys });
    return { status: "ok", transport: "stdio", tools: 4, cases: 8, calls: 16, normalized_keys: CONTRACT_MANIFEST.normalizedKeys, cases_evidence: evidence, canonical_bytes: reportBytes.length, sha256: createHash("sha256").update(reportBytes).digest("hex"), cleanup: "close-before-remove" };
  } finally {
    const ownedPids = transport.pid === null ? [] : [transport.pid];
    await cleanupOwned(client, [projectRoot, runtimeRoot], ownedPids);
  }
}

// prettier-ignore
function sameEvidence(first, second) {
  if (first.canonical_bytes !== second.canonical_bytes || first.sha256 !== second.sha256) fail("determinism", "two-run canonical bytes or SHA-256 differ");
}
// prettier-ignore
async function expectRejected(id, kind, action) {
  try { await action(); } catch (error) {
    if (error instanceof Error && error.message.startsWith(`F01 ${kind}:`)) return id;
    throw error;
  }
  fail("admission", `${id} probe did not reject its deterministic fault`);
}
// prettier-ignore
export async function runBehavioralProbes() {
  const results = [];
  results.push(await expectRejected(BEHAVIORAL_PROBE_IDS[0], "json-shape", () => assertCanonical("ast_search_symbols", "symbols-empty", null)));
  results.push(await expectRejected(BEHAVIORAL_PROBE_IDS[1], "json-shape", () => assertJsonContent({ content: [{ type: "text", text: "unexpected" }] })));
  results.push(await expectRejected(BEHAVIORAL_PROBE_IDS[2], "toon-envelope/decode", () => assertToonEnvelope({ format: "toon", data: "ok", extra: true })));
  results.push(await expectRejected(BEHAVIORAL_PROBE_IDS[3], "toon-envelope/decode", () => decodeToon({ data: null })));
  results.push(await expectRejected(BEHAVIORAL_PROBE_IDS[4], "semantic-mismatch", () => assertSemanticEquality(Buffer.from("json"), Buffer.from("toon"))));
  await expectRejected("cleanup-timeout", "transport/process", () => cleanupOwned({ close: () => new Promise(() => {}) }, [], [], processAlive, 5));
  results.push(await expectRejected(BEHAVIORAL_PROBE_IDS[5], "cleanup", () => cleanupOwned({ close: async () => {} }, [], [4242], () => true, 5)));
  results.push(await expectRejected(BEHAVIORAL_PROBE_IDS[6], "determinism", () => sameEvidence({ canonical_bytes: 1, sha256: "a" }, { canonical_bytes: 2, sha256: "b" })));
  return results;
}
// prettier-ignore
export async function runContractTwice() {
  const first = await runContract();
  const second = await runContract();
  sameEvidence(first, second);
  return { ...second, runs: 2 };
}

// prettier-ignore
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runContractTwice().then((report) => process.stdout.write(`${JSON.stringify(report)}\n`)).catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
