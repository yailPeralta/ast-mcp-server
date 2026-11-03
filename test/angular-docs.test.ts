import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(repositoryRoot, "skills", "structural-code-editing");

const [readme, skill, operations] = await Promise.all([
  readFile(path.join(repositoryRoot, "README.md"), "utf8"),
  readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
  readFile(path.join(skillRoot, "references", "operations.md"), "utf8"),
]);
const skillDocs = `${skill}\n${operations}`;

describe("Angular template documentation", () => {
  it("skill documents ast_explore TS-only limit and compiler optional peer", () => {
    expect(skillDocs).toMatch(/ast_explore[^\n]*TypeScript-only/i);
    expect(skillDocs).toMatch(/follow-up issue/i);
    expect(skillDocs).toContain("@angular/compiler");
    expect(skillDocs).toMatch(/optional peer/i);
    expect(skillDocs).toMatch(/Yarn PnP/);
  });

  it("skill documents template usages, rename blocking and TS-only diagnostics", () => {
    expect(skillDocs).toContain("template_coverage");
    expect(skillDocs).toContain("template_external");
    expect(skillDocs).toMatch(/INCOMPLETE_EVIDENCE/);
    expect(skillDocs).toMatch(/MUTATION_BLOCKED/);
    expect(skillDocs).toMatch(/diagnostics[^\n]*TypeScript-only/i);
  });

  it("README documents the supported range and install guidance for the compiler peer", () => {
    expect(readme).toContain("@angular/compiler");
    expect(readme).toContain(">=20.0.0 <23.0.0");
    expect(readme).toMatch(/optional peer/i);
    expect(readme).toMatch(/Yarn PnP/);
    expect(readme).toMatch(/not bundled|never bundled|does not bundle/i);
  });
});
