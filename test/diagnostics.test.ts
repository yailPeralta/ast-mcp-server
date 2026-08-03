import { describe, expect, it } from "vitest";
import { compareDiagnostics, type NormalizedDiagnostic } from "../src/services/diagnostics.js";

function diagnostic(overrides: Partial<NormalizedDiagnostic> = {}): NormalizedDiagnostic {
  return {
    code: 2322,
    category: "Error",
    file: "src/value.ts",
    line: 1,
    column: 1,
    message: "Type 'string' is not assignable to type 'number'.",
    ...overrides,
  };
}

describe("diagnostic deltas", () => {
  it("does not classify a shifted existing diagnostic as new", () => {
    const before = [diagnostic({ line: 1 })];
    const after = [diagnostic({ line: 12 })];
    expect(compareDiagnostics(before, after)).toEqual({
      added: [],
      removed: [],
      addedErrors: [],
    });
  });

  it("uses multiset counts so an additional identical error is detected", () => {
    const existing = diagnostic();
    const added = diagnostic({ line: 2 });
    const delta = compareDiagnostics([existing], [existing, added]);
    expect(delta.added).toEqual([added]);
    expect(delta.addedErrors).toEqual([added]);
  });
});
