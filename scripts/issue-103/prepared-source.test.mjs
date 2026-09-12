import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import * as owner from "./prepare-harness.mjs";

const source = path.join(import.meta.dirname, "prepare-harness.mjs");

async function footprint(directory) {
  const result = [];
  for (const name of (await fs.readdir(directory)).sort()) {
    const file = path.join(directory, name);
    const stat = await fs.lstat(file);
    result.push([file, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs]);
    if (stat.isDirectory()) result.push(...(await footprint(file)));
  }
  return result;
}

async function changed(file, bytes, action) {
  const original = await fs.readFile(file);
  try {
    await fs.writeFile(file, bytes);
    await action();
  } finally {
    await fs.writeFile(file, original);
  }
}

test("fresh official sources readmit without writes", async (t) => {
  const umask = process.umask(0o077);
  t.after(() => process.umask(umask));
  const before = owner.sha256(await fs.readFile(source));
  const identity = await owner.prepare();
  const work = identity.work;
  t.after(async () => {
    await fs.rm(work, { recursive: true });
    await assert.rejects(fs.lstat(work), { code: "ENOENT" });
    assert.equal(owner.sha256(await fs.readFile(source)), before);
  });
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ast103-sentinel-")));
  t.after(() => fs.rm(outside, { recursive: true }));
  const sentinel = path.join(outside, "sentinel");
  await fs.writeFile(sentinel, "preserve");
  const sentinelBefore = await footprint(outside);
  const receiptFile = path.join(work, "identity.json");
  const receipt = await fs.readFile(receiptFile);
  const inspect = () => owner.inspectPreparedSource(work);
  const reject = async () => {
    const state = await footprint(work);
    await assert.rejects(inspect());
    assert.deepEqual(await footprint(work), state, "rejection must not write");
    assert.deepEqual(await footprint(outside), sentinelBefore);
    assert.equal(await fs.readFile(sentinel, "utf8"), "preserve");
  };
  const mutation = (name, change, restore) =>
    t.test(name, async () => {
      try {
        await change();
        await reject();
      } finally {
        await restore();
      }
    });
  const state = await footprint(work);
  assert.equal(typeof owner.inspectPreparedSource, "function");
  assert.deepEqual(await inspect(), { work, identity });
  assert.deepEqual(await footprint(work), state, "admission must not write");
  assert.deepEqual(await fs.readFile(receiptFile), receipt);
  await t.test("rejects coordinated source/index/receipt tampering", async () => {
    const cwd = path.join(work, "candidate");
    const file = "packages/core/tools/src/index.ts";
    await changed(path.join(cwd, file), "// changed\n", async () => {
      try {
        await owner.trustedGit(["add", "--", file], cwd);
        const forged = globalThis.structuredClone(identity);
        forged.trees.candidate = (await owner.trustedGit(["write-tree"], cwd)).trim();
        forged.sources[file] = owner.sha256(await fs.readFile(path.join(cwd, file)));
        await changed(receiptFile, JSON.stringify(forged), reject);
      } finally {
        const original = await owner.trustedGit(
          ["show", `${identity.trees.candidate}:${file}`],
          cwd,
        );
        await fs.writeFile(path.join(cwd, file), original);
        await owner.trustedGit(["add", "--", file], cwd);
      }
    });
  });
  for (const [key, value] of [
    ["work", outside],
    ["inputRevision", "0".repeat(40)],
    ["seriesSha256", "0".repeat(64)],
    ["series", { ...identity.series, patches: identity.series.patches.toReversed() }],
    ["trees", { ...identity.trees, baseline: identity.trees.candidate }],
    ...Object.keys(identity.sources).map((file) => [
      "sources",
      { ...identity.sources, [file]: "0".repeat(64) },
    ]),
    ...["work", "inputRevision", "seriesSha256", "series", "trees", "sources"].map((key) => [
      key,
      undefined,
    ]),
  ])
    await t.test(`rejects recorded ${key}: ${JSON.stringify(value)}`, async () => {
      await changed(receiptFile, JSON.stringify({ ...identity, [key]: value }), reject);
    });
  await t.test("rejects malformed identity", () => changed(receiptFile, "{", reject));
  await t.test("rejects retained patch changes", () =>
    changed(path.join(work, "patches", identity.series.patches[0].file), "changed", reject),
  );
  for (const variant of ["baseline", "candidate"]) {
    const cwd = path.join(work, variant);
    const file = path.join(cwd, "package.json");
    for (const flag of [null, "assume-unchanged", "skip-worktree"]) {
      await t.test(`${variant} rejects bytes hidden by ${flag ?? "stat cache"}`, async () => {
        if (flag) await owner.trustedGit(["update-index", `--${flag}`, "--", "package.json"], cwd);
        try {
          await changed(file, "{}\n", reject);
        } finally {
          if (flag)
            await owner.trustedGit(["update-index", `--no-${flag}`, "--", "package.json"], cwd);
        }
      });
    }
    const mode = (await fs.lstat(file)).mode;
    await mutation(
      `${variant} tracked executable mode rejects`,
      () => fs.chmod(file, mode ^ 0o100),
      () => fs.chmod(file, mode),
    );
    await mutation(
      `${variant} index differs from independent tree`,
      () => owner.trustedGit(["rm", "--cached", "--", "package.json"], cwd),
      () => owner.trustedGit(["add", "--", "package.json"], cwd),
    );
    for (const head of ["0".repeat(40) + "\n", "ref: refs/remotes/origin/main\n"])
      await t.test(`${variant} wrong or attached HEAD ${head.trim()}`, () =>
        changed(path.join(cwd, ".git/HEAD"), head, reject),
      );
    await t.test(`${variant} origin mismatch`, async () => {
      const config = path.join(cwd, ".git/config");
      const bytes = await fs.readFile(config, "utf8");
      await changed(
        config,
        bytes.replace(identity.series.upstream, "https://example.invalid"),
        reject,
      );
    });
  }
  for (const relative of [
    "baseline",
    "candidate",
    "candidate/.git",
    "candidate/.git/index",
    "candidate/.git/objects",
    "identity.json",
    "patches",
    `patches/${identity.series.patches[0].file}`,
    "candidate/packages",
    "candidate/package.json",
  ]) {
    const file = path.join(work, relative);
    const parked = path.join(work, "parked");
    await mutation(
      `rejects symlink component ${relative}`,
      async () => {
        await fs.rename(file, parked);
        await fs.symlink(outside, file);
      },
      async () => {
        await fs.rm(file);
        await fs.rename(parked, file);
      },
    );
  }
  for (const relative of ["identity.json", "candidate/.git/index"]) {
    const alias = path.join(work, "alias");
    await mutation(
      `rejects hardlink alias ${relative}`,
      () => fs.link(path.join(work, relative), alias),
      () => fs.rm(alias),
    );
  }
  for (const relative of ["identity.json", "candidate/.git/index", "patches", "baseline"]) {
    const file = path.join(work, relative);
    const parked = path.join(work, "parked");
    await mutation(
      `rejects missing ${relative}`,
      () => fs.rename(file, parked),
      () => fs.rename(parked, file),
    );
  }
  for (const relative of [
    ".preparing",
    "candidate/.git/objects/info/alternates",
    "candidate/.git/commondir",
    "baseline/untracked",
  ]) {
    const file = path.join(work, relative);
    await mutation(
      `rejects unexpected ${relative}`,
      () => fs.writeFile(file, outside),
      () => fs.rm(file),
    );
  }
  await mutation(
    "rejects writable work without repairing it",
    () => fs.chmod(work, 0o720),
    () => fs.chmod(work, 0o700),
  );
  await t.test("rejects aliased work", async () => {
    const alias = path.join(outside, "alias");
    try {
      await fs.symlink(work, alias);
      await assert.rejects(owner.inspectPreparedSource(alias));
    } finally {
      await fs.rm(alias);
    }
  });
  await t.test("ignored dependency/build outputs survive readmission", async () => {
    for (const variant of ["baseline", "candidate"])
      for (const output of ["node_modules", "lib"]) {
        const directory = path.join(work, variant, output);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, "sentinel"), "ignored, not artifact-verified");
      }
    const state = await footprint(work);
    for (let i = 0; i < 2; i++) assert.deepEqual(await inspect(), { work, identity });
    assert.deepEqual(await footprint(work), state);
  });
});
