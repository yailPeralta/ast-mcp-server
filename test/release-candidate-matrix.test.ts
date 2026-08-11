import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
// @ts-expect-error The release runner is intentionally shipped as a standalone ESM script.
const matrixModule = await import("../scripts/release-candidate-matrix.mjs");
const {
  RELEASE_CANDIDATE_COMMAND_IDS,
  createRuntimeCommandPlan,
  createRuntimeEnvironment,
  parseReleaseCandidateMatrixArgs,
  runBoundedProcess,
  validateRuntimeVersion,
} = matrixModule;

const candidateTree = "a".repeat(40);

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
    const yarnEntry = "/opt/node-22.5/lib/corepack/yarn.js";
    const plan = createRuntimeCommandPlan(runtime, yarnEntry);
    expect(plan.map(({ id }: { id: string }) => id)).toEqual(RELEASE_CANDIDATE_COMMAND_IDS);
    expect(plan).toHaveLength(15);
    expect(plan[0]).toEqual({
      id: "install",
      file: runtime.nodeBinary,
      args: [yarnEntry, "install", "--immutable"],
    });
    expect(plan[12]).toEqual({
      id: "pack",
      file: runtime.nodeBinary,
      args: [yarnEntry, "pack", "--dry-run", "--json"],
    });
    expect(plan[13]).toMatchObject({
      id: "workflow-policy",
      file: runtime.nodeBinary,
    });
    expect(plan[14]).toEqual({ id: "diff-check", file: "git", args: ["diff", "--check"] });
  });

  it("sets the Node 22 SQLite flag exactly and removes ambient controls from Node 24", () => {
    const ambient = {
      PATH: "/usr/bin",
      NODE_OPTIONS: "--inspect",
      GIT_INDEX_FILE: "/tmp/foreign-index",
      HOME: "/tmp/home",
    };
    const node22 = createRuntimeEnvironment("node22.5", "/opt/node22/bin/node", ambient);
    expect(node22).toMatchObject({
      NODE_OPTIONS: "--experimental-sqlite",
      HOME: "/tmp/home",
    });
    expect(node22.PATH?.split(path.delimiter)[0]).toBe("/opt/node22/bin");
    expect(node22).not.toHaveProperty("GIT_INDEX_FILE");

    const node24 = createRuntimeEnvironment("node24", "/opt/node24/bin/node", ambient);
    expect(node24).not.toHaveProperty("NODE_OPTIONS");
    expect(node24).not.toHaveProperty("GIT_INDEX_FILE");
    expect(ambient).toHaveProperty("NODE_OPTIONS", "--inspect");
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
});
