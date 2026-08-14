#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "ast-mcp-server";
const GITHUB_REPOSITORY = "yailPeralta/ast-mcp-server";
const RELEASE_BRANCH = "main";
const RELEASE_REF = `refs/heads/${RELEASE_BRANCH}`;
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const RELEASE_WORKFLOW_PATH = ".github/workflows/release.yml";
const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PACK_FILES = 10_000;
const MAX_TARBALL_BYTES = 50 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const NETWORK_TIMEOUT_MS = 20_000;
const PROMOTION_READBACK_MAX_ATTEMPTS = 6;
const PROMOTION_READBACK_DELAY_MS = 2_000;
const API_VERSION = "2026-03-10";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const STABLE_SEMVER_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u;
const SRI_PATTERN = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/u;
const NPM_PUBLISH_ENVIRONMENT = "npm-publish";
const EXPECTED_NPM_USERCONFIG =
  "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\nregistry=https://registry.npmjs.org/";
const NPM_CHILD_BASE_ENVIRONMENT = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "CI",
  "TERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
]);
const NPM_CHILD_OIDC_ENVIRONMENT = Object.freeze([
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "GITHUB_ACTIONS",
  "GITHUB_ACTOR",
  "GITHUB_ACTOR_ID",
  "GITHUB_EVENT_NAME",
  "GITHUB_REF",
  "GITHUB_REF_NAME",
  "GITHUB_REF_PROTECTED",
  "GITHUB_REF_TYPE",
  "GITHUB_REPOSITORY",
  "GITHUB_REPOSITORY_ID",
  "GITHUB_REPOSITORY_OWNER",
  "GITHUB_REPOSITORY_OWNER_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_NUMBER",
  "GITHUB_SERVER_URL",
  "GITHUB_SHA",
  "GITHUB_WORKFLOW",
  "GITHUB_WORKFLOW_REF",
  "GITHUB_WORKFLOW_SHA",
  "GITHUB_WORKSPACE",
  "RUNNER_ARCH",
  "RUNNER_ENVIRONMENT",
  "RUNNER_NAME",
  "RUNNER_OS",
  "RUNNER_TEMP",
  "RUNNER_TOOL_CACHE",
]);
const REQUIRED_PACK_FILES = Object.freeze([
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "docs/support.md",
  "dist/index.js",
  "dist/cli.js",
  "skills/structural-code-editing/SKILL.md",
  "skills/structural-code-editing/guidance.md",
  "skills/structural-code-editing/releases.json",
]);
const CONSUMER_GATES = Object.freeze([
  "lifecycle_scripts_disabled",
  "package_metadata",
  "tarball_integrity",
  "audit_signatures",
  "consumer_audit",
  "stdio_handshake",
  "exact_tool_inventory",
  "json_read",
  "toon_read",
  "default_no_cache",
  "explicit_canary",
  "rename_prepare_preview_apply_replay",
  "replace_prepare_preview_apply_replay",
  "scaffold_prepare_preview_apply_replay",
  "stale_conflict_fail_closed",
  "setup_idempotency",
]);

export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";
export const RELEASE_MODES = Object.freeze(["publish-next", "verify-next", "promote-latest"]);
export const PUBLISH_AUTHORIZATION_FILE = "publish-authorization.json";
export const PREPARED_PACKAGE_FILE = "prepared-package.json";
export const PROMOTION_AUTHORIZATION_FILE = "promotion-authorization.json";
export const RELEASE_EVIDENCE_FILES = Object.freeze([
  "registry-metadata.json",
  "npm-audit-signatures.json",
  "registry-consumer.json",
]);

function releaseFailure(message) {
  throw new Error(`Release preflight failed: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) releaseFailure(`${label} must be a plain object.`);
  return value;
}

function requireExactKeys(value, expectedKeys, label) {
  const object = requirePlainObject(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    releaseFailure(`${label} must contain only the reviewed keys.`);
  }
  return object;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    releaseFailure(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireSha(value, label = "release SHA") {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    releaseFailure(`${label} must be a lowercase 40-character SHA.`);
  }
  return value;
}

function requireVersion(value) {
  if (typeof value !== "string" || !STABLE_SEMVER_PATTERN.test(value)) {
    releaseFailure("version must be a stable semantic version without a v prefix.");
  }
  return value;
}

function requireRunId(value, label = "verification run ID") {
  if (typeof value !== "string" || !RUN_ID_PATTERN.test(value)) {
    releaseFailure(`${label} must be a positive decimal verification run ID.`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    releaseFailure(`${label} must be a positive safe integer.`);
  }
  return value;
}

function requireRegistry(value) {
  if (value !== OFFICIAL_NPM_REGISTRY) {
    releaseFailure(`registry must be exactly ${OFFICIAL_NPM_REGISTRY}.`);
  }
  return value;
}

function requireJsonValue(value, label) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
      releaseFailure(`${label} exceeds the bounded JSON size.`);
    }
    if (JSON.stringify(JSON.parse(serialized)) !== serialized) {
      releaseFailure(`${label} is not JSON round-trip safe.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Release preflight failed:"))
      throw error;
    releaseFailure(`${label} must be JSON serializable.`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectedTarballUrl(version) {
  return `${OFFICIAL_NPM_REGISTRY}/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${version}.tgz`;
}

function expectedAttestationUrl(version) {
  return `${OFFICIAL_NPM_REGISTRY}/-/npm/v1/attestations/${PACKAGE_NAME}@${version}`;
}

export function releaseEvidenceDirectory(sha, version) {
  return `/tmp/ast-mcp-release-${requireSha(sha)}-${requireVersion(version)}`;
}

export function releasePreparationDirectory(sha, version) {
  return `/tmp/ast-mcp-publish-${requireSha(sha)}-${requireVersion(version)}`;
}

export function releaseArtifactName(sha, version) {
  return `ast-mcp-release-${requireSha(sha)}-${requireVersion(version)}`;
}

export function validateTrustedPublishingNpmVersion(value) {
  if (typeof value !== "string" || !STABLE_SEMVER_PATTERN.test(value)) {
    releaseFailure("trusted publishing requires a stable npm version.");
  }
  const [major, minor, patch] = value.split(".").map(Number);
  if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
    releaseFailure("trusted publishing requires npm >=11.5.1.");
  }
  return value;
}

export function validateEphemeralNpmConfiguration({
  userconfig,
  runner_temp: runnerTemp,
  repository_root: checkedRepositoryRoot,
}) {
  if (
    typeof userconfig !== "string" ||
    typeof runnerTemp !== "string" ||
    typeof checkedRepositoryRoot !== "string" ||
    !path.isAbsolute(userconfig) ||
    !path.isAbsolute(runnerTemp) ||
    !path.isAbsolute(checkedRepositoryRoot) ||
    path.normalize(userconfig) !== userconfig ||
    path.normalize(runnerTemp) !== runnerTemp ||
    path.normalize(checkedRepositoryRoot) !== checkedRepositoryRoot
  ) {
    releaseFailure("ephemeral npm userconfig paths must be absolute and normalized.");
  }
  const relativeTemp = path.relative(checkedRepositoryRoot, runnerTemp);
  if (relativeTemp === "" || (!relativeTemp.startsWith("..") && !path.isAbsolute(relativeTemp))) {
    releaseFailure("ephemeral npm userconfig cannot live inside the repository.");
  }
  if (userconfig !== path.join(runnerTemp, ".npmrc")) {
    releaseFailure("ephemeral npm userconfig must be setup-node's exact runner-temporary .npmrc.");
  }
  return { userconfig, runner_temp: runnerTemp };
}

export function validateReleaseDispatch(input) {
  const object = requireExactKeys(
    input,
    ["mode", "sha", "version", "verification_run_id", "selected_sha", "selected_ref"],
    "release dispatch",
  );
  if (!RELEASE_MODES.includes(object.mode)) {
    releaseFailure(`release mode must be one of ${RELEASE_MODES.join(", ")}.`);
  }
  const sha = requireSha(object.sha);
  const selectedSha = requireSha(object.selected_sha, "selected branch SHA");
  const version = requireVersion(object.version);
  if (object.selected_ref !== RELEASE_REF) {
    releaseFailure(`selected ref must be exactly ${RELEASE_REF}.`);
  }
  if (selectedSha !== sha) {
    releaseFailure("selected branch head must equal the requested release SHA.");
  }
  const rawRunId = object.verification_run_id;
  if (typeof rawRunId !== "string") {
    releaseFailure("verification run ID must be a string.");
  }
  let verificationRunId = null;
  if (object.mode === "promote-latest") {
    verificationRunId = requireRunId(rawRunId);
  } else if (rawRunId !== "") {
    releaseFailure("verification run ID must be empty outside promote-latest.");
  }
  return {
    mode: object.mode,
    sha,
    version,
    verification_run_id: verificationRunId,
    selected_sha: selectedSha,
    selected_ref: RELEASE_REF,
  };
}

export function selectSuccessfulCiRun(runs, expectedSha) {
  const sha = requireSha(expectedSha);
  if (!Array.isArray(runs) || runs.length > 100) {
    releaseFailure("CI runs must be a bounded array.");
  }
  const matching = runs.filter(
    (run) =>
      isPlainObject(run) &&
      Number.isSafeInteger(run.id) &&
      run.id > 0 &&
      run.path === CI_WORKFLOW_PATH &&
      run.event === "push" &&
      run.head_branch === RELEASE_BRANCH &&
      run.head_sha === sha &&
      run.status === "completed" &&
      run.conclusion === "success",
  );
  if (matching.length === 0) {
    releaseFailure("a successful ci.yml run on the exact main push SHA is required.");
  }
  matching.sort((left, right) => right.id - left.id);
  return matching[0];
}

function validatePackPath(filePath) {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.length > 1_000 ||
    filePath.startsWith("/") ||
    filePath.includes("\\") ||
    filePath.split("/").includes("..")
  ) {
    releaseFailure("pack inspection contains an unsafe package path.");
  }
  if (
    /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.atl|\.git|node_modules)(?:\/|$)/u.test(filePath) ||
    /\.(?:db|sqlite|sqlite3|wal|shm)$/iu.test(filePath)
  ) {
    releaseFailure(`forbidden package artifact ${filePath}.`);
  }
  return filePath;
}

export function validatePackReport(report, expectedVersion) {
  const version = requireVersion(expectedVersion);
  if (!Array.isArray(report) || report.length !== 1) {
    releaseFailure("npm pack inspection must contain exactly one package report.");
  }
  const packageReport = requirePlainObject(report[0], "npm pack report");
  if (packageReport.name !== PACKAGE_NAME || packageReport.version !== version) {
    releaseFailure("npm pack package version or name does not match the release.");
  }
  if (!Array.isArray(packageReport.files) || packageReport.files.length > MAX_PACK_FILES) {
    releaseFailure("npm pack files must be a bounded array.");
  }
  const paths = [];
  for (const entry of packageReport.files) {
    const file = requirePlainObject(entry, "npm pack file");
    const filePath = validatePackPath(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      releaseFailure(`npm pack file ${filePath} has an invalid size.`);
    }
    paths.push(filePath);
  }
  if (new Set(paths).size !== paths.length) {
    releaseFailure("npm pack inspection contains duplicate package paths.");
  }
  for (const required of REQUIRED_PACK_FILES) {
    if (!paths.includes(required))
      releaseFailure(`required package artifact ${required} is missing.`);
  }
  return { package_name: PACKAGE_NAME, version, file_count: paths.length };
}

function tarballFileName(version) {
  return `${PACKAGE_NAME}-${requireVersion(version)}.tgz`;
}

export function buildTrustedPublishArguments(tarballPath) {
  const physicalPath = requireString(tarballPath, "prepared tarball path");
  if (
    !path.isAbsolute(physicalPath) ||
    path.normalize(physicalPath) !== physicalPath ||
    !path.basename(physicalPath).endsWith(".tgz")
  ) {
    releaseFailure("prepared tarball path must be absolute and normalized.");
  }
  return [
    "publish",
    physicalPath,
    "--ignore-scripts",
    "--tag",
    "next",
    "--access",
    "public",
    "--provenance",
    `--registry=${OFFICIAL_NPM_REGISTRY}`,
  ];
}

export function bindPackedPackageIdentity(packageMetadata, sha, version) {
  const object = requirePlainObject(packageMetadata, "packed package manifest");
  const expectedSha = requireSha(sha);
  const expectedVersion = requireVersion(version);
  if (object.name !== PACKAGE_NAME || object.version !== expectedVersion) {
    releaseFailure("packed package manifest does not match the expected package and version.");
  }
  if (object.gitHead !== undefined && object.gitHead !== expectedSha) {
    releaseFailure("packed package manifest contains a conflicting gitHead.");
  }
  const bound = { ...object, gitHead: expectedSha };
  requireJsonValue(bound, "packed package manifest");
  return bound;
}

export function validatePackedPackageIdentity(packageMetadata, sha, version) {
  const object = requirePlainObject(packageMetadata, "packed package manifest");
  if (
    object.name !== PACKAGE_NAME ||
    object.version !== requireVersion(version) ||
    object.gitHead !== requireSha(sha)
  ) {
    releaseFailure("packed package manifest is not bound to the exact release identity.");
  }
  requireJsonValue(object, "packed package manifest");
  return object;
}

function sha512Integrity(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

export function buildPublishAuthorizationRecord({ sha, version, ci_run_id: ciRunId }) {
  return {
    schema_version: 1,
    status: "pass",
    mode: "publish-next-authorization",
    package_name: PACKAGE_NAME,
    version: requireVersion(version),
    sha: requireSha(sha),
    ci_run_id: requirePositiveInteger(ciRunId, "CI run ID"),
    registry: OFFICIAL_NPM_REGISTRY,
  };
}

export function validatePublishAuthorizationRecord(record, expected) {
  const object = requireExactKeys(
    record,
    ["schema_version", "status", "mode", "package_name", "version", "sha", "ci_run_id", "registry"],
    "publish authorization",
  );
  const rebuilt = buildPublishAuthorizationRecord({
    ...expected,
    ci_run_id: requirePositiveInteger(object.ci_run_id, "CI run ID"),
  });
  for (const key of Object.keys(rebuilt)) {
    if (object[key] !== rebuilt[key]) {
      releaseFailure("publish authorization does not match the exact SHA, version, and CI run.");
    }
  }
  requireJsonValue(object, "publish authorization");
  return object;
}

export function buildPreparedPackageRecord({
  sha,
  version,
  ci_run_id: ciRunId,
  npm_version: npmVersion,
  pack_file_count: packFileCount,
  authorization,
  tarball,
}) {
  const authorizationBytes = Buffer.from(authorization);
  const tarballBytes = Buffer.from(tarball);
  if (authorizationBytes.length < 1 || authorizationBytes.length > MAX_JSON_BYTES) {
    releaseFailure("publish authorization bytes are outside the bounded size.");
  }
  if (tarballBytes.length < 1 || tarballBytes.length > MAX_TARBALL_BYTES) {
    releaseFailure("prepared tarball is outside the bounded size.");
  }
  if (!Number.isSafeInteger(packFileCount) || packFileCount < 1 || packFileCount > MAX_PACK_FILES) {
    releaseFailure("prepared package file count is invalid.");
  }
  return {
    schema_version: 1,
    status: "pass",
    mode: "publish-next-prepared-package",
    package_name: PACKAGE_NAME,
    version: requireVersion(version),
    sha: requireSha(sha),
    ci_run_id: requirePositiveInteger(ciRunId, "CI run ID"),
    registry: OFFICIAL_NPM_REGISTRY,
    npm_version: validateTrustedPublishingNpmVersion(npmVersion),
    pack_file_count: packFileCount,
    authorization_sha256: sha256(authorizationBytes),
    tarball_file: tarballFileName(version),
    tarball_size: tarballBytes.length,
    tarball_sha256: sha256(tarballBytes),
    tarball_integrity: sha512Integrity(tarballBytes),
  };
}

export function validatePreparedPackageRecord(record, expected) {
  const object = requireExactKeys(
    record,
    [
      "schema_version",
      "status",
      "mode",
      "package_name",
      "version",
      "sha",
      "ci_run_id",
      "registry",
      "npm_version",
      "pack_file_count",
      "authorization_sha256",
      "tarball_file",
      "tarball_size",
      "tarball_sha256",
      "tarball_integrity",
    ],
    "prepared package record",
  );
  const rebuilt = buildPreparedPackageRecord({
    ...expected,
    ci_run_id: requirePositiveInteger(object.ci_run_id, "CI run ID"),
    npm_version: object.npm_version,
    pack_file_count: object.pack_file_count,
  });
  for (const key of Object.keys(rebuilt)) {
    if (object[key] !== rebuilt[key]) {
      releaseFailure("prepared package record does not match the authorized exact tarball.");
    }
  }
  requireJsonValue(object, "prepared package record");
  return object;
}

export function classifyPublishReadback(metadata, expectedSha, phase) {
  const sha = requireSha(expectedSha);
  if (phase !== "preflight" && phase !== "ambiguous") {
    releaseFailure("publish readback phase must be preflight or ambiguous.");
  }
  if (metadata === null) {
    return phase === "preflight"
      ? { state: "eligible_to_publish", publish: true }
      : { state: "absent_requires_new_dispatch", publish: false };
  }
  const object = requirePlainObject(metadata, "published version metadata");
  if (object.gitHead !== sha) {
    releaseFailure("security failure: published gitHead does not match the release SHA.");
  }
  return { state: "already_published_needs_verification", publish: false };
}

export function validateRegistryReadback(metadata, expectedVersion, expectedSha) {
  const version = requireVersion(expectedVersion);
  const sha = requireSha(expectedSha);
  const object = requirePlainObject(metadata, "registry readback");
  if (object.name !== PACKAGE_NAME || object.version !== version) {
    releaseFailure("registry package name or exact version does not match.");
  }
  if (object.gitHead !== sha) {
    releaseFailure("registry gitHead does not match the exact release SHA.");
  }
  const engines = requirePlainObject(object.engines, "registry package engines");
  if (engines.node !== ">=22.5.0") {
    releaseFailure("registry package engines.node must be exactly >=22.5.0.");
  }
  const dist = requirePlainObject(object.dist, "registry dist metadata");
  const integrity = requireString(dist.integrity, "registry integrity");
  if (!SRI_PATTERN.test(integrity)) {
    releaseFailure("registry integrity must be a supported non-empty SRI value.");
  }
  const tarball = requireString(dist.tarball, "registry tarball URL");
  if (tarball !== expectedTarballUrl(version)) {
    releaseFailure("registry tarball URL is not the exact official-registry URL.");
  }
  const attestations = requirePlainObject(dist.attestations, "registry attestations");
  const attestationUrl = requireString(attestations.url, "registry attestation URL");
  if (attestationUrl !== expectedAttestationUrl(version)) {
    releaseFailure("registry attestation URL is not the exact official-registry URL.");
  }
  const provenance = requirePlainObject(attestations.provenance, "registry provenance");
  if (provenance.predicateType !== SLSA_PROVENANCE_V1) {
    releaseFailure("registry provenance predicate must be SLSA provenance v1.");
  }
  const distTags = requirePlainObject(object.dist_tags, "registry dist-tags");
  if (distTags.next !== version) {
    releaseFailure("registry next dist-tag does not match the exact version.");
  }
  if (typeof distTags.latest !== "string" || !STABLE_SEMVER_PATTERN.test(distTags.latest)) {
    releaseFailure("registry latest dist-tag must be a stable semantic version.");
  }
  return {
    package_name: PACKAGE_NAME,
    version,
    git_head: sha,
    engines_node: ">=22.5.0",
    integrity,
    tarball,
    attestation_url: attestationUrl,
    predicate_type: SLSA_PROVENANCE_V1,
    next: version,
    latest: distTags.latest,
  };
}

export function validateConsumerReport(report, expectedVersion, expectedSha) {
  const version = requireVersion(expectedVersion);
  const sha = requireSha(expectedSha);
  const object = requireExactKeys(
    report,
    ["schema_version", "status", "package_name", "version", "git_head", "registry", "gates"],
    "registry consumer report",
  );
  if (
    object.schema_version !== 1 ||
    object.status !== "pass" ||
    object.package_name !== PACKAGE_NAME ||
    object.version !== version ||
    object.git_head !== sha ||
    object.registry !== OFFICIAL_NPM_REGISTRY
  ) {
    releaseFailure("registry consumer identity or status does not match the release.");
  }
  const gates = requireExactKeys(object.gates, CONSUMER_GATES, "registry consumer gates");
  for (const gate of CONSUMER_GATES) {
    if (gates[gate] !== true) releaseFailure(`consumer gate ${gate} did not pass.`);
  }
  requireJsonValue(object, "registry consumer report");
  return object;
}

export function validateAuditSignaturesReport(report, expectedRegistry) {
  const registry = requireRegistry(expectedRegistry);
  const object = requireExactKeys(
    report,
    ["schema_version", "status", "command", "registry", "exit_code", "result"],
    "audit signatures report",
  );
  if (
    object.schema_version !== 1 ||
    object.status !== "pass" ||
    object.command !== "npm audit signatures" ||
    object.registry !== registry ||
    object.exit_code !== 0 ||
    !isPlainObject(object.result)
  ) {
    releaseFailure("npm audit signatures evidence is not a successful official-registry result.");
  }
  requireJsonValue(object, "audit signatures report");
  return object;
}

export function buildVerificationEvidence({
  sha,
  version,
  verification_run_id: verificationRunId,
  integrity,
  members,
}) {
  const normalizedSha = requireSha(sha);
  const normalizedVersion = requireVersion(version);
  const normalizedRunId = requireRunId(verificationRunId);
  if (typeof integrity !== "string" || !SRI_PATTERN.test(integrity)) {
    releaseFailure("verification integrity must be a supported SRI value.");
  }
  const memberObject = requireExactKeys(members, RELEASE_EVIDENCE_FILES, "evidence members");
  const memberHashes = {};
  const memberSizes = {};
  for (const name of RELEASE_EVIDENCE_FILES) {
    const bytes = memberObject[name];
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_JSON_BYTES
    ) {
      releaseFailure(`evidence member ${name} must be non-empty and bounded.`);
    }
    memberHashes[name] = sha256(bytes);
    memberSizes[name] = bytes.byteLength;
  }
  return {
    schema_version: 1,
    status: "pass",
    mode: "verify-next",
    package_name: PACKAGE_NAME,
    version: normalizedVersion,
    sha: normalizedSha,
    verification_run_id: normalizedRunId,
    registry: OFFICIAL_NPM_REGISTRY,
    integrity,
    member_hashes: memberHashes,
    member_sizes: memberSizes,
  };
}

export function validateVerificationEvidence(evidence, expected) {
  const object = requireExactKeys(
    evidence,
    [
      "schema_version",
      "status",
      "mode",
      "package_name",
      "version",
      "sha",
      "verification_run_id",
      "registry",
      "integrity",
      "member_hashes",
      "member_sizes",
    ],
    "verification evidence",
  );
  const rebuilt = buildVerificationEvidence(expected);
  for (const key of [
    "schema_version",
    "status",
    "mode",
    "package_name",
    "version",
    "sha",
    "registry",
    "integrity",
  ]) {
    if (object[key] !== rebuilt[key])
      releaseFailure(`verification evidence ${key} does not match.`);
  }
  if (object.verification_run_id !== rebuilt.verification_run_id) {
    releaseFailure("verification run does not match the requested exact run ID.");
  }
  const hashes = requireExactKeys(
    object.member_hashes,
    RELEASE_EVIDENCE_FILES,
    "verification member hashes",
  );
  const sizes = requireExactKeys(
    object.member_sizes,
    RELEASE_EVIDENCE_FILES,
    "verification member sizes",
  );
  for (const name of RELEASE_EVIDENCE_FILES) {
    if (hashes[name] !== rebuilt.member_hashes[name]) {
      releaseFailure(`verification member hash for ${name} does not match.`);
    }
    if (sizes[name] !== rebuilt.member_sizes[name]) {
      releaseFailure(`verification member size for ${name} does not match.`);
    }
  }
  requireJsonValue(object, "verification evidence");
  return object;
}

export function buildPromotionGateRecord({
  sha,
  version,
  verification_run_id: verificationRunId,
  artifact_id: artifactId,
  integrity,
  verification_evidence: verificationEvidence,
}) {
  const normalizedSha = requireSha(sha);
  const normalizedVersion = requireVersion(version);
  const normalizedRunId = requireRunId(verificationRunId);
  const normalizedArtifactId = requirePositiveInteger(artifactId, "verification artifact ID");
  if (typeof integrity !== "string" || !SRI_PATTERN.test(integrity)) {
    releaseFailure("promotion integrity must be a supported SRI value.");
  }
  if (
    !(verificationEvidence instanceof Uint8Array) ||
    verificationEvidence.byteLength === 0 ||
    verificationEvidence.byteLength > MAX_JSON_BYTES
  ) {
    releaseFailure("promotion verification evidence must be non-empty and bounded.");
  }
  return {
    schema_version: 1,
    status: "pass",
    mode: "promote-latest-authorization",
    package_name: PACKAGE_NAME,
    version: normalizedVersion,
    sha: normalizedSha,
    verification_run_id: normalizedRunId,
    artifact_id: normalizedArtifactId,
    registry: OFFICIAL_NPM_REGISTRY,
    integrity,
    verification_evidence_sha256: sha256(verificationEvidence),
  };
}

export function validatePromotionGateRecord(record, expected) {
  const object = requireExactKeys(
    record,
    [
      "schema_version",
      "status",
      "mode",
      "package_name",
      "version",
      "sha",
      "verification_run_id",
      "artifact_id",
      "registry",
      "integrity",
      "verification_evidence_sha256",
    ],
    "promotion authorization",
  );
  const rebuilt = buildPromotionGateRecord({
    ...expected,
    artifact_id: requirePositiveInteger(object.artifact_id, "verification artifact ID"),
  });
  for (const key of Object.keys(rebuilt)) {
    if (object[key] !== rebuilt[key]) {
      releaseFailure("promotion authorization does not match the exact evidence and artifact.");
    }
  }
  requireJsonValue(object, "promotion authorization");
  return object;
}

export function validatePromotionAuthorization({
  verification_run_id: verificationRunId,
  environment,
  npm_token_present: npmTokenPresent,
}) {
  const runId = requireRunId(verificationRunId);
  if (environment !== "production") {
    releaseFailure("promotion must be bound to the protected production Environment.");
  }
  if (npmTokenPresent !== true) {
    releaseFailure("the production Environment promotion credential is absent.");
  }
  return { verification_run_id: runId, environment: "production" };
}

export function validateReleaseCredentialBoundary(phase, credentials) {
  const actual = requireExactKeys(
    credentials,
    [
      "github_token_present",
      "gh_token_present",
      "node_auth_token_present",
      "npm_token_present",
      "oidc_token_present",
      "oidc_url_present",
    ],
    "release credential boundary",
  );
  const expected = {
    "validate-environment": [false, false, false, false, false, false],
    "authorize-publish": [true, false, false, false, false, false],
    "prepare-publish": [false, false, false, false, false, false],
    "publish-next": [false, false, false, false, true, true],
    "verify-next": [false, false, false, false, false, false],
    "validate-promotion": [true, false, false, false, false, false],
    "promote-latest": [false, false, true, false, false, false],
  }[phase];
  const values = [
    actual.github_token_present,
    actual.gh_token_present,
    actual.node_auth_token_present,
    actual.npm_token_present,
    actual.oidc_token_present,
    actual.oidc_url_present,
  ];
  if (
    expected === undefined ||
    values.some((value) => typeof value !== "boolean") ||
    JSON.stringify(values) !== JSON.stringify(expected)
  ) {
    releaseFailure(`release credential boundary is invalid for ${String(phase)}.`);
  }
  return { phase, ...actual };
}

export function validatePackageManagerEnvironment(environment) {
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
    releaseFailure("package-manager environment must be an object.");
  }
  const values = environment;
  const allowed = new Set(["NPM_CONFIG_USERCONFIG", "NODE_AUTH_TOKEN"]);
  const unexpected = Object.keys(values).filter((name) => {
    if (allowed.has(name)) return false;
    const normalized = name.toUpperCase();
    return (
      normalized.startsWith("NPM_") ||
      normalized.startsWith("YARN_") ||
      normalized.startsWith("COREPACK_")
    );
  });
  if (unexpected.length > 0) {
    releaseFailure(
      "unexpected package-manager configuration environment is forbidden (npm, Yarn, or Corepack).",
    );
  }
  return true;
}

export function validateSetupNodeNpmUserconfig(value) {
  if (value !== EXPECTED_NPM_USERCONFIG) {
    releaseFailure("ephemeral npm userconfig must match setup-node's exact reviewed contents.");
  }
  return true;
}

function validateEnvironmentCredentialBoundary(phase) {
  const boundary = validateReleaseCredentialBoundary(phase, {
    github_token_present: Boolean(process.env.GITHUB_TOKEN),
    gh_token_present: Boolean(process.env.GH_TOKEN),
    node_auth_token_present: Boolean(process.env.NODE_AUTH_TOKEN),
    npm_token_present: Boolean(process.env.NPM_TOKEN),
    oidc_token_present: Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
    oidc_url_present: Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL),
  });
  validatePackageManagerEnvironment(process.env);
  return boundary;
}

function classifyValidatedPromotionReadback(readback) {
  if (readback.latest === readback.version) {
    return { state: "already_promoted", promote: false };
  }
  return { state: "eligible_to_promote", promote: true };
}

export function classifyPromotionReadback(metadata, expectedVersion, expectedSha) {
  return classifyValidatedPromotionReadback(
    validateRegistryReadback(metadata, expectedVersion, expectedSha),
  );
}

export function validatePromotionRegistryState(
  metadata,
  expectedVersion,
  expectedSha,
  expectedIntegrity,
) {
  const registry = validateRegistryReadback(metadata, expectedVersion, expectedSha);
  if (registry.integrity !== expectedIntegrity) {
    releaseFailure("live registry integrity no longer matches promotion authorization.");
  }
  return { registry, state: classifyValidatedPromotionReadback(registry) };
}

export function validatePromotedRegistryState(
  metadata,
  expectedVersion,
  expectedSha,
  expectedIntegrity,
) {
  const { registry, state } = validatePromotionRegistryState(
    metadata,
    expectedVersion,
    expectedSha,
    expectedIntegrity,
  );
  if (state.state !== "already_promoted") {
    releaseFailure("latest dist-tag readback does not match after promotion.");
  }
  return registry;
}

export async function waitForPromotedRegistryState({
  readRegistry,
  expectedVersion,
  expectedSha,
  expectedIntegrity,
  maxAttempts = PROMOTION_READBACK_MAX_ATTEMPTS,
  delayMs = PROMOTION_READBACK_DELAY_MS,
  sleep = (milliseconds) =>
    new Promise((resolve) => {
      globalThis.setTimeout(resolve, milliseconds);
    }),
}) {
  if (
    typeof readRegistry !== "function" ||
    typeof sleep !== "function" ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 20 ||
    !Number.isSafeInteger(delayMs) ||
    delayMs < 0 ||
    delayMs > 30_000
  ) {
    releaseFailure("promotion readback retry configuration is invalid.");
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { registry, state } = validatePromotionRegistryState(
      await readRegistry(),
      expectedVersion,
      expectedSha,
      expectedIntegrity,
    );
    if (state.state === "already_promoted") return registry;
    if (attempt < maxAttempts) await sleep(delayMs);
  }
  releaseFailure(
    `latest dist-tag readback does not match after ${maxAttempts} bounded promotion checks.`,
  );
}

async function assertExactEvidenceDirectory(evidenceRoot, expectedNames) {
  const rootMetadata = await lstat(evidenceRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    releaseFailure("release evidence root must be a physical directory.");
  }
  const actualNames = (await readdir(evidenceRoot)).sort();
  const expected = [...expectedNames].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expected)) {
    releaseFailure("release evidence directory must contain exactly the reviewed files.");
  }
  for (const name of expected) {
    const metadata = await lstat(path.join(evidenceRoot, name));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      releaseFailure(`release evidence ${name} must be a unique physical regular file.`);
    }
  }
}

async function readBoundedFile(filePath, label) {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < 1 ||
    metadata.size > MAX_JSON_BYTES
  ) {
    releaseFailure(`${label} must be a non-empty regular file within ${MAX_JSON_BYTES} bytes.`);
  }
  return readFile(filePath);
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    releaseFailure(`${label} must contain valid JSON.`);
  }
}

async function readJsonFile(filePath, label) {
  return parseJsonBytes(await readBoundedFile(filePath, label), label);
}

async function readResponseBytes(response, label) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_JSON_BYTES) {
    releaseFailure(`${label} exceeds the bounded response size.`);
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_JSON_BYTES) {
      await reader.cancel();
      releaseFailure(`${label} exceeds the bounded response size.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

async function fetchJson(url, { token, allowNotFound = false, label }) {
  const headers = {
    Accept: "application/vnd.github+json, application/json",
    "User-Agent": "ast-mcp-server-release-preflight",
  };
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
    headers["X-GitHub-Api-Version"] = API_VERSION;
  }
  let response;
  try {
    response = await globalThis.fetch(url, {
      headers,
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
  } catch {
    releaseFailure(`${label} request failed or timed out.`);
  }
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) releaseFailure(`${label} returned HTTP ${response.status}.`);
  return parseJsonBytes(await readResponseBytes(response, label), label);
}

async function githubJson(endpoint, token, label) {
  if (typeof token !== "string" || token.length === 0) {
    releaseFailure("GITHUB_TOKEN is required for exact GitHub readback.");
  }
  return fetchJson(`https://api.github.com${endpoint}`, { token, label });
}

async function fetchRegistryReadback(version, allowNotFound = false) {
  const normalizedVersion = requireVersion(version);
  const versionDocument = await fetchJson(
    `${OFFICIAL_NPM_REGISTRY}/${PACKAGE_NAME}/${normalizedVersion}`,
    { allowNotFound, label: "exact npm version readback" },
  );
  if (versionDocument === null) return null;
  const packageDocument = await fetchJson(`${OFFICIAL_NPM_REGISTRY}/${PACKAGE_NAME}`, {
    label: "npm package dist-tag readback",
  });
  const packageObject = requirePlainObject(packageDocument, "npm package readback");
  return {
    ...requirePlainObject(versionDocument, "npm version readback"),
    dist_tags: requirePlainObject(packageObject["dist-tags"], "npm package dist-tags"),
  };
}

async function executeCommand(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: MAX_JSON_BYTES,
      timeout: COMMAND_TIMEOUT_MS,
      ...options,
    });
  } catch (error) {
    const failure = new Error(`Command failed: ${path.basename(file)} ${args[0] ?? ""}`);
    failure.cause = error;
    throw failure;
  }
}

export function buildNpmChildEnvironment(
  sourceEnvironment,
  { includeNodeAuthToken = false, includeOidc = false, userconfig } = {},
) {
  if (typeof userconfig !== "string" || userconfig.length === 0) {
    releaseFailure("the reviewed npm child environment requires an ephemeral userconfig.");
  }
  const environment = {};
  const copiedNames = includeOidc
    ? [...NPM_CHILD_BASE_ENVIRONMENT, ...NPM_CHILD_OIDC_ENVIRONMENT]
    : NPM_CHILD_BASE_ENVIRONMENT;
  for (const name of copiedNames) {
    if (sourceEnvironment[name] !== undefined) environment[name] = sourceEnvironment[name];
  }
  environment.NPM_CONFIG_USERCONFIG = userconfig;
  environment.NPM_CONFIG_GLOBALCONFIG = "/dev/null";
  environment.NPM_CONFIG_CACHE = path.join(
    sourceEnvironment.RUNNER_TEMP ?? path.dirname(userconfig),
    "npm-cache",
  );
  if (includeNodeAuthToken) environment.NODE_AUTH_TOKEN = sourceEnvironment.NODE_AUTH_TOKEN;
  return environment;
}

function npmChildEnvironment(options = {}) {
  return buildNpmChildEnvironment(process.env, options);
}

function environmentDispatch() {
  return validateReleaseDispatch({
    mode: process.env.RELEASE_MODE ?? "",
    sha: process.env.RELEASE_SHA ?? "",
    version: process.env.RELEASE_VERSION ?? "",
    verification_run_id: process.env.VERIFICATION_RUN_ID ?? "",
    selected_sha: process.env.GITHUB_SHA ?? "",
    selected_ref: process.env.GITHUB_REF ?? "",
  });
}

function requireMode(dispatch, mode) {
  if (dispatch.mode !== mode) releaseFailure(`CLI mode ${mode} does not match the dispatch mode.`);
}

async function assertPackageVersion(version) {
  const packageMetadata = await readJsonFile(
    path.join(repositoryRoot, "package.json"),
    "package.json",
  );
  if (packageMetadata.name !== PACKAGE_NAME || packageMetadata.version !== version) {
    releaseFailure("package.json name or package version does not match the release input.");
  }
}

async function assertEphemeralNpmConfiguration() {
  const configuration = validateEphemeralNpmConfiguration({
    userconfig: process.env.NPM_CONFIG_USERCONFIG ?? "",
    runner_temp: process.env.RUNNER_TEMP ?? "",
    repository_root: repositoryRoot,
  });
  let userconfigMetadata;
  try {
    userconfigMetadata = await lstat(configuration.userconfig);
  } catch (error) {
    if (error?.code === "ENOENT") {
      releaseFailure("ephemeral npm userconfig must exist as a unique physical regular file.");
    }
    throw error;
  }
  if (
    !userconfigMetadata.isFile() ||
    userconfigMetadata.isSymbolicLink() ||
    userconfigMetadata.nlink !== 1 ||
    userconfigMetadata.size !== Buffer.byteLength(EXPECTED_NPM_USERCONFIG, "utf8")
  ) {
    releaseFailure("ephemeral npm userconfig must exist as a unique physical regular file.");
  }
  validateSetupNodeNpmUserconfig(await readFile(configuration.userconfig, "utf8"));
  try {
    await stat(path.join(repositoryRoot, ".npmrc"));
  } catch (error) {
    if (error?.code === "ENOENT") return configuration;
    throw error;
  }
  releaseFailure("repository npm credential files are forbidden in release automation.");
}

async function runValidateEnvironment(dispatch) {
  if (dispatch.mode !== "publish-next" && dispatch.mode !== "verify-next") {
    releaseFailure("environment preflight is limited to publication and verification phases.");
  }
  validateEnvironmentCredentialBoundary("validate-environment");
  if (
    dispatch.mode === "publish-next" &&
    process.env.RELEASE_ENVIRONMENT !== NPM_PUBLISH_ENVIRONMENT
  ) {
    releaseFailure("trusted publication must be bound to the protected npm-publish Environment.");
  }
  await assertPackageVersion(dispatch.version);
  await assertEphemeralNpmConfiguration();
  return {
    status: "pass",
    mode: dispatch.mode,
    environment_preflight: true,
  };
}

async function assertMainHeadAndCi(dispatch) {
  if (process.env.GITHUB_REPOSITORY !== GITHUB_REPOSITORY) {
    releaseFailure(`GitHub repository must be exactly ${GITHUB_REPOSITORY}.`);
  }
  const token = process.env.GITHUB_TOKEN;
  const reference = await githubJson(
    `/repos/${GITHUB_REPOSITORY}/git/ref/heads/${RELEASE_BRANCH}`,
    token,
    "main branch readback",
  );
  if (reference?.object?.sha !== dispatch.sha) {
    releaseFailure("remote main branch head does not equal the exact release SHA.");
  }
  const runs = await githubJson(
    `/repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${dispatch.sha}&branch=${RELEASE_BRANCH}&event=push&status=success&per_page=20`,
    token,
    "exact-SHA CI readback",
  );
  return selectSuccessfulCiRun(runs?.workflow_runs, dispatch.sha);
}

async function createPreparationRoot(dispatch) {
  const preparationRoot = releasePreparationDirectory(dispatch.sha, dispatch.version);
  try {
    await mkdir(preparationRoot, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      releaseFailure("publish preparation root already exists; a fresh dispatch is required.");
    }
    throw error;
  }
  const metadata = await lstat(preparationRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    releaseFailure("publish preparation root must be a physical directory.");
  }
  return preparationRoot;
}

async function readPublishAuthorization(preparationRoot, dispatch) {
  const authorizationBytes = await readBoundedFile(
    path.join(preparationRoot, PUBLISH_AUTHORIZATION_FILE),
    "publish authorization",
  );
  const authorization = validatePublishAuthorizationRecord(
    parseJsonBytes(authorizationBytes, "publish authorization"),
    { sha: dispatch.sha, version: dispatch.version },
  );
  return { authorization, authorizationBytes };
}

async function readPreparedTarball(filePath) {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < 1 ||
    metadata.size > MAX_TARBALL_BYTES
  ) {
    releaseFailure("prepared tarball must be a bounded unique physical regular file.");
  }
  return readFile(filePath);
}

async function inspectAndReadPack(
  version,
  userconfig,
  destinationRoot,
  sourceDirectory,
  expectedEntries,
) {
  const packArguments = [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    destinationRoot,
  ];
  if (sourceDirectory !== undefined) packArguments.push(sourceDirectory);
  const { stdout } = await executeCommand("npm", packArguments, {
    env: npmChildEnvironment({ userconfig }),
  });
  const report = parseJsonBytes(Buffer.from(stdout), "npm pack output");
  const pack = validatePackReport(report, version);
  const packageReport = requirePlainObject(report[0], "npm pack report");
  const expectedFile = tarballFileName(version);
  await assertExactEvidenceDirectory(destinationRoot, expectedEntries);
  const tarball = await readPreparedTarball(path.join(destinationRoot, expectedFile));
  if (
    packageReport.filename !== expectedFile ||
    packageReport.size !== tarball.length ||
    (packageReport.totalFiles !== undefined && packageReport.totalFiles !== pack.file_count) ||
    packageReport.shasum !== createHash("sha1").update(tarball).digest("hex") ||
    packageReport.integrity !== sha512Integrity(tarball)
  ) {
    releaseFailure("npm pack report does not match the exact physical tarball.");
  }
  return { pack, tarball };
}

async function buildGitHeadBoundPack(dispatch, userconfig, runnerTemp, preparationRoot) {
  const stagingRoot = await mkdtemp(path.join(runnerTemp, "ast-mcp-publish-stage-"));
  const initialRoot = path.join(stagingRoot, "initial");
  const extractedRoot = path.join(stagingRoot, "extracted");
  const expectedFile = tarballFileName(dispatch.version);
  try {
    await Promise.all([mkdir(initialRoot, { mode: 0o700 }), mkdir(extractedRoot, { mode: 0o700 })]);
    await inspectAndReadPack(dispatch.version, userconfig, initialRoot, undefined, [expectedFile]);
    const utilityEnvironment = npmChildEnvironment({ userconfig });
    await executeCommand(
      "tar",
      ["-xzf", path.join(initialRoot, expectedFile), "-C", extractedRoot],
      { env: utilityEnvironment },
    );
    const packageRoot = path.join(extractedRoot, "package");
    const packageRootMetadata = await lstat(packageRoot);
    if (!packageRootMetadata.isDirectory() || packageRootMetadata.isSymbolicLink()) {
      releaseFailure("staged package root must be a physical directory.");
    }
    const packageManifestPath = path.join(packageRoot, "package.json");
    const packageManifestMetadata = await lstat(packageManifestPath);
    if (
      !packageManifestMetadata.isFile() ||
      packageManifestMetadata.isSymbolicLink() ||
      packageManifestMetadata.nlink !== 1 ||
      packageManifestMetadata.size < 1 ||
      packageManifestMetadata.size > MAX_JSON_BYTES
    ) {
      releaseFailure("staged package manifest must be a bounded unique physical regular file.");
    }
    const packageManifest = bindPackedPackageIdentity(
      parseJsonBytes(await readFile(packageManifestPath), "packed package manifest"),
      dispatch.sha,
      dispatch.version,
    );
    await writeFile(packageManifestPath, `${JSON.stringify(packageManifest, undefined, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
      mode: 0o600,
    });
    const prepared = await inspectAndReadPack(
      dispatch.version,
      userconfig,
      preparationRoot,
      packageRoot,
      [PUBLISH_AUTHORIZATION_FILE, expectedFile],
    );
    const { stdout: packedManifestOutput } = await executeCommand(
      "tar",
      ["-xOf", path.join(preparationRoot, expectedFile), "package/package.json"],
      { env: utilityEnvironment },
    );
    validatePackedPackageIdentity(
      parseJsonBytes(Buffer.from(packedManifestOutput), "packed package manifest"),
      dispatch.sha,
      dispatch.version,
    );
    return prepared;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function runAuthorizePublish(dispatch) {
  requireMode(dispatch, "publish-next");
  validateEnvironmentCredentialBoundary("authorize-publish");
  if (process.env.RELEASE_ENVIRONMENT !== NPM_PUBLISH_ENVIRONMENT) {
    releaseFailure("trusted publication must be bound to the protected npm-publish Environment.");
  }
  await assertPackageVersion(dispatch.version);
  const ciRun = await assertMainHeadAndCi(dispatch);
  const preparationRoot = await createPreparationRoot(dispatch);
  const authorization = buildPublishAuthorizationRecord({
    sha: dispatch.sha,
    version: dispatch.version,
    ci_run_id: ciRun.id,
  });
  await writeFile(
    path.join(preparationRoot, PUBLISH_AUTHORIZATION_FILE),
    `${JSON.stringify(authorization)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  await assertExactEvidenceDirectory(preparationRoot, [PUBLISH_AUTHORIZATION_FILE]);
  return authorization;
}

async function runPreparePublish(dispatch) {
  requireMode(dispatch, "publish-next");
  validateEnvironmentCredentialBoundary("prepare-publish");
  if (process.env.RELEASE_ENVIRONMENT !== NPM_PUBLISH_ENVIRONMENT) {
    releaseFailure("trusted publication must be bound to the protected npm-publish Environment.");
  }
  await assertPackageVersion(dispatch.version);
  const npmConfiguration = await assertEphemeralNpmConfiguration();
  const preparationRoot = releasePreparationDirectory(dispatch.sha, dispatch.version);
  await assertExactEvidenceDirectory(preparationRoot, [PUBLISH_AUTHORIZATION_FILE]);
  const { authorization, authorizationBytes } = await readPublishAuthorization(
    preparationRoot,
    dispatch,
  );
  const npmVersion = validateTrustedPublishingNpmVersion(
    (
      await executeCommand("npm", ["--version"], {
        env: npmChildEnvironment({ userconfig: npmConfiguration.userconfig }),
      })
    ).stdout.trim(),
  );
  await executeCommand("yarn", ["build"], {
    env: npmChildEnvironment({ userconfig: npmConfiguration.userconfig }),
  });
  const { pack, tarball } = await buildGitHeadBoundPack(
    dispatch,
    npmConfiguration.userconfig,
    npmConfiguration.runner_temp,
    preparationRoot,
  );
  const prepared = buildPreparedPackageRecord({
    sha: dispatch.sha,
    version: dispatch.version,
    ci_run_id: authorization.ci_run_id,
    npm_version: npmVersion,
    pack_file_count: pack.file_count,
    authorization: authorizationBytes,
    tarball,
  });
  await writeFile(
    path.join(preparationRoot, PREPARED_PACKAGE_FILE),
    `${JSON.stringify(prepared)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  await assertExactEvidenceDirectory(preparationRoot, [
    PUBLISH_AUTHORIZATION_FILE,
    PREPARED_PACKAGE_FILE,
    prepared.tarball_file,
  ]);
  return prepared;
}

async function loadPreparedPublication(dispatch) {
  const preparationRoot = releasePreparationDirectory(dispatch.sha, dispatch.version);
  const expectedTarball = tarballFileName(dispatch.version);
  await assertExactEvidenceDirectory(preparationRoot, [
    PUBLISH_AUTHORIZATION_FILE,
    PREPARED_PACKAGE_FILE,
    expectedTarball,
  ]);
  const { authorization, authorizationBytes } = await readPublishAuthorization(
    preparationRoot,
    dispatch,
  );
  const tarballPath = path.join(preparationRoot, expectedTarball);
  const tarball = await readPreparedTarball(tarballPath);
  const prepared = validatePreparedPackageRecord(
    await readJsonFile(
      path.join(preparationRoot, PREPARED_PACKAGE_FILE),
      "prepared package record",
    ),
    {
      sha: dispatch.sha,
      version: dispatch.version,
      authorization: authorizationBytes,
      tarball,
    },
  );
  if (prepared.ci_run_id !== authorization.ci_run_id) {
    releaseFailure("prepared package CI run does not match its publish authorization.");
  }
  return { authorization, prepared, tarballPath };
}

async function runPublishNext(dispatch) {
  requireMode(dispatch, "publish-next");
  validateEnvironmentCredentialBoundary("publish-next");
  if (process.env.RELEASE_ENVIRONMENT !== NPM_PUBLISH_ENVIRONMENT) {
    releaseFailure("trusted publication must be bound to the protected npm-publish Environment.");
  }
  await assertPackageVersion(dispatch.version);
  const npmConfiguration = await assertEphemeralNpmConfiguration();
  const { authorization, prepared, tarballPath } = await loadPreparedPublication(dispatch);
  const currentNpmVersion = validateTrustedPublishingNpmVersion(
    (
      await executeCommand("npm", ["--version"], {
        env: npmChildEnvironment({ userconfig: npmConfiguration.userconfig }),
      })
    ).stdout.trim(),
  );
  if (currentNpmVersion !== prepared.npm_version) {
    releaseFailure("publication npm version does not match the prepared package record.");
  }
  const initial = await fetchRegistryReadback(dispatch.version, true);
  const state = classifyPublishReadback(initial, dispatch.sha, "preflight");
  if (!state.publish) {
    return {
      status: "pass",
      mode: dispatch.mode,
      sha: dispatch.sha,
      version: dispatch.version,
      ci_run_id: authorization.ci_run_id,
      npm_version: prepared.npm_version,
      pack_file_count: prepared.pack_file_count,
      ...state,
    };
  }
  let publishError;
  try {
    await executeCommand("npm", buildTrustedPublishArguments(tarballPath), {
      env: npmChildEnvironment({
        includeOidc: true,
        userconfig: npmConfiguration.userconfig,
      }),
    });
  } catch (error) {
    publishError = error;
  }
  const finalReadback = await fetchRegistryReadback(dispatch.version, true);
  const finalState = classifyPublishReadback(finalReadback, dispatch.sha, "ambiguous");
  if (finalState.state === "absent_requires_new_dispatch") {
    releaseFailure(
      `publish result is ambiguous and the version is absent; a new explicit dispatch is required${publishError ? "" : "."}`,
    );
  }
  return {
    status: "pass",
    mode: dispatch.mode,
    sha: dispatch.sha,
    version: dispatch.version,
    ci_run_id: authorization.ci_run_id,
    npm_version: prepared.npm_version,
    pack_file_count: prepared.pack_file_count,
    ...finalState,
  };
}

async function loadEvidenceMembers(evidenceRoot) {
  const members = {};
  for (const name of RELEASE_EVIDENCE_FILES) {
    members[name] = await readBoundedFile(path.join(evidenceRoot, name), name);
  }
  return members;
}

async function validateEvidenceMembers(members, version, sha) {
  const metadata = parseJsonBytes(members["registry-metadata.json"], "registry metadata");
  const audit = parseJsonBytes(members["npm-audit-signatures.json"], "audit signatures report");
  const consumer = parseJsonBytes(members["registry-consumer.json"], "registry consumer report");
  const registry = validateRegistryReadback(metadata, version, sha);
  validateAuditSignaturesReport(audit, OFFICIAL_NPM_REGISTRY);
  validateConsumerReport(consumer, version, sha);
  return registry;
}

async function runVerifyNext(dispatch) {
  requireMode(dispatch, "verify-next");
  validateEnvironmentCredentialBoundary("verify-next");
  const runId = requireRunId(process.env.GITHUB_RUN_ID ?? "", "current GitHub run ID");
  const evidenceRoot = releaseEvidenceDirectory(dispatch.sha, dispatch.version);
  await assertExactEvidenceDirectory(evidenceRoot, RELEASE_EVIDENCE_FILES);
  const members = await loadEvidenceMembers(evidenceRoot);
  const registry = await validateEvidenceMembers(members, dispatch.version, dispatch.sha);
  const evidence = buildVerificationEvidence({
    sha: dispatch.sha,
    version: dispatch.version,
    verification_run_id: runId,
    integrity: registry.integrity,
    members,
  });
  const outputPath = path.join(evidenceRoot, "verification.json");
  await writeFile(outputPath, `${JSON.stringify(evidence)}\n`, { encoding: "utf8", flag: "wx" });
  await assertExactEvidenceDirectory(evidenceRoot, [
    ...RELEASE_EVIDENCE_FILES,
    "verification.json",
  ]);
  return evidence;
}

async function assertVerificationRun(runId, sha, token) {
  const run = await githubJson(
    `/repos/${GITHUB_REPOSITORY}/actions/runs/${runId}`,
    token,
    "verification workflow run",
  );
  if (
    run?.id?.toString() !== runId ||
    run?.path !== RELEASE_WORKFLOW_PATH ||
    run?.event !== "workflow_dispatch" ||
    run?.head_branch !== RELEASE_BRANCH ||
    run?.head_sha !== sha ||
    run?.status !== "completed" ||
    run?.conclusion !== "success"
  ) {
    releaseFailure("verification workflow run identity or conclusion does not match.");
  }
}

async function assertVerificationArtifact(runId, sha, version, token) {
  const artifactName = releaseArtifactName(sha, version);
  const result = await githubJson(
    `/repos/${GITHUB_REPOSITORY}/actions/runs/${runId}/artifacts?name=${artifactName}&per_page=10`,
    token,
    "verification artifact readback",
  );
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
  const matching = artifacts.filter(
    (artifact) =>
      isPlainObject(artifact) &&
      artifact.name === artifactName &&
      artifact.expired === false &&
      Number.isSafeInteger(artifact.id) &&
      artifact.id > 0,
  );
  if (matching.length !== 1) {
    releaseFailure("exact verification artifact is missing, duplicated, or expired.");
  }
  return matching[0];
}

async function readAndValidateVerification(evidenceRoot, dispatch) {
  const members = await loadEvidenceMembers(evidenceRoot);
  const registry = await validateEvidenceMembers(members, dispatch.version, dispatch.sha);
  const evidenceBytes = await readBoundedFile(
    path.join(evidenceRoot, "verification.json"),
    "verification evidence",
  );
  const evidence = parseJsonBytes(evidenceBytes, "verification evidence");
  validateVerificationEvidence(evidence, {
    sha: dispatch.sha,
    version: dispatch.version,
    verification_run_id: dispatch.verification_run_id,
    integrity: registry.integrity,
    members,
  });
  return { members, registry, evidenceBytes };
}

async function runValidatePromotion(dispatch) {
  requireMode(dispatch, "promote-latest");
  validateEnvironmentCredentialBoundary("validate-promotion");
  if (process.env.RELEASE_ENVIRONMENT !== "production") {
    releaseFailure("promotion must be bound to the protected production Environment.");
  }
  if (process.env.GITHUB_REPOSITORY !== GITHUB_REPOSITORY) {
    releaseFailure(`GitHub repository must be exactly ${GITHUB_REPOSITORY}.`);
  }
  const evidenceRoot = releaseEvidenceDirectory(dispatch.sha, dispatch.version);
  await assertExactEvidenceDirectory(evidenceRoot, [
    ...RELEASE_EVIDENCE_FILES,
    "verification.json",
  ]);
  const { registry, evidenceBytes } = await readAndValidateVerification(evidenceRoot, dispatch);
  const token = process.env.GITHUB_TOKEN;
  await assertVerificationRun(dispatch.verification_run_id, dispatch.sha, token);
  const artifact = await assertVerificationArtifact(
    dispatch.verification_run_id,
    dispatch.sha,
    dispatch.version,
    token,
  );
  validatePromotionRegistryState(
    await fetchRegistryReadback(dispatch.version),
    dispatch.version,
    dispatch.sha,
    registry.integrity,
  );
  const gate = buildPromotionGateRecord({
    sha: dispatch.sha,
    version: dispatch.version,
    verification_run_id: dispatch.verification_run_id,
    artifact_id: artifact.id,
    integrity: registry.integrity,
    verification_evidence: evidenceBytes,
  });
  await writeFile(
    path.join(evidenceRoot, PROMOTION_AUTHORIZATION_FILE),
    `${JSON.stringify(gate)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
    },
  );
  await assertExactEvidenceDirectory(evidenceRoot, [
    ...RELEASE_EVIDENCE_FILES,
    "verification.json",
    PROMOTION_AUTHORIZATION_FILE,
  ]);
  return gate;
}

async function runPromoteLatest(dispatch) {
  requireMode(dispatch, "promote-latest");
  validateEnvironmentCredentialBoundary("promote-latest");
  const npmConfiguration = await assertEphemeralNpmConfiguration();
  const authorization = validatePromotionAuthorization({
    verification_run_id: dispatch.verification_run_id,
    environment: process.env.RELEASE_ENVIRONMENT ?? "",
    npm_token_present:
      typeof process.env.NODE_AUTH_TOKEN === "string" && process.env.NODE_AUTH_TOKEN.length > 0,
  });

  const evidenceRoot = releaseEvidenceDirectory(dispatch.sha, dispatch.version);
  await assertExactEvidenceDirectory(evidenceRoot, [
    ...RELEASE_EVIDENCE_FILES,
    "verification.json",
    PROMOTION_AUTHORIZATION_FILE,
  ]);
  const { registry, evidenceBytes } = await readAndValidateVerification(evidenceRoot, dispatch);
  const gate = await readJsonFile(
    path.join(evidenceRoot, PROMOTION_AUTHORIZATION_FILE),
    "promotion authorization",
  );
  validatePromotionGateRecord(gate, {
    sha: dispatch.sha,
    version: dispatch.version,
    verification_run_id: authorization.verification_run_id,
    integrity: registry.integrity,
    verification_evidence: evidenceBytes,
  });
  const before = await fetchRegistryReadback(dispatch.version);
  const { state } = validatePromotionRegistryState(
    before,
    dispatch.version,
    dispatch.sha,
    registry.integrity,
  );
  if (!state.promote) {
    return {
      status: "pass",
      mode: dispatch.mode,
      sha: dispatch.sha,
      version: dispatch.version,
      ...state,
    };
  }
  await executeCommand(
    "npm",
    [
      "dist-tag",
      "add",
      `${PACKAGE_NAME}@${dispatch.version}`,
      "latest",
      `--registry=${OFFICIAL_NPM_REGISTRY}`,
    ],
    {
      env: npmChildEnvironment({
        includeNodeAuthToken: true,
        userconfig: npmConfiguration.userconfig,
      }),
    },
  );
  await waitForPromotedRegistryState({
    readRegistry: () => fetchRegistryReadback(dispatch.version),
    expectedVersion: dispatch.version,
    expectedSha: dispatch.sha,
    expectedIntegrity: registry.integrity,
  });
  return {
    status: "pass",
    mode: dispatch.mode,
    sha: dispatch.sha,
    version: dispatch.version,
    state: "promoted",
    promote: true,
  };
}

async function main() {
  if (process.argv.length !== 3) {
    releaseFailure(
      "usage: node scripts/release-preflight.mjs <validate-dispatch|validate-environment|authorize-publish|prepare-publish|publish-next|verify-next|validate-promotion|promote-latest>",
    );
  }
  const command = process.argv[2];
  const dispatch = environmentDispatch();
  let result;
  if (command === "validate-dispatch") {
    result = { status: "pass", ...dispatch };
  } else if (command === "validate-environment") {
    result = await runValidateEnvironment(dispatch);
  } else if (command === "authorize-publish") {
    result = await runAuthorizePublish(dispatch);
  } else if (command === "prepare-publish") {
    result = await runPreparePublish(dispatch);
  } else if (command === "publish-next") {
    result = await runPublishNext(dispatch);
  } else if (command === "verify-next") {
    result = await runVerifyNext(dispatch);
  } else if (command === "validate-promotion") {
    result = await runValidatePromotion(dispatch);
  } else if (command === "promote-latest") {
    result = await runPromoteLatest(dispatch);
  } else {
    releaseFailure("unknown release-preflight command.");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Release preflight failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
