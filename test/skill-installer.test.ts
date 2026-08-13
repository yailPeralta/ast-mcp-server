import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installBundledSkill as installBundledSkillFromSource,
  type InstallBundledSkillOptions,
} from "../src/services/skill-installer.js";

const temporaryDirectories: string[] = [];
const sourceSkillPath = path.resolve(
  process.cwd(),
  "skills",
  "structural-code-editing",
  "SKILL.md",
);

function installBundledSkill(options: Omit<InstallBundledSkillOptions, "sourceSkillPath">) {
  return installBundledSkillFromSource({ ...options, sourceSkillPath });
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ast-tool-skill-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("skill installer", () => {
  it("installs the bundled skill for Claude Code and Hermes at user scope", async () => {
    const root = await temporaryDirectory();
    const claudeRoot = path.join(root, "claude");
    const hermesRoot = path.join(root, "hermes");

    const result = await installBundledSkill({
      target: "all",
      scope: "user",
      environment: {
        CLAUDE_CONFIG_DIR: claudeRoot,
        HERMES_HOME: hermesRoot,
      },
      homeDirectory: root,
    });

    expect(result).toMatchObject({
      version: 1,
      status: "ok",
      skill: "structural-code-editing",
      installations: [
        { target: "claude", scope: "user", status: "installed" },
        { target: "hermes", scope: "user", status: "installed" },
      ],
    });

    for (const installation of result.installations) {
      const content = await readFile(installation.path, "utf8");
      expect(content).toContain("name: structural-code-editing");
      expect(path.isAbsolute(installation.path)).toBe(true);
    }
  });

  it("is idempotent when the installed content is already current", async () => {
    const root = await temporaryDirectory();
    const options = {
      target: "claude" as const,
      scope: "user" as const,
      environment: { CLAUDE_CONFIG_DIR: path.join(root, "claude") },
      homeDirectory: root,
    };

    await installBundledSkill(options);
    const replay = await installBundledSkill(options);

    expect(replay.installations).toHaveLength(1);
    expect(replay.installations[0]?.status).toBe("unchanged");
  });

  it("preflights every target before writing when an existing skill conflicts", async () => {
    const root = await temporaryDirectory();
    const claudeRoot = path.join(root, "claude");
    const hermesRoot = path.join(root, "hermes");
    const hermesSkill = path.join(
      hermesRoot,
      "skills",
      "software-development",
      "structural-code-editing",
      "SKILL.md",
    );
    await mkdir(path.dirname(hermesSkill), { recursive: true });
    await writeFile(hermesSkill, "locally customized\n");

    await expect(
      installBundledSkill({
        target: "all",
        scope: "user",
        environment: {
          CLAUDE_CONFIG_DIR: claudeRoot,
          HERMES_HOME: hermesRoot,
        },
        homeDirectory: root,
      }),
    ).rejects.toThrow(/already exists.*--force/i);

    const claudeSkill = path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md");
    await expect(access(claudeSkill)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(hermesSkill, "utf8")).toBe("locally customized\n");
  });

  it("updates conflicting content only when force is explicit", async () => {
    const root = await temporaryDirectory();
    const claudeRoot = path.join(root, "claude");
    const skillPath = path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "stale\n");

    const result = await installBundledSkill({
      target: "claude",
      scope: "user",
      force: true,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });

    expect(result.installations[0]?.status).toBe("updated");
    expect(await readFile(skillPath, "utf8")).toContain("name: structural-code-editing");
  });

  it("supports project-scoped Claude Code skills and rejects that scope for Hermes", async () => {
    const root = await temporaryDirectory();
    const projectRoot = path.join(root, "project");
    await mkdir(projectRoot);

    const result = await installBundledSkill({
      target: "claude",
      scope: "project",
      projectRoot,
      homeDirectory: root,
    });

    expect(result.installations).toEqual([
      {
        target: "claude",
        scope: "project",
        status: "installed",
        path: path.join(projectRoot, ".claude", "skills", "structural-code-editing", "SKILL.md"),
      },
    ]);

    await expect(
      installBundledSkill({
        target: "hermes",
        scope: "project",
        projectRoot,
        homeDirectory: root,
      }),
    ).rejects.toThrow(/project scope.*Claude Code/i);
  });

  it("writes the shared agents destination once and reports four logical outcomes", async () => {
    const root = await temporaryDirectory();
    const result = await installBundledSkill({
      target: ["opencode", "codex", "gemini", "copilot"],
      scope: "user",
      homeDirectory: root,
    });

    expect(result.physicalWrites).toHaveLength(1);
    expect(result.installations.map((item) => item.target)).toEqual([
      "opencode",
      "codex",
      "gemini",
      "copilot",
    ]);
    expect(new Set(result.installations.map((item) => item.path)).size).toBe(1);
    expect(result.installations.every((item) => item.status === "installed")).toBe(true);
  });

  it("deduplicates aliases by nearest-existing-ancestor realpath and fails on races", async () => {
    const root = await temporaryDirectory();
    const realHome = path.join(root, "real-home");
    const aliasHome = path.join(root, "alias-home");
    await mkdir(realHome);
    await symlink(realHome, aliasHome, "dir");

    const result = await installBundledSkill({
      target: ["codex", "gemini"],
      scope: "user",
      homeDirectory: aliasHome,
    });
    expect(result.physicalWrites).toHaveLength(1);
    expect(result.installations[0]?.path).toBe(result.installations[1]?.path);
  });
});
