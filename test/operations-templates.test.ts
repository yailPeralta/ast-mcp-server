import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as diagnosticsModule from "../src/services/diagnostics.js";
import {
  applyOperation,
  clearOperationsForTests,
  createPlan,
  configureOperationApply,
  exportOperationRecord,
  importOperationRecord,
  prepareRename,
  setOperationTestHooksForTests,
  type AuxiliaryEdit,
  type PersistedOperationRecord,
} from "../src/services/operations.js";
import { classifyPublicError } from "../src/services/public-errors.js";
import {
  clearProjectSessions,
  createFreshProject,
  findDeclarationByName,
  getSourceFileOrThrow,
} from "../src/services/project.js";
import { createRequestContext } from "../src/services/request-context.js";
import {
  createWorkspaceSnapshot,
  hashBytes,
  hashWorkspaceFiles,
} from "../src/services/workspace.js";
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
  setOperationTestHooksForTests({});
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

  it.each([
    ["@Input", `@Input() title = "x";`],
    ["signal input()", `title = input("x");`],
    ["@Output", `@Output() title = output<string>();`],
    ["signal output()", `title = output<string>();`],
    ["model()", `title = model("x");`],
    ["model.required()", `title = model.required<string>();`],
    ["aliased @Input", `@Input("label") title = "x";`],
    ["aliased signal input()", `title = input("x", { alias: "label" });`],
  ])("%s member blocks rename with INCOMPLETE_EVIDENCE before any edit", async (_, member) => {
    const fixture = await renameFixture({
      "src/a.component.ts": RENAME_COMPONENT()
        .replace(
          "import { Component }",
          "import { Component, Input, Output, input, model, output }",
        )
        .replace('  title = "x";', `  ${member}`),
    });

    await expect(renameTitle(fixture)).rejects.toMatchObject({ code: "INCOMPLETE_EVIDENCE" });
    expect(await fixture.read("src/a.component.ts")).toContain(member);
    expect(await fixture.read("src/a.component.html")).toBe(RENAME_TEMPLATE);
  });

  it("pipe transform blocks rename with INCOMPLETE_EVIDENCE", async () => {
    const pipe = [
      'import { Pipe } from "@angular/core";',
      '@Pipe({ name: "fmt" })',
      "export class FmtPipe {",
      "  transform(value: string): string { return value; }",
      "}",
      "",
    ].join("\n");
    const fixture = await renameFixture({ "src/fmt.pipe.ts": pipe });

    await expect(
      prepareRename({
        projectRoot: fixture.root,
        filePath: "src/fmt.pipe.ts",
        symbolPath: "FmtPipe.transform",
        newName: "format",
      }),
    ).rejects.toMatchObject({ code: "INCOMPLETE_EVIDENCE" });
    expect(await fixture.read("src/fmt.pipe.ts")).toBe(pipe);
  });

  const RENAME_DIRECTIVE = (member: string, metadata = "") =>
    [
      'import { Directive, Input, input } from "@angular/core";',
      `@Directive({ selector: "[appA]"${metadata} })`,
      "export class ADirective {",
      `  ${member}`,
      "}",
      "",
    ].join("\n");
  const WITH_INPUTS = (inputs: string) => `templateUrl: "./a.component.html", inputs: [${inputs}]`;

  it.each([
    ["directive @Input", "src/a.directive.ts", RENAME_DIRECTIVE(`@Input() title = "x";`)],
    ["directive signal input()", "src/a.directive.ts", RENAME_DIRECTIVE(`title = input("x");`)],
    [
      "directive outputs metadata",
      "src/a.directive.ts",
      RENAME_DIRECTIVE(`title = "x";`, ', outputs: ["title"]'),
    ],
    ["component inputs metadata", "src/a.component.ts", RENAME_COMPONENT(WITH_INPUTS('"title"'))],
    [
      "component inputs object metadata",
      "src/a.component.ts",
      RENAME_COMPONENT(WITH_INPUTS('{ name: "title", alias: "y" }')),
    ],
  ])(
    "%s blocks rename with INCOMPLETE_EVIDENCE and leaves files untouched",
    async (_, file, source) => {
      const fixture = await renameFixture({ [file]: source });
      const symbolPath = file.includes("directive") ? "ADirective.title" : "AComponent.title";

      await expect(
        prepareRename({
          projectRoot: fixture.root,
          filePath: file,
          symbolPath,
          newName: "heading",
        }),
      ).rejects.toMatchObject({ code: "INCOMPLETE_EVIDENCE" });
      expect(await fixture.read(file)).toBe(source);
      expect(await fixture.read("src/a.component.html")).toBe(RENAME_TEMPLATE);
    },
  );

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

const REWRITTEN_TEMPLATE = RENAME_TEMPLATE.replaceAll("{{ title }}", "{{ heading }}");
const HTML = "src/a.component.html";
const TS = "src/a.component.ts";

async function preparedRename() {
  const fixture = await renameFixture();
  const prepared = await renameTitle(fixture);
  return {
    fixture,
    prepared,
    apply: () => applyOperation(prepared.operation_id, prepared.plan_hash),
  };
}

function holdPhase(operationId: string, index: number, phase: string) {
  let arrive!: () => void;
  const reached = new Promise<void>((resolve) => (arrive = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  setOperationTestHooksForTests({
    onFilePhase: async (event) => {
      if (event.operationId !== operationId || event.index !== index || event.phase !== phase)
        return;
      arrive();
      await released;
    },
  });
  return { reached, release };
}

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

describe("apply-path guarantees for template files (ATN-R1/R2, EWS-R1/R2, TWF-R5)", () => {
  it("html edited after prepare yields CONFLICT", async () => {
    const { fixture, apply } = await preparedRename();
    await fixture.write(HTML, "<h1>external</h1>\n");

    const failure = await failureOf(apply());

    expect(classifyPublicError(failure)).toMatchObject({ code: "CONFLICT" });
    expect(await fixture.read(HTML)).toBe("<h1>external</h1>\n");
    expect(await fixture.read(TS)).toContain("title = ");
  });

  it("TS commit failure after html restores html", async () => {
    const { fixture, apply } = await preparedRename();
    setOperationTestHooksForTests({
      onFilePhase: ({ index, phase }) => {
        if (phase === "before-publish" && index === 1) throw new Error("injected failure");
      },
    });

    await expect(apply()).rejects.toThrow(/rollback succeeded/);

    expect(await fixture.read(HTML)).toBe(RENAME_TEMPLATE);
    expect(await fixture.read(TS)).toContain("title = ");
  });

  it("later target conflict leaves the external TS and restores the owned html", async () => {
    const { fixture, prepared, apply } = await preparedRename();
    const barrier = holdPhase(prepared.operation_id, 0, "after-commit");
    const applying = apply();
    await barrier.reached;
    await fixture.write(TS, "export const externalLaterTarget = true;\n");
    barrier.release();

    const failure = await failureOf(applying);

    expect(await fixture.read(TS)).toBe("export const externalLaterTarget = true;\n");
    expect(classifyPublicError(failure)).toMatchObject({ code: "CONFLICT" });
    expect(await fixture.read(HTML)).toBe(RENAME_TEMPLATE);
  });

  it("rollback proof lost reports honestly (template file earlier in sequence)", async () => {
    const { fixture, prepared, apply } = await preparedRename();
    let rollbackArrived!: () => void;
    const rollbackReached = new Promise<void>((resolve) => (rollbackArrived = resolve));
    let releaseRollback!: () => void;
    const rollbackReleased = new Promise<void>((resolve) => (releaseRollback = resolve));
    setOperationTestHooksForTests({
      onFilePhase: async ({ operationId, index, phase }) => {
        if (operationId !== prepared.operation_id) return;
        if (phase === "before-publish" && index === 1) throw new Error("later conflict");
        if (phase === "before-rollback" && index === 0) {
          rollbackArrived();
          await rollbackReleased;
        }
      },
    });
    const applying = apply();
    await rollbackReached;
    await fixture.write(HTML, "<h1>externalRollback</h1>\n");
    releaseRollback();

    const failure = await failureOf(applying);

    expect(classifyPublicError(failure)).toMatchObject({ code: "AMBIGUOUS_APPLY" });
    expect(await fixture.read(HTML)).toBe("<h1>externalRollback</h1>\n");
  });

  it("receipt persistence failure after commit does not repeat the html mutation", async () => {
    const { fixture, prepared, apply } = await preparedRename();
    const persisted = exportOperationRecord(prepared.operation_id);
    configureOperationApply(prepared.operation_id, {
      receiptWriter: async () => {
        throw new Error("injected receipt failure");
      },
    });

    await expect(apply()).rejects.toThrow(/postimages.*receipt persistence failed/i);
    expect(await fixture.read(HTML)).toBe(REWRITTEN_TEMPLATE);

    clearOperationsForTests();
    importOperationRecord(persisted, prepared.plan_hash);
    const recovered = await applyOperation(prepared.operation_id, prepared.plan_hash);

    expect(recovered.idempotent_replay).toBe(true);
    expect(await fixture.read(HTML)).toBe(REWRITTEN_TEMPLATE);
  });

  it("replay and cancellation with html", async () => {
    const { fixture, prepared } = await preparedRename();
    const controller = new AbortController();
    setOperationTestHooksForTests({
      onFilePhase: ({ index, phase }) => {
        if (phase === "after-commit" && index === 0) controller.abort();
      },
    });

    const first = await applyOperation(
      prepared.operation_id,
      prepared.plan_hash,
      createRequestContext(controller.signal),
    );
    const replay = await applyOperation(prepared.operation_id, prepared.plan_hash);

    expect(first).toMatchObject({ status: "applied", idempotent_replay: false });
    expect(controller.signal.aborted).toBe(true);
    expect(replay).toMatchObject({ idempotent_replay: true });
    expect(await fixture.read(HTML)).toBe(REWRITTEN_TEMPLATE);
    expect(await fixture.read(TS)).toContain("heading = ");
  });

  it("html in receipts and import/export replay", async () => {
    const { fixture, prepared } = await preparedRename();
    const persisted = exportOperationRecord(prepared.operation_id);
    const htmlEntry = persisted.files.find((file) => file.file === HTML)!;
    expect(Buffer.from(htmlEntry.updated_bytes_base64, "base64").toString("utf8")).toBe(
      REWRITTEN_TEMPLATE,
    );
    expect(htmlEntry.original_hash).toBe(hashBytes(Buffer.from(RENAME_TEMPLATE)));

    clearOperationsForTests();
    importOperationRecord(persisted, prepared.plan_hash);
    const applied = await applyOperation(prepared.operation_id, prepared.plan_hash);
    const receipt = exportOperationRecord(prepared.operation_id);

    expect(applied.affected_files).toEqual([HTML, TS]);
    expect(receipt.files.map((file) => file.file)).toEqual([HTML, TS]);
    expect(await fixture.read(HTML)).toBe(REWRITTEN_TEMPLATE);
  });

  it("plan prepared before upgrade conflicts (pre-upgrade plan)", async () => {
    const { fixture, prepared } = await preparedRename();
    const record = exportOperationRecord(prepared.operation_id);
    const snapshot = createWorkspaceSnapshot(createFreshProject(fixture.root));
    const preUpgradeFiles = new Map(
      [...snapshot.files].filter(([filePath]) => !filePath.endsWith(".html")),
    );
    expect(preUpgradeFiles.size).toBe(snapshot.files.size - 1);
    const legacy: PersistedOperationRecord = {
      ...record,
      workspace_hash: hashWorkspaceFiles(preUpgradeFiles),
      workspace_file_count: preUpgradeFiles.size,
    };
    legacy.plan_hash = legacyPlanHash(legacy);
    clearOperationsForTests();
    importOperationRecord(legacy, legacy.plan_hash);

    const failure = await failureOf(applyOperation(legacy.operation_id, legacy.plan_hash));

    expect(classifyPublicError(failure)).toMatchObject({ code: "CONFLICT" });
    expect(await fixture.read(HTML)).toBe(RENAME_TEMPLATE);
    expect(await fixture.read(TS)).toContain("title = ");
  });
});

function legacyPlanHash(operation: PersistedOperationRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 2,
        operation_id: operation.operation_id,
        kind: operation.kind,
        project_root: operation.project_root,
        created_at: operation.created_at,
        expires_at: operation.expires_at,
        reference_count: operation.reference_count,
        workspace_hash: operation.workspace_hash,
        post_workspace_hash: operation.post_workspace_hash,
        workspace_file_count: operation.workspace_file_count,
        diagnostics: operation.diagnostics,
        allow_new_errors: operation.allow_new_errors,
        blocked: operation.blocked,
        files: operation.files.map((file) => ({
          file: file.file,
          original_hash: file.original_hash,
          updated_hash: file.updated_hash,
          mode: file.mode,
        })),
      }),
    )
    .digest("hex");
}
