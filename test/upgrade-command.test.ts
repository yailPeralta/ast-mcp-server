import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runUpgradeCommand,
  runUpgradeLease,
  UpgradeCommandError,
} from "../src/services/upgrade-command.js";
import { reconcileUpgrade, ReconciliationError } from "../src/services/upgrade-reconcile.js";
import { UpgradeCleanupError } from "../src/services/upgrade-runtime.js";
import { UpgradeError } from "../src/services/upgrade.js";
import type { UpgradeRuntime } from "../src/services/upgrade.js";

const pkg = "/prefix/lib/node_modules/ast-mcp-server";
const cli = `${pkg}/dist/cli.js`;
const node = "/node/bin/node";
const npmCli = "/node/lib/node_modules/npm/bin/npm-cli.js";

function fixture(): UpgradeRuntime {
  let version = "0.10.0";
  return {
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
    latestVersion: async () => "0.11.0",
    run: async (_file, args) => {
      if (args[1] === "root") return "/prefix/lib/node_modules\n";
      if (args[1] === "prefix") return "/prefix\n";
      if (args[1] === "install") {
        version = "0.11.0";
        return "";
      }
      throw new Error("unexpected");
    },
  };
}

describe("upgrade command", () => {
  it("accepts bare upgrade and --check, and rejects --yes and unknown flags", async () => {
    const reconcile = vi.fn(async () => undefined);
    await expect(runUpgradeCommand(["--check"], fixture(), reconcile)).resolves.toMatchObject({
      status: "ok",
      update_available: true,
    });
    await expect(runUpgradeCommand([], fixture(), reconcile)).resolves.toMatchObject({
      status: "updated",
      reconciliation: "completed",
    });
    for (const args of [["--yes"], ["--unknown"], ["--check", "extra"]]) {
      await expect(runUpgradeCommand(args, fixture(), reconcile)).rejects.toBeInstanceOf(
        UpgradeCommandError,
      );
    }
  });

  it("reexecs the updated CLI without exposing execution coordinates", async () => {
    const reconcile = vi.fn(async () => undefined);
    const result = await runUpgradeCommand([], fixture(), reconcile);
    expect(reconcile).toHaveBeenCalledWith(cli);
    expect(result).toMatchObject({ status: "updated", reconciliation: "completed" });
    expect(result).not.toHaveProperty("new_cli");
  });

  it("reports package-updated/reconciliation-required without overwriting custom skill", async () => {
    const reconcile = vi.fn(async () => {
      throw new ReconciliationError("AGENT_SKILL_CONFLICT");
    });
    await expect(runUpgradeCommand([], fixture(), reconcile)).resolves.toMatchObject({
      status: "partial",
      package_status: "updated",
      reconciliation: "required",
      continuation: "ast-tool setup --agents all --yes --force-skill",
      restart_required: true,
    });
  });

  it("reexecs a Windows-shaped CLI through the bound Node", async () => {
    const execute = vi.fn(async () => ({ stdout: '{"status":"ok"}', stderr: "" }));
    const windowsCli = "C:\\prefix\\node_modules\\ast-mcp-server\\dist\\cli.js";
    const windowsNode = "C:\\nodejs\\node.exe";
    await reconcileUpgrade(windowsCli, {
      nodeExecutable: windowsNode,
      environment: { PATH: "C:\\hostile" },
      execute,
    });
    expect(execute).toHaveBeenCalledWith(
      windowsNode,
      [windowsCli, "setup", "--agents", "all", "--yes"],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("fails check success and failure when cleanup cannot be proven", async () => {
    const successDispose = vi.fn(async () => {
      throw new Error("private path");
    });
    await expect(
      runUpgradeLease(["--check"], { runtime: fixture(), dispose: successDispose }, vi.fn()),
    ).rejects.toMatchObject({ code: "UPGRADE_CLEANUP_FAILED" });
    const failing = fixture();
    failing.latestVersion = async () => {
      throw new Error("registry exception");
    };
    const failureDispose = vi.fn(async () => {
      throw new Error("private token");
    });
    const error = await runUpgradeLease(
      ["--check"],
      { runtime: failing, dispose: failureDispose },
      vi.fn(),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "UPGRADE_CLEANUP_FAILED",
      primaryCode: "UPGRADE_INSPECTION_FAILED",
    });
    expect(successDispose).toHaveBeenCalledOnce();
    expect(failureDispose).toHaveBeenCalledOnce();
  });

  it("preserves package and reconciliation partial state on cleanup failure", async () => {
    const dispose = vi.fn(async () => {
      throw new Error("cleanup");
    });
    await expect(
      runUpgradeLease([], { runtime: fixture(), dispose }, vi.fn()),
    ).resolves.toMatchObject({
      status: "partial",
      package_status: "updated",
      cleanup: "required",
      cleanup_code: "UPGRADE_CLEANUP_FAILED",
      continuation: "ast-tool upgrade --check",
      restart_required: true,
    });
    const conflict = vi.fn(async () => {
      throw new ReconciliationError("AGENT_SKILL_CONFLICT");
    });
    await expect(
      runUpgradeLease([], { runtime: fixture(), dispose }, conflict),
    ).resolves.toMatchObject({
      status: "partial",
      cleanup: "required",
      continuation: "ast-tool setup --agents all --yes --force-skill",
    });
  });

  it("preserves install and parser failures across cleanup exceptions", async () => {
    const failing = fixture();
    failing.run = async (_file, args) => {
      if (args[1] === "root") return "/prefix/lib/node_modules\n";
      if (args[1] === "prefix") return "/prefix\n";
      throw new Error("install failed");
    };
    const dispose = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    for (const [args, runtime, code] of [
      [[], failing, "UPGRADE_VERIFICATION_FAILED"],
      [["--yes"], fixture(), "UPGRADE_USAGE"],
    ] as const) {
      const error = await runUpgradeLease(args, { runtime, dispose }, vi.fn()).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(UpgradeCleanupError);
      expect(error).toMatchObject({ primaryCode: code });
      expect(JSON.stringify(error)).not.toMatch(/install failed|cleanup failed|\/prefix/);
    }
    await expect(
      runUpgradeLease([], { runtime: failing, dispose: async () => undefined }, vi.fn()),
    ).rejects.toBeInstanceOf(UpgradeError);
  });
});
