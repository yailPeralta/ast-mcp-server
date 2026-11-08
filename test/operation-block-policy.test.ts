import { describe, expect, it } from "vitest";
import type { TemplateDiagnostics } from "../src/services/angular-template-typecheck.js";
import { evaluateBlock } from "../src/services/operation-block-policy.js";

const error = { code: 2339, category: "Error", file: "a.html", line: 1, column: 1, message: "m" };
const completed = (errors: number): TemplateDiagnostics => ({
  status: "completed",
  added: Array(errors).fill(error),
  removed: [],
  addedErrors: Array(errors).fill(error),
});
const unfinished: TemplateDiagnostics = {
  status: "unfinished",
  reason: "deadline",
  added: [],
  removed: [],
  addedErrors: [],
};
const base = { allowNewErrors: false, typescriptErrors: 0, blockOnTemplateErrors: false };

describe("evaluateBlock", () => {
  it("blocks on TypeScript errors with the historical wording", () => {
    expect(evaluateBlock({ ...base, typescriptErrors: 2 })).toEqual({
      blocked: true,
      reason:
        "2 new TypeScript error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review.",
    });
  });

  it("blocks on completed template errors only when opted in", () => {
    expect(evaluateBlock({ ...base, template: completed(3) }).blocked).toBe(false);
    expect(evaluateBlock({ ...base, template: completed(3), blockOnTemplateErrors: true })).toEqual(
      {
        blocked: true,
        reason:
          "3 new template error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review.",
      },
    );
  });

  it("never blocks on a check that did not complete", () => {
    expect(
      evaluateBlock({ ...base, template: unfinished, blockOnTemplateErrors: true }).blocked,
    ).toBe(false);
  });

  it("names both sources and lets allow_new_errors waive both", () => {
    const both = {
      ...base,
      typescriptErrors: 1,
      template: completed(1),
      blockOnTemplateErrors: true,
    };
    expect(evaluateBlock(both).reason).toBe(
      "1 new TypeScript error(s) would be introduced. 1 new template error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review.",
    );
    expect(evaluateBlock({ ...both, allowNewErrors: true })).toEqual({
      blocked: false,
      reason: null,
    });
  });
});
