import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(repositoryRoot, "skills", "structural-code-editing");

const [readme, skill, operations, changelog] = await Promise.all([
  readFile(path.join(repositoryRoot, "README.md"), "utf8"),
  readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
  readFile(path.join(skillRoot, "references", "operations.md"), "utf8"),
  readFile(path.join(repositoryRoot, "CHANGELOG.md"), "utf8"),
]);
const skillDocs = `${skill}\n${operations}`;

// The Angular template feature shipped in the 0.15.0 section (moved out of Unreleased when the
// candidate was cut), so read that section rather than the now-empty Unreleased block.
function releaseSection(version: string): string {
  const start = changelog.indexOf(`## [${version}]`);
  if (start === -1) throw new Error(`CHANGELOG has no ## [${version}] section`);
  const end = changelog.indexOf("\n## [", start + 1);
  return changelog.slice(start, end === -1 ? undefined : end);
}

describe("Angular template documentation", () => {
  it("skill documents ast_explore TS-only limit and compiler optional peer", () => {
    expect(skillDocs).toMatch(/ast_explore[^\n]*TypeScript-only/i);
    expect(skillDocs).toMatch(/issue #380/);
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

  describe.each([
    ["SKILL.md", skill],
    ["references/operations.md", operations],
  ])("%s documents consumer template usages (#408)", (_name, document) => {
    it("lists consumer template usages and limits completed to the Project", () => {
      expect(document).toMatch(/consumer templates?/i);
      expect(document).toMatch(/`completed`[^\n]*inside the Project/);
      expect(document).toMatch(/outside the Project/);
    });

    it("names the constructs that stay unfinished", () => {
      expect(document).toContain("setInput");
      expect(document).toMatch(/router input binding/i);
      expect(document).toContain("createComponent");
      expect(document).toContain("hostDirectives");
      expect(document).toMatch(/`@Directive` inputs and outputs/);
    });

    it("states the pipe class and transform rename rules", () => {
      expect(document).toMatch(/`@Pipe` class[^\n]*TypeScript edits only/);
      expect(document).toMatch(/`transform`[^\n]*INCOMPLETE_EVIDENCE/);
    });

    it("keeps diagnostics TypeScript-only and links the template type-check follow-up", () => {
      expect(document).toMatch(/diagnostics[^\n]*TypeScript-only/i);
      expect(document).toMatch(/template type checking[^\n]*#421/i);
    });
  });

  it("README documents consumer usages and the template type-check follow-up", () => {
    expect(readme).toMatch(/consumer templates?/i);
    expect(readme).toMatch(/`completed`[^\n]*inside the Project/);
    expect(readme).toMatch(/`@Pipe` class[^\n]*TypeScript edits only/);
    expect(readme).toContain("#421");
  });

  it("README documents the supported range and install guidance for the compiler peer", () => {
    expect(readme).toContain("@angular/compiler");
    expect(readme).toContain(">=18.0.0 <23.0.0");
    expect(readme).toMatch(/optional peer/i);
    expect(readme).toMatch(/Yarn PnP/);
    expect(readme).toMatch(/not bundled|never bundled|does not bundle/i);
  });

  it("CHANGELOG records the feature and the updated tool descriptions", () => {
    const unreleased = releaseSection("0.15.0");
    expect(unreleased).toContain("Angular");
    expect(unreleased).toContain("ast_find_references");
    expect(unreleased).toContain("ast_rename_symbol");
    expect(unreleased).toMatch(/description/i);
    expect(unreleased).toMatch(/TypeScript-only/i);
    expect(unreleased).not.toContain("Deferred tool description text");
    expect(unreleased).toMatch(/dsh-adapter smoke now declares/i);
  });
});
