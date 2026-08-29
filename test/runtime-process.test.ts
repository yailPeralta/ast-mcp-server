import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseProbeMarker,
  runBoundedCommand,
  terminateProcessTree,
} from "../scripts/runtime-process.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("bounded subprocess runtime", () => {
  it.skipIf(process.platform === "win32")(
    "terminates a timed-out command's process group including grandchildren",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ast-process-tree-"));
      roots.push(root);
      const pidFile = path.join(root, "grandchild.pid");
      const source = `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const pidFile = process.argv[1];
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        fs.writeFileSync(pidFile, String(child.pid));
        setInterval(() => {}, 1000);
      `;

      await expect(
        runBoundedCommand(process.execPath, ["-e", source, pidFile], { timeout: 250 }),
      ).rejects.toThrow(/timed out/i);
      const pid = Number(await readFile(pidFile, "utf8"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(() => process.kill(pid, 0)).toThrow();
    },
  );

  it("rejects malformed probe marker JSON without throwing from the stream callback", () => {
    expect(parseProbeMarker('noise\nDSH_PROBE_RESULT:{"broken":}\n')).toEqual({
      status: "invalid",
      detail: expect.stringContaining("invalid JSON"),
    });
    expect(parseProbeMarker('DSH_PROBE_RESULT:{"ok":true}\n')).toEqual({
      status: "found",
      value: { ok: true },
    });
  });

  it.skipIf(process.platform === "win32")(
    "terminates surviving group members after the process-group leader exits",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ast-process-leader-"));
      roots.push(root);
      const pidFile = path.join(root, "grandchild.pid");
      const leader = spawn(
        process.execPath,
        [
          "-e",
          'const {spawn}=require("node:child_process"); const fs=require("node:fs"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); child.unref(); fs.writeFileSync(process.argv[1],String(child.pid));',
          pidFile,
        ],
        { detached: true, stdio: "ignore" },
      );
      await new Promise((resolve) => leader.once("exit", resolve));

      await terminateProcessTree(leader);

      const pid = Number(await readFile(pidFile, "utf8"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(() => process.kill(pid, 0)).toThrow();
    },
  );

  it.skipIf(process.platform === "win32")(
    "terminates a nonzero command's surviving grandchild before rejecting with evidence",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ast-process-nonzero-"));
      roots.push(root);
      const pidFile = path.join(root, "grandchild.pid");
      const source = `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const pidFile = process.argv[1];
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        child.unref();
        fs.writeFileSync(pidFile, String(child.pid));
        console.log("captured stdout");
        console.error("captured stderr");
        process.exit(7);
      `;

      let rejection: unknown;
      try {
        await runBoundedCommand(process.execPath, ["-e", source, pidFile]);
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toMatchObject({
        message: expect.stringContaining("exited with 7"),
        stdout: expect.stringContaining("captured stdout"),
        stderr: expect.stringContaining("captured stderr"),
      });
      const pid = Number(await readFile(pidFile, "utf8"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(() => process.kill(pid, 0)).toThrow();
    },
  );
});
