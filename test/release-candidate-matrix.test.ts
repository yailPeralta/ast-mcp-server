import {
  access,
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error The release runner is intentionally shipped as a standalone ESM script.
const matrixModule = await import("../scripts/release-candidate-matrix.mjs");
const {
  RELEASE_CANDIDATE_COMMAND_IDS,
  TRUSTED_GIT_BINARY,
  assertNoAmbientGitControls,
  assertRuntimeCacheSentinel,
  assertRepositoryState,
  assertFreshCandidateWorkspace,
  createCandidateWorktree,
  createCommandEnvironment,
  createGitEnvironment,
  createPackageManagerEnvironment,
  createRuntimeCommandPlan,
  createRuntimeCacheSentinel,
  createRuntimeEnvironment,
  createRuntimeGateEnvironment,
  executeCommandOnce,
  parseReleaseCandidateMatrixArgs,
  removeCandidateWorktree,
  runBoundedProcess,
  validateRuntimeVersion,
} = matrixModule;

const candidateTree = "a".repeat(40);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matrixScriptPath = path.join(repositoryRoot, "scripts", "release-candidate-matrix.mjs");
const gitAuthorityScriptPath = path.join(repositoryRoot, "scripts", "git-evidence-authority.mjs");
const runtimeReportKeys = [
  "candidate_tree",
  "cleanup_failure_code",
  "cleanup_status",
  "cold_workspace",
  "command_order",
  "commands",
  "failed_phase",
  "git_sha256",
  "git_version",
  "head",
  "head_tree",
  "index_tree",
  "initial_index_tree",
  "node_version",
  "package_manager_environment_key_count",
  "package_manager_node_version",
  "package_version",
  "runtime",
  "runtime_cache_sentinel_unchanged",
  "runtime_failure_code",
  "runtime_home_private",
  "runtime_tmpdir_private",
  "schema_version",
  "status",
  "workspace_commit",
  "workspace_tree",
].sort();
const commandReportKeys = [
  "command_failure_code",
  "duration_ms",
  "exit_code",
  "id",
  "status",
  "stderr_bytes",
  "stderr_sha256",
  "stdout_bytes",
  "stdout_sha256",
  "timed_out",
].sort();
const passSummaryKeys = [
  "candidate_tree",
  "final_index_tree",
  "initial_index_tree",
  "package_manager_environment_key_count",
  "package_manager_node_version",
  "package_version",
  "runtimes",
  "schema_version",
  "status",
].sort();
const failureSummaryKeys = [
  "candidate_tree",
  "cleanup_failure_code",
  "cleanup_status",
  "failed_phase",
  "failed_runtime",
  "initial_index_tree",
  "package_manager_node_version",
  "package_version",
  "runtime_failure_code",
  "runtimes",
  "schema_version",
  "status",
].sort();
const preflightSummaryKeys = [
  "candidate_tree",
  "failed_phase",
  "failure_code",
  "schema_version",
  "status",
].sort();

type MatrixFixture = {
  root: string;
  repository: string;
  scriptPath: string;
  outputDir: string;
  node24StartedFile: string;
  environment: NodeJS.ProcessEnv;
};

function exactKeys(value: object): string[] {
  return Object.keys(value).sort();
}

async function waitForPath(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`fixture path was not created within ${timeoutMs}ms: ${filePath}`);
}

async function runFixtureGit(repository: string, args: string[]): Promise<string> {
  const result = await runBoundedProcess(TRUSTED_GIT_BINARY, args, {
    cwd: repository,
    env: withoutAmbientGitControls(),
    timeoutMs: 5000,
  });
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut) {
    throw new Error(`fixture Git command failed: ${args.join(" ")}`);
  }
  return result.stdoutTail.trim();
}

function fakeNodeSource(
  version: string,
  options: {
    installCountFile?: string;
    node24StartedFile?: string;
    failLint?: boolean;
  } = {},
): string {
  const installControl =
    options.installCountFile === undefined || options.node24StartedFile === undefined
      ? ""
      : [
          'if [ "$2" = "install" ]; then',
          "  install_count=0",
          `  if [ -f '${options.installCountFile}' ]; then install_count=$(/usr/bin/cat '${options.installCountFile}'); fi`,
          "  install_count=$((install_count + 1))",
          `  printf '%s\\n' "$install_count" > '${options.installCountFile}'`,
          '  if [ "$install_count" -eq 2 ]; then',
          `    printf 'started\\n' > '${options.node24StartedFile}'`,
          "    /usr/bin/sleep 0.25",
          "  fi",
          "fi",
        ].join("\n");
  const lintFailure = options.failLint
    ? [
        'if [ "$2" = "lint" ]; then',
        "  printf '%s\\n' 'Bearer TOPSECRET Basic dXNlcjpwYXNz https://secret.invalid/auth?token=TOPSECRET -----BEGIN PRIVATE KEY----- authorization=TOPSECRET' >&2",
        "  exit 23",
        "fi",
      ].join("\n")
    : "";
  return [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then',
    `  printf '${version}\\n'`,
    "  exit 0",
    "fi",
    installControl,
    lintFailure,
    'case "$1" in',
    '  */workflow-policy-check.mjs) printf \'{"status":"pass"}\\n\' ;;',
    "esac",
    "exit 0",
    "",
  ].join("\n");
}

async function createMatrixFixture(
  options: { failNode24Lint?: boolean; packageBytes?: string } = {},
): Promise<MatrixFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-public-boundary-"));
  const repository = path.join(root, "repository");
  const scriptsDirectory = path.join(repository, "scripts");
  const runtimesDirectory = path.join(root, "runtimes");
  const node22Directory = path.join(runtimesDirectory, "node22");
  const node24Directory = path.join(runtimesDirectory, "node24");
  const installCountFile = path.join(root, "install-count");
  const node24StartedFile = path.join(root, "node24-started");
  await Promise.all([
    mkdir(scriptsDirectory, { recursive: true }),
    mkdir(node22Directory, { recursive: true }),
    mkdir(node24Directory, { recursive: true }),
  ]);
  const scriptPath = path.join(scriptsDirectory, "release-candidate-matrix.mjs");
  await Promise.all([
    writeFile(scriptPath, await readFile(matrixScriptPath)),
    writeFile(
      path.join(scriptsDirectory, "git-evidence-authority.mjs"),
      await readFile(gitAuthorityScriptPath),
    ),
    writeFile(path.join(scriptsDirectory, "workflow-policy-check.mjs"), "process.exitCode = 99;\n"),
    writeFile(
      path.join(repository, "package.json"),
      options.packageBytes ?? `${JSON.stringify({ name: "matrix-fixture", version: "0.12.0" })}\n`,
    ),
  ]);

  const node22Binary = path.join(node22Directory, "node");
  const node24Binary = path.join(node24Directory, "node");
  await Promise.all([
    writeFile(node22Binary, fakeNodeSource("v22.13.0"), { mode: 0o700 }),
    writeFile(
      node24Binary,
      fakeNodeSource("v24.16.0", {
        installCountFile,
        node24StartedFile,
        failLint: options.failNode24Lint,
      }),
      { mode: 0o700 },
    ),
    writeFile(path.join(node22Directory, "yarn"), "fixture yarn entry\n", { mode: 0o600 }),
    writeFile(path.join(node24Directory, "yarn"), "fixture yarn entry\n", { mode: 0o600 }),
    writeFile(path.join(node22Directory, "npm"), "fixture npm entry\n", { mode: 0o600 }),
    writeFile(path.join(node24Directory, "npm"), "fixture npm entry\n", { mode: 0o600 }),
  ]);
  await Promise.all([chmod(node22Binary, 0o700), chmod(node24Binary, 0o700)]);

  await runFixtureGit(repository, ["init"]);
  await runFixtureGit(repository, ["config", "user.name", "Matrix Fixture"]);
  await runFixtureGit(repository, ["config", "user.email", "matrix-fixture@invalid.local"]);
  await runFixtureGit(repository, ["add", "."]);
  await runFixtureGit(repository, ["commit", "-m", "test: fixture"]);

  return {
    root,
    repository,
    scriptPath,
    outputDir: path.join(root, "evidence"),
    node24StartedFile,
    environment: withoutAmbientGitControls({
      AST_NODE_22_13_BIN: node22Binary,
      AST_NODE_24_BIN: node24Binary,
    }),
  };
}

async function runMatrixFixture(fixture: MatrixFixture) {
  return runBoundedProcess(
    process.execPath,
    [fixture.scriptPath, "--output-dir", fixture.outputDir],
    {
      cwd: fixture.repository,
      env: fixture.environment,
      timeoutMs: 15_000,
    },
  );
}

function withoutAmbientGitControls(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("GIT_")) delete environment[key];
  }
  return { ...environment, ...overrides };
}

async function readPidWhenReady(pidFile: string, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return Number.parseInt(await readFile(pidFile, "utf8"), 10);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`process readiness file was not readable within ${timeoutMs}ms: ${pidFile}`);
}

describe("release candidate matrix", () => {
  it("keeps terminal report construction outside the module import surface", () => {
    expect(matrixModule).not.toHaveProperty("buildRuntimeTerminalReport");
  });

  it("requires an absolute output directory and accepts an optional exact candidate tree", () => {
    expect(
      parseReleaseCandidateMatrixArgs([
        "--output-dir",
        "/tmp/ast-release-candidate",
        "--candidate-tree",
        candidateTree,
      ]),
    ).toEqual({
      outputDir: "/tmp/ast-release-candidate",
      candidateTree,
    });
    expect(() => parseReleaseCandidateMatrixArgs([])).toThrow(/--output-dir is required/u);
    expect(() => parseReleaseCandidateMatrixArgs(["--output-dir", "relative/reports"])).toThrow(
      /must be absolute/u,
    );
    expect(() =>
      parseReleaseCandidateMatrixArgs(["--output-dir", "/tmp/reports", "--candidate-tree", "ABC"]),
    ).toThrow(/lowercase 40-character/u);
  });

  it("rejects duplicate and unknown CLI controls", () => {
    expect(() =>
      parseReleaseCandidateMatrixArgs(["--output-dir", "/tmp/one", "--output-dir", "/tmp/two"]),
    ).toThrow(/only once/u);
    expect(() =>
      parseReleaseCandidateMatrixArgs(["--output-dir", "/tmp/reports", "--shell"]),
    ).toThrow(/Unknown argument/u);
  });

  it("declares the exact supported Node package floor", async () => {
    const packageMetadata = JSON.parse(
      await readFile(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json"),
        "utf8",
      ),
    );
    expect(packageMetadata.engines).toEqual({ node: ">=22.13.0" });
  });

  it("requires exact Node 22.13.0 while retaining the governed Node 24 line", () => {
    expect(validateRuntimeVersion("node22.13", "v22.13.0\n")).toMatchObject({
      raw: "v22.13.0",
      major: 22,
      minor: 13,
    });
    expect(validateRuntimeVersion("node24", "v24.16.0")).toMatchObject({
      raw: "v24.16.0",
      major: 24,
      minor: 16,
    });
    expect(() => validateRuntimeVersion("node22.13", "v22.12.99")).toThrow(/22\.13\.0/u);
    expect(() => validateRuntimeVersion("node22.13", "v22.13.1")).toThrow(/exact Node 22\.13\.0/u);
    expect(() => validateRuntimeVersion("node22.13", "v22.14.0")).toThrow(/exact Node 22\.13\.0/u);
    expect(() => validateRuntimeVersion("node22.13", "v23.0.0")).toThrow(/major 22/u);
    expect(() => validateRuntimeVersion("node24", "v25.0.0")).toThrow(/major 24/u);
    expect(() => validateRuntimeVersion("node24", "24.16.0")).toThrow(/invalid Node version/u);
  });

  it("builds the closed command order without a shell", () => {
    const runtime = { nodeBinary: "/opt/node-22.13/bin/node" };
    const packageManager = {
      nodeBinary: "/opt/node-24/bin/node",
      yarnEntry: "/opt/node-24/lib/corepack/yarn.js",
    };
    const yarnEntry = "/opt/node-22.13/lib/corepack/yarn.js";
    const localRegistry = {
      output: "/private/local-registry.json",
      expectedNode: "22.13.0",
      npmEntry: "/opt/node-22.13/lib/npm/npm-cli.js",
      transitiveNodeBin: "/private/node/node",
      expectedNodeSha256: "a".repeat(64),
      expectedYarnSha256: "b".repeat(64),
      expectedNpmSha256: "c".repeat(64),
    };
    const plan = createRuntimeCommandPlan(
      runtime,
      yarnEntry,
      packageManager,
      "/tmp/candidate",
      localRegistry,
    );
    expect(plan.map(({ id }: { id: string }) => id)).toEqual(RELEASE_CANDIDATE_COMMAND_IDS);
    expect(plan).toHaveLength(16);
    expect(plan[0]).toEqual({
      id: "install",
      file: packageManager.nodeBinary,
      args: [packageManager.yarnEntry, "install", "--immutable"],
    });
    expect(plan[11]).toEqual({
      id: "local-registry",
      file: runtime.nodeBinary,
      args: [
        yarnEntry,
        "test:local-registry",
        "--output",
        localRegistry.output,
        "--expected-node",
        localRegistry.expectedNode,
        "--yarn-entry",
        yarnEntry,
        "--npm-entry",
        localRegistry.npmEntry,
        "--transitive-node-bin",
        localRegistry.transitiveNodeBin,
        "--expected-node-sha256",
        localRegistry.expectedNodeSha256,
        "--expected-yarn-sha256",
        localRegistry.expectedYarnSha256,
        "--expected-npm-sha256",
        localRegistry.expectedNpmSha256,
      ],
    });
    expect(plan[13]).toEqual({
      id: "pack",
      file: runtime.nodeBinary,
      args: [yarnEntry, "pack", "--dry-run", "--json"],
    });
    expect(plan[14]).toMatchObject({
      id: "workflow-policy",
      file: runtime.nodeBinary,
      args: ["/tmp/candidate/scripts/workflow-policy-check.mjs"],
    });
    expect(plan[15]).toEqual({
      id: "diff-check",
      file: TRUSTED_GIT_BINARY,
      args: ["diff", "--no-ext-diff", "--check", "HEAD^", "HEAD"],
    });
  });

  it("rejects ambient Git controls and constructs a closed Git environment", () => {
    for (const control of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_CONFIG",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_EXEC_PATH",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_INDEX_FILE",
    ]) {
      expect(() => assertNoAmbientGitControls({ [control]: "/tmp/forged" })).toThrow(control);
    }

    expect(createGitEnvironment()).toEqual({
      GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      GIT_CONFIG: "/dev/null",
      GIT_CONFIG_COUNT: "11",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_KEY_1: "core.fsmonitor",
      GIT_CONFIG_KEY_2: "core.untrackedCache",
      GIT_CONFIG_KEY_3: "core.attributesFile",
      GIT_CONFIG_KEY_4: "core.excludesFile",
      GIT_CONFIG_KEY_5: "core.autocrlf",
      GIT_CONFIG_KEY_6: "core.safecrlf",
      GIT_CONFIG_KEY_7: "core.symlinks",
      GIT_CONFIG_KEY_8: "core.filemode",
      GIT_CONFIG_KEY_9: "core.ignorecase",
      GIT_CONFIG_KEY_10: "core.bare",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_VALUE_0: "/dev/null",
      GIT_CONFIG_VALUE_1: "false",
      GIT_CONFIG_VALUE_2: "false",
      GIT_CONFIG_VALUE_3: "/dev/null",
      GIT_CONFIG_VALUE_4: "/dev/null",
      GIT_CONFIG_VALUE_5: "false",
      GIT_CONFIG_VALUE_6: "false",
      GIT_CONFIG_VALUE_7: "true",
      GIT_CONFIG_VALUE_8: "true",
      GIT_CONFIG_VALUE_9: "false",
      GIT_CONFIG_VALUE_10: "false",
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
      HOME: "/nonexistent",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
      PAGER: "cat",
      XDG_CONFIG_HOME: "/nonexistent",
    });
    expect(() => createGitEnvironment({ GIT_DIR: "/tmp/forged" })).toThrow(/GIT_DIR/u);
  });

  it("does not execute a PATH-injected Git binary in the CLI preflight", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-git-path-test-"));
    const fakeBin = path.join(parent, "bin");
    const fakeGit = path.join(fakeBin, "git");
    const sentinel = path.join(parent, "fake-git-executed");
    const outputDir = path.join(parent, "reports");
    try {
      await mkdir(fakeBin);
      await writeFile(fakeGit, `#!/bin/sh\nprintf executed > '${sentinel}'\n`);
      await chmod(fakeGit, 0o700);
      const result = await runBoundedProcess(
        process.execPath,
        [
          path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "../scripts/release-candidate-matrix.mjs",
          ),
          "--output-dir",
          outputDir,
          "--candidate-tree",
          "f".repeat(40),
        ],
        {
          cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
          env: withoutAmbientGitControls({
            AST_NODE_22_13_BIN: process.execPath,
            AST_NODE_24_BIN: process.execPath,
            PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          }),
          timeoutMs: 5000,
        },
      );
      expect(result.exitCode).not.toBe(0);
      await expect(access(sentinel)).rejects.toThrow();
      const summary = JSON.parse(await readFile(path.join(outputDir, "summary.json"), "utf8"));
      expect(exactKeys(summary)).toEqual(preflightSummaryKeys);
      expect(summary).toEqual({
        schema_version: 1,
        status: "fail",
        candidate_tree: "f".repeat(40),
        failed_phase: "preflight",
        failure_code: "preflight-failed",
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects an ambient Git redirect before candidate authentication", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-git-env-test-"));
    const outputDir = path.join(parent, "reports");
    try {
      const result = await runBoundedProcess(
        process.execPath,
        [
          path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "../scripts/release-candidate-matrix.mjs",
          ),
          "--output-dir",
          outputDir,
          "--candidate-tree",
          "f".repeat(40),
        ],
        {
          cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
          env: withoutAmbientGitControls({
            AST_NODE_22_13_BIN: process.execPath,
            AST_NODE_24_BIN: process.execPath,
            GIT_DIR: "/tmp/forged-git-dir",
          }),
          timeoutMs: 5000,
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderrTail).toBe("Release candidate matrix failed.\n");
      const summary = JSON.parse(await readFile(path.join(outputDir, "summary.json"), "utf8"));
      expect(exactKeys(summary)).toEqual(preflightSummaryKeys);
      expect(summary).toEqual({
        schema_version: 1,
        status: "fail",
        candidate_tree: "f".repeat(40),
        failed_phase: "preflight",
        failure_code: "preflight-failed",
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("removes ambient controls and creates no-flag Node 22.13 and Node 24 environments", () => {
    const ambient = {
      PATH: "/usr/bin",
      NODE_OPTIONS: "--inspect",
      GIT_INDEX_FILE: "/tmp/foreign-index",
      HOME: "/tmp/home",
      TMPDIR: "/tmp/runtime",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "1",
      YARN_ENABLE_SCRIPTS: "false",
      NPM_TOKEN: "must-not-leak",
      HTTPS_PROXY: "http://ambient.invalid",
    };
    const node22 = createRuntimeEnvironment("node22.13", "/opt/node22/bin/node", ambient);
    expect(node22).toMatchObject({
      NODE_OPTIONS: "",
      HOME: "/tmp/home",
      TMPDIR: "/tmp/runtime",
    });
    expect(node22.PATH).toBe("/opt/node22/bin:/usr/bin:/bin");
    expect(node22).toHaveProperty("COREPACK_ENABLE_DOWNLOAD_PROMPT", "0");
    expect(node22).not.toHaveProperty("GIT_INDEX_FILE");
    expect(node22).not.toHaveProperty("YARN_ENABLE_SCRIPTS");
    expect(node22).not.toHaveProperty("NPM_TOKEN");
    expect(node22).not.toHaveProperty("HTTPS_PROXY");

    const node24 = createRuntimeEnvironment("node24", "/opt/node24/bin/node", ambient);
    expect(node24).toHaveProperty("NODE_OPTIONS", "");
    expect(node24).not.toHaveProperty("GIT_INDEX_FILE");
    expect(ambient).toHaveProperty("NODE_OPTIONS", "--inspect");
  });

  it("uses a closed private environment only for immutable dependency installation", () => {
    const runtimeEnvironment = {
      PATH: "/opt/node22/bin:/usr/bin",
      NODE_OPTIONS: "",
    };

    const packageManagerEnvironment = {
      PATH: "/opt/node24/bin:/usr/bin",
      NODE_OPTIONS: "--inspect",
      HOME: "/ambient/home",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "1",
      YARN_NPM_AUTH_TOKEN: "must-not-leak",
      COREPACK_HOME: "/ambient/corepack",
      NPM_TOKEN: "must-not-leak",
      HTTPS_PROXY: "http://ambient.invalid",
    };

    const closedPackageManagerEnvironment = createPackageManagerEnvironment(
      packageManagerEnvironment,
      "/private/home",
      "/private/tmp",
    );

    expect(
      createCommandEnvironment(runtimeEnvironment, "install", closedPackageManagerEnvironment),
    ).toEqual({
      CI: "1",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      HOME: "/private/home",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/opt/node24/bin:/usr/bin",
      NODE_OPTIONS: "",
      TMPDIR: "/private/tmp",
    });
    expect(closedPackageManagerEnvironment).not.toHaveProperty("YARN_NPM_AUTH_TOKEN");
    expect(closedPackageManagerEnvironment).not.toHaveProperty("COREPACK_HOME");
    expect(closedPackageManagerEnvironment).not.toHaveProperty("NPM_TOKEN");
    expect(closedPackageManagerEnvironment).not.toHaveProperty("HTTPS_PROXY");
    expect(
      createCommandEnvironment(runtimeEnvironment, "test", closedPackageManagerEnvironment),
    ).toBe(runtimeEnvironment);
    expect(runtimeEnvironment.NODE_OPTIONS).toBe("");
  });

  it("moves runtime gates into the materialization-private home and temporary directory", () => {
    const runtimeEnvironment = createRuntimeEnvironment("node22.13", "/opt/node22/bin/node", {
      HOME: "/ambient/home",
      TMPDIR: "/ambient/tmp",
      NPM_TOKEN: "must-not-leak",
    });
    const privateEnvironment = createRuntimeGateEnvironment(
      runtimeEnvironment,
      "/private/home",
      "/private/tmp",
    );
    expect(privateEnvironment).toEqual({
      CI: "1",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      HOME: "/private/home",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      NODE_OPTIONS: "",
      PATH: "/opt/node22/bin:/usr/bin:/bin",
      TMPDIR: "/private/tmp",
    });
    expect(privateEnvironment).not.toHaveProperty("NPM_TOKEN");
  });

  it("proves full runtime gates leave the ambient symbol-index cache absent", async () => {
    const privateHome = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-cache-sentinel-"));
    try {
      const sentinel = await createRuntimeCacheSentinel(privateHome);
      await expect(assertRuntimeCacheSentinel(privateHome, sentinel)).resolves.toBeUndefined();

      const implicitCacheRoot = path.join(privateHome, ".cache", "ast-mcp-server", "symbol-index");
      await mkdir(implicitCacheRoot, { recursive: true });
      await expect(assertRuntimeCacheSentinel(privateHome, sentinel)).rejects.toThrow(
        /implicit symbol-index cache/u,
      );
      await rm(path.join(privateHome, ".cache"), { recursive: true });

      await rm(sentinel.filePath);
      await writeFile(sentinel.filePath, "replacement sentinel\n", { mode: 0o600 });
      await expect(assertRuntimeCacheSentinel(privateHome, sentinel)).rejects.toThrow(
        /sentinel changed/u,
      );
    } finally {
      await rm(privateHome, { recursive: true, force: true });
    }
  });

  it("requires a physically fresh candidate workspace before installation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-fresh-test-"));
    try {
      await expect(assertFreshCandidateWorkspace(root)).resolves.toBeUndefined();
      for (const relativePath of ["node_modules", path.join(".yarn", "install-state.gz"), "dist"]) {
        const target = path.join(root, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        if (path.extname(target) === ".gz") await writeFile(target, "stale");
        else await mkdir(target);
        await expect(assertFreshCandidateWorkspace(root)).rejects.toThrow(
          relativePath.split(path.sep).at(-1),
        );
        await rm(target, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed on materialization failure and successful cleanup removes its private root", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-materialize-test-"));
    const outputDir = path.join(parent, "reports");
    await mkdir(outputDir);
    try {
      await expect(createCandidateWorktree("f".repeat(40), outputDir)).rejects.toThrow(/git/u);
      expect(await readdir(parent)).toEqual(["reports"]);

      const headTreeResult = await runBoundedProcess("git", ["rev-parse", "HEAD^{tree}"], {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
        timeoutMs: 5000,
      });
      expect(headTreeResult.exitCode).toBe(0);
      const materialization = await createCandidateWorktree(
        headTreeResult.stdoutTail.trim(),
        outputDir,
      );
      await removeCandidateWorktree(materialization);
      await expect(access(materialization.temporaryRoot)).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("emits both failures when materialization and its cleanup fail", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-combined-failure-test-"));
    const outputDir = path.join(parent, "reports");
    const exactTree = "f".repeat(40);
    let workspaceRoot: string | undefined;
    const executor = async (
      file: string,
      args: string[],
      options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
    ) => {
      expect(file).toBe(TRUSTED_GIT_BINARY);
      const identity =
        args[0] === "commit-tree"
          ? {
              GIT_AUTHOR_NAME: "AST release matrix",
              GIT_AUTHOR_EMAIL: "release-matrix@invalid.local",
              GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
              GIT_COMMITTER_NAME: "AST release matrix",
              GIT_COMMITTER_EMAIL: "release-matrix@invalid.local",
              GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
            }
          : {};
      expect(options.env).toEqual({
        ...createGitEnvironment(identity),
        GIT_CONFIG_COUNT: "12",
        GIT_CONFIG_KEY_11: "core.worktree",
        GIT_CONFIG_VALUE_11: options.cwd,
        GIT_WORK_TREE: options.cwd,
      });
      let stdoutTail = "";
      let exitCode = 0;
      if (args[0] === "rev-parse" && args[1] === "HEAD") stdoutTail = "e".repeat(40);
      else if (args[0] === "rev-parse" && args[1] === "HEAD^{tree}") stdoutTail = exactTree;
      else if (args[0] === "commit-tree") stdoutTail = "d".repeat(40);
      else if (args[0] === "worktree" && args[1] === "add") {
        workspaceRoot = args.at(-2);
        if (workspaceRoot === undefined) throw new Error("missing injected workspace");
        await mkdir(path.join(workspaceRoot, "dist"), { recursive: true });
      } else if (args[0] === "worktree" && args[1] === "list") {
        stdoutTail = `worktree ${workspaceRoot}`;
      } else if (args[0] === "worktree" && args[1] === "remove") {
        exitCode = 9;
      } else {
        throw new Error(`unexpected Git invocation: ${args.join(" ")}`);
      }
      return {
        exitCode,
        signal: null,
        timedOut: false,
        stdoutTail,
        stderrTail: exitCode === 0 ? "" : "injected cleanup failure",
      };
    };

    try {
      await mkdir(outputDir);
      let runtimeError: unknown;
      try {
        await createCandidateWorktree(exactTree, outputDir, { executor });
      } catch (error) {
        runtimeError = error;
      }
      expect(runtimeError).toBeInstanceOf(AggregateError);
      const aggregate = runtimeError as AggregateError;
      expect(aggregate.errors).toHaveLength(2);
      expect(aggregate.errors[0]).toBeInstanceOf(Error);
      expect(aggregate.errors[1]).toBeInstanceOf(Error);
      expect((aggregate.errors[0] as Error).message).toMatch(/contains dist/u);
      expect((aggregate.errors[1] as Error).message).toMatch(/cleanup could not remove/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects cleanup failure instead of hiding it", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-cleanup-test-"));
    try {
      await expect(
        removeCandidateWorktree({
          temporaryRoot,
          workspaceRoot: path.join(temporaryRoot, "not-a-worktree"),
        }),
      ).rejects.toThrow(/cleanup failed/u);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects main-index drift in an isolated repository", async () => {
    const repository = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-index-test-"));
    const git = async (...args: string[]) =>
      runBoundedProcess("git", args, { cwd: repository, timeoutMs: 5000 });
    try {
      expect((await git("init")).exitCode).toBe(0);
      expect((await git("config", "user.name", "Matrix Test")).exitCode).toBe(0);
      expect((await git("config", "user.email", "matrix-test@invalid.local")).exitCode).toBe(0);
      await writeFile(path.join(repository, "tracked.txt"), "initial\n");
      expect((await git("add", "tracked.txt")).exitCode).toBe(0);
      expect((await git("commit", "-m", "test: initial")).exitCode).toBe(0);
      const tree = (await git("rev-parse", "HEAD^{tree}")).stdoutTail.trim();
      await expect(assertRepositoryState(tree, repository)).resolves.toBe(tree);
      await writeFile(path.join(repository, "tracked.txt"), "drift\n");
      expect((await git("add", "tracked.txt")).exitCode).toBe(0);
      await expect(assertRepositoryState(tree, repository)).rejects.toThrow(/staged tree changed/u);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it("detects whitespace errors in the candidate delta rather than only the clean worktree", async () => {
    const repository = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-diff-test-"));
    const git = async (...args: string[]) =>
      runBoundedProcess("git", args, { cwd: repository, timeoutMs: 5000 });
    try {
      expect((await git("init")).exitCode).toBe(0);
      expect((await git("config", "user.name", "Matrix Test")).exitCode).toBe(0);
      expect((await git("config", "user.email", "matrix-test@invalid.local")).exitCode).toBe(0);
      await writeFile(path.join(repository, "tracked.txt"), "clean\n");
      expect((await git("add", "tracked.txt")).exitCode).toBe(0);
      expect((await git("commit", "-m", "test: base")).exitCode).toBe(0);
      await writeFile(path.join(repository, "tracked.txt"), "trailing whitespace \n");
      expect((await git("add", "tracked.txt")).exitCode).toBe(0);
      expect((await git("commit", "-m", "test: candidate")).exitCode).toBe(0);

      expect((await git("diff", "--check")).exitCode).toBe(0);
      const candidateDelta = await git("diff", "--check", "HEAD^", "HEAD");
      expect(candidateDelta.exitCode).not.toBe(0);
      expect(candidateDelta.stdoutTail).toContain("trailing whitespace");
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it("executes a failed command exactly once", async () => {
    let attempts = 0;
    const failedResult = { exitCode: 42, signal: null, timedOut: false };
    const result = await executeCommandOnce(
      { file: "/invalid/yarn", args: ["install"] },
      {},
      async () => {
        attempts += 1;
        return failedResult;
      },
    );
    expect(result).toBe(failedResult);
    expect(attempts).toBe(1);
  });

  it("captures bounded command evidence for success and failure", async () => {
    const success = await runBoundedProcess(
      process.execPath,
      ["--input-type=module", "--eval", 'process.stdout.write("ok")'],
      { timeoutMs: 5000 },
    );
    expect(success).toMatchObject({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdoutBytes: 2,
      stdoutTail: "ok",
    });
    expect(success.stdoutSha256).toMatch(/^[0-9a-f]{64}$/u);

    const failure = await runBoundedProcess(
      process.execPath,
      ["--input-type=module", "--eval", 'process.stderr.write("no"); process.exit(7)'],
      { timeoutMs: 5000 },
    );
    expect(failure).toMatchObject({ exitCode: 7, timedOut: false, stderrTail: "no" });
  });

  it("terminates an over-deadline child instead of returning while it runs", async () => {
    const result = await runBoundedProcess(
      process.execPath,
      ["--input-type=module", "--eval", "setInterval(() => {}, 1000)"],
      { timeoutMs: 25 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.signal).toMatch(/^SIG(?:TERM|KILL)$/u);
  });

  it("waits boundedly for delayed process readiness evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-readiness-test-"));
    const pidFile = path.join(root, "grandchild.pid");
    try {
      setTimeout(() => void writeFile(pidFile, "1234"), 25);
      await expect(readPidWhenReady(pidFile, 200)).resolves.toBe(1234);
      await expect(readPidWhenReady(path.join(root, "missing.pid"), 20)).rejects.toThrow(
        "process readiness file was not readable within 20ms",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("terminates the complete process group when a command exceeds its deadline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-process-tree-test-"));
    const pidFile = path.join(root, "grandchild.pid");
    const source = [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'const child = spawn(process.execPath, ["--input-type=module", "--eval", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      "writeFileSync(process.argv[1], String(child.pid));",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    try {
      const result = await runBoundedProcess(
        process.execPath,
        ["--input-type=module", "--eval", source, pidFile],
        { timeoutMs: 100 },
      );
      expect(result.timedOut).toBe(true);
      const grandchildPid = await readPidWhenReady(pidFile, 1000);
      await expect(
        (async () => {
          for (let attempt = 0; attempt < 50; attempt += 1) {
            try {
              const stat = await readFile(`/proc/${grandchildPid}/stat`, "utf8");
              if (stat.split(" ")[2] === "Z") return;
            } catch (error) {
              if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                (error.code === "ENOENT" || error.code === "ESRCH")
              )
                return;
              throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          throw new Error(`grandchild ${grandchildPid} survived the command deadline`);
        })(),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("publishes the complete passing report set atomically with exact schemas and permissions", async () => {
    const fixture = await createMatrixFixture();
    try {
      const result = await runMatrixFixture(fixture);
      expect(result).toMatchObject({ exitCode: 0, signal: null, timedOut: false });
      expect((await lstat(fixture.outputDir)).mode & 0o777).toBe(0o700);
      expect((await readdir(fixture.outputDir)).sort()).toEqual([
        "node22.13.json",
        "node24.json",
        "summary.json",
      ]);

      const summary = JSON.parse(
        await readFile(path.join(fixture.outputDir, "summary.json"), "utf8"),
      );
      expect(exactKeys(summary)).toEqual(passSummaryKeys);
      expect(summary).toMatchObject({
        schema_version: 1,
        status: "pass",
        package_version: "0.12.0",
        package_manager_node_version: "v24.16.0",
      });
      expect(summary.runtimes).toEqual([
        {
          id: "node22.13",
          node_version: "v22.13.0",
          report: "node22.13.json",
          status: "pass",
          command_count: 16,
        },
        {
          id: "node24",
          node_version: "v24.16.0",
          report: "node24.json",
          status: "pass",
          command_count: 16,
        },
      ]);

      for (const runtimeId of ["node22.13", "node24"]) {
        const reportPath = path.join(fixture.outputDir, `${runtimeId}.json`);
        const metadata = await lstat(reportPath);
        expect(metadata.isFile()).toBe(true);
        expect(metadata.nlink).toBe(1);
        expect(metadata.mode & 0o777).toBe(0o600);
        const bytes = await readFile(reportPath, "utf8");
        const report = JSON.parse(bytes);
        expect(exactKeys(report)).toEqual(runtimeReportKeys);
        expect(report).toMatchObject({
          schema_version: 1,
          status: "pass",
          runtime: runtimeId,
          failed_phase: null,
          runtime_failure_code: null,
          cleanup_status: "pass",
          cleanup_failure_code: null,
        });
        expect(report.commands).toHaveLength(16);
        for (const command of report.commands) {
          expect(exactKeys(command)).toEqual(commandReportKeys);
        }
        expect(bytes).not.toContain(fixture.root);
      }
      const summaryMetadata = await lstat(path.join(fixture.outputDir, "summary.json"));
      expect(summaryMetadata.nlink).toBe(1);
      expect(summaryMetadata.mode & 0o777).toBe(0o600);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("keeps a completed runtime undiscoverable until one closed redacted failure set is visible", async () => {
    const fixture = await createMatrixFixture({ failNode24Lint: true });
    let completion: ReturnType<typeof runMatrixFixture> | undefined;
    try {
      completion = runMatrixFixture(fixture);
      await waitForPath(fixture.node24StartedFile, 10_000);
      await expect(access(fixture.outputDir)).rejects.toThrow();

      const result = await completion;
      expect(result.exitCode).not.toBe(0);
      expect((await readdir(fixture.outputDir)).sort()).toEqual([
        "node22.13.json",
        "node24.json",
        "summary.json",
      ]);
      const summary = JSON.parse(
        await readFile(path.join(fixture.outputDir, "summary.json"), "utf8"),
      );
      expect(exactKeys(summary)).toEqual(failureSummaryKeys);
      expect(summary).toMatchObject({
        schema_version: 1,
        status: "fail",
        failed_runtime: "node24",
        failed_phase: "lint",
        runtime_failure_code: "command-failed",
        cleanup_status: "pass",
        cleanup_failure_code: null,
      });
      const passingReport = JSON.parse(
        await readFile(path.join(fixture.outputDir, "node22.13.json"), "utf8"),
      );
      const failedReport = JSON.parse(
        await readFile(path.join(fixture.outputDir, "node24.json"), "utf8"),
      );
      expect(exactKeys(passingReport)).toEqual(runtimeReportKeys);
      expect(exactKeys(failedReport)).toEqual(runtimeReportKeys);
      expect(passingReport).toMatchObject({ status: "pass", cleanup_status: "pass" });
      expect(failedReport).toMatchObject({
        status: "fail",
        failed_phase: "lint",
        runtime_failure_code: "command-failed",
        cleanup_status: "pass",
      });

      const durableBytes = (
        await Promise.all(
          ["node22.13.json", "node24.json", "summary.json"].map((fileName) =>
            readFile(path.join(fixture.outputDir, fileName), "utf8"),
          ),
        )
      ).join("\n");
      for (const forbidden of [
        "TOPSECRET",
        "Bearer",
        "Basic",
        "https://",
        "PRIVATE KEY",
        "authorization",
        fixture.root,
      ]) {
        expect(durableBytes).not.toContain(forbidden);
        expect(result.stderrTail).not.toContain(forbidden);
      }
    } finally {
      if (completion !== undefined) await completion.catch(() => undefined);
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("never replaces an existing destination and removes private staging best-effort", async () => {
    const fixture = await createMatrixFixture();
    const sentinel = path.join(fixture.outputDir, "sentinel.txt");
    try {
      await mkdir(fixture.outputDir, { mode: 0o700 });
      await writeFile(sentinel, "keep\n", { mode: 0o600 });
      const before = await lstat(fixture.outputDir);
      const result = await runMatrixFixture(fixture);
      expect(result.exitCode).not.toBe(0);
      expect(await readFile(sentinel, "utf8")).toBe("keep\n");
      const after = await lstat(fixture.outputDir);
      expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
      expect(await readdir(fixture.outputDir)).toEqual(["sentinel.txt"]);
      expect((await readdir(fixture.root)).some((name) => name.includes(".evidence.stage-"))).toBe(
        false,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("atomically publishes an exact preflight failure summary without free-form error text", async () => {
    const fixture = await createMatrixFixture({
      packageBytes:
        "-----BEGIN PRIVATE KEY----- Bearer TOPSECRET Basic dXNlcjpwYXNz https://secret.invalid authorization=TOPSECRET\n",
    });
    try {
      const result = await runMatrixFixture(fixture);
      expect(result.exitCode).not.toBe(0);
      expect(await readdir(fixture.outputDir)).toEqual(["summary.json"]);
      expect((await lstat(fixture.outputDir)).mode & 0o777).toBe(0o700);
      const summaryPath = path.join(fixture.outputDir, "summary.json");
      const summaryBytes = await readFile(summaryPath, "utf8");
      const summary = JSON.parse(summaryBytes);
      expect(exactKeys(summary)).toEqual(preflightSummaryKeys);
      expect(summary).toEqual({
        schema_version: 1,
        status: "fail",
        candidate_tree: null,
        failed_phase: "preflight",
        failure_code: "preflight-failed",
      });
      expect((await lstat(summaryPath)).mode & 0o777).toBe(0o600);
      for (const forbidden of [
        "error",
        "TOPSECRET",
        "Bearer",
        "Basic",
        "https://",
        "PRIVATE KEY",
        "authorization",
      ]) {
        expect(summaryBytes).not.toContain(forbidden);
        expect(result.stderrTail).not.toContain(forbidden);
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("emits terminal FAIL for preflight errors", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ast-matrix-terminal-test-"));
    const outputDir = path.join(parent, "reports");
    try {
      const result = await runBoundedProcess(
        process.execPath,
        [
          path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "../scripts/release-candidate-matrix.mjs",
          ),
          "--output-dir",
          outputDir,
          "--candidate-tree",
          "f".repeat(40),
        ],
        {
          cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
          env: withoutAmbientGitControls({
            AST_NODE_22_13_BIN: process.execPath,
            AST_NODE_24_BIN: process.execPath,
          }),
          timeoutMs: 5000,
        },
      );
      expect(result.exitCode).not.toBe(0);
      const summary = JSON.parse(await readFile(path.join(outputDir, "summary.json"), "utf8"));
      expect(exactKeys(summary)).toEqual(preflightSummaryKeys);
      expect(summary).toEqual({
        schema_version: 1,
        status: "fail",
        candidate_tree: "f".repeat(40),
        failed_phase: "preflight",
        failure_code: "preflight-failed",
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
