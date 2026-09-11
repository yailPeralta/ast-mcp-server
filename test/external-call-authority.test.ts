import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Node, Project, SyntaxKind } from "ts-morph";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { clearProjectSessions } from "../src/services/project.js";
import { collectCompilerCallRelationships } from "../src/services/relationships.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const freshness = {
  state: "fresh" as const,
  causes: [] as const,
  checked_at: "2026-08-18T00:00:00Z",
};
const cases = [
  {
    name: "original local-external conditional",
    source: [
      "import { External } from 'ext';",
      "class Local { method():void {} }",
      "export function invoke(flag:boolean):void { (flag ? new Local() : new External()).method(); }",
    ].join("\n"),
    target: "Local.method",
    ambiguous: true,
    scopedExact: false,
  },
  {
    name: "local-local conditional control",
    source: [
      "class Local { method():void {} }",
      "class Other { method():void {} }",
      "export function invoke(flag:boolean):void { (flag ? new Local() : new Other()).method(); }",
    ].join("\n"),
    target: "Local.method",
    ambiguous: true,
    scopedExact: false,
  },
  {
    name: "same-selector alternatives in different files",
    source: [
      "class Local { method():void {} }",
      "import { Local as Other } from './other.js';",
      "export function invoke(flag:boolean):void { (flag ? new Local() : new Other()).method(); }",
    ].join("\n"),
    target: "Local.method",
    ambiguous: true,
    scopedExact: false,
  },
  {
    name: "exact local method control",
    source: [
      "class Local { method():void {} }",
      "export function invoke():void { new Local().method(); }",
    ].join("\n"),
    target: "Local.method",
    ambiguous: false,
    scopedExact: false,
  },
  {
    name: "exact local identifier control",
    source: ["function local():void {}", "export function invoke():void { local(); }"].join("\n"),
    target: "local",
    ambiguous: false,
    scopedExact: true,
  },
];

// Deliberately use the public in-memory MCP seam, not a rebuilt dist artifact.
// Each fixture is isolated so another case cannot introduce unrelated semantic gaps.
describe.each(cases)("#220: $name", ({ name, source, target, ambiguous, scopedExact }) => {
  let fixture: ProjectFixture;
  let project: Project;
  let client: Client;
  let server: ReturnType<typeof createServer>;
  const file = "src/case.test.ts";

  beforeAll(async () => {
    fixture = await createProjectFixture({
      [file]: source,
      "src/other.ts": "export class Local { method():void {} }\n",
      "src/unrelated.ts": "export function unrelated(): void {}\n",
      "node_modules/ext/package.json": JSON.stringify({ name: "ext", types: "index.d.ts" }),
      "node_modules/ext/index.d.ts": "export declare class External { method(): void; }\n",
    });
    project = new Project({ tsConfigFilePath: path.join(fixture.root, "tsconfig.json") });
    server = createServer();
    client = new Client({ name: "external-call-authority-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    clearProjectSessions();
    await fixture?.cleanup();
  });

  async function call(tool: string, args: Record<string, unknown> = {}) {
    return client.callTool({
      name: tool,
      arguments: { project_root: fixture.root, file_path: file, symbol_path: target, ...args },
    });
  }

  function structured(result: Awaited<ReturnType<typeof call>>) {
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toBeTypeOf("object");
    return result.structuredContent as Record<string, unknown>;
  }

  it("fixture compiles without any or unresolved dependency", () => {
    expect(
      project.getPreEmitDiagnostics().map((diagnostic) => diagnostic.getMessageText()),
    ).toEqual([]);
    const sourceFile = project.getSourceFileOrThrow(path.join(fixture.root, file));
    const invocation = sourceFile.getFirstDescendantByKindOrThrow(SyntaxKind.CallExpression);
    expect(invocation.getExpression().getType().isAny()).toBe(false);
    if (name !== "original local-external conditional") return;
    const dependency = sourceFile.getImportDeclarations()[0]!.getModuleSpecifierSourceFileOrThrow();
    expect(dependency.getFilePath()).toBe(path.join(fixture.root, "node_modules/ext/index.d.ts"));
    expect(dependency.isDeclarationFile()).toBe(true);
    const expression = invocation.getExpression();
    expect(Node.isPropertyAccessExpression(expression)).toBe(true);
    if (!Node.isPropertyAccessExpression(expression)) throw new Error("Expected property call");
    const receiver = expression.getExpression().getType();
    expect(receiver.isAny()).toBe(false);
    expect(
      receiver
        .getUnionTypes()
        .map((type) => type.getSymbol()?.getName())
        .sort(),
    ).toEqual(["External", "Local"]);
    expect(
      expression
        .getSymbolOrThrow()
        .getDeclarations()
        .map((declaration) =>
          path.relative(fixture.root, declaration.getSourceFile().getFilePath()),
        )
        .sort(),
    ).toEqual(["node_modules/ext/index.d.ts", file]);
  });

  it("whole-project collector admits only converged local call targets", () => {
    const calls = collectCompilerCallRelationships(project, fixture.root, freshness);
    const toTarget = calls.edges.filter((edge) => edge.target.symbol_path === target);
    if (ambiguous) {
      expect(toTarget).toEqual([]);
    } else {
      expect(toTarget).toMatchObject([
        { source: { symbol_path: "invoke" }, confidence: "exact", compiler_authoritative: true },
      ]);
    }
  });

  it("whole-project collector retains ambiguous dispatch as semantic incompleteness", () => {
    const calls = collectCompilerCallRelationships(project, fixture.root, freshness);
    expect(calls.bounded_incomplete).toBe(false);
    expect(calls.incomplete).toBe(ambiguous);
  });

  it("public incoming spines never certify ambiguous dispatch or prove false emptiness", async () => {
    const result = structured(
      await call("ast_explore", {
        call_spines: { direction: "incoming", max_depth: 4, max_nodes: 20, max_edges: 20 },
        max_bytes: 16384,
      }),
    );
    expect(result.call_spines).toMatchObject({
      authority_state: ambiguous ? "incomplete" : "authoritative",
      incomplete: ambiguous,
      empty_proven: false,
      truncation_reasons: [],
    });
    if (!ambiguous)
      expect(result.call_spines).toMatchObject({
        paths: [{ endpoint: { symbol_path: "invoke" } }],
      });
  });

  it("public outgoing spines preserve the caller's uncertainty", async () => {
    const result = structured(
      await call("ast_explore", {
        symbol_path: "invoke",
        call_spines: { direction: "outgoing" },
        max_bytes: 16384,
      }),
    );
    expect(result.call_spines).toMatchObject({
      authority_state: ambiguous ? "incomplete" : "authoritative",
      incomplete: ambiguous,
      empty_proven: false,
      truncation_reasons: [],
    });
  });

  it("semantic gaps do not contaminate an unrelated incoming root", async () => {
    const result = structured(
      await call("ast_explore", {
        file_path: "src/unrelated.ts",
        symbol_path: "unrelated",
        call_spines: { direction: "incoming" },
        max_bytes: 16384,
      }),
    );
    expect(result.call_spines).toMatchObject({
      authority_state: "authoritative",
      incomplete: false,
      empty_proven: true,
      paths: [],
    });
  });

  it("exhausted traversal retains bounded incompleteness", () => {
    expect(
      collectCompilerCallRelationships(project, fixture.root, freshness, { max_work_items: 1 }),
    ).toMatchObject({ bounded_incomplete: true, incomplete: true });
  });

  it("public scoped incoming impact preserves the conservative property-call boundary", async () => {
    const result = structured(
      await call("ast_get_impact", {
        direction: "incoming",
        relationship_kinds: ["call"],
        max_depth: 4,
        max_nodes: 20,
        max_edges: 20,
      }),
    );
    expect(result).toMatchObject({
      coverage: [
        { kind: "call", direction: "incoming", status: scopedExact ? "completed" : "unfinished" },
      ],
      incomplete: !scopedExact,
      proven_empty: false,
      // The existing scoped deferred-call path also reports discovery truncation.
      // This is characterization, not a claim that the traversal budget ran out.
      truncation: { truncated: !scopedExact },
    });
    if (!scopedExact) expect(result.edges).toEqual([]);
  });

  it("public test candidates fail closed for deferred property dispatch", async () => {
    const result = await call("ast_find_test_candidates", {
      max_depth: 4,
      max_nodes: 20,
      max_edges: 20,
    });
    if (scopedExact) {
      // Candidate projection deliberately excludes the root file itself.
      expect(structured(result)).toMatchObject({
        completeness: { complete: true, proven_empty: true },
      });
    } else {
      expect(result.isError).toBe(true);
      expect(result).not.toHaveProperty("structuredContent");
      expect(result.content).toEqual([
        { type: "text", text: expect.stringContaining('"code":"INCOMPLETE_EVIDENCE"') },
      ]);
    }
  });
});
