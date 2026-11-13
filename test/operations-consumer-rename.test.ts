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
      // The fixture has no compiler-cli, so the check ran and reported it unavailable.
      "template_diagnostics",
      "block_on_template_errors",
    ]);
    expect(prepared.template_diagnostics).toEqual({
      status: "unavailable",
      reason: "compiler_cli_missing",
      added: [],
      removed: [],
      addedErrors: [],
    });
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
});

describe("@Directive member rename in consumer templates (#478)", () => {
  const DIRECTIVE_TS = "src/x.directive.ts";
  const TARGET_DIRECTIVE = (member: string, selector = '"[appX]"', metadata = "", prelude = "") =>
    [
      'import { Directive, Input, Output, input, model, output } from "@angular/core";',
      prelude,
      `@Directive({ selector: ${selector}, standalone: true${metadata} })`,
      "export class XDirective {",
      `  ${member}`,
      "}",
      "",
    ].join("\n");
  const BOTH = { "src/a-child.component.ts": CHILD("[AComponent, XDirective]") };
  const directiveSetup = (
    member: string,
    html: string,
    files: Record<string, string> = {},
    componentMember = INPUT,
  ) =>
    setup(componentMember, html, { ...BOTH, [DIRECTIVE_TS]: TARGET_DIRECTIVE(member), ...files });
  const renameDirective = (fixture: AngularFixture, symbol: string, newName: string) =>
    prepareRename({
      projectRoot: fixture.root,
      filePath: DIRECTIVE_TS,
      symbolPath: `XDirective.${symbol}`,
      newName,
    });
  const refused = async (
    fixture: AngularFixture,
    symbol: string,
    code: string,
    newName = "extra",
  ) => {
    const read = () => Promise.all([DIRECTIVE_TS, CONSUMER_HTML].map((file) => fixture.read(file)));
    const before = await read();
    await expect(renameDirective(fixture, symbol, newName)).rejects.toMatchObject({ code });
    expect(await read()).toEqual(before);
  };

  it("an alias-keyed binding keeps the template and plans the TypeScript edits", async () => {
    const html = '<input [appX]="form" />\n<p appX></p>\n';
    const fixture = await directiveSetup('@Input("appX") control: unknown = null;', html);

    const prepared = await renameDirective(fixture, "control", "field");
    await applyOperation(prepared.operation_id, prepared.plan_hash);

    expect(prepared.affected_files.map((file) => file.file)).toEqual([DIRECTIVE_TS]);
    expect(await fixture.read(CONSUMER_HTML)).toBe(html);
    expect(await fixture.read(DIRECTIVE_TS)).toContain('@Input("appX") field: unknown = null;');
  });

  it("rewrites property-named input, static, output and model bindings of the directive", async () => {
    const fixture = await directiveSetup(
      '@Input() other = ""; @Output() changed = output<string>(); value = model("x");',
      '<p appX [other]="1" (changed)="f()" [(value)]="v"></p>\n<p appX other="lit" (valueChange)="g()"></p>\n<p [other]="2"></p>\n',
    );

    for (const [symbol, newName] of [
      ["other", "extra"],
      ["changed", "saved"],
      ["value", "amount"],
    ] as const) {
      const prepared = await renameDirective(fixture, symbol, newName);
      await applyOperation(prepared.operation_id, prepared.plan_hash);
      expect(prepared.affected_files.map((file) => file.file)).toEqual([
        CONSUMER_HTML,
        DIRECTIVE_TS,
      ]);
    }

    expect(await fixture.read(CONSUMER_HTML)).toBe(
      '<p appX [extra]="1" (saved)="f()" [(amount)]="v"></p>\n<p appX extra="lit" (amountChange)="g()"></p>\n<p [other]="2"></p>\n',
    );
    expect(await fixture.read(DIRECTIVE_TS)).toContain(
      '@Input() extra = ""; @Output() saved = output<string>(); amount = model("x");',
    );
  });

  it("a sibling on the same element that publishes the old name is MUTATION_BLOCKED", async () => {
    // `[title]` feeds both the component and the directive: rewriting it would unbind the component.
    const fixture = await directiveSetup(
      '@Input() title = "";',
      '<app-a appX [title]="1"></app-a>\n',
    );

    await refused(fixture, "title", "MUTATION_BLOCKED");
    // The same holds in the other direction, for the component member.
    await expectRefused(fixture, "MUTATION_BLOCKED");
  });

  it("a sibling that publishes the old name on another element does not block", async () => {
    const fixture = await directiveSetup(
      '@Input() title = "";',
      '<p appX [title]="1"></p>\n<app-a [title]="2"></app-a>\n',
    );

    const prepared = await renameDirective(fixture, "title", "extra");
    await applyOperation(prepared.operation_id, prepared.plan_hash);

    expect(await fixture.read(CONSUMER_HTML)).toBe(
      '<p appX [extra]="1"></p>\n<app-a [title]="2"></app-a>\n',
    );
  });

  it("the old name in the directive's own selector is MUTATION_BLOCKED", async () => {
    const fixture = await directiveSetup('@Input() appX = "";', '<p [appX]="1"></p>\n');

    await refused(fixture, "appX", "MUTATION_BLOCKED");
  });

  const HOST = (hostDirectives: string) =>
    [
      'import { Directive } from "@angular/core";',
      'import { XDirective } from "./x.directive";',
      "const HOSTS: unknown[] = [];",
      `@Directive({ selector: "[appHost]", standalone: true, hostDirectives: ${hostDirectives} })`,
      "export class HostDirective {}",
      "",
    ].join("\n");
  const DERIVED = [
    'import { Directive } from "@angular/core";',
    'import { XDirective } from "./x.directive";',
    '@Directive({ selector: "[appDerived]", standalone: true })',
    "export class DerivedDirective extends XDirective {}",
    "",
  ].join("\n");
  const PLAIN = '<p appX [other]="1"></p>\n';
  const OTHER = '@Input() other = "";';

  it.each([
    ["an inline microsyntax use", `${PLAIN}<p *appX="1"></p>\n`, {}],
    ["an explicit ng-template use", `${PLAIN}<ng-template appX [other]="1"></ng-template>\n`, {}],
    [
      "hostDirectives elsewhere naming the directive",
      PLAIN,
      { "src/host.ts": HOST("[XDirective]") },
    ],
    [
      "hostDirectives elsewhere with input mappings",
      PLAIN,
      { "src/host.ts": HOST('[{ directive: XDirective, inputs: ["other: alias"] }]') },
    ],
    ["non-literal hostDirectives elsewhere", PLAIN, { "src/host.ts": HOST("HOSTS") }],
    ["a derived directive", PLAIN, { "src/derived.ts": DERIVED }],
    [
      "a non-literal selector",
      PLAIN,
      { [DIRECTIVE_TS]: TARGET_DIRECTIVE(OTHER, "SELECTOR", "", 'const SELECTOR = "[appX]";') },
    ],
    [
      "a non-literal alias",
      PLAIN,
      {
        [DIRECTIVE_TS]: TARGET_DIRECTIVE(
          '@Input(ALIAS) other = "";',
          '"[appX]"',
          "",
          'const ALIAS = "a";',
        ),
      },
    ],
    [
      "a metadata-listed member",
      PLAIN,
      { [DIRECTIVE_TS]: TARGET_DIRECTIVE('other = "";', '"[appX]"', ', inputs: ["other"]') },
    ],
    [
      "an opaque consumer scope",
      PLAIN,
      {
        "src/a-child.component.ts": CHILD("SHARED", "const SHARED = [AComponent, XDirective];"),
      },
    ],
  ])("%s is INCOMPLETE_EVIDENCE", async (_, html, files) => {
    const fixture = await directiveSetup(OTHER, html, files);

    await refused(fixture, "other", "INCOMPLETE_EVIDENCE");
  });

  it("an inline consumer template is MUTATION_BLOCKED", async () => {
    const fixture = await directiveSetup(OTHER, "", {
      "src/a-child.component.ts": CHILD(
        "[AComponent, XDirective]",
        "",
        "template: '<p appX [other]=\"1\"></p>'",
      ),
    });

    await refused(fixture, "other", "MUTATION_BLOCKED");
  });

  it("a plain member of a directive renames without template evidence", async () => {
    const fixture = await directiveSetup(`${OTHER} plain = 1;`, `${PLAIN}<p *appX="1"></p>\n`);

    const prepared = await renameDirective(fixture, "plain", "simple");

    expect(prepared.affected_files.map((file) => file.file)).toEqual([DIRECTIVE_TS]);
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
