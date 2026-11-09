import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(repositoryRoot, "skills", "structural-code-editing");

const [readme, skill, operations, changelog, adr, spike] = await Promise.all([
  readFile(path.join(repositoryRoot, "README.md"), "utf8"),
  readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
  readFile(path.join(skillRoot, "references", "operations.md"), "utf8"),
  readFile(path.join(repositoryRoot, "CHANGELOG.md"), "utf8"),
  readFile(path.join(repositoryRoot, "docs", "adr", "0017-template-type-check-worker.md"), "utf8"),
  readFile(path.join(repositoryRoot, "docs", "spikes", "0421-template-type-check.md"), "utf8"),
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

    it("keeps diagnostics TypeScript-only and documents template_diagnostics (#421)", () => {
      expect(document).toMatch(/diagnostics[^\n]*TypeScript-only/i);
      expect(document).toContain("template_diagnostics");
      expect(document).toContain("block_on_template_errors");
      expect(document).toContain("compiler_cli_missing");
      expect(document).toMatch(/best-effort/i);
    });

    it("directs users to the project build or tests when the check is not completed", () => {
      expect(document).toMatch(/`unavailable`[^\n]*`unfinished`|`unfinished`[^\n]*`unavailable`/);
      expect(document).toMatch(/(?:build|tests)[^\n]*(?:build|tests)/i);
      expect(document).toMatch(/run the project's[^\n]*build or tests/i);
    });

    it("states the file base, the plan schema v3 rule and the compiler-cli requirement", () => {
      expect(document).toMatch(/relative to the (?:directory of the )?tsconfig/i);
      expect(document).toMatch(/schema v3|plan schema version 3/i);
      expect(document).toMatch(/@angular\/compiler-cli[^\n]*(?:resolve|peer)/i);
    });
  });

  it("README documents consumer usages and the template type check", () => {
    expect(readme).toMatch(/consumer templates?/i);
    expect(readme).toMatch(/`completed`[^\n]*inside the Project/);
    expect(readme).toMatch(/`@Pipe` class[^\n]*TypeScript edits only/);
    expect(readme).toContain("template_diagnostics");
    expect(readme).not.toMatch(/template errors are not detected/i);
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

  it("CHANGELOG Unreleased records the template type check (#421)", () => {
    const start = changelog.indexOf("## [Unreleased]");
    const end = changelog.indexOf("\n## [", start + 1);
    const unreleased = changelog.slice(start, end === -1 ? undefined : end);
    expect(unreleased).toContain("template_diagnostics");
    expect(unreleased).toContain("block_on_template_errors");
    expect(unreleased).toContain("@angular/compiler-cli");
    expect(unreleased).toMatch(/schema v3|schema version 3/i);
    expect(unreleased).toContain("#421");
  });

  it("ADR 0017 records the process model, the public API rule, the hash rule and rollback", () => {
    expect(adr).toMatch(/^# ADR 0017/m);
    expect(adr).toMatch(/one-shot/i);
    expect(adr).toMatch(/worker threads/i);
    expect(adr).toMatch(/warm pool/i);
    expect(adr).toContain("ADR 0014");
    expect(adr).toMatch(/public API/i);
    expect(adr).toMatch(/writeFile/);
    expect(adr).toMatch(/version 2[^\n]*version 3|v2[^\n]*v3/i);
    expect(adr).toMatch(/rejected on import/i);
    expect(adr).toMatch(/relative to the (?:directory of the )?tsconfig/i);
    expect(adr).toContain("compiler_cli_missing");
  });

  it("spike doc links the ADR and records the final verdict", () => {
    expect(spike).toContain("0017-template-type-check-worker.md");
    expect(spike).toMatch(/final verdict/i);
  });
});
