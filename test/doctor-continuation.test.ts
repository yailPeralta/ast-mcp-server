import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildDoctorConfigContinuation } from "../src/services/doctor-continuation.js";

const executeFile = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ast-doctor-continuation-"));
  roots.push(root);
  return root;
}

async function spawnContinuation(continuation: string, cwd: string): Promise<string[]> {
  const command = continuation.match(/run:\s*(ast-tool doctor.*)$/iu)?.[1];
  if (!command) throw new Error("Continuation did not contain an executable doctor command.");
  const bin = path.join(cwd, "bin");
  const output = path.join(cwd, "doctor-args");
  await mkdir(bin);
  const executable = path.join(bin, "ast-tool");
  await writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$@" > "$DOCTOR_ARGS"\n');
  await chmod(executable, 0o755);
  await executeFile("/bin/sh", ["-c", command], {
    cwd,
    env: { PATH: bin, DOCTOR_ARGS: output },
  });
  await rm(bin, { recursive: true });
  return (await readFile(output, "utf8")).trimEnd().split("\n");
}

describe("doctor config continuations", () => {
  it("never derives command operands from discovery exception prose", async () => {
    const cwd = await temporaryRoot();
    const project = path.join(cwd, "trusted project");
    const continuation = buildDoctorConfigContinuation(
      "ambiguous",
      'Set project_root to "../../SENSITIVE_HOST/SENSITIVE_EXCEPTION/tsconfig.json".',
      project,
      cwd,
    );

    expect(await spawnContinuation(continuation, cwd)).toEqual([
      "doctor",
      "--project",
      "./trusted project/tsconfig.json",
    ]);
    expect(continuation).not.toMatch(/SENSITIVE_HOST|SENSITIVE_EXCEPTION/u);
  });

  it("spawns dual, missing, and unsafe outside paths from the original cwd", async () => {
    const cwd = await temporaryRoot();
    const outsideRoot = await temporaryRoot();
    const outside = path.join(outsideRoot, "outside 'project");
    await mkdir(outside);
    const cases = [
      {
        state: "ambiguous" as const,
        project: outside,
        expected: path.join(outside, "tsconfig.json"),
        discovery: `Set project_root to "${path.relative(cwd, path.join(outside, "tsconfig.json"))}".`,
      },
      {
        state: "missing" as const,
        project: path.join(outsideRoot, "missing 'dir"),
        expected: undefined,
        discovery: undefined,
      },
      {
        state: "unsafe" as const,
        project: path.join(outsideRoot, "unsafe 'link.json"),
        expected: undefined,
        discovery: undefined,
      },
    ];
    for (const testCase of cases) {
      const continuation = buildDoctorConfigContinuation(
        testCase.state,
        testCase.discovery,
        testCase.project,
        cwd,
      );
      expect(await spawnContinuation(continuation, cwd)).toEqual([
        "doctor",
        "--project",
        path.relative(cwd, testCase.expected ?? testCase.project),
      ]);
      expect(continuation).not.toMatch(/\[path-redacted\]|\/tmp\//u);
    }
  });
});
