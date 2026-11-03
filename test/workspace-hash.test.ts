import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFreshProject } from "../src/services/project.js";
import { createWorkspaceSnapshot, hashWorkspaceFiles } from "../src/services/workspace.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

/** Digest of the snapshot file map with paths made fixture-relative, so it is stable across temp roots. */
function relativeDigest(root: string, files: ReadonlyMap<string, string>): string {
  return hashWorkspaceFiles(
    new Map([...files].map(([filePath, hash]) => [path.relative(root, filePath), hash])),
  );
}

async function snapshotOf(files: Record<string, string>) {
  const fixture = await createProjectFixture(files);
  fixtures.push(fixture);
  const snapshot = createWorkspaceSnapshot(createFreshProject(fixture.root));
  const root = path.dirname(
    [...snapshot.files.keys()].find((file) => file.endsWith("tsconfig.json")) as string,
  );
  return {
    snapshot,
    root,
    relativeFiles: [...snapshot.files.keys()].map((f) => path.relative(root, f)).sort(),
  };
}

// Recorded from unmodified `main` (src/services/workspace.ts byte-identical) before TWF changes.
const PLAIN_TS_GOLDEN = "ba7eb6d76764d96b8564c022a2ca2a89f9a9c963a1d042e710643a81e2acba64";
const FAKE_COMPONENT_GOLDEN = "3d5650789c678d3bee741c8510c343c336e401f926e8e2a8d392e2cb1569e6d0";

const PLAIN_FILES = {
  "src/a.ts": "export const a = 1;\n",
  "src/b.ts": "import { a } from './a.js';\nexport const b = a + 1;\n",
};

const FAKE_COMPONENT_FILES = {
  "src/fake.component.ts": [
    "declare function Component(metadata: { templateUrl: string }): ClassDecorator;",
    "@Component({ templateUrl: './fake.component.html' })",
    "export class FakeComponent {",
    "  title = 'x';",
    "}",
    "",
  ].join("\n"),
  "src/fake.component.html": "<h1>{{ title }}</h1>\n",
};

describe("workspace hash regression guard (TWF-R2)", () => {
  it("non-Angular workspace digest is byte-identical (golden)", async () => {
    const { snapshot, root, relativeFiles } = await snapshotOf(PLAIN_FILES);

    expect(relativeFiles).toEqual(["src/a.ts", "src/b.ts", "tsconfig.json"]);
    expect(relativeDigest(root, snapshot.files)).toBe(PLAIN_TS_GOLDEN);
    expect(snapshot.digest).toBe(hashWorkspaceFiles(snapshot.files));
  });

  it("html plus fake @Component without core is byte-identical", async () => {
    const { snapshot, root, relativeFiles } = await snapshotOf(FAKE_COMPONENT_FILES);

    expect(relativeFiles).toEqual(["src/fake.component.ts", "tsconfig.json"]);
    expect(relativeDigest(root, snapshot.files)).toBe(FAKE_COMPONENT_GOLDEN);
    expect(snapshot.digest).toBe(hashWorkspaceFiles(snapshot.files));
  });
});
