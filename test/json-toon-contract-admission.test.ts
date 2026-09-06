import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

type ContractModule = {
  CONTRACT_MANIFEST: {
    tools: Array<{ name: string; cases: Array<{ id: string }> }>;
    checks: string[];
    normalizedKeys: string[];
  };
  validateManifest: (manifest: unknown) => void;
};

const EXPECTED_TOOLS = [
  "ast_search_symbols",
  "ast_find_references",
  "ast_get_impact",
  "ast_get_diagnostics",
];
const EXPECTED_CHECKS = [
  "sequential-json-then-toon",
  "identical-semantic-input",
  "json-canonical-schema",
  "empty-content",
  "toon-exact-envelope",
  "lossless-normalized-equality",
  "stable-canonical-bytes",
  "stable-sha256",
  "schema-eligibility",
  "unsupported-omission",
  "timeout",
  "process-cleanup",
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function loadContract(): Promise<ContractModule> {
  const command = (packageJson.scripts as Record<string, string>)["test:mcp-formats"];
  if (command !== "yarn build && node scripts/json-toon-contract.mjs") {
    throw new Error("F01 admission: package command is absent or incomplete");
  }
  return import(
    pathToFileURL(new URL("../scripts/json-toon-contract.mjs", import.meta.url).pathname).href
  );
}

describe("F-01 JSON/TOON contract admission", () => {
  it("admits exactly four tools, eight cases, and every required check", async () => {
    const { CONTRACT_MANIFEST: manifest, validateManifest } = await loadContract();
    expect(() => validateManifest(manifest)).not.toThrow();
    expect(manifest.tools.map(({ name }) => name)).toEqual(EXPECTED_TOOLS);
    expect(manifest.tools.flatMap(({ cases }) => cases)).toHaveLength(8);
    expect(manifest.checks).toEqual(EXPECTED_CHECKS);
    expect(manifest.normalizedKeys).toEqual(["duration_ms", "checked_at"]);
  });

  it("rejects missing, duplicate, and extra tools or cases", async () => {
    const { CONTRACT_MANIFEST: manifest, validateManifest } = await loadContract();
    const variants = [
      { ...clone(manifest), tools: clone(manifest.tools).slice(1) },
      { ...clone(manifest), tools: [...clone(manifest.tools), clone(manifest.tools[0]!)] },
      {
        ...clone(manifest),
        tools: [...clone(manifest.tools), { name: "ast_list_files", cases: [] }],
      },
      {
        ...clone(manifest),
        tools: clone(manifest.tools).map((tool, index) =>
          index ? tool : { ...tool, cases: tool.cases.slice(1) },
        ),
      },
      {
        ...clone(manifest),
        tools: clone(manifest.tools).map((tool, index) =>
          index ? tool : { ...tool, cases: [tool.cases[0]!, tool.cases[0]!] },
        ),
      },
      {
        ...clone(manifest),
        tools: clone(manifest.tools).map((tool, index) =>
          index ? tool : { ...tool, cases: [...tool.cases, { id: "extra-case" }] },
        ),
      },
    ];
    for (const variant of variants)
      expect(() => validateManifest(variant)).toThrow(/^F01 admission:/);
  });

  it("rejects missing or extra checks and normalization drift", async () => {
    const { CONTRACT_MANIFEST: manifest, validateManifest } = await loadContract();
    for (const variant of [
      { ...clone(manifest), checks: manifest.checks.slice(1) },
      { ...clone(manifest), checks: [...manifest.checks, "shortcut"] },
      { ...clone(manifest), checks: [...manifest.checks.slice(0, -1), manifest.checks[0]!] },
      { ...clone(manifest), normalizedKeys: ["duration_ms"] },
      { ...clone(manifest), normalizedKeys: [...manifest.normalizedKeys, "total"] },
    ]) {
      expect(() => validateManifest(variant)).toThrow(/^F01 admission:/);
    }
  });
});
