import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
const gnuMvModule = await import("../scripts/ci-prepare-gnu-mv.mjs");
const { GNU_MV_SOURCE, probeGnuMv } = gnuMvModule;

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repositoryRoot, "scripts", "ci-prepare-gnu-mv.mjs");
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CI GNU mv preparation", () => {
  it("pins one bounded official GNU source artifact", () => {
    expect(GNU_MV_SOURCE).toEqual({
      version: "9.7",
      url: "https://mirrors.kernel.org/gnu/coreutils/coreutils-9.7.tar.xz",
      sha256: "e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf",
      maximumBytes: 8 * 1024 * 1024,
    });
    expect(Object.isFrozen(GNU_MV_SOURCE)).toBe(true);
  });

  it.runIf(process.platform === "linux" && process.arch === "x64")(
    "proves the exact installed GNU mv version and no-replace postimages",
    async () => {
      await expect(probeGnuMv("/usr/bin/mv", os.tmpdir())).resolves.toEqual({
        status: "pass",
        version: "9.7",
      });
    },
  );

  it("rejects a binary that only advertises an older GNU version", async () => {
    const root = await temporaryDirectory("ast-old-gnu-mv-");
    const fakeMv = path.join(root, "mv");
    await writeFile(fakeMv, "#!/bin/sh\nprintf 'mv (GNU coreutils) 9.4\\n'\n", "utf8");
    await chmod(fakeMv, 0o755);

    await expect(probeGnuMv(fakeMv, root)).rejects.toThrow(/version must be exactly 9\.7/u);
  });

  it("rejects unknown CLI modes before any CI mutation", async () => {
    await expect(execFileAsync(process.execPath, [scriptPath, "install"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/Usage:.*prepare\|probe/u),
    });
  });
});
