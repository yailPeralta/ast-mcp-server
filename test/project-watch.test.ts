import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectSessions,
  getProjectStatus,
  peekRegisteredProjectStatus,
} from "../src/services/project.js";
import * as projectWatcherModule from "../src/services/project-watcher.js";
import { createAngularFixture, type AngularFixture } from "./helpers/angular-fixture.js";

const fixtures: AngularFixture[] = [];

afterEach(async () => {
  clearProjectSessions();
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const component = (cls: string, url: string): string =>
  [
    'import { Component } from "@angular/core";',
    `@Component({ selector: "app-x", templateUrl: "${url}" })`,
    `export class ${cls} {`,
    '  title = "x";',
    "}",
    "",
  ].join("\n");

async function templateOutsideSources(): Promise<AngularFixture> {
  const fixture = await createAngularFixture(
    {
      "src/a.component.ts": component("AComponent", "../templates/a.component.html"),
      "templates/a.component.html": "<h1>{{ title }}</h1>\n",
    },
    { compiler: null },
  );
  fixtures.push(fixture);
  return fixture;
}

function spyOnWatchDirectories(): { readonly calls: () => readonly (readonly string[])[] } {
  const createWatcher = projectWatcherModule.createProjectWatcher;
  const spy = vi
    .spyOn(projectWatcherModule, "createProjectWatcher")
    .mockImplementation((options) => createWatcher(options));
  return { calls: () => spy.mock.calls.map(([options]) => options.directories ?? []) };
}

describe("template-aware project watching (TWF-R3)", () => {
  it("template in a directory without TypeScript is watched", async () => {
    const fixture = await templateOutsideSources();
    const watched = spyOnWatchDirectories();

    await getProjectStatus(fixture.root);

    expect(watched.calls()).toHaveLength(1);
    expect(watched.calls()[0]).toContain(path.join(fixture.root, "templates"));
  });

  it("watch coverage grows when a new component brings a template directory", async () => {
    const fixture = await templateOutsideSources();
    await getProjectStatus(fixture.root);
    const watched = spyOnWatchDirectories();

    await fixture.write("src/b.component.ts", component("BComponent", "../views/b.component.html"));
    await fixture.write("views/b.component.html", "<p>{{ title }}</p>\n");
    await getProjectStatus(fixture.root);

    expect(watched.calls()).toHaveLength(1);
    expect(watched.calls()[0]).toContain(path.join(fixture.root, "views"));
    expect(watched.calls()[0]).toContain(path.join(fixture.root, "templates"));
  });

  it("template edited between requests invalidates the session", async () => {
    const fixture = await templateOutsideSources();
    await expect(getProjectStatus(fixture.root)).resolves.toMatchObject({ state: "fresh" });

    await fixture.write("templates/a.component.html", "<h1>{{ title }}!</h1>\n");

    await vi.waitFor(
      () => {
        expect(peekRegisteredProjectStatus(fixture.root)).toMatchObject({
          state: "pending",
          causes: expect.arrayContaining(["source_change"]),
        });
      },
      { timeout: 5000, interval: 25 },
    );
    await expect(getProjectStatus(fixture.root)).resolves.toMatchObject({ state: "fresh" });
  });
});
