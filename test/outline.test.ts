import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { buildFileOutline } from "../src/services/outline.js";

describe("file outlines", () => {
  it("preserves declaration contracts without bodies or duplicate syntax", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      "/src/contracts.ts",
      `
export default abstract class Box<T extends object> implements Iterable<T> {
  private value!: T;
  public constructor(value: T) { this.value = value; }
  protected async *map<U>(fn: (value: T) => U): AsyncGenerator<U> { yield fn(this.value); }
  get current(): T { return this.value; }
  set current(value: T) { this.value = value; }
  handler = async <U>(value: U): Promise<U> => value;
}

export async function load<T>(value: Promise<T>): Promise<T> { return value; }
export interface Store<T> extends Iterable<T> {
  get?<U>(key: string): U;
  readonly size: number;
}
export type Maybe<T> = T | null;
export enum State { Ready = "ready", Done = "done" }
export const mapper = async <T>(value: T): Promise<T> => value;
export namespace API {
  export function ping(value: string): string { return value; }
}
`,
    );

    const outline = buildFileOutline(sourceFile);

    expect(outline.text)
      .toBe(`export default abstract class Box<T extends object> implements Iterable<T> {
  private value!: T;
  public constructor(value: T);
  protected async *map<U>(fn: (value: T) => U): AsyncGenerator<U>;
  get current(): T;
  set current(value: T);
  handler: <U>(value: U) => Promise<U>;
}
export async function load<T>(value: Promise<T>): Promise<T>;
export interface Store<T> extends Iterable<T> {
  get?<U>(key: string): U;
  readonly size: number;
}
export type Maybe<T> = T | null;
export enum State { Ready, Done }
export const mapper: <T>(value: T) => Promise<T>;
export namespace API {
  export function ping(value: string): string;
}`);
    expect(outline.text).not.toContain("async async");
    expect(outline.text).not.toContain(";;");
    expect(outline.text).not.toContain("return value");
    expect(outline.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbolPath: "Box", kind: "ClassDeclaration" }),
        expect.objectContaining({ symbolPath: "Box.map", kind: "MethodDeclaration" }),
        expect.objectContaining({ symbolPath: "mapper", kind: "VariableDeclaration" }),
        expect.objectContaining({ symbolPath: "API.ping", kind: "FunctionDeclaration" }),
      ]),
    );
  });
});
