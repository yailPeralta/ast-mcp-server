import { Node, Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { collectSymbols, executableDeclaration, findDeclaration } from "../src/services/symbols.js";

function sourceFile(text: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("/src/symbols.ts", text);
}

describe("symbol location", () => {
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
});
