import {
  chmod,
  link,
  lstat,
  rename,
  symlink,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { describe, expect, it } from "vitest";
// @ts-expect-error Internal MJS operation is verified through native filesystem tests.
// prettier-ignore
import { createPrivatePnpmEnvironment, inspectPrivatePnpmEnvironment } from "../scripts/private-pnpm.mjs";

type Options = {
  temporaryRoot: string;
  nodeBin?: string;
  nodeBinDir?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
};

function metadata(s: Awaited<ReturnType<typeof lstat>>) {
  return [s.ino, s.mode, s.uid, s.gid, s.nlink, s.size, s.mtimeMs, s.ctimeMs];
}

// Do not follow links or record ambient environments. atime is changed by reading itself.
async function snapshot(root: string): Promise<unknown> {
  const s = await lstat(root);
  const contents = s.isSymbolicLink()
    ? await readlink(root)
    : s.isDirectory()
      ? await Promise.all(
          (await readdir(root))
            .sort()
            .map(async (name) => [name, await snapshot(path.join(root, name))]),
        )
      : await readFile(root, "utf8");
  return [metadata(s), contents];
}

async function withEnvironment(run: (options: Options, root: string) => Promise<void>) {
  expect(isMainThread).toBe(true); // Vitest's default forks pool permits isolated umask changes.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "pnpm-inspection-")));
  const options = { temporaryRoot: path.join(root, "state"), baseEnvironment: { PATH: "/caller" } };
  try {
    const mask = process.umask(0o077);
    try {
      await createPrivatePnpmEnvironment(options);
    } finally {
      process.umask(mask);
    }
    await writeFile(path.join(root, "sentinel"), "untouched");
    await mkdir(path.join(root, "target"), { mode: 0o700 });
    await writeFile(
      path.join(root, "target", "bytes"),
      `#!/bin/sh\nprintf ran > '${root}/payload'\n`,
      { mode: 0o700 },
    );
    await run(options, root);
  } finally {
    await rm(root, { recursive: true, force: true });
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
  }
}

async function unchanged(root: string, inspect: () => Promise<void>) {
  const before = await snapshot(root);
  try {
    await inspect();
  } finally {
    expect(await snapshot(root)).toEqual(before);
  }
}

const fixedPaths = [
  "",
  "package-manager",
  "package-manager/bin",
  "package-manager/corepack",
  "package-manager/pnpm",
  "package-manager/home",
  "package-manager/xdg-cache",
  "package-manager/xdg-config",
  "package-manager/xdg-data",
  "package-manager/xdg-state",
  "package-manager/npm-cache",
  "package-manager/npmrc",
];

describe("read-only private pnpm environment inspection", () => {
  for (const relative of fixedPaths) {
    it.each(["missing", "type", "symlink", "group-write", "world-write"])(
      `rejects ${relative || "temporaryRoot"}: %s without changing rejected state`,
      async (fault) => {
        await withEnvironment(async (options, root) => {
          const target = path.join(options.temporaryRoot, relative);
          const saved = `${target}.saved`;
          const original = await lstat(target);
          const modeFault = fault.endsWith("write");
          if (!modeFault) await rename(target, saved);
          try {
            if (modeFault)
              await chmod(target, original.mode | (fault === "group-write" ? 0o020 : 0o002));
            else if (fault === "symlink") await symlink(saved, target);
            else if (fault === "type") {
              if (original.isDirectory()) await writeFile(target, "not a directory");
              else await mkdir(target);
            }
            await unchanged(root, async () => {
              const inspection = expect(inspectPrivatePnpmEnvironment(options)).rejects;
              if (fault === "missing")
                await inspection.toMatchObject({ code: "ENOENT", path: target });
              else
                await inspection.toThrow(
                  new Error(`BLOCKED: private pnpm authority: unsafe environment path: ${target}`),
                );
            });
          } finally {
            if (modeFault) await chmod(target, original.mode);
            else {
              await rm(target, { recursive: true, force: true });
              await rename(saved, target);
            }
          }
        });
      },
    );
  }

  it.each(["executable", "file", "dangling", "real-node", "directory"])(
    "refuses private bin/node %s without executing payloads",
    async (form) => {
      await withEnvironment(async (options, root) => {
        const node = path.join(options.temporaryRoot, "package-manager/bin/node");
        try {
          if (form === "directory") await mkdir(node);
          else if (form === "dangling" || form === "real-node")
            await symlink(form === "dangling" ? path.join(root, "absent") : process.execPath, node);
          else
            await writeFile(node, `#!/bin/sh\nprintf ran > '${root}/payload'\n`, {
              mode: form === "executable" ? 0o700 : 0o600,
            });
          await createPrivatePnpmEnvironment(options); // Shadow refusal is inspection-only.
          const installed = metadata(await lstat(process.execPath));
          await unchanged(root, async () => {
            try {
              await expect(inspectPrivatePnpmEnvironment(options)).rejects.toThrow();
            } finally {
              expect(metadata(await lstat(process.execPath))).toEqual(installed);
            }
          });
        } finally {
          await rm(node, { recursive: true, force: true });
        }
      });
    },
  );

  it.each(["content", "hardlink"])("rejects npmrc %s without repair", async (fault) => {
    await withEnvironment(async (options, root) => {
      const npmrc = path.join(options.temporaryRoot, "package-manager/npmrc");
      const alias = path.join(root, "npmrc-alias");
      try {
        if (fault === "content") await writeFile(npmrc, "registry=https://invalid.example\n");
        else await link(npmrc, alias);
        await unchanged(root, async () => {
          await expect(inspectPrivatePnpmEnvironment(options)).rejects.toThrow();
        });
      } finally {
        await rm(alias, { force: true });
        await writeFile(npmrc, "");
      }
    });
  });

  it("keeps default ambient projection private and preserves selected defaults", async () => {
    await withEnvironment(async ({ temporaryRoot }, root) => {
      const created = await createPrivatePnpmEnvironment({ temporaryRoot });
      await unchanged(root, async () => {
        const inspected = await inspectPrivatePnpmEnvironment({ temporaryRoot });
        expect(inspected.nodeBin).toBe(process.execPath);
        expect(inspected.environment.PATH === created.environment.PATH).toBe(true);
        expect(inspected.environment.NODE_OPTIONS).toBe("");
        expect(inspected.environment.CI).toBe("true");
      });
    });
  });

  it.each([
    {
      nodeBin: "relative/node",
      nodeBinDir: "/override",
      baseEnvironment: { PATH: "", NODE_OPTIONS: "hostile", CI: "false" },
    },
    { nodeBin: "relative/node", baseEnvironment: {} },
    { nodeBinDir: "", baseEnvironment: { PATH: "/a::/b" } },
  ])("preserves explicit caller configuration %j without admitting it", async (config) => {
    await withEnvironment(async (options, root) => {
      const configured = { ...options, ...config };
      const created = await createPrivatePnpmEnvironment(configured);
      await unchanged(root, async () => {
        const inspected = await inspectPrivatePnpmEnvironment(configured);
        expect(inspected).toEqual(created);
        expect(inspected.nodeBin).toBe(config.nodeBin ?? process.execPath);
        expect(inspected.environment.PATH).toBe(
          [
            created.binDirectory,
            config.nodeBinDir ?? path.dirname(config.nodeBin ?? process.execPath),
            config.baseEnvironment.PATH ?? "",
          ]
            .filter(Boolean)
            .join(path.delimiter),
        );
        expect(inspected.environment).toMatchObject({
          NODE_OPTIONS: "",
          CI: "true",
          COREPACK_DEFAULT_TO_LATEST: "0",
          COREPACK_ENABLE_AUTO_PIN: "0",
          COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
          COREPACK_INTEGRITY_KEYS: "0",
          npm_config_registry: "https://registry.npmjs.org",
        });
      });
    });
  });

  it("allows links beneath cache directories without authenticating their targets", async () => {
    await withEnvironment(async (options, root) => {
      for (const cache of ["corepack", "pnpm", "xdg-cache", "npm-cache"])
        await symlink(
          path.join(root, "target"),
          path.join(options.temporaryRoot, "package-manager", cache, "link"),
        );
      const nodeBin = path.join(root, "target", "bytes");
      await unchanged(root, async () => {
        expect((await inspectPrivatePnpmEnvironment({ ...options, nodeBin })).nodeBin).toBe(
          nodeBin,
        );
        await expect(lstat(path.join(root, "payload"))).rejects.toMatchObject({ code: "ENOENT" });
      });
    });
  });

  it.each(["ancestor-alias", "trailing-slash", "relative"])(
    "rejects noncanonical root %s",
    async (form) => {
      await withEnvironment(async (options, root) => {
        const alias = path.join(root, "alias");
        try {
          await symlink(root, alias);
          const temporaryRoot =
            form === "ancestor-alias"
              ? path.join(alias, "state")
              : form === "trailing-slash"
                ? `${options.temporaryRoot}/`
                : path.relative(process.cwd(), options.temporaryRoot);
          await unchanged(root, async () => {
            await expect(
              inspectPrivatePnpmEnvironment({ ...options, temporaryRoot }),
            ).rejects.toThrow();
          });
        } finally {
          await rm(alias, { force: true });
        }
      });
    },
  );

  it("reconstitutes the controlled creator projection repeatedly without writes", async () => {
    await withEnvironment(async (options, root) => {
      const created = await createPrivatePnpmEnvironment(options);
      await unchanged(root, async () => {
        expect(await inspectPrivatePnpmEnvironment(options)).toEqual(created);
        expect(await inspectPrivatePnpmEnvironment(options)).toEqual(created);
      });
    });
  });
});
