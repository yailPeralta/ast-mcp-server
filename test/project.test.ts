import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearProjectSessions,
  createFreshProject,
  getSourceFileOrThrow,
  withProject,
} from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  clearProjectSessions();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.remove()));
});

describe("project sessions", () => {
  it("refreshes externally modified source files before the next operation", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const before = 1;\n",
    });
    fixtures.push(fixture);

    const first = await withProject(fixture.root, ({ project }) =>
      getSourceFileOrThrow(project, "src/value.ts").getText(),
    );
    expect(first).toContain("before");

    await fixture.write("src/value.ts", "export const after = 2;\n");

    const second = await withProject(fixture.root, ({ project }) =>
      getSourceFileOrThrow(project, "src/value.ts").getText(),
    );
    expect(second).toContain("after");
    expect(second).not.toContain("before");
  });

  it("discovers included files and forgets deleted files", async () => {
    const fixture = await createProjectFixture({
      "src/first.ts": "export const first = 1;\n",
    });
    fixtures.push(fixture);

    await withProject(fixture.root, ({ project }) => {
      expect(project.getSourceFiles()).toHaveLength(1);
    });

    await fixture.write("src/second.ts", "export const second = 2;\n");
    await withProject(fixture.root, ({ project }) => {
      expect(
        project
          .getSourceFiles()
          .map((sourceFile) => sourceFile.getBaseName())
          .sort(),
      ).toEqual(["first.ts", "second.ts"]);
    });

    await rm(path.join(fixture.root, "src/first.ts"));
    await withProject(fixture.root, ({ project }) => {
      expect(project.getSourceFiles().map((sourceFile) => sourceFile.getBaseName())).toEqual([
        "second.ts",
      ]);
    });
  });

  it("rebuilds a cached project when an extended config changes", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    await fixture.write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { strict: false, target: "ES2022" } }),
    );
    await fixture.write(
      "tsconfig.json",
      JSON.stringify({ extends: "./tsconfig.base.json", include: ["src/**/*"] }),
    );

    expect(
      await withProject(fixture.root, ({ project }) => project.getCompilerOptions().strict),
    ).toBe(false);

    await fixture.write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { strict: true, target: "ES2022" } }),
    );

    expect(
      await withProject(fixture.root, ({ project }) => project.getCompilerOptions().strict),
    ).toBe(true);
  });

  it("rejects ambiguous suffix paths and reports project-relative candidates", async () => {
    const fixture = await createProjectFixture({
      "src/a/index.ts": "export const first = 1;\n",
      "src/b/index.ts": "export const second = 2;\n",
    });
    fixtures.push(fixture);
    const { project } = createFreshProject(fixture.root);

    expect(() => getSourceFileOrThrow(project, "index.ts")).toThrowError(
      /src\/a\/index\.ts, src\/b\/index\.ts/,
    );
    expect(getSourceFileOrThrow(project, "src/b/index.ts").getText()).toContain("second");
  });

  it("serializes operations for the same project", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);
    const events: string[] = [];

    const first = withProject(fixture.root, async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push("first:end");
    });
    const second = withProject(fixture.root, () => {
      events.push("second:start");
    });

    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });
});
