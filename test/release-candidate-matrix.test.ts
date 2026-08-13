import { access, chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  assertRepositoryState,
  assertFreshCandidateWorkspace,
  buildRuntimeTerminalReport,
  createCandidateWorktree,
  createCommandEnvironment,
  createGitEnvironment,
  createPackageManagerEnvironment,
  createRuntimeCommandPlan,
  createRuntimeEnvironment,
  createRuntimeGateEnvironment,
  executeCommandOnce,
  parseReleaseCandidateMatrixArgs,
  removeCandidateWorktree,
  runBoundedProcess,
  validateRuntimeVersion,
} = matrixModule;

const candidateTree = "a".repeat(40);

function withoutGitIndexFile(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  delete environment.GIT_INDEX_FILE;
  return environment;
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

  it("accepts only the exact Node majors at their minimum versions", () => {
    expect(validateRuntimeVersion("node22.5", "v22.5.0\n")).toMatchObject({
      raw: "v22.5.0",
      major: 22,
      minor: 5,
    });
    expect(validateRuntimeVersion("node24", "v24.16.0")).toMatchObject({
      raw: "v24.16.0",
      major: 24,
      minor: 16,
    });
    expect(() => validateRuntimeVersion("node22.5", "v22.4.1")).toThrow(/22\.5\.0/u);
    expect(() => validateRuntimeVersion("node22.5", "v23.0.0")).toThrow(/major 22/u);
    expect(() => validateRuntimeVersion("node24", "v25.0.0")).toThrow(/major 24/u);
    expect(() => validateRuntimeVersion("node24", "24.16.0")).toThrow(/invalid Node version/u);
  });

  it("builds the closed command order without a shell", () => {
    const runtime = { nodeBinary: "/opt/node-22.5/bin/node" };
    const packageManager = {
      nodeBinary: "/opt/node-24/bin/node",
      yarnEntry: "/opt/node-24/lib/corepack/yarn.js",
    };
    const yarnEntry = "/opt/node-22.5/lib/corepack/yarn.js";
    const plan = createRuntimeCommandPlan(runtime, yarnEntry, packageManager, "/tmp/candidate");
    expect(plan.map(({ id }: { id: string }) => id)).toEqual(RELEASE_CANDIDATE_COMMAND_IDS);
    expect(plan).toHaveLength(15);
    expect(plan[0]).toEqual({
      id: "install",
      file: packageManager.nodeBinary,
      args: [packageManager.yarnEntry, "install", "--immutable"],
    });
    expect(plan[12]).toEqual({
      id: "pack",
      file: runtime.nodeBinary,
      args: [yarnEntry, "pack", "--dry-run", "--json"],
    });
    expect(plan[13]).toMatchObject({
      id: "workflow-policy",
      file: runtime.nodeBinary,
      args: ["/tmp/candidate/scripts/workflow-policy-check.mjs"],
    });
    expect(plan[14]).toEqual({
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
          env: withoutGitIndexFile({
            AST_NODE_22_BIN: process.execPath,
            AST_NODE_24_BIN: process.execPath,
            PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          }),
          timeoutMs: 5000,
        },
      );
      expect(result.exitCode).not.toBe(0);
      await expect(access(sentinel)).rejects.toThrow();
      const summary = JSON.parse(await readFile(path.join(outputDir, "summary.json"), "utf8"));
      expect(summary).toMatchObject({
        status: "fail",
        candidate_tree: "f".repeat(40),
        failed_phase: "preflight",
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
          env: withoutGitIndexFile({
            AST_NODE_22_BIN: process.execPath,
            AST_NODE_24_BIN: process.execPath,
            GIT_DIR: "/tmp/forged-git-dir",
          }),
          timeoutMs: 5000,
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderrTail).toContain("GIT_DIR");
      await expect(access(outputDir)).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("sets the Node 22 SQLite flag exactly and removes ambient controls from Node 24", () => {
    const ambient = {
      PATH: "/usr/bin",
      NODE_OPTIONS: "--inspect",
      GIT_INDEX_FILE: "/tmp/foreign-index",
      HOME: "/tmp/home",
      TMPDIR: "/tmp/runtime",
      YARN_ENABLE_SCRIPTS: "false",
      NPM_TOKEN: "must-not-leak",
      HTTPS_PROXY: "http://ambient.invalid",
    };
    const node22 = createRuntimeEnvironment("node22.5", "/opt/node22/bin/node", ambient);
    expect(node22).toMatchObject({
      NODE_OPTIONS: "--experimental-sqlite",
      HOME: "/tmp/home",
      TMPDIR: "/tmp/runtime",
    });
    expect(node22.PATH).toBe("/opt/node22/bin:/usr/bin:/bin");
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
      NODE_OPTIONS: "--experimental-sqlite",
    };

    const packageManagerEnvironment = {
      PATH: "/opt/node24/bin:/usr/bin",
      NODE_OPTIONS: "--inspect",
      HOME: "/ambient/home",
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
    expect(runtimeEnvironment.NODE_OPTIONS).toBe("--experimental-sqlite");
  });

  it("moves runtime gates into the materialization-private home and temporary directory", () => {
    const runtimeEnvironment = createRuntimeEnvironment("node22.5", "/opt/node22/bin/node", {
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
      HOME: "/private/home",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      NODE_OPTIONS: "--experimental-sqlite",
      PATH: "/opt/node22/bin:/usr/bin:/bin",
      TMPDIR: "/private/tmp",
    });
    expect(privateEnvironment).not.toHaveProperty("NPM_TOKEN");
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
      expect(
        buildRuntimeTerminalReport({
          fallbackReport: { runtime: "node22.5", commands: [] },
          runtimeReport: undefined,
          runtimeError,
          cleanupError: undefined,
        }),
      ).toMatchObject({
        status: "fail",
        failed_phase: "materialization",
        cleanup_status: "fail",
        runtime_error: expect.stringMatching(/contains dist/u),
        cleanup_error: expect.stringMatching(/cleanup could not remove/u),
      });
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
              if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
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

  it("preserves the complete runtime and cleanup outcome cross-product", async () => {
    const passReport = {
      status: "pass",
      runtime: "node22.5",
      node_version: "v22.5.0",
      commands: Array.from({ length: 15 }, (_, index) => ({ id: String(index) })),
    };
    expect(
      buildRuntimeTerminalReport({
        fallbackReport: passReport,
        runtimeReport: passReport,
        runtimeError: undefined,
        cleanupError: undefined,
      }),
    ).toMatchObject({ status: "pass", cleanup_status: "pass" });

    const runtimeFailure = new Error("candidate materialization failed");
    expect(
      buildRuntimeTerminalReport({
        fallbackReport: passReport,
        runtimeReport: undefined,
        runtimeError: runtimeFailure,
        cleanupError: undefined,
      }),
    ).toMatchObject({
      status: "fail",
      failed_phase: "materialization",
      cleanup_status: "pass",
      runtime_error: runtimeFailure.message,
    });

    const cleanupFailure = new Error("registered worktree survived cleanup");
    expect(
      buildRuntimeTerminalReport({
        fallbackReport: passReport,
        runtimeReport: passReport,
        runtimeError: undefined,
        cleanupError: cleanupFailure,
      }),
    ).toMatchObject({
      status: "fail",
      failed_phase: "cleanup",
      cleanup_status: "fail",
      cleanup_error: cleanupFailure.message,
    });

    const unrelatedAggregate = new AggregateError(
      [runtimeFailure, cleanupFailure],
      "unrelated aggregate failure",
      { cause: runtimeFailure },
    );
    expect(
      buildRuntimeTerminalReport({
        fallbackReport: passReport,
        runtimeReport: undefined,
        runtimeError: unrelatedAggregate,
        cleanupError: undefined,
      }),
    ).toMatchObject({
      status: "fail",
      failed_phase: "materialization",
      cleanup_status: "pass",
      runtime_error: unrelatedAggregate.message,
    });
  });

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
          env: withoutGitIndexFile({
            AST_NODE_22_BIN: process.execPath,
            AST_NODE_24_BIN: process.execPath,
          }),
          timeoutMs: 5000,
        },
      );
      expect(result.exitCode).not.toBe(0);
      const summary = JSON.parse(await readFile(path.join(outputDir, "summary.json"), "utf8"));
      expect(summary).toMatchObject({ status: "fail", candidate_tree: "f".repeat(40) });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
