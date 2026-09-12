import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const relative = "patches/deepseek-harness/issue-103";
const setup = () => import("./prepare-harness.mjs");
const commit = async (directory) =>
  (await setup()).trustedGit(
    [
      "-c",
      "user.name=Setup test",
      "-c",
      "user.email=setup@example.invalid",
      "commit",
      "-am",
      "fixture",
    ],
    directory,
  );

async function temporary(t) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ast103-test-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function fixture(t) {
  const directory = await temporary(t);
  await cp(path.join(root, relative), path.join(directory, relative), { recursive: true });
  const { trustedGit } = await setup();
  await trustedGit(["init", "--object-format=sha1", directory], directory);
  await trustedGit(["add", "."], directory);
  await commit(directory);
  return directory;
}

test("boundary module exposes no preparation orchestrator or CLI", async () => {
  const boundary = await setup();
  assert.equal(boundary.prepare, undefined);
  assert.equal(boundary.privateEnvironment, undefined);
  assert.doesNotMatch(
    await readFile(new URL("./prepare-harness.mjs", import.meta.url), "utf8"),
    /import\.meta\.main/u,
  );
});

for (const [name, mutate, boundary] of [
  ["malformed", () => "{", /JSON/],
  ["wrong upstream", (value) => ({ ...value, upstream: "https://example.invalid" }), /upstream/],
  ["wrong base", (value) => ({ ...value, baseRevision: "0".repeat(40) }), /base revision/],
  ["wrong tree", (value) => ({ ...value, baseTree: "0".repeat(40) }), /base tree/],
  ["wrong scope", (value) => ({ ...value, scope: "runtime" }), /scope/],
  ["empty patches", (value) => ({ ...value, patches: [] }), /patch list/],
  [
    "duplicate",
    (value) => ({ ...value, patches: [value.patches[0], value.patches[0]] }),
    /duplicate/,
  ],
  [
    "bad hash",
    (value) => ({ ...value, patches: [{ ...value.patches[0], sha256: "bad" }] }),
    /hash/,
  ],
  ["reordered", (value) => ({ ...value, patches: value.patches.toReversed() }), /tracked/],
  ["changed bytes", (value) => JSON.stringify(value), /tracked/],
  [
    "unsafe path",
    (value) => ({ ...value, patches: [{ file: "../escape", sha256: "0".repeat(64) }] }),
    /path/,
  ],
]) {
  test(`series rejects ${name}`, async (t) => {
    const directory = await fixture(t);
    const file = path.join(directory, relative, "series.json");
    const changed = mutate(JSON.parse(await readFile(file, "utf8")));
    await writeFile(file, typeof changed === "string" ? changed : JSON.stringify(changed));
    await assert.rejects((await setup()).readSeries(directory), boundary);
  });
}

for (const missing of [false, true]) {
  test(`series rejects ${missing ? "missing" : "changed"} patch`, async (t) => {
    const directory = await fixture(t);
    const file = path.join(directory, relative, "0001-core-canonical-validator.patch");
    if (missing) await rm(file);
    else await writeFile(file, "changed");
    await assert.rejects((await setup()).readSeries(directory), missing ? /ENOENT/ : /hash/);
  });
}

test("missing manifest rejects at the input boundary", async (t) => {
  const directory = await fixture(t);
  await rm(path.join(directory, relative, "series.json"));
  await assert.rejects((await setup()).readSeries(directory), /ENOENT/);
});

for (const name of ["series.json", "0001-core-canonical-validator.patch"]) {
  test(`symlink ${name} rejects and preserves its target`, async (t) => {
    const directory = await fixture(t);
    const file = path.join(directory, relative, name);
    const target = path.join(directory, "target");
    const before = await readFile(file);
    await writeFile(target, before);
    await rm(file);
    await symlink(target, file);
    await assert.rejects((await setup()).readSeries(directory), /symlink/);
    assert.deepEqual(await readFile(target), before);
    assert.ok((await lstat(file)).isSymbolicLink());
  });
}

test("tracked input returns actual HEAD and ordered in-memory patch bytes", async (t) => {
  const directory = await fixture(t);
  const { readSeries, trustedGit, sha256 } = await setup();
  const result = await readSeries(directory);
  const manifest = await readFile(path.join(directory, relative, "series.json"));
  assert.equal(result.inputRevision, (await trustedGit(["rev-parse", "HEAD"], directory)).trim());
  assert.equal(result.seriesSha256, sha256(manifest));
  assert.deepEqual(result.series, JSON.parse(manifest));
  assert.equal(result.patches.length, 8);
  for (const [index, patch] of result.patches.entries()) {
    assert.equal(patch.file, result.series.patches[index].file);
    assert.deepEqual(patch.content, await readFile(path.join(directory, relative, patch.file)));
    assert.equal(sha256(patch.content), patch.sha256);
  }
  await rm(path.join(directory, relative), { recursive: true });
  assert.equal(sha256(result.patches[0].content), result.patches[0].sha256);
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("SHA-256 repositories reject at the existing Git owner's format boundary", async (t) => {
  const directory = await temporary(t);
  await cp(path.join(root, relative), path.join(directory, relative), { recursive: true });
  const { trustedGit, readSeries } = await setup();
  await trustedGit(["init", "--object-format=sha256", directory], directory);
  await assert.rejects(readSeries(directory), /Git object format/);
});

for (const replacement of [Buffer.from([0x81]), Buffer.from("\ufffd")]) {
  test(`manifest byte identity rejects replacement ${replacement.toString("hex")}`, async (t) => {
    const directory = await fixture(t);
    const file = path.join(directory, relative, "series.json");
    const series = JSON.parse(await readFile(file, "utf8"));
    const prefix = Buffer.from(JSON.stringify({ ...series, note: "" }).slice(0, -2));
    const suffix = Buffer.from('"}\n');
    await writeFile(file, Buffer.concat([prefix, Buffer.from([0x80]), suffix]));
    await commit(directory);
    await writeFile(file, Buffer.concat([prefix, replacement, suffix]));
    await assert.rejects((await setup()).readSeries(directory), /tracked|UTF-8/);
  });
}

test("unsafe and occupied work roots preserve caller content", async (t) => {
  const directory = await temporary(t);
  const occupied = path.join(directory, "occupied");
  const alias = path.join(directory, "alias");
  await mkdir(occupied, { mode: 0o700 });
  await writeFile(path.join(occupied, "sentinel"), "preserve");
  await symlink(occupied, alias);
  const { claimWork } = await setup();
  await assert.rejects(claimWork(occupied), /empty/);
  await assert.rejects(claimWork(root), /ancestry/);
  await assert.rejects(claimWork(path.dirname(root)), /ancestry/);
  await assert.rejects(claimWork(path.join(root, "scripts")), /ancestry/);
  await assert.rejects(claimWork(path.parse(root).root), /ancestry/);
  await assert.rejects(claimWork(alias), /ownership/);
  await assert.rejects(claimWork(path.join(directory, "missing")), /ENOENT/);
  await assert.rejects(claimWork(path.join(occupied, "sentinel")), /ownership/);
  assert.deepEqual(await readdir(occupied), ["sentinel"]);
  assert.equal(await readFile(path.join(occupied, "sentinel"), "utf8"), "preserve");
  assert.ok((await lstat(alias)).isSymbolicLink());
});

for (const mode of [0o720, 0o702]) {
  test(`work rejects writable mode ${mode.toString(8)} without changing it`, async (t) => {
    const directory = await temporary(t);
    await chmod(directory, mode);
    await assert.rejects((await setup()).claimWork(directory), /ownership/);
    assert.equal((await lstat(directory)).mode & 0o777, mode);
    assert.deepEqual(await readdir(directory), []);
  });
}

test("automatic and explicit claims return empty caller-owned roots for caller cleanup", async (t) => {
  const { claimWork } = await setup();
  const explicit = await temporary(t);
  assert.equal(await claimWork(explicit), explicit);
  const automatic = [];
  t.after(async () => {
    for (const directory of automatic) await rm(directory, { recursive: true, force: true });
  });
  automatic.push(await claimWork());
  automatic.push(await claimWork());
  assert.notEqual(automatic[0], automatic[1]);
  for (const directory of [explicit, ...automatic]) {
    assert.equal(await realpath(directory), directory);
    assert.deepEqual(await readdir(directory), []);
    assert.equal((await lstat(directory)).uid, process.getuid());
    assert.equal((await lstat(directory)).mode & 0o022, 0);
    assert.ok(!directory.startsWith(`${root}/`));
    if (directory !== explicit) assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
    await rm(directory, { recursive: true });
    await assert.rejects(lstat(directory), /ENOENT/);
  }
});
