import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPersistedOperation,
  inspectPersistedPlan,
  persistOperationPlan,
} from "../src/services/operation-plan-file.js";
import * as typecheck from "../src/services/angular-template-typecheck.js";
import type { TemplateDiagnostics } from "../src/services/angular-template-typecheck.js";
import {
  clearOperationsForTests,
  createPlan,
  exportOperationRecord,
  importOperationRecord,
  prepareRename,
  type AuxiliaryEdit,
  type PersistedOperationRecord,
} from "../src/services/operations.js";
import {
  clearProjectSessions,
  findDeclarationByName,
  getSourceFileOrThrow,
} from "../src/services/project.js";
import { createRequestContext } from "../src/services/request-context.js";
import { hashBytes } from "../src/services/workspace.js";
import { createAngularFixture, type AngularFixture } from "./helpers/angular-fixture.js";

const fixtures: AngularFixture[] = [];
let stateRoot: string;

beforeEach(() => {
  stateRoot = path.join(os.tmpdir(), `ast-template-typecheck-${process.pid}-${Date.now()}`);
  vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", undefined);
  vi.stubEnv("HOME", path.join(stateRoot, "home"));
  vi.stubEnv("XDG_CACHE_HOME", path.join(stateRoot, "xdg"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  clearOperationsForTests();
  clearProjectSessions();
  await Promise.all([
    ...fixtures.splice(0).map((fixture) => fixture.cleanup()),
    rm(stateRoot, { recursive: true, force: true }),
  ]);
});

const COMPONENT_TS = [
  'import { Component } from "@angular/core";',
  '@Component({ selector: "app-a", templateUrl: "./a.component.html" })',
  "export class AComponent {",
  '  title = "x";',
  "}",
  "",
].join("\n");
const TEMPLATE_HTML = "<h1>{{ title }}</h1><p>{{ title }}</p>\n";

const templateError = {
  code: 2339,
  category: "Error",
  file: "src/a.component.html",
  line: 1,
  column: 8,
  message: "Property 'headng' does not exist on type 'AComponent'.",
};
const templateWarning = { ...templateError, code: 8113, category: "Warning" };

const completedWithError: TemplateDiagnostics = {
  status: "completed",
  added: [templateError],
  removed: [],
  addedErrors: [templateError],
};
const completedClean: TemplateDiagnostics = {
  status: "completed",
  added: [],
  removed: [],
  addedErrors: [],
};
const unfinishedDeadline: TemplateDiagnostics = {
  status: "unfinished",
  reason: "deadline",
  added: [],
  removed: [],
  addedErrors: [],
};

async function angularFixture(
  files: Record<string, string> = {},
  compiler: "v21" | null = null,
): Promise<AngularFixture> {
  const fixture = await createAngularFixture(
    {
      "src/a.component.ts": COMPONENT_TS,
      "src/a.component.html": TEMPLATE_HTML,
      ...files,
    },
    { compiler },
  );
  fixtures.push(fixture);
  return fixture;
}

async function titleEdits(fixture: AngularFixture): Promise<AuxiliaryEdit[]> {
  const absolutePath = path.join(fixture.root, "src/a.component.html");
  const bytes = await readFile(absolutePath);
  const text = new TextDecoder().decode(bytes);
  return [...text.matchAll(/title/gu)].map((match) => ({
    absolutePath,
    start: match.index,
    end: match.index + "title".length,
    newText: "heading",
    expectedHash: hashBytes(bytes),
  }));
}

interface PlanOptions {
  readonly kind?: "rename_symbol" | "replace_symbol_body";
  readonly allowNewErrors?: boolean;
  readonly blockOnTemplateErrors?: boolean;
  readonly withTemplateEdits?: boolean;
  /** Adds a TypeScript error to the program so the TS delta is worsened. */
  readonly breakTypeScript?: boolean;
}

async function plan(fixture: AngularFixture, options: PlanOptions = {}) {
  const edits = options.withTemplateEdits === false ? [] : await titleEdits(fixture);
  return createPlan(
    fixture.root,
    options.kind ?? "rename_symbol",
    options.allowNewErrors ?? false,
    async (context) => {
      const sourceFile = getSourceFileOrThrow(context.project, "src/a.component.ts");
      const node = findDeclarationByName(sourceFile, "AComponent.title");
      (node as unknown as { rename(name: string): void }).rename("heading");
      if (options.breakTypeScript) sourceFile.addStatements('export const broken: number = "s";');
      return { referenceCount: 1 + edits.length, auxiliaryEdits: edits };
    },
    createRequestContext(),
    { blockOnTemplateErrors: options.blockOnTemplateErrors },
  );
}

function stubCheck(result: TemplateDiagnostics) {
  return vi.spyOn(typecheck, "checkTemplateTypes").mockResolvedValue(result);
}

function v2Hash(record: PersistedOperationRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 2,
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

describe("template type check wiring in createPlan", () => {
  it("does not run the check for a rename that edits no template", async () => {
    const fixture = await angularFixture();
    const check = stubCheck(completedWithError);

    const prepared = await plan(fixture, { withTemplateEdits: false });

    expect(check).not.toHaveBeenCalled();
    expect(prepared).not.toHaveProperty("template_diagnostics");
    expect(prepared.blocked).toBe(false);
  });

  it("does not run the check for other operation kinds", async () => {
    const fixture = await angularFixture();
    const check = stubCheck(completedWithError);

    const prepared = await plan(fixture, { kind: "replace_symbol_body" });

    expect(check).not.toHaveBeenCalled();
    expect(prepared).not.toHaveProperty("template_diagnostics");
  });

  it("calls the check once with tsconfig-relative changes, the overlay and a scheduler context", async () => {
    const fixture = await angularFixture();
    const check = stubCheck(completedClean);

    await plan(fixture);

    expect(check).toHaveBeenCalledTimes(1);
    const [input, ctx] = check.mock.calls[0]!;
    const html = path.join(fixture.root, "src/a.component.html");
    const ts = path.join(fixture.root, "src/a.component.ts");
    expect(input.tsConfigFilePath).toBe(path.join(fixture.root, "tsconfig.json"));
    expect(input.templates).toEqual([html]);
    expect(input.overlay.map((file) => file.absolutePath).sort()).toEqual([html, ts].sort());
    expect(input.overlay.find((file) => file.absolutePath === html)?.text).toBe(
      "<h1>{{ heading }}</h1><p>{{ heading }}</p>\n",
    );
    expect(input.changes.map((change) => change.file).sort()).toEqual([
      path.join("src", "a.component.html"),
      path.join("src", "a.component.ts"),
    ]);
    expect(input.changes.find((change) => change.file.endsWith(".html"))).toMatchObject({
      beforeText: TEMPLATE_HTML,
      afterText: "<h1>{{ heading }}</h1><p>{{ heading }}</p>\n",
    });
    expect(ctx).toBeDefined();
    expect(ctx!.remainingMs()).toBeGreaterThan(0);
  });

  it("reports a completed worsened delta without blocking by default", async () => {
    const fixture = await angularFixture();
    stubCheck(completedWithError);

    const prepared = await plan(fixture);

    expect(prepared.template_diagnostics).toEqual(completedWithError);
    expect(prepared.blocked).toBe(false);
    expect(prepared.block_reason).toBeNull();
  });

  it("keeps template findings out of the TypeScript diagnostics field", async () => {
    const fixture = await angularFixture();
    stubCheck(completedWithError);

    const prepared = await plan(fixture);

    expect(prepared.diagnostics.added).toEqual([]);
    expect(prepared.diagnostics.addedErrors).toEqual([]);
    expect(prepared.template_diagnostics?.added).toHaveLength(1);
  });
});

describe("blocked rule", () => {
  it("blocks on a completed worsened delta when opted in and names template errors", async () => {
    const fixture = await angularFixture();
    stubCheck(completedWithError);

    const prepared = await plan(fixture, { blockOnTemplateErrors: true });

    expect(prepared.blocked).toBe(true);
    expect(prepared.block_reason).toBe(
      "1 new template error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review.",
    );
  });

  it("does not block on a non-completed status and shows it", async () => {
    const fixture = await angularFixture();
    stubCheck(unfinishedDeadline);

    const prepared = await plan(fixture, { blockOnTemplateErrors: true });

    expect(prepared.blocked).toBe(false);
    expect(prepared.template_diagnostics).toEqual(unfinishedDeadline);
  });

  it("does not block a clean completed delta or a warning-only one", async () => {
    const fixture = await angularFixture();
    stubCheck(completedClean);
    expect((await plan(fixture, { blockOnTemplateErrors: true })).blocked).toBe(false);

    stubCheck({ status: "completed", added: [templateWarning], removed: [], addedErrors: [] });
    const warned = await plan(fixture, { blockOnTemplateErrors: true });
    expect(warned.blocked).toBe(false);
    expect(warned.template_diagnostics?.added).toEqual([templateWarning]);
  });

  it("lets allow_new_errors waive the template block while still reporting the errors", async () => {
    const fixture = await angularFixture();
    stubCheck(completedWithError);

    const prepared = await plan(fixture, { blockOnTemplateErrors: true, allowNewErrors: true });

    expect(prepared.blocked).toBe(false);
    expect(prepared.template_diagnostics?.addedErrors).toEqual([templateError]);
  });

  it("does not enable template blocking through allow_new_errors alone", async () => {
    const fixture = await angularFixture();
    stubCheck(completedWithError);

    const prepared = await plan(fixture, { allowNewErrors: true });

    expect(prepared.blocked).toBe(false);
    expect(prepared.template_diagnostics?.addedErrors).toEqual([templateError]);
  });

  it("keeps blocking a TypeScript error exactly as before when the option is unset", async () => {
    const fixture = await angularFixture();
    stubCheck(completedWithError);

    const prepared = await plan(fixture, { breakTypeScript: true });

    expect(prepared.blocked).toBe(true);
    expect(prepared.block_reason).toBe(
      "1 new TypeScript error(s) would be introduced. Prepare again with allow_new_errors=true only after explicit review.",
    );
  });

  it("names both sources when TypeScript and template errors apply", async () => {
    const fixture = await angularFixture();
    stubCheck(completedWithError);

    const prepared = await plan(fixture, { breakTypeScript: true, blockOnTemplateErrors: true });

    expect(prepared.blocked).toBe(true);
    expect(prepared.block_reason).toContain("1 new TypeScript error(s) would be introduced.");
    expect(prepared.block_reason).toContain("1 new template error(s) would be introduced.");
  });
});

describe("inline template usage", () => {
  it("is refused before the check runs", async () => {
    const fixture = await angularFixture(
      {
        "src/a.component.ts": COMPONENT_TS.replace(
          'templateUrl: "./a.component.html"',
          'template: "<p>{{ title }}</p>"',
        ),
      },
      "v21",
    );
    const check = stubCheck(completedClean);

    await expect(
      prepareRename({
        projectRoot: fixture.root,
        filePath: "src/a.component.ts",
        symbolPath: "AComponent.title",
        newName: "heading",
      }),
    ).rejects.toMatchObject({ code: "MUTATION_BLOCKED" });
    expect(check).not.toHaveBeenCalled();
  });
});

describe("plan hash version", () => {
  it("hashes a plan without a template check as version 2 over today's field set", async () => {
    const fixture = await angularFixture();
    stubCheck(completedClean);
    const prepared = await plan(fixture, { withTemplateEdits: false });

    const record = exportOperationRecord(prepared.operation_id);

    expect(record.plan_hash).toBe(v2Hash(record));
    expect(record).not.toHaveProperty("block_on_template_errors");
  });

  it("hashes a plan with a template check as version 3 and carries the opt-in flag", async () => {
    const fixture = await angularFixture();
    stubCheck(completedClean);
    const prepared = await plan(fixture, { blockOnTemplateErrors: true });

    const record = exportOperationRecord(prepared.operation_id);

    expect(record.block_on_template_errors).toBe(true);
    expect(record.template_diagnostics).toEqual(completedClean);
    expect(record.plan_hash).not.toBe(v2Hash(record));
    clearOperationsForTests();
    expect(importOperationRecord(record, record.plan_hash, 3).plan_hash).toBe(record.plan_hash);
  });

  it("persists a template-checked plan as schema version 3 and applies it from a fresh store", async () => {
    const fixture = await angularFixture();
    stubCheck(completedWithError);
    const prepared = await plan(fixture, { blockOnTemplateErrors: false });
    const stateDirectory = path.join(stateRoot, "state");

    const planFile = await persistOperationPlan(prepared.operation_id, { stateDirectory });
    expect(await inspectPersistedPlan(planFile)).toMatchObject({ schema_version: 3 });
    clearOperationsForTests();
    const applied = await applyPersistedOperation(planFile, prepared.plan_hash, { stateDirectory });

    expect(applied.affected_files).toContain("src/a.component.html");
    expect(await readFile(path.join(fixture.root, "src/a.component.html"), "utf8")).toBe(
      "<h1>{{ heading }}</h1><p>{{ heading }}</p>\n",
    );
  });
});
