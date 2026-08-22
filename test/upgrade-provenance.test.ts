import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectUpgrade, planUpgrade, type UpgradeRuntime } from "../src/services/upgrade.js";

const pkg = "/toolchain/lib/node_modules/ast-mcp-server";
const cli = `${pkg}/dist/cli.js`;
const node = "/toolchain/bin/node";
const npmCli = "/toolchain/lib/node_modules/npm/bin/npm-cli.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function metadata(version = "0.10.0") {
  return {
    name: "ast-mcp-server",
    version,
    bin: { "ast-tool": "dist/cli.js", "ast-mcp-server": "dist/index.js" },
  };
}
function fixture(overrides: Partial<UpgradeRuntime> = {}) {
  const calls: Array<[string, string[]]> = [];
  const runtime: UpgradeRuntime = {
    packageRoot: pkg,
    cliExecutable: cli,
    nodeExecutable: node,
    npmCliExecutable: npmCli,
    platform: "linux",
    realpath: async (value) => path.posix.normalize(value),
    directDirectory: async () => true,
    readPackage: async () => metadata(),
    latestVersion: async () => "0.11.0",
    run: async (file, args) => {
      calls.push([file, [...args]]);
      if (args[1] === "root") return "/toolchain/lib/node_modules\n";
      if (args[1] === "prefix") return "/toolchain\n";
      throw new Error("unavailable");
    },
    ...overrides,
  };
  return { runtime, calls };
}

describe("upgrade provenance planning", () => {
  it("upgrade --check is read-only and binds the active global installation", async () => {
    const { runtime, calls } = fixture();
    await expect(inspectUpgrade(runtime)).resolves.toEqual({
      version: 1,
      status: "ok",
      current_version: "0.10.0",
      latest_version: "0.11.0",
      provenance: "npm",
      update_available: true,
      action: "ast-tool upgrade",
      restart_required: true,
    });
    expect(calls.map((call) => call[1].slice(-2))).toEqual([
      ["root", "--global"],
      ["prefix", "--global"],
    ]);
  });

  it("uses Volta only for a separately proven Volta-owned installation", async () => {
    const voltaPkg = "/volta/tools/image/packages/ast-mcp-server";
    const voltaCli = `${voltaPkg}/dist/cli.js`;
    const { runtime } = fixture({
      packageRoot: voltaPkg,
      cliExecutable: voltaCli,
      voltaExecutable: "/volta/bin/volta",
      run: async (file, args) => {
        if (file === node) throw new Error("not npm global");
        if (args.join(" ") === "which ast-tool") return `${voltaCli}\n`;
        if (args.join(" ") === "which node") return `${node}\n`;
        throw new Error("unexpected");
      },
    });
    await expect(planUpgrade(runtime)).resolves.toMatchObject({
      provenance: "volta",
      install_executable: "/volta/bin/volta",
      install_args: ["install", "ast-mcp-server@latest"],
    });
  });

  it("rejects a linked npm package entry before install", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ast-upgrade-link-"));
    roots.push(root);
    const source = path.join(root, "source");
    const globalRoot = path.join(root, "global", "lib", "node_modules");
    await mkdir(path.join(source, "dist"), { recursive: true });
    await mkdir(globalRoot, { recursive: true });
    await writeFile(path.join(source, "package.json"), JSON.stringify(metadata()));
    await writeFile(path.join(source, "dist", "cli.js"), "");
    await symlink(source, path.join(globalRoot, "ast-mcp-server"), "dir");
    let installed = false;
    const { runtime } = fixture({
      packageRoot: await realpath(source),
      cliExecutable: await realpath(path.join(source, "dist", "cli.js")),
      realpath,
      directDirectory: async (value) => (await lstat(value)).isDirectory(),
      readPackage: async (value) =>
        JSON.parse(await readFile(path.join(value, "package.json"), "utf8")),
      run: async (_file, args) => {
        if (args[1] === "root") return `${globalRoot}\n`;
        if (args[1] === "prefix") return `${path.join(root, "global")}\n`;
        if (args.includes("install")) installed = true;
        return "";
      },
    });
    await expect(planUpgrade(runtime)).rejects.toMatchObject({
      code: "UPGRADE_PROVENANCE_UNSUPPORTED",
    });
    expect(installed).toBe(false);
  });

  it("rejects ambiguous ownership before mutation", async () => {
    const { runtime, calls } = fixture({
      voltaExecutable: "/volta/bin/volta",
      run: async (file, args) => {
        calls.push([file, [...args]]);
        if (args[1] === "root") return "/toolchain/lib/node_modules\n";
        if (args[1] === "prefix") return "/toolchain\n";
        if (args.join(" ") === "which ast-tool") return `${cli}\n`;
        if (args.join(" ") === "which node") return `${node}\n`;
        throw new Error("unexpected");
      },
    });
    await expect(planUpgrade(runtime)).rejects.toMatchObject({
      code: "UPGRADE_PROVENANCE_UNSUPPORTED",
    });
    expect(calls.every((call) => !call[1].includes("install"))).toBe(true);
  });
});
