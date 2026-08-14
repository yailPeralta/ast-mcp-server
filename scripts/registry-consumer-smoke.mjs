#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { applyPatch } from "diff";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const repositoryRoot = path.resolve(scriptDirectory, "..");
const PACKAGE_NAME = "ast-mcp-server";
const OFFICIAL_REGISTRY = "https://registry.npmjs.org";
const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const SRI_PATTERN = /^(sha(?:256|384|512))-([A-Za-z0-9+/]+={0,2})$/u;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_TARBALL_BYTES = 50 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const NETWORK_TIMEOUT_MS = 20_000;
const EXPECTED_TOOLS = Object.freeze([
  "ast_list_files",
  "ast_get_project_status",
  "ast_explore",
  "ast_get_outline",
  "ast_get_symbol_source",
  "ast_search_symbols",
  "ast_find_references",
  "ast_get_impact",
  "ast_get_diagnostics",
  "ast_get_file",
  "ast_rename_symbol",
  "ast_replace_symbol_body",
  "ast_scaffold_class",
  "ast_get_operation_preview",
  "ast_apply_operation",
]);

function fail(message) {
  throw new Error(`Registry consumer smoke failed: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object.`);
  return value;
}

function parseJson(text, label) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
    fail(`${label} exceeds the bounded JSON size.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} must be valid JSON.`);
  }
}

function requireVersion(value) {
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) {
    fail("--version must be a stable semantic version without a v prefix.");
  }
  return value;
}

function requireSha(value) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    fail("--expected-sha must be a lowercase 40-character SHA.");
  }
  return value;
}

function requireRegistry(value) {
  if (value !== OFFICIAL_REGISTRY) fail(`--registry must be exactly ${OFFICIAL_REGISTRY}.`);
  return value;
}

function requireOutputPath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    fail(`${label} must be an absolute path.`);
  }
  const normalized = path.normalize(value);
  if (
    normalized !== value ||
    value === repositoryRoot ||
    value.startsWith(`${repositoryRoot}${path.sep}`)
  ) {
    fail(`${label} must be normalized and outside the source tree.`);
  }
  return value;
}

function parseArguments(argv) {
  const expected = new Set([
    "--version",
    "--expected-sha",
    "--registry",
    "--metadata-output",
    "--audit-output",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!expected.has(key) || typeof value !== "string" || values.has(key)) {
      fail("arguments must contain each reviewed flag exactly once.");
    }
    values.set(key, value);
  }
  if (values.size !== expected.size)
    fail("all reviewed output and release arguments are required.");
  const outputs = {
    metadata: requireOutputPath(values.get("--metadata-output"), "--metadata-output"),
    audit: requireOutputPath(values.get("--audit-output"), "--audit-output"),
    consumer: requireOutputPath(values.get("--output"), "--output"),
  };
  if (new Set(Object.values(outputs)).size !== 3) fail("evidence output paths must be distinct.");
  return {
    version: requireVersion(values.get("--version")),
    sha: requireSha(values.get("--expected-sha")),
    registry: requireRegistry(values.get("--registry")),
    outputs,
  };
}

async function readResponse(response, label, limit) {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) fail(`${label} exceeds its size limit.`);
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      fail(`${label} exceeds its size limit.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

async function fetchBytes(url, label, limit) {
  let response;
  try {
    response = await globalThis.fetch(url, {
      headers: { Accept: "application/json, application/octet-stream" },
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
  } catch {
    fail(`${label} request failed or timed out.`);
  }
  if (!response.ok) fail(`${label} returned HTTP ${response.status}.`);
  return readResponse(response, label, limit);
}

async function fetchJson(url, label) {
  return parseJson((await fetchBytes(url, label, MAX_JSON_BYTES)).toString("utf8"), label);
}

function normalizedRegistryMetadata(versionDocument, packageDocument, version, sha) {
  const versionObject = object(versionDocument, "registry version metadata");
  const packageObject = object(packageDocument, "registry package metadata");
  const dist = object(versionObject.dist, "registry dist metadata");
  const engines = object(versionObject.engines, "registry engines metadata");
  const attestations = object(dist.attestations, "registry attestations");
  const provenance = object(attestations.provenance, "registry provenance");
  const distTags = object(packageObject["dist-tags"], "registry dist-tags");
  const expectedTarball = `${OFFICIAL_REGISTRY}/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${version}.tgz`;
  const expectedAttestation = `${OFFICIAL_REGISTRY}/-/npm/v1/attestations/${PACKAGE_NAME}@${version}`;
  if (
    versionObject.name !== PACKAGE_NAME ||
    versionObject.version !== version ||
    versionObject.gitHead !== sha ||
    engines.node !== ">=22.5.0" ||
    typeof dist.integrity !== "string" ||
    !SRI_PATTERN.test(dist.integrity) ||
    dist.tarball !== expectedTarball ||
    attestations.url !== expectedAttestation ||
    provenance.predicateType !== SLSA_PROVENANCE_V1 ||
    distTags.next !== version ||
    typeof distTags.latest !== "string"
  ) {
    fail(
      "official registry metadata, gitHead, dist-tags, integrity, or provenance does not match.",
    );
  }
  return {
    name: PACKAGE_NAME,
    version,
    gitHead: sha,
    engines: { node: ">=22.5.0" },
    dist: {
      integrity: dist.integrity,
      tarball: expectedTarball,
      attestations: {
        url: expectedAttestation,
        provenance: { predicateType: SLSA_PROVENANCE_V1 },
      },
    },
    dist_tags: { next: version, latest: distTags.latest },
  };
}

async function verifyTarball(metadata) {
  const match = SRI_PATTERN.exec(metadata.dist.integrity);
  if (match === null) fail("registry integrity is not a supported SRI value.");
  const tarball = await fetchBytes(metadata.dist.tarball, "registry tarball", MAX_TARBALL_BYTES);
  const expected = Buffer.from(match[2], "base64");
  const actual = createHash(match[1]).update(tarball).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    fail("registry tarball bytes do not match dist.integrity.");
  }
}

async function execute(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, {
      encoding: "utf8",
      maxBuffer: MAX_JSON_BYTES,
      timeout: COMMAND_TIMEOUT_MS,
      ...options,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.slice(0, 2_000) : "";
    throw new Error(
      `Registry consumer command failed: ${path.basename(file)} ${args[0] ?? ""}${stderr ? `\n${stderr}` : ""}`,
      { cause: error },
    );
  }
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonExclusive(filePath, value) {
  const bytes = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(bytes, "utf8") > MAX_JSON_BYTES)
    fail("evidence output exceeds its size limit.");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function createFixture(root) {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "registry-consumer-fixture", private: true, type: "module" })}\n`,
  );
  await writeFile(
    path.join(root, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true }, include: ["src/**/*.ts"] })}\n`,
  );
  await writeFile(
    path.join(root, "src", "value.ts"),
    "export function formatValue(value: number): string { return `value:${value}`; }\nexport function doubleValue(value: number): number { return value * 2; }\n",
  );
  await writeFile(
    path.join(root, "src", "use.ts"),
    'import { formatValue } from "./value.js";\nexport const rendered = formatValue(3);\n',
  );
  await writeFile(
    path.join(root, "src", "conflict.ts"),
    "export function conflictValue(): number { return 1; }\n",
  );
}

export async function createFakeAgents(root) {
  const binRoot = path.join(root, "fake-bin");
  await mkdir(binRoot, { recursive: true });
  const fakeAgentSource = path.join(repositoryRoot, "scripts", "fixtures", "fake-agent.mjs");
  await writeFile(path.join(binRoot, "package.json"), '{"type":"module"}\n', "utf8");
  for (const name of ["claude", "hermes"]) {
    const executable = path.join(binRoot, name);
    await copyFile(fakeAgentSource, executable);
    await chmod(executable, 0o755);
  }
  return binRoot;
}

async function verifySetupIdempotency(consumerRoot, installedPackageRoot) {
  const setupRoot = path.join(consumerRoot, "setup");
  const fakeBin = await createFakeAgents(setupRoot);
  const cliEntry = path.join(consumerRoot, "node_modules", ".bin", "ast-tool");
  const claudeRoot = path.join(setupRoot, "claude");
  const hermesRoot = path.join(setupRoot, "hermes");
  const environment = {
    ...process.env,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    FAKE_CLAUDE_STATE: path.join(setupRoot, "claude-state.json"),
    FAKE_HERMES_STATE: path.join(setupRoot, "hermes-state.json"),
    CLAUDE_CONFIG_DIR: claudeRoot,
    HERMES_HOME: hermesRoot,
  };
  const humanClaudeGuidance = "# Registry consumer rules\n\nPreserve these bytes.\n";
  await mkdir(claudeRoot, { recursive: true });
  await writeFile(path.join(claudeRoot, "CLAUDE.md"), humanClaudeGuidance, "utf8");
  const args = ["setup", "--agents", "all", "--yes"];
  const first = object(
    parseJson(
      (await execute(cliEntry, args, { cwd: consumerRoot, env: environment })).stdout,
      "first installed setup result",
    ),
    "first installed setup result",
  );
  const second = object(
    parseJson(
      (await execute(cliEntry, args, { cwd: consumerRoot, env: environment })).stdout,
      "second installed setup result",
    ),
    "second installed setup result",
  );
  if (
    !Array.isArray(first.agents) ||
    first.agents.length !== 2 ||
    first.version !== 2 ||
    !first.agents.every(
      (item) => isPlainObject(item) && item.skill === "installed" && item.mcp === "configured",
    ) ||
    first.agents.find((item) => item.agent === "claude")?.guidance !== "updated" ||
    first.agents.find((item) => item.agent === "hermes")?.guidance !== "skill_only"
  ) {
    fail("installed setup did not configure MCP, skills, and managed guidance.");
  }
  if (
    !Array.isArray(second.agents) ||
    second.agents.length !== 2 ||
    !second.agents.every(
      (item) =>
        isPlainObject(item) &&
        item.skill === "unchanged" &&
        item.mcp === "unchanged" &&
        (item.guidance === "unchanged" || item.guidance === "skill_only"),
    ) ||
    !Array.isArray(second.physical_writes) ||
    second.physical_writes.length !== 0
  ) {
    fail("installed setup replay was not a zero-write convergence.");
  }
  const [claudeSkill, hermesSkill, packagedSkill, packagedGuidance, packagedReleases] =
    await Promise.all([
      readFile(path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md"), "utf8"),
      readFile(
        path.join(
          hermesRoot,
          "skills",
          "software-development",
          "structural-code-editing",
          "SKILL.md",
        ),
        "utf8",
      ),
      readFile(
        path.join(installedPackageRoot, "skills", "structural-code-editing", "SKILL.md"),
        "utf8",
      ),
      readFile(
        path.join(installedPackageRoot, "skills", "structural-code-editing", "guidance.md"),
        "utf8",
      ),
      readFile(
        path.join(installedPackageRoot, "skills", "structural-code-editing", "releases.json"),
        "utf8",
      ),
    ]);
  if (
    !packagedSkill.includes("name: structural-code-editing") ||
    claudeSkill !== packagedSkill ||
    hermesSkill !== packagedSkill ||
    packagedGuidance.includes("ast-tool:structural-code-editing guidance") ||
    JSON.parse(packagedReleases).current?.version !== "4.2.0"
  ) {
    fail("installed setup did not preserve all bundled managed assets.");
  }
  const claudeGuidance = await readFile(path.join(claudeRoot, "CLAUDE.md"), "utf8");
  const discovery = parseJson(
    (
      await execute(path.join(fakeBin, "claude"), ["debug", "instructions"], {
        cwd: consumerRoot,
        env: environment,
      })
    ).stdout,
    "fake Claude instruction discovery",
  );
  if (
    !claudeGuidance.startsWith(humanClaudeGuidance) ||
    claudeGuidance.split("<!-- ast-tool:structural-code-editing guidance v1 begin -->").length !==
      2 ||
    discovery.content !== claudeGuidance
  ) {
    fail("installed setup did not preserve or expose effective managed guidance exactly once.");
  }
}

function auditHasNoVulnerabilities(report) {
  const metadata = object(report?.metadata, "consumer audit metadata");
  const vulnerabilities = object(metadata.vulnerabilities, "consumer audit vulnerability counts");
  return Object.values(vulnerabilities).every(
    (count) => Number.isSafeInteger(count) && count === 0,
  );
}

function minimalChildEnvironment(home, temp) {
  const environment = {
    HOME: home,
    TMPDIR: temp,
    PATH: process.env.PATH ?? "",
    LANG: "C.UTF-8",
  };
  if (process.env.SystemRoot !== undefined) environment.SystemRoot = process.env.SystemRoot;
  return environment;
}

function publicNpmEnvironment(home, temp, userconfig) {
  return {
    HOME: home,
    TMPDIR: temp,
    PATH: process.env.PATH ?? "",
    LANG: "C.UTF-8",
    CI: "true",
    NPM_CONFIG_USERCONFIG: userconfig,
    NPM_CONFIG_CACHE: path.join(temp, "npm-cache"),
  };
}

function structured(result, label) {
  if (
    !isPlainObject(result) ||
    result.isError === true ||
    !isPlainObject(result.structuredContent)
  ) {
    fail(`${label} did not return structured MCP content.`);
  }
  return result.structuredContent;
}

function assertPrepared(prepared, kind, expectedFiles) {
  const actualFiles = Array.isArray(prepared.affected_files)
    ? prepared.affected_files.map((entry) => object(entry, "prepared affected file").file).sort()
    : [];
  if (
    prepared.kind !== kind ||
    prepared.status !== "prepared" ||
    prepared.blocked !== false ||
    prepared.block_reason !== null ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      prepared.operation_id,
    ) ||
    !/^[0-9a-f]{64}$/u.test(prepared.plan_hash) ||
    JSON.stringify(actualFiles) !== JSON.stringify([...expectedFiles].sort()) ||
    !isPlainObject(prepared.diagnostics) ||
    !Array.isArray(prepared.diagnostics.added_errors) ||
    prepared.diagnostics.added_errors.length !== 0 ||
    prepared.allow_new_errors !== false
  ) {
    fail(`${kind} did not produce an unblocked hash-bound plan.`);
  }
}

async function readPostimages(projectRoot, expectedFiles) {
  return Promise.all(expectedFiles.map((file) => readOptionalFile(path.join(projectRoot, file))));
}

function assertPostimagesUnchanged(before, after, label) {
  if (
    before.some((bytes, index) => {
      const current = after[index];
      return bytes === null ? current !== null : current === null || !bytes.equals(current);
    })
  ) {
    fail(`${label} changed files before an authorized apply.`);
  }
}

function expectedPostimageBytes(expectedFiles, expectedPostimages) {
  if (
    !isPlainObject(expectedPostimages) ||
    JSON.stringify(Object.keys(expectedPostimages).sort()) !==
      JSON.stringify([...expectedFiles].sort()) ||
    expectedFiles.some((file) => typeof expectedPostimages[file] !== "string")
  ) {
    fail("expected postimages must provide exact UTF-8 bytes for every affected file.");
  }
  return expectedFiles.map((file) => Buffer.from(expectedPostimages[file], "utf8"));
}

function assertExactPostimages(expected, actual, label) {
  if (
    expected.some((bytes, index) => {
      const current = actual[index];
      return current === null || !bytes.equals(current);
    })
  ) {
    fail(`${label} did not produce the exact reviewed postimages.`);
  }
}

async function callToolWithoutWrite(client, request, projectRoot, expectedFiles, before, label) {
  try {
    return await client.callTool(request);
  } finally {
    assertPostimagesUnchanged(before, await readPostimages(projectRoot, expectedFiles), label);
  }
}

function assertExactPreview(
  preview,
  prepared,
  expectedFiles,
  initialPostimages,
  expectedPostimages,
) {
  if (
    preview.operation_id !== prepared.operation_id ||
    preview.plan_hash !== prepared.plan_hash ||
    !Array.isArray(preview.files) ||
    preview.files.length !== expectedFiles.length
  ) {
    fail("operation preview is incomplete or not bound to the prepared plan.");
  }
  const files = new Map();
  for (const value of preview.files) {
    const entry = object(value, "operation preview file");
    if (
      JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["diff", "file"]) ||
      typeof entry.file !== "string" ||
      typeof entry.diff !== "string" ||
      files.has(entry.file)
    ) {
      fail("operation preview contains an invalid or duplicate file diff.");
    }
    files.set(entry.file, entry.diff);
  }
  expectedFiles.forEach((file, index) => {
    const diff = files.get(file);
    if (typeof diff !== "string") fail("operation preview omitted an affected file diff.");
    const initial = initialPostimages[index]?.toString("utf8") ?? "";
    const reconstructed = applyPatch(initial, diff);
    if (reconstructed === false || reconstructed !== expectedPostimages[file]) {
      fail("operation preview does not reconstruct the exact reviewed postimage.");
    }
  });
}

function assertAppliedReceipt(receipt, prepared, expectedKind, expectedFiles, replay) {
  const actualFiles = Array.isArray(receipt.affected_files)
    ? receipt.affected_files.map((file) => String(file)).sort()
    : [];
  if (
    receipt.operation_id !== prepared.operation_id ||
    receipt.kind !== expectedKind ||
    receipt.status !== "applied" ||
    receipt.idempotent_replay !== replay ||
    typeof receipt.applied_at !== "string" ||
    !Number.isFinite(Date.parse(receipt.applied_at)) ||
    JSON.stringify(actualFiles) !== JSON.stringify([...expectedFiles].sort())
  ) {
    fail(`operation ${replay ? "replay" : "apply"} is not bound to the reviewed plan.`);
  }
}

export async function preparePreviewApplyReplay(
  client,
  name,
  arguments_,
  expectedKind,
  expectedFiles,
  expectedPostimages,
) {
  const projectRoot = arguments_.project_root;
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    fail(`${name} requires an absolute project root for no-write verification.`);
  }
  const initialPostimages = await readPostimages(projectRoot, expectedFiles);
  const exactPostimages = expectedPostimageBytes(expectedFiles, expectedPostimages);
  const prepared = structured(
    await callToolWithoutWrite(
      client,
      { name, arguments: arguments_ },
      projectRoot,
      expectedFiles,
      initialPostimages,
      `${name} preparation`,
    ),
    name,
  );
  assertPrepared(prepared, expectedKind, expectedFiles);
  if (prepared.project_root !== projectRoot) {
    fail(`${name} prepared a plan for an unexpected project root.`);
  }
  const wrongHash = `${prepared.plan_hash[0] === "0" ? "1" : "0"}${prepared.plan_hash.slice(1)}`;
  const mismatchCode = await errorCode(
    await callToolWithoutWrite(
      client,
      {
        name: "ast_apply_operation",
        arguments: { operation_id: prepared.operation_id, plan_hash: wrongHash },
      },
      projectRoot,
      expectedFiles,
      initialPostimages,
      `${name} mismatched plan hash`,
    ),
  );
  if (mismatchCode !== "CONFLICT") fail(`${name} accepted a mismatched plan hash.`);
  const preview = structured(
    await callToolWithoutWrite(
      client,
      {
        name: "ast_get_operation_preview",
        arguments: { operation_id: prepared.operation_id },
      },
      projectRoot,
      expectedFiles,
      initialPostimages,
      `${name} preview`,
    ),
    `${name} preview`,
  );
  assertExactPreview(preview, prepared, expectedFiles, initialPostimages, expectedPostimages);
  const applyArguments = {
    operation_id: prepared.operation_id,
    plan_hash: prepared.plan_hash,
  };
  const applied = structured(
    await client.callTool({ name: "ast_apply_operation", arguments: applyArguments }),
    `${name} apply`,
  );
  assertAppliedReceipt(applied, prepared, expectedKind, expectedFiles, false);
  const appliedPostimages = await readPostimages(projectRoot, expectedFiles);
  assertExactPostimages(exactPostimages, appliedPostimages, `${name} apply`);
  const replay = structured(
    await client.callTool({ name: "ast_apply_operation", arguments: applyArguments }),
    `${name} replay`,
  );
  assertAppliedReceipt(replay, prepared, expectedKind, expectedFiles, true);
  const replayPostimages = await readPostimages(projectRoot, expectedFiles);
  assertExactPostimages(exactPostimages, replayPostimages, `${name} replay`);
  if (
    appliedPostimages.some((bytes, index) => {
      const replayBytes = replayPostimages[index];
      return bytes === null || replayBytes === null || !bytes.equals(replayBytes);
    })
  ) {
    fail(`${name} replay changed an already-applied postimage.`);
  }
}

async function errorCode(result) {
  if (
    !isPlainObject(result) ||
    result.isError !== true ||
    Object.hasOwn(result, "structuredContent") ||
    !Array.isArray(result.content) ||
    result.content.length !== 1
  ) {
    fail("stale/conflict operation did not return an MCP error result.");
  }
  const text = result.content.find((entry) => isPlainObject(entry) && entry.type === "text")?.text;
  const envelope = object(parseJson(text, "MCP error envelope"), "MCP error envelope");
  if (JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(["error"])) {
    fail("MCP error envelope exposed unexpected fields.");
  }
  const error = object(envelope.error, "MCP public error");
  if (
    JSON.stringify(Object.keys(error).sort()) !==
      JSON.stringify(["code", "correlation_id", "message"]) ||
    typeof error.message !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      error.correlation_id,
    ) ||
    text.includes("/tmp/")
  ) {
    fail("MCP public error boundary is malformed or exposes filesystem identity.");
  }
  return error.code;
}

async function connectClient(projectRoot, environment, serverEntry) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: projectRoot,
    env: environment,
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {});
  const client = new Client({ name: "registry-consumer-smoke", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

async function runInner(
  projectRoot,
  canaryRoot,
  childHome,
  childTemp,
  serverEntry,
  expectedVersion,
) {
  const { decode } = await import("@toon-format/toon");
  const defaultCacheRoot = path.join(childTemp, "default-index-cache");
  if (await pathExists(defaultCacheRoot)) fail("default cache root exists before MCP startup.");
  const baseEnvironment = {
    ...minimalChildEnvironment(childHome, childTemp),
    AST_SYMBOL_INDEX_CACHE_ROOT: defaultCacheRoot,
  };
  const defaultConnection = await connectClient(projectRoot, baseEnvironment, serverEntry);
  try {
    if (defaultConnection.client.getServerVersion()?.version !== expectedVersion) {
      fail("stdio handshake did not report the installed package version.");
    }
    const tools = await defaultConnection.client.listTools();
    const toolNames = tools.tools.map(({ name }) => name);
    if (JSON.stringify(toolNames) !== JSON.stringify(EXPECTED_TOOLS)) {
      fail("exact 15-tool inventory does not match.");
    }
    const status = structured(
      await defaultConnection.client.callTool({
        name: "ast_get_project_status",
        arguments: { project_root: projectRoot },
      }),
      "JSON project status",
    );
    const observability = object(status.index_observability, "default index observability");
    if (
      observability.policy !== "disabled" ||
      observability.policy_reason !== "default" ||
      observability.backend !== "memory" ||
      observability.state !== "disabled" ||
      observability.operation !== "disabled" ||
      observability.last_operation !== "disabled" ||
      observability.last_successful_persistence_at !== null ||
      status.index?.state !== "disabled" ||
      status.indexed_count !== 0
    ) {
      fail("default no-cache mode did not remain disabled in memory.");
    }
    const sourceRead = structured(
      await defaultConnection.client.callTool({
        name: "ast_get_file",
        arguments: {
          project_root: projectRoot,
          file_path: "src/value.ts",
          offset: 0,
          limit: 2,
          symbols_only: false,
        },
      }),
      "JSON source read",
    );
    if (
      sourceRead.file !== "src/value.ts" ||
      !Array.isArray(sourceRead.lines) ||
      sourceRead.lines[0]?.text !==
        "export function formatValue(value: number): string { return `value:${value}`; }"
    ) {
      fail("JSON source read did not return the expected installed-server result.");
    }
    const toonResult = structured(
      await defaultConnection.client.callTool({
        name: "ast_search_symbols",
        arguments: { project_root: projectRoot, query: "formatValue", output_format: "toon" },
      }),
      "TOON symbol search",
    );
    if (toonResult.format !== "toon" || typeof toonResult.data !== "string") {
      fail("TOON symbol search did not return encoded output.");
    }
    const decoded = object(decode(toonResult.data), "decoded TOON output");
    if (
      !Array.isArray(decoded.symbols) ||
      !decoded.symbols.some(
        (symbol) =>
          isPlainObject(symbol) &&
          [symbol.selector, symbol.signature].some(
            (value) => typeof value === "string" && value.includes("formatValue"),
          ),
      )
    ) {
      fail("decoded TOON symbol search does not contain the queried symbol.");
    }

    await preparePreviewApplyReplay(
      defaultConnection.client,
      "ast_rename_symbol",
      {
        project_root: projectRoot,
        file_path: "src/value.ts",
        symbol_path: "formatValue",
        new_name: "renderValue",
        dry_run: true,
        allow_new_errors: false,
      },
      "rename_symbol",
      ["src/use.ts", "src/value.ts"],
      {
        "src/use.ts":
          'import { renderValue } from "./value.js";\nexport const rendered = renderValue(3);\n',
        "src/value.ts":
          "export function renderValue(value: number): string { return `value:${value}`; }\nexport function doubleValue(value: number): number { return value * 2; }\n",
      },
    );
    await preparePreviewApplyReplay(
      defaultConnection.client,
      "ast_replace_symbol_body",
      {
        project_root: projectRoot,
        file_path: "src/value.ts",
        symbol_path: "doubleValue",
        new_body: "return value * 3;",
        dry_run: true,
        allow_new_errors: false,
      },
      "replace_symbol_body",
      ["src/value.ts"],
      {
        "src/value.ts":
          "export function renderValue(value: number): string { return `value:${value}`; }\nexport function doubleValue(value: number): number {\n    return value * 3;\n}\n",
      },
    );
    await preparePreviewApplyReplay(
      defaultConnection.client,
      "ast_scaffold_class",
      {
        project_root: projectRoot,
        file_path: "src/value-service.ts",
        class_name: "ValueService",
        dry_run: true,
        allow_new_errors: false,
        methods: [
          {
            name: "render",
            is_async: false,
            return_type: "string",
            access: "public",
            parameters: [{ name: "value", type: "number" }],
          },
        ],
      },
      "scaffold_class",
      ["src/value-service.ts"],
      {
        "src/value-service.ts":
          'export class ValueService {\n    public render(value: number): string {\n        throw new Error("Not implemented: ValueService.render");\n    }\n}\n',
      },
    );

    const conflict = structured(
      await defaultConnection.client.callTool({
        name: "ast_replace_symbol_body",
        arguments: {
          project_root: projectRoot,
          file_path: "src/conflict.ts",
          symbol_path: "conflictValue",
          new_body: "return 2;",
        },
      }),
      "conflict preparation",
    );
    assertPrepared(conflict, "replace_symbol_body", ["src/conflict.ts"]);
    await writeFile(
      path.join(projectRoot, "src", "conflict.ts"),
      "export function conflictValue(): number { return 3; }\n",
    );
    const conflictResult = await defaultConnection.client.callTool({
      name: "ast_apply_operation",
      arguments: { operation_id: conflict.operation_id, plan_hash: conflict.plan_hash },
    });
    const code = await errorCode(conflictResult);
    if (code !== "CONFLICT" && code !== "STALE_WORKSPACE") {
      fail("stale/conflict apply did not fail closed with the public conflict boundary.");
    }
    const conflictPostimage = await readFile(path.join(projectRoot, "src", "conflict.ts"), "utf8");
    if (conflictPostimage !== "export function conflictValue(): number { return 3; }\n") {
      fail("stale/conflict apply changed the externally modified source file.");
    }
  } finally {
    await defaultConnection.client.close();
    await defaultConnection.transport.close().catch(() => {});
  }
  if (await pathExists(defaultCacheRoot)) {
    fail("default disabled persistence created or accessed its configured cache root.");
  }

  const canaryEnvironment = {
    ...baseEnvironment,
    AST_SYMBOL_INDEX_PERSISTENCE: "canary",
    AST_SYMBOL_INDEX_CACHE_ROOT: canaryRoot,
  };
  const canaryConnection = await connectClient(projectRoot, canaryEnvironment, serverEntry);
  try {
    structured(
      await canaryConnection.client.callTool({
        name: "ast_search_symbols",
        arguments: { project_root: projectRoot, query: "doubleValue" },
      }),
      "canary symbol search",
    );
    const status = structured(
      await canaryConnection.client.callTool({
        name: "ast_get_project_status",
        arguments: { project_root: projectRoot },
      }),
      "canary project status",
    );
    const observability = object(status.index_observability, "canary index observability");
    if (
      observability.policy !== "canary" ||
      observability.policy_reason !== "default" ||
      observability.backend !== "sqlite" ||
      observability.state !== "ready" ||
      observability.operation === "disabled" ||
      observability.last_operation !== observability.operation ||
      typeof observability.last_successful_persistence_at !== "string" ||
      status.index?.state !== "ready" ||
      !Number.isSafeInteger(status.indexed_count) ||
      status.indexed_count < 1
    ) {
      fail("explicit supported canary mode did not use a ready SQLite index.");
    }
  } finally {
    await canaryConnection.client.close();
    await canaryConnection.transport.close().catch(() => {});
  }
  const canaryEntries = await readdir(canaryRoot, { withFileTypes: true });
  const canaryDatabases = canaryEntries.filter(
    (entry) => entry.isFile() && /^symbol-index-[0-9a-f]{64}\.sqlite$/u.test(entry.name),
  );
  if (canaryEntries.some((entry) => entry.isSymbolicLink()) || canaryDatabases.length !== 1) {
    fail("explicit canary mode did not persist one physical SQLite index artifact.");
  }
  const canaryDatabaseMetadata = await lstat(path.join(canaryRoot, canaryDatabases[0].name));
  if (
    !canaryDatabaseMetadata.isFile() ||
    canaryDatabaseMetadata.isSymbolicLink() ||
    canaryDatabaseMetadata.nlink !== 1 ||
    canaryDatabaseMetadata.size < 1
  ) {
    fail("explicit canary SQLite index artifact is empty or not a unique regular file.");
  }

  return {
    lifecycle_scripts_disabled: true,
    package_metadata: true,
    tarball_integrity: true,
    audit_signatures: true,
    consumer_audit: true,
    stdio_handshake: true,
    exact_tool_inventory: true,
    json_read: true,
    toon_read: true,
    default_no_cache: true,
    explicit_canary: true,
    rename_prepare_preview_apply_replay: true,
    replace_prepare_preview_apply_replay: true,
    scaffold_prepare_preview_apply_replay: true,
    stale_conflict_fail_closed: true,
    setup_idempotency: true,
  };
}

async function runOuter(options) {
  const versionDocument = await fetchJson(
    `${options.registry}/${PACKAGE_NAME}/${options.version}`,
    "registry version metadata",
  );
  const packageDocument = await fetchJson(
    `${options.registry}/${PACKAGE_NAME}`,
    "registry package metadata",
  );
  const metadata = normalizedRegistryMetadata(
    versionDocument,
    packageDocument,
    options.version,
    options.sha,
  );
  await verifyTarball(metadata);

  const consumerRoot = await mkdtemp(path.join(os.tmpdir(), "ast-mcp-registry-consumer-"));
  try {
    const consumerHome = path.join(consumerRoot, "home");
    const consumerTemp = path.join(consumerRoot, "tmp");
    const projectRoot = path.join(consumerRoot, "project");
    const canaryRoot = path.join(consumerRoot, "canary-cache");
    const npmUserconfig = path.join(consumerTemp, ".npmrc");
    await Promise.all([
      mkdir(consumerHome, { recursive: true }),
      mkdir(consumerTemp, { recursive: true }),
      mkdir(canaryRoot, { recursive: true }),
      createFixture(projectRoot),
      writeFile(
        path.join(consumerRoot, "package.json"),
        `${JSON.stringify({ name: "ast-mcp-registry-consumer", private: true, version: "1.0.0" })}\n`,
      ),
    ]);
    await writeFile(npmUserconfig, `registry=${options.registry}\nignore-scripts=true\n`, {
      mode: 0o600,
    });
    const npmEnvironment = publicNpmEnvironment(consumerHome, consumerTemp, npmUserconfig);
    await execute(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--package-lock=true",
        "--audit=false",
        "--fund=false",
        `--registry=${options.registry}`,
        "--save-exact",
        `${PACKAGE_NAME}@${options.version}`,
      ],
      { cwd: consumerRoot, env: npmEnvironment },
    );
    const lifecycleConfiguration = await execute("npm", ["config", "get", "ignore-scripts"], {
      cwd: consumerRoot,
      env: npmEnvironment,
    });
    if (lifecycleConfiguration.stdout.trim() !== "true") {
      fail("clean consumer did not keep lifecycle scripts disabled.");
    }
    const installedPackageRoot = path.join(consumerRoot, "node_modules", PACKAGE_NAME);
    const installedRootMetadata = await lstat(installedPackageRoot);
    if (!installedRootMetadata.isDirectory() || installedRootMetadata.isSymbolicLink()) {
      fail("installed package root is not a physical registry-installed directory.");
    }
    const installedMetadata = parseJson(
      await readFile(path.join(installedPackageRoot, "package.json"), "utf8"),
      "installed package metadata",
    );
    if (
      installedMetadata.name !== PACKAGE_NAME ||
      installedMetadata.version !== options.version ||
      installedMetadata.engines?.node !== ">=22.5.0"
    ) {
      fail("clean consumer did not install the exact package version.");
    }
    const lock = object(
      parseJson(
        await readFile(path.join(consumerRoot, "package-lock.json"), "utf8"),
        "package lock",
      ),
      "package lock",
    );
    const lockedPackage = object(
      object(lock.packages, "package lock entries")[`node_modules/${PACKAGE_NAME}`],
      "installed package lock entry",
    );
    if (
      lockedPackage.version !== options.version ||
      lockedPackage.resolved !== metadata.dist.tarball ||
      lockedPackage.integrity !== metadata.dist.integrity
    ) {
      fail("package lock does not prove an exact official-registry install.");
    }

    const signature = await execute(
      "npm",
      ["audit", "signatures", "--json", `--registry=${options.registry}`],
      { cwd: consumerRoot, env: npmEnvironment },
    );
    const signatureResult = object(
      parseJson(signature.stdout, "npm audit signatures output"),
      "npm audit signatures output",
    );
    const signatureReport = {
      schema_version: 1,
      status: "pass",
      command: "npm audit signatures",
      registry: options.registry,
      exit_code: 0,
      result: signatureResult,
    };

    const audit = await execute("npm", ["audit", "--omit=dev", "--json"], {
      cwd: consumerRoot,
      env: npmEnvironment,
    });
    if (!auditHasNoVulnerabilities(parseJson(audit.stdout, "consumer npm audit output"))) {
      fail("clean consumer audit contains vulnerabilities.");
    }

    await verifySetupIdempotency(consumerRoot, installedPackageRoot);
    const copiedRunner = path.join(consumerRoot, "registry-consumer-smoke.mjs");
    await copyFile(scriptPath, copiedRunner);
    const inner = await execute(
      process.execPath,
      [
        copiedRunner,
        "--inner",
        projectRoot,
        canaryRoot,
        consumerHome,
        consumerTemp,
        path.join(installedPackageRoot, "dist", "index.js"),
        options.version,
      ],
      {
        cwd: consumerRoot,
        env: minimalChildEnvironment(consumerHome, consumerTemp),
      },
    );
    const gates = object(
      parseJson(inner.stdout, "registry MCP consumer output"),
      "registry MCP consumer output",
    );
    const report = {
      schema_version: 1,
      status: "pass",
      package_name: PACKAGE_NAME,
      version: options.version,
      git_head: options.sha,
      registry: options.registry,
      gates,
    };

    await writeJsonExclusive(options.outputs.metadata, metadata);
    await writeJsonExclusive(options.outputs.audit, signatureReport);
    await writeJsonExclusive(options.outputs.consumer, report);
    return report;
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv[2] === "--inner") {
    if (process.argv.length !== 9) fail("internal registry runner arguments are invalid.");
    const gates = await runInner(
      process.argv[3],
      process.argv[4],
      process.argv[5],
      process.argv[6],
      process.argv[7],
      process.argv[8],
    );
    process.stdout.write(`${JSON.stringify(gates)}\n`);
    return;
  }
  const options = parseArguments(process.argv.slice(2));
  const report = await runOuter(options);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(scriptPath);
if (isMain) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Registry consumer smoke failed."}\n`,
    );
    process.exitCode = 1;
  }
}
