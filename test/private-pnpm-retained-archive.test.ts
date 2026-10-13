import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { create } from "tar";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error Internal MJS archive admission helper is verified through unit tests.
import { proveRetainedPnpmArchive } from "../scripts/retained-pnpm-archive.mjs";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "retained-pnpm-archive-"));
  roots.push(root);
  return root;
}

async function writeFixture(root: string, files: Record<string, string | Buffer>) {
  const extractedRoot = path.join(root, "extracted");
  await mkdir(extractedRoot, { recursive: true, mode: 0o755 });
  await chmod(extractedRoot, 0o755);
  for (const [relative, bytes] of Object.entries(files)) {
    const target = path.join(extractedRoot, relative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    for (
      let directory = path.dirname(target);
      directory.startsWith(extractedRoot);
      directory = path.dirname(directory)
    ) {
      await chmod(directory, 0o755);
      if (directory === extractedRoot) break;
    }
    await writeFile(target, bytes, { mode: 0o644 });
    await chmod(target, 0o644);
  }
  return extractedRoot;
}

async function packFixture(root: string, files: string[]) {
  const archivePath = path.join(root, "fixture.tgz");
  await create(
    {
      cwd: path.join(root, "extracted"),
      file: archivePath,
      gzip: true,
      portable: true,
      strict: true,
    },
    files,
  );
  await chmod(archivePath, 0o644);
  const archiveBytes = await readFile(archivePath);
  return {
    archivePath,
    expectedSha512Hex: createHash("sha512").update(archiveBytes).digest("hex"),
  };
}

async function admittedFixture(files: Record<string, string | Buffer>) {
  const root = await tempRoot();
  const extractedRoot = await writeFixture(root, files);
  return { root, extractedRoot, ...(await packFixture(root, Object.keys(files))) };
}

describe("retained pnpm archive proof", () => {
  it("authenticates compressed bytes before proving retained regular files and implicit dirs", async () => {
    const fixture = await admittedFixture({
      "package/bin/pnpm.cjs": "console.log('pnpm')\n",
      "package/package.json": '{"name":"pnpm","version":"11.7.0"}\n',
    });

    await expect(proveRetainedPnpmArchive(fixture)).resolves.toMatchObject({
      compressedBytes: expect.any(Number),
      inflatedBytes: expect.any(Number),
      regularFiles: 2,
      implicitDirectories: 2,
      maxFileBytes: 35,
    });
  });

  it("rejects an archive digest mismatch before parsing retained payload bytes", async () => {
    const fixture = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    await writeFile(path.join(fixture.extractedRoot, "package/bin/pnpm.cjs"), "tampered\n");

    await expect(
      proveRetainedPnpmArchive({ ...fixture, expectedSha512Hex: "00".repeat(64) }),
    ).rejects.toThrow(/compressed archive digest differs/u);
  });

  it("rejects retained dependency tampering, extras, links, and unsafe modes", async () => {
    const fixture = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    await writeFile(path.join(fixture.extractedRoot, "package/bin/pnpm.cjs"), "tampered\n");
    await expect(proveRetainedPnpmArchive(fixture)).rejects.toThrow(/file bytes differ/u);

    const extra = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    const extraPath = path.join(extra.extractedRoot, "package/extra.js");
    await writeFile(extraPath, "extra\n");
    await chmod(extraPath, 0o644);
    await expect(proveRetainedPnpmArchive(extra)).rejects.toThrow(/extra retained path/u);

    const retainedLink = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    const linkedEntrypoint = path.join(retainedLink.extractedRoot, "package/bin/pnpm.cjs");
    await rm(linkedEntrypoint);
    await symlink("../target", linkedEntrypoint);
    await expect(proveRetainedPnpmArchive(retainedLink)).rejects.toThrow(/unsupported link/u);

    const unsafeMode = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    await chmod(path.join(unsafeMode.extractedRoot, "package/bin/pnpm.cjs"), 0o666);
    await expect(proveRetainedPnpmArchive(unsafeMode)).rejects.toThrow(/unsafe.*mode/u);
  });

  it("rejects malformed tar streams and archive link members after digest authentication", async () => {
    const malformedRoot = await tempRoot();
    const archivePath = path.join(malformedRoot, "malformed.tgz");
    const malformedBytes = gzipSync("not a tar stream");
    await writeFile(archivePath, malformedBytes);
    await chmod(archivePath, 0o644);
    const extractedRoot = await writeFixture(malformedRoot, { "package/bin/pnpm.cjs": "safe\n" });
    await expect(
      proveRetainedPnpmArchive({
        archivePath,
        extractedRoot,
        expectedSha512Hex: createHash("sha512").update(malformedBytes).digest("hex"),
      }),
    ).rejects.toThrow();

    const linkRoot = await tempRoot();
    const linkExtractedRoot = await writeFixture(linkRoot, { "package/target": "safe\n" });
    await symlink("target", path.join(linkExtractedRoot, "package/link"));
    const archive = await packFixture(linkRoot, ["package/link"]);
    await expect(
      proveRetainedPnpmArchive({ ...archive, extractedRoot: linkExtractedRoot }),
    ).rejects.toThrow(/unsupported entry type/u);
  });

  it("rejects archive path aliases before hashing bytes from a single owned file handle", async () => {
    const fixture = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    const archiveAlias = path.join(fixture.root, "archive-alias.tgz");
    await symlink(fixture.archivePath, archiveAlias);

    await expect(
      proveRetainedPnpmArchive({ ...fixture, archivePath: archiveAlias }),
    ).rejects.toThrow(/archive path is not a trusted regular file/u);
  });

  it("rejects extracted root symlinks before canonical containment checks", async () => {
    const fixture = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    const rootAlias = path.join(fixture.root, "root-alias");
    await symlink(fixture.extractedRoot, rootAlias);

    await expect(
      proveRetainedPnpmArchive({ ...fixture, extractedRoot: rootAlias }),
    ).rejects.toThrow(/extracted root is not a trusted directory/u);
  });

  it("rejects retained extras before reading their bodies or applying body budgets", async () => {
    const fixture = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    const extraPath = path.join(fixture.extractedRoot, "package/extra.js");
    await writeFile(extraPath, Buffer.alloc(2 * 1024 * 1024));
    await chmod(extraPath, 0o000);

    await expect(proveRetainedPnpmArchive(fixture)).rejects.toThrow(/extra retained path/u);
  });

  it("applies retained tree bounds and cooperative cancellation during comparison", async () => {
    const fixture = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    await expect(
      proveRetainedPnpmArchive({ ...fixture, limits: { maxRetainedEntries: 1 } }),
    ).rejects.toThrow(/retained path count exceeds/u);
    const deepRoot = await tempRoot();
    const deepExtractedRoot = await writeFixture(deepRoot, { "package/bin/pnpm.cjs": "safe\n" });
    const deepDirectory = path.join(deepExtractedRoot, "package/bin/deep");
    await mkdir(deepDirectory);
    await chmod(deepDirectory, 0o755);
    const deepArchive = await packFixture(deepRoot, ["package/bin/pnpm.cjs", "package/bin/deep"]);
    const deepFile = path.join(deepDirectory, "extra.js");
    await writeFile(deepFile, "extra\n");
    await chmod(deepFile, 0o644);
    await expect(
      proveRetainedPnpmArchive({
        ...deepArchive,
        extractedRoot: deepExtractedRoot,
        limits: { maxDepth: 3 },
      }),
    ).rejects.toThrow(/retained path depth exceeds/u);

    const controller = new AbortController();
    const cleanup = { archiveHandles: 0, retainedDirectories: 0 };
    await expect(
      proveRetainedPnpmArchive({
        ...fixture,
        signal: controller.signal,
        testHooks: {
          afterArchiveHandleClosed() {
            cleanup.archiveHandles += 1;
          },
          afterRetainedDirectoryClosed() {
            cleanup.retainedDirectories += 1;
          },
          beforeRetainedEntry() {
            controller.abort(new Error("caller stopped tree comparison"));
          },
        },
      }),
    ).rejects.toThrow(/caller stopped tree comparison/u);
    expect(cleanup).toEqual({ archiveHandles: 1, retainedDirectories: 1 });
  });

  it("honors caller cancellation before parsing authenticated bytes", async () => {
    const fixture = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    const controller = new AbortController();
    controller.abort(new Error("caller stopped inspection"));
    await expect(
      proveRetainedPnpmArchive({ ...fixture, signal: controller.signal }),
    ).rejects.toThrow(/caller stopped inspection/u);
  });

  it("enforces real compressed, inflated, entry, path, and per-file budgets", async () => {
    const fixture = await admittedFixture({ "package/bin/pnpm.cjs": "safe\n" });
    await expect(
      proveRetainedPnpmArchive({ ...fixture, limits: { maxCompressedBytes: 1 } }),
    ).rejects.toThrow(/compressed archive exceeds/u);
    await expect(
      proveRetainedPnpmArchive({ ...fixture, limits: { maxInflatedBytes: 1 } }),
    ).rejects.toThrow(/inflated archive exceeds/u);
    await expect(
      proveRetainedPnpmArchive({ ...fixture, limits: { maxEntries: 0 } }),
    ).rejects.toThrow(/archive entry count exceeds/u);
    await expect(
      proveRetainedPnpmArchive({ ...fixture, limits: { maxFileBytes: 1 } }),
    ).rejects.toThrow(/file entry exceeds/u);
    await expect(
      proveRetainedPnpmArchive({ ...fixture, limits: { maxPathBytes: 10 } }),
    ).rejects.toThrow(/path exceeds/u);
  });
});

afterAll(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
