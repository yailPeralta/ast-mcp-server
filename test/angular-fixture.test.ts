import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANGULAR_FIXTURE_ROOT,
  compilerMajorSupportedByNode,
  createAngularFixture,
  type AngularFixture,
} from "./helpers/angular-fixture.js";

describe("createAngularFixture", () => {
  const created: AngularFixture[] = [];
  afterEach(async () => {
    await Promise.all(created.splice(0).map((fixture) => fixture.cleanup()));
  });
  async function make(...args: Parameters<typeof createAngularFixture>): Promise<AngularFixture> {
    const fixture = await createAngularFixture(...args);
    created.push(fixture);
    return fixture;
  }

  it("resolves the aliased compiler through createRequire from the fixture dir", async () => {
    const fixture = await make({ "src/a.ts": "export const a = 1;\n" }, { compiler: "v20" });
    const requireFromFixture = createRequire(path.join(fixture.root, "tsconfig.json"));

    const corePackage = JSON.parse(
      await readFile(requireFromFixture.resolve("@angular/core/package.json"), "utf8"),
    ) as { name: string };
    expect(corePackage.name).toBe("@angular/core");

    const compilerPackagePath = requireFromFixture.resolve("@angular/compiler/package.json");
    const compilerPackage = JSON.parse(await readFile(compilerPackagePath, "utf8")) as {
      name: string;
      version: string;
    };
    expect(compilerPackage.name).toBe("@angular/compiler");
    expect(compilerPackage.version).toMatch(/^20\./u);
    const repositoryNodeModules = await realpath(
      path.join(ANGULAR_FIXTURE_ROOT, "..", "..", "node_modules"),
    );
    expect(compilerPackagePath.startsWith(repositoryNodeModules + path.sep)).toBe(true);

    const other = await make({}, { compiler: "v21" });
    const otherPackage = JSON.parse(
      await readFile(
        createRequire(path.join(other.root, "tsconfig.json")).resolve(
          "@angular/compiler/package.json",
        ),
        "utf8",
      ),
    ) as { version: string };
    expect(otherPackage.version).toMatch(/^21\./u);
  });

  it("fixture with compiler:null has no compiler", async () => {
    const fixture = await make({}, { compiler: null });
    const requireFromFixture = createRequire(path.join(fixture.root, "tsconfig.json"));
    expect(requireFromFixture.resolve("@angular/core/package.json")).toContain(
      path.join(fixture.root, "node_modules", "@angular", "core"),
    );
    expect(() => requireFromFixture.resolve("@angular/compiler/package.json")).toThrow(
      /Cannot find module/u,
    );
  });

  it("places the fixture under the repo-local .tmp directory unless os-tmp is requested", async () => {
    const local = await make({}, { compiler: null });
    expect(local.root.startsWith(ANGULAR_FIXTURE_ROOT + path.sep)).toBe(true);
    const outside = await make({}, { compiler: "v20", location: "os-tmp" });
    expect(outside.root.startsWith((await realpath(os.tmpdir())) + path.sep)).toBe(true);
  });

  it("declares the module-scope surface of @angular/core", async () => {
    const fixture = await make({}, { compiler: null });
    const declarations = await readFile(
      path.join(fixture.root, "node_modules", "@angular", "core", "index.d.ts"),
      "utf8",
    );
    for (const name of [
      "NgModule",
      "Directive",
      "forwardRef",
      "imports?",
      "declarations?",
      "exports?",
      "standalone?",
      "inputs?",
      "outputs?",
    ]) {
      expect(declarations).toContain(name);
    }
  });

  it("reports which compiler majors the running Node can execute", () => {
    expect(compilerMajorSupportedByNode(20, "22.13.0")).toBe(true);
    expect(compilerMajorSupportedByNode(22, "22.13.0")).toBe(false);
    expect(compilerMajorSupportedByNode(22, "22.22.3")).toBe(true);
    expect(compilerMajorSupportedByNode(22, "24.14.9")).toBe(false);
    expect(compilerMajorSupportedByNode(22, "24.15.0")).toBe(true);
    expect(compilerMajorSupportedByNode(22, "26.0.0")).toBe(true);
  });
});
