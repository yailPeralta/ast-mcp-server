import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as diagnosticsModule from "../src/services/diagnostics.js";
import {
  clearOperationsForTests,
  createPlan,
  exportOperationRecord,
  type AuxiliaryEdit,
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
const environmentRoots: string[] = [];

beforeEach(async () => {
  const environmentRoot = await mkdtemp(path.join(os.tmpdir(), "ast-operation-env-"));
  environmentRoots.push(environmentRoot);
  vi.stubEnv("AST_SYMBOL_INDEX_PERSISTENCE", undefined);
  vi.stubEnv("AST_SYMBOL_INDEX_CACHE_ROOT", undefined);
  vi.stubEnv("HOME", path.join(environmentRoot, "home"));
  vi.stubEnv("XDG_CACHE_HOME", path.join(environmentRoot, "xdg"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  clearOperationsForTests();
  clearProjectSessions();
  await Promise.all([
    ...fixtures.splice(0).map((fixture) => fixture.cleanup()),
    ...environmentRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
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

async function angularFixture(html = TEMPLATE_HTML): Promise<AngularFixture> {
  const fixture = await createAngularFixture(
    {
      "src/a.component.ts": COMPONENT_TS,
      "src/a.component.html": html,
      "src/notes.html": "<p>{{ title }}</p>\n",
    },
    { compiler: null },
  );
  fixtures.push(fixture);
  return fixture;
}

/** Aux edits that rename every `title` token in the template text (offsets are BOM-free text). */
async function titleEdits(
  fixture: AngularFixture,
  file = "src/a.component.html",
  overrides: Partial<AuxiliaryEdit> = {},
): Promise<AuxiliaryEdit[]> {
  const absolutePath = path.join(fixture.root, file);
  const bytes = await readFile(absolutePath);
  const text = new TextDecoder().decode(bytes);
  const expectedHash = hashBytes(bytes);
  return [...text.matchAll(/title/gu)].map((match) => ({
    absolutePath,
    start: match.index,
    end: match.index + "title".length,
    newText: "heading",
    expectedHash,
    ...overrides,
  }));
}

function plan(fixture: AngularFixture, auxiliaryEdits: readonly AuxiliaryEdit[], renameTs = true) {
  return createPlan(
    fixture.root,
    "rename_symbol",
    false,
    async (context) => {
      if (renameTs) {
        const node = findDeclarationByName(
          getSourceFileOrThrow(context.project, "src/a.component.ts"),
          "AComponent.title",
        );
        (node as unknown as { rename(name: string): void }).rename("heading");
      }
      return { referenceCount: 1 + auxiliaryEdits.length, auxiliaryEdits };
    },
    createRequestContext(),
  );
}

describe("auxiliary template edits in createPlan (ATN-R1, EWS-R2)", () => {
  it("overlapping auxiliary edits are rejected", async () => {
    const fixture = await angularFixture();
    const [first] = await titleEdits(fixture);

    await expect(
      plan(fixture, [first!, { ...first!, start: first!.start + 2, end: first!.end + 2 }]),
    ).rejects.toThrow(/overlap/i);
  });

  it("adjacent non-overlapping auxiliary edits are applied in descending order", async () => {
    const fixture = await angularFixture();
    const edits = await titleEdits(fixture);

    const prepared = await plan(fixture, edits);

    const html = exportOperationRecord(prepared.operation_id).files.find((file) =>
      file.file.endsWith(".html"),
    );
    expect(edits).toHaveLength(2);
    expect(Buffer.from(html!.updated_bytes_base64, "base64").toString("utf8")).toBe(
      "<h1>{{ heading }}</h1><p>{{ heading }}</p>\n",
    );
  });

  it("auxiliary edit with stale hash raises workspace-changed", async () => {
    const fixture = await angularFixture();
    const edits = await titleEdits(fixture, "src/a.component.html", {
      expectedHash: hashBytes(Buffer.from("something else")),
    });

    await expect(plan(fixture, edits)).rejects.toThrow(
      /Workspace changed while the operation was being prepared.*a\.component\.html/su,
    );
  });

  it("auxiliary edit outside the workspace snapshot is rejected", async () => {
    const fixture = await angularFixture();
    const edits = await titleEdits(fixture, "src/notes.html");

    await expect(plan(fixture, edits)).rejects.toThrow(
      /missing from the workspace snapshot.*notes\.html/su,
    );
  });

  it("html PlannedFile preserves BOM and mode", async () => {
    const fixture = await angularFixture(`\uFEFF${TEMPLATE_HTML}`);
    await chmod(path.join(fixture.root, "src/a.component.html"), 0o640);
    const originalBytes = await readFile(path.join(fixture.root, "src/a.component.html"));
    const edits = await titleEdits(fixture);

    const prepared = await plan(fixture, edits);

    const exported = exportOperationRecord(prepared.operation_id);
    const html = exported.files.find((file) => file.file.endsWith(".html"))!;
    const updated = Buffer.from(html.updated_bytes_base64, "base64");
    expect([...updated.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(updated.subarray(3).toString("utf8")).toBe(
      "<h1>{{ heading }}</h1><p>{{ heading }}</p>\n",
    );
    expect(html.mode & 0o777).toBe(0o640);
    expect(html.original_hash).toBe(hashBytes(originalBytes));
    expect(html.updated_hash).toBe(hashBytes(updated));
    expect(prepared.affected_files.map((file) => file.file)).toEqual([
      "src/a.component.html",
      "src/a.component.ts",
    ]);
    expect(prepared.preview).toContain("{{ heading }}");
    expect((await stat(path.join(fixture.root, "src/a.component.html"))).mode & 0o777).toBe(0o640);
  });

  it("html edit absent from diagnostics textChanges", async () => {
    const fixture = await angularFixture();
    const compare = vi.spyOn(diagnosticsModule, "compareObservedDiagnostics");

    const prepared = await plan(fixture, await titleEdits(fixture));

    expect(prepared.affected_files.map((file) => file.file)).toContain("src/a.component.html");
    expect(compare).toHaveBeenCalledTimes(1);
    const textChanges = compare.mock.calls[0]![2];
    expect(textChanges.map((change) => change.file)).toEqual(["src/a.component.ts"]);
  });
});
