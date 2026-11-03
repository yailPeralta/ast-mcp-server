import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as diagnosticsModule from "../src/services/diagnostics.js";
import {
  applyOperation,
  clearOperationsForTests,
  createPlan,
  exportOperationRecord,
  prepareRename,
  type AuxiliaryEdit,
} from "../src/services/operations.js";
import {
  clearProjectSessions,
  findDeclarationByName,
  getSourceFileOrThrow,
} from "../src/services/project.js";
import { createRequestContext } from "../src/services/request-context.js";
import { hashBytes } from "../src/services/workspace.js";
import {
  createAngularFixture,
  type AngularCompilerAlias,
  type AngularFixture,
} from "./helpers/angular-fixture.js";
import { createProjectFixture } from "./helpers/project-fixture.js";

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

const RENAME_COMPONENT = (metadata = 'templateUrl: "./a.component.html"', extra = "") =>
  [
    'import { Component } from "@angular/core";',
    `@Component({ selector: "app-a", ${metadata} })`,
    "export class AComponent {",
    '  title = "x";',
    "  rows = [1, 2];",
    "  save(): void {}",
    extra,
    "}",
    "export const probe = new AComponent().title;",
    "",
  ].join("\n");

const RENAME_TEMPLATE = [
  "<h1>{{ title }}</h1>",
  "@for (row of rows; track row) {",
  "  <p>{{ title }} {{ row }}</p>",
  "}",
  '<button (click)="save()">{{ value | title }}</button>',
  "",
].join("\n");

async function renameFixture(
  files: Record<string, string> = {},
  compiler: AngularCompilerAlias | null = "v21",
): Promise<AngularFixture> {
  const fixture = await createAngularFixture(
    {
      "src/a.component.ts": RENAME_COMPONENT(),
      "src/a.component.html": RENAME_TEMPLATE,
      ...files,
    },
    { compiler },
  );
  fixtures.push(fixture);
  return fixture;
}

function renameTitle(
  fixture: { root: string },
  newName = "heading",
  symbolPath = "AComponent.title",
) {
  return prepareRename({
    projectRoot: fixture.root,
    filePath: "src/a.component.ts",
    symbolPath,
    newName,
  });
}

describe("prepareRename across Angular templates (ATN-R1, R3-R7)", () => {
  it("rename updates TS and external template (apply writes both)", async () => {
    const fixture = await renameFixture();

    const prepared = await renameTitle(fixture);
    const applied = await applyOperation(prepared.operation_id, prepared.plan_hash);

    expect(prepared.affected_files.map((file) => file.file)).toEqual([
      "src/a.component.html",
      "src/a.component.ts",
    ]);
    expect(applied.affected_files).toContain("src/a.component.html");
    expect(await fixture.read("src/a.component.html")).toBe(
      RENAME_TEMPLATE.replaceAll("{{ title }}", "{{ heading }}"),
    );
    expect(await fixture.read("src/a.component.ts")).toContain("heading = ");
    expect(await fixture.read("src/a.component.ts")).toContain("new AComponent().heading");
  });

  it("template edits count in reference_count", async () => {
    const fixture = await renameFixture();
    const plain = await renameFixture({ "src/a.component.html": "<h1>none</h1>\n" });

    const withTemplate = await renameTitle(fixture);
    const withoutTemplate = await renameTitle(plain);

    expect(withTemplate.reference_count - withoutTemplate.reference_count).toBe(2);
  });

  it("pipe name not renamed", async () => {
    const fixture = await renameFixture();

    const prepared = await renameTitle(fixture);

    expect(prepared.preview).toContain("{{ value | title }}");
    expect(prepared.preview).not.toContain("value | heading");
  });

  it("renames a method used in an event binding", async () => {
    const fixture = await renameFixture();

    const prepared = await renameTitle(fixture, "persist", "AComponent.save");
    await applyOperation(prepared.operation_id, prepared.plan_hash);

    expect(await fixture.read("src/a.component.html")).toContain('(click)="persist()"');
  });

  it("inline usage blocks rename", async () => {
    const fixture = await renameFixture({
      "src/a.component.ts": RENAME_COMPONENT('template: "<p>{{ title }}</p>"'),
    });

    await expect(renameTitle(fixture)).rejects.toMatchObject({ code: "MUTATION_BLOCKED" });
    expect(await fixture.read("src/a.component.ts")).toContain("title = ");
    expect(await fixture.read("src/a.component.html")).toBe(RENAME_TEMPLATE);
  });

  it("unresolvable template blocks rename", async () => {
    const fixture = await renameFixture({
      "src/a.component.ts": `declare function computedUrl(): string;\n${RENAME_COMPONENT("templateUrl: computedUrl()")}`,
    });

    await expect(renameTitle(fixture)).rejects.toMatchObject({ code: "INCOMPLETE_EVIDENCE" });
  });

  it("inherited member blocks rename", async () => {
    const fixture = await renameFixture({
      "src/base.ts": "export class Base {\n  shared = 1;\n}\n",
      "src/b.component.ts": [
        'import { Component } from "@angular/core";',
        'import { Base } from "./base.js";',
        '@Component({ selector: "app-b", templateUrl: "./b.component.html" })',
        "export class BComponent extends Base {}",
        "",
      ].join("\n"),
      "src/b.component.html": "<p>{{ shared }}</p>\n",
    });

    await expect(
      prepareRename({
        projectRoot: fixture.root,
        filePath: "src/base.ts",
        symbolPath: "Base.shared",
        newName: "common",
      }),
    ).rejects.toMatchObject({ code: "INCOMPLETE_EVIDENCE" });
  });

  it("compiler missing blocks rename", async () => {
    const fixture = await renameFixture({}, null);

    await expect(renameTitle(fixture)).rejects.toMatchObject({ code: "INCOMPLETE_EVIDENCE" });
  });

  it("new name colliding with a local blocks the whole plan", async () => {
    const fixture = await renameFixture();

    await expect(renameTitle(fixture, "row")).rejects.toMatchObject({ code: "MUTATION_BLOCKED" });
    expect(await fixture.read("src/a.component.ts")).toContain("title = ");
  });

  it("new name $any blocks", async () => {
    const fixture = await renameFixture();

    await expect(renameTitle(fixture, "$any")).rejects.toMatchObject({ code: "MUTATION_BLOCKED" });
  });

  it("plain TS project rename unchanged", async () => {
    const plain = await createProjectFixture({
      "src/value.ts":
        "export function formatValue(value: number): string { return String(value); }\n",
      "src/use.ts":
        'import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n',
      "src/fake.html": "<p>formatValue</p>\n",
    });
    const prepared = await prepareRename({
      projectRoot: plain.root,
      filePath: "src/value.ts",
      symbolPath: "formatValue",
      newName: "renderValue",
    });
    await plain.cleanup();

    expect(prepared.affected_files.map((file) => file.file)).toEqual([
      "src/use.ts",
      "src/value.ts",
    ]);
    expect(prepared.reference_count).toBe(2);
    expect(prepared.blocked).toBe(false);
  });

  it("fake @Component without core renames TS only", async () => {
    const fake = await createProjectFixture({
      "src/fake.component.ts": [
        "declare function Component(metadata: { templateUrl: string }): ClassDecorator;",
        '@Component({ templateUrl: "./fake.component.html" })',
        "export class FakeComponent {",
        '  title = "x";',
        "}",
        "",
      ].join("\n"),
      "src/fake.component.html": "<h1>{{ title }}</h1>\n",
    });
    const prepared = await prepareRename({
      projectRoot: fake.root,
      filePath: "src/fake.component.ts",
      symbolPath: "FakeComponent.title",
      newName: "heading",
    });
    await fake.cleanup();

    expect(prepared.affected_files.map((file) => file.file)).toEqual(["src/fake.component.ts"]);
  });
});
