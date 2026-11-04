import { afterEach, describe, expect, it } from "vitest";
import {
  createFreshProject,
  findDeclarationByName,
  getSourceFileOrThrow,
} from "../src/services/project.js";
import { collectSymbolReferences } from "../src/services/references.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const FILES = {
  "src/value.ts": `export function formatValue(value: number): string { return String(value); }\n`,
  "src/use.ts": `import { formatValue } from "./value.js";\nexport const result = formatValue(42);\nexport const other = formatValue(7);\n`,
};

const MEMBER_FILES = {
  "src/header.ts": `export class Header {
  toggle(): void {
    this.closeMenu();
  }

  closeMenu(): void {}
}
`,
  "src/use.ts": `import { Header } from "./header.js";\nexport const closed = new Header().closeMenu();\n`,
};

const fixtures: ProjectFixture[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

async function referencesOf(
  detail: "locations" | "context",
  includeDeclaration: boolean,
  offset = 0,
  limit = 100,
) {
  const fixture = await createProjectFixture(FILES);
  fixtures.push(fixture);
  const context = createFreshProject(fixture.root);
  const node = findDeclarationByName(
    getSourceFileOrThrow(context.project, "src/value.ts"),
    "formatValue",
  );
  return collectSymbolReferences(
    node,
    context.projectRoot,
    "formatValue",
    includeDeclaration,
    detail,
    offset,
    limit,
  );
}

describe("collectSymbolReferences", () => {
  it("collectSymbolReferences output unchanged after helper extraction", async () => {
    expect(await referencesOf("locations", true)).toEqual({
      symbol: "formatValue",
      include_declaration: true,
      declaration_count: 1,
      reference_count: 3,
      affected_files: ["src/use.ts", "src/value.ts"],
      references: [
        {
          file: "src/use.ts",
          line: 1,
          column: 10,
          kind: "ImportSpecifier",
          is_declaration: false,
        },
        {
          file: "src/use.ts",
          line: 2,
          column: 23,
          kind: "CallExpression",
          is_declaration: false,
        },
        {
          file: "src/use.ts",
          line: 3,
          column: 22,
          kind: "CallExpression",
          is_declaration: false,
        },
        {
          file: "src/value.ts",
          line: 1,
          column: 1,
          kind: "SourceFile",
          is_declaration: true,
        },
      ],
      offset: 0,
      limit: 100,
      total: 4,
      has_more: false,
      next_offset: null,
    });
  });

  it("keeps context detail, declaration exclusion and pagination unchanged", async () => {
    const withContext = await referencesOf("context", false, 1, 1);
    expect(withContext).toMatchObject({
      include_declaration: false,
      reference_count: 3,
      total: 3,
      offset: 1,
      limit: 1,
      has_more: true,
      next_offset: 2,
    });
    expect(withContext.references).toEqual([
      {
        file: "src/use.ts",
        line: 2,
        column: 23,
        kind: "CallExpression",
        is_declaration: false,
        context: "export const result = formatValue(42);",
      },
    ]);
  });

  it("reports a method declaration once when it is also used before its declaration", async () => {
    const fixture = await createProjectFixture(MEMBER_FILES);
    fixtures.push(fixture);
    const context = createFreshProject(fixture.root);
    const node = findDeclarationByName(
      getSourceFileOrThrow(context.project, "src/header.ts"),
      "Header.closeMenu",
    );
    const collect = (includeDeclaration: boolean) =>
      collectSymbolReferences(
        node,
        context.projectRoot,
        "Header.closeMenu",
        includeDeclaration,
        "locations",
        0,
        100,
      );

    const withoutDeclaration = collect(false);
    expect(withoutDeclaration.reference_count).toBe(2);
    expect(withoutDeclaration.references).toEqual([
      {
        file: "src/header.ts",
        line: 3,
        column: 10,
        kind: "PropertyAccessExpression",
        is_declaration: false,
      },
      {
        file: "src/use.ts",
        line: 2,
        column: 36,
        kind: "PropertyAccessExpression",
        is_declaration: false,
      },
    ]);

    const withDeclaration = collect(true);
    expect(withDeclaration.reference_count).toBe(2);
    expect(withDeclaration.total).toBe(3);
    const declarations = withDeclaration.references.filter((item) => item.is_declaration);
    expect(declarations).toEqual([
      { file: "src/header.ts", line: 6, column: 3, kind: "ClassDeclaration", is_declaration: true },
    ]);
    expect(
      withDeclaration.references.filter((item) => item.file === "src/header.ts" && item.line === 6),
    ).toHaveLength(1);
  });
});
