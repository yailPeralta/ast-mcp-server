#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { promisify } from "node:util";

import { validateManagedSkillBundle } from "./managed-skill-bundle-validator.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const packageName = "ast-mcp-server";
const officialRegistry = "https://registry.npmjs.org";
const maxCommandBytes = 2 * 1024 * 1024;
const maxTarballBytes = 50 * 1024 * 1024;
const commandTimeoutMs = 180_000;
const proxyTimeoutMs = 30_000;
const expectedYarnVersion = "4.15.0";
const expectedNpmVersions = Object.freeze({ "22.13.0": "10.9.2", 24: "11.13.0" });
const authenticatedAuthoritySets = new WeakSet();
const versionPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const selectedSemanticGates = [
  "stdio_handshake",
  "exact_tool_inventory",
  "json_read",
  "toon_read",
  "default_sqlite_rebuild",
  "default_restart_hit",
  "default_private_cache",
  "explicit_disabled_no_cache",
  "mutation_only_default_no_cache",
  "explicit_canary",
  "rename_prepare_preview_apply_replay",
  "replace_prepare_preview_apply_replay",
  "scaffold_prepare_preview_apply_replay",
  "stale_conflict_fail_closed",
];

function fail(message) {
  throw new Error(message);
}

export function parseLocalRegistryArguments(argv) {
  const options = {
    output: null,
    expectedNode: null,
    yarnEntry: null,
    npmEntry: null,
    transitiveNodeBin: null,
    expectedNodeSha256: null,
    expectedYarnSha256: null,
    expectedNpmSha256: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--output" && value !== undefined) {
      if (!path.isAbsolute(value)) fail("--output must identify an absolute new JSON file.");
      options.output = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--expected-node" && value !== undefined) {
      options.expectedNode = value;
      index += 1;
      continue;
    }
    if (
      (argument === "--yarn-entry" ||
        argument === "--npm-entry" ||
        argument === "--transitive-node-bin") &&
      value !== undefined
    ) {
      if (!path.isAbsolute(value) || path.resolve(value) !== value) {
        fail(`${argument} must identify an absolute normalized file.`);
      }
      options[
        argument === "--yarn-entry"
          ? "yarnEntry"
          : argument === "--npm-entry"
            ? "npmEntry"
            : "transitiveNodeBin"
      ] = value;
      index += 1;
      continue;
    }
    if (
      (argument === "--expected-node-sha256" ||
        argument === "--expected-yarn-sha256" ||
        argument === "--expected-npm-sha256") &&
      value !== undefined
    ) {
      if (!sha256Pattern.test(value)) fail(`${argument} must be a lowercase SHA-256 digest.`);
      options[
        argument === "--expected-node-sha256"
          ? "expectedNodeSha256"
          : argument === "--expected-yarn-sha256"
            ? "expectedYarnSha256"
            : "expectedNpmSha256"
      ] = value;
      index += 1;
      continue;
    }
    fail(`Unknown or incomplete argument: ${argument}`);
  }
  if (options.expectedNode !== "22.13.0" && options.expectedNode !== "24") {
    fail("--expected-node must be exactly 22.13.0 or 24.");
  }
  if (options.output === null) fail("--output must identify an absolute new JSON file.");
  if (options.yarnEntry === null) fail("--yarn-entry must identify an absolute normalized file.");
  if (options.npmEntry === null) fail("--npm-entry must identify an absolute normalized file.");
  if (options.transitiveNodeBin === null) {
    fail("--transitive-node-bin must identify an absolute normalized file.");
  }
  for (const [option, value] of [
    ["--expected-node-sha256", options.expectedNodeSha256],
    ["--expected-yarn-sha256", options.expectedYarnSha256],
    ["--expected-npm-sha256", options.expectedNpmSha256],
  ]) {
    if (value === null) fail(`${option} must be a lowercase SHA-256 digest.`);
  }
  return options;
}

export function assertLocalRegistryRuntime(
  expectedNode,
  actual = process.versions.node,
  nodeOptions = process.env.NODE_OPTIONS ?? "",
) {
  if (expectedNode === "22.13.0" ? actual !== expectedNode : actual.split(".")[0] !== "24") {
    fail(`Expected Node ${expectedNode}, received ${actual}.`);
  }
  if (nodeOptions !== "") {
    fail("NODE_OPTIONS must be empty for local-registry release evidence.");
  }
}

async function sha256OpenFile(handle) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

async function assertPrivateAuthorityDirectory(directory, label) {
  const [metadata, physical] = await Promise.all([lstat(directory), realpath(directory)]);
  const owner = process.getuid?.();
  if (
    owner === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    physical !== directory ||
    metadata.uid !== owner ||
    (metadata.mode & 0o777) !== 0o700
  ) {
    fail(`${label} must be a physical owner-private directory.`);
  }
}

async function inspectAuthorityFile(file, label, executable) {
  const entry = await lstat(file);
  const owner = process.getuid?.();
  if (
    owner === undefined ||
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.nlink !== 1 ||
    entry.size < 1 ||
    entry.uid !== owner
  ) {
    fail(`${label} authority must be a physical regular file with one owner link.`);
  }
  if ((entry.mode & 0o022) !== 0 || (executable && (entry.mode & 0o111) === 0)) {
    fail(`${label} authority must not be writable by group or other.`);
  }
  if ((await realpath(file)) !== file) {
    fail(`${label} authority must use its canonical physical path.`);
  }
  const handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.dev !== entry.dev ||
      before.ino !== entry.ino ||
      before.size !== entry.size ||
      before.mode !== entry.mode
    ) {
      fail(`${label} authority changed while opening its no-follow descriptor.`);
    }
    const digest = await sha256OpenFile(handle);
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mode !== before.mode ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      fail(`${label} authority changed while hashing its no-follow descriptor.`);
    }
    return Object.freeze({
      file,
      device: before.dev,
      inode: before.ino,
      mode: before.mode & 0o777,
      size: before.size,
      sha256: digest,
    });
  } finally {
    await handle.close();
  }
}

function authorityFileUnchanged(before, after) {
  return (
    before.file === after.file &&
    before.device === after.device &&
    before.inode === after.inode &&
    before.mode === after.mode &&
    before.size === after.size &&
    before.sha256 === after.sha256
  );
}

function authorityProbeEnvironment(home, temp) {
  return {
    HOME: home,
    TMPDIR: temp,
    PATH: "/nonexistent",
    LANG: "C.UTF-8",
    CI: "true",
    NODE_OPTIONS: "",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    NPM_CONFIG_USERCONFIG: path.join(temp, "authority.npmrc"),
    NPM_CONFIG_CACHE: path.join(temp, "npm-cache"),
  };
}

export async function authenticateLocalRegistryAuthorities(options, privateRoots) {
  assertLocalRegistryRuntime(options.expectedNode);
  for (const file of [options.yarnEntry, options.npmEntry, options.transitiveNodeBin]) {
    if (!path.isAbsolute(file)) fail("Package-manager authority entries must be absolute.");
  }
  await Promise.all([
    assertPrivateAuthorityDirectory(privateRoots.home, "Authority HOME"),
    assertPrivateAuthorityDirectory(privateRoots.temp, "Authority TMPDIR"),
  ]);
  const transitiveDirectory = path.dirname(options.transitiveNodeBin);
  await assertPrivateAuthorityDirectory(transitiveDirectory, "Transitive Node directory");
  const transitiveMembers = await readdir(transitiveDirectory);
  if (
    path.basename(options.transitiveNodeBin) !== "node" ||
    transitiveMembers.length !== 1 ||
    transitiveMembers[0] !== "node"
  ) {
    fail("Transitive Node directory must contain only the authenticated node binary.");
  }
  const [node, yarn, npm, transitiveNode] = await Promise.all([
    inspectAuthorityFile(process.execPath, "Node", true),
    inspectAuthorityFile(options.yarnEntry, "Yarn", false),
    inspectAuthorityFile(options.npmEntry, "npm", false),
    inspectAuthorityFile(options.transitiveNodeBin, "Transitive Node", true),
  ]);
  if (new Set([node.file, yarn.file, npm.file, transitiveNode.file]).size !== 4) {
    fail("Node, Yarn, npm, and transitive Node authorities must be distinct physical files.");
  }
  if (
    node.sha256 !== options.expectedNodeSha256 ||
    transitiveNode.sha256 !== options.expectedNodeSha256 ||
    yarn.sha256 !== options.expectedYarnSha256 ||
    npm.sha256 !== options.expectedNpmSha256
  ) {
    fail("A package-manager authority digest does not match its expected SHA-256.");
  }
  const environment = authorityProbeEnvironment(privateRoots.home, privateRoots.temp);
  const [yarnVersionResult, npmVersionResult, transitiveNodeVersionResult] = await Promise.all([
    execute(node.file, [yarn.file, "--version"], { cwd: repositoryRoot, env: environment }),
    execute(node.file, [npm.file, "--version"], { cwd: repositoryRoot, env: environment }),
    execute(transitiveNode.file, ["--version"], { cwd: repositoryRoot, env: environment }),
  ]);
  const yarnVersion = yarnVersionResult.stdout.trim();
  const npmVersion = npmVersionResult.stdout.trim();
  if (yarnVersion !== expectedYarnVersion) {
    fail("Yarn authority version does not match the release contract.");
  }
  if (npmVersion !== expectedNpmVersions[options.expectedNode]) {
    fail("npm authority version does not match the runtime release contract.");
  }
  if (transitiveNodeVersionResult.stdout.trim() !== process.version) {
    fail("Transitive Node authority version does not match the direct runtime.");
  }
  const [nodeAfter, yarnAfter, npmAfter, transitiveNodeAfter] = await Promise.all([
    inspectAuthorityFile(node.file, "Node", true),
    inspectAuthorityFile(yarn.file, "Yarn", false),
    inspectAuthorityFile(npm.file, "npm", false),
    inspectAuthorityFile(transitiveNode.file, "Transitive Node", true),
  ]);
  if (
    !authorityFileUnchanged(node, nodeAfter) ||
    !authorityFileUnchanged(yarn, yarnAfter) ||
    !authorityFileUnchanged(npm, npmAfter) ||
    !authorityFileUnchanged(transitiveNode, transitiveNodeAfter)
  ) {
    fail("A package-manager authority changed during authentication.");
  }
  const authorities = Object.freeze({
    node: Object.freeze({ ...node, version: process.versions.node }),
    yarn: Object.freeze({ ...yarn, version: yarnVersion }),
    npm: Object.freeze({ ...npm, version: npmVersion }),
    transitiveNode: Object.freeze({ ...transitiveNode, version: process.versions.node }),
    path: transitiveDirectory,
  });
  authenticatedAuthoritySets.add(authorities);
  return authorities;
}

export async function executeAuthenticatedPackageManager(authorities, manager, args, options = {}) {
  if (!authenticatedAuthoritySets.has(authorities) || (manager !== "yarn" && manager !== "npm")) {
    fail("Package-manager execution requires authenticated authority.");
  }
  const selected = authorities[manager];
  const [nodeNow, managerNow, transitiveNodeNow] = await Promise.all([
    inspectAuthorityFile(authorities.node.file, "Node", true),
    inspectAuthorityFile(selected.file, manager === "yarn" ? "Yarn" : "npm", false),
    inspectAuthorityFile(authorities.transitiveNode.file, "Transitive Node", true),
  ]);
  if (
    !authorityFileUnchanged(authorities.node, nodeNow) ||
    !authorityFileUnchanged(selected, managerNow) ||
    !authorityFileUnchanged(authorities.transitiveNode, transitiveNodeNow)
  ) {
    fail("A package-manager authority changed before execution.");
  }
  return execute(authorities.node.file, [selected.file, ...args], {
    ...options,
    env: { ...(options.env ?? {}), PATH: authorities.path },
  });
}

async function packageManagerEvidence(authorities) {
  if (!authenticatedAuthoritySets.has(authorities)) {
    fail("Package-manager evidence requires authenticated authority.");
  }
  const [nodeNow, yarnNow, npmNow, transitiveNodeNow] = await Promise.all([
    inspectAuthorityFile(authorities.node.file, "Node", true),
    inspectAuthorityFile(authorities.yarn.file, "Yarn", false),
    inspectAuthorityFile(authorities.npm.file, "npm", false),
    inspectAuthorityFile(authorities.transitiveNode.file, "Transitive Node", true),
  ]);
  if (
    !authorityFileUnchanged(authorities.node, nodeNow) ||
    !authorityFileUnchanged(authorities.yarn, yarnNow) ||
    !authorityFileUnchanged(authorities.npm, npmNow) ||
    !authorityFileUnchanged(authorities.transitiveNode, transitiveNodeNow)
  ) {
    fail("A package-manager authority changed before evidence publication.");
  }
  return {
    node: {
      version: authorities.node.version,
      sha256: authorities.node.sha256,
    },
    yarn: {
      version: authorities.yarn.version,
      sha256: authorities.yarn.sha256,
      transitive_node_sha256: authorities.transitiveNode.sha256,
    },
    npm: {
      version: authorities.npm.version,
      sha256: authorities.npm.sha256,
      transitive_node_sha256: authorities.transitiveNode.sha256,
    },
    path_policy: "private_authenticated_node_only",
    path_sha256: createHash("sha256").update("private_authenticated_node_only").digest("hex"),
  };
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

async function execute(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, {
      encoding: "utf8",
      maxBuffer: maxCommandBytes,
      timeout: commandTimeoutMs,
      ...options,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.slice(0, 2_000) : "";
    throw new Error(
      `Local-registry command failed: ${path.basename(file)} ${args[0] ?? ""}${stderr ? `\n${stderr}` : ""}`,
      { cause: error },
    );
  }
}

function privateEnvironment(home, temp, npmUserconfig, registry, authorityPath) {
  return {
    HOME: home,
    TMPDIR: temp,
    PATH: authorityPath,
    LANG: "C.UTF-8",
    CI: "true",
    NODE_OPTIONS: "",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    NPM_CONFIG_USERCONFIG: npmUserconfig,
    NPM_CONFIG_CACHE: path.join(temp, "npm-cache"),
    NPM_CONFIG_REGISTRY: registry,
  };
}

async function createFixture(root) {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "local-registry-consumer-fixture", private: true, type: "module" })}\n`,
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

async function createFakeAgents(root, nodeAuthority) {
  const binRoot = path.join(root, "fake-bin");
  const fakeAgentSource = path.join(repositoryRoot, "scripts", "fixtures", "fake-agent.mjs");
  await mkdir(binRoot, { recursive: true });
  await writeFile(path.join(binRoot, "package.json"), '{"type":"module"}\n', "utf8");
  for (const name of ["claude", "hermes"]) {
    const executable = path.join(binRoot, name);
    await writeFile(
      executable,
      `#!${nodeAuthority}\nimport ${JSON.stringify(pathToFileURL(fakeAgentSource).href)};\n`,
      { mode: 0o700 },
    );
    await chmod(executable, 0o700);
  }
  return binRoot;
}

async function verifySetupIdempotency(
  consumerRoot,
  installedPackageRoot,
  baseEnvironment,
  authorities,
) {
  const setupRoot = path.join(consumerRoot, "setup");
  const fakeBin = await createFakeAgents(setupRoot, authorities.node.file);
  const cliEntry = path.join(installedPackageRoot, "dist", "cli.js");
  const claudeRoot = path.join(setupRoot, "claude");
  const hermesRoot = path.join(setupRoot, "hermes");
  const environment = {
    ...baseEnvironment,
    PATH: `${fakeBin}${path.delimiter}${baseEnvironment.PATH}`,
    FAKE_CLAUDE_STATE: path.join(setupRoot, "claude-state.json"),
    FAKE_HERMES_STATE: path.join(setupRoot, "hermes-state.json"),
    CLAUDE_CONFIG_DIR: claudeRoot,
    HERMES_HOME: hermesRoot,
  };
  const humanClaudeGuidance = "# Local registry consumer rules\n\nPreserve these bytes.\n";
  await mkdir(claudeRoot, { recursive: true });
  await writeFile(path.join(claudeRoot, "CLAUDE.md"), humanClaudeGuidance, "utf8");
  const args = ["setup", "--agents", "claude,hermes", "--yes"];
  const first = object(
    parseJson(
      (
        await execute(authorities.node.file, [cliEntry, ...args], {
          cwd: consumerRoot,
          env: environment,
        })
      ).stdout,
      "first installed setup result",
    ),
    "first installed setup result",
  );
  const second = object(
    parseJson(
      (
        await execute(authorities.node.file, [cliEntry, ...args], {
          cwd: consumerRoot,
          env: environment,
        })
      ).stdout,
      "second installed setup result",
    ),
    "second installed setup result",
  );
  if (
    !Array.isArray(first.agents) ||
    first.agents.length !== 2 ||
    first.version !== 2 ||
    !first.agents.every(
      (item) =>
        object(item, "first installed setup agent").skill === "installed" &&
        item.mcp === "configured",
    ) ||
    first.agents.find((item) => item.agent === "claude")?.guidance !== "updated" ||
    first.agents.find((item) => item.agent === "hermes")?.guidance !== "skill_only"
  ) {
    fail("Installed setup did not configure MCP, skills, and managed guidance.");
  }
  if (
    !Array.isArray(second.agents) ||
    second.agents.length !== 2 ||
    !second.agents.every(
      (item) =>
        object(item, "second installed setup agent").skill === "unchanged" &&
        item.mcp === "unchanged" &&
        (item.guidance === "unchanged" || item.guidance === "skill_only"),
    ) ||
    !Array.isArray(second.physical_writes) ||
    second.physical_writes.length !== 0
  ) {
    fail("Installed setup replay was not a zero-write convergence.");
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
  validateManagedSkillBundle({
    packagedSkill,
    packagedGuidance,
    packagedReleases,
    copiedSkills: [claudeSkill, hermesSkill],
  });
  const claudeGuidance = await readFile(path.join(claudeRoot, "CLAUDE.md"), "utf8");
  const marker = "<!-- ast-tool:structural-code-editing guidance v1 begin -->";
  if (
    !claudeGuidance.startsWith(humanClaudeGuidance) ||
    claudeGuidance.split(marker).length !== 2
  ) {
    fail("Installed setup did not preserve managed guidance exactly once.");
  }
}

async function proxyOfficialRegistry(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain" });
    response.end("method not allowed");
    return;
  }
  const target = new URL(request.url ?? "/", officialRegistry);
  if (target.origin !== officialRegistry) {
    response.writeHead(400, { "content-type": "text/plain" });
    response.end("invalid registry target");
    return;
  }
  const headers = {};
  for (const name of ["accept", "accept-encoding", "user-agent"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  await new Promise((resolve, reject) => {
    const upstreamRequest = httpsRequest(
      target,
      { method: request.method, headers },
      (upstream) => {
        response.statusCode = upstream.statusCode ?? 502;
        for (const name of ["content-type", "content-encoding", "content-length", "etag"]) {
          const value = upstream.headers[name];
          if (typeof value === "string") response.setHeader(name, value);
        }
        upstream.once("error", reject);
        upstream.once("end", resolve);
        upstream.pipe(response);
      },
    );
    upstreamRequest.setTimeout(proxyTimeoutMs, () => {
      upstreamRequest.destroy(new Error("Official registry proxy request timed out."));
    });
    upstreamRequest.once("error", reject);
    upstreamRequest.end();
  });
}

async function startRegistry(packageMetadata, tarball) {
  const counters = { metadata: 0, tarball: 0, upstream: 0 };
  let registry;
  const tarballPath = `/${packageName}/-/${packageName}-${packageMetadata.version}.tgz`;
  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const decodedPath = decodeURIComponent(requestUrl.pathname);
      if (
        request.method === "GET" &&
        (decodedPath === `/${packageName}` ||
          decodedPath === `/${packageName}/${packageMetadata.version}`)
      ) {
        counters.metadata += 1;
        const versionMetadata = {
          ...packageMetadata,
          dist: {
            integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
            shasum: createHash("sha1").update(tarball).digest("hex"),
            tarball: new URL(tarballPath, registry).href,
          },
        };
        const document =
          decodedPath === `/${packageName}`
            ? {
                name: packageName,
                "dist-tags": { candidate: packageMetadata.version },
                versions: { [packageMetadata.version]: versionMetadata },
              }
            : versionMetadata;
        const bytes = Buffer.from(JSON.stringify(document));
        response.writeHead(200, {
          "content-type": "application/json",
          "content-length": String(bytes.length),
        });
        response.end(bytes);
        return;
      }
      if (request.method === "GET" && decodedPath === tarballPath) {
        counters.tarball += 1;
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(tarball.length),
        });
        response.end(tarball);
        return;
      }
      counters.upstream += 1;
      await proxyOfficialRegistry(request, response);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end("registry proxy failure");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") fail("Local registry did not bind TCP.");
  registry = `http://127.0.0.1:${address.port}/`;
  return { server, registry, counters, tarballPath };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

export async function removeTemporaryRoot(root, remove = rm) {
  await remove(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

export async function completeBeforePublishing(operation, cleanups, publish) {
  let report;
  let operationError;
  try {
    report = await operation();
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  const cleanupError =
    cleanupErrors.length === 0
      ? undefined
      : new AggregateError(cleanupErrors, "Local-registry consumer cleanup failed.");
  if (operationError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [operationError, cleanupError],
      "Local-registry consumer operation and cleanup failed.",
    );
  }
  if (operationError !== undefined) throw operationError;
  if (cleanupError !== undefined) throw cleanupError;
  await publish(report);
  return report;
}

async function assertNewOutput(output) {
  const parent = path.dirname(output);
  const [parentMetadata, physicalParent] = await Promise.all([lstat(parent), realpath(parent)]);
  if (
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    physicalParent !== parent
  ) {
    fail("Output parent must be a physical absolute directory.");
  }
  try {
    await lstat(output);
    fail("Evidence output already exists.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function run(options) {
  assertLocalRegistryRuntime(options.expectedNode);
  await assertNewOutput(options.output);
  const packageMetadata = object(
    parseJson(
      await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
      "package metadata",
    ),
    "package metadata",
  );
  if (
    packageMetadata.name !== packageName ||
    !versionPattern.test(packageMetadata.version) ||
    packageMetadata.engines?.node !== ">=22.13.0"
  ) {
    fail("Source package metadata does not match the release contract.");
  }

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ast-local-registry-consumer-"));
  let localRegistry;
  let authorities;
  return completeBeforePublishing(
    async () => {
      const archivePath = path.join(temporaryRoot, `${packageName}.tgz`);
      const authorityHome = path.join(temporaryRoot, "authority-home");
      const authorityTemp = path.join(temporaryRoot, "authority-tmp");
      const packHome = path.join(temporaryRoot, "pack-home");
      const packTemp = path.join(temporaryRoot, "pack-tmp");
      await Promise.all([
        mkdir(authorityHome, { mode: 0o700 }),
        mkdir(authorityTemp, { mode: 0o700 }),
        mkdir(packHome, { mode: 0o700 }),
        mkdir(packTemp, { mode: 0o700 }),
      ]);
      authorities = await authenticateLocalRegistryAuthorities(options, {
        home: authorityHome,
        temp: authorityTemp,
      });
      await executeAuthenticatedPackageManager(
        authorities,
        "yarn",
        ["pack", "--out", archivePath],
        {
          cwd: repositoryRoot,
          env: {
            HOME: packHome,
            TMPDIR: packTemp,
            PATH: authorities.path,
            LANG: "C.UTF-8",
            CI: "true",
            NODE_OPTIONS: "",
            COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
          },
        },
      );
      const tarball = await readFile(archivePath);
      if (tarball.length < 1 || tarball.length > maxTarballBytes) {
        fail("Packed candidate tarball size is invalid.");
      }

      localRegistry = await startRegistry(packageMetadata, tarball);
      const consumerRoot = path.join(temporaryRoot, "consumer");
      const consumerHome = path.join(temporaryRoot, "consumer-home");
      const consumerTemp = path.join(temporaryRoot, "consumer-tmp");
      const projectRoot = path.join(consumerRoot, "project");
      const canaryRoot = path.join(consumerRoot, "canary-cache");
      const npmUserconfig = path.join(consumerTemp, ".npmrc");
      await Promise.all([
        mkdir(consumerRoot, { mode: 0o700 }),
        mkdir(consumerHome, { mode: 0o700 }),
        mkdir(consumerTemp, { mode: 0o700 }),
        createFixture(projectRoot),
      ]);
      await writeFile(
        path.join(consumerRoot, "package.json"),
        `${JSON.stringify({ name: "ast-local-registry-consumer", private: true, version: "1.0.0" })}\n`,
      );
      await writeFile(
        npmUserconfig,
        `registry=${localRegistry.registry}\nignore-scripts=true\naudit=false\nfund=false\n`,
        { mode: 0o600 },
      );
      const environment = privateEnvironment(
        consumerHome,
        consumerTemp,
        npmUserconfig,
        localRegistry.registry,
        authorities.path,
      );
      await executeAuthenticatedPackageManager(
        authorities,
        "npm",
        [
          "install",
          "--ignore-scripts",
          "--package-lock=true",
          "--audit=false",
          "--fund=false",
          `--registry=${localRegistry.registry}`,
          "--save-exact",
          `${packageName}@${packageMetadata.version}`,
        ],
        { cwd: consumerRoot, env: environment },
      );

      const lifecycleConfiguration = await executeAuthenticatedPackageManager(
        authorities,
        "npm",
        ["config", "get", "ignore-scripts"],
        { cwd: consumerRoot, env: environment },
      );
      if (lifecycleConfiguration.stdout.trim() !== "true") {
        fail("Consumer install did not keep lifecycle scripts disabled.");
      }
      const installedRoot = path.join(consumerRoot, "node_modules", packageName);
      const installedRootMetadata = await lstat(installedRoot);
      if (!installedRootMetadata.isDirectory() || installedRootMetadata.isSymbolicLink()) {
        fail("Installed package is not a physical registry consumer directory.");
      }
      const installedMetadata = object(
        parseJson(
          await readFile(path.join(installedRoot, "package.json"), "utf8"),
          "installed package metadata",
        ),
        "installed package metadata",
      );
      if (
        installedMetadata.name !== packageName ||
        installedMetadata.version !== packageMetadata.version ||
        installedMetadata.engines?.node !== ">=22.13.0"
      ) {
        fail("Installed package metadata does not match the packed candidate.");
      }
      const lock = object(
        parseJson(
          await readFile(path.join(consumerRoot, "package-lock.json"), "utf8"),
          "package lock",
        ),
        "package lock",
      );
      const lockedPackage = object(
        object(lock.packages, "package lock entries")[`node_modules/${packageName}`],
        "candidate package lock entry",
      );
      const expectedTarball = new URL(localRegistry.tarballPath, localRegistry.registry).href;
      const expectedIntegrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
      if (
        lockedPackage.version !== packageMetadata.version ||
        lockedPackage.resolved !== expectedTarball ||
        lockedPackage.integrity !== expectedIntegrity
      ) {
        fail("Package lock does not bind the local registry tarball and exact integrity.");
      }
      if (localRegistry.counters.metadata < 1 || localRegistry.counters.tarball < 1) {
        fail(
          "Consumer did not retrieve candidate metadata and tarball through the local registry.",
        );
      }
      await verifySetupIdempotency(consumerRoot, installedRoot, environment, authorities);

      const copiedRunner = path.join(consumerRoot, "registry-consumer-smoke.mjs");
      await Promise.all([
        copyFile(path.join(repositoryRoot, "scripts", "registry-consumer-smoke.mjs"), copiedRunner),
        copyFile(
          path.join(repositoryRoot, "scripts", "registry-consumer-gates.mjs"),
          path.join(consumerRoot, "registry-consumer-gates.mjs"),
        ),
        copyFile(
          path.join(repositoryRoot, "scripts", "managed-skill-bundle-validator.mjs"),
          path.join(consumerRoot, "managed-skill-bundle-validator.mjs"),
        ),
      ]);
      const inner = await execute(
        authorities.node.file,
        [
          copiedRunner,
          "--inner",
          projectRoot,
          canaryRoot,
          consumerHome,
          consumerTemp,
          path.join(installedRoot, "dist", "index.js"),
          packageMetadata.version,
        ],
        { cwd: consumerRoot, env: environment },
      );
      const innerGates = object(
        parseJson(inner.stdout, "installed consumer result"),
        "consumer gates",
      );
      const semanticGates = Object.fromEntries(
        selectedSemanticGates.map((gate) => {
          if (innerGates[gate] !== true) fail(`Installed consumer gate failed: ${gate}.`);
          return [gate, true];
        }),
      );
      return {
        schema_version: 1,
        status: "pass",
        package_name: packageName,
        version: packageMetadata.version,
        runtime: process.versions.node,
        expected_runtime: options.expectedNode,
        transport: "loopback_http_registry",
        dependency_source: officialRegistry,
        package_manager_authority: await packageManagerEvidence(authorities),
        gates: {
          package_manager_authority: true,
          packed_candidate: true,
          local_registry_metadata: true,
          local_registry_tarball: true,
          exact_tarball_integrity: true,
          lifecycle_scripts_disabled: true,
          physical_registry_install: true,
          exact_package_lock: true,
          setup_idempotency: true,
          ...semanticGates,
        },
      };
    },
    [
      async () => {
        if (localRegistry !== undefined) await closeServer(localRegistry.server);
      },
      async () => removeTemporaryRoot(temporaryRoot),
    ],
    async (report) => {
      if (authorities === undefined) fail("Package-manager authorities were not authenticated.");
      const finalAuthority = await packageManagerEvidence(authorities);
      if (JSON.stringify(finalAuthority) !== JSON.stringify(report.package_manager_authority)) {
        fail("Package-manager authority changed before PASS publication.");
      }
      await writeFile(options.output, `${JSON.stringify(report)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    },
  );
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(scriptPath);
if (isMain) {
  try {
    const report = await run(parseLocalRegistryArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`Local-registry consumer smoke failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
