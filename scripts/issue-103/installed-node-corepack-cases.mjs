import assert from "node:assert/strict";
import { digest, snapshot } from "./installed-node-footprint.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { runBoundedCommand } from "../runtime-process.mjs";

const prefix = path.dirname(path.dirname(process.execPath));
const corepack = path.join(prefix, "lib/node_modules/corepack/dist/pnpm.js");
const role = process.argv[1];
assert.ok(
  ["copy", "parked", "layout", "original", "multi", "aliases", "unreadable"].includes(role),
  "explicit fixture role required",
);
if (role !== "original") {
  assert.equal(process.env.HOME, prefix, "fixture HOME required");
  assert.match(path.basename(prefix), /^\.ast103-node-/);
  assert.equal((await fs.lstat(prefix)).uid, process.getuid());
  assert.equal((await fs.lstat(prefix)).mode & 0o777, 0o700);
  await fs.writeFile(path.join(prefix, "sentinel"), "preserve me");
}

async function observe(check, boundary) {
  const root = boundary ? path.parse(prefix).root : prefix;
  const before = await snapshot(root, { boundary });
  try {
    const { inspectInstalledNodeCorepack } = await import("./installed-node-corepack.mjs");
    await check(inspectInstalledNodeCorepack);
  } finally {
    assert.deepEqual(
      await snapshot(root, { boundary }),
      before,
      "observer preserves post-fault state",
    );
  }
}

async function fault(file, kind, check) {
  const saved = `${file}.saved`;
  const stat = await fs.lstat(file);
  const mode = stat.mode;
  await fs.rename(file, saved);
  try {
    if (kind === "file") await fs.writeFile(file, "not a directory");
    else if (kind === "fifo")
      await runBoundedCommand("/usr/bin/mkfifo", [file], {
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
      });
    else if (kind === "relative-escape") await fs.symlink("../../../../bin/node", file);
    else if (kind === "relative-dangling") await fs.symlink("absent", file);
    else if (kind === "escape") await fs.symlink("/bin/sh", file);
    else if (kind === "directory") await fs.mkdir(file);
    else if (kind === "dangling") await fs.symlink(`${file}.absent`, file);
    else if (kind === "wrong") await fs.symlink(corepack, file);
    else if (kind === "same-byte") await fs.copyFile(process.execPath, file);
    else if (kind === "symlink") await fs.symlink(saved, file);
    else if (kind === "hardlink") await fs.link(saved, file);
    else if (kind !== "missing") {
      if (stat.isDirectory()) await fs.cp(saved, file, { recursive: true });
      else await fs.copyFile(saved, file);
      await fs.chmod(
        file,
        kind === "no-X"
          ? 0o600
          : mode | (["group", "multi"].includes(kind) ? 0o020 : kind === "world" ? 0o002 : 0),
      );
      if (kind === "multi") await fs.chmod(path.join(file, "node"), 0o720);
      if (kind === "bytes") {
        if (file === process.execPath) await fs.appendFile(file, "path bytes, not loaded image");
        else
          await fs.writeFile(
            file,
            `require('node:fs').writeFileSync(${JSON.stringify(path.join(prefix, "payload-marker"))}, 'executed');`,
          );
      }
    }
    await observe(check);
  } finally {
    await fs.rm(file, { recursive: true, force: true });
    await fs.rename(saved, file);
  }
}

for (const file of role === "copy" ? [process.execPath, corepack] : []) {
  test(`fresh trusted path bytes: ${path.basename(file)}`, async () => {
    const before = await digest(file);
    await fault(file, "bytes", async (inspect) => {
      const actual = await inspect();
      const expected = await digest(file);
      assert.notEqual(expected, before);
      assert.equal((file === corepack ? actual.corepack : actual.node).sha256, expected);
      assert.equal(actual.node.version, process.version);
      await assert.rejects(fs.lstat(path.join(prefix, "payload-marker")), { code: "ENOENT" });
    });
  });
  for (const kind of [
    "missing",
    "directory",
    "symlink",
    "escape",
    "fifo",
    "hardlink",
    "group",
    "world",
    "no-X",
  ]) {
    test(`rejects installed file ${path.basename(file)}: ${kind}`, async () => {
      await fault(file, kind, (inspect) =>
        assert.rejects(inspect, (error) => {
          if (["missing", "no-X"].includes(kind)) {
            assert.equal(error.code, kind === "missing" ? "ENOENT" : "EACCES");
            assert.equal(error.path, file);
          } else assert.equal(error.message, `unsafe installed file: ${file}`);
          return true;
        }),
      );
    });
  }
}

for (const directory of role === "copy"
  ? [path.dirname(process.execPath), path.dirname(corepack)]
  : []) {
  for (const kind of ["missing", "file", "symlink", "group", "world"]) {
    test(`rejects ancestry ${path.basename(directory)}: ${kind}`, async () => {
      await fault(directory, kind, (inspect) =>
        assert.rejects(inspect, (error) => {
          if (kind === "missing") {
            assert.equal(error.code, "ENOENT");
            assert.equal(error.path, directory);
          } else assert.equal(error.message, `unsafe installed ancestry: ${directory}`);
          return true;
        }),
      );
    });
  }
}

async function originalProblems() {
  const problems = [];
  for (const file of [process.execPath, corepack]) {
    for (let item = file; ; item = path.dirname(item)) {
      try {
        const stat = await fs.lstat(item);
        const regular = item === file ? stat.isFile() && stat.nlink === 1 : stat.isDirectory();
        if (!regular || ![0, process.getuid()].includes(stat.uid) || stat.mode & 0o022)
          problems.push({ item, reason: item === file ? "file" : "ancestry" });
        assert.equal(await fs.realpath(item), item, "canonical");
        if (item === file) await fs.access(item, fs.constants.X_OK);
      } catch (error) {
        problems.push({ item, reason: error.code ?? error.message });
      }
      if (item === path.dirname(item)) break;
    }
  }
  if (path.basename(path.dirname(process.execPath)) !== "bin")
    problems.push({ reason: "standard bin" });
  try {
    assert.equal(await fs.realpath(path.join(prefix, "bin/node")), process.execPath);
  } catch {
    problems.push({ reason: "Node selection" });
  }
  return problems;
}

test("native installed Node observation and independent original oracle", (t) =>
  role === "multi"
    ? fault(path.dirname(process.execPath), "multi", () => originalObservation(t, true))
    : originalObservation(t, role === "original"));

async function originalObservation(t, original) {
  const boundary = original
    ? [process.execPath, corepack, path.join(prefix, "bin/node")]
    : undefined;
  if (role === "layout") return observe((inspect) => assert.rejects(inspect, /standard bin/));
  if (original) {
    const problems = await originalProblems();
    if (problems.length) {
      t.diagnostic(JSON.stringify(problems));
      return observe(
        (inspect) =>
          assert.rejects(inspect, (error) => {
            assert.ok(
              problems.some(({ item, reason }) =>
                item
                  ? error.message === `unsafe installed ${reason}: ${item}` ||
                    (error.code === reason && error.path === item)
                  : error.message.includes(reason),
              ),
            );
            return true;
          }),
        boundary,
      );
    }
  }
  const expected = {
    node: {
      path: process.execPath,
      version: process.version,
      sha256: await digest(process.execPath),
    },
    corepack: { path: corepack, sha256: await digest(corepack) },
  };
  for (let repeat = 0; repeat < 2; repeat++)
    await observe(async (inspect) => assert.deepEqual(await inspect(), expected), boundary);
}

async function originalWrapper(t) {
  const result = await runBoundedCommand(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "--test-timeout=300000",
      "--test-name-pattern=observation cases: original",
      fileURLToPath(new URL("./node-fixture.test.mjs", import.meta.url)),
    ],
    {
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
      env: { NODE_OPTIONS: "", NODE_DISABLE_COMPILE_CACHE: "1" },
    },
  ).catch((error) => {
    t.diagnostic(error.stdout);
    throw error;
  });
  t.diagnostic(result.stdout);
  assert.match(
    result.stdout,
    /# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0/,
  );
}

for (const kind of role === "aliases" ? ["symlink", "relative-escape", "relative-dangling"] : []) {
  test(`real original wrapper attributes owned alias: ${kind}`, async (t) => {
    await fault(corepack, kind, () => originalWrapper(t));
  });
}

if (role === "unreadable") {
  test("real original wrapper ignores unrelated unreadable bytes", async (t) => {
    const file = path.join(prefix, "unrelated-unreadable");
    const handle = await fs.open(file, "wx+", 0o600);
    try {
      await handle.writeFile("irrelevant bytes");
      const expected = await digest(file);
      await handle.chmod(0o000);
      await assert.rejects(fs.readFile(file), { code: "EACCES" });
      const opened = { file, handle };
      assert.equal((await snapshot(file, { opened }))[1], expected);
      const before = await snapshot(prefix, { opened });
      try {
        await originalWrapper(t);
      } finally {
        assert.deepEqual(await snapshot(prefix, { opened }), before);
      }
    } finally {
      try {
        await handle.chmod(0o600);
      } finally {
        await handle.close();
        await fs.rm(file);
      }
    }
  });
}

for (const kind of role === "parked" ? ["missing", "dangling", "wrong", "same-byte"] : []) {
  test(`rejects lexical bin/node selection: ${kind}`, async () => {
    assert.equal(path.basename(process.execPath), "node-real");
    await fault(path.join(prefix, "bin/node"), kind, (inspect) =>
      assert.rejects(inspect, /Node selection/),
    );
  });
}
