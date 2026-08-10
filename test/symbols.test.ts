import { Node, Project } from "ts-morph";
import { describe, expect, it, vi } from "vitest";
import { declarationSignature } from "../src/services/outline.js";
import {
  collectSymbols,
  executableDeclaration,
  findDeclaration,
  searchProjectSymbolsPage,
  sourceFileSymbols,
  symbolMatchRank,
} from "../src/services/symbols.js";

function sourceFile(text: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("/src/symbols.ts", text);
}

describe("symbol location", () => {
  it("ranks exact selectors, paths and names before prefixes and substrings", () => {
    const symbol = { symbolPath: "Api.Client.request", name: "request", line: 42 };

    expect(symbolMatchRank("Api.Client.request@42", symbol)).toBe(0);
    expect(symbolMatchRank("Api.Client.request", symbol)).toBe(1);
    expect(symbolMatchRank("request", symbol)).toBe(2);
    expect(symbolMatchRank("Api.Client", symbol)).toBe(3);
    expect(symbolMatchRank("Client", symbol)).toBe(4);
  });

  it("collects namespace, class members, constructors and function-valued declarations", () => {
    const source = sourceFile(`
export namespace API {
  export class Client {
    constructor(readonly id: string) {}
    request(value: string): string { return value; }
    handler = async (value: number): Promise<number> => value;
  }
}
export const transform = (value: string): string => value;
`);

    expect(collectSymbols(source).map((symbol) => symbol.symbolPath)).toEqual([
      "API",
      "API.Client",
      "API.Client.constructor",
      "API.Client.request",
      "API.Client.handler",
      "transform",
    ]);
    expect(Node.isConstructorDeclaration(findDeclaration(source, "API.Client.constructor"))).toBe(
      true,
    );
    expect(Node.isArrowFunction(executableDeclaration(findDeclaration(source, "transform")))).toBe(
      true,
    );
    expect(
      Node.isArrowFunction(executableDeclaration(findDeclaration(source, "API.Client.handler"))),
    ).toBe(true);
  });

  it("selects the implementation from an overload set", () => {
    const source = sourceFile(`
export function parse(value: string): string;
export function parse(value: number): number;
export function parse(value: string | number): string | number { return value; }
`);
    const declaration = findDeclaration(source, "parse");
    expect(Node.isFunctionDeclaration(declaration) && declaration.getBody()).toBeTruthy();
  });

  it("reports selectors for declarations that remain ambiguous", () => {
    const source = sourceFile(`
interface Parser {
  parse(value: string): string;
  parse(value: number): number;
}
`);
    expect(() => findDeclaration(source, "Parser.parse")).toThrow(/Parser\.parse@/);
  });

  it("formats one selected declaration identically to the full compiler outline", () => {
    const source = sourceFile(`
export class Client {
  constructor(private readonly id: string) {}
  request(value?: number): string { return String(value); }
  handler = (value: string): number => value.length;
}
export interface Parser {
  parse(value: string): string;
  readonly enabled: boolean;
}
export function run(value: string): string { return value; }
export type Result<T> = { value: T };
export enum State { Ready, Done }
export const callback = (value: number): string => String(value);
export namespace API {
  export function nested(): void {}
}
`);
    const signatures = new Map(
      sourceFileSymbols(source, "/").map((symbol) => [symbol.selector, symbol.signature]),
    );

    for (const symbol of collectSymbols(source)) {
      expect(declarationSignature(symbol.node)).toBe(
        signatures.get(`${symbol.symbolPath}@${symbol.line}`),
      );
    }
  });

  it("uses canonical code-point file order and source order within a file", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/src/K.ts", "export const sharedKelvin = 1;\n");
    project.createSourceFile("/src/a.ts", "export const sharedLowercase = 1;\n");
    project.createSourceFile("/src/Ω.ts", "export const sharedOmega = 1;\n");
    project.createSourceFile("/src/Z.ts", "export const sharedZeta = 1, sharedAlpha = 2;\n");

    expect(searchProjectSymbolsPage(project, "/", { query: "shared" }, 0, 5).items).toEqual([
      expect.objectContaining({ file: "src/Z.ts", name: "sharedZeta" }),
      expect.objectContaining({ file: "src/Z.ts", name: "sharedAlpha" }),
      expect.objectContaining({ file: "src/a.ts", name: "sharedLowercase" }),
      expect.objectContaining({ file: "src/Ω.ts", name: "sharedOmega" }),
      expect.objectContaining({ file: "src/K.ts", name: "sharedKelvin" }),
    ]);
  });

  it("continues compiler pagination across the 10,000-result boundary", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "/src/many.ts",
      `export const ${Array.from(
        { length: 10_001 },
        (_, index) => `target${String(index).padStart(5, "0")} = ${index}`,
      ).join(",")};\n`,
    );
    const unselectedFormatting = vi.spyOn(
      sourceFile.getVariableDeclarations()[0],
      "getInitializer",
    );
    const bulkStatements = vi.spyOn(sourceFile, "getStatements").mockImplementation(() => {
      throw new Error("whole-file statements were materialized");
    });
    const bulkDeclarations = vi
      .spyOn(sourceFile, "getVariableDeclarations")
      .mockImplementation(() => {
        throw new Error("whole-file declarations were materialized");
      });

    const first = searchProjectSymbolsPage(project, "/", { query: "target" }, 9_999, 1);
    const continuation = searchProjectSymbolsPage(
      project,
      "/",
      { query: "target" },
      first.next_offset!,
      1,
    );

    expect(first).toMatchObject({
      total: 10_001,
      has_more: true,
      next_offset: 10_000,
      items: [{ name: "target09999" }],
    });
    expect(continuation).toMatchObject({
      total: 10_001,
      has_more: false,
      next_offset: null,
      items: [{ name: "target10000" }],
    });
    expect(searchProjectSymbolsPage(project, "/", { query: "absent-symbol" }, 0, 1)).toMatchObject({
      total: 0,
      items: [],
      has_more: false,
    });
    expect(unselectedFormatting).not.toHaveBeenCalled();
    expect(bulkStatements).not.toHaveBeenCalled();
    expect(bulkDeclarations).not.toHaveBeenCalled();
  }, 120_000);
});
