import assert from "node:assert/strict";
import { isUtf8 } from "node:buffer";
import console from "node:console";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createGitEnvironment, inspectTrustedGitFile } from "../git-evidence-authority.mjs";
import { createPrivatePnpmEnvironment, provisionPrivatePnpm } from "../private-pnpm.mjs";
import { runBoundedCommand, runOrderedCleanup } from "../runtime-process.mjs";

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

export async function privateEnvironment(work) {
  assert.equal(process.version, "v24.16.0", "Node version");
  const nodeBin = await realpath(process.execPath);
  const temporaryRoot = path.join(work, "private");
  await mkdir(path.join(temporaryRoot, "tmp"), { recursive: true });
  return createPrivatePnpmEnvironment({
    temporaryRoot,
    nodeBin,
    baseEnvironment: {
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      TMPDIR: path.join(temporaryRoot, "tmp"),
      TMP: path.join(temporaryRoot, "tmp"),
      TEMP: path.join(temporaryRoot, "tmp"),
    },
  });
}

/** Source preparation only: success transfers cleanup responsibility to the caller. */
export async function prepare(requestedWork, provision = provisionPrivatePnpm, repository = root) {
  const { series, seriesSha256, inputRevision, patches } = await readSeries(repository);
  const work = await claimWork(requestedWork);
  const owned = ["private", "baseline", "candidate", "patches", "identity.json", ".preparing"];
  let acquired = false;
  let complete = false;
  try {
    await mkdir(path.join(work, ".preparing"));
    acquired = true;
    const manager = await privateEnvironment(work);
    const pnpm = await provision({ ...manager, cwd: work });
    await mkdir(path.join(work, "patches"));
    for (const patch of patches)
      await writeFile(path.join(work, "patches", patch.file), patch.content, { flag: "wx" });
    const trees = {};
    for (const variant of ["baseline", "candidate"]) {
      const cwd = path.join(work, variant);
      await trustedGit(["clone", "--no-checkout", "--", series.upstream, cwd], work);
      await trustedGit(["checkout", "--detach", series.baseRevision], cwd);
      assert.equal(
        (await trustedGit(["rev-parse", "HEAD^{tree}"], cwd)).trim(),
        series.baseTree,
        "clone base tree",
      );
      if (variant === "candidate") {
        for (const patch of patches) {
          const file = path.join(work, "patches", patch.file);
          await trustedGit(["apply", "--check", "--index", file], cwd);
          await trustedGit(["apply", "--index", file], cwd);
        }
      }
      trees[variant] = (await trustedGit(["write-tree"], cwd)).trim();
      await trustedGit(["diff", "--exit-code"], cwd);
    }
    const sources = {};
    for (const file of [
      "packages/core/tools/src/index.ts",
      "packages/mcp/mcp-client/src/tools.ts",
      "packages/mcp/mcp-client/src/output-validation.ts",
    ])
      sources[file] = sha256(await readFile(path.join(work, "candidate", file)));
    const identity = {
      work,
      sources,
      series,
      seriesSha256,
      inputRevision,
      trees,
      pnpm,
      node: {
        path: manager.nodeBin,
        version: process.version,
        sha256: sha256(await readFile(manager.nodeBin)),
      },
      git: await inspectTrustedGitFile(),
      launcher: {
        path: await realpath(path.join(manager.binDirectory, "pnpm")),
        sha256: sha256(await readFile(path.join(manager.binDirectory, "pnpm"))),
      },
    };
    await writeFile(path.join(work, "identity.json"), `${JSON.stringify(identity, null, 2)}\n`, {
      flag: "wx",
    });
    await rmdir(path.join(work, ".preparing"));
    complete = true;
    return identity;
  } finally {
    if (!complete)
      await runOrderedCleanup("failed preparation", [
        ...(acquired ? owned : []).map((name) => [
          name,
          () => rm(path.join(work, name), { recursive: true, force: true }),
        ]),
        [
          "automatic root",
          async () => {
            if (requestedWork === undefined) await rmdir(work);
          },
        ],
      ]);
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    assert.ok(
      args.length === 0 || (args.length === 2 && args[0] === "--work"),
      "usage: prepare-harness.mjs [--work <empty-root>]",
    );
    console.log(JSON.stringify(await prepare(args[1]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
