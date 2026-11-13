import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(repositoryRoot, "skills", "structural-code-editing");

const [readme, skill, operations, changelog, adr, spike, latencySpike] = await Promise.all([
  readFile(path.join(repositoryRoot, "README.md"), "utf8"),
  readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
  readFile(path.join(skillRoot, "references", "operations.md"), "utf8"),
  readFile(path.join(repositoryRoot, "CHANGELOG.md"), "utf8"),
  readFile(path.join(repositoryRoot, "docs", "adr", "0017-template-type-check-worker.md"), "utf8"),
  readFile(path.join(repositoryRoot, "docs", "spikes", "0421-template-type-check.md"), "utf8"),
  readFile(path.join(repositoryRoot, "docs", "spikes", "0380-explore-template-latency.md"), "utf8"),
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
  it("skill documents the compiler optional peer", () => {
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

  describe.each([
    ["README.md", readme],
    ["SKILL.md", skill],
    ["references/operations.md", operations],
  ])("%s documents @Directive members in consumer templates (#478)", (_name, document) => {
    it("no longer lists every @Directive member as unfinished", () => {
      expect(document).not.toMatch(/`@Directive` inputs and outputs/);
      expect(document).not.toMatch(/`hostDirectives`, `@Directive` members/);
      expect(document).toMatch(/`@Directive`[^\n]*consumer templates/);
    });

    it("names the three fail-closed cases", () => {
      expect(document).toMatch(/`\*appX`[^\n]*`<ng-template appX>`/);
      expect(document).toMatch(/`cross_component`[^\n]*`hostDirectives`/);
      expect(document).toMatch(/`inherited_member`[^\n]*extends/);
    });

    it("states the rename refusal for a name another directive on the element publishes", () => {
      expect(document).toMatch(/structural uses and derived classes of a directive/);
      expect(document).toMatch(
        /`MUTATION_BLOCKED`[^\n]*also publishes|also publishes[^\n]*`MUTATION_BLOCKED`/,
      );
    });
  });

  describe.each([
    ["README.md", readme],
    ["SKILL.md", skill],
    ["references/operations.md", operations],
  ])("%s documents ast_explore template evidence (#380)", (_name, document) => {
    it("no longer states the TypeScript-only limit", () => {
      expect(document).not.toMatch(/ast_explore[^\n]*TypeScript-only/i);
      expect(document).not.toMatch(/#380/);
    });

    it("names the fields and the shared reference_limit", () => {
      expect(document).toMatch(/`ast_explore`[^\n]*`origin`/);
      expect(document).toMatch(/`ast_explore`[^\n]*`template_coverage`/);
      expect(document).toMatch(/`ast_explore`[^\n]*`template_reference_count`/);
      expect(document).toMatch(/`reference_limit`[^\n]*TypeScript and template items/);
      expect(document).toMatch(/"compiler references"/);
      expect(document).toMatch(/pag(?:e|ing)[^\n]*`ast_find_references`/i);
    });

    it("states the incomplete coverage omission and where the reason code is", () => {
      expect(document).toMatch(/other than `completed`[^\n]*`template_coverage_incomplete`/);
      expect(document).toMatch(/`evidence_complete: false`/);
      expect(document).toMatch(/reason code[^\n]*`template_coverage`/);
      expect(document).toMatch(/`omissions\.details`[^\n]*detail limit/);
    });

    it("keeps impact and test candidates compiler-only", () => {
      expect(document).toMatch(
        /`ast_get_impact`[^\n]*`ast_find_test_candidates`[^\n]*(?:compiler-only|no template)/i,
      );
    });
  });

  // The ast_explore template evidence shipped in the 0.18.0 section (moved out of Unreleased when
  // the candidate was cut).
  it("CHANGELOG 0.18.0 records ast_explore template evidence (#380)", () => {
    const section = releaseSection("0.18.0");
    expect(section).toContain("#380");
    expect(section).toMatch(/`ast_explore`[^\n]*`template_coverage`/);
    expect(section).toContain("template_coverage_incomplete");
    expect(section).toMatch(/`reference_limit`[^\n]*TypeScript and template items/);
    expect(section).toMatch(/descriptions and input schemas (?:are|stay) unchanged/i);
    expect(section).toContain("docs/spikes/0380-explore-template-latency.md");
    expect(section).toMatch(/`structural-code-editing`[^\n]*`4\.9\.0`/);
  });

  it("latency spike doc records the threshold verdict (#380)", () => {
    expect(latencySpike).toMatch(/\*\*Verdict: (?:pass|fail)\.\*\*/);
    expect(latencySpike).toContain("yarn benchmark:explore-templates");
    expect(latencySpike).toMatch(/501 components/);
    expect(latencySpike).toMatch(/2001/);
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

  // The template type check shipped in the 0.17.0 section (moved out of Unreleased when the
  // candidate was cut).
  it("CHANGELOG 0.17.0 records the template type check (#421)", () => {
    const section = releaseSection("0.17.0");
    expect(section).toContain("template_diagnostics");
    expect(section).toContain("block_on_template_errors");
    expect(section).toContain("@angular/compiler-cli");
    expect(section).toMatch(/schema v3|schema version 3/i);
    expect(section).toContain("#421");
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
