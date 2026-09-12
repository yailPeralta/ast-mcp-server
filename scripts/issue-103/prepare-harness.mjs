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
  readlink,
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

async function inspectOwnedPath(file, directory = false) {
  const stat = await lstat(file);
  assert.ok(
    (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1) &&
      stat.uid === process.getuid() &&
      !(stat.mode & 0o022) &&
      (await realpath(file)) === file,
    `unsafe prepared path: ${file}`,
  );
  return stat;
}

async function inspectGitControls(directory) {
  await inspectOwnedPath(directory, true);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(
      !["alternates", "http-alternates", "commondir", "gitdir"].includes(entry.name),
      "Git indirection",
    );
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inspectGitControls(file);
    else await inspectOwnedPath(file);
  }
}

async function inspectTrackedSource(cwd, listing) {
  const observations = {};
  for (const entry of listing.split("\0").filter(Boolean)) {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40})\t(.+)$/su.exec(entry);
    assert.ok(match, "unsupported tracked type");
    const [, mode, blob, relative] = match;
    const components = relative.split("/");
    assert.ok(
      components.every((part) => part && ![".", "..", ".git"].includes(part)),
      "tracked path",
    );
    let directory = cwd;
    for (const part of components.slice(0, -1)) {
      directory = path.join(directory, part);
      await inspectOwnedPath(directory, true);
    }
    const file = path.join(cwd, relative);
    let bytes;
    if (mode === "120000") {
      const stat = await lstat(file);
      assert.ok(stat.isSymbolicLink() && stat.uid === process.getuid(), "tracked link type");
      assert.ok((await realpath(file)).startsWith(`${cwd}/`), "escaping tracked link");
      bytes = await readlink(file, { encoding: "buffer" });
    } else {
      const stat = await inspectOwnedPath(file);
      assert.equal(stat.mode & 0o100, mode === "100755" ? 0o100 : 0, "tracked mode");
      bytes = await readFile(file);
    }
    assert.equal(
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      blob,
      `source blob: ${relative}`,
    );
    if (
      [
        "packages/core/tools/src/index.ts",
        "packages/mcp/mcp-client/src/tools.ts",
        "packages/mcp/mcp-client/src/output-validation.ts",
      ].includes(relative)
    )
      observations[relative] = sha256(bytes);
  }
  return observations;
}

/** Read-only source inspection; executable admission belongs to the future runner. */
export async function inspectPreparedSource(work) {
  await inspectOwnedPath(work, true);
  const ast = await realpath(root);
  assert.ok(
    work !== path.parse(work).root &&
      work !== ast &&
      !work.startsWith(`${ast}/`) &&
      !ast.startsWith(`${work}/`),
    "work ancestry",
  );
  assert.ok(!(await readdir(work)).includes(".preparing"), "preparation in progress");
  const receipt = path.join(work, "identity.json");
  await inspectOwnedPath(receipt);
  const identity = JSON.parse(await readFile(receipt));
  const controls = [];
  for (const variant of ["baseline", "candidate"]) {
    const cwd = path.join(work, variant);
    await inspectOwnedPath(cwd, true);
    const git = path.join(cwd, ".git");
    await inspectGitControls(git);
    for (const file of ["HEAD", "config", "index"]) await inspectOwnedPath(path.join(git, file));
    for (const file of ["objects", "refs"]) await inspectOwnedPath(path.join(git, file), true);
    const stat = await lstat(git);
    controls.push(`${stat.dev}:${stat.ino}`);
  }
  assert.notEqual(...controls, "aliased Git directories");
  await inspectOwnedPath(path.join(work, "patches"), true);
  const { series, seriesSha256, inputRevision, patches } = await readSeries();
  assert.equal(seriesSha256, "a845fb6fdfbdf7a45802881b854dd7a28454c1503e5fb39c649a61743e392aba");
  const trees = {
    baseline: series.baseTree,
    candidate: "e3258a342b4c2fbbe250baa86369de6a8c6fc2ac",
  };
  assert.equal(identity.work, work, "recorded work");
  assert.equal(identity.inputRevision, inputRevision, "stale preparation");
  assert.equal(identity.seriesSha256, seriesSha256, "recorded series digest");
  assert.deepEqual(identity.series, series, "recorded series");
  assert.deepEqual(identity.trees, trees, "recorded trees");
  for (const patch of patches) {
    const file = path.join(work, "patches", patch.file);
    await inspectOwnedPath(file);
    assert.deepEqual(await readFile(file), patch.content, "retained patch bytes");
  }
  for (const [variant, tree] of Object.entries(trees)) {
    const cwd = path.join(work, variant);
    const git = (args) =>
      trustedGit(
        ["--no-optional-locks", "--no-replace-objects", "-c", `core.worktree=${cwd}`, ...args],
        cwd,
      );
    assert.equal(
      await readFile(path.join(cwd, ".git/HEAD"), "utf8"),
      `${series.baseRevision}\n`,
      "detached HEAD",
    );
    assert.equal(
      (await git(["rev-parse", "HEAD", "HEAD^{tree}"])).trim(),
      `${series.baseRevision}\n${series.baseTree}`,
      "base identity",
    );
    assert.equal(
      (await git(["remote", "get-url", "--all", "origin"])).trim(),
      series.upstream,
      "origin",
    );
    await git(["diff", "--cached", "--exit-code", "--no-ext-diff", "--no-textconv", tree, "--"]);
    const sources = await inspectTrackedSource(
      cwd,
      await git(["ls-tree", "-r", "-z", "--full-tree", tree]),
    );
    if (variant === "candidate")
      assert.deepEqual(identity.sources, sources, "recorded source hashes");
    assert.equal(
      await git(["ls-files", "--others", "--exclude-standard", "-z"]),
      "",
      "untracked source",
    );
  }
  return { work, identity };
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
