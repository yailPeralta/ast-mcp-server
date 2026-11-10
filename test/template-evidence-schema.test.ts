import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ReferenceOutputSchemas } from "../src/tools/find_references.js";
import {
  ReferenceOriginSchema,
  TemplateCoverageSchema,
  templateEvidenceFields,
} from "../src/tools/template-evidence-schema.js";
import golden from "./fixtures/find-references-output-schema.json" with { type: "json" };

describe("ast_find_references output schema", () => {
  it.each(["locations", "context"] as const)(
    "keeps the %s JSON schema byte-identical to the golden",
    (detail) => {
      expect(JSON.stringify(z.toJSONSchema(ReferenceOutputSchemas[detail]))).toBe(golden[detail]);
    },
  );
});

describe("shared template evidence schemas", () => {
  it("exposes the origin enum, the coverage verdict and the optional evidence fields", () => {
    expect(ReferenceOriginSchema.options).toEqual([
      "compiler",
      "template_external",
      "template_inline",
    ]);
    expect(TemplateCoverageSchema.shape.reason.unwrap().options).toEqual([
      "compiler_missing",
      "compiler_unsupported",
      "template_unresolved",
      "template_unsafe",
      "template_parse_error",
      "size_exceeded",
      "work_exhausted",
      "inherited_member",
      "cross_component",
    ]);
    expect(Object.keys(templateEvidenceFields)).toEqual([
      "template_coverage",
      "template_reference_count",
    ]);
    expect(z.object(templateEvidenceFields).parse({})).toEqual({});
  });

  it("is the only definition used by ast_find_references", async () => {
    const source = await readFile(
      path.join(import.meta.dirname, "..", "src", "tools", "find_references.ts"),
      "utf8",
    );
    expect(source).toContain(`from "./template-evidence-schema.js"`);
    expect(source).not.toMatch(/template_external|compiler_missing/);
  });
});
