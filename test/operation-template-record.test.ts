import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { TemplateDiagnostics } from "../src/services/angular-template-typecheck.js";
import {
  clearOperationsForTests,
  exportOperationRecord,
  importOperationRecord,
  prepareReplaceBody,
  type PersistedOperationRecord,
} from "../src/services/operations.js";
import { clearProjectSessions } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];
afterEach(async () => {
  clearOperationsForTests();
  clearProjectSessions();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const templateError = {
  code: 2339,
  category: "Error",
  file: "src/a.component.html",
  line: 1,
  column: 8,
  message: "Property 'headng' does not exist on type 'AComponent'.",
};
const withError: TemplateDiagnostics = {
  status: "completed",
  added: [templateError],
  removed: [],
  addedErrors: [templateError],
};
const clean: TemplateDiagnostics = { status: "completed", added: [], removed: [], addedErrors: [] };
const deadline: TemplateDiagnostics = {
  status: "unfinished",
  reason: "deadline",
  added: [],
  removed: [],
  addedErrors: [],
};

/** Independent statement of the hashed field set: version 2 as today, version 3 adds the check. */
function hashOf(record: PersistedOperationRecord, version: 2 | 3): string {
  const delta = record.template_diagnostics;
  return createHash("sha256")
    .update(
      JSON.stringify({
        version,
        operation_id: record.operation_id,
        kind: record.kind,
        project_root: record.project_root,
        created_at: record.created_at,
        expires_at: record.expires_at,
        reference_count: record.reference_count,
        workspace_hash: record.workspace_hash,
        post_workspace_hash: record.post_workspace_hash,
        workspace_file_count: record.workspace_file_count,
        diagnostics: record.diagnostics,
        allow_new_errors: record.allow_new_errors,
        blocked: record.blocked,
        ...(version === 3
          ? {
              template_diagnostics: {
                status: delta?.status,
                ...(delta?.status === "completed"
                  ? {}
                  : { reason: (delta as { reason?: string }).reason }),
                added: delta?.added,
                removed: delta?.removed,
                addedErrors: delta?.addedErrors,
              },
              block_on_template_errors: record.block_on_template_errors,
            }
          : {}),
        files: record.files.map((file) => ({
          file: file.file,
          original_hash: file.original_hash,
          updated_hash: file.updated_hash,
          mode: file.mode,
        })),
      }),
    )
    .digest("hex");
}

/** A prepared TypeScript-only plan, exported, then replaced by a stored-record store state. */
async function baseRecord(): Promise<PersistedOperationRecord> {
  const fixture = await createProjectFixture({
    "src/a.ts": "export function value(): number {\n  return 1;\n}\n",
  });
  fixtures.push(fixture);
  const prepared = await prepareReplaceBody({
    projectRoot: fixture.root,
    filePath: "src/a.ts",
    symbolPath: "value",
    newBody: "return 2;",
  });
  const record = exportOperationRecord(prepared.operation_id);
  clearOperationsForTests();
  return record;
}

/** The record a template check would have produced, with a hash computed by the test. */
function withCheck(
  record: PersistedOperationRecord,
  template: TemplateDiagnostics,
  options: { block?: boolean; allow?: boolean } = {},
): PersistedOperationRecord {
  const block = options.block ?? false;
  const allow = options.allow ?? false;
  const blocked =
    !allow && block && template.status === "completed" && template.addedErrors.length > 0;
  const next: PersistedOperationRecord = {
    ...record,
    allow_new_errors: allow,
    blocked,
    block_reason: blocked
      ? `${template.addedErrors.length} new template error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review.`
      : null,
    template_diagnostics: template,
    block_on_template_errors: block,
  };
  return { ...next, plan_hash: hashOf(next, 3) };
}

describe("plan hash version", () => {
  it("keeps hashing a plan without a template check as version 2", async () => {
    const record = await baseRecord();

    expect(record).not.toHaveProperty("template_diagnostics");
    expect(record).not.toHaveProperty("block_on_template_errors");
    expect(record.plan_hash).toBe(hashOf(record, 2));
    expect(importOperationRecord(record, record.plan_hash).plan_hash).toBe(record.plan_hash);
  });

  it("hashes a plan with a template check as version 3, importing without an explicit version", async () => {
    const record = withCheck(await baseRecord(), clean);

    expect(record.plan_hash).not.toBe(hashOf(record, 2));
    expect(importOperationRecord(record, record.plan_hash).plan_hash).toBe(record.plan_hash);
    expect(importOperationRecord(record, record.plan_hash, 3).plan_hash).toBe(record.plan_hash);
  });

  it("hashes a different template delta differently and refuses a tampered one", async () => {
    const base = await baseRecord();
    const completed = withCheck(base, clean);
    const unfinished = withCheck(base, deadline);

    expect(unfinished.plan_hash).not.toBe(completed.plan_hash);
    expect(() =>
      importOperationRecord(
        { ...completed, template_diagnostics: deadline },
        completed.plan_hash,
        3,
      ),
    ).toThrow(/integrity mismatch/u);
  });

  it("hashes equal template deltas equal and records the opt-in flag in the hash", async () => {
    const base = await baseRecord();
    const first = withCheck(base, withError);
    const second = withCheck({ ...base }, { ...withError });
    const optedIn = withCheck(base, withError, { block: true });

    expect(second.plan_hash).toBe(first.plan_hash);
    expect(optedIn.plan_hash).not.toBe(first.plan_hash);
    expect(() =>
      importOperationRecord(
        { ...first, block_on_template_errors: true, blocked: true },
        first.plan_hash,
        3,
      ),
    ).toThrow();
  });

  it("refuses a version 2 import of a record that carries a template check", async () => {
    const record = withCheck(await baseRecord(), clean);

    expect(() => importOperationRecord(record, record.plan_hash, 2)).toThrow(
      /inconsistent with the plan version/u,
    );
  });
});

describe("persisted blocked rule", () => {
  it("requires blocked for a completed worsened delta when opted in", async () => {
    const base = await baseRecord();
    const blocked = withCheck(base, withError, { block: true });

    expect(blocked.blocked).toBe(true);
    expect(importOperationRecord(blocked, blocked.plan_hash).block_reason).toMatch(
      /^1 new template error\(s\) would be introduced\./u,
    );
    clearOperationsForTests();
    const lenient = { ...blocked, blocked: false };
    expect(() =>
      importOperationRecord({ ...lenient, plan_hash: hashOf(lenient, 3) }, hashOf(lenient, 3)),
    ).toThrow(/blocked status is inconsistent/u);
  });

  it("does not block without the opt-in, on a waiver, or on a non-completed check", async () => {
    const base = await baseRecord();
    const records = [
      withCheck(base, withError),
      withCheck(base, withError, { block: true, allow: true }),
      withCheck(base, deadline, { block: true }),
    ];
    for (const record of records) {
      expect(record.blocked).toBe(false);
      expect(importOperationRecord(record, record.plan_hash).blocked).toBe(false);
      clearOperationsForTests();
    }
  });

  it("rejects a template error delta whose addedErrors disagree with its added list", async () => {
    const record = withCheck(await baseRecord(), { ...withError, addedErrors: [] });

    expect(() => importOperationRecord(record, record.plan_hash)).toThrow(
      /template diagnostic error delta is inconsistent/u,
    );
  });
});
