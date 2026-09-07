import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
// @ts-expect-error Internal MJS smoke helper has runtime-tested exports.
// prettier-ignore
import { PNPM_DESCRIPTOR, PNPM_REGISTRY_INTEGRITY, PNPM_VERSION, createPnpmExecLauncher, createPrivatePnpmEnvironment, isCorepackCompatibilityFailure, provisionPrivatePnpm } from "../scripts/private-pnpm.mjs";

const roots: string[] = [];
async function privateEnvironment(baseEnvironment: NodeJS.ProcessEnv = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "private-pnpm-test-"));
  roots.push(temporaryRoot);
  return {
    temporaryRoot,
    authority: await createPrivatePnpmEnvironment({
      temporaryRoot,
      nodeBinDir: path.dirname(process.execPath),
      baseEnvironment,
    }),
  };
}

async function exitOutcome(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: "ignore" });
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
}
describe("private pnpm authority", () => {
  it("owns every package-manager path below the disposable root", async () => {
    const hostile = path.join(os.tmpdir(), "hostile-pnpm");
    const { temporaryRoot, authority } = await privateEnvironment({
      PATH: `${hostile}${path.delimiter}/usr/bin`,
      HOME: hostile,
      COREPACK_HOME: hostile,
      npm_config_cache: hostile,
    });
    for (const key of [
      "COREPACK_HOME",
      "PNPM_HOME",
      "HOME",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "npm_config_cache",
      "npm_config_userconfig",
    ]) {
      expect(path.resolve(authority.environment[key]!)).toEqual(
        expect.stringMatching(new RegExp(`^${temporaryRoot.replaceAll("\\", "\\\\")}`)),
      );
    }
    expect(authority.environment.PATH?.split(path.delimiter).slice(0, 2)).toEqual([
      authority.binDirectory,
      path.dirname(process.execPath),
    ]);
    expect(authority.environment).toMatchObject({
      COREPACK_DEFAULT_TO_LATEST: "0",
      COREPACK_ENABLE_AUTO_PIN: "0",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      NODE_OPTIONS: "",
      CI: "true",
    });
  });
  it("rejects version or digest mismatch before profile state", async () => {
    const { temporaryRoot, authority } = await privateEnvironment();
    const versionRunner = async (command: string) => {
      if (path.basename(command).startsWith("pnpm")) return { stdout: "12.3.4\n", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    await expect(
      provisionPrivatePnpm({ ...authority, cwd: temporaryRoot, runCommand: versionRunner }),
    ).rejects.toThrow(/pnpm version differs/u);

    const archiveName = "pnpm-11.7.0.tgz";
    const integrityRunner = async (command: string, args: string[]) => {
      if (command === "corepack" && args[0] === "prepare")
        throw new Error("Unsupported package manager specification");
      if (command === "npm") {
        await writeFile(path.join(args.at(-1)!, archiveName), "wrong digest");
        return {
          stdout: JSON.stringify([{ filename: archiveName, integrity: PNPM_REGISTRY_INTEGRITY }]),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    };
    await expect(
      provisionPrivatePnpm({ ...authority, cwd: temporaryRoot, runCommand: integrityRunner }),
    ).rejects.toThrow(/archive integrity differs/u);
  });
  it("ignores hostile ambient pnpm and Corepack homes", async () => {
    const { authority } = await privateEnvironment({ PATH: "/hostile", COREPACK_HOME: "/hostile" });
    expect(authority.environment.COREPACK_HOME).not.toContain("/hostile");
    expect(authority.environment.PATH?.split(path.delimiter)[0]).toBe(authority.binDirectory);
    expect(PNPM_DESCRIPTOR).toContain(`${PNPM_VERSION}+sha512.`);
  });
  it("permits fallback only for classified Corepack incompatibility", () => {
    expect(
      isCorepackCompatibilityFailure(new Error("Unsupported package manager specification")),
    ).toBe(true);
    for (const message of ["network unreachable", "timed out after 120000ms", "integrity mismatch"])
      expect(isCorepackCompatibilityFailure(new Error(message))).toBe(false);
  });
  it.runIf(process.platform !== "win32")(
    "replaces a real Corepack shim without mutating its fixture-global target",
    async () => {
      const { temporaryRoot, authority } = await privateEnvironment();
      const installedCorepack = await realpath(
        path.join(path.dirname(process.execPath), "corepack"),
      );
      const installedCorepackRoot = path.dirname(path.dirname(installedCorepack));
      const fixtureCorepackRoot = path.join(temporaryRoot, "corepack-fixture");
      await cp(installedCorepackRoot, fixtureCorepackRoot, { recursive: true });
      const fixtureCorepack = path.join(fixtureCorepackRoot, "dist", "corepack.js");
      await mkdir(authority.binDirectory, { recursive: true });
      await execFileAsync(process.execPath, [
        fixtureCorepack,
        "enable",
        "pnpm",
        "--install-directory",
        authority.binDirectory,
      ]);

      const launcher = path.join(authority.binDirectory, "pnpm");
      const fixtureGlobalTarget = path.join(fixtureCorepackRoot, "dist", "pnpm.js");
      const targetHash = createHash("sha256")
        .update(await readFile(fixtureGlobalTarget))
        .digest("hex");
      expect((await lstat(launcher)).isSymbolicLink()).toBe(true);
      expect(await realpath(launcher)).toBe(fixtureGlobalTarget);

      await createPnpmExecLauncher({
        binDirectory: authority.binDirectory,
        nodeBin: process.execPath,
        entrypoint: "/isolated/fallback/pnpm.cjs",
      });

      expect(
        createHash("sha256")
          .update(await readFile(fixtureGlobalTarget))
          .digest("hex"),
      ).toBe(targetHash);
      const launcherStat = await lstat(launcher);
      expect(launcherStat.isFile()).toBe(true);
      expect(launcherStat.isSymbolicLink()).toBe(false);
      expect(await realpath(launcher)).toBe(launcher);
    },
  );

  it.runIf(process.platform !== "win32")(
    "preserves launcher exit and signal outcomes",
    async () => {
      const { temporaryRoot, authority } = await privateEnvironment();
      const fixture = path.join(temporaryRoot, "fixture.mjs");
      await writeFile(
        fixture,
        'if(process.argv[2]==="hold"){process.stdout.write("ready\\n");setInterval(()=>{},1000)}else process.exit(23);\n',
      );
      const launcher = await createPnpmExecLauncher({
        binDirectory: authority.binDirectory,
        nodeBin: process.execPath,
        entrypoint: fixture,
      });
      expect(await exitOutcome(launcher, [])).toEqual({ code: 23, signal: null });
      const child = spawn(launcher, ["hold"], { stdio: ["ignore", "pipe", "ignore"] });
      await new Promise((resolve) => child.stdout.once("data", resolve));
      child.kill("SIGTERM");
      await expect(
        new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
      ).resolves.toEqual({ code: null, signal: "SIGTERM" });
    },
  );

  it("removes repeated success and failure roots", async () => {
    const first = await privateEnvironment();
    const second = await privateEnvironment();
    for (const root of [first.temporaryRoot, second.temporaryRoot]) {
      await rm(root, { recursive: true, force: true });
      await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});
afterAll(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
