import { afterEach, describe, expect, it } from "vitest";
import { listTemplateFiles } from "../src/services/angular-templates.js";
import { createFreshProject } from "../src/services/project.js";
import { createWorkspaceSnapshot } from "../src/services/workspace.js";
import { createAngularFixture, type AngularFixture } from "./helpers/angular-fixture.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const FILE_COUNT = 300;
const SAMPLES = 5;

function median(values: number[]): number {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!;
}

function timed<T>(action: () => T): { result: T; ms: number } {
  const started = performance.now();
  const result = action();
  return { result, ms: performance.now() - started };
}

function moduleFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let index = 0; index < FILE_COUNT; index += 1) {
    // Mentions "Component" so the cheap text pre-filter cannot skip the file.
    files[`src/m${index}.ts`] =
      `export const Component${index} = ${index};\nexport function f${index}(): number { return Component${index}; }\n`;
  }
  return files;
}

describe("listTemplateFiles snapshot cost (design Risks)", () => {
  it("listTemplateFiles adds bounded overhead on a large non-Angular project", async () => {
    const fixture = await createProjectFixture(moduleFiles());
    fixtures.push(fixture);
    const context = createFreshProject(fixture.root);

    const listing = Array.from({ length: SAMPLES }, () => timed(() => listTemplateFiles(context)));
    const snapshot = Array.from({ length: SAMPLES }, () =>
      timed(() => createWorkspaceSnapshot(context)),
    );

    expect(context.project.getSourceFiles().length).toBe(FILE_COUNT);
    expect(listing.every(({ result }) => result.length === 0)).toBe(true);
    expect(snapshot[0]!.result.fileCount).toBe(FILE_COUNT + 1);
    expect(median(listing.map(({ ms }) => ms))).toBeLessThan(
      median(snapshot.map(({ ms }) => ms)) * 0.25 + 5,
    );
  });

  it("listTemplateFiles stays linear on a large Angular project", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < FILE_COUNT / 2; index += 1) {
      files[`src/c${index}.component.ts`] = [
        'import { Component } from "@angular/core";',
        `@Component({ selector: "app-c${index}", templateUrl: "./c${index}.component.html" })`,
        `export class C${index}Component {}`,
        "",
      ].join("\n");
      files[`src/c${index}.component.html`] = `<p>${index}</p>\n`;
    }
    const fixture: AngularFixture = await createAngularFixture(files, { compiler: null });
    fixtures.push(fixture);
    const context = createFreshProject(fixture.root);

    const { result, ms } = timed(() => listTemplateFiles(context));

    expect(result).toHaveLength(FILE_COUNT / 2);
    expect(ms).toBeLessThan(5000);
  });
});
