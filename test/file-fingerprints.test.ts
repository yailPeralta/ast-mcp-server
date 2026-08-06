import { renameSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureFileFingerprint,
  collectFileFingerprints,
  compareFileFingerprints,
} from "../src/services/file-fingerprints.js";
import { createConfigSnapshot, createWorkspaceSnapshot } from "../src/services/workspace.js";
import { withProject } from "../src/services/project.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const fixtures: ProjectFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe("file fingerprints", () => {
  it("classifies unchanged, added, changed and deleted files by content", async () => {
    const fixture = await createProjectFixture({
      "src/unchanged.ts": "export const unchanged = 1;\n",
      "src/changed.ts": "export const before = 1;\n",
      "src/deleted.ts": "export const deleted = 1;\n",
    });
    fixtures.push(fixture);

    const before = collectFileFingerprints(
      ["src/unchanged.ts", "src/changed.ts", "src/deleted.ts"].map((file) =>
        path.join(fixture.root, file),
      ),
    );
    await fixture.write("src/changed.ts", "export const after = 2;\n");
    await fixture.write("src/added.ts", "export const added = 1;\n");

    const after = collectFileFingerprints(
      ["src/unchanged.ts", "src/changed.ts", "src/added.ts"].map((file) =>
        path.join(fixture.root, file),
      ),
      before.files,
      { verifyContentHash: true },
    );
    const changes = compareFileFingerprints(before.files, after.files);

    expect(changes.unchanged).toEqual([path.join(fixture.root, "src/unchanged.ts")]);
    expect(changes.added).toEqual([path.join(fixture.root, "src/added.ts")]);
    expect(changes.changed).toEqual([path.join(fixture.root, "src/changed.ts")]);
    expect(changes.deleted).toEqual([path.join(fixture.root, "src/deleted.ts")]);
    expect(after.missing).toEqual([]);
  });

  it("detects an atomic replacement even when size is unchanged", async () => {
    const fixture = await createProjectFixture({ "src/value.ts": "before\n" });
    fixtures.push(fixture);
    const filePath = path.join(fixture.root, "src/value.ts");
    const before = captureFileFingerprint(filePath);
    const replacement = path.join(fixture.root, "src/value.next.ts");
    writeFileSync(replacement, "after!\n", "utf8");
    renameSync(replacement, filePath);

    const after = captureFileFingerprint(filePath, before);

    expect(after.size_bytes).toBe(before.size_bytes);
    expect(after.inode).not.toBe(before.inode);
    expect(after.content_hash).not.toBe(before.content_hash);
  });

  it("can force content verification when metadata collides", async () => {
    const fixture = await createProjectFixture({ "src/value.ts": "before\n" });
    fixtures.push(fixture);
    const filePath = path.join(fixture.root, "src/value.ts");
    const before = captureFileFingerprint(filePath);
    const previousStat = statSync(filePath);
    writeFileSync(filePath, "after!\n", "utf8");
    utimesSync(filePath, previousStat.atime, previousStat.mtime);

    const after = captureFileFingerprint(filePath, before, { verifyContentHash: true });

    expect(after.content_hash).not.toBe(before.content_hash);
  });

  it("reports missing files without turning an absent path into a valid fingerprint", async () => {
    const fixture = await createProjectFixture({ "src/value.ts": "export const value = 1;\n" });
    fixtures.push(fixture);
    const filePath = path.join(fixture.root, "src/value.ts");
    const before = collectFileFingerprints([filePath]);
    await fixture.remove();

    const after = collectFileFingerprints([filePath], before.files);

    expect(after.files).toEqual(new Map());
    expect(after.missing).toEqual([filePath]);
    expect(compareFileFingerprints(before.files, after.files).deleted).toEqual([filePath]);
  });

  it("changes config fingerprints when extended or referenced project config changes", async () => {
    const fixture = await createProjectFixture({
      "src/value.ts": "export const value = 1;\n",
      "tsconfig.base.json": JSON.stringify({ compilerOptions: { strict: false } }),
      "packages/core/tsconfig.json": JSON.stringify({ compilerOptions: { composite: true } }),
    });
    fixtures.push(fixture);
    await fixture.write(
      "tsconfig.json",
      JSON.stringify({
        extends: "./tsconfig.base.json",
        references: [{ path: "./packages/core" }],
        include: ["src/**/*"],
      }),
    );
    const configPath = path.join(fixture.root, "tsconfig.json");
    const before = createConfigSnapshot(configPath);

    await fixture.write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    const afterBaseChange = createConfigSnapshot(configPath);
    await fixture.write(
      "packages/core/tsconfig.json",
      JSON.stringify({ compilerOptions: { composite: false } }),
    );
    const afterReferenceChange = createConfigSnapshot(configPath);

    expect(afterBaseChange.digest).not.toBe(before.digest);
    expect(afterReferenceChange.digest).not.toBe(afterBaseChange.digest);
    expect(afterReferenceChange.files).toContain(
      path.join(fixture.root, "packages/core/tsconfig.json"),
    );
  });

  it("publishes changed files through successive workspace snapshots", async () => {
    const fixture = await createProjectFixture({ "src/value.ts": "export const before = 1;\n" });
    fixtures.push(fixture);

    const first = await withProject(fixture.root, (context) => createWorkspaceSnapshot(context));
    await fixture.write("src/value.ts", "export const after = 2;\n");
    const second = await withProject(fixture.root, (context) =>
      createWorkspaceSnapshot(context, {
        previousFingerprints: first.fingerprints,
        verifyContentHash: true,
      }),
    );

    expect(second.fingerprintChanges.changed).toContain(path.join(fixture.root, "src/value.ts"));
  });
});
