import { describe, expect, it } from "vitest";
import {
  MAX_WIRE_DIAGNOSTICS,
  RequestSchema,
  ResponseSchema,
  parseResponse,
  type Response,
} from "../src/services/angular-template-typecheck-protocol.js";

const diagnostic = {
  code: 2339,
  category: "error",
  file: "src/a.component.html",
  line: 3,
  column: 5,
  message: "Property 'x' does not exist on type 'A'.",
  start: 42,
  length: 1,
};
const request = {
  v: 1,
  tsconfig: "/p/tsconfig.json",
  cliEntry: "/p/node_modules/@angular/compiler-cli/bundles/index.js",
  templates: ["/p/src/a.component.html"],
  overlay: [{ absolutePath: "/p/src/a.component.ts", text: "export class A {}" }],
  maxDiagnostics: 5000,
};

describe("template type-check IPC v1", () => {
  it("round-trips a request through JSON", () => {
    expect(RequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
  });

  it("round-trips completed and failed responses through JSON", () => {
    const completed: Response = { v: 1, ok: true, before: [diagnostic], after: [diagnostic] };
    const failed: Response = { v: 1, ok: false, reason: "typescript_incompatible" };
    expect(ResponseSchema.parse(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
    expect(ResponseSchema.parse(JSON.parse(JSON.stringify(failed)))).toEqual(failed);
  });

  it.each([
    ["wrong version", { ...request, v: 2 }],
    ["unknown key", { ...request, extra: true }],
    ["relative tsconfig", { ...request, tsconfig: "tsconfig.json" }],
    ["non-string overlay text", { ...request, overlay: [{ absolutePath: "/p/a.ts", text: 1 }] }],
    ["zero diagnostic cap", { ...request, maxDiagnostics: 0 }],
    ["cap above the protocol limit", { ...request, maxDiagnostics: MAX_WIRE_DIAGNOSTICS + 1 }],
  ])("rejects a request with %s", (_label, value) => {
    expect(RequestSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an overlay above the byte cap", () => {
    const big = { absolutePath: "/p/a.ts", text: "a".repeat(32 * 1024 * 1024 + 1) };
    expect(RequestSchema.safeParse({ ...request, overlay: [big] }).success).toBe(false);
  });

  it.each([
    [
      "failed response carrying arrays",
      { v: 1, ok: false, reason: "check_failed", before: [], after: [] },
    ],
    ["failed response with a reason outside the wire set", { v: 1, ok: false, reason: "deadline" }],
    ["completed response without arrays", { v: 1, ok: true }],
  ])("rejects %s", (_label, value) => {
    expect(ResponseSchema.safeParse(value).success).toBe(false);
  });

  it("classifies responses as valid, oversized or malformed", () => {
    expect(parseResponse({ v: 1, ok: true, before: [], after: [diagnostic] })).toMatchObject({
      status: "valid",
    });
    const many = Array.from({ length: MAX_WIRE_DIAGNOSTICS + 1 }, () => diagnostic);
    expect(parseResponse({ v: 1, ok: true, before: many, after: [] })).toEqual({
      status: "oversized",
    });
    expect(parseResponse({ v: 1, ok: true, before: [], after: many })).toEqual({
      status: "oversized",
    });
    expect(parseResponse({ v: 1, ok: true })).toEqual({ status: "malformed" });
    expect(parseResponse("nope")).toEqual({ status: "malformed" });
    expect(parseResponse(null)).toEqual({ status: "malformed" });
  });

  it("types non-completed responses without diagnostics arrays", () => {
    // @ts-expect-error a failed response cannot carry diagnostics
    const invalid: Response = { v: 1, ok: false, reason: "check_failed", before: [] };
    expect(invalid.ok).toBe(false);
  });
});
