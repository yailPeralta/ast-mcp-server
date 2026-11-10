import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectTemplateUsages,
  TemplateScanCache,
  type ScanLimits,
} from "../src/services/angular-templates.js";
import { buildExploreContext, type ExploreRequest } from "../src/services/context-builder.js";
import {
  createFreshProject,
  findDeclarationByName,
  getSourceFileOrThrow,
  type ProjectContext,
} from "../src/services/project.js";
import {
  collectSymbolReferencesWithTemplateVerdict,
  collectSymbolReferencesWithTemplates,
} from "../src/services/references.js";
import {
  NO_REQUEST_CONTEXT,
  RequestContextError,
  type RequestContext,
} from "../src/services/request-context.js";
import { createAngularFixture, type AngularFixture } from "./helpers/angular-fixture.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: actual, readFile: vi.fn(actual.readFile) };
});
const fileRead = vi.mocked(readFile);

/** `AComponent` has three selector-public members, so each one scans every component template. */
const FILES = {
  "src/a.component.ts": `import { Component, Input, Output } from "@angular/core";
@Component({ selector: "app-a", standalone: true, templateUrl: "./a.component.html" })
export class AComponent {
  @Input() title = "x";
  @Input() label = "";
  @Output() save = { emit(): void {} };
}
`,
  "src/a.component.html": `<h1>{{ title }}</h1><p>{{ label }}</p>\n`,
  "src/b.component.ts": `import { Component } from "@angular/core";
import { AComponent } from "./a.component.js";
@Component({ selector: "app-b", standalone: true, imports: [AComponent], templateUrl: "./b.component.html" })
export class BComponent { v = "n"; f(): void {} }
`,
  "src/b.component.html": `<app-a [title]="v" [label]="v" (save)="f()"></app-a>\n<app-a title="lit"></app-a>\n`,
  "src/c.component.ts": `import { Component } from "@angular/core";
import { AComponent } from "./a.component.js";
@Component({ selector: "app-c", standalone: true, imports: [AComponent], template: \`<app-a [label]="1"></app-a>\` })
export class CComponent {}
`,
  "src/d.component.ts": `import { Component } from "@angular/core";
@Component({ selector: "app-d", standalone: true, templateUrl: "./d.component.html" })
export class DComponent {}
`,
  "src/d.component.html": `<p>no binding here</p>\n`,
};
const SYMBOLS = ["AComponent.title", "AComponent.label", "AComponent.save"];
const REQUEST: ExploreRequest = {
  filePath: "src/a.component.ts",
  detail: "full",
  referenceDetail: "locations",
  offset: 0,
  limit: 20,
  referenceLimit: 20,
  maxBytes: 256 * 1024,
};
const QUERY = { includeDeclaration: true, detail: "locations", offset: 0, limit: 20 } as const;

const created: AngularFixture[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((fixture) => fixture.cleanup()));
});

async function setup(files: Record<string, string> = {}): Promise<ProjectContext> {
  const fixture = await createAngularFixture({ ...FILES, ...files }, { compiler: "v21" });
  created.push(fixture);
  return createFreshProject(fixture.root);
}

const nodeOf = (context: ProjectContext, symbol: string) =>
  findDeclarationByName(getSourceFileOrThrow(context.project, "src/a.component.ts"), symbol);

/** Template files read as bytes (the template scan), by basename, since the last reset. */
function templateReads(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [file, options] of fileRead.mock.calls) {
    if (typeof file !== "string" || !file.endsWith(".html") || options !== undefined) continue;
    counts[path.basename(file)] = (counts[path.basename(file)] ?? 0) + 1;
  }
  return counts;
}

/** A collection result without the per-usage matcher closures, which never compare equal. */
async function collect(
  context: ProjectContext,
  symbol: string,
  options: {
    limits?: Partial<ScanLimits>;
    cache?: TemplateScanCache;
    rc?: RequestContext;
  } = {},
) {
  const result = await collectTemplateUsages(
    nodeOf(context, symbol),
    context,
    options.rc ?? NO_REQUEST_CONTEXT,
    options.limits,
    options.cache,
  );
  return {
    ...result,
    usages: result.usages.map(({ elementMatches, ...usage }) => ({
      ...usage,
      matcher: typeof elementMatches,
    })),
  };
}

describe("request-scoped template scan cache", () => {
  it("reads each template file once in an ast_explore request that selects several symbols", async () => {
    const context = await setup();
    fileRead.mockClear();
    const result = await buildExploreContext(context, REQUEST);

    const symbolPath = (selector: string) => selector.split("@")[0]!;
    const selected = result.evidence.filter((item) => SYMBOLS.includes(symbolPath(item.selector)));
    expect(selected.map((item) => symbolPath(item.selector)).sort()).toEqual([...SYMBOLS].sort());
    for (const item of selected) {
      expect(item.references?.template_coverage).toEqual({ status: "completed", templates: 4 });
    }
    expect(templateReads()).toEqual({
      "a.component.html": 1,
      "b.component.html": 1,
      "d.component.html": 1,
    });
  });

  it("returns the references an isolated collection returns for every selected symbol", async () => {
    const context = await setup();
    const result = await buildExploreContext(context, REQUEST);
    expect(result.evidence.length).toBeGreaterThanOrEqual(SYMBOLS.length);
    for (const item of result.evidence) {
      const isolated = await collectSymbolReferencesWithTemplateVerdict(
        nodeOf(context, item.selector),
        context,
        { ...QUERY, symbolPath: item.selector },
      );
      expect(item.references).toEqual(isolated);
    }
  });

  it.each<[string, Partial<ScanLimits>, object]>([
    ["templates", { templates: 2 }, { status: "unfinished", reason: "work_exhausted" }],
    ["bytes", { bytes: 60 }, { status: "unfinished", reason: "work_exhausted" }],
    ["nodes", { nodes: 1 }, { status: "unfinished", reason: "work_exhausted" }],
  ])(
    "charges the %s budget of each symbol in full on a cache hit",
    async (_name, limits, verdict) => {
      const context = await setup();
      const cache = new TemplateScanCache();
      // A complete scan by another symbol leaves every template in the cache.
      expect((await collect(context, "AComponent.title", { cache })).coverage.status).toBe(
        "completed",
      );
      for (const symbol of SYMBOLS) {
        const isolated = await collect(context, symbol, { limits });
        expect(isolated.coverage).toMatchObject(verdict);
        expect(await collect(context, symbol, { limits, cache })).toEqual(isolated);
      }
    },
  );

  it("does not let a scan that stopped early change a later complete scan", async () => {
    const context = await setup();
    const cache = new TemplateScanCache();
    const stopped = await collect(context, "AComponent.title", { limits: { templates: 2 }, cache });
    expect(stopped.coverage).toMatchObject({ status: "unfinished", reason: "work_exhausted" });
    for (const symbol of SYMBOLS) {
      const isolated = await collect(context, symbol);
      expect(isolated.coverage).toEqual({ status: "completed", templates: 4 });
      expect(await collect(context, symbol, { cache })).toEqual(isolated);
    }
  });

  it.each([
    ["template_parse_error", { "src/d.component.html": "<app-a [title]=" }],
    [
      "template_unresolved",
      {
        "src/d.component.ts": FILES["src/d.component.ts"].replace(
          "./d.component.html",
          "./gone.html",
        ),
      },
    ],
    [
      "template_unsafe",
      {
        "src/d.component.ts": FILES["src/d.component.ts"].replace(
          "./d.component.html",
          "../../out.html",
        ),
      },
    ],
  ])("gives every symbol the same %s verdict for a broken template", async (reason, files) => {
    const context = await setup(files);
    const cache = new TemplateScanCache();
    for (const symbol of SYMBOLS) {
      const isolated = await collect(context, symbol);
      expect(isolated.coverage).toMatchObject({ status: "unfinished", reason });
      expect(await collect(context, symbol, { cache })).toEqual(isolated);
    }
  });

  it("retries a template read that threw instead of caching the failure", async () => {
    const context = await setup();
    const cache = new TemplateScanCache();
    fileRead.mockRejectedValueOnce(Object.assign(new Error("EIO: read failed"), { code: "EIO" }));
    await expect(collect(context, "AComponent.title", { cache })).rejects.toThrow("EIO");
    expect(await collect(context, "AComponent.label", { cache })).toEqual(
      await collect(context, "AComponent.label"),
    );
  });

  it.each(["REQUEST_CANCELLED", "OPERATION_DEADLINE_EXCEEDED"] as const)(
    "still raises %s while it serves templates from the cache",
    async (code) => {
      const context = await setup();
      const cache = new TemplateScanCache();
      await collect(context, "AComponent.title", { cache });
      const interruption = new RequestContextError(code);
      let checkpoints = 0;
      const rc: RequestContext = {
        signal: NO_REQUEST_CONTEXT.signal,
        checkpoint(): void {
          // The third checkpoint is inside the consumer scan, after the own template was served.
          if (++checkpoints >= 3) throw interruption;
        },
      };
      fileRead.mockClear();
      await expect(collect(context, "AComponent.label", { cache, rc })).rejects.toBe(interruption);
      expect(checkpoints).toBe(3);
      expect(templateReads()).toEqual({});
    },
  );

  it("keeps nothing between two ast_find_references collections", async () => {
    const context = await setup();
    const query = { ...QUERY, symbolPath: "AComponent.title" };
    const node = nodeOf(context, "AComponent.title");
    fileRead.mockClear();
    const first = await collectSymbolReferencesWithTemplates(node, context, query);
    const afterFirst = templateReads();
    const second = await collectSymbolReferencesWithTemplates(node, context, query);

    expect(second).toEqual(first);
    expect(first.template_coverage).toEqual({ status: "completed", templates: 4 });
    expect(first.template_reference_count).toBe(3);
    expect(Object.keys(afterFirst).sort()).toEqual([
      "a.component.html",
      "b.component.html",
      "d.component.html",
    ]);
    // The second call read every template again: no cache outlives one collection.
    expect(templateReads()).toEqual(
      Object.fromEntries(Object.entries(afterFirst).map(([file, count]) => [file, count * 2])),
    );
  });
});
