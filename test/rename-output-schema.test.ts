import { describe, expect, it } from "vitest";
import {
  PreparedOperationOutputSchema,
  RenameOperationOutputSchema,
  serializePreparedOperation,
} from "../src/tools/operation-schema.js";
import type { PreparedOperation } from "../src/services/operations.js";
import type { TemplateDiagnostics } from "../src/services/angular-template-typecheck.js";

const diagnostic = {
  code: 2339,
  category: "Error",
  file: "src/a.component.html",
  line: 1,
  column: 8,
  message: "Property 'headng' does not exist on type 'AComponent'.",
};

const prepared: PreparedOperation = {
  operation_id: "6f1c1f0e-7a2b-4c3d-9e4f-0a1b2c3d4e5f",
  plan_hash: "a".repeat(64),
  kind: "rename_symbol",
  status: "prepared",
  project_root: "/project",
  created_at: "2026-11-08T00:00:00.000Z",
  expires_at: "2026-11-08T00:15:00.000Z",
  affected_files: [
    { file: "src/a.ts", original_hash: "b".repeat(64), updated_hash: "c".repeat(64) },
  ],
  reference_count: 1,
  workspace_hash: "d".repeat(64),
  post_workspace_hash: "e".repeat(64),
  workspace_file_count: 2,
  diagnostics: { added: [], removed: [], addedErrors: [] },
  allow_new_errors: false,
  blocked: false,
  block_reason: null,
  preview: null,
  preview_truncated: false,
};

const withTemplate = (template_diagnostics: TemplateDiagnostics): PreparedOperation => ({
  ...prepared,
  template_diagnostics,
  block_on_template_errors: false,
});

describe("serializePreparedOperation", () => {
  it("omits template_diagnostics when the check did not run", () => {
    const output = serializePreparedOperation(prepared);

    expect(output).not.toHaveProperty("template_diagnostics");
    expect(RenameOperationOutputSchema.parse(output)).not.toHaveProperty("template_diagnostics");
  });

  it("maps a completed delta to the wire shape with added_errors", () => {
    const output = serializePreparedOperation(
      withTemplate({
        status: "completed",
        added: [diagnostic],
        removed: [],
        addedErrors: [diagnostic],
      }),
    );

    expect(output.template_diagnostics).toEqual({
      status: "completed",
      added: [diagnostic],
      removed: [],
      added_errors: [diagnostic],
    });
    expect(output).not.toHaveProperty("block_on_template_errors");
  });

  it("carries the reason of a non-completed check", () => {
    const output = serializePreparedOperation(
      withTemplate({
        status: "unfinished",
        reason: "deadline",
        added: [],
        removed: [],
        addedErrors: [],
      }),
    );

    expect(output.template_diagnostics).toEqual({
      status: "unfinished",
      reason: "deadline",
      added: [],
      removed: [],
      added_errors: [],
    });
  });
});

describe("RenameOperationOutputSchema", () => {
  const completed = { status: "completed", added: [], removed: [], added_errors: [] };

  it("validates every status of the rename template_diagnostics field", () => {
    for (const template_diagnostics of [
      completed,
      { status: "completed", added: [diagnostic], removed: [], added_errors: [diagnostic] },
      { ...completed, status: "unavailable", reason: "compiler_cli_missing" },
      { ...completed, status: "unfinished", reason: "work_exhausted" },
    ]) {
      const output = { ...serializePreparedOperation(prepared), template_diagnostics };
      expect(RenameOperationOutputSchema.safeParse(output).success).toBe(true);
    }
  });

  it("requires a reason for non-completed statuses and forbids one for completed", () => {
    const base = serializePreparedOperation(prepared);
    for (const status of ["unavailable", "unfinished"]) {
      const output = { ...base, template_diagnostics: { ...completed, status } };
      expect(RenameOperationOutputSchema.safeParse(output).success, status).toBe(false);
    }
    const reasoned = { ...base, template_diagnostics: { ...completed, reason: "deadline" } };
    expect(RenameOperationOutputSchema.safeParse(reasoned).success).toBe(false);
  });

  it("requires empty arrays for a non-completed status", () => {
    const output = {
      ...serializePreparedOperation(prepared),
      template_diagnostics: {
        status: "unfinished",
        reason: "deadline",
        added: [diagnostic],
        removed: [],
        added_errors: [],
      },
    };

    expect(RenameOperationOutputSchema.safeParse(output).success).toBe(false);
  });

  it("leaves the shared prepared-operation contract without the field", () => {
    expect(Object.keys(PreparedOperationOutputSchema.shape)).not.toContain("template_diagnostics");
    expect(Object.keys(RenameOperationOutputSchema.shape)).toContain("template_diagnostics");
    expect(RenameOperationOutputSchema.shape.template_diagnostics.isOptional()).toBe(true);
  });
});
