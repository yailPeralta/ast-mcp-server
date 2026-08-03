import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensurePrivateDirectory, withWorkspaceFileLock } from "../src/services/runtime-state.js";

describe("runtime state", () => {
  it("fails closed when another process-equivalent writer owns the workspace lock", async () => {
    const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "ast-tool-lock-"));
    let signalLocked!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const owner = withWorkspaceFileLock(
      "/workspace/tsconfig.json",
      { stateDirectory },
      async () => {
        signalLocked();
        await released;
      },
    );
    await locked;

    await expect(
      withWorkspaceFileLock("/workspace/tsconfig.json", { stateDirectory }, async () => undefined),
    ).rejects.toThrow(/workspace lock/i);

    release();
    await owner;
    await expect(
      withWorkspaceFileLock("/workspace/tsconfig.json", { stateDirectory }, async () => "ok"),
    ).resolves.toBe("ok");
  });

  it.runIf(process.platform !== "win32")(
    "rejects runtime state directories reached through a symbolic link",
    async () => {
      const parent = await mkdtemp(path.join(os.tmpdir(), "ast-tool-state-"));
      const target = path.join(parent, "target");
      const linked = path.join(parent, "linked");
      await mkdir(target);
      await symlink(target, linked, "dir");

      await expect(ensurePrivateDirectory(linked)).rejects.toThrow(/symbolic links/i);
    },
  );
});
