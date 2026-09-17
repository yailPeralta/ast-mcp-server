import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { sha256 } from "./prepare-harness.mjs";
import { runBoundedCommand } from "../runtime-process.mjs";

/** Trusted installed payload only; no distribution authentication or runtime admission. */
export async function createNodeFixture(home = os.homedir()) {
  assert.equal(process.version, "v24.16.0");
  assert.equal(home, await fs.realpath(home), "canonical home required");
  for (let directory = home; ; directory = path.dirname(directory)) {
    const stat = await fs.lstat(directory);
    assert.ok(
      stat.isDirectory() && [0, process.getuid()].includes(stat.uid) && !(stat.mode & 0o022),
      "unsafe home ancestry",
    );
    if (directory === path.dirname(directory)) break;
  }
  assert.equal((await fs.lstat(home)).uid, process.getuid(), "caller home required");
  const prefix = await fs.mkdtemp(path.join(home, ".ast103-node-"));
  const active = new Set();
  let disposal;
  const dispose = () =>
    (disposal ??= (async () => {
      await Promise.allSettled([...active]);
      await fs.rm(prefix, { recursive: true, force: true });
    })());
  const nodeBin = path.join(prefix, "bin/node");
  const run = async (args, { cwd = import.meta.dirname, timeout = 300_000 } = {}) => {
    assert.ok(!disposal, "fixture disposed");
    assert.ok(Number.isFinite(timeout) && timeout > 0 && timeout <= 300_000, "bounded timeout");
    const command = runBoundedCommand(nodeBin, args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: `${prefix}/bin:/usr/bin:/bin`,
        HOME: prefix,
        NODE_OPTIONS: "",
        NODE_DISABLE_COMPILE_CACHE: "1",
        LANG: "C.UTF-8",
        TMPDIR: path.join(prefix, "tmp"),
        TMP: path.join(prefix, "tmp"),
        TEMP: path.join(prefix, "tmp"),
      },
    });
    active.add(command);
    try {
      return await command;
    } finally {
      active.delete(command);
    }
  };
  try {
    await fs.chmod(prefix, 0o700);
    const installedNode = await fs.realpath(process.execPath);
    const installed = path.dirname(path.dirname(installedNode));
    const records = [];
    const inside = (root, file) => file.startsWith(`${root}/`);
    const observe = async (file, kind) =>
      kind === "link" ? fs.readlink(file) : sha256(await fs.readFile(file));
    const copy = async (relative) => {
      const source = relative === "bin/node" ? installedNode : path.join(installed, relative);
      const target = path.join(prefix, relative);
      const stat = await fs.lstat(source);
      if (stat.isDirectory()) {
        await fs.mkdir(target, { mode: 0o700 });
        await fs.chmod(target, 0o700);
        for (const name of await fs.readdir(source)) await copy(path.join(relative, name));
        return;
      }
      assert.ok(stat.isFile() || stat.isSymbolicLink(), "unexpected payload type");
      const kind = stat.isSymbolicLink() ? "link" : "file";
      const value = await observe(source, kind);
      if (kind === "link") {
        assert.ok(
          !path.isAbsolute(value) && inside(installed, await fs.realpath(source)),
          "escaping payload link",
        );
        await fs.symlink(value, target);
      } else {
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
        await fs.chmod(target, 0o600 | (stat.mode & 0o100));
      }
      records.push({ source, target, kind, value });
    };
    for (const directory of ["tmp", "bin", "lib", "lib/node_modules"]) {
      await fs.mkdir(path.join(prefix, directory), { mode: 0o700 });
      await fs.chmod(path.join(prefix, directory), 0o700);
    }
    assert.ok((await fs.lstat(installedNode)).isFile(), "Node file required");
    await copy("bin/node");
    for (const name of ["corepack", "npm"]) {
      const directory = path.join(installed, "lib/node_modules", name);
      assert.ok((await fs.lstat(directory)).isDirectory(), "package directory required");
      assert.equal(await fs.realpath(directory), directory, "canonical package required");
      await copy(`lib/node_modules/${name}`);
      const metadata = JSON.parse(
        await fs.readFile(path.join(prefix, "lib/node_modules", name, "package.json")),
      );
      assert.equal(metadata.name, name, "package identity");
      for (const bin of name === "corepack" ? ["corepack"] : ["npm", "npx"]) {
        const entry = path.join(prefix, "lib/node_modules", name, metadata.bin[bin]);
        assert.ok(inside(prefix, await fs.realpath(entry)), "package entry containment");
        const target = path.join(prefix, "bin", bin);
        await fs.symlink(path.relative(path.dirname(target), entry), target);
      }
    }
    for (const { source, target, kind, value } of records) {
      assert.equal(await observe(source, kind), value, "original payload changed");
      assert.equal(await observe(target, kind), value, "copied payload changed");
      assert.ok(inside(prefix, await fs.realpath(target)), "copied link escape");
    }
    const actual = JSON.parse(
      (await run(["-p", "JSON.stringify({version:process.version,execPath:process.execPath})"]))
        .stdout,
    );
    assert.deepEqual(actual, { version: process.version, execPath: nodeBin });
    return { prefix, nodeBin, run, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
