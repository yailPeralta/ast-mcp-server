import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySkillInstallationPlan,
  installBundledSkill as installBundledSkillFromSource,
  planBundledSkillInstallation,
  resolveBundledSkillAssets,
  type InstallBundledSkillOptions,
} from "../src/services/skill-installer.js";

const temporaryDirectories: string[] = [];
const sourceSkillPath = path.resolve(
  process.cwd(),
  "skills",
  "structural-code-editing",
  "SKILL.md",
);
const bundledSkillRoot = path.dirname(sourceSkillPath);

const publishedSkillFixtures = [
  {
    npmVersion: "0.10.0",
    skillVersion: "4.4.0",
    sha256: "253b588c56d44c8f5565db3f33ce227d80c7c29aa6604d362844f44b1278385a",
  },
  {
    npmVersion: "0.11.0",
    skillVersion: "4.5.0",
    sha256: "be757e8bd98733c7ee952d63a2805dcd9877becf651b4fcb6ab63d20f6546f21",
  },
  {
    npmVersion: "0.11.1",
    skillVersion: "4.5.0",
    sha256: "2729b30ff6b7344e6680c7ee02ab540bc6db9774ad7111f091cd356f8cc9d4ce",
  },
  {
    npmVersion: "0.11.2",
    skillVersion: "4.5.0",
    sha256: "18132b4b747d135e4ccfbca9e2190a9afb41e144cc06c31c5e6bc0f1571e11da",
  },
  {
    npmVersion: "0.12.0",
    skillVersion: "4.6.0",
    sha256: "d0048ffd9a585d00791540c6fa5e0bec91ff95b1448479678f85702e6b09be8a",
  },
] as const;

async function publishedSkill(npmVersion: string): Promise<string> {
  const fixture = await readFile(
    new URL(`fixtures/structural-code-editing-${npmVersion}.md.gz.base64`, import.meta.url),
    "utf8",
  );
  return gunzipSync(Buffer.from(fixture, "base64")).toString("utf8");
}

function officialOptions(root: string) {
  return {
    target: "claude" as const,
    scope: "user" as const,
    environment: { CLAUDE_CONFIG_DIR: path.join(root, "claude") },
    homeDirectory: root,
  };
}

function installBundledSkill(options: Omit<InstallBundledSkillOptions, "sourceSkillPath">) {
  return installBundledSkillFromSource({ ...options, sourceSkillPath });
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function writeReleaseFixture(
  root: string,
  options: { source: string; predecessors?: Array<{ content: string; version: string }> },
) {
  const assets = path.join(root, "skills", "structural-code-editing");
  await mkdir(assets, { recursive: true });
  const sourcePath = path.join(assets, "SKILL.md");
  const guidancePath = path.join(assets, "guidance.md");
  const manifestPath = path.join(assets, "releases.json");
  await writeFile(sourcePath, options.source);
  await writeFile(guidancePath, "Load structural-code-editing when compiler semantics matter.\n");
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      schema_version: 2,
      algorithm: "sha256",
      current: {
        version: "9.0.0",
        files: [{ path: "SKILL.md", sha256: sha256(options.source) }],
      },
      predecessors: (options.predecessors ?? []).map((item, index) => ({
        version: item.version,
        sha256: sha256(item.content),
        npm_versions: [`0.${index + 1}.0`],
      })),
    })}\n`,
  );
  return { sourcePath, guidancePath, manifestPath };
}

async function writeBundleFixture(root: string) {
  const assets = await writeReleaseFixture(root, {
    source: "current\n",
    predecessors: [{ content: "predecessor\n", version: "8.0.0" }],
  });
  const reference = path.join(path.dirname(assets.sourcePath), "references", "runtime.md");
  await mkdir(path.dirname(reference), { recursive: true });
  await writeFile(reference, "runtime\n");
  const manifest = JSON.parse(await readFile(assets.manifestPath, "utf8"));
  manifest.current.files.push({ path: "references/runtime.md", sha256: sha256("runtime\n") });
  await writeFile(assets.manifestPath, JSON.stringify(manifest));
  return assets;
}

function bundleOptions(root: string, assets: Awaited<ReturnType<typeof writeReleaseFixture>>) {
  const claudeRoot = path.join(root, "claude");
  return {
    target: "claude" as const,
    scope: "user" as const,
    sourceSkillPath: assets.sourcePath,
    releaseManifestPath: assets.manifestPath,
    environment: { CLAUDE_CONFIG_DIR: claudeRoot },
    homeDirectory: root,
  };
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
  it("installs and updates a complete manifested skill bundle", async () => {
    const root = await temporaryDirectory();
    const assets = await writeBundleFixture(root);
    const claudeRoot = path.join(root, "claude");
    const skillRoot = path.join(claudeRoot, "skills", "structural-code-editing");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, "SKILL.md"), "predecessor\n");
    const options = bundleOptions(root, assets);
    const result = await installBundledSkillFromSource(options);

    expect(result.installations[0]?.status).toBe("updated");
    await expect(readFile(path.join(skillRoot, "SKILL.md"), "utf8")).resolves.toBe("current\n");
    await expect(readFile(path.join(skillRoot, "references/runtime.md"), "utf8")).resolves.toBe(
      "runtime\n",
    );
    await expect(installBundledSkillFromSource(options)).resolves.toMatchObject({
      installations: [{ status: "unchanged" }],
      physicalWrites: [],
    });
  });

  it("preserves modified and unowned bundle files without partial writes", async () => {
    const root = await temporaryDirectory();
    const assets = await writeBundleFixture(root);
    const claudeRoot = path.join(root, "claude");
    const skillRoot = path.join(claudeRoot, "skills", "structural-code-editing");
    await mkdir(path.join(skillRoot, "references"), { recursive: true });
    await writeFile(path.join(skillRoot, "SKILL.md"), "predecessor\n");
    await writeFile(path.join(skillRoot, "references/runtime.md"), "user owned\n");

    await expect(installBundledSkillFromSource(bundleOptions(root, assets))).rejects.toThrow(
      /already exists.*--force/i,
    );
    await expect(readFile(path.join(skillRoot, "SKILL.md"), "utf8")).resolves.toBe("predecessor\n");
    await expect(readFile(path.join(skillRoot, "references/runtime.md"), "utf8")).resolves.toBe(
      "user owned\n",
    );
    const plan = await planBundledSkillInstallation({
      ...bundleOptions(root, assets),
      force: true,
    });
    await expect(
      applySkillInstallationPlan(plan, (file) => {
        if (file.path.endsWith("SKILL.md")) throw new Error("injected failure");
      }),
    ).rejects.toThrow(/injected failure/);
    await expect(readFile(path.join(skillRoot, "SKILL.md"), "utf8")).resolves.toBe("predecessor\n");
    await expect(readFile(path.join(skillRoot, "references/runtime.md"), "utf8")).resolves.toBe(
      "user owned\n",
    );
  });

  it("resolves every packaged structural editing asset from the executable", async () => {
    const root = await temporaryDirectory();
    const executable = path.join(root, "bin", "ast-tool");
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "#!/usr/bin/env node\n");
    await chmod(executable, 0o755);
    const skillRoot = path.join(root, "skills", "structural-code-editing");
    await mkdir(skillRoot, { recursive: true });
    for (const name of ["SKILL.md", "guidance.md", "releases.json"])
      await writeFile(path.join(skillRoot, name), `${name}\n`);

    await expect(resolveBundledSkillAssets(executable)).resolves.toEqual({
      skillPath: path.join(skillRoot, "SKILL.md"),
      guidancePath: path.join(skillRoot, "guidance.md"),
      releasesPath: path.join(skillRoot, "releases.json"),
    });
  });

  it.each(publishedSkillFixtures)(
    "ships and atomically upgrades the published $npmVersion skill to the manifested bundle",
    async ({ npmVersion, skillVersion, sha256: expectedSha256 }) => {
      const root = await temporaryDirectory();
      const manifest = JSON.parse(
        await readFile(path.join(bundledSkillRoot, "releases.json"), "utf8"),
      );
      expect(manifest.current.files.map((file: { path: string }) => file.path).sort()).toEqual([
        "SKILL.md",
        "references/operations.md",
      ]);
      expect(
        await readFile(path.join(bundledSkillRoot, "references/operations.md"), "utf8"),
      ).toMatch(
        /ast_find_test_candidates.*completeness\.proven_empty.*ast_explore\.call_spines.*empty_proven.*total.*has_more.*next_offset/s,
      );
      for (const file of manifest.current.files) {
        expect(sha256(await readFile(path.join(bundledSkillRoot, file.path), "utf8"))).toBe(
          file.sha256,
        );
      }
      const predecessor = await publishedSkill(npmVersion);
      expect(sha256(predecessor)).toBe(expectedSha256);
      expect(manifest.predecessors).toContainEqual({
        version: skillVersion,
        sha256: expectedSha256,
        npm_versions: [npmVersion],
      });
      const options = officialOptions(root);
      const skillRoot = path.join(root, "claude", "skills", "structural-code-editing");
      await mkdir(skillRoot, { recursive: true });
      await writeFile(path.join(skillRoot, "SKILL.md"), predecessor);

      await expect(installBundledSkill(options)).resolves.toMatchObject({
        installations: [{ status: "updated" }],
      });
      for (const file of manifest.current.files) {
        await expect(readFile(path.join(skillRoot, file.path), "utf8")).resolves.toBe(
          await readFile(path.join(bundledSkillRoot, file.path), "utf8"),
        );
      }
      await expect(installBundledSkill(options)).resolves.toMatchObject({
        installations: [{ status: "unchanged" }],
        physicalWrites: [],
      });
    },
  );

  it("preserves the public 0.10.0 skill when a new bundled reference conflicts", async () => {
    const root = await temporaryDirectory();
    const skillRoot = path.join(root, "claude", "skills", "structural-code-editing");
    const reference = path.join(skillRoot, "references", "operations.md");
    const predecessor = await publishedSkill("0.10.0");
    await mkdir(path.dirname(reference), { recursive: true });
    await writeFile(path.join(skillRoot, "SKILL.md"), predecessor);
    await writeFile(reference, "user-owned reference\n");

    await expect(installBundledSkill(officialOptions(root))).rejects.toThrow(
      /already exists.*--force/i,
    );
    await expect(readFile(path.join(skillRoot, "SKILL.md"), "utf8")).resolves.toBe(predecessor);
    await expect(readFile(reference, "utf8")).resolves.toBe("user-owned reference\n");
  });

  it("updates a registry-proven predecessor without force", async () => {
    const root = await temporaryDirectory();
    const predecessor = "---\nversion: 8.0.0\n---\nofficial predecessor\n";
    const assets = await writeReleaseFixture(root, {
      source: "---\nversion: 9.0.0\n---\ncurrent\n",
      predecessors: [{ content: predecessor, version: "8.0.0" }],
    });
    const claudeRoot = path.join(root, "claude");
    const destination = path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, predecessor);

    const result = await installBundledSkillFromSource({
      target: "claude",
      scope: "user",
      sourceSkillPath: assets.sourcePath,
      releaseManifestPath: assets.manifestPath,
      environment: { CLAUDE_CONFIG_DIR: claudeRoot },
      homeDirectory: root,
    });

    expect(result.installations[0]?.status).toBe("updated");
    expect(await readFile(destination, "utf8")).toContain("version: 9.0.0");
  });

  it("rejects an unknown digest even when frontmatter claims an official version", async () => {
    const root = await temporaryDirectory();
    const assets = await writeReleaseFixture(root, {
      source: "---\nversion: 9.0.0\n---\ncurrent\n",
      predecessors: [{ content: "official bytes\n", version: "4.0.0" }],
    });
    const claudeRoot = path.join(root, "claude");
    const destination = path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md");
    const unknown = "---\nversion: 4.0.0\n---\nlocally changed\n";
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, unknown);

    await expect(
      installBundledSkillFromSource({
        target: "claude",
        scope: "user",
        sourceSkillPath: assets.sourcePath,
        releaseManifestPath: assets.manifestPath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      }),
    ).rejects.toThrow(/already exists.*--force/i);
    expect(await readFile(destination, "utf8")).toBe(unknown);
  });

  it("fails before destination writes when source bytes do not match the manifest", async () => {
    const root = await temporaryDirectory();
    const assets = await writeReleaseFixture(root, { source: "current\n" });
    await writeFile(assets.sourcePath, "tampered\n");
    const claudeRoot = path.join(root, "claude");
    const destination = path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md");

    await expect(
      installBundledSkillFromSource({
        target: "claude",
        scope: "user",
        sourceSkillPath: assets.sourcePath,
        releaseManifestPath: assets.manifestPath,
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      }),
    ).rejects.toThrow(/manifest.*source|source.*digest/i);
    await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed and duplicate bundle paths", async () => {
    const root = await temporaryDirectory();
    const source = "current\n";
    const assets = await writeReleaseFixture(root, { source });
    await writeFile(
      assets.manifestPath,
      JSON.stringify({
        schema_version: 2,
        algorithm: "sha256",
        current: {
          version: "9.0.0",
          files: [
            { path: "SKILL.md", sha256: sha256(source) },
            { path: "SKILL.md", sha256: sha256(source) },
          ],
        },
        predecessors: [],
      }),
    );

    await expect(
      installBundledSkillFromSource({
        target: "claude",
        scope: "user",
        sourceSkillPath: assets.sourcePath,
        releaseManifestPath: assets.manifestPath,
        environment: { CLAUDE_CONFIG_DIR: path.join(root, "claude") },
        homeDirectory: root,
      }),
    ).rejects.toThrow(/duplicate.*path/i);
  });

  it("rejects unsupported digest algorithms and excludes the unknown installed Hermes digest", async () => {
    const root = await temporaryDirectory();
    const assets = await writeReleaseFixture(root, { source: "current\n" });
    const manifest = JSON.parse(await readFile(assets.manifestPath, "utf8"));
    manifest.algorithm = "sha512";
    await writeFile(assets.manifestPath, JSON.stringify(manifest));
    await expect(
      installBundledSkillFromSource({
        target: "claude",
        scope: "user",
        sourceSkillPath: assets.sourcePath,
        releaseManifestPath: assets.manifestPath,
        environment: { CLAUDE_CONFIG_DIR: path.join(root, "claude") },
        homeDirectory: root,
      }),
    ).rejects.toThrow(/manifest.*invalid/i);

    const bundledManifest = JSON.parse(
      await readFile(path.join(path.dirname(sourceSkillPath), "releases.json"), "utf8"),
    );
    expect(JSON.stringify(bundledManifest)).not.toContain(
      "c25ed470e5c504c38a9be75ffa38f4b6c5a4046548b562e6a33ddba9044fa4d2",
    );
  });

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
    await expect(access(path.join(claudeRoot, "CLAUDE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
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

    expect(result.physicalWrites).toHaveLength(2);
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
    expect(result.physicalWrites).toHaveLength(2);
    expect(result.installations[0]?.path).toBe(result.installations[1]?.path);
  });

  it("rejects a final skill symlink instead of following it", async () => {
    const root = await temporaryDirectory();
    const claudeRoot = path.join(root, "claude");
    const destination = path.join(claudeRoot, "skills", "structural-code-editing", "SKILL.md");
    const target = path.join(root, "custom-skill.md");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(target, "custom\n");
    await symlink(target, destination);

    await expect(
      installBundledSkill({
        target: "claude",
        scope: "user",
        environment: { CLAUDE_CONFIG_DIR: claudeRoot },
        homeDirectory: root,
      }),
    ).rejects.toThrow(/regular file/i);
    expect(await readFile(target, "utf8")).toBe("custom\n");
  });
});
