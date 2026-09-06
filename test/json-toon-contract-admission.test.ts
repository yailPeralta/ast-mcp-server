import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

type ContractModule = {
  CONTRACT_MANIFEST: {
    tools: Array<{ name: string; cases: Array<{ id: string }> }>;
    checks: string[];
    normalizedKeys: string[];
  };
  BEHAVIORAL_PROBE_IDS: readonly string[];
  runBehavioralProbes: () => Promise<string[]>;
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
const EXPECTED_CASES = {
  ast_search_symbols: ["symbols-unicode-page", "symbols-empty"],
  ast_find_references: ["references-context-page", "references-empty-page"],
  ast_get_impact: ["impact-truncated", "impact-depth-zero"],
  ast_get_diagnostics: ["diagnostics-aggregate-page", "diagnostics-clean-empty"],
};
const EXPECTED_BEHAVIORAL_PROBES = [
  "json-canonical-rejection",
  "json-content-rejection",
  "toon-envelope-rejection",
  "toon-decode-rejection",
  "semantic-equality-rejection",
  "bounded-cleanup-rejection",
  "two-run-evidence-rejection",
];
const SCRIPT_URL = new URL("../scripts/json-toon-contract.mjs", import.meta.url);

function oracleFunction(functionName: string) {
  const source = readFileSync(SCRIPT_URL, "utf8");
  const file = ts.createSourceFile(
    "oracle.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = file.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === functionName,
  );
  return { declaration, file };
}

function oracleCalls(functionName: string, finallyOnly = false): string[] {
  const { declaration, file } = oracleFunction(functionName);
  if (!declaration?.body) return [];
  const root = finallyOnly
    ? declaration.body.statements.find(ts.isTryStatement)?.finallyBlock
    : declaration.body;
  if (!root) return [];
  const printer = ts.createPrinter({ removeComments: true });
  const calls: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node))
      calls.push(printer.printNode(ts.EmitHint.Expression, node, file).replaceAll(/\s+/g, ""));
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
}

function oracleBody(functionName: string): string {
  const { declaration, file } = oracleFunction(functionName);
  if (!declaration?.body) return "";
  return ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Unspecified, declaration.body, file)
    .replaceAll(/\s+/g, "");
}

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
    expect(
      Object.fromEntries(
        manifest.tools.map(({ name, cases }) => [name, cases.map(({ id }) => id)]),
      ),
    ).toEqual(EXPECTED_CASES);
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
      {
        ...clone(manifest),
        tools: clone(manifest.tools).map((tool, index) =>
          index ? tool : { ...tool, cases: [tool.cases[0]!, { id: "equal-cardinality-extra" }] },
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

  it("executes every behavioral fault probe rather than trusting labels", async () => {
    const { BEHAVIORAL_PROBE_IDS, runBehavioralProbes } = await loadContract();
    expect(BEHAVIORAL_PROBE_IDS).toEqual(EXPECTED_BEHAVIORAL_PROBES);
    await expect(runBehavioralProbes()).resolves.toEqual(EXPECTED_BEHAVIORAL_PROBES);
  });

  it("binds labels to executable pair, determinism, and cleanup semantics", () => {
    const run = oracleCalls("runContract");
    const jsonCall = 'client.callTool({name:tool.name,arguments:{...base,output_format:"json"}})';
    const toonCall = 'client.callTool({name:tool.name,arguments:{...base,output_format:"toon"}})';
    expect(run).toEqual(
      expect.arrayContaining([
        jsonCall,
        toonCall,
        "assertJsonContent(json)",
        "exact(toon.content??[],[])",
        "assertCanonical(tool.name,id,json.structuredContent)",
        "assertToonEnvelope(toon.structuredContent)",
        "decodeToon(envelope)",
        "assertCanonical(tool.name,id,decoded)",
        "assertSemanticEquality(jsonBytes,toonBytes)",
      ]),
    );
    expect(run.indexOf(jsonCall)).toBeLessThan(run.indexOf(toonCall));
    const cleanup = oracleCalls("runContract", true);
    expect(cleanup).toContain("cleanupOwned(client,[projectRoot,runtimeRoot],ownedPids)");
    const cleanupBody = oracleBody("cleanupOwned");
    expect(cleanupBody).toContain('withTimeout(client.close(),"cleanup:client-close",timeoutMs)');
    expect(cleanupBody).toContain("ownedPids.some(alive)");
    const twice = oracleCalls("runContractTwice");
    expect(twice.filter((call) => call === "runContract()")).toHaveLength(2);
    expect(twice).toEqual(expect.arrayContaining(["sameEvidence(first,second)"]));
    expect(oracleBody("sameEvidence")).toContain(
      "first.canonical_bytes!==second.canonical_bytes||first.sha256!==second.sha256",
    );
    expect((packageJson.scripts as Record<string, string>)["test:mcp"]).toBe(
      "yarn build && node scripts/mcp-smoke.mjs && yarn test:mcp-formats",
    );
  });
});
