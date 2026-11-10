import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectTemplateUsages } from "../src/services/angular-templates.js";
import {
  createFreshProject,
  findDeclarationByName,
  getSourceFileOrThrow,
} from "../src/services/project.js";
import {
  collectSymbolReferences,
  collectSymbolReferencesWithTemplateVerdict,
  collectSymbolReferencesWithTemplates,
} from "../src/services/references.js";
import { RequestContextError } from "../src/services/request-context.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

vi.mock("../src/services/angular-templates.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/angular-templates.js")>()),
  collectTemplateUsages: vi.fn(),
}));

const templateHalf = vi.mocked(collectTemplateUsages);
const QUERY = {
  symbolPath: "formatValue",
  includeDeclaration: true,
  detail: "locations",
  offset: 0,
  limit: 100,
} as const;

let fixture: ProjectFixture;
beforeEach(async () => {
  templateHalf.mockReset();
  fixture = await createProjectFixture({
    "src/value.ts": `export function formatValue(value: number): string { return String(value); }\n`,
    "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\n`,
  });
});
afterEach(() => fixture.cleanup());

function open() {
  const context = createFreshProject(fixture.root);
  const node = findDeclarationByName(
    getSourceFileOrThrow(context.project, "src/value.ts"),
    QUERY.symbolPath,
  ) as ReturnType<typeof findDeclarationByName> & { findReferencesAsNodes(): unknown[] };
  return { context, node, tsHalf: vi.spyOn(node, "findReferencesAsNodes") };
}

describe("collectSymbolReferencesWithTemplateVerdict", () => {
  it("turns a template-half failure into a typed verdict and keeps the TypeScript references", async () => {
    templateHalf.mockRejectedValue(new Error("template boom"));
    const { context, node, tsHalf } = open();

    const result = await collectSymbolReferencesWithTemplateVerdict(node, context, QUERY);

    expect(result.template_coverage).toEqual({
      status: "unfinished",
      reason: "template_unresolved",
      templates: 0,
    });
    expect(result).toMatchObject({ reference_count: 2, total: 3, template_reference_count: 0 });
    expect(result.references.map((item) => item.origin)).toEqual([
      "compiler",
      "compiler",
      "compiler",
    ]);
    expect(templateHalf).toHaveBeenCalledTimes(1);
    expect(tsHalf).toHaveBeenCalledTimes(1);
    // The find_references export keeps its error identity.
    await expect(collectSymbolReferencesWithTemplates(node, context, QUERY)).rejects.toThrow(
      "template boom",
    );
  });

  it.each(["REQUEST_CANCELLED", "OPERATION_DEADLINE_EXCEEDED"] as const)(
    "rethrows a cooperative %s raised by the template half",
    async (code) => {
      const interruption = new RequestContextError(code);
      templateHalf.mockRejectedValue(interruption);
      const { context, node, tsHalf } = open();

      await expect(collectSymbolReferencesWithTemplateVerdict(node, context, QUERY)).rejects.toBe(
        interruption,
      );
      expect(tsHalf).not.toHaveBeenCalled();
    },
  );

  it("propagates a TypeScript-half failure unchanged and runs it once", async () => {
    templateHalf.mockResolvedValue({ coverage: { status: "completed", templates: 1 }, usages: [] });
    const { context, node, tsHalf } = open();
    const failure = new Error("ts boom");
    tsHalf.mockImplementation(() => {
      throw failure;
    });

    await expect(collectSymbolReferencesWithTemplateVerdict(node, context, QUERY)).rejects.toBe(
      failure,
    );
    expect(tsHalf).toHaveBeenCalledTimes(1);
  });

  it("returns the plain TypeScript result when coverage is not_applicable", async () => {
    templateHalf.mockResolvedValue({ coverage: { status: "not_applicable" }, usages: [] });
    const { context, node } = open();

    const result = await collectSymbolReferencesWithTemplateVerdict(node, context, QUERY);

    expect(result).toEqual(
      collectSymbolReferences(
        node,
        context.projectRoot,
        QUERY.symbolPath,
        true,
        "locations",
        0,
        100,
      ),
    );
    expect(JSON.stringify(result)).not.toMatch(/origin|template_/);
  });
});
