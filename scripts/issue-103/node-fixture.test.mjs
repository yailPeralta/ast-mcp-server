import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { sha256 } from "./prepare-harness.mjs";
import { runBoundedCommand } from "../runtime-process.mjs";

test.beforeEach((t) => {
  const umask = process.umask(0o077);
  t.after(() => process.umask(umask));
});

const load = () => import("./node-fixture.mjs");
const installed = path.dirname(path.dirname(process.execPath));

async function snapshot(root, copied = false, relative = "", metadata) {
  const file = path.join(root, relative);
  const stat = await fs.lstat(file);
  metadata?.push([relative, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs]);
  if (copied) {
    assert.equal(stat.uid, process.getuid());
    if (!stat.isSymbolicLink()) assert.equal(stat.mode & 0o077, 0);
  }
  if (stat.isSymbolicLink()) {
    const text = await fs.readlink(file);
    assert.ok(!path.isAbsolute(text));
    assert.ok((await fs.realpath(file)).startsWith(`${root}/`));
    return [[relative, text]];
  }
  if (stat.isFile()) return [[relative, sha256(await fs.readFile(file)), stat.mode & 0o100]];
  assert.ok(stat.isDirectory());
  const entries = [];
  for (const name of (await fs.readdir(file)).sort())
    entries.push(...(await snapshot(root, copied, path.join(relative, name), metadata)));
  return entries;
}

test("copies installed payload bytes and executes owned Node; disposal removes prefix", async (t) => {
  const payload = ["bin/node", "lib/node_modules/corepack", "lib/node_modules/npm"];
  const metadata = payload.map(() => []);
  const before = await Promise.all(
    payload.map((file, i) => snapshot(installed, false, file, metadata[i])),
  );
  const { createNodeFixture } = await load();
  const fixture = await createNodeFixture();
  t.after(() => fixture.dispose());
  assert.equal(await fs.realpath(fixture.prefix), fixture.prefix);
  assert.equal(path.dirname(fixture.prefix), os.homedir());
  assert.equal((await fs.lstat(fixture.prefix)).mode & 0o777, 0o700);
  assert.deepEqual(await fs.readdir(path.join(fixture.prefix, "lib/node_modules")), [
    "corepack",
    "npm",
  ]);
  for (const [index, file] of payload.entries()) {
    assert.deepEqual(await snapshot(fixture.prefix, true, file), before[index]);
    const after = [];
    assert.deepEqual(await snapshot(installed, false, file, after), before[index]);
    assert.deepEqual(after, metadata[index], "original metadata unchanged");
  }
  for (const [name, entry] of [
    ["corepack", "corepack/dist/corepack.js"],
    ["npm", "npm/bin/npm-cli.js"],
    ["npx", "npm/bin/npx-cli.js"],
  ]) {
    const bin = path.join(fixture.prefix, "bin", name);
    assert.equal(await fs.readlink(bin), `../lib/node_modules/${entry}`);
    assert.equal(await fs.realpath(bin), path.join(fixture.prefix, "lib/node_modules", entry));
  }
  assert.equal(
    (await fixture.run(["-p", "require('node:os').tmpdir()"])).stdout.trim(),
    path.join(fixture.prefix, "tmp"),
  );
  assert.equal(
    (
      await fixture.run([
        "-p",
        "require('node:module').enableCompileCache().status === require('node:module').constants.compileCacheStatus.DISABLED",
      ])
    ).stdout.trim(),
    "true",
  );
  for (const name of ["corepack", "npm"]) {
    const metadata = JSON.parse(
      await fs.readFile(path.join(installed, "lib/node_modules", name, "package.json")),
    );
    assert.equal(
      (await fixture.run([path.join(fixture.prefix, "bin", name), "--version"])).stdout.trim(),
      metadata.version,
    );
    t.diagnostic(`${name}@${metadata.version}`);
  }
  assert.equal((await fixture.run(["--version"])).stdout.trim(), "v24.16.0");
  const actual = JSON.parse(
    (
      await fixture.run([
        "-p",
        "JSON.stringify({version:process.version,execPath:process.execPath})",
      ])
    ).stdout,
  );
  assert.deepEqual(actual, { version: "v24.16.0", execPath: fixture.nodeBin });
  assert.notEqual((await fs.lstat(process.execPath)).ino, (await fs.lstat(fixture.nodeBin)).ino);
  const copiedEntry = path.join(fixture.prefix, "lib/node_modules/npm/bin/npm-cli.js");
  await fs.writeFile(copiedEntry, "owned mutation");
  assert.equal(await fs.readFile(copiedEntry, "utf8"), "owned mutation");
  assert.deepEqual(await snapshot(installed, false, payload[2]), before[2]);
  t.diagnostic(
    JSON.stringify({
      installed,
      node: actual,
      sha256: before[0][0][1],
      payloadSha256: before.map((entries) => sha256(JSON.stringify(entries))),
    }),
  );
  const child = fixture.run([
    "-e",
    "require('node:fs').accessSync(process.execPath); console.log(process.pid); process.exitCode = 7",
  ]);
  const rejected = assert.rejects(child, (error) => {
    assert.throws(() => process.kill(Number(error.stdout.trim()), 0), { code: "ESRCH" });
    return /exited with 7/.test(error.message);
  });
  await fixture.dispose();
  await rejected;
  await assert.rejects(fs.lstat(fixture.prefix), { code: "ENOENT" });
  await assert.rejects(fixture.run(["--version"]), /disposed/);
});

test("rejects owned unsafe ancestry and aliases without repair", async (t) => {
  const home = await fs.mkdtemp(path.join(os.homedir(), ".ast103-home-test-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const nested = path.join(home, "nested");
  const alias = path.join(home, "alias");
  await fs.mkdir(nested, { mode: 0o700 });
  await fs.symlink(nested, alias);
  const { createNodeFixture } = await load();
  await assert.rejects(createNodeFixture(alias), /canonical home/);
  await fs.chmod(home, 0o720);
  await assert.rejects(createNodeFixture(nested), /unsafe home ancestry/);
  assert.equal((await fs.lstat(home)).mode & 0o777, 0o720);
  assert.deepEqual(await fs.readdir(nested), []);
});

for (const [fault, expected] of [
  ["native-copy", /EISDIR|EEXIST/],
  ["bytes", /copied payload changed/],
  ["native-spawn", /EACCES/],
  ["nonregular", /unexpected payload type/],
  ["link-escape", /escaping payload link/],
]) {
  test(`narrow filesystem fault injection cleans claimed prefix: ${fault}`, async (t) => {
    const { createNodeFixture } = await load();
    const original = { ...fs };
    let prefix;
    t.after(async () => {
      t.mock.restoreAll();
      if (prefix) await fs.rm(prefix, { recursive: true, force: true });
    });
    t.mock.method(fs, "mkdtemp", async (...args) => (prefix = await original.mkdtemp(...args)));
    t.mock.method(fs, "copyFile", async (source, target, ...args) => {
      if (source !== process.execPath) return original.copyFile(source, target, ...args);
      if (fault === "native-copy") await fs.mkdir(target);
      await original.copyFile(source, target, ...args);
      if (fault === "bytes") await fs.writeFile(target, "corrupt owned copy");
    });
    if (fault === "native-spawn")
      t.mock.method(fs, "chmod", (file, mode) =>
        original.chmod(file, file === `${prefix}/bin/node` ? 0o600 : mode),
      );
    if (["nonregular", "link-escape"].includes(fault))
      t.mock.method(fs, "readdir", async (directory, ...args) => {
        if (directory === `${installed}/lib/node_modules/corepack`) {
          const owned = `${prefix}/injected`;
          if (fault === "nonregular") await runBoundedCommand("/usr/bin/mkfifo", [owned]);
          else await fs.symlink(process.execPath, owned);
          t.mock.method(fs, "lstat", (file, ...rest) =>
            original.lstat(file === `${directory}/injected` ? owned : file, ...rest),
          );
          t.mock.method(fs, "readlink", (file, ...rest) =>
            original.readlink(file === `${directory}/injected` ? owned : file, ...rest),
          );
          return ["injected"];
        }
        return original.readdir(directory, ...args);
      });
    await assert.rejects(createNodeFixture(), expected);
    assert.ok(prefix);
    await assert.rejects(original.lstat(prefix), { code: "ENOENT" });
  });
}
