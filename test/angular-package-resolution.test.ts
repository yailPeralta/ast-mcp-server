import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSupportedVersion,
  isUnderAncestorNodeModules,
  isWithin,
  resolveFrom,
} from "../src/services/angular-package-resolution.js";
import { ANGULAR_FIXTURE_ROOT } from "./helpers/angular-fixture.js";
import { createProjectFixture } from "./helpers/project-fixture.js";

describe("isWithin", () => {
  it("accepts descendants and rejects the parent, siblings and escapes", () => {
    expect(isWithin("/a/b", "/a/b/c/d")).toBe(true);
    expect(isWithin("/a/b", "/a/b")).toBe(true);
    expect(isWithin("/a/b", "/a/bc")).toBe(false);
    expect(isWithin("/a/b", "/a")).toBe(false);
    expect(isWithin("/a/b", "/x/y")).toBe(false);
  });
});

describe("isUnderAncestorNodeModules", () => {
  it("accepts a package inside a node_modules owned by the project or an ancestor", () => {
    expect(
      isUnderAncestorNodeModules("/repo/app/node_modules/@angular/core", "/repo/app/src"),
    ).toBe(true);
    expect(isUnderAncestorNodeModules("/repo/node_modules/@angular/core", "/repo/app")).toBe(true);
  });

  it("rejects a package whose node_modules is not an ancestor of the project", () => {
    expect(isUnderAncestorNodeModules("/other/node_modules/@angular/core", "/repo/app")).toBe(
      false,
    );
    expect(isUnderAncestorNodeModules("/repo/app/vendor/@angular/core", "/repo/app")).toBe(false);
  });
});

describe("isSupportedVersion", () => {
  it.each(["18.0.0", "18.2.14", "20.3.34", "22.2.4", "21.0.0-rc.1", "22.0.0+build.5"])(
    "accepts %s",
    (version) => {
      expect(isSupportedVersion(version)).toBe(true);
    },
  );

  it.each(["17.3.12", "23.0.0", "18.0.0-next.1", "18", "x.y.z", "", undefined, 21])(
    "rejects %s",
    (version) => {
      expect(isSupportedVersion(version)).toBe(false);
    },
  );
});

describe("resolveFrom", () => {
  it("resolves an installed package and returns undefined for a missing one", async () => {
    const fixture = await createProjectFixture(
      { "tsconfig.json": "{}" },
      { parentDir: ANGULAR_FIXTURE_ROOT },
    );
    try {
      const root = await realpath(fixture.root);
      const pkg = path.join(root, "node_modules", "left-pad");
      await mkdir(pkg, { recursive: true });
      await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "left-pad" }));
      const tsconfig = path.join(root, "tsconfig.json");
      expect(resolveFrom(tsconfig, "left-pad/package.json")).toBe(path.join(pkg, "package.json"));
      expect(resolveFrom(tsconfig, "not-installed/package.json")).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns the lexical path of a symlink that leaves the project, for the caller to reject", async () => {
    const outside = await createProjectFixture({ "package.json": '{"name":"escape"}' });
    const fixture = await createProjectFixture(
      { "tsconfig.json": "{}" },
      { parentDir: ANGULAR_FIXTURE_ROOT },
    );
    try {
      const root = await realpath(fixture.root);
      await mkdir(path.join(root, "node_modules"), { recursive: true });
      await symlink(await realpath(outside.root), path.join(root, "node_modules", "escape"), "dir");
      const resolved = resolveFrom(path.join(root, "tsconfig.json"), "escape/package.json");
      expect(resolved).toBeDefined();
      const real = await realpath(resolved!);
      expect(real.startsWith(await realpath(os.tmpdir()))).toBe(true);
      expect(isUnderAncestorNodeModules(path.dirname(real), root)).toBe(false);
    } finally {
      await fixture.cleanup();
      await outside.cleanup();
    }
  });
});
