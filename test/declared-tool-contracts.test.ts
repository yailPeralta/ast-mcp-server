import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESERVED_TOOL_NAMES,
  compareToolContracts,
  contractFromTool,
  semanticSchema,
  toolContractSha256,
} from "../scripts/lib/declared-tool-contracts.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const FIXTURE_PATH = path.join(repositoryRoot, "test", "fixtures", "declared-tool-contracts.json");
const SMOKE_PATH = path.join(repositoryRoot, "scripts", "dsh-adapter-smoke.mjs");

async function readFixture(): Promise<{ baseline: string; tools: Record<string, unknown> }> {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
}

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
