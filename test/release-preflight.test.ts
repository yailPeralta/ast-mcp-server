import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { chmod, link, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPassedRegistryConsumerGates } from "../scripts/registry-consumer-gates.mjs";
import {
  OFFICIAL_NPM_REGISTRY,
  PROMOTION_AUTHORIZATION_FILE,
  RELEASE_EVIDENCE_FILES,
  RELEASE_MODES,
  bindPackedPackageIdentity,
  buildNpmChildEnvironment,
  buildPreparedPackageRecord,
  buildPromotionGateRecord,
  buildPublishAuthorizationRecord,
  buildTrustedPublishArguments,
  buildVerificationEvidence,
  classifyPromotionReadback,
  classifyPublishReadback,
  selectSuccessfulCiRun,
  validateAuditSignaturesReport,
  validateConsumerReport,
  validateEphemeralNpmConfiguration,
  validatePackReport,
  validatePackageManagerEnvironment,
  validatePackedPackageIdentity,
  validatePreparedPackageRecord,
  validatePromotionAuthorization,
  validatePromotionGateRecord,
  validatePromotedRegistryState,
  validatePromotionRegistryState,
  validatePublishAuthorizationRecord,
  validateReleaseCredentialBoundary,
  validateRegistryReadback,
  validateReleaseDispatch,
  validateSetupNodeNpmUserconfig,
  validateTrustedPublishingNpmVersion,
  validateVerificationEvidence,
  waitForPromotedRegistryState,
} from "../scripts/release-preflight.mjs";

const RELEASE_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const RELEASE_VERSION = "0.7.0";
const VERIFICATION_RUN_ID = "123456789";
const INTEGRITY = `sha512-${Buffer.from("verified-integrity").toString("base64")}`;
const EXACT_SETUP_NODE_NPMRC =
  "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\nregistry=https://registry.npmjs.org/";
const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = `/tmp/ast-mcp-release-${RELEASE_SHA}-${RELEASE_VERSION}`;
const evidenceSymlinkTarget = path.join(
  "/tmp",
  `ast-mcp-release-symlink-target-${RELEASE_SHA}-${RELEASE_VERSION}.json`,
);
const evidenceHardlinkTarget = path.join(
  "/tmp",
  `ast-mcp-release-hardlink-target-${RELEASE_SHA}-${RELEASE_VERSION}.json`,
);
const npmConfigRoot = path.join(os.tmpdir(), `ast-mcp-release-npm-config-${RELEASE_SHA}`);
const npmInvocationLog = path.join(npmConfigRoot, "npm-invocation.log");

function registryReadback(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "ast-mcp-server",
    version: RELEASE_VERSION,
    gitHead: RELEASE_SHA,
    engines: { node: ">=22.13.0" },
    dist: {
      integrity: INTEGRITY,
      tarball: `https://registry.npmjs.org/ast-mcp-server/-/ast-mcp-server-${RELEASE_VERSION}.tgz`,
      attestations: {
        url: `https://registry.npmjs.org/-/npm/v1/attestations/ast-mcp-server@${RELEASE_VERSION}`,
        provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      },
    },
    dist_tags: { next: RELEASE_VERSION, latest: "0.6.0" },
    ...overrides,
  };
}

function consumerReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    status: "pass",
    package_name: "ast-mcp-server",
    version: RELEASE_VERSION,
    git_head: RELEASE_SHA,
    registry: OFFICIAL_NPM_REGISTRY,
    gates: createPassedRegistryConsumerGates(),
    ...overrides,
  };
}

function auditReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    status: "pass",
    command: "npm audit signatures",
    registry: OFFICIAL_NPM_REGISTRY,
    exit_code: 0,
    result: {},
    ...overrides,
  };
}

function evidenceMembers(): Record<(typeof RELEASE_EVIDENCE_FILES)[number], Uint8Array> {
  return {
    "registry-metadata.json": Buffer.from(`${JSON.stringify(registryReadback())}\n`),
    "npm-audit-signatures.json": Buffer.from(`${JSON.stringify(auditReport())}\n`),
    "registry-consumer.json": Buffer.from(`${JSON.stringify(consumerReport())}\n`),
  };
}

async function writeEvidenceMembers() {
  const members = evidenceMembers();
  await mkdir(evidenceRoot, { recursive: true });
  await Promise.all(
    Object.entries(members).map(([name, bytes]) => writeFile(path.join(evidenceRoot, name), bytes)),
  );
  return members;
}

async function writePromotionEvidence() {
  const members = await writeEvidenceMembers();
  const evidence = buildVerificationEvidence({
    sha: RELEASE_SHA,
    version: RELEASE_VERSION,
    verification_run_id: VERIFICATION_RUN_ID,
    integrity: INTEGRITY,
    members,
  });
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence)}\n`);
  const gate = buildPromotionGateRecord({
    sha: RELEASE_SHA,
    version: RELEASE_VERSION,
    verification_run_id: VERIFICATION_RUN_ID,
    artifact_id: 24680,
    integrity: INTEGRITY,
    verification_evidence: evidenceBytes,
  });
  await Promise.all([
    writeFile(path.join(evidenceRoot, "verification.json"), evidenceBytes),
    writeFile(path.join(evidenceRoot, PROMOTION_AUTHORIZATION_FILE), `${JSON.stringify(gate)}\n`),
  ]);
}

async function runPromoteLatestWithPostMutationReadbacks(
  postMutationReadbacks: Array<Record<string, unknown>>,
) {
  await writePromotionEvidence();
  const userconfig = path.join(npmConfigRoot, ".npmrc");
  const fakeBin = path.join(npmConfigRoot, "bin");
  const fakeNpm = path.join(fakeBin, "npm");
  const fetchPreload = path.join(npmConfigRoot, "fetch-preload.mjs");
  const before = registryReadback();
  const responses: Array<Record<string, unknown>> = [before, { "dist-tags": before.dist_tags }];
  for (const readback of postMutationReadbacks) {
    responses.push(readback, { "dist-tags": readback.dist_tags });
  }
  await mkdir(fakeBin, { recursive: true });
  await Promise.all([
    writeFile(userconfig, EXACT_SETUP_NODE_NPMRC),
    writeFile(fakeNpm, `#!/bin/sh\nprintf '%s\\n' "$@" > '${npmInvocationLog}'\n`),
    writeFile(
      fetchPreload,
      `const responses = ${JSON.stringify(responses)};\n` +
        `let index = 0;\n` +
        `globalThis.fetch = async () => new Response(JSON.stringify(responses[index++]), { status: 200, headers: { "content-type": "application/json" } });\n` +
        `const realSetTimeout = globalThis.setTimeout;\n` +
        `globalThis.setTimeout = (callback, _delay, ...args) => realSetTimeout(callback, 0, ...args);\n`,
    ),
  ]);
  await chmod(fakeNpm, 0o755);

  return execFileAsync(
    process.execPath,
    ["--import", fetchPreload, "scripts/release-preflight.mjs", "promote-latest"],
    {
      cwd: repositoryRoot,
      env: {
        ...cleanReleaseCliEnvironment(),
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        RELEASE_MODE: "promote-latest",
        RELEASE_SHA,
        RELEASE_VERSION,
        VERIFICATION_RUN_ID,
        GITHUB_SHA: RELEASE_SHA,
        GITHUB_REF: "refs/heads/main",
        RELEASE_ENVIRONMENT: "production",
        NODE_AUTH_TOKEN: "test-token",
        NPM_CONFIG_USERCONFIG: userconfig,
        RUNNER_TEMP: npmConfigRoot,
      },
    },
  );
}

async function runPromoteLatestWithPostIntegrityDrift() {
  return runPromoteLatestWithPostMutationReadbacks([
    registryReadback({
      dist: {
        ...(registryReadback().dist as Record<string, unknown>),
        integrity: `sha512-${Buffer.from("post-mutation-drift").toString("base64")}`,
      },
    }),
  ]);
}

function cleanReleaseCliEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    const normalized = name.toUpperCase();
    if (
      normalized.startsWith("NPM_") ||
      normalized.startsWith("YARN_") ||
      normalized.startsWith("COREPACK_")
    ) {
      delete environment[name];
    }
  }
  for (const name of [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "NODE_AUTH_TOKEN",
    "NPM_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
  ]) {
    delete environment[name];
  }
  return environment;
}

async function runVerifyNextCli() {
  return execFileAsync(process.execPath, ["scripts/release-preflight.mjs", "verify-next"], {
    cwd: repositoryRoot,
    env: {
      ...cleanReleaseCliEnvironment(),
      RELEASE_MODE: "verify-next",
      RELEASE_SHA,
      RELEASE_VERSION,
      VERIFICATION_RUN_ID: "",
      RELEASE_EVIDENCE_ROOT: evidenceRoot,
      GITHUB_SHA: RELEASE_SHA,
      GITHUB_REF: "refs/heads/main",
      GITHUB_RUN_ID: VERIFICATION_RUN_ID,
    },
  });
}

async function runPublishNextCli(userconfig: string, overrides: Record<string, string> = {}) {
  const packageMetadata = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as { version: string };
  const environment = cleanReleaseCliEnvironment();
  Object.assign(environment, {
    RELEASE_MODE: "publish-next",
    RELEASE_SHA,
    RELEASE_VERSION: packageMetadata.version,
    VERIFICATION_RUN_ID: "",
    GITHUB_SHA: RELEASE_SHA,
    GITHUB_REF: "refs/heads/main",
    NPM_CONFIG_USERCONFIG: userconfig,
    RUNNER_TEMP: npmConfigRoot,
    RELEASE_ENVIRONMENT: "npm-publish",
    ...overrides,
  });
  return execFileAsync(process.execPath, ["scripts/release-preflight.mjs", "prepare-publish"], {
    cwd: repositoryRoot,
    env: environment,
  });
}

async function runEnvironmentPreflightCli(
  mode: "publish-next" | "verify-next",
  userconfig: string,
  overrides: Record<string, string> = {},
) {
  const packageMetadata = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as { version: string };
  const environment = cleanReleaseCliEnvironment();
  Object.assign(environment, {
    RELEASE_MODE: mode,
    RELEASE_SHA,
    RELEASE_VERSION: packageMetadata.version,
    VERIFICATION_RUN_ID: "",
    GITHUB_SHA: RELEASE_SHA,
    GITHUB_REF: "refs/heads/main",
    NPM_CONFIG_USERCONFIG: userconfig,
    RUNNER_TEMP: npmConfigRoot,
    ...(mode === "publish-next" ? { RELEASE_ENVIRONMENT: "npm-publish" } : {}),
    ...overrides,
  });
  return execFileAsync(
    process.execPath,
    ["scripts/release-preflight.mjs", "validate-environment"],
    {
      cwd: repositoryRoot,
      env: environment,
    },
  );
}

describe("release preflight", () => {
  beforeEach(async () => {
    await Promise.all([
      rm(evidenceRoot, { recursive: true, force: true }),
      rm(evidenceSymlinkTarget, { force: true }),
      rm(evidenceHardlinkTarget, { force: true }),
      rm(npmConfigRoot, { recursive: true, force: true }),
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      rm(evidenceRoot, { recursive: true, force: true }),
      rm(evidenceSymlinkTarget, { force: true }),
      rm(evidenceHardlinkTarget, { force: true }),
      rm(npmConfigRoot, { recursive: true, force: true }),
    ]);
  });

  it("keeps the release modes and official registry closed", () => {
    expect(RELEASE_MODES).toEqual(["publish-next", "verify-next", "promote-latest"]);
    expect(OFFICIAL_NPM_REGISTRY).toBe("https://registry.npmjs.org");
    expect(RELEASE_EVIDENCE_FILES).toEqual([
      "registry-metadata.json",
      "npm-audit-signatures.json",
      "registry-consumer.json",
    ]);
    expect(PROMOTION_AUTHORIZATION_FILE).toBe("promotion-authorization.json");
  });

  it("requires an npm CLI version that supports trusted publishing", () => {
    expect(validateTrustedPublishingNpmVersion("11.5.1")).toBe("11.5.1");
    expect(validateTrustedPublishingNpmVersion("12.0.0")).toBe("12.0.0");
    expect(() => validateTrustedPublishingNpmVersion("11.5.0")).toThrow(/npm >=11\.5\.1/u);
    expect(() => validateTrustedPublishingNpmVersion("10.9.4")).toThrow(/npm >=11\.5\.1/u);
    expect(() => validateTrustedPublishingNpmVersion("11.5.1-beta.0")).toThrow(
      /stable npm version/u,
    );
  });

  it("accepts only setup-node's exact runner-temporary npm userconfig", () => {
    expect(
      validateEphemeralNpmConfiguration({
        userconfig: "/home/runner/work/_temp/.npmrc",
        runner_temp: "/home/runner/work/_temp",
        repository_root: "/home/runner/work/ast-mcp-server/ast-mcp-server",
      }),
    ).toEqual({
      userconfig: "/home/runner/work/_temp/.npmrc",
      runner_temp: "/home/runner/work/_temp",
    });
    for (const input of [
      {
        userconfig: "/home/runner/.npmrc",
        runner_temp: "/home/runner/work/_temp",
        repository_root: "/home/runner/work/ast-mcp-server/ast-mcp-server",
      },
      {
        userconfig: "/repo/.tmp/.npmrc",
        runner_temp: "/repo/.tmp",
        repository_root: "/repo",
      },
      {
        userconfig: "relative/.npmrc",
        runner_temp: "/tmp/runner",
        repository_root: "/repo",
      },
    ]) {
      expect(() => validateEphemeralNpmConfiguration(input)).toThrow(/ephemeral npm userconfig/u);
    }
  });

  it("closes setup-node npm configuration contents and ambient package-manager aliases", () => {
    expect(validateSetupNodeNpmUserconfig(EXACT_SETUP_NODE_NPMRC)).toBe(true);
    for (const value of [
      EXACT_SETUP_NODE_NPMRC.replace("${NODE_AUTH_TOKEN}", "literal-token"),
      `${EXACT_SETUP_NODE_NPMRC}\n`,
      `${EXACT_SETUP_NODE_NPMRC}\nalways-auth=true`,
      EXACT_SETUP_NODE_NPMRC.replace("registry.npmjs.org/", "registry.example.test/"),
      EXACT_SETUP_NODE_NPMRC.replaceAll("\n", "\r\n"),
    ]) {
      expect(() => validateSetupNodeNpmUserconfig(value)).toThrow(/exact reviewed contents/u);
    }

    expect(
      validatePackageManagerEnvironment({
        NPM_CONFIG_USERCONFIG: "/tmp/.npmrc",
        NODE_AUTH_TOKEN: "step-scoped",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-scoped",
      }),
    ).toBe(true);
    for (const name of [
      "NPM_CONFIG_GLOBALCONFIG",
      "npm_config_registry",
      "NPM_TOKEN",
      "YARN_NPM_AUTH_TOKEN",
      "COREPACK_NPM_TOKEN",
      "COREPACK_HOME",
      "corepack_integrity_keys",
    ]) {
      expect(() => validatePackageManagerEnvironment({ [name]: "unexpected" })).toThrow(
        /package-manager configuration environment/u,
      );
    }
  });

  it("constructs phase-specific npm child environments from an explicit allowlist", () => {
    const sourceEnvironment = {
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      CI: "true",
      RUNNER_TEMP: "/tmp/runner",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-token",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example.test",
      GITHUB_SHA: RELEASE_SHA,
      GITHUB_TOKEN: "github-token",
      GH_TOKEN: "gh-token",
      NPM_TOKEN: "npm-token",
      NODE_AUTH_TOKEN: "promotion-token",
      NPM_CONFIG_REGISTRY: "https://registry.example.test",
      YARN_NPM_AUTH_TOKEN: "yarn-token",
    };
    const userconfig = "/tmp/runner/.npmrc";
    const base = buildNpmChildEnvironment(sourceEnvironment, { userconfig });
    expect(Object.keys(base).sort()).toEqual(
      [
        "CI",
        "HOME",
        "NPM_CONFIG_CACHE",
        "NPM_CONFIG_GLOBALCONFIG",
        "NPM_CONFIG_USERCONFIG",
        "PATH",
      ].sort(),
    );
    expect(base).toMatchObject({
      NPM_CONFIG_USERCONFIG: userconfig,
      NPM_CONFIG_GLOBALCONFIG: "/dev/null",
      NPM_CONFIG_CACHE: "/tmp/runner/npm-cache",
    });

    const publication = buildNpmChildEnvironment(sourceEnvironment, {
      includeOidc: true,
      userconfig,
    });
    expect(publication).toMatchObject({
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-token",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example.test",
      GITHUB_SHA: RELEASE_SHA,
      RUNNER_TEMP: "/tmp/runner",
    });
    expect(publication).not.toHaveProperty("NODE_AUTH_TOKEN");

    const promotion = buildNpmChildEnvironment(sourceEnvironment, {
      includeNodeAuthToken: true,
      userconfig,
    });
    expect(promotion.NODE_AUTH_TOKEN).toBe("promotion-token");
    expect(promotion).not.toHaveProperty("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
    for (const name of ["GITHUB_TOKEN", "GH_TOKEN", "NPM_TOKEN", "YARN_NPM_AUTH_TOKEN"]) {
      expect(base).not.toHaveProperty(name);
      expect(publication).not.toHaveProperty(name);
      expect(promotion).not.toHaveProperty(name);
    }
  });

  it("rejects ambient npm aliases and an unprotected publish phase before network access", async () => {
    const userconfig = path.join(npmConfigRoot, ".npmrc");
    await mkdir(npmConfigRoot, { recursive: true });
    await writeFile(userconfig, EXACT_SETUP_NODE_NPMRC);

    await expect(
      runPublishNextCli(userconfig, { NPM_CONFIG_GLOBALCONFIG: "/tmp/ambient-npmrc" }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/package-manager configuration environment/u),
    });
    await expect(runPublishNextCli(userconfig, { RELEASE_ENVIRONMENT: "" })).rejects.toMatchObject({
      stderr: expect.stringMatching(/protected npm-publish Environment/u),
    });
  });

  it("validates the action-generated package-manager environment before dependency installation", async () => {
    const userconfig = path.join(npmConfigRoot, ".npmrc");
    await mkdir(npmConfigRoot, { recursive: true });
    await writeFile(userconfig, EXACT_SETUP_NODE_NPMRC);

    for (const mode of ["publish-next", "verify-next"] as const) {
      const result = JSON.parse((await runEnvironmentPreflightCli(mode, userconfig)).stdout) as {
        status: string;
        mode: string;
        environment_preflight: boolean;
      };
      expect(result).toEqual({ status: "pass", mode, environment_preflight: true });
    }
    await expect(
      runEnvironmentPreflightCli("verify-next", userconfig, {
        YARN_NPM_AUTH_TOKEN: "unexpected",
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/package-manager configuration environment/u),
    });
    await expect(
      runEnvironmentPreflightCli("verify-next", userconfig, {
        NODE_AUTH_TOKEN: "unexpected",
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/credential boundary/u),
    });

    await writeFile(userconfig, `${EXACT_SETUP_NODE_NPMRC}\n`);
    await expect(runEnvironmentPreflightCli("publish-next", userconfig)).rejects.toMatchObject({
      stderr: expect.stringMatching(/unique physical regular file|exact reviewed contents/u),
    });
  });

  it("rejects missing, symbolic, hard-linked, or non-file npm userconfig before publishing", async () => {
    const userconfig = path.join(npmConfigRoot, ".npmrc");
    const target = path.join(npmConfigRoot, "target.npmrc");
    await mkdir(npmConfigRoot, { recursive: true });
    await expect(runPublishNextCli(userconfig)).rejects.toMatchObject({
      stderr: expect.stringMatching(/unique physical regular file/u),
    });

    await writeFile(target, "registry=https://registry.npmjs.org\n");
    await symlink(target, userconfig);
    await expect(runPublishNextCli(userconfig)).rejects.toMatchObject({
      stderr: expect.stringMatching(/unique physical regular file/u),
    });

    await rm(userconfig);
    await rm(target);
    await writeFile(userconfig, "registry=https://registry.npmjs.org\n");
    await link(userconfig, target);
    await expect(runPublishNextCli(userconfig)).rejects.toMatchObject({
      stderr: expect.stringMatching(/unique physical regular file/u),
    });

    await rm(userconfig);
    await rm(target);
    await mkdir(userconfig);
    await expect(runPublishNextCli(userconfig)).rejects.toMatchObject({
      stderr: expect.stringMatching(/unique physical regular file/u),
    });
  });

  it("validates an exact selected-main dispatch and mode-specific run ID", () => {
    expect(
      validateReleaseDispatch({
        mode: "publish-next",
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        verification_run_id: "",
        selected_sha: RELEASE_SHA,
        selected_ref: "refs/heads/main",
      }),
    ).toEqual({
      mode: "publish-next",
      sha: RELEASE_SHA,
      version: RELEASE_VERSION,
      verification_run_id: null,
      selected_sha: RELEASE_SHA,
      selected_ref: "refs/heads/main",
    });

    expect(
      validateReleaseDispatch({
        mode: "promote-latest",
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        verification_run_id: VERIFICATION_RUN_ID,
        selected_sha: RELEASE_SHA,
        selected_ref: "refs/heads/main",
      }).verification_run_id,
    ).toBe(VERIFICATION_RUN_ID);
  });

  it.each([
    ["malformed SHA", { sha: "A".repeat(40) }, /lowercase 40-character SHA/u],
    ["short SHA", { sha: "a".repeat(39) }, /lowercase 40-character SHA/u],
    ["invalid version", { version: "v0.7.0" }, /stable semantic version/u],
    ["invalid mode", { mode: "publish" }, /release mode/u],
    ["wrong selected SHA", { selected_sha: OTHER_SHA }, /selected branch head/u],
    ["wrong selected ref", { selected_ref: "refs/heads/release" }, /refs\/heads\/main/u],
    ["unexpected run ID", { verification_run_id: "42" }, /must be empty/u],
  ])("rejects %s", (_label, overrides, error) => {
    expect(() =>
      validateReleaseDispatch({
        mode: "publish-next",
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        verification_run_id: "",
        selected_sha: RELEASE_SHA,
        selected_ref: "refs/heads/main",
        ...overrides,
      }),
    ).toThrow(error);
  });

  it.each(["", "0", "01", "-1", "1.5", "abc"])(
    "rejects invalid promote verification run ID %j",
    (verificationRunId) => {
      expect(() =>
        validateReleaseDispatch({
          mode: "promote-latest",
          sha: RELEASE_SHA,
          version: RELEASE_VERSION,
          verification_run_id: verificationRunId,
          selected_sha: RELEASE_SHA,
          selected_ref: "refs/heads/main",
        }),
      ).toThrow(/positive decimal verification run ID/u);
    },
  );

  it("selects only a successful main push CI run on the exact SHA", () => {
    const selected = selectSuccessfulCiRun(
      [
        {
          id: 77,
          path: ".github/workflows/ci.yml",
          event: "push",
          head_branch: "main",
          head_sha: RELEASE_SHA,
          status: "completed",
          conclusion: "success",
        },
      ],
      RELEASE_SHA,
    );
    expect(selected.id).toBe(77);

    for (const overrides of [
      { head_sha: OTHER_SHA },
      { conclusion: "failure" },
      { status: "in_progress" },
      { path: ".github/workflows/security.yml" },
      { event: "pull_request" },
      { head_branch: "release" },
    ]) {
      expect(() =>
        selectSuccessfulCiRun(
          [
            {
              id: 77,
              path: ".github/workflows/ci.yml",
              event: "push",
              head_branch: "main",
              head_sha: RELEASE_SHA,
              status: "completed",
              conclusion: "success",
              ...overrides,
            },
          ],
          RELEASE_SHA,
        ),
      ).toThrow(/successful ci\.yml run/u);
    }
  });

  it("requires package version equality and a closed inspected pack", () => {
    const pack = [
      {
        name: "ast-mcp-server",
        version: RELEASE_VERSION,
        files: [
          { path: "package.json", size: 100 },
          { path: "README.md", size: 100 },
          { path: "CHANGELOG.md", size: 100 },
          { path: "SECURITY.md", size: 100 },
          { path: "docs/support.md", size: 100 },
          { path: "dist/index.js", size: 100 },
          { path: "dist/cli.js", size: 100 },
          { path: "skills/structural-code-editing/SKILL.md", size: 100 },
          { path: "skills/structural-code-editing/guidance.md", size: 100 },
          { path: "skills/structural-code-editing/releases.json", size: 100 },
        ],
      },
    ];
    expect(validatePackReport(pack, RELEASE_VERSION)).toEqual({
      package_name: "ast-mcp-server",
      version: RELEASE_VERSION,
      file_count: 10,
    });
    expect(() => validatePackReport(pack, "0.7.1")).toThrow(/package version/u);
    expect(() =>
      validatePackReport(
        [{ ...pack[0], files: [...pack[0].files, { path: ".env", size: 1 }] }],
        RELEASE_VERSION,
      ),
    ).toThrow(/forbidden package artifact/u);
    expect(() =>
      validatePackReport(
        [
          {
            ...pack[0],
            files: pack[0].files.filter(({ path }) => path !== "dist/index.js"),
          },
        ],
        RELEASE_VERSION,
      ),
    ).toThrow(/required package artifact/u);
    for (const requiredPolicy of [
      "SECURITY.md",
      "docs/support.md",
      "skills/structural-code-editing/guidance.md",
      "skills/structural-code-editing/releases.json",
    ]) {
      expect(() =>
        validatePackReport(
          [
            {
              ...pack[0],
              files: pack[0].files.filter(({ path }) => path !== requiredPolicy),
            },
          ],
          RELEASE_VERSION,
        ),
      ).toThrow(
        new RegExp(
          `required package artifact ${requiredPolicy.replace(".", "\\.")} is missing`,
          "u",
        ),
      );
    }
  });

  it("binds the physical package manifest to the exact release SHA", () => {
    const source = {
      name: "ast-mcp-server",
      version: RELEASE_VERSION,
      files: ["dist", "README.md"],
    };
    const bound = bindPackedPackageIdentity(source, RELEASE_SHA, RELEASE_VERSION);
    expect(bound).toEqual({ ...source, gitHead: RELEASE_SHA });
    expect(validatePackedPackageIdentity(bound, RELEASE_SHA, RELEASE_VERSION)).toEqual(bound);
    expect(() => bindPackedPackageIdentity(source, RELEASE_SHA, "0.7.1")).toThrow(
      /expected package and version/u,
    );
    expect(() =>
      bindPackedPackageIdentity({ ...source, gitHead: OTHER_SHA }, RELEASE_SHA, RELEASE_VERSION),
    ).toThrow(/conflicting gitHead/u);
    expect(() =>
      validatePackedPackageIdentity({ ...bound, gitHead: OTHER_SHA }, RELEASE_SHA, RELEASE_VERSION),
    ).toThrow(/exact release identity/u);
  });

  it("binds publication authorization to an exact CI run and prepared tarball bytes", () => {
    const authorization = buildPublishAuthorizationRecord({
      sha: RELEASE_SHA,
      version: RELEASE_VERSION,
      ci_run_id: 42,
    });
    expect(
      validatePublishAuthorizationRecord(authorization, {
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
      }),
    ).toEqual(authorization);
    expect(() =>
      validatePublishAuthorizationRecord(
        { ...authorization, sha: OTHER_SHA },
        { sha: RELEASE_SHA, version: RELEASE_VERSION },
      ),
    ).toThrow(/publish authorization/u);

    const authorizationBytes = Buffer.from(`${JSON.stringify(authorization)}\n`);
    const tarball = Buffer.from("exact prepared package bytes");
    const prepared = buildPreparedPackageRecord({
      sha: RELEASE_SHA,
      version: RELEASE_VERSION,
      ci_run_id: authorization.ci_run_id,
      npm_version: "11.13.0",
      pack_file_count: 64,
      authorization: authorizationBytes,
      tarball,
    });
    expect(
      validatePreparedPackageRecord(prepared, {
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        authorization: authorizationBytes,
        tarball,
      }),
    ).toEqual(prepared);
    expect(() =>
      validatePreparedPackageRecord(prepared, {
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        authorization: authorizationBytes,
        tarball: Buffer.from("tampered package bytes"),
      }),
    ).toThrow(/exact tarball/u);
    expect(() =>
      validatePreparedPackageRecord(prepared, {
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        authorization: Buffer.from("{}\n"),
        tarball,
      }),
    ).toThrow(/exact tarball/u);
    expect(buildTrustedPublishArguments("/tmp/ast-mcp-server-0.7.0.tgz")).toEqual([
      "publish",
      "/tmp/ast-mcp-server-0.7.0.tgz",
      "--ignore-scripts",
      "--tag",
      "next",
      "--access",
      "public",
      "--provenance",
      "--registry=https://registry.npmjs.org",
    ]);
  });

  it("classifies exact-version publication readback without authorizing an in-run retry", () => {
    expect(classifyPublishReadback(null, RELEASE_SHA, "preflight")).toEqual({
      state: "eligible_to_publish",
      publish: true,
    });
    expect(classifyPublishReadback(registryReadback(), RELEASE_SHA, "preflight")).toEqual({
      state: "already_published_needs_verification",
      publish: false,
    });
    expect(classifyPublishReadback(null, RELEASE_SHA, "ambiguous")).toEqual({
      state: "absent_requires_new_dispatch",
      publish: false,
    });
    expect(() =>
      classifyPublishReadback(registryReadback({ gitHead: OTHER_SHA }), RELEASE_SHA, "ambiguous"),
    ).toThrow(/security failure.*gitHead/u);
  });

  it("validates exact next metadata, integrity, tarball and SLSA provenance", () => {
    expect(validateRegistryReadback(registryReadback(), RELEASE_VERSION, RELEASE_SHA)).toEqual({
      package_name: "ast-mcp-server",
      version: RELEASE_VERSION,
      git_head: RELEASE_SHA,
      engines_node: ">=22.13.0",
      integrity: INTEGRITY,
      tarball: `https://registry.npmjs.org/ast-mcp-server/-/ast-mcp-server-${RELEASE_VERSION}.tgz`,
      attestation_url: `https://registry.npmjs.org/-/npm/v1/attestations/ast-mcp-server@${RELEASE_VERSION}`,
      predicate_type: "https://slsa.dev/provenance/v1",
      next: RELEASE_VERSION,
      latest: "0.6.0",
    });

    const invalidReadbacks = [
      registryReadback({ version: "0.7.1" }),
      registryReadback({ gitHead: OTHER_SHA }),
      registryReadback({ engines: { node: ">=22.5.0" } }),
      registryReadback({ engines: { node: ">=24" } }),
      registryReadback({ dist_tags: { next: "0.6.0", latest: "0.6.0" } }),
      registryReadback({ dist: { ...(registryReadback().dist as object), integrity: "" } }),
      registryReadback({
        dist: {
          ...(registryReadback().dist as object),
          tarball: `https://evil.example/ast-mcp-server-${RELEASE_VERSION}.tgz`,
        },
      }),
      registryReadback({
        dist: {
          ...(registryReadback().dist as object),
          attestations: {
            url: `https://evil.example/attestations/ast-mcp-server@${RELEASE_VERSION}`,
            provenance: { predicateType: "https://slsa.dev/provenance/v1" },
          },
        },
      }),
      registryReadback({
        dist: {
          ...(registryReadback().dist as object),
          attestations: {
            url: `https://registry.npmjs.org/-/npm/v1/attestations/ast-mcp-server@${RELEASE_VERSION}`,
            provenance: { predicateType: "https://slsa.dev/provenance/v0.2" },
          },
        },
      }),
    ];
    for (const readback of invalidReadbacks) {
      expect(() => validateRegistryReadback(readback, RELEASE_VERSION, RELEASE_SHA)).toThrow();
    }
  });

  it("validates the shared registry-consumer contract and every signature gate", () => {
    expect(validateConsumerReport(consumerReport(), RELEASE_VERSION, RELEASE_SHA).status).toBe(
      "pass",
    );
    expect(validateAuditSignaturesReport(auditReport(), OFFICIAL_NPM_REGISTRY).status).toBe("pass");

    expect(() =>
      validateConsumerReport(
        {
          ...consumerReport(),
          gates: {
            ...(consumerReport().gates as object),
            stale_conflict_fail_closed: false,
          },
        },
        RELEASE_VERSION,
        RELEASE_SHA,
      ),
    ).toThrow(/consumer gate/u);
    for (const gates of [
      { ...createPassedRegistryConsumerGates(), unexpected_gate: true },
      Object.fromEntries(
        Object.entries(createPassedRegistryConsumerGates()).filter(
          ([gate]) => gate !== "setup_idempotency",
        ),
      ),
    ]) {
      expect(() =>
        validateConsumerReport({ ...consumerReport(), gates }, RELEASE_VERSION, RELEASE_SHA),
      ).toThrow(/reviewed keys/u);
    }
    expect(() =>
      validateAuditSignaturesReport({ ...auditReport(), exit_code: 1 }, OFFICIAL_NPM_REGISTRY),
    ).toThrow(/audit signatures/u);
  });

  it("builds and validates SHA/version/run-bound evidence with exact member hashes", () => {
    const members = evidenceMembers();
    const evidence = buildVerificationEvidence({
      sha: RELEASE_SHA,
      version: RELEASE_VERSION,
      verification_run_id: VERIFICATION_RUN_ID,
      integrity: INTEGRITY,
      members,
    });
    expect(evidence.member_sizes).toEqual(
      Object.fromEntries(Object.entries(members).map(([name, bytes]) => [name, bytes.byteLength])),
    );
    expect(
      validateVerificationEvidence(evidence, {
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        verification_run_id: VERIFICATION_RUN_ID,
        integrity: INTEGRITY,
        members,
      }),
    ).toEqual(evidence);

    expect(() =>
      validateVerificationEvidence(
        {
          ...evidence,
          member_hashes: {
            ...evidence.member_hashes,
            "registry-consumer.json": "0".repeat(64),
          },
        },
        {
          sha: RELEASE_SHA,
          version: RELEASE_VERSION,
          verification_run_id: VERIFICATION_RUN_ID,
          integrity: INTEGRITY,
          members,
        },
      ),
    ).toThrow(/member hash/u);
    expect(() =>
      validateVerificationEvidence(evidence, {
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        verification_run_id: "987654321",
        integrity: INTEGRITY,
        members,
      }),
    ).toThrow(/verification run/u);
  });

  it("writes verification evidence only from the exact three physical members", async () => {
    await writeEvidenceMembers();
    const { stdout, stderr } = await runVerifyNextCli();
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      status: "pass",
      mode: "verify-next",
      sha: RELEASE_SHA,
      version: RELEASE_VERSION,
      verification_run_id: VERIFICATION_RUN_ID,
    });
    await expect(readFile(path.join(evidenceRoot, "verification.json"), "utf8")).resolves.toContain(
      `"verification_run_id":"${VERIFICATION_RUN_ID}"`,
    );
  });

  it("rejects symlinked, hard-linked, or extra verification evidence members", async () => {
    const members = await writeEvidenceMembers();
    await rm(path.join(evidenceRoot, "registry-metadata.json"));
    await writeFile(evidenceSymlinkTarget, members["registry-metadata.json"]);
    await symlink(evidenceSymlinkTarget, path.join(evidenceRoot, "registry-metadata.json"));
    await expect(runVerifyNextCli()).rejects.toMatchObject({
      stderr: expect.stringMatching(/unique physical regular file/u),
    });

    await rm(evidenceRoot, { recursive: true, force: true });
    await writeEvidenceMembers();
    await link(path.join(evidenceRoot, "registry-metadata.json"), evidenceHardlinkTarget);
    await expect(runVerifyNextCli()).rejects.toMatchObject({
      stderr: expect.stringMatching(/unique physical regular file/u),
    });

    await rm(evidenceRoot, { recursive: true, force: true });
    await rm(evidenceHardlinkTarget, { force: true });
    await writeEvidenceMembers();
    await writeFile(path.join(evidenceRoot, "unexpected.json"), "{}\n");
    await expect(runVerifyNextCli()).rejects.toMatchObject({
      stderr: expect.stringMatching(/exactly the reviewed files/u),
    });
  });

  it("binds promotion authorization to the exact evidence and artifact identity", () => {
    const members = evidenceMembers();
    const evidence = buildVerificationEvidence({
      sha: RELEASE_SHA,
      version: RELEASE_VERSION,
      verification_run_id: VERIFICATION_RUN_ID,
      integrity: INTEGRITY,
      members,
    });
    const evidenceBytes = Buffer.from(`${JSON.stringify(evidence)}\n`);
    const gate = buildPromotionGateRecord({
      sha: RELEASE_SHA,
      version: RELEASE_VERSION,
      verification_run_id: VERIFICATION_RUN_ID,
      artifact_id: 24680,
      integrity: INTEGRITY,
      verification_evidence: evidenceBytes,
    });

    expect(
      validatePromotionGateRecord(gate, {
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        verification_run_id: VERIFICATION_RUN_ID,
        integrity: INTEGRITY,
        verification_evidence: evidenceBytes,
      }),
    ).toEqual(gate);
    const reorderedGate = Object.fromEntries(Object.entries(gate).reverse());
    expect(
      validatePromotionGateRecord(reorderedGate, {
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        verification_run_id: VERIFICATION_RUN_ID,
        integrity: INTEGRITY,
        verification_evidence: evidenceBytes,
      }),
    ).toEqual(reorderedGate);
    expect(() =>
      validatePromotionGateRecord(gate, {
        sha: RELEASE_SHA,
        version: RELEASE_VERSION,
        verification_run_id: VERIFICATION_RUN_ID,
        integrity: INTEGRITY,
        verification_evidence: Buffer.from("{}\n"),
      }),
    ).toThrow(/promotion authorization/u);
  });

  it("enforces one exact runtime credential boundary per release phase", () => {
    const validBoundaries = [
      ["validate-environment", false, false, false, false, false, false],
      ["authorize-publish", true, false, false, false, false, false],
      ["prepare-publish", false, false, false, false, false, false],
      ["publish-next", false, false, false, false, true, true],
      ["verify-next", false, false, false, false, false, false],
      ["validate-promotion", true, false, false, false, false, false],
      ["promote-latest", false, false, true, false, false, false],
    ] as const;
    for (const [
      phase,
      githubTokenPresent,
      ghTokenPresent,
      nodeAuthTokenPresent,
      npmTokenPresent,
      oidcTokenPresent,
      oidcUrlPresent,
    ] of validBoundaries) {
      const credentials = {
        github_token_present: githubTokenPresent,
        gh_token_present: ghTokenPresent,
        node_auth_token_present: nodeAuthTokenPresent,
        npm_token_present: npmTokenPresent,
        oidc_token_present: oidcTokenPresent,
        oidc_url_present: oidcUrlPresent,
      };
      expect(validateReleaseCredentialBoundary(phase, credentials)).toEqual({
        phase,
        ...credentials,
      });
      for (const key of Object.keys(credentials) as Array<keyof typeof credentials>) {
        expect(() =>
          validateReleaseCredentialBoundary(phase, {
            ...credentials,
            [key]: !credentials[key],
          }),
        ).toThrow(/credential boundary/u);
      }
    }
  });

  it("requires production-bound promotion authorization and exact next/latest state", () => {
    expect(
      validatePromotionAuthorization({
        verification_run_id: VERIFICATION_RUN_ID,
        environment: "production",
        npm_token_present: true,
      }),
    ).toEqual({ verification_run_id: VERIFICATION_RUN_ID, environment: "production" });
    expect(() =>
      validatePromotionAuthorization({
        verification_run_id: VERIFICATION_RUN_ID,
        environment: "staging",
        npm_token_present: true,
      }),
    ).toThrow(/production Environment/u);
    expect(() =>
      validatePromotionAuthorization({
        verification_run_id: VERIFICATION_RUN_ID,
        environment: "production",
        npm_token_present: false,
      }),
    ).toThrow(/promotion credential/u);

    expect(classifyPromotionReadback(registryReadback(), RELEASE_VERSION, RELEASE_SHA)).toEqual({
      state: "eligible_to_promote",
      promote: true,
    });
    expect(
      classifyPromotionReadback(
        registryReadback({ dist_tags: { next: RELEASE_VERSION, latest: RELEASE_VERSION } }),
        RELEASE_VERSION,
        RELEASE_SHA,
      ),
    ).toEqual({ state: "already_promoted", promote: false });
    expect(() =>
      classifyPromotionReadback(
        registryReadback({ dist_tags: { next: "0.6.0", latest: "0.6.0" } }),
        RELEASE_VERSION,
        RELEASE_SHA,
      ),
    ).toThrow(/next dist-tag/u);
  });

  it("validates and classifies raw promotion registry state exactly once", () => {
    const eligible = validatePromotionRegistryState(
      registryReadback(),
      RELEASE_VERSION,
      RELEASE_SHA,
      INTEGRITY,
    );
    expect(eligible.registry).toEqual(
      validateRegistryReadback(registryReadback(), RELEASE_VERSION, RELEASE_SHA),
    );
    expect(eligible.state).toEqual({ state: "eligible_to_promote", promote: true });

    for (const invalidIdentity of [
      registryReadback({ name: "other-package" }),
      registryReadback({ version: "0.7.1" }),
      registryReadback({ gitHead: OTHER_SHA }),
    ]) {
      expect(() =>
        validatePromotionRegistryState(invalidIdentity, RELEASE_VERSION, RELEASE_SHA, INTEGRITY),
      ).toThrow(/package name or exact version|gitHead/u);
    }

    expect(
      validatePromotionRegistryState(
        registryReadback({ dist_tags: { next: RELEASE_VERSION, latest: RELEASE_VERSION } }),
        RELEASE_VERSION,
        RELEASE_SHA,
        INTEGRITY,
      ).state,
    ).toEqual({ state: "already_promoted", promote: false });

    expect(() =>
      validatePromotionRegistryState(
        registryReadback(),
        RELEASE_VERSION,
        RELEASE_SHA,
        `sha512-${Buffer.from("different-integrity").toString("base64")}`,
      ),
    ).toThrow(/live registry integrity/u);
  });

  it("revalidates integrity and exact latest state after promotion", () => {
    expect(
      validatePromotedRegistryState(
        registryReadback({ dist_tags: { next: RELEASE_VERSION, latest: RELEASE_VERSION } }),
        RELEASE_VERSION,
        RELEASE_SHA,
        INTEGRITY,
      ),
    ).toEqual(
      validateRegistryReadback(
        registryReadback({ dist_tags: { next: RELEASE_VERSION, latest: RELEASE_VERSION } }),
        RELEASE_VERSION,
        RELEASE_SHA,
      ),
    );

    expect(() =>
      validatePromotedRegistryState(
        registryReadback({ dist_tags: { next: RELEASE_VERSION, latest: RELEASE_VERSION } }),
        RELEASE_VERSION,
        RELEASE_SHA,
        `sha512-${Buffer.from("different-integrity").toString("base64")}`,
      ),
    ).toThrow(/live registry integrity/u);

    expect(() =>
      validatePromotedRegistryState(registryReadback(), RELEASE_VERSION, RELEASE_SHA, INTEGRITY),
    ).toThrow(/latest dist-tag/u);
  });

  it("retries bounded stale latest readbacks while revalidating the full registry identity", async () => {
    const readbacks = [
      registryReadback(),
      registryReadback(),
      registryReadback({ dist_tags: { next: RELEASE_VERSION, latest: RELEASE_VERSION } }),
    ];
    const delays: number[] = [];
    let reads = 0;

    await expect(
      waitForPromotedRegistryState({
        readRegistry: async () => readbacks[reads++],
        expectedVersion: RELEASE_VERSION,
        expectedSha: RELEASE_SHA,
        expectedIntegrity: INTEGRITY,
        maxAttempts: 3,
        delayMs: 17,
        sleep: async (milliseconds: number) => {
          delays.push(milliseconds);
        },
      }),
    ).resolves.toEqual(validateRegistryReadback(readbacks[2], RELEASE_VERSION, RELEASE_SHA));
    expect(reads).toBe(3);
    expect(delays).toEqual([17, 17]);
  });

  it("fails closed after the bounded promotion readback budget is exhausted", async () => {
    let reads = 0;
    let delays = 0;

    await expect(
      waitForPromotedRegistryState({
        readRegistry: async () => {
          reads += 1;
          return registryReadback();
        },
        expectedVersion: RELEASE_VERSION,
        expectedSha: RELEASE_SHA,
        expectedIntegrity: INTEGRITY,
        maxAttempts: 3,
        delayMs: 0,
        sleep: async () => {
          delays += 1;
        },
      }),
    ).rejects.toThrow(/after 3 bounded promotion checks/u);
    expect(reads).toBe(3);
    expect(delays).toBe(2);
  });

  it("closes the composed promotion after a stale post-mutation dist-tag readback", async () => {
    const result = await runPromoteLatestWithPostMutationReadbacks([
      registryReadback(),
      registryReadback({ dist_tags: { next: RELEASE_VERSION, latest: RELEASE_VERSION } }),
    ]);

    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "pass",
      mode: "promote-latest",
      sha: RELEASE_SHA,
      version: RELEASE_VERSION,
      state: "promoted",
      promote: true,
    });
    await expect(readFile(npmInvocationLog, "utf8")).resolves.toBe(
      `dist-tag\nadd\nast-mcp-server@${RELEASE_VERSION}\nlatest\n--registry=${OFFICIAL_NPM_REGISTRY}\n`,
    );
  });

  it("fails the composed promotion after mutation when registry integrity drifts", async () => {
    await expect(runPromoteLatestWithPostIntegrityDrift()).rejects.toMatchObject({
      stderr: expect.stringMatching(/live registry integrity/u),
    });
    await expect(readFile(npmInvocationLog, "utf8")).resolves.toBe(
      `dist-tag\nadd\nast-mcp-server@${RELEASE_VERSION}\nlatest\n--registry=${OFFICIAL_NPM_REGISTRY}\n`,
    );
  });
});
