import path from "node:path";
import { describe, expect, it } from "vitest";
import { performUpgrade, type UpgradeRuntime } from "../src/services/upgrade.js";

const pkg = "/toolchain/lib/node_modules/ast-mcp-server";
const cli = `${pkg}/dist/cli.js`;
const node = "/toolchain/bin/node";
const npmCli = "/toolchain/lib/node_modules/npm/bin/npm-cli.js";

function fixture(options: { current?: string; latest?: string[] } = {}) {
  let version = options.current ?? "0.10.0";
  const latest = [...(options.latest ?? ["0.11.0", "0.11.0"])];
  const calls: Array<[string, string[]]> = [];
  const runtime: UpgradeRuntime = {
    packageRoot: pkg,
    cliExecutable: cli,
    nodeExecutable: node,
    npmCliExecutable: npmCli,
    platform: "linux",
    realpath: async (value) => path.posix.normalize(value),
    directDirectory: async () => true,
    readPackage: async () => ({
      name: "ast-mcp-server",
      version,
      bin: { "ast-tool": "dist/cli.js", "ast-mcp-server": "dist/index.js" },
    }),
    latestVersion: async () => latest.shift() ?? version,
    run: async (file, args) => {
      calls.push([file, [...args]]);
      if (args[1] === "root") return "/toolchain/lib/node_modules\n";
      if (args[1] === "prefix") return "/toolchain\n";
      if (args[1] === "install") {
        version = latest[0] ?? "0.11.0";
        return "";
      }
      throw new Error("unexpected");
    },
  };
  return { runtime, calls };
}

describe("upgrade execution", () => {
  it("installs latest by running npm-cli.js through the bound Node", async () => {
    const { runtime, calls } = fixture();
    await expect(performUpgrade(runtime)).resolves.toMatchObject({
      status: "updated",
      installed_version: "0.11.0",
      restart_required: true,
    });
    expect(calls.find((call) => call[1][1] === "install")).toEqual([
      node,
      [npmCli, "install", "--global", "ast-mcp-server@latest", "--ignore-scripts"],
    ]);
  });

  it("refreshes latest after install and accepts a latest-tag race", async () => {
    await expect(
      performUpgrade(fixture({ latest: ["0.11.0", "0.12.0"] }).runtime),
    ).resolves.toMatchObject({ installed_version: "0.12.0", latest_version: "0.12.0" });
  });

  it("does not reinstall an already current package", async () => {
    const { runtime, calls } = fixture({ current: "0.11.0", latest: ["0.11.0"] });
    await expect(performUpgrade(runtime)).resolves.toMatchObject({
      status: "current",
      restart_required: false,
    });
    expect(calls.every((call) => !call[1].includes("install"))).toBe(true);
  });
});
