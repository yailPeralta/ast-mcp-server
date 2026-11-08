import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/angular-template-typecheck-entry.js";
import type { Request } from "../src/services/angular-template-typecheck-protocol.js";

const request: Request = {
  v: 1,
  tsconfig: "/project/tsconfig.json",
  cliEntry: "/project/node_modules/@angular/compiler-cli/index.js",
  templates: ["/project/src/a.component.html"],
  overlay: [{ absolutePath: "/project/src/a.component.html", text: "<p></p>" }],
  maxDiagnostics: 10,
};

describe("template type-check child entry", () => {
  it("runs the core with the validated request and returns its reply unchanged", async () => {
    const reply = { v: 1, ok: false, reason: "work_exhausted" } as const;
    const run = vi.fn(async () => reply);
    expect(await handleRequest(request, run)).toBe(reply);
    expect(run).toHaveBeenCalledWith(request);
  });

  it.each([
    ["a relative path", { ...request, tsconfig: "tsconfig.json" }],
    ["an unknown field", { ...request, extra: true }],
    ["a non-object", "not a request"],
  ])("replies check_failed without running the core for %s", async (_name, raw) => {
    const run = vi.fn();
    expect(await handleRequest(raw, run)).toEqual({ v: 1, ok: false, reason: "check_failed" });
    expect(run).not.toHaveBeenCalled();
  });

  it("imports no compiler-cli private entry", async () => {
    const source = await readFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "src",
        "angular-template-typecheck-entry.ts",
      ),
      "utf8",
    );
    expect(source).toContain("angular-template-typecheck-core.js");
    expect(source).not.toMatch(/\/private\//u);
  });
});
