import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { defineToolCatalog, toolCatalog, type ToolDescriptor } from "../src/tools/catalog.js";

const EXPECTED_NAMES = [
  "ast_list_files",
  "ast_get_project_status",
  "ast_explore",
  "ast_get_outline",
  "ast_get_symbol_source",
  "ast_search_symbols",
  "ast_find_references",
  "ast_get_impact",
  "ast_find_test_candidates",
  "ast_get_diagnostics",
  "ast_get_file",
  "ast_rename_symbol",
  "ast_replace_symbol_body",
  "ast_scaffold_class",
  "ast_get_operation_preview",
  "ast_apply_operation",
] as const;

function readDescriptor(name: `ast_${string}`): ToolDescriptor {
  return {
    name,
    register: vi.fn(),
    compatibility: "required",
    effect: "read",
    batch: "read",
    directOutputFormats: ["json"],
  };
}

describe("tool capability catalog", () => {
  it("preserves ordered names and exposes frozen, closed projections", () => {
    expect(toolCatalog.descriptors.map(({ name }) => name)).toEqual(EXPECTED_NAMES);
    expect(toolCatalog.batch).toEqual({
      read: [
        "ast_list_files",
        "ast_explore",
        "ast_get_outline",
        "ast_get_symbol_source",
        "ast_search_symbols",
        "ast_find_references",
        "ast_find_test_candidates",
        "ast_get_diagnostics",
      ],
      prepare: ["ast_rename_symbol", "ast_replace_symbol_body", "ast_scaffold_class"],
      excluded: [
        "ast_get_project_status",
        "ast_get_impact",
        "ast_get_file",
        "ast_get_operation_preview",
        "ast_apply_operation",
      ],
    });
    expect(toolCatalog.compatibility.optional).toEqual([
      "ast_get_project_status",
      "ast_explore",
      "ast_get_impact",
      "ast_get_file",
    ]);
    expect(toolCatalog.directToon).toEqual([
      "ast_search_symbols",
      "ast_find_references",
      "ast_get_impact",
      "ast_get_diagnostics",
    ]);
    expect([
      toolCatalog.descriptors,
      ...Object.values(toolCatalog.batch),
      ...Object.values(toolCatalog.compatibility),
      ...Object.values(toolCatalog.byEffect),
      toolCatalog.directToon,
    ]).toSatisfy((values: readonly object[]) => values.every(Object.isFrozen));
    expectTypeOf<(typeof toolCatalog.descriptors)[number]["name"]>().toEqualTypeOf<
      (typeof EXPECTED_NAMES)[number]
    >();
  });

  it("rejects duplicate names and effect, batch, or format contradictions", () => {
    expect(() =>
      defineToolCatalog([readDescriptor("ast_duplicate"), readDescriptor("ast_duplicate")]),
    ).toThrow(/duplicate tool name/i);
    for (const invalid of [
      { ...readDescriptor("ast_bad_prepare"), effect: "prepare", batch: "read" },
      {
        ...readDescriptor("ast_bad_apply"),
        effect: "apply",
        batch: "none",
        directOutputFormats: ["json", "toon"],
      },
      { ...readDescriptor("ast_bad_read"), effect: "read", batch: "prepare" },
    ]) {
      expect(() => defineToolCatalog([invalid as unknown as ToolDescriptor])).toThrow(
        /contradictory/i,
      );
    }
    const register = vi.fn();
    const catalog = defineToolCatalog([{ ...readDescriptor("ast_fixed"), register }] as const);
    const server = {} as Parameters<typeof catalog.registerAll>[0];
    catalog.registerAll(server);
    expect(register).toHaveBeenCalledWith(server);
  });
});
