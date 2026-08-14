import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedFileApplyError, ManagedFileRollbackError } from "../src/services/managed-file.js";
import { applyManagedGuidancePlan, planManagedGuidance } from "../src/services/managed-guidance.js";

const directories: string[] = [];
const guidance =
  "Load structural-code-editing before compiler-semantic TypeScript work.\nUse ordinary file tools for trivial text edits.\n";

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "managed-guidance-"));
  directories.push(directory);
  return directory;
}

async function sourceGuidance(root: string): Promise<string> {
  const file = path.join(root, "guidance.md");
  await writeFile(file, guidance);
  return file;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("managed structural editing guidance", () => {
  it("appends one owned block while preserving human bytes, BOM, CRLF, and mode", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const claudeRoot = path.join(root, "claude");
    const destination = path.join(claudeRoot, "CLAUDE.md");
    const human = Buffer.from("\uFEFF# Human rules\r\nKeep this byte-for-byte.\r\n", "utf8");
    await mkdir(claudeRoot, { recursive: true });
    await writeFile(destination, human);
    await chmod(destination, 0o640);

    const plan = await planManagedGuidance({
      agents: ["claude"],
      sourceGuidancePath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });
    await applyManagedGuidancePlan(plan);

    const installed = await readFile(destination);
    expect(installed.subarray(0, human.length)).toEqual(human);
    expect(installed.toString("utf8")).toContain(
      "<!-- ast-tool:structural-code-editing guidance v1 begin -->\r\n",
    );
    expect(installed.toString("utf8")).toContain(
      "<!-- ast-tool:structural-code-editing guidance v1 end -->",
    );
    expect((await stat(destination)).mode & 0o777).toBe(0o640);

    const replay = await planManagedGuidance({
      agents: ["claude"],
      sourceGuidancePath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });
    expect(replay.installations[0]?.status).toBe("unchanged");
    expect(replay.files).toHaveLength(1);
    expect(replay.files[0]?.status).toBe("unchanged");
  });

  it("updates only one valid owned block and rejects malformed or unknown markers", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const claudeRoot = path.join(root, "claude");
    const destination = path.join(claudeRoot, "CLAUDE.md");
    await mkdir(claudeRoot, { recursive: true });
    const humanPrefix = "human before\n";
    const humanSuffix = "\nhuman after\n";
    await writeFile(
      destination,
      `${humanPrefix}<!-- ast-tool:structural-code-editing guidance v1 begin -->\nstale\n<!-- ast-tool:structural-code-editing guidance v1 end -->${humanSuffix}`,
    );

    const plan = await planManagedGuidance({
      agents: ["claude"],
      sourceGuidancePath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });
    await applyManagedGuidancePlan(plan);
    const updated = await readFile(destination, "utf8");
    expect(updated.startsWith(humanPrefix)).toBe(true);
    expect(updated.endsWith(humanSuffix)).toBe(true);
    expect(updated).toContain("Load structural-code-editing");
    expect(updated).not.toContain("stale");

    await writeFile(
      destination,
      "human\n<!-- ast-tool:structural-code-editing guidance v2 begin -->\nunknown\n",
    );
    await expect(
      planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      }),
    ).rejects.toThrow(/marker/i);
  });

  it.each([
    [
      "duplicate blocks",
      "<!-- ast-tool:structural-code-editing guidance v1 begin -->\none\n<!-- ast-tool:structural-code-editing guidance v1 end -->\n<!-- ast-tool:structural-code-editing guidance v1 begin -->\ntwo\n<!-- ast-tool:structural-code-editing guidance v1 end -->\n",
    ],
    ["begin only", "<!-- ast-tool:structural-code-editing guidance v1 begin -->\n"],
    ["end only", "<!-- ast-tool:structural-code-editing guidance v1 end -->\n"],
    [
      "reversed markers",
      "<!-- ast-tool:structural-code-editing guidance v1 end -->\n<!-- ast-tool:structural-code-editing guidance v1 begin -->\n",
    ],
    [
      "nested markers",
      "<!-- ast-tool:structural-code-editing guidance v1 begin -->\n<!-- ast-tool:structural-code-editing guidance v1 begin -->\n<!-- ast-tool:structural-code-editing guidance v1 end -->\n<!-- ast-tool:structural-code-editing guidance v1 end -->\n",
    ],
    [
      "unknown marker version",
      "<!-- ast-tool:structural-code-editing guidance v2 begin -->\nunknown\n<!-- ast-tool:structural-code-editing guidance v2 end -->\n",
    ],
  ])("rejects %s without changing destination bytes", async (_label, content) => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const claudeRoot = path.join(root, "claude");
    const destination = path.join(claudeRoot, "CLAUDE.md");
    await mkdir(claudeRoot, { recursive: true });
    await writeFile(destination, content);

    await expect(
      planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      }),
    ).rejects.toThrow(/marker/i);
    expect(await readFile(destination, "utf8")).toBe(content);
  });

  it("rejects invalid UTF-8, NUL bytes, and non-regular destinations", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    for (const [name, content] of [
      ["invalid-utf8", Buffer.from([0xc3, 0x28])],
      ["nul", Buffer.from("human\0rules", "utf8")],
    ] as const) {
      const claudeRoot = path.join(root, name);
      await mkdir(claudeRoot, { recursive: true });
      await writeFile(path.join(claudeRoot, "CLAUDE.md"), content);
      await expect(
        planManagedGuidance({
          agents: ["claude"],
          sourceGuidancePath,
          environment: { CLAUDE_CONFIG_DIR: claudeRoot },
          homeDirectory: root,
        }),
      ).rejects.toThrow(/UTF-8|NUL/i);
    }

    const directoryRoot = path.join(root, "directory-target");
    await mkdir(path.join(directoryRoot, "CLAUDE.md"), { recursive: true });
    await expect(
      planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        environment: { CLAUDE_CONFIG_DIR: directoryRoot },
        homeDirectory: root,
      }),
    ).rejects.toThrow(/regular file/i);
  });

  it("routes Claude and OpenCode to one effective fallback when both select it", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const fallback = path.join(root, ".claude", "CLAUDE.md");
    await mkdir(path.dirname(fallback), { recursive: true });
    await writeFile(fallback, "shared human rules\n");

    const plan = await planManagedGuidance({
      agents: ["claude", "opencode"],
      sourceGuidancePath,
      homeDirectory: root,
      environment: {},
    });

    expect(plan.files).toHaveLength(1);
    expect(plan.installations.map((item) => item.path)).toEqual([fallback, fallback]);
    await applyManagedGuidancePlan(plan);
    expect(await readFile(fallback, "utf8")).toContain("shared human rules");
    await expect(lstat(path.join(root, ".config", "opencode", "AGENTS.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("seeds OpenCode native rules from the active Claude fallback when OpenCode is selected alone", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const fallback = path.join(root, ".claude", "CLAUDE.md");
    const native = path.join(root, ".config", "opencode", "AGENTS.md");
    await mkdir(path.dirname(fallback), { recursive: true });
    await writeFile(fallback, "fallback human rules\n");

    const plan = await planManagedGuidance({
      agents: ["opencode"],
      sourceGuidancePath,
      homeDirectory: root,
      environment: {},
    });
    expect(plan.installations[0]?.path).toBe(native);
    await applyManagedGuidancePlan(plan);
    const installed = await readFile(native, "utf8");
    expect(installed.startsWith("fallback human rules\n")).toBe(true);
    expect(installed).toContain("Load structural-code-editing");
  });

  it("honors OpenCode config roots, Codex override precedence, and Gemini custom filename", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const codexHome = path.join(root, "codex");
    const override = path.join(codexHome, "AGENTS.override.md");
    const geminiHome = path.join(root, ".gemini");
    await mkdir(codexHome, { recursive: true });
    await writeFile(override, "override rules\n");
    await mkdir(geminiHome, { recursive: true });
    await writeFile(
      path.join(geminiHome, "settings.json"),
      JSON.stringify({ context: { fileName: ["GLOBAL.md"] } }),
    );

    const plan = await planManagedGuidance({
      agents: ["opencode", "codex", "gemini"],
      sourceGuidancePath,
      homeDirectory: root,
      workingDirectory: root,
      environment: {
        OPENCODE_CONFIG: "custom/opencode.json",
        CODEX_HOME: codexHome,
      },
    });

    expect(plan.installations.map((item) => item.path)).toEqual([
      path.join(root, "custom", "AGENTS.md"),
      override,
      path.join(geminiHome, "GLOBAL.md"),
    ]);
  });

  it("resolves relative Claude and OpenCode roots plus default and empty-override Codex paths", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const codexRoot = path.join(root, "codex");
    await mkdir(codexRoot, { recursive: true });
    await writeFile(path.join(codexRoot, "AGENTS.override.md"), "");

    const plan = await planManagedGuidance({
      agents: ["claude", "opencode", "codex"],
      sourceGuidancePath,
      homeDirectory: root,
      workingDirectory: root,
      environment: {
        CLAUDE_CONFIG_DIR: "relative-claude",
        OPENCODE_CONFIG_DIR: "relative-opencode",
        CODEX_HOME: codexRoot,
      },
    });

    expect(plan.installations.map((item) => item.path)).toEqual([
      path.join(root, "relative-claude", "CLAUDE.md"),
      path.join(root, "relative-opencode", "AGENTS.md"),
      path.join(codexRoot, "AGENTS.md"),
    ]);
  });

  it.each([
    ["malformed JSON", "{"],
    ["multiple filenames", JSON.stringify({ context: { fileName: ["ONE.md", "TWO.md"] } })],
    ["traversal", JSON.stringify({ context: { fileName: "../GLOBAL.md" } })],
    ["absolute path", JSON.stringify({ context: { fileName: "/tmp/GLOBAL.md" } })],
    ["unsupported context", JSON.stringify({ context: "GEMINI.md" })],
  ])("fails closed for Gemini %s", async (_label, settings) => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const geminiRoot = path.join(root, ".gemini");
    await mkdir(geminiRoot, { recursive: true });
    await writeFile(path.join(geminiRoot, "settings.json"), settings);

    await expect(
      planManagedGuidance({
        agents: ["gemini"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: {},
      }),
    ).rejects.toThrow(/Gemini/i);
  });

  it("reports Hermes and Copilot as skill_only without physical guidance paths", async () => {
    const root = await temporaryDirectory();
    const plan = await planManagedGuidance({
      agents: ["hermes", "copilot"],
      sourceGuidancePath: await sourceGuidance(root),
      homeDirectory: root,
      environment: {},
    });

    expect(plan.installations).toEqual([
      { agent: "hermes", status: "skill_only" },
      { agent: "copilot", status: "skill_only" },
    ]);
    expect(plan.files).toEqual([]);
  });

  it("fails closed for ambiguous Gemini routing and final symlinks", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const geminiHome = path.join(root, ".gemini");
    await mkdir(geminiHome, { recursive: true });
    await writeFile(
      path.join(geminiHome, "settings.json"),
      JSON.stringify({ context: { fileName: ["ONE.md", "TWO.md"] } }),
    );
    await expect(
      planManagedGuidance({
        agents: ["gemini"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: {},
      }),
    ).rejects.toThrow(/Gemini.*fileName|ambiguous/i);

    const claudeRoot = path.join(root, "claude");
    const target = path.join(root, "human.md");
    await mkdir(claudeRoot, { recursive: true });
    await writeFile(target, "human\n");
    await symlink(target, path.join(claudeRoot, "CLAUDE.md"));
    await expect(
      planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      }),
    ).rejects.toThrow(/regular file/i);
  });

  it("stops on a post-preflight race without replacing concurrent content", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const claudeRoot = path.join(root, "claude");
    const destination = path.join(claudeRoot, "CLAUDE.md");
    await mkdir(claudeRoot, { recursive: true });
    await writeFile(destination, "before\n");
    const plan = await planManagedGuidance({
      agents: ["claude"],
      sourceGuidancePath,
      homeDirectory: root,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
    });
    await writeFile(destination, "concurrent\n");

    await expect(applyManagedGuidancePlan(plan)).rejects.toThrow(/changed after preflight/i);
    expect(await readFile(destination, "utf8")).toBe("concurrent\n");
  });

  it("rejects an identical-byte destination inode substituted after preflight", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const claudeRoot = path.join(root, "claude");
    const destination = path.join(claudeRoot, "CLAUDE.md");
    const replacement = path.join(claudeRoot, ".replacement");
    await mkdir(claudeRoot, { recursive: true });
    await writeFile(destination, "before\n");
    const plan = await planManagedGuidance({
      agents: ["claude"],
      sourceGuidancePath,
      homeDirectory: root,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
    });
    await writeFile(replacement, "before\n");
    await rename(replacement, destination);

    await expect(applyManagedGuidancePlan(plan)).rejects.toThrow(/changed after preflight/i);
    expect(await readFile(destination, "utf8")).toBe("before\n");
  });

  it.runIf(process.platform === "linux")(
    "rejects parent substitution instead of writing through a post-preflight symlink",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const parkedRoot = path.join(root, "claude-parked");
      const attackerRoot = path.join(root, "attacker");
      await mkdir(claudeRoot);
      await mkdir(attackerRoot);

      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });
      await rename(claudeRoot, parkedRoot);
      await symlink(attackerRoot, claudeRoot, "dir");

      await expect(applyManagedGuidancePlan(plan)).rejects.toThrow(
        /changed after preflight|directory|parent/i,
      );
      await expect(access(path.join(attackerRoot, "CLAUDE.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(access(path.join(parkedRoot, "CLAUDE.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it.runIf(process.platform === "linux")(
    "rejects parent substitution before atomic replacement",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const parkedRoot = path.join(root, "claude-parked");
      const attackerRoot = path.join(root, "attacker");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      const parkedDestination = path.join(parkedRoot, "CLAUDE.md");
      const attackerDestination = path.join(attackerRoot, "CLAUDE.md");
      await mkdir(claudeRoot);
      await mkdir(attackerRoot);
      await writeFile(destination, "human policy\n");
      await writeFile(attackerDestination, "attacker policy\n");

      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });
      await rename(claudeRoot, parkedRoot);
      await symlink(attackerRoot, claudeRoot, "dir");

      await expect(applyManagedGuidancePlan(plan)).rejects.toThrow(
        /changed after preflight|directory|parent/i,
      );
      expect(await readFile(attackerDestination, "utf8")).toBe("attacker policy\n");
      expect(await readFile(parkedDestination, "utf8")).toBe("human policy\n");
    },
  );

  it.runIf(process.platform === "linux")(
    "rejects a previously missing parent that appears outside the apply context",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });
      await mkdir(claudeRoot);

      await expect(applyManagedGuidancePlan(plan)).rejects.toThrow(/parent.*preflight/i);
      await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("reports physical partial completion and converges on retry after a later-file race", async () => {
    const root = await temporaryDirectory();
    const sourceGuidancePath = await sourceGuidance(root);
    const claudeRoot = path.join(root, "claude");
    const codexRoot = path.join(root, "codex");
    const claudePath = path.join(claudeRoot, "CLAUDE.md");
    const codexPath = path.join(codexRoot, "AGENTS.md");
    await mkdir(claudeRoot, { recursive: true });
    await mkdir(codexRoot, { recursive: true });
    await writeFile(claudePath, "claude human\n");
    await writeFile(codexPath, "codex human\n");
    const options = {
      agents: ["claude", "codex"] as const,
      sourceGuidancePath,
      homeDirectory: root,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot, CODEX_HOME: codexRoot },
    };
    const plan = await planManagedGuidance(options);
    const completed: string[] = [];

    await expect(
      applyManagedGuidancePlan(plan, async (file) => {
        completed.push(file.path);
        if (file.path === claudePath) await writeFile(codexPath, "concurrent codex human\n");
      }),
    ).rejects.toThrow(/changed after preflight/i);
    expect(completed).toEqual([claudePath]);
    expect(await readFile(claudePath, "utf8")).toContain("guidance v1 begin");
    expect(await readFile(codexPath, "utf8")).toBe("concurrent codex human\n");

    const retry = await planManagedGuidance(options);
    expect(retry.installations.map((item) => item.status)).toEqual(["unchanged", "updated"]);
    await applyManagedGuidancePlan(retry);
    expect(await readFile(codexPath, "utf8")).toContain("concurrent codex human");
    expect(await readFile(codexPath, "utf8")).toContain("guidance v1 begin");
  });

  it.runIf(process.platform === "linux")(
    "atomically rolls back a destination substituted after final revalidation",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      const replacement = path.join(claudeRoot, ".replacement");
      await mkdir(claudeRoot);
      await writeFile(destination, "before\n");
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });
      let replacementIdentity: string | undefined;
      let rejection: unknown;

      try {
        await applyManagedGuidancePlan(plan, undefined, undefined, {
          afterDestinationRevalidated: async () => {
            await writeFile(replacement, "before\n");
            await rename(replacement, destination);
            const info = await lstat(destination);
            replacementIdentity = `${info.dev}:${info.ino}`;
          },
        });
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(ManagedFileRollbackError);
      expect(rejection).toMatchObject({ rollbackState: "succeeded" });
      const finalIdentity = await lstat(destination);
      expect(`${finalIdentity.dev}:${finalIdentity.ino}`).toBe(replacementIdentity);
      expect(await readFile(destination, "utf8")).toBe("before\n");
    },
  );

  it.runIf(process.platform === "linux")(
    "rolls back a same-inode content edit made after final revalidation",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      await mkdir(claudeRoot);
      await writeFile(destination, "before\n");
      const before = await lstat(destination);
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });

      await expect(
        applyManagedGuidancePlan(plan, undefined, undefined, {
          afterDestinationRevalidated: async () => {
            await writeFile(destination, "concurrent human policy\n");
          },
        }),
      ).rejects.toMatchObject({ rollbackState: "succeeded" });

      const after = await lstat(destination);
      expect(`${after.dev}:${after.ino}`).toBe(`${before.dev}:${before.ino}`);
      expect(await readFile(destination, "utf8")).toBe("concurrent human policy\n");
    },
  );

  it.runIf(process.platform === "linux")(
    "rolls back a same-inode mode edit made after final revalidation",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      await mkdir(claudeRoot);
      await writeFile(destination, "before\n");
      await chmod(destination, 0o640);
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });

      await expect(
        applyManagedGuidancePlan(plan, undefined, undefined, {
          afterDestinationRevalidated: async () => {
            await chmod(destination, 0o600);
          },
        }),
      ).rejects.toMatchObject({ rollbackState: "succeeded" });

      expect(await readFile(destination, "utf8")).toBe("before\n");
      expect((await lstat(destination)).mode & 0o777).toBe(0o600);
    },
  );

  it.runIf(process.platform === "linux")(
    "rolls back a same-inode preimage edit made immediately before cleanup",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      await mkdir(claudeRoot);
      await writeFile(destination, "before\n");
      const identityBefore = await lstat(destination, { bigint: true });
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });

      await expect(
        applyManagedGuidancePlan(plan, undefined, undefined, {
          beforeCleanup: async ({ temporaryPath }) => {
            await writeFile(temporaryPath, "concurrent cleanup edit\n");
          },
        }),
      ).rejects.toMatchObject({
        rollbackState: "succeeded",
      });

      expect(await readFile(destination, "utf8")).toBe("concurrent cleanup edit\n");
      const identityAfter = await lstat(destination, { bigint: true });
      expect(identityAfter.dev).toBe(identityBefore.dev);
      expect(identityAfter.ino).toBe(identityBefore.ino);
    },
  );

  it.runIf(process.platform === "linux")(
    "rejects a destination created after final no-clobber revalidation",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });

      await expect(
        applyManagedGuidancePlan(plan, undefined, undefined, {
          afterDestinationRevalidated: async () => {
            await writeFile(destination, "external\n");
          },
        }),
      ).rejects.toThrow(/appeared concurrently|failed/i);

      expect(await readFile(destination, "utf8")).toBe("external\n");
    },
  );

  it.runIf(process.platform === "linux")(
    "reports a failed exact-pair rollback as possibly committed",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      const replacement = path.join(claudeRoot, ".replacement");
      await mkdir(claudeRoot);
      await writeFile(destination, "before\n");
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });
      let rejection: unknown;

      try {
        await applyManagedGuidancePlan(plan, undefined, undefined, {
          afterDestinationRevalidated: async () => {
            await writeFile(replacement, "before\n");
            await rename(replacement, destination);
          },
          beforeRollback: () => {
            throw new Error("injected rollback failure");
          },
        });
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(ManagedFileApplyError);
      expect(rejection).toMatchObject({
        commitState: "possibly_committed",
        rollbackState: "failed",
      });
      expect(await readFile(destination, "utf8")).toContain("guidance v1 begin");
    },
  );

  it.runIf(process.platform === "linux")(
    "does not exchange a rollback pair that changed before rollback",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      const replacement = path.join(claudeRoot, ".replacement");
      const parkedPreimage = path.join(claudeRoot, ".parked-preimage");
      await mkdir(claudeRoot);
      await writeFile(destination, "before\n");
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });
      let changedTemporary: string | undefined;

      await expect(
        applyManagedGuidancePlan(plan, undefined, undefined, {
          afterDestinationRevalidated: async () => {
            await writeFile(replacement, "before\n");
            await rename(replacement, destination);
          },
          beforeRollback: async ({ temporaryPath }) => {
            changedTemporary = path.join(claudeRoot, path.basename(temporaryPath));
            await rename(temporaryPath, parkedPreimage);
            await writeFile(temporaryPath, "rollback interloper\n");
          },
        }),
      ).rejects.toMatchObject({
        commitState: "possibly_committed",
        rollbackState: "failed",
      });

      expect(await readFile(destination, "utf8")).toContain("guidance v1 begin");
      expect(await readFile(parkedPreimage, "utf8")).toBe("before\n");
      expect(await readFile(changedTemporary!, "utf8")).toBe("rollback interloper\n");
    },
  );

  it.runIf(process.platform === "linux")(
    "publishes the held temporary inode instead of a same-byte substituted pathname",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      const parked = path.join(root, "parked-original");
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });
      let originalIdentity: string | undefined;
      let substitutedIdentity: string | undefined;
      let rejection: unknown;

      try {
        await applyManagedGuidancePlan(plan, undefined, undefined, {
          afterTemporaryReady: async ({ temporaryPath }) => {
            const original = await lstat(temporaryPath);
            originalIdentity = `${original.dev}:${original.ino}`;
            await rename(temporaryPath, parked);
            await writeFile(temporaryPath, plan.files[0]!.postimage);
            await chmod(temporaryPath, 0o644);
            const substituted = await lstat(temporaryPath);
            substitutedIdentity = `${substituted.dev}:${substituted.ino}`;
          },
        });
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(ManagedFileApplyError);
      expect(rejection).toMatchObject({ commitState: "committed" });
      const installed = await lstat(destination);
      expect(`${installed.dev}:${installed.ino}`).toBe(originalIdentity);
      expect(`${installed.dev}:${installed.ino}`).not.toBe(substitutedIdentity);
      expect(await readFile(destination)).toEqual(plan.files[0]!.postimage);
    },
  );

  it.runIf(process.platform === "linux")(
    "never follows a symlink substituted for the held temporary inode",
    async () => {
      const root = await temporaryDirectory();
      const sourceGuidancePath = await sourceGuidance(root);
      const claudeRoot = path.join(root, "claude");
      const destination = path.join(claudeRoot, "CLAUDE.md");
      const parked = path.join(root, "parked-original");
      const victim = path.join(root, "victim");
      await writeFile(victim, "victim\n");
      const plan = await planManagedGuidance({
        agents: ["claude"],
        sourceGuidancePath,
        homeDirectory: root,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      });
      let originalIdentity: string | undefined;
      let rejection: unknown;

      try {
        await applyManagedGuidancePlan(plan, undefined, undefined, {
          afterTemporaryReady: async ({ temporaryPath }) => {
            const original = await lstat(temporaryPath);
            originalIdentity = `${original.dev}:${original.ino}`;
            await rename(temporaryPath, parked);
            await symlink(victim, temporaryPath);
          },
        });
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(ManagedFileApplyError);
      expect(rejection).toMatchObject({ commitState: "committed" });
      const installed = await lstat(destination);
      expect(`${installed.dev}:${installed.ino}`).toBe(originalIdentity);
      expect(await readFile(destination)).toEqual(plan.files[0]!.postimage);
      expect(await readFile(victim, "utf8")).toBe("victim\n");
    },
  );
});
