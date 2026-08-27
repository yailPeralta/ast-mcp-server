import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validateManagedSkillBundle } from "../scripts/managed-skill-bundle-validator.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(repositoryRoot, "skills", "structural-code-editing");
const [packagedSkill, packagedGuidance, packagedReleases] = await Promise.all([
  readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
  readFile(path.join(skillRoot, "guidance.md"), "utf8"),
  readFile(path.join(skillRoot, "releases.json"), "utf8"),
]);

function currentBundle() {
  return {
    packagedSkill,
    packagedGuidance,
    packagedReleases,
    copiedSkills: [packagedSkill, packagedSkill],
  };
}

describe("managed skill bundle validation", () => {
  it("accepts the exact current bundled contract and installed copies", () => {
    expect(validateManagedSkillBundle(currentBundle())).toEqual({ version: "4.6.0" });
  });

  it("rejects a stale release-manifest version independently", () => {
    const manifest = JSON.parse(packagedReleases);
    manifest.current.version = "4.4.0";

    expect(() =>
      validateManagedSkillBundle({
        ...currentBundle(),
        packagedReleases: `${JSON.stringify(manifest)}\n`,
      }),
    ).toThrow("release-manifest version does not match the bundled skill version");
  });

  it("rejects changed installed skill bytes independently", () => {
    expect(() =>
      validateManagedSkillBundle({
        ...currentBundle(),
        copiedSkills: [packagedSkill, `${packagedSkill}\nchanged`],
      }),
    ).toThrow("installed skill copy does not match the bundled skill bytes");
  });

  it("rejects an embedded managed guidance marker independently", () => {
    expect(() =>
      validateManagedSkillBundle({
        ...currentBundle(),
        packagedGuidance: `${packagedGuidance}\n<!-- ast-tool:structural-code-editing guidance v1 begin -->`,
      }),
    ).toThrow("bundled guidance contains its managed embedding marker");
  });
});
