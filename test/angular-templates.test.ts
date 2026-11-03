import { link, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectTemplateUsages,
  listTemplateFiles,
  type TemplateCoverage,
} from "../src/services/angular-templates.js";
import {
  createFreshProject,
  findDeclarationByName,
  getSourceFileOrThrow,
  type ProjectContext,
} from "../src/services/project.js";
import { NO_REQUEST_CONTEXT, type RequestContext } from "../src/services/request-context.js";
import {
  compilerMajorSupportedByNode,
  createAngularFixture,
  type AngularCompilerAlias,
  type AngularFixture,
} from "./helpers/angular-fixture.js";
import { createProjectFixture } from "./helpers/project-fixture.js";

const COMPONENT = (
  decorator = `templateUrl: "./a.component.html"`,
  extra = "",
  cls = "AComponent",
) =>
  `import { Component } from "@angular/core";
@Component({ selector: "app-a", ${decorator} })
export class ${cls} {
  title = "x"; item = 1; event = 2; items = [1]; limit = 3; user = null; ref = 1;
  count = () => 1;
  save(): void {}
  ${extra}
}
`;

const created: AngularFixture[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((fixture) => fixture.cleanup()));
});

async function setup(
  files: Record<string, string>,
  options: Parameters<typeof createAngularFixture>[1] = { compiler: "v21" },
): Promise<{ root: string; context: ProjectContext; write: AngularFixture["write"] }> {
  const fixture = await createAngularFixture(
    { "src/a.component.ts": COMPONENT(), ...files },
    options,
  );
  created.push(fixture);
  return { root: fixture.root, context: createFreshProject(fixture.root), write: fixture.write };
}

function usagesOf(
  context: ProjectContext,
  symbol: string,
  rc: RequestContext = NO_REQUEST_CONTEXT,
  file = "src/a.component.ts",
) {
  const node = findDeclarationByName(getSourceFileOrThrow(context.project, file), symbol);
  return collectTemplateUsages(node, context, rc);
}

async function coverageOf(
  files: Record<string, string>,
  options?: Parameters<typeof createAngularFixture>[1],
): Promise<TemplateCoverage> {
  const { context } = await setup(files, options);
  return (await usagesOf(context, "AComponent.title")).coverage;
}

/** Fake compiler package whose entry would throw if it were ever evaluated. */
async function writeFakeCompiler(
  write: AngularFixture["write"],
  version: string,
  entry = `throw new Error("must not be evaluated");\n`,
): Promise<void> {
  const dir = "node_modules/@angular/compiler";
  await write(
    `${dir}/package.json`,
    JSON.stringify({
      name: "@angular/compiler",
      version,
      type: "module",
      exports: { ".": "./index.mjs", "./package.json": "./package.json" },
    }),
  );
  await write(`${dir}/index.mjs`, entry);
}

describe("detection and compiler gate", () => {
  it("core absent returns not_applicable and lists no templates", async () => {
    const fixture = await createProjectFixture({
      "src/a.component.ts": COMPONENT(),
      "src/a.component.html": "<p>{{ title }}</p>",
    });
    try {
      const context = createFreshProject(fixture.root);
      expect(await usagesOf(context, "AComponent.title")).toEqual({
        coverage: { status: "not_applicable" },
        usages: [],
      });
      expect(listTemplateFiles(context)).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("compiler missing yields unfinished/compiler_missing", async () => {
    const files = { "src/a.component.html": "<p>{{ title }}</p>" };
    expect(await coverageOf(files, { compiler: null })).toEqual({
      status: "unfinished",
      reason: "compiler_missing",
      templates: 0,
    });
  });

  it.each(["19.2.0", "23.0.0", "20.0.0-next.1"])(
    "out-of-range version %s yields compiler_unsupported without evaluating it",
    async (version) => {
      const { context, write } = await setup(
        { "src/a.component.html": "<p>{{ title }}</p>" },
        { compiler: null },
      );
      await writeFakeCompiler(write, version);
      const { coverage } = await usagesOf(context, "AComponent.title");
      expect(coverage).toMatchObject({ status: "unfinished", reason: "compiler_unsupported" });
    },
  );

  it("missing required export yields compiler_unsupported", async () => {
    const { context, write } = await setup(
      { "src/a.component.html": "<p>{{ title }}</p>" },
      { compiler: null },
    );
    await writeFakeCompiler(write, "21.0.0", "export const parseTemplate = () => ({});\n");
    const { coverage } = await usagesOf(context, "AComponent.title");
    expect(coverage).toMatchObject({ status: "unfinished", reason: "compiler_unsupported" });
  });

  it("realpath outside ancestor node_modules is rejected (os.tmpdir fixture)", async () => {
    const files = { "src/a.component.html": "<p>{{ title }}</p>" };
    expect(await coverageOf(files, { compiler: "v21", location: "os-tmp" })).toMatchObject({
      status: "unfinished",
      reason: "compiler_unsupported",
    });
    // The same layout inside the repository resolves, so the rejection is containment.
    expect((await coverageOf(files, { compiler: "v21" })).status).toBe("completed");
  });

  describe.each([
    ["v20", 20],
    ["v21", 21],
    ["v22", 22],
  ] as const)("compiler %s", (alias: AngularCompilerAlias, major) => {
    it.skipIf(!compilerMajorSupportedByNode(major))("loads supported major", async () => {
      const { context } = await setup(
        { "src/a.component.html": "<p>{{ title }}</p>" },
        { compiler: alias },
      );
      const result = await usagesOf(context, "AComponent.title");
      expect(result.coverage).toEqual({ status: "completed", templates: 1 });
    });
  });

  it("listTemplateFiles does not load the compiler", async () => {
    const { context, root, write } = await setup(
      { "src/a.component.html": "<p>{{ title }}</p>" },
      { compiler: null },
    );
    await writeFakeCompiler(write, "21.0.0");
    const files = listTemplateFiles(context);
    expect(files).toEqual([path.join(root, "src", "a.component.html")]);
    expect(files).not.toBeInstanceOf(Promise);
  });
});

describe("template location", () => {
  it("resolves literal templateUrl", async () => {
    const html = "<p>{{ title }}</p>\n<b>{{ save() }}</b>";
    for (const decorator of [
      `templateUrl: "./a.component.html"`,
      "templateUrl: `a.component.html`",
    ]) {
      const { context, root } = await setup({
        "src/a.component.ts": COMPONENT(decorator),
        "src/a.component.html": html,
      });
      const { coverage } = await usagesOf(context, "AComponent.title");
      expect(coverage).toEqual({ status: "completed", templates: 1 });
      expect(listTemplateFiles(context)).toEqual([path.join(root, "src", "a.component.html")]);
    }
  });

  it("same member name in another component is not a usage", async () => {
    // Ownership is per declaring class: B's missing template must not affect A's coverage.
    const { context } = await setup({
      "src/a.component.html": "<p>{{ title }}</p>",
      "src/b.component.ts": COMPONENT(`templateUrl: "./b.component.html"`, "", "BComponent"),
    });
    const first = await usagesOf(context, "AComponent.title");
    const second = await usagesOf(
      context,
      "BComponent.title",
      NO_REQUEST_CONTEXT,
      "src/b.component.ts",
    );
    expect(first.coverage).toEqual({ status: "completed", templates: 1 });
    expect(second.coverage).toEqual({
      status: "unfinished",
      reason: "template_unresolved",
      templates: 0,
    });
  });

  it("templateUrl escaping root is template_unsafe", async () => {
    const escaped = { status: "unfinished", reason: "template_unsafe", templates: 0 };
    expect(
      await coverageOf({ "src/a.component.ts": COMPONENT(`templateUrl: "../../outside.html"`) }),
    ).toEqual(escaped);
  });

  it("symlink/hardlink template is template_unsafe", async () => {
    const unsafe = { status: "unfinished", reason: "template_unsafe", templates: 0 };
    const symlinked = await setup({ "src/real.html": "<p>{{ title }}</p>" });
    await symlink("real.html", path.join(symlinked.root, "src", "a.component.html"));
    expect((await usagesOf(symlinked.context, "AComponent.title")).coverage).toEqual(unsafe);

    const hardlinked = await setup({ "src/real.html": "<p>{{ title }}</p>" });
    await link(
      path.join(hardlinked.root, "src", "real.html"),
      path.join(hardlinked.root, "src", "a.component.html"),
    );
    const result = await usagesOf(hardlinked.context, "AComponent.title");
    expect(result).toEqual({ coverage: unsafe, usages: [] });
  });

  it("computed templateUrl is template_unresolved", async () => {
    const computed = { status: "unfinished", reason: "template_unresolved", templates: 0 };
    for (const decorator of [
      `templateUrl: TEMPLATE`,
      "templateUrl: `./${'a'}.component.html`",
      `templateUrl: "./missing.html"`,
    ]) {
      const source = `const TEMPLATE = "./a.component.html";\n${COMPONENT(decorator)}`;
      expect(
        await coverageOf({
          "src/a.component.ts": source,
          "src/a.component.html": "<p>{{ title }}</p>",
        }),
      ).toEqual(computed);
    }
  });

  it("derived component yields unsupported/inherited_member", async () => {
    const { context } = await setup({
      "src/a.component.html": "<p>{{ title }}</p>",
      "src/b.component.ts": `import { Component } from "@angular/core";
import { AComponent } from "./a.component";
@Component({ selector: "app-b", template: "<p>{{ title }}</p>" })
export class BComponent extends AComponent {}
`,
    });
    const result = await usagesOf(context, "AComponent.title");
    expect(result.coverage).toEqual({
      status: "unsupported",
      reason: "inherited_member",
      templates: 0,
    });
    expect(result.usages).toEqual([]);
  });
});
