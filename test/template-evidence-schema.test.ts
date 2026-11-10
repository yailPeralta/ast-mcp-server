import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ReferenceOutputSchemas } from "../src/tools/find_references.js";
import golden from "./fixtures/find-references-output-schema.json" with { type: "json" };

describe("ast_find_references output schema", () => {
  it.each(["locations", "context"] as const)(
    "keeps the %s JSON schema byte-identical to the golden",
    (detail) => {
      expect(JSON.stringify(z.toJSONSchema(ReferenceOutputSchemas[detail]))).toBe(golden[detail]);
    },
  );
});
