import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planTemplateEdits } from "../src/services/angular-template-rename.js";
import { collectTemplateUsages } from "../src/services/angular-templates.js";
import {
  createFreshProject,
  findDeclarationByName,
  getSourceFileOrThrow,
} from "../src/services/project.js";
import { NO_REQUEST_CONTEXT } from "../src/services/request-context.js";
import { createAngularFixture, type AngularFixture } from "./helpers/angular-fixture.js";

const fixtures: AngularFixture[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const TARGET = (member: string, selector = "app-a") =>
  [
    'import { Component, Input, Output, input, model, output } from "@angular/core";',
    `@Component({ selector: "${selector}", standalone: true, templateUrl: "./a.component.html" })`,
    "export class AComponent {",
    `  ${member}`,
    "}",
    "",
  ].join("\n");
const CHILD = (imports = "[AComponent]") =>
  [
    'import { Component } from "@angular/core";',
    'import { AComponent } from "./a.component";',
    'import { XDirective } from "./x.directive";',
    `@Component({ selector: "app-child", standalone: true, imports: ${imports}, templateUrl: "./child.component.html" })`,
    "export class ChildComponent {}",
    "",
  ].join("\n");
const DIRECTIVE = (member: string, metadata = "") =>
  [
    'import { Directive, Input } from "@angular/core";',
    `@Directive({ selector: "[appX]", standalone: true${metadata} })`,
    "export class XDirective {",
    `  ${member}`,
    "}",
    "",
  ].join("\n");
const INPUT = '@Input() title = "x";';

/** Plans the edits of `AComponent.title` and returns `old->new` pairs read from the consumer HTML. */
async function plan(member: string, html: string, newName: string, files = {}, selector?: string) {
  const fixture = await createAngularFixture(
    {
      "src/a.component.ts": TARGET(member, selector),
      "src/a.component.html": "<p>none</p>",
      "src/child.component.ts": CHILD(),
      "src/child.component.html": html,
      "src/x.directive.ts": DIRECTIVE('@Input() other = "";'),
      ...files,
    },
    { compiler: "v21" },
  );
  fixtures.push(fixture);
  const context = createFreshProject(fixture.root);
  const node = findDeclarationByName(
    getSourceFileOrThrow(context.project, "src/a.component.ts"),
    "AComponent.title",
  );
  const { usages } = await collectTemplateUsages(node, context, NO_REQUEST_CONTEXT);
  const edits = planTemplateEdits(node, usages, newName, context);
  const text = await readFile(path.join(fixture.root, "src/child.component.html"), "utf8");
  return edits
    .filter(({ usage }) => usage.role === "consumer")
    .map(({ usage, newText }) => `${text.slice(usage.start, usage.end)}->${newText}`);
}

describe("planTemplateEdits rewrite", () => {
  it("gives every consumer key its own newText and leaves the prefix out of the span", async () => {
    expect(
      await plan(INPUT, '<app-a [title]="1" title="lit" bind-title="2"></app-a>', "heading"),
    ).toEqual(["title->heading", "title->heading", "title->heading"]);
  });

  it("maps a model() pair: the event key gets <name>Change", async () => {
    expect(
      await plan(
        'title = model("x");',
        '<app-a [(title)]="v" (titleChange)="f()"></app-a>',
        "value",
      ),
    ).toEqual(["title->value", "titleChange->valueChange"]);
  });

  it("plans no consumer edit for an alias-keyed binding", async () => {
    expect(
      await plan('@Input("label") title = "x";', '<app-a [label]="1"></app-a>', "heading"),
    ).toEqual([]);
  });
});

describe("planTemplateEdits refusals", () => {
  const blocked = { code: "MUTATION_BLOCKED" };

  it("a two-way binding on a non-model pair", async () => {
    await expect(
      plan(
        '@Input() title = "x"; @Output() titleChange = output<string>();',
        '<app-a [(title)]="v"></app-a>',
        "heading",
      ),
    ).rejects.toMatchObject(blocked);
  });

  it.each([
    ["another input", '@Input() title = "x"; @Input() heading = "y";'],
    ["another output", '@Input() title = "x"; @Output() heading = output<string>();'],
    ["another alias", '@Input() title = "x"; @Input("heading") other = "y";'],
  ])("a new name equal to %s", async (_, member) => {
    await expect(plan(member, '<app-a [title]="1"></app-a>', "heading")).rejects.toMatchObject(
      blocked,
    );
  });

  it("a derived <name>Change that collides with an output", async () => {
    await expect(
      plan('title = model("x"); headingChange = output<string>();', "<app-a></app-a>", "heading"),
    ).rejects.toMatchObject(blocked);
  });

  it.each([
    ["new name", "app-a[heading]"],
    ["old name", "app-a[title]"],
  ])("the %s in the target selector", async (_, selector) => {
    await expect(
      plan(INPUT, '<app-a [title]="1"></app-a>', "heading", {}, selector),
    ).rejects.toMatchObject(blocked);
  });

  const SIBLING = {
    "src/child.component.ts": CHILD("[AComponent, XDirective]"),
  };

  it("a sibling directive on the same element that binds the new name", async () => {
    await expect(
      plan(INPUT, '<app-a appX [title]="1"></app-a>', "heading", {
        ...SIBLING,
        "src/x.directive.ts": DIRECTIVE('@Input() heading = "";'),
      }),
    ).rejects.toMatchObject(blocked);
  });

  it("a matching sibling whose names cannot be listed", async () => {
    await expect(
      plan(INPUT, '<app-a appX [title]="1"></app-a>', "heading", {
        ...SIBLING,
        "src/x.directive.ts": `const SHARED = ["other"];\n${DIRECTIVE('other = "";', ", inputs: SHARED")}`,
      }),
    ).rejects.toMatchObject(blocked);
  });

  it("a sibling directive that does not match the element is ignored", async () => {
    expect(
      await plan(INPUT, '<app-a [title]="1"></app-a>', "heading", {
        ...SIBLING,
        "src/x.directive.ts": DIRECTIVE('@Input() heading = "";'),
      }),
    ).toEqual(["title->heading"]);
  });
});
