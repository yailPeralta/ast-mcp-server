import { afterEach, describe, expect, it } from "vitest";
import { angularCoreMajor } from "../src/services/angular-decorators.js";
import {
  createScopeResolver,
  ScopeWorkExhausted,
  type ScopeVerdict,
} from "../src/services/angular-template-scope.js";
import { createFreshProject, findDeclarationByName } from "../src/services/project.js";
import { NO_REQUEST_CONTEXT } from "../src/services/request-context.js";
import { createAngularFixture, type AngularFixture } from "./helpers/angular-fixture.js";

const CARD = `import { Component } from "@angular/core";
@Component({ selector: "app-card", template: "", standalone: true })
export class CardComponent {}
`;
const CORE = `import { Component } from "@angular/core";\n`;

const created: AngularFixture[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((fixture) => fixture.cleanup()));
});

async function verdictOf(
  host: string,
  options: {
    coreVersion?: string;
    files?: Record<string, string>;
    visits?: number;
    self?: boolean;
  } = {},
): Promise<ScopeVerdict> {
  const fixture = await createAngularFixture(
    {
      "src/card.ts": CARD,
      "src/host.ts": host,
      "node_modules/ext-lib/package.json": `{"name":"ext-lib","version":"1.0.0","types":"index.d.ts"}`,
      "node_modules/ext-lib/index.d.ts": `export declare class ExtModule {}
export declare class RouterModule { static forChild(): unknown; }\n`,
      ...options.files,
    },
    { compiler: null, coreVersion: options.coreVersion },
  );
  created.push(fixture);
  const context = createFreshProject(fixture.root);
  const at = (file: string, name: string) =>
    findDeclarationByName(context.project.getSourceFileOrThrow(`${fixture.root}/${file}`), name);
  const resolve = createScopeResolver(at("src/card.ts", "CardComponent") as never, {
    coreMajor: angularCoreMajor(context),
    budget: { scopeVisits: options.visits ?? 100 },
    rc: NO_REQUEST_CONTEXT,
  });
  return resolve(
    (options.self
      ? at("src/card.ts", "CardComponent")
      : at("src/host.ts", "HostComponent")) as never,
  );
}

const host = (metadata: string, imports = "") =>
  `${CORE}import { CardComponent } from "./card";\n${imports}
@Component({ selector: "app-host", template: "", ${metadata} })
export class HostComponent {}\n`;

describe("createScopeResolver (standalone)", () => {
  it.each<[string, string, ScopeVerdict]>([
    ["standalone import", host("standalone: true, imports: [CardComponent]"), "includes"],
    ["decoy without import", host("standalone: true, imports: []"), "excludes"],
    ["absent imports", host("standalone: true"), "excludes"],
    [
      "import via alias",
      host("standalone: true, imports: [Card]").replace(
        "{ CardComponent }",
        "{ CardComponent as Card }",
      ),
      "includes",
    ],
    ["standalone as variable", host("standalone: flag, imports: [CardComponent]"), "opaque"],
    [
      "spread",
      host("standalone: true, imports: [...LIST]", "declare const LIST: never[];"),
      "opaque",
    ],
    ["variable", host("standalone: true, imports: LIST", "declare const LIST: never[];"), "opaque"],
    [
      "in-project call",
      host("standalone: true, imports: [make()]", "declare function make(): never;"),
      "opaque",
    ],
    [
      "external module",
      host("standalone: true, imports: [ExtModule]", `import { ExtModule } from "ext-lib";`),
      "excludes",
    ],
    [
      "external call",
      host(
        "standalone: true, imports: [RouterModule.forChild()]",
        `import { RouterModule } from "ext-lib";`,
      ),
      "excludes",
    ],
    [
      "forwardRef from core",
      host(
        "standalone: true, imports: [forwardRef(() => CardComponent)]",
        `import { forwardRef } from "@angular/core";`,
      ),
      "includes",
    ],
    [
      "forwardRef from another module",
      host(
        "standalone: true, imports: [forwardRef(() => CardComponent)]",
        "declare function forwardRef<T>(f: () => T): T;",
      ),
      "opaque",
    ],
  ])("%s -> %s", async (_name, source, expected) => {
    expect(await verdictOf(source)).toBe(expected);
  });

  it("includes the target itself", async () => {
    expect(await verdictOf(host("standalone: true"), { self: true })).toBe("includes");
  });

  it("derives standalone from the core major when the flag is absent", async () => {
    expect(await verdictOf(host("imports: [CardComponent]"))).toBe("includes");
    expect(await verdictOf(host("imports: [CardComponent]"), { coreVersion: "19.0.0" })).toBe(
      "includes",
    );
    expect(await verdictOf(host("imports: [CardComponent]"), { coreVersion: "18.2.0" })).toBe(
      "opaque",
    );
    expect(await verdictOf(host("imports: [CardComponent]"), { coreVersion: "next" })).toBe(
      "opaque",
    );
  });

  it("stops with ScopeWorkExhausted when the visit budget runs out", async () => {
    await expect(
      verdictOf(host("standalone: true, imports: [CardComponent]"), { visits: 0 }),
    ).rejects.toBeInstanceOf(ScopeWorkExhausted);
  });
});

const NG = `import { NgModule, forwardRef } from "@angular/core";\n`;
const IMPORT_CARD = `import { CardComponent } from "./card";\nimport { HostComponent } from "./host";\n`;
const moduleHost = host("standalone: false");
const ngModule = (name: string, metadata: string, prelude = "") =>
  `${NG}${IMPORT_CARD}${prelude}\n@NgModule({ ${metadata} })\nexport class ${name} {}\n`;
const chain = (length: number, tail: string) =>
  Object.fromEntries(
    Array.from({ length }, (_, index) => [
      `src/m${index}.ts`,
      `${NG}${index + 1 < length ? `import { M${index + 1} } from "./m${index + 1}";` : IMPORT_CARD}
@NgModule({ exports: [${index + 1 < length ? `M${index + 1}` : tail}] })
export class M${index} {}\n`,
    ]),
  );

describe("createScopeResolver (NgModule)", () => {
  it.each<[string, Record<string, string>, ScopeVerdict]>([
    [
      "declared next to the target",
      { "src/a.ts": ngModule("A", "declarations: [HostComponent, CardComponent]") },
      "includes",
    ],
    [
      "declared in a module that does not declare the target",
      { "src/a.ts": ngModule("A", "declarations: [HostComponent]") },
      "excludes",
    ],
    [
      "target exported by an imported module",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: [B]",
          `import { B } from "./b";`,
        ),
        "src/b.ts": ngModule("B", "exports: [CardComponent]"),
      },
      "includes",
    ],
    [
      "target declared but not exported by an imported module",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: [B]",
          `import { B } from "./b";`,
        ),
        "src/b.ts": ngModule("B", "declarations: [CardComponent]"),
      },
      "excludes",
    ],
    [
      "re-export chain A -> B -> C",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: [B]",
          `import { B } from "./b";`,
        ),
        "src/b.ts": ngModule("B", "exports: [C]", `import { C } from "./c";`),
        "src/c.ts": ngModule("C", "exports: [CardComponent]"),
      },
      "includes",
    ],
    [
      "import without re-export hides the transitive export",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: [B]",
          `import { B } from "./b";`,
        ),
        "src/b.ts": ngModule("B", "imports: [C]", `import { C } from "./c";`),
        "src/c.ts": ngModule("C", "exports: [CardComponent]"),
      },
      "excludes",
    ],
    [
      "export cycle terminates",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: [B]",
          `import { B } from "./b";`,
        ),
        "src/b.ts": ngModule("B", "exports: [C]", `import { C } from "./c";`),
        "src/c.ts": ngModule("C", "exports: [B]", `import { B } from "./b";`),
      },
      "excludes",
    ],
    [
      "forwardRef in exports",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: [B]",
          `import { B } from "./b";`,
        ),
        "src/b.ts": ngModule("B", "exports: [forwardRef(() => CardComponent)]"),
      },
      "includes",
    ],
    [
      "external module import",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: [ExtModule]",
          `import { ExtModule } from "ext-lib";`,
        ),
      },
      "excludes",
    ],
    ["no declaring module", {}, "opaque"],
    [
      "declared in two modules",
      {
        "src/a.ts": ngModule("A", "declarations: [HostComponent]"),
        "src/b.ts": ngModule("B", "declarations: [HostComponent]"),
      },
      "opaque",
    ],
    [
      "spread in declarations",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent, ...LIST]",
          "declare const LIST: never[];",
        ),
      },
      "opaque",
    ],
    [
      "variable imports",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: LIST",
          "declare const LIST: never[];",
        ),
      },
      "opaque",
    ],
    [
      "in-project call in imports",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: [make()]",
          "declare function make(): never;",
        ),
      },
      "opaque",
    ],
    [
      "non-literal exports of an imported module",
      {
        "src/a.ts": ngModule(
          "A",
          "declarations: [HostComponent], imports: [B]",
          `import { B } from "./b";`,
        ),
        "src/b.ts": ngModule("B", "exports: LIST", "declare const LIST: never[];"),
      },
      "opaque",
    ],
    [
      "another module with non-literal declarations",
      {
        "src/a.ts": ngModule("A", "declarations: [HostComponent]"),
        "src/b.ts": ngModule("B", "declarations: LIST", "declare const LIST: never[];"),
      },
      "opaque",
    ],
    ["export chain within the depth cap", chain(30, "CardComponent"), "includes"],
    ["export chain beyond the depth cap", chain(40, "CardComponent"), "opaque"],
  ])("module-declared consumer: %s -> %s", async (_name, files, expected) => {
    const withChain = Object.keys(files).some((file) => file.startsWith("src/m"));
    const all = withChain
      ? {
          ...files,
          "src/a.ts": ngModule(
            "A",
            "declarations: [HostComponent], imports: [M0]",
            `import { M0 } from "./m0";`,
          ),
        }
      : files;
    expect(await verdictOf(moduleHost, { files: all })).toBe(expected);
  });

  it.each<[string, string, ScopeVerdict]>([
    ["imports a module exporting the target", "exports: [CardComponent]", "includes"],
    ["imports a module that only declares the target", "declarations: [CardComponent]", "excludes"],
    ["imports a module with non-literal exports", "exports: LIST", "opaque"],
  ])("standalone consumer %s -> %s", async (_name, metadata, expected) => {
    const source = host(
      "standalone: true, imports: [Shared]",
      `import { Shared } from "./shared";`,
    );
    const shared = ngModule("Shared", metadata, "declare const LIST: never[];");
    expect(await verdictOf(source, { files: { "src/shared.ts": shared } })).toBe(expected);
  });

  it("uses the core major to choose between module and standalone when the flag is absent", async () => {
    const files = { "src/a.ts": ngModule("A", "declarations: [HostComponent, CardComponent]") };
    const absent = host("");
    expect(await verdictOf(absent, { files, coreVersion: "18.2.0" })).toBe("includes");
    expect(await verdictOf(absent, { files, coreVersion: "19.0.0" })).toBe("excludes");
  });

  it("stops with ScopeWorkExhausted while flattening a deep export chain", async () => {
    const files = {
      ...chain(10, "CardComponent"),
      "src/a.ts": ngModule(
        "A",
        "declarations: [HostComponent], imports: [M0]",
        `import { M0 } from "./m0";`,
      ),
    };
    await expect(verdictOf(moduleHost, { files, visits: 5 })).rejects.toBeInstanceOf(
      ScopeWorkExhausted,
    );
  });
});
