import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyExactHostToolError,
  createH03CleanupEvidence,
  parseProbeMarker,
  requireExactIdentity,
  runBoundedCommand,
  runOrderedCleanup,
  terminateProcessTree,
} from "../scripts/runtime-process.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("exact-host evidence guards", () => {
  it("blocks exact adapter and Node executable drift", () => {
    const expected = { adapterSha256: "adapter-pinned", nodeSha256: "node-pinned" };
    expect(requireExactIdentity(expected, expected)).toEqual(expected);
    for (const field of Object.keys(expected)) {
      expect(() => requireExactIdentity({ ...expected, [field]: "drift" }, expected)).toThrow(
        new RegExp(`BLOCKED.*${field}`, "i"),
      );
    }
  });

  it("classifies early revision drift as BLOCKED while final cleanup remains armed", () => {
    const expected = { hostRevision: "c".repeat(40) };
    let blocked: unknown;
    try {
      requireExactIdentity({ hostRevision: "d".repeat(40) }, expected);
    } catch (error) {
      blocked = error;
    } finally {
      expect(createH03CleanupEvidence(undefined)).toBeUndefined();
    }
    expect(blocked).toMatchObject({ message: expect.stringMatching(/BLOCKED.*hostRevision/i) });
  });

  it("accepts only exact bounded AST-owned error envelopes", () => {
    const operational = (code: string, name = "Error", message = "bounded") => ({
      isError: true,
      error: {
        info: { name },
        message: JSON.stringify({
          error: {
            code,
            message,
            correlation_id: "123e4567-e89b-42d3-a456-426614174000",
          },
        }),
      },
    });
    const codes = ["OPERATION_DEADLINE_EXCEEDED", "QUEUE_WAIT_TIMEOUT", "REQUEST_CANCELLED"];
    expect(codes.map((code) => classifyExactHostToolError(operational(code)).code)).toEqual(codes);
    expect(classifyExactHostToolError(operational(codes[0]!))).toMatchObject({
      correlationId: "123e4567-e89b-42d3-a456-426614174000",
      message: "bounded",
    });
    expect(() => classifyExactHostToolError({ ...operational(codes[0]!), isError: false })).toThrow(
      /isError/i,
    );
    expect(() =>
      classifyExactHostToolError(operational(codes[0]!, "Error", "x".repeat(4097))),
    ).toThrow(/bounded/i);
    const extra = operational(codes[0]!);
    extra.error.message = extra.error.message.replace(
      '"message":"bounded"',
      '"message":"bounded","extra":1',
    );
    expect(() => classifyExactHostToolError(extra)).toThrow(/keys/i);
    expect(() =>
      classifyExactHostToolError(operational("TOOL_TIMEOUT", "ToolTimeoutError")),
    ).toThrow(/generic Harness timeout/i);
    expect(() =>
      classifyExactHostToolError(operational("REQUEST_CANCELLED", "AbortError")),
    ).toThrow(/unrelated AbortError/i);
  });
});

describe("bounded subprocess runtime", () => {
  // prettier-ignore
  it("cleans owners serially and continues after a sanitized rejection", async () => {
    const order: string[] = [], token = "web-secret-token", owners = ["page", "context", "browser", "Web process tree", "mock", "owner-zero", "residue"] as const;
    const step = (name: string, fails = false) => async () => { order.push(`${name}:start`); await Promise.resolve(); order.push(`${name}:end`); if (fails) throw new Error(`http://127.0.0.1/?token=${token}`); }, steps = (failures = new Set<string>()) => owners.map((name) => [name, step(name, failures.has(name))] as const), cleanup = runOrderedCleanup("GUI owner cleanup", steps(new Set(["page", "owner-zero"])));
    await expect(cleanup).rejects.toThrow("page: http://127.0.0.1/; owner-zero: http://127.0.0.1/"); await expect(cleanup).rejects.not.toThrow(token);
    expect(order).toEqual(owners.flatMap((name) => [`${name}:start`, `${name}:end`])); order.length = 0; await runOrderedCleanup("GUI owner cleanup", steps()); expect(order).toEqual(owners.flatMap((name) => [`${name}:start`, `${name}:end`]));
  });

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
    "terminates a successful command's surviving grandchild before resolving",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ast-process-success-"));
      roots.push(root);
      const pidFile = path.join(root, "grandchild.pid");
      const source = `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: ["ignore", process.stdout, process.stderr],
        });
        child.unref();
        fs.writeFileSync(process.argv[1], String(child.pid));
      `;

      await expect(
        runBoundedCommand(process.execPath, ["-e", source, pidFile], { timeout: 2_000 }),
      ).resolves.toEqual({
        stdout: "",
        stderr: "",
      });
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
