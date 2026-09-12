import assert from "node:assert/strict";
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createGitEnvironment, inspectTrustedGitFile } from "../git-evidence-authority.mjs";
import { runBoundedCommand } from "../runtime-process.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const relative = "patches/deepseek-harness/issue-103";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function trustedGit(args, cwd) {
  const { binary } = await inspectTrustedGitFile();
  return (
    await runBoundedCommand(binary, args, { cwd, env: createGitEnvironment(), timeout: 120_000 })
  ).stdout;
}

async function readInput(file) {
  assert.ok((await lstat(file)).isFile() && (await realpath(file)) === file, "input path symlink");
  return readFile(file);
}

/** Read only the tracked series order; local reordering is not a new authority. */
export async function readSeries(repository = root) {
  const directory = path.join(repository, relative);
  const bytes = await readInput(path.join(directory, "series.json"));
  assert.ok(isUtf8(bytes), "manifest UTF-8");
  const series = JSON.parse(bytes);
  assert.equal(series?.upstream, "https://github.com/deepseek-ai/deepseek-harness.git", "upstream");
  assert.equal(series.baseRevision, "cd5ef8148158c3a752a658978873241fdf8e2bbc", "base revision");
  assert.equal(series.baseTree, "a712eec535b48badc4fefb4df5176a7002e4280b", "base tree");
  assert.equal(series.scope, "incomplete-development-prefix-not-mcp-compatibility", "scope");
  assert.ok(Array.isArray(series.patches) && series.patches.length > 0, "patch list");
  const names = new Set();
  for (const patch of series.patches) {
    assert.ok(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.patch$/u.test(patch?.file), "patch path");
    assert.ok(!names.has(patch.file), "duplicate patch path");
    names.add(patch.file);
    assert.match(patch.sha256, /^[a-f0-9]{64}$/u, "patch hash");
  }
  const format = (await trustedGit(["rev-parse", "--show-object-format"], repository)).trim();
  assert.equal(format, "sha1", "Git object format must match the trusted SHA-1 config owner");
  const inputRevision = (await trustedGit(["rev-parse", "HEAD"], repository)).trim();
  // Bind the retained bytes, not decoded Git output or a second worktree read.
  const blob = createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(
    blob,
    (
      await trustedGit(["rev-parse", `${inputRevision}:${relative}/series.json`], repository)
    ).trim(),
    "tracked series changed",
  );
  const patches = [];
  for (const patch of series.patches) {
    const file = path.join(directory, patch.file);
    const content = await readInput(file);
    assert.equal(sha256(content), patch.sha256, "patch hash changed");
    patches.push({ ...patch, content });
  }
  return { series, seriesSha256: sha256(bytes), inputRevision, patches };
}

/** Successful claims transfer root cleanup to the caller; they do not prepare Harness. */
export async function claimWork(work) {
  const directory = path.resolve(work ?? os.tmpdir());
  const canonical = await realpath(directory);
  const ast = await realpath(root);
  assert.ok(
    canonical !== path.parse(canonical).root &&
      canonical !== ast &&
      !canonical.startsWith(`${ast}/`) &&
      !ast.startsWith(`${canonical}/`),
    "work ancestry",
  );
  if (work === undefined) return mkdtemp(path.join(canonical, "ast103-"));
  const stat = await lstat(directory);
  assert.ok(
    stat.isDirectory() &&
      canonical === directory &&
      stat.uid === process.getuid() &&
      !(stat.mode & 0o022),
    "unsafe work ownership",
  );
  assert.equal((await readdir(directory)).length, 0, "work must be empty");
  return directory;
}
