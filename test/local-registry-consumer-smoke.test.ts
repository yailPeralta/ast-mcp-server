import {
  copyFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  authenticateLocalRegistryAuthorities,
  assertLocalRegistryRuntime,
  completeBeforePublishing,
  executeAuthenticatedPackageManager,
  parseLocalRegistryArguments,
  removeTemporaryRoot,
} from "../scripts/local-registry-consumer-smoke.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function digest(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

async function javascriptEntry(file: string, version: string, label: string): Promise<void> {
  await writeFile(
    file,
    `import { execFileSync } from "node:child_process";\nif (process.argv[2] === "--version") process.stdout.write(${JSON.stringify(version)} + "\\n"); else { const child = execFileSync("node", ["--version"], { encoding: "utf8" }).trim(); process.stdout.write(${JSON.stringify(label)} + ":" + process.version + ":" + child + "\\n"); }\n`,
    { mode: 0o600 },
  );
}

async function authorityFixture(root: string) {
  const authorityHome = path.join(root, "authority-home");
  const authorityTemp = path.join(root, "authority-tmp");
  const trustedBin = path.join(root, "trusted-bin");
  const transitiveNodeBin = path.join(trustedBin, "node");
  const yarnEntry = path.join(root, "yarn.js");
  const npmEntry = path.join(root, "npm-cli.js");
  const expectedNode = process.versions.node === "22.13.0" ? "22.13.0" : "24";
  const expectedNpm = expectedNode === "22.13.0" ? "10.9.2" : "11.13.0";
  await Promise.all([
    mkdir(authorityHome, { mode: 0o700 }),
    mkdir(authorityTemp, { mode: 0o700 }),
    mkdir(trustedBin, { mode: 0o700 }),
    javascriptEntry(yarnEntry, "4.15.0", "trusted-yarn"),
    javascriptEntry(npmEntry, expectedNpm, "trusted-npm"),
  ]);
  await copyFile(process.execPath, transitiveNodeBin);
  await chmod(transitiveNodeBin, 0o700);
  return {
    roots: { home: authorityHome, temp: authorityTemp },
    options: {
      expectedNode,
      yarnEntry,
      npmEntry,
      transitiveNodeBin,
      expectedNodeSha256: await digest(process.execPath),
      expectedYarnSha256: await digest(yarnEntry),
      expectedNpmSha256: await digest(npmEntry),
    },
  } as const;
}

describe("local registry consumer smoke contract", () => {
  it("parses only the closed runtime, package-manager authority, and output arguments", () => {
    const args = [
      "--expected-node",
      "22.13.0",
      "--yarn-entry",
      "/private/yarn.js",
      "--npm-entry",
      "/private/npm-cli.js",
      "--transitive-node-bin",
      "/private/bin/node",
      "--expected-node-sha256",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "--expected-yarn-sha256",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "--expected-npm-sha256",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "--output",
      "/tmp/local-registry.json",
    ];
    expect(parseLocalRegistryArguments(args)).toEqual({
      expectedNode: "22.13.0",
      yarnEntry: "/private/yarn.js",
      npmEntry: "/private/npm-cli.js",
      transitiveNodeBin: "/private/bin/node",
      expectedNodeSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedYarnSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedNpmSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      output: "/tmp/local-registry.json",
    });
    expect(() => parseLocalRegistryArguments([])).toThrow(/--expected-node/u);
    expect(() => parseLocalRegistryArguments([...args, "--shell", "yes"])).toThrow(
      /Unknown or incomplete argument/u,
    );
    expect(() =>
      parseLocalRegistryArguments(
        args.map((value) =>
          value === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            ? "BAD"
            : value,
        ),
      ),
    ).toThrow(/lowercase SHA-256/u);
    expect(() =>
      parseLocalRegistryArguments(
        args.map((value) => (value === "/private/yarn.js" ? "relative/yarn.js" : value)),
      ),
    ).toThrow(/absolute normalized file/u);
  });

  it("requires exact Node 22.13.0 and the governed Node 24 major", () => {
    expect(() => assertLocalRegistryRuntime("22.13.0", "22.13.0", "")).not.toThrow();
    expect(() => assertLocalRegistryRuntime("24", "24.16.0", "")).not.toThrow();
    expect(() => assertLocalRegistryRuntime("22.13.0", "22.13.1", "")).toThrow(
      /Expected Node 22\.13\.0/u,
    );
    expect(() => assertLocalRegistryRuntime("24", "25.0.0", "")).toThrow(/Expected Node 24/u);
    expect(() => assertLocalRegistryRuntime("24", "24.16.0", "--inspect")).toThrow(
      /NODE_OPTIONS must be empty/u,
    );
  });

  it("binds direct and transitive execution independently of hostile PATH entries", async () => {
    const root = await temporaryDirectory("ast-local-registry-authority-");
    const fixture = await authorityFixture(root);
    const hostileBin = path.join(root, "hostile-bin");
    const sentinel = path.join(root, "hostile-sentinel");
    await mkdir(hostileBin, { mode: 0o700 });
    for (const executable of ["node", "yarn", "npm"]) {
      const file = path.join(hostileBin, executable);
      await writeFile(
        file,
        `#!/bin/sh
printf '%s' hostile > ${JSON.stringify(sentinel)}
exit 99
`,
        { mode: 0o700 },
      );
      await chmod(file, 0o700);
    }
    const authorities = await authenticateLocalRegistryAuthorities(fixture.options, fixture.roots);
    const hostileEnvironment = {
      HOME: fixture.roots.home,
      TMPDIR: fixture.roots.temp,
      PATH: hostileBin,
      NODE_OPTIONS: "",
    };
    const [yarn, npm] = await Promise.all([
      executeAuthenticatedPackageManager(authorities, "yarn", ["probe"], {
        env: hostileEnvironment,
      }),
      executeAuthenticatedPackageManager(authorities, "npm", ["probe"], {
        env: hostileEnvironment,
      }),
    ]);
    expect(yarn.stdout.trim()).toBe(`trusted-yarn:${process.version}:${process.version}`);
    expect(npm.stdout.trim()).toBe(`trusted-npm:${process.version}:${process.version}`);
    await expect(lstat(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects replaceable or group-writable package-manager authority entries", async () => {
    const root = await temporaryDirectory("ast-local-registry-unsafe-authority-");
    const fixture = await authorityFixture(root);
    const yarnLink = path.join(root, "yarn-link.js");
    await symlink(fixture.options.yarnEntry, yarnLink);
    await expect(
      authenticateLocalRegistryAuthorities(
        { ...fixture.options, yarnEntry: yarnLink },
        fixture.roots,
      ),
    ).rejects.toThrow(/Yarn authority must be a physical regular file/u);
    await rm(yarnLink);
    await writeFile(yarnLink, await readFile(fixture.options.yarnEntry), { mode: 0o620 });
    await chmod(yarnLink, 0o620);
    await expect(
      authenticateLocalRegistryAuthorities(
        { ...fixture.options, yarnEntry: yarnLink },
        fixture.roots,
      ),
    ).rejects.toThrow(/Yarn authority must not be writable by group or other/u);
  });

  it("rejects unexpected package-manager bytes and an unbound transitive Node", async () => {
    const root = await temporaryDirectory("ast-local-registry-digest-authority-");
    const fixture = await authorityFixture(root);
    await expect(
      authenticateLocalRegistryAuthorities(
        { ...fixture.options, expectedYarnSha256: "0".repeat(64) },
        fixture.roots,
      ),
    ).rejects.toThrow(/digest does not match/u);
    const hostileBin = path.join(root, "alternate-node-bin");
    const hostileNode = path.join(hostileBin, "node");
    await mkdir(hostileBin, { mode: 0o700 });
    await writeFile(
      hostileNode,
      `#!/bin/sh
printf '%s\n' ${JSON.stringify(process.version)}
`,
      {
        mode: 0o700,
      },
    );
    await chmod(hostileNode, 0o700);
    await expect(
      authenticateLocalRegistryAuthorities(
        { ...fixture.options, transitiveNodeBin: hostileNode },
        fixture.roots,
      ),
    ).rejects.toThrow(/digest does not match/u);
  });

  it("uses bounded cleanup retries without swallowing a persistent failure", async () => {
    const calls: Array<{ root: string; options: object }> = [];
    await removeTemporaryRoot("/owned/root", async (root, options) => {
      calls.push({ root, options });
    });
    expect(calls).toEqual([
      {
        root: "/owned/root",
        options: { recursive: true, force: true, maxRetries: 3, retryDelay: 100 },
      },
    ]);

    await expect(
      removeTemporaryRoot("/owned/root", async () => {
        throw Object.assign(new Error("still active"), { code: "ENOTEMPTY" });
      }),
    ).rejects.toMatchObject({ code: "ENOTEMPTY" });
  });

  it.each(["server close", "temporary-root cleanup"])(
    "does not publish PASS when %s fails",
    async (failedCleanup) => {
      const calls: string[] = [];
      const publish = async () => {
        calls.push("publish");
      };
      await expect(
        completeBeforePublishing(
          async () => {
            calls.push("operation");
            return { status: "pass" };
          },
          [
            async () => {
              calls.push("server close");
              if (failedCleanup === "server close") throw new Error("injected close failure");
            },
            async () => {
              calls.push("temporary-root cleanup");
              if (failedCleanup === "temporary-root cleanup") {
                throw new Error("injected root cleanup failure");
              }
            },
          ],
          publish,
        ),
      ).rejects.toThrow(/cleanup failed/u);
      expect(calls).toEqual(["operation", "server close", "temporary-root cleanup"]);
    },
  );

  it("does not publish after an operation failure and still attempts every cleanup", async () => {
    const calls: string[] = [];
    await expect(
      completeBeforePublishing(
        async () => {
          calls.push("operation");
          throw new Error("injected operation failure");
        },
        [
          async () => {
            calls.push("server close");
          },
          async () => {
            calls.push("temporary-root cleanup");
          },
        ],
        async () => {
          calls.push("publish");
        },
      ),
    ).rejects.toThrow(/operation failure/u);
    expect(calls).toEqual(["operation", "server close", "temporary-root cleanup"]);
  });

  it("publishes only after every cleanup succeeds", async () => {
    const calls: string[] = [];
    const report = await completeBeforePublishing(
      async () => {
        calls.push("operation");
        return { status: "pass" };
      },
      [
        async () => {
          calls.push("server close");
        },
        async () => {
          calls.push("temporary-root cleanup");
        },
      ],
      async () => {
        calls.push("publish");
      },
    );
    expect(report).toEqual({ status: "pass" });
    expect(calls).toEqual(["operation", "server close", "temporary-root cleanup", "publish"]);
  });
});
