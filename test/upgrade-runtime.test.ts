import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUpgradeRuntime, UpgradeCleanupError } from "../src/services/upgrade-runtime.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runtimeFiles(prefix: string, npmrc: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  const nodePath = path.join(root, "toolchain", "bin", "node");
  const npm = path.join(root, "toolchain", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const cliPath = path.join(
    root,
    "toolchain",
    "lib",
    "node_modules",
    "ast-mcp-server",
    "dist",
    "cli.js",
  );
  const home = path.join(root, "home");
  await Promise.all(
    [nodePath, npm, cliPath].map((file) => mkdir(path.dirname(file), { recursive: true })),
  );
  await mkdir(path.join(home, ".npm"), { recursive: true });
  await Promise.all([
    writeFile(nodePath, "node"),
    writeFile(npm, "npm"),
    writeFile(cliPath, "cli"),
    writeFile(path.join(home, ".npmrc"), npmrc),
    writeFile(path.join(home, ".npm", "sentinel"), "keep"),
  ]);
  return { root, nodePath, npm, cliPath, home };
}

describe("upgrade runtime", () => {
  it("binds npm to Node under hostile PATH and isolates cache and config writes", async () => {
    const files = await runtimeFiles("ast-upgrade-runtime-", "prefix=sentinel\n");
    await symlink(files.npm, path.join(path.dirname(files.nodePath), "npm"));
    let invocation: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv } | undefined;
    const lease = await createUpgradeRuntime(files.cliPath, {
      nodeExecutable: files.nodePath,
      environment: { HOME: files.home, PATH: path.join(files.root, "hostile") },
      temporaryParent: files.root,
      execute: async (file, args, options) => {
        invocation = { file, args, env: options.env };
        await writeFile(path.join(options.env.npm_config_cache!, "touched"), "cache");
        return { stdout: '"0.11.0"', stderr: "" };
      },
    });
    await expect(lease.runtime.latestVersion("npm")).resolves.toBe("0.11.0");
    expect(invocation).toMatchObject({
      file: files.nodePath,
      args: [files.npm, "view", "ast-mcp-server@latest", "version", "--json"],
    });
    expect(invocation!.env.npm_config_cache).not.toContain(files.home);
    expect(invocation!.env.npm_config_userconfig).not.toContain(files.home);
    expect(await readFile(path.join(files.home, ".npmrc"), "utf8")).toBe("prefix=sentinel\n");
    expect(await readFile(path.join(files.home, ".npm", "sentinel"), "utf8")).toBe("keep");
    const boundary = path.dirname(invocation!.env.npm_config_cache!);
    await lease.dispose();
    await expect(access(boundary)).rejects.toThrow();
  });

  it("removes credential bytes after restoring owner access", async () => {
    const files = await runtimeFiles("ast-upgrade-cleanup-", "token=private-token\n");
    let userConfig = "";
    const lease = await createUpgradeRuntime(files.cliPath, {
      nodeExecutable: files.nodePath,
      environment: { HOME: files.home },
      temporaryParent: files.root,
      execute: async (_file, _args, options) => {
        userConfig = options.env.npm_config_userconfig!;
        return { stdout: '"0.11.0"', stderr: "" };
      },
    });
    await lease.runtime.latestVersion("npm");
    const boundary = path.dirname(userConfig);
    await chmod(boundary, 0);
    await lease.dispose();
    await expect(access(boundary)).rejects.toThrow();
  });

  it("rejects a sanitized typed failure when cleanup absence is unproven", async () => {
    const files = await runtimeFiles("ast-upgrade-failure-", "token=private-token\n");
    const lease = await createUpgradeRuntime(files.cliPath, {
      nodeExecutable: files.nodePath,
      environment: { HOME: files.home },
      temporaryParent: files.root,
      removeTree: async () => undefined,
    });
    const error = await lease.dispose().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UpgradeCleanupError);
    expect(JSON.stringify(error)).not.toMatch(/private-token|ast-upgrade|npmrc|\/tmp/);
  });

  it("preserves a sanitized creation failure when exception cleanup also fails", async () => {
    const files = await runtimeFiles("ast-upgrade-exception-", "token=private-token\n");
    await rm(files.cliPath);
    const error = await createUpgradeRuntime(files.cliPath, {
      nodeExecutable: files.nodePath,
      environment: { HOME: files.home },
      temporaryParent: files.root,
      removeTree: async () => undefined,
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "UPGRADE_CLEANUP_FAILED",
      primaryCode: "UPGRADE_RUNTIME_CREATION_FAILED",
    });
    expect(JSON.stringify(error)).not.toMatch(/private-token|ast-upgrade|npmrc|\/tmp/);
  });
});
