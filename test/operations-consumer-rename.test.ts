import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyOperation,
  clearOperationsForTests,
  exportOperationRecord,
  prepareRename,
  setOperationTestHooksForTests,
} from "../src/services/operations.js";
import { classifyPublicError } from "../src/services/public-errors.js";
import { clearProjectSessions } from "../src/services/project.js";
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
  setOperationTestHooksForTests({});
  clearOperationsForTests();
  clearProjectSessions();
  await Promise.all([
    ...fixtures.splice(0).map((fixture) => fixture.cleanup()),
    ...environmentRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ]);
});

const TARGET = (member: string, selector = "app-a", metadata = "") =>
  [
    'import { Component, Input, Output, input, model, output } from "@angular/core";',
    `@Component({ selector: "${selector}", standalone: true, ${metadata}templateUrl: "./a.component.html" })`,
    "export class AComponent {",
    `  ${member}`,
    "}",
    "",
  ].join("\n");

const CHILD = (
  imports = "[AComponent]",
  prelude = "",
  metadata = 'templateUrl: "./a-child.component.html"',
) =>
  [
    'import { Component } from "@angular/core";',
    'import { AComponent } from "./a.component";',
    'import { XDirective } from "./x.directive";',
    prelude,
    `@Component({ selector: "app-child", standalone: true, imports: ${imports}, ${metadata} })`,
    "export class ChildComponent {}",
    "",
  ].join("\n");

const DIRECTIVE = (member: string, metadata = "") =>
  [
    'import { Directive, Input, output } from "@angular/core";',
    `@Directive({ selector: "[appX]", standalone: true${metadata} })`,
    "export class XDirective {",
    `  ${member}`,
    "}",
    "",
  ].join("\n");

const OWN_HTML = "<p>none</p>\n";
const INPUT = '@Input() title = "x";';
const CONSUMER_HTML = "src/a-child.component.html";
const TARGET_TS = "src/a.component.ts";

async function setup(
  member: string,
  html: string,
  files: Record<string, string> = {},
): Promise<AngularFixture> {
  const fixture = await createAngularFixture(
    {
      [TARGET_TS]: TARGET(member),
      "src/a.component.html": OWN_HTML,
      "src/a-child.component.ts": CHILD(),
      [CONSUMER_HTML]: html,
      "src/x.directive.ts": DIRECTIVE('@Input() other = "";'),
      ...files,
    },
    { compiler: "v21" },
  );
  fixtures.push(fixture);
  return fixture;
}

const rename = (fixture: AngularFixture, newName: string, symbolPath = "AComponent.title") =>
  prepareRename({ projectRoot: fixture.root, filePath: TARGET_TS, symbolPath, newName });

async function renamed(fixture: AngularFixture, newName: string, symbolPath?: string) {
  const prepared = await rename(fixture, newName, symbolPath);
  await applyOperation(prepared.operation_id, prepared.plan_hash);
  return prepared;
}

async function expectRefused(
  fixture: AngularFixture,
  code: string,
  newName = "heading",
  symbolPath?: string,
): Promise<void> {
  const before = await Promise.all([TARGET_TS, CONSUMER_HTML].map((file) => fixture.read(file)));
  await expect(rename(fixture, newName, symbolPath)).rejects.toMatchObject({ code });
  expect(await Promise.all([TARGET_TS, CONSUMER_HTML].map((file) => fixture.read(file)))).toEqual(
    before,
  );
}

describe("consumer binding rewrite with per-usage newText (S4)", () => {
  it("rewrites input keys and keeps every prefix and the values", async () => {
    const html =
      '<app-a [title]="1" title="lit" bind-title="2"></app-a>\n<app-a [title]="title"></app-a>\n';
    const fixture = await setup(INPUT, html);

    const prepared = await renamed(fixture, "heading");

    expect(prepared.affected_files.map((file) => file.file)).toEqual([CONSUMER_HTML, TARGET_TS]);
    expect(await fixture.read(CONSUMER_HTML)).toBe(
      '<app-a [heading]="1" heading="lit" bind-heading="2"></app-a>\n<app-a [heading]="title"></app-a>\n',
    );
    expect(await fixture.read(TARGET_TS)).toContain('@Input() heading = "x";');
  });

  it("rewrites output keys including the on- prefix", async () => {
    const fixture = await setup(
      "@Output() save = output<string>();",
      '<app-a (save)="f()" on-save="g()"></app-a>\n',
    );

    await renamed(fixture, "persist", "AComponent.save");

    expect(await fixture.read(CONSUMER_HTML)).toBe(
      '<app-a (persist)="f()" on-persist="g()"></app-a>\n',
    );
  });

  it("maps a model() pair: value and two-way to the new name, the event to <name>Change", async () => {
    const fixture = await setup(
      'title = model("x");',
      '<app-a [(title)]="v" [title]="1" (titleChange)="f()" bindon-title="w"></app-a>\n',
    );

    await renamed(fixture, "value");

    expect(await fixture.read(CONSUMER_HTML)).toBe(
      '<app-a [(value)]="v" [value]="1" (valueChange)="f()" bindon-value="w"></app-a>\n',
    );
  });

  it("renames a literal-aliased member in TypeScript only and keeps alias-keyed bindings", async () => {
    const html = '<app-a [label]="1"></app-a>\n';
    const fixture = await setup('@Input("label") title = "x";', html);

    const prepared = await renamed(fixture, "heading");

    expect(prepared.affected_files.map((file) => file.file)).toEqual([TARGET_TS]);
    expect(await fixture.read(CONSUMER_HTML)).toBe(html);
    expect(await fixture.read(TARGET_TS)).toContain('@Input("label") heading = "x";');
  });

  it("keeps the prepared operation shape and hashes the consumer bytes", async () => {
    const fixture = await setup(INPUT, '<app-a [title]="1"></app-a>\n');

    const prepared = await rename(fixture, "heading");

    expect(Object.keys(prepared)).toEqual([
      "operation_id",
      "plan_hash",
      "kind",
      "status",
      "project_root",
      "created_at",
      "expires_at",
      "affected_files",
      "reference_count",
      "workspace_hash",
      "post_workspace_hash",
      "workspace_file_count",
      "diagnostics",
      "allow_new_errors",
      "blocked",
      "block_reason",
      "preview",
      "preview_truncated",
    ]);
    const record = exportOperationRecord(prepared.operation_id);
    expect(record.files.map((file) => file.file)).toEqual([CONSUMER_HTML, TARGET_TS]);
    expect(record.files[0]!.original_hash).not.toBe(record.files[0]!.updated_hash);
  });
});

describe("consumer rename refuses before any byte is written (S4)", () => {
  it("an inline consumer template is MUTATION_BLOCKED", async () => {
    const fixture = await setup(INPUT, "", {
      "src/a-child.component.ts": CHILD(
        "[AComponent]",
        "",
        "template: '<app-a [title]=\"1\"></app-a>'",
      ),
    });

    await expectRefused(fixture, "MUTATION_BLOCKED");
  });

  it("[(x)] on a non-model input is MUTATION_BLOCKED", async () => {
    const fixture = await setup(
      '@Input() title = "x"; @Output() titleChange = output<string>();',
      '<app-a [(title)]="v"></app-a>\n',
    );

    await expectRefused(fixture, "MUTATION_BLOCKED");
  });

  it.each([
    ["another input", '@Input() title = "x"; @Input() heading = "y";'],
    ["another output", '@Input() title = "x"; @Output() heading = output<string>();'],
    ["another alias", '@Input() title = "x"; @Input("heading") other = "y";'],
  ])("a new name equal to %s is MUTATION_BLOCKED", async (_, member) => {
    const fixture = await setup(member, '<app-a [title]="1"></app-a>\n');

    await expectRefused(fixture, "MUTATION_BLOCKED");
  });

  it("a derived <name>Change that collides with an output is MUTATION_BLOCKED", async () => {
    const fixture = await setup(
      'title = model("x"); headingChange = output<string>();',
      '<app-a [title]="1"></app-a>\n',
    );

    await expectRefused(fixture, "MUTATION_BLOCKED");
  });

  it("a new name that another directive on the same element already binds is MUTATION_BLOCKED", async () => {
    const fixture = await setup(INPUT, '<app-a appX [title]="1"></app-a>\n', {
      "src/a-child.component.ts": CHILD("[AComponent, XDirective]"),
      "src/x.directive.ts": DIRECTIVE('@Input() heading = "";'),
    });

    await expectRefused(fixture, "MUTATION_BLOCKED");
  });

  it("a matching directive whose names cannot be listed is MUTATION_BLOCKED", async () => {
    const fixture = await setup(INPUT, '<app-a appX [title]="1"></app-a>\n', {
      "src/a-child.component.ts": CHILD("[AComponent, XDirective]"),
      "src/x.directive.ts": `const SHARED = ["other"];\n${DIRECTIVE('other = "";', ", inputs: SHARED")}`,
    });

    await expectRefused(fixture, "MUTATION_BLOCKED");
  });

  it("a directive that does not match the element does not block", async () => {
    const fixture = await setup(INPUT, '<app-a [title]="1"></app-a>\n', {
      "src/a-child.component.ts": CHILD("[AComponent, XDirective]"),
      "src/x.directive.ts": DIRECTIVE('@Input() heading = "";'),
    });

    await renamed(fixture, "heading");

    expect(await fixture.read(CONSUMER_HTML)).toBe('<app-a [heading]="1"></app-a>\n');
  });

  it("the $any cast name is MUTATION_BLOCKED", async () => {
    const fixture = await setup(INPUT, '<app-a [title]="1"></app-a>\n');

    await expectRefused(fixture, "MUTATION_BLOCKED", "$any");
  });

  it.each([
    ["new name", "app-a[heading]"],
    ["old name", "app-a[title]"],
  ])("the %s in the target selector is MUTATION_BLOCKED", async (_, selector) => {
    const fixture = await setup(INPUT, '<app-a [title]="1"></app-a>\n', {
      [TARGET_TS]: TARGET(INPUT, selector),
    });

    await expectRefused(fixture, "MUTATION_BLOCKED");
  });

  it.each([
    [
      "an opaque consumer scope",
      { "src/a-child.component.ts": CHILD("SHARED", "const SHARED = [AComponent];") },
    ],
    [
      "an unreadable consumer template",
      { "src/a-child.component.ts": CHILD("[AComponent]", "", "templateUrl: './missing.html'") },
    ],
    [
      "hostDirectives on the target",
      { [TARGET_TS]: TARGET(INPUT, "app-a", "hostDirectives: [], ") },
    ],
    [
      "a non-literal alias",
      { [TARGET_TS]: `const ALIAS = "a";\n${TARGET("@Input(ALIAS) title = 'x';")}` },
    ],
    [
      "a metadata-listed member",
      { [TARGET_TS]: TARGET('title = "x";', "app-a", 'inputs: ["title"], ') },
    ],
  ])("%s is INCOMPLETE_EVIDENCE", async (_, files) => {
    const fixture = await setup(INPUT, '<app-a [title]="1"></app-a>\n', files);

    await expectRefused(fixture, "INCOMPLETE_EVIDENCE");
  });

  it("a @Directive member is INCOMPLETE_EVIDENCE", async () => {
    const fixture = await setup(INPUT, '<app-a appX [other]="1"></app-a>\n', {
      "src/a-child.component.ts": CHILD("[AComponent, XDirective]"),
    });

    await expect(
      prepareRename({
        projectRoot: fixture.root,
        filePath: "src/x.directive.ts",
        symbolPath: "XDirective.other",
        newName: "extra",
      }),
    ).rejects.toMatchObject({ code: "INCOMPLETE_EVIDENCE" });
  });
});

describe("consumer files keep the apply-path guarantees (S4)", () => {
  const prepared = async () => {
    const fixture = await setup(INPUT, '<app-a [title]="1"></app-a>\n');
    const operation = await rename(fixture, "heading");
    return {
      fixture,
      operation,
      apply: () => applyOperation(operation.operation_id, operation.plan_hash),
    };
  };
  const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => undefined,
      (reason: unknown) => reason,
    );

  it("a consumer edited after prepare yields CONFLICT and keeps its bytes", async () => {
    const { fixture, apply } = await prepared();
    await fixture.write(CONSUMER_HTML, "<p>external</p>\n");

    const failure = await failureOf(apply());

    expect(classifyPublicError(failure)).toMatchObject({ code: "CONFLICT" });
    expect(await fixture.read(CONSUMER_HTML)).toBe("<p>external</p>\n");
    expect(await fixture.read(TARGET_TS)).toContain("@Input() title");
  });

  it("a failure after the consumer commit restores the consumer postimage", async () => {
    const { fixture, apply } = await prepared();
    setOperationTestHooksForTests({
      onFilePhase: ({ index, phase }) => {
        if (phase === "before-publish" && index === 1) throw new Error("injected failure");
      },
    });

    await expect(apply()).rejects.toThrow(/rollback succeeded/);

    expect(await fixture.read(CONSUMER_HTML)).toBe('<app-a [title]="1"></app-a>\n');
    expect(await fixture.read(TARGET_TS)).toContain("@Input() title");
  });

  it("a consumer changed during rollback is reported as AMBIGUOUS_APPLY", async () => {
    const { fixture, operation, apply } = await prepared();
    let rollbackArrived!: () => void;
    const rollbackReached = new Promise<void>((resolve) => (rollbackArrived = resolve));
    let releaseRollback!: () => void;
    const rollbackReleased = new Promise<void>((resolve) => (releaseRollback = resolve));
    setOperationTestHooksForTests({
      onFilePhase: async ({ operationId, index, phase }) => {
        if (operationId !== operation.operation_id) return;
        if (phase === "before-publish" && index === 1) throw new Error("later conflict");
        if (phase === "before-rollback" && index === 0) {
          rollbackArrived();
          await rollbackReleased;
        }
      },
    });
    const applying = apply();
    await rollbackReached;
    await fixture.write(CONSUMER_HTML, "<p>externalRollback</p>\n");
    releaseRollback();

    const failure = await failureOf(applying);

    expect(classifyPublicError(failure)).toMatchObject({ code: "AMBIGUOUS_APPLY" });
    expect(await fixture.read(CONSUMER_HTML)).toBe("<p>externalRollback</p>\n");
  });
});
