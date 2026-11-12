import path from "node:path";
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

/** A project pipe, a sibling pipe and a library pipe implement one library interface. */
const PIPE_FILES = {
  "node_modules/pipe-lib/package.json": JSON.stringify({
    name: "pipe-lib",
    version: "1.0.0",
    types: "index.d.ts",
  }),
  "node_modules/pipe-lib/index.d.ts": `export interface PipeTransform {
  /** See {@link PipeTransform.transform}. */
  transform(value: unknown): unknown;
}
export declare class LibPipe implements PipeTransform {
  transform(value: unknown): unknown;
}
`,
  "src/cuit.pipe.ts": `import type { PipeTransform } from "pipe-lib";
export class CuitPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return value;
  }
}
`,
  "src/other.pipe.ts": `import type { PipeTransform } from "pipe-lib";
export class OtherPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return value;
  }
}
`,
  "src/use.ts": `import type { PipeTransform } from "pipe-lib";
import { CuitPipe } from "./cuit.pipe.js";
export const direct = new CuitPipe().transform(1);
const viaContract: PipeTransform = new CuitPipe();
export const indirect = viaContract.transform(2);
export const literal: PipeTransform = { transform: (value) => value };
export const { transform } = new CuitPipe();
`,
};

const HIERARCHY_FILES = {
  "src/hierarchy.ts": `export class Base { run(): void {} }
export class Left extends Base { override run(): void {} }
export class Right extends Base { override run(): void {} }
export class LeftChild extends Left { override run(): void {} }
export const ran = new Base().run();
export const left = new Left().run();
export const right = new Right().run();
export const child = new LeftChild().run();
`,
  "src/contract.ts": `export interface Contract { go(): void }
export interface SubContract extends Contract { go(): void }
export class Impl implements SubContract { go(): void {} }
export class Twin implements Contract { go(): void {} }
`,
};

/** Classes that implement one library hook, each called from its own spec file. */
const HOOK_FILES = {
  "node_modules/hook-lib/package.json": JSON.stringify({
    name: "hook-lib",
    version: "1.0.0",
    types: "index.d.ts",
  }),
  "node_modules/hook-lib/index.d.ts": `export interface OnInit { ngOnInit(): void }
export declare class LibHook implements OnInit { ngOnInit(): void }
`,
  "src/hooks.ts": `import type { OnInit } from "hook-lib";
export class Auth implements OnInit { ngOnInit(): void {} }
export class Login implements OnInit { ngOnInit(): void {} }
export class AuthChild extends Auth {}
`,
  "src/auth.spec.ts": `import type { OnInit } from "hook-lib";
import { Auth, AuthChild, type Login } from "./hooks.js";
new Auth().ngOnInit();
new AuthChild().ngOnInit();
(new Auth() as OnInit).ngOnInit();
(new Auth() as Pick<Auth, "ngOnInit">).ngOnInit();
(new Auth() as Auth | Login).ngOnInit();
(new Auth() as Auth | undefined)?.ngOnInit();
`,
  "src/login.spec.ts": `import { LibHook } from "hook-lib";
import { Login } from "./hooks.js";
new Login().ngOnInit();
new LibHook().ngOnInit();
(new Login() as Login | undefined)?.ngOnInit();
`,
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

async function memberReferences(
  files: Record<string, string>,
  file: string,
  symbolPath: string,
  includeDeclaration = true,
  offset = 0,
  limit = 100,
) {
  const fixture = await createProjectFixture(files);
  fixtures.push(fixture);
  const context = createFreshProject(fixture.root);
  const node = findDeclarationByName(getSourceFileOrThrow(context.project, file), symbolPath);
  return collectSymbolReferences(
    node,
    context.projectRoot,
    symbolPath,
    includeDeclaration,
    "locations",
    offset,
    limit,
  );
}

const position = (item: { file: string; line: number; kind: string }) =>
  `${item.file}:${item.line} ${item.kind}`;

describe("collectSymbolReferences omissions", () => {
  it("lists only the usages of a method that implements a library interface member", async () => {
    const result = await memberReferences(PIPE_FILES, "src/cuit.pipe.ts", "CuitPipe.transform");

    expect(result.references.map(position)).toEqual([
      "src/cuit.pipe.ts:3 ClassDeclaration",
      "src/use.ts:3 PropertyAccessExpression",
      "src/use.ts:5 PropertyAccessExpression",
      "src/use.ts:6 PropertyAssignment",
      "src/use.ts:7 BindingElement",
    ]);
    expect(result.reference_count).toBe(4);
    expect(result.total).toBe(5);
    expect(result.affected_files).toEqual(["src/cuit.pipe.ts", "src/use.ts"]);
    // Library: the JSDoc link, the interface signature and LibPipe. Project: OtherPipe.
    expect(result.omitted_references).toEqual({
      external_library: 3,
      unrelated_declarations: 1,
      unrelated_usages: 0,
    });
    expect(JSON.stringify(result)).not.toContain("node_modules");
  });

  it("paginates the filtered list", async () => {
    const page = await memberReferences(
      PIPE_FILES,
      "src/cuit.pipe.ts",
      "CuitPipe.transform",
      false,
      3,
      2,
    );

    expect(page).toMatchObject({
      reference_count: 4,
      total: 4,
      offset: 3,
      has_more: false,
      next_offset: null,
      omitted_references: { external_library: 3, unrelated_declarations: 1, unrelated_usages: 0 },
    });
    expect(page.references.map(position)).toEqual(["src/use.ts:7 BindingElement"]);
  });

  it("keeps library locations when the requested symbol is a library symbol", async () => {
    const fixture = await createProjectFixture(PIPE_FILES);
    fixtures.push(fixture);
    const context = createFreshProject(fixture.root);
    const library = context.project.getSourceFileOrThrow(
      path.join(context.projectRoot, "node_modules/pipe-lib/index.d.ts"),
    );
    const result = collectSymbolReferences(
      findDeclarationByName(library, "PipeTransform.transform"),
      context.projectRoot,
      "PipeTransform.transform",
      true,
      "locations",
      0,
      100,
    );

    expect(result.affected_files).toContain("node_modules/pipe-lib/index.d.ts");
    expect(result.references.map(position)).toEqual(
      expect.arrayContaining([
        "node_modules/pipe-lib/index.d.ts:6 MethodDeclaration",
        "src/cuit.pipe.ts:3 MethodDeclaration",
        "src/other.pipe.ts:3 MethodDeclaration",
      ]),
    );
    expect(result).not.toHaveProperty("omitted_references");
  });

  it("lists the implementations of an interface member", async () => {
    const result = await memberReferences(HIERARCHY_FILES, "src/contract.ts", "Contract.go");

    expect(result.references.map(position)).toEqual([
      "src/contract.ts:1 InterfaceDeclaration",
      "src/contract.ts:2 MethodSignature",
      "src/contract.ts:3 MethodDeclaration",
      "src/contract.ts:4 MethodDeclaration",
    ]);
    expect(result).not.toHaveProperty("omitted_references");
  });

  it("lists the overrides of a base-class method", async () => {
    const result = await memberReferences(HIERARCHY_FILES, "src/hierarchy.ts", "Base.run");

    expect(result.references.map(position)).toEqual([
      "src/hierarchy.ts:1 ClassDeclaration",
      "src/hierarchy.ts:2 MethodDeclaration",
      "src/hierarchy.ts:3 MethodDeclaration",
      "src/hierarchy.ts:4 MethodDeclaration",
      "src/hierarchy.ts:5 PropertyAccessExpression",
      "src/hierarchy.ts:6 PropertyAccessExpression",
      "src/hierarchy.ts:7 PropertyAccessExpression",
      "src/hierarchy.ts:8 PropertyAccessExpression",
    ]);
    expect(result).not.toHaveProperty("omitted_references");
  });

  it("omits the base declaration, the sibling override and the sibling call of an override", async () => {
    const result = await memberReferences(HIERARCHY_FILES, "src/hierarchy.ts", "Left.run");

    // Calls through the base type, the class itself and its subclass can reach Left.run.
    expect(result.references.map(position)).toEqual([
      "src/hierarchy.ts:2 ClassDeclaration",
      "src/hierarchy.ts:4 MethodDeclaration",
      "src/hierarchy.ts:5 PropertyAccessExpression",
      "src/hierarchy.ts:6 PropertyAccessExpression",
      "src/hierarchy.ts:8 PropertyAccessExpression",
    ]);
    expect(result.reference_count).toBe(4);
    expect(result.omitted_references).toEqual({
      external_library: 0,
      unrelated_declarations: 2,
      unrelated_usages: 1,
    });
  });

  it("omits a structurally identical sibling implementer and the contracts", async () => {
    const result = await memberReferences(HIERARCHY_FILES, "src/contract.ts", "Impl.go");

    expect(result.references.map(position)).toEqual(["src/contract.ts:3 ClassDeclaration"]);
    expect(result.reference_count).toBe(0);
    // Contract, SubContract and Twin.
    expect(result.omitted_references).toEqual({
      external_library: 0,
      unrelated_declarations: 3,
      unrelated_usages: 0,
    });
  });

  it("lists only the calls that can reach the requested implementation of a library hook", async () => {
    const result = await memberReferences(HOOK_FILES, "src/hooks.ts", "Auth.ngOnInit");

    // Kept: the class, its subclass, the contract type, a mapped type, a union with a sibling
    // and an optional chain. Omitted: every call in login.spec.ts.
    expect(result.references.map(position)).toEqual([
      "src/auth.spec.ts:3 PropertyAccessExpression",
      "src/auth.spec.ts:4 PropertyAccessExpression",
      "src/auth.spec.ts:5 PropertyAccessExpression",
      "src/auth.spec.ts:6 PropertyAccessExpression",
      "src/auth.spec.ts:7 PropertyAccessExpression",
      "src/auth.spec.ts:8 PropertyAccessExpression",
      "src/hooks.ts:2 ClassDeclaration",
    ]);
    expect(result.affected_files).toEqual(["src/auth.spec.ts", "src/hooks.ts"]);
    // Project sibling, library sibling and an optional chain on the project sibling.
    expect(result.omitted_references).toEqual({
      external_library: 2,
      unrelated_declarations: 1,
      unrelated_usages: 3,
    });
  });

  it("keeps every call when the requested symbol is the contract member", async () => {
    const result = await memberReferences(HIERARCHY_FILES, "src/hierarchy.ts", "Base.run", false);

    expect(result.reference_count).toBe(7);
    expect(result).not.toHaveProperty("omitted_references");
  });

  it("keeps a declaration whose heritage is longer than the walk bound", async () => {
    const chain = Array.from(
      { length: 300 },
      (_, index) => `interface L${index} extends ${index === 0 ? "Root" : `L${index - 1}`} {}`,
    ).join("\n");
    const result = await memberReferences(
      {
        "src/deep.ts": `interface Root { go(): void }
export class Requested implements Root { go(): void {} }
export class Near implements Root { go(): void {} }
export class Far implements L299 { go(): void {} }
${chain}
`,
      },
      "src/deep.ts",
      "Requested.go",
    );

    expect(result.references.map(position)).toEqual([
      "src/deep.ts:2 ClassDeclaration",
      "src/deep.ts:4 MethodDeclaration",
    ]);
    // Root and Near; Far is as unrelated as Near, but its walk stops at the bound.
    expect(result.omitted_references).toEqual({
      external_library: 0,
      unrelated_declarations: 2,
      unrelated_usages: 0,
    });
  });

  it("adds no omitted_references key when nothing is omitted", async () => {
    expect(await referencesOf("locations", true)).not.toHaveProperty("omitted_references");
  });
});
