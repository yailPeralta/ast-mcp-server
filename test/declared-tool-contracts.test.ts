import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import {
  RESERVED_TOOL_NAMES,
  compareToolContracts,
  contractFromTool,
  formatContractFailures,
  semanticSchema,
  toolContractSha256,
} from "../scripts/lib/declared-tool-contracts.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const FIXTURE_PATH = path.join(repositoryRoot, "test", "fixtures", "declared-tool-contracts.json");
const SMOKE_PATH = path.join(repositoryRoot, "scripts", "dsh-adapter-smoke.mjs");
const REGISTRY_SMOKE_PATH = path.join(repositoryRoot, "scripts", "registry-consumer-smoke.mjs");
const INVENTORY_PATH = path.join(repositoryRoot, "test", "fixtures", "tool-inventory.json");

async function readFixture(): Promise<{ baseline: string; tools: Record<string, unknown> }> {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
}

// Lifecycle: the fixture declares what the candidate adds over the published baseline, including
// the `block_on_template_errors` input of `ast_rename_symbol` (#421). Remove an entry once
// PUBLIC_BASELINE_VERSION advances to a release containing it. Only description and input schema
// live here; the rename-only `template_diagnostics` output is pinned by the tool inventory digest.
describe("declared tool contracts fixture", () => {
  it("committed fixture baseline equals PUBLIC_BASELINE_VERSION in the smoke source", async () => {
    const source = await readFile(SMOKE_PATH, "utf8");
    const match = /const PUBLIC_BASELINE_VERSION = "([^"]+)"/u.exec(source);
    expect(match?.[1]).toBe("0.13.0");
    const fixture = await readFixture();
    expect(fixture.baseline).toBe(match?.[1]);
    expect(Object.keys(fixture).sort()).toEqual(["baseline", "tools"]);
  });

  it("fixture entries are semanticSchema fixed points", async () => {
    const fixture = await readFixture();
    for (const [name, entry] of Object.entries(fixture.tools)) {
      const { input_schema: schema } = entry as { input_schema: unknown };
      expect(semanticSchema(schema), name).toEqual(schema);
    }
    // Triangulation: a non-normalized schema is not a fixed point, so the check can fail.
    const raw = { type: "object", additionalProperties: false, $schema: "x" };
    expect(semanticSchema(raw)).not.toEqual(raw);
  });
});

describe("semantic normalization and digests", () => {
  it("semanticSchema treats zod 3 and zod 4 variants as equal ($ref vs inline, MAX_SAFE_INTEGER bounds, uuid pattern, additionalProperties false)", () => {
    const zod3 = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $ref: "#/definitions/input",
      definitions: {
        input: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid", pattern: "^[0-9a-f-]+$" },
            count: {
              type: "integer",
              minimum: -Number.MAX_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
            },
          },
          required: ["id"],
          additionalProperties: false,
        },
      },
    };
    const zod4 = {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        count: { type: "integer" },
      },
      required: ["id"],
    };
    expect(semanticSchema(zod3)).toEqual(semanticSchema(zod4));
    expect(semanticSchema(zod3)).toEqual({
      type: "object",
      properties: { id: { type: "string", format: "uuid" }, count: { type: "integer" } },
      required: ["id"],
    });
  });

  it("semanticSchema keeps real constraints and loosened additionalProperties", () => {
    const strict = { type: "object", properties: { n: { type: "integer", maximum: 32 } } };
    const other = { type: "object", properties: { n: { type: "integer", maximum: 64 } } };
    expect(semanticSchema(strict)).not.toEqual(semanticSchema(other));
    expect(semanticSchema({ type: "object", additionalProperties: true })).toEqual({
      type: "object",
      additionalProperties: true,
    });
    expect(semanticSchema({ type: "string", pattern: "^a$" })).toEqual({
      type: "string",
      pattern: "^a$",
    });
  });

  it("contractFromTool returns description and semantic input_schema", () => {
    expect(
      contractFromTool({
        description: "Does a thing.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
      }),
    ).toEqual({ description: "Does a thing.", input_schema: { type: "object", properties: {} } });
  });

  it("digests are sha256 of name, description, semantic parameters and deterministic", () => {
    const tool = {
      description: "Does a thing.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    };
    const digest = toolContractSha256("ast_x", tool);
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(toolContractSha256("ast_x", tool)).toBe(digest);
    // Semantic: serialization-only differences do not change the digest.
    expect(
      toolContractSha256("ast_x", {
        description: "Does a thing.",
        parameters: { type: "object", properties: {} },
      }),
    ).toBe(digest);
    // Name, description and real parameter changes do.
    expect(toolContractSha256("ast_y", tool)).not.toBe(digest);
    expect(toolContractSha256("ast_x", { ...tool, description: "Other." })).not.toBe(digest);
    expect(
      toolContractSha256("ast_x", { ...tool, parameters: { type: "object", required: ["a"] } }),
    ).not.toBe(digest);
  });

  it("RESERVED_TOOL_NAMES lists only ast_explore and is frozen", () => {
    expect([...RESERVED_TOOL_NAMES]).toEqual(["ast_explore"]);
    expect(Object.isFrozen(RESERVED_TOOL_NAMES)).toBe(true);
  });
});

type Surface = { description: string; parameters: Record<string, unknown> };
type Catalog = Record<string, Surface>;

function surface(description: string, extra: Record<string, unknown> = {}): Surface {
  return {
    description,
    parameters: {
      type: "object",
      properties: { project_root: { type: "string" }, ...extra },
      required: ["project_root"],
    },
  };
}

function catalog(): Catalog {
  return {
    ast_explore: surface("Explores."),
    ast_find_symbols: surface("Finds symbols."),
    ast_find_references: surface("Finds references."),
    ast_rename_symbol: surface("Prepares a rename."),
  };
}

function contractOf(tool: Surface): { description: string; input_schema: unknown } {
  return { description: tool.description, input_schema: semanticSchema(tool.parameters) };
}

const BASELINE = "0.13.0";

function compare(
  publicTools: Catalog,
  candidateTools: Catalog,
  tools: Record<string, unknown> = {},
  baseline = BASELINE,
) {
  return compareToolContracts({
    publicTools,
    candidateTools,
    declared: { baseline, tools },
    baselineVersion: BASELINE,
  });
}

describe("compareToolContracts undeclared and declared rules", () => {
  it("identical catalogs pass", () => {
    const result = compare(catalog(), catalog());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("undeclared description drift fails naming tool and description", () => {
    const candidate = catalog();
    candidate.ast_find_symbols = surface("Finds symbols, differently.");
    const result = compare(catalog(), candidate);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { tool: "ast_find_symbols", field: "description", reason: "drift_from_public" },
    ]);
  });

  it("undeclared schema drift fails naming input_schema", () => {
    const candidate = catalog();
    candidate.ast_find_symbols = surface("Finds symbols.", { limit: { type: "integer" } });
    const result = compare(catalog(), candidate);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { tool: "ast_find_symbols", field: "input_schema", reason: "drift_from_public" },
    ]);
  });

  it("matching declaration passes", () => {
    const candidate = catalog();
    candidate.ast_rename_symbol = surface("Prepares a rename, with templates.");
    const result = compare(catalog(), candidate, {
      ast_rename_symbol: contractOf(candidate.ast_rename_symbol),
    });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    // The declaration only excuses its own tool.
    candidate.ast_find_symbols = surface("Finds symbols, differently.");
    expect(
      compare(catalog(), candidate, {
        ast_rename_symbol: contractOf(candidate.ast_rename_symbol),
      }).failures,
    ).toEqual([{ tool: "ast_find_symbols", field: "description", reason: "drift_from_public" }]);
  });

  it("declaration mismatch on description fails", () => {
    const candidate = catalog();
    candidate.ast_rename_symbol = surface("Prepares a rename, with templates.");
    const declared = { ...contractOf(candidate.ast_rename_symbol), description: "Other text." };
    const result = compare(catalog(), candidate, { ast_rename_symbol: declared });
    expect(result.failures).toEqual([
      { tool: "ast_rename_symbol", field: "description", reason: "mismatch_declaration" },
    ]);
  });

  it("declaration mismatch on input_schema fails", () => {
    const candidate = catalog();
    candidate.ast_find_references = surface("Finds references, with templates.");
    const declared = contractOf(
      surface("Finds references, with templates.", { x: { type: "string" } }),
    );
    const result = compare(catalog(), candidate, { ast_find_references: declared });
    expect(result.failures).toEqual([
      { tool: "ast_find_references", field: "input_schema", reason: "mismatch_declaration" },
    ]);
  });

  it("stale declaration fails stale_equals_public", () => {
    const result = compare(catalog(), catalog(), {
      ast_rename_symbol: contractOf(catalog().ast_rename_symbol),
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { tool: "ast_rename_symbol", field: "description", reason: "stale_equals_public" },
    ]);
  });

  it("a declaration that differs from public in only one field is not stale", () => {
    const candidate = catalog();
    candidate.ast_rename_symbol = surface("Prepares a rename.", { x: { type: "string" } });
    const result = compare(catalog(), candidate, {
      ast_rename_symbol: contractOf(candidate.ast_rename_symbol),
    });
    expect(result.failures).toEqual([]);
  });

  it("zod 3 versus zod 4 serialization of the same schema is not drift", () => {
    const publicTools = catalog();
    publicTools.ast_find_symbols.parameters = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { project_root: { type: "string" } },
      required: ["project_root"],
      additionalProperties: false,
    };
    const candidate = catalog();
    candidate.ast_find_symbols.parameters = {
      type: "object",
      properties: { project_root: { type: "string" } },
      required: ["project_root"],
    };
    expect(compare(publicTools, candidate).failures).toEqual([]);
  });
});

describe("compareToolContracts target validation and catalog shape", () => {
  it("declaration for unknown tool fails unknown_tool", () => {
    const result = compare(catalog(), catalog(), {
      ast_nonexistent: { description: "Nope.", input_schema: { type: "object" } },
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { tool: "ast_nonexistent", field: "declaration", reason: "unknown_tool" },
    ]);
  });

  it("declared tool missing from candidate fails", () => {
    const candidate = catalog();
    delete candidate.ast_rename_symbol;
    const result = compare(catalog(), candidate, {
      ast_rename_symbol: { description: "New.", input_schema: { type: "object" } },
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        { tool: "ast_rename_symbol", field: "declaration", reason: "unknown_tool" },
        { tool: "ast_rename_symbol", field: "catalog", reason: "names_differ" },
      ]),
    );
    expect(result.failures).toHaveLength(2);
  });

  it("tool missing from public fails", () => {
    const candidate = catalog();
    candidate.ast_new_tool = surface("Brand new.");
    const result = compare(catalog(), candidate);
    expect(result.failures).toEqual([
      { tool: "ast_new_tool", field: "catalog", reason: "names_differ" },
    ]);
  });

  it("ast_explore declaration fails reserved_tool", () => {
    const result = compare(catalog(), catalog(), {
      ast_explore: { description: "Explores more.", input_schema: { type: "object" } },
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { tool: "ast_explore", field: "declaration", reason: "reserved_tool" },
    ]);
  });

  it("ast_explore skipped in comparison", () => {
    const candidate = catalog();
    candidate.ast_explore = surface("Explores, corrected.", { call_spines: { type: "object" } });
    const result = compare(catalog(), candidate);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("catalog names differing fails names_differ", () => {
    const candidate = catalog();
    delete candidate.ast_find_symbols;
    candidate.ast_other = surface("Other.");
    const result = compare(catalog(), candidate);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        { tool: "ast_find_symbols", field: "catalog", reason: "names_differ" },
        { tool: "ast_other", field: "catalog", reason: "names_differ" },
      ]),
    );
    expect(result.failures).toHaveLength(2);
  });

  it("malformed entry or extra key fails malformed", () => {
    const malformed: Array<[string, unknown]> = [
      ["not an object", "text"],
      ["null", null],
      ["extra key", { description: "A.", input_schema: { type: "object" }, notes: "x" }],
      ["missing input_schema", { description: "A." }],
      ["description not string", { description: 3, input_schema: { type: "object" } }],
      ["input_schema not object", { description: "A.", input_schema: "object" }],
      ["input_schema array", { description: "A.", input_schema: [] }],
    ];
    for (const [label, entry] of malformed) {
      const result = compare(catalog(), catalog(), { ast_rename_symbol: entry });
      expect(result.failures, label).toEqual([
        { tool: "ast_rename_symbol", field: "declaration", reason: "malformed" },
      ]);
    }
    const fixture = (declared: unknown) =>
      compareToolContracts({
        publicTools: catalog(),
        candidateTools: catalog(),
        declared,
        baselineVersion: BASELINE,
      }).failures;
    expect(fixture({ baseline: BASELINE, tools: [], extra: 1 })).toEqual([
      { tool: "*", field: "declaration", reason: "malformed" },
    ]);
    expect(fixture({ baseline: BASELINE })).toEqual([
      { tool: "*", field: "declaration", reason: "malformed" },
    ]);
    const badCatalog = { ...catalog(), ast_find_symbols: { description: 1, parameters: {} } };
    expect(
      compareToolContracts({
        publicTools: catalog(),
        candidateTools: badCatalog,
        declared: { baseline: BASELINE, tools: {} },
        baselineVersion: BASELINE,
      }).failures,
    ).toEqual([{ tool: "ast_find_symbols", field: "catalog", reason: "malformed" }]);
  });

  it("baseline mismatch fails baseline_mismatch", () => {
    const result = compare(catalog(), catalog(), {}, "0.12.0");
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { tool: "*", field: "baseline", reason: "baseline_mismatch" },
    ]);
    const other = compareToolContracts({
      publicTools: catalog(),
      candidateTools: catalog(),
      declared: { baseline: BASELINE, tools: {} },
      baselineVersion: "0.14.0",
    });
    expect(other.failures).toEqual([{ tool: "*", field: "baseline", reason: "baseline_mismatch" }]);
  });

  it("never throws on bad data", () => {
    for (const bad of [undefined, null, 7, "x", [], [1, 2]]) {
      for (const slot of ["publicTools", "candidateTools", "declared"] as const) {
        const input = {
          publicTools: catalog() as unknown,
          candidateTools: catalog() as unknown,
          declared: { baseline: BASELINE, tools: {} } as unknown,
          baselineVersion: BASELINE,
          [slot]: bad,
        };
        const result = compareToolContracts(input);
        expect(result.ok, `${slot}=${JSON.stringify(bad)}`).toBe(false);
        expect(result.failures.length).toBeGreaterThan(0);
      }
    }
    expect(() => compareToolContracts(undefined as never)).not.toThrow();
  });
});

describe("compareToolContracts strictness", () => {
  function withAdditional(value: unknown): Surface {
    const tool = surface("Finds symbols.");
    return { ...tool, parameters: { ...tool.parameters, additionalProperties: value } };
  }

  it("additionalProperties true or {} fails loosened for undeclared and declared tools", () => {
    for (const loosened of [true, {}]) {
      const publicTools = catalog();
      publicTools.ast_find_symbols = withAdditional(loosened);
      const candidate = catalog();
      candidate.ast_find_symbols = withAdditional(loosened);
      expect(compare(publicTools, candidate).failures).toEqual([
        { tool: "ast_find_symbols", field: "additionalProperties", reason: "loosened" },
      ]);
    }
    // A declared tool that matches its description is still held to strictness.
    const candidate = catalog();
    candidate.ast_rename_symbol = {
      description: "Prepares a rename, with templates.",
      parameters: { ...surface("x").parameters, additionalProperties: true },
    };
    const result = compare(catalog(), candidate, {
      ast_rename_symbol: contractOf(candidate.ast_rename_symbol),
    });
    expect(result.failures).toEqual([
      { tool: "ast_rename_symbol", field: "additionalProperties", reason: "loosened" },
    ]);
  });

  it("undefined and false pass", () => {
    for (const strict of [undefined, false]) {
      const candidate = catalog();
      candidate.ast_find_symbols = withAdditional(strict);
      const publicTools = catalog();
      publicTools.ast_find_symbols = withAdditional(strict);
      expect(compare(publicTools, candidate).failures).toEqual([]);
    }
  });

  it("ast_explore exempt", () => {
    const candidate = catalog();
    candidate.ast_explore = withAdditional(true);
    expect(compare(catalog(), candidate).failures).toEqual([]);
  });
});

describe("compareToolContracts ordering, messages and evidence", () => {
  it("failures sorted by tool then field", () => {
    const candidate = catalog();
    candidate.ast_rename_symbol = surface("Renames, differently.", { x: { type: "string" } });
    candidate.ast_find_symbols = surface("Finds, differently.");
    candidate.ast_find_references = {
      ...surface("Finds references."),
      parameters: { ...surface("x").parameters, additionalProperties: true },
    };
    const result = compare(catalog(), candidate, {}, "0.12.0");
    expect(result.failures).toEqual([
      { tool: "*", field: "baseline", reason: "baseline_mismatch" },
      { tool: "ast_find_references", field: "additionalProperties", reason: "loosened" },
      { tool: "ast_find_references", field: "input_schema", reason: "drift_from_public" },
      { tool: "ast_find_symbols", field: "description", reason: "drift_from_public" },
      { tool: "ast_rename_symbol", field: "description", reason: "drift_from_public" },
      { tool: "ast_rename_symbol", field: "input_schema", reason: "drift_from_public" },
    ]);
  });

  it("formatContractFailures renders tool.field: reason joined by '; '", () => {
    expect(
      formatContractFailures([
        { tool: "ast_find_symbols", field: "description", reason: "drift_from_public" },
        { tool: "ast_rename_symbol", field: "description", reason: "stale_equals_public" },
      ]),
    ).toBe(
      "ast_find_symbols.description: drift_from_public; ast_rename_symbol.description: stale_equals_public",
    );
    expect(formatContractFailures([])).toBe("");
  });

  it("empty declarations reproduce the blanket freeze (committed baseline)", async () => {
    // Declarations are removed as the baseline advances, so the proof uses an empty set on the
    // committed baseline instead of the committed entries.
    const fixture = { baseline: (await readFixture()).baseline, tools: {} };
    const run = (candidate: Catalog) =>
      compareToolContracts({
        publicTools: catalog(),
        candidateTools: candidate,
        declared: fixture,
        baselineVersion: BASELINE,
      });
    expect(run(catalog()).ok).toBe(true);
    for (const name of Object.keys(catalog()).filter(
      (tool) => !RESERVED_TOOL_NAMES.includes(tool),
    )) {
      const drifted = catalog();
      drifted[name] = surface(`${name} drifted.`);
      expect(run(drifted).failures, name).toEqual([
        { tool: name, field: "description", reason: "drift_from_public" },
      ]);
    }
  });

  it("result exposes per-tool status, digests and undeclaredSha256 public and candidate", () => {
    const candidate = catalog();
    candidate.ast_rename_symbol = surface("Prepares a rename, with templates.");
    const declaration = contractOf(candidate.ast_rename_symbol);
    const result = compare(catalog(), candidate, { ast_rename_symbol: declaration });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.tools)).toEqual([
      "ast_find_references",
      "ast_find_symbols",
      "ast_rename_symbol",
    ]);
    expect(result.tools.ast_find_symbols).toEqual({
      status: "undeclared",
      publicSha256: toolContractSha256("ast_find_symbols", catalog().ast_find_symbols),
      candidateSha256: toolContractSha256("ast_find_symbols", catalog().ast_find_symbols),
    });
    const renamed = result.tools.ast_rename_symbol;
    expect(renamed.status).toBe("declared");
    expect(renamed.candidateSha256).toBe(
      toolContractSha256("ast_rename_symbol", candidate.ast_rename_symbol),
    );
    expect(renamed.declaredSha256).toBe(renamed.candidateSha256);
    expect(renamed.publicSha256).not.toBe(renamed.candidateSha256);
    const undeclaredDigest = (tools: Catalog) =>
      createHash("sha256")
        .update(
          JSON.stringify(
            ["ast_find_references", "ast_find_symbols"].map((name) => ({
              name,
              description: tools[name].description,
              parameters: semanticSchema(tools[name].parameters),
            })),
          ),
        )
        .digest("hex");
    expect(result.undeclaredSha256).toEqual({
      public: undeclaredDigest(catalog()),
      candidate: undeclaredDigest(candidate),
    });
    // The undeclared digest ignores declared tools but follows undeclared drift.
    candidate.ast_find_symbols = surface("Finds, differently.");
    const drifted = compare(catalog(), candidate, { ast_rename_symbol: declaration });
    expect(drifted.undeclaredSha256.public).toBe(undeclaredDigest(catalog()));
    expect(drifted.undeclaredSha256.candidate).toBe(undeclaredDigest(candidate));
    expect(drifted.undeclaredSha256.candidate).not.toBe(drifted.undeclaredSha256.public);
  });
});

// Descriptions published in the public 0.13.0 package for the two declared tools. A declaration
// must differ from them; once the baseline advances past a release containing the change, the
// declaration, its entry here and the matching assertion in this file are removed together.
const PUBLIC_BASELINE_DESCRIPTIONS: Record<string, string> = {
  ast_find_references:
    "Finds type-resolved references and returns bounded project-relative locations, including declaration impact by default.",
  ast_rename_symbol:
    "Prepares an exact hash-bound rename plan without writing. Review the preview and apply its operation_id with ast_apply_operation.",
};

describe("declared fixture against the in-process server", () => {
  it("declared fixture matches the in-process server", async () => {
    const server = createServer();
    const client = new Client({ name: "declared-contracts-oracle", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = (await client.listTools()).tools;
      const byName = new Map(listed.map((tool) => [tool.name, tool]));
      const fixture = await readFixture();
      expect(Object.keys(fixture.tools).sort()).toEqual([
        "ast_find_references",
        "ast_rename_symbol",
      ]);
      for (const [name, entry] of Object.entries(fixture.tools)) {
        const tool = byName.get(name);
        expect(tool, `${name} is registered`).toBeDefined();
        expect(entry, name).toEqual(
          contractFromTool({
            description: tool!.description ?? "",
            inputSchema: tool!.inputSchema,
          }),
        );
        const { description } = entry as { description: string };
        expect(PUBLIC_BASELINE_DESCRIPTIONS[name], `${name} has a public baseline`).toBeDefined();
        expect(description, name).not.toBe(PUBLIC_BASELINE_DESCRIPTIONS[name]);
      }
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("registry-consumer pin equals tool-inventory pin", async () => {
    const inventory = JSON.parse(await readFile(INVENTORY_PATH, "utf8")) as {
      tools_list_sha256: string;
    };
    const source = await readFile(REGISTRY_SMOKE_PATH, "utf8");
    const match = /const EXPECTED_TOOLS_LIST_SHA256 =\s*"([0-9a-f]{64})"/u.exec(source);
    expect(match?.[1]).toMatch(/^[0-9a-f]{64}$/u);
    expect(match?.[1]).toBe(inventory.tools_list_sha256);
  });
});
