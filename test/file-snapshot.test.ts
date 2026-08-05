import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSnapshot } from "../src/services/file-snapshot.js";
import { clearProjectSessions, withProject } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  clearProjectSessions();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe("file snapshots", () => {
  it("returns exact bounded UTF-8 lines, one-based numbers, total lines and a byte hash", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "first\nsecond ✅\nthird\n",
    });
    fixtures.push(fixture);

    const result = await withProject(fixture.root, async ({ project, projectRoot }) =>
      readFileSnapshot(project, projectRoot, "src/value.ts", { offset: 1, limit: 2 }),
    );

    expect(result).toMatchObject({
      file: "src/value.ts",
      range: { offset: 1, limit: 2, total_lines: 3 },
      lines: [
        { line: 2, text: "second ✅" },
        { line: 3, text: "third" },
      ],
      snapshot_state: "fresh",
    });
    expect(result.file_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns an empty bounded page past the end without changing total_lines", async () => {
    const fixture = await createProjectFixture({ "src/value.ts": "one\ntwo\n" });
    fixtures.push(fixture);

    const result = await withProject(fixture.root, async ({ project, projectRoot }) =>
      readFileSnapshot(project, projectRoot, "src/value.ts", { offset: 10, limit: 2 }),
    );

    expect(result.range).toEqual({ offset: 10, limit: 2, total_lines: 2 });
    expect(result.lines).toEqual([]);
  });

  it("marks a file stale when the filesystem changes after compiler synchronization", async () => {
    const fixture = await createProjectFixture({ "src/value.ts": "before\n" });
    fixtures.push(fixture);
    const context = await withProject(fixture.root, ({ project, projectRoot }) => ({
      project,
      projectRoot,
    }));

    await fixture.write("src/value.ts", "after\n");
    const result = await readFileSnapshot(context.project, context.projectRoot, "src/value.ts", {
      offset: 0,
      limit: 10,
    });

    expect(result.snapshot_state).toBe("stale");
    expect(result.lines).toEqual([{ line: 1, text: "after" }]);
  });

  it("rejects traversal, outside and ambiguous source paths", async () => {
    const fixture = await createProjectFixture({
      "src/a/index.ts": "export const a = 1;\n",
      "src/b/index.ts": "export const b = 1;\n",
      "src/value.ts": "export const value = 1;\n",
    });
    fixtures.push(fixture);

    await expect(
      withProject(fixture.root, async ({ project, projectRoot }) =>
        readFileSnapshot(project, projectRoot, "../outside.ts", { offset: 0, limit: 10 }),
      ),
    ).rejects.toThrow(/project|path|source/i);
    await expect(
      withProject(fixture.root, async ({ project, projectRoot }) =>
        readFileSnapshot(project, projectRoot, "/tmp/outside.ts", { offset: 0, limit: 10 }),
      ),
    ).rejects.toThrow(/project|path|source/i);
    await expect(
      withProject(fixture.root, async ({ project, projectRoot }) =>
        readFileSnapshot(project, projectRoot, "index.ts", { offset: 0, limit: 10 }),
      ),
    ).rejects.toThrow(/ambiguous/i);
  });

  it("rejects a source symlink that escapes the project root", async () => {
    const fixture = await createProjectFixture({ "src/value.ts": "export const value = 1;\n" });
    fixtures.push(fixture);
    const outsideRoot = path.join(fixture.root, "..", "ast-file-snapshot-outside");
    const outsideFile = path.join(outsideRoot, "outside.ts");
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "export const outside = true;\n", "utf8");
    await symlink(outsideFile, path.join(fixture.root, "src", "link.ts"));

    clearProjectSessions();
    try {
      await expect(
        withProject(fixture.root, async ({ project, projectRoot }) =>
          readFileSnapshot(project, projectRoot, "src/link.ts", { offset: 0, limit: 10 }),
        ),
      ).rejects.toThrow(/project|path|source|symlink/i);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
