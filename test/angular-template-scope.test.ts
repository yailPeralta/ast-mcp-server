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
