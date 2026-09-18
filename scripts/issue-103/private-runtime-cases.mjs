import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test, { after, mock } from "node:test";
import { Buffer } from "node:buffer";
import { syncBuiltinESMExports } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { snapshot, digest } from "./installed-node-footprint.mjs";

const [role, work, prefix, outside, originalNode] = process.argv.slice(2);
assert.equal(process.argv.length, 7);
assert.ok(
  [
    "metadata",
    "roots",
    "caches",
    "homes",
    "bindings",
    "layout",
    "verify",
    "source",
    "unit",
    "original",
  ].includes(role),
);
assert.equal(process.version, "v24.16.0");
if (role === "original") {
  assert.equal(process.execPath, originalNode);
  assert.notEqual(process.execPath, path.join(prefix, "bin/node"));
} else {
  assert.equal(await fs.realpath(process.execPath), process.execPath);
  assert.equal(process.execPath, path.join(prefix, "bin/node"));
  assert.notEqual(process.execPath, originalNode);
}
assert.equal(process.env.HOME, prefix);
assert.ok(path.basename(prefix).startsWith(".ast103-node-"));
assert.equal(await fs.realpath(prefix), prefix);
assert.equal((await fs.lstat(prefix)).uid, process.getuid());
const receipt = path.join(work, "identity.json");
const bytes = await fs.readFile(receipt);
const identity = JSON.parse(bytes);
assert.equal(identity.node.path, process.execPath);
if (role !== "original") assert.equal(identity.node.sha256, await digest(process.execPath));
assert.equal(identity.node.version, process.version);
assert.equal(identity.pnpm.source, "corepack");
assert.equal(identity.work, work);
assert.equal(await fs.readFile(path.join(outside, "sentinel"), "utf8"), "preserve");

let configured;
const projectedProcess = { ...process, env: { ...process.env, ADMISSION_CANARY: "unit" } };
if (role === "unit") {
  const manager = await import("../private-pnpm.mjs");
  after(() => mock.restoreAll());
  mock.module("node:process", { defaultExport: projectedProcess });
  mock.module("../private-pnpm.mjs", {
    namedExports: {
      ...manager,
      inspectPrivatePnpmEnvironment(options) {
        configured = options;
        return manager.inspectPrivatePnpmEnvironment(options);
      },
    },
  });
}
const owner = await import("./prepare-harness.mjs");
assert.equal(typeof owner.inspectPrivateRuntime, "function");

async function preserved(action) {
  const before = [];
  for (const root of [work, prefix, outside]) before.push(await snapshot(root));
  try {
    await action();
  } finally {
    for (const [index, root] of [work, prefix, outside].entries())
      assert.deepEqual(await snapshot(root), before[index], "inspection wrote state");
  }
}
async function withBytes(file, value, action) {
  assert.notEqual(role, "original", "original role never mutates installation");
  const stat = await fs.lstat(file);
  const parked = `${file}.bytes`;
  await fs.rename(file, parked);
  try {
    await fs.writeFile(file, value, { mode: stat.mode });
    await action();
  } finally {
    await fs.rm(file, { force: true });
    await fs.rename(parked, file);
  }
}
async function withPathFault(file, kind, action) {
  assert.notEqual(role, "original", "original role never mutates installation");
  const stat = await fs.lstat(file);
  const parked = `${file}.parked`;
  const mode = ["group", "world", "noexec"].includes(kind);
  try {
    if (mode)
      await fs.chmod(
        file,
        kind === "noexec" ? stat.mode & ~0o111 : stat.mode | (kind === "group" ? 0o020 : 0o002),
      );
    else {
      await fs.rename(file, parked);
      if (kind === "type") {
        if (stat.isDirectory()) await fs.writeFile(file, "not a directory");
        else await fs.mkdir(file);
      }
      if (kind === "link") await fs.symlink(outside, file);
    }
    await action();
  } finally {
    if (mode) await fs.chmod(file, stat.mode);
    else {
      await fs.rm(file, { recursive: true, force: true });
      await fs.rename(parked, file);
    }
  }
}
const success = () =>
  preserved(async () => {
    assert.deepEqual(await owner.inspectPrivateRuntime(work), {
      work,
      identity,
      launcher: path.join(work, "private/package-manager/bin/pnpm"),
    });
  });
const reject = (expected) =>
  preserved(() => assert.rejects(owner.inspectPrivateRuntime(work), expected));
const rejectReceipt = (value, expected) =>
  withBytes(receipt, JSON.stringify(value), () => reject(expected));

if (role === "original")
  await test("original-context owned reconciliation, never original provisioning", (t) =>
    t.test(
      "actual original admits safely or rejects an independently observed property",
      async () => {
        const corepack = path.join(
          path.dirname(path.dirname(process.execPath)),
          "lib/node_modules/corepack/dist/pnpm.js",
        );
        const boundary = [
          process.execPath,
          corepack,
          path.join(path.dirname(process.execPath), "node"),
        ];
        const before = await snapshot(path.parse(process.execPath).root, { boundary });
        const problems = [];
        try {
          for (const [record, file] of [
            [identity.node, process.execPath],
            [identity.launcher, corepack],
          ]) {
            for (let item = file; ; item = path.dirname(item)) {
              try {
                const stat = await fs.lstat(item);
                const kind = item === file ? "file" : "ancestry";
                if (
                  !(item === file ? stat.isFile() && stat.nlink === 1 : stat.isDirectory()) ||
                  ![0, process.getuid()].includes(stat.uid) ||
                  stat.mode & 0o022
                )
                  problems.push({ message: `unsafe installed ${kind}: ${item}` });
                if (item === file) await fs.access(item, fs.constants.X_OK);
              } catch (error) {
                problems.push({ code: error.code, item });
              }
              if (item === path.dirname(item)) break;
            }
            let hash;
            try {
              if ((await fs.lstat(file)).isFile() && (await fs.realpath(file)) === file)
                hash = await digest(file);
            } catch (error) {
              assert.ok(["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(error.code));
              problems.push({ code: error.code, item: file });
            }
            assert.equal(record.path, file);
            assert.equal(
              record.sha256,
              hash,
              "real original observation, or explicitly unavailable",
            );
          }
          if (path.basename(path.dirname(process.execPath)) !== "bin")
            problems.push({ message: "standard bin" });
          try {
            if ((await fs.realpath(boundary[2])) !== process.execPath)
              problems.push({ message: "Node selection must resolve" });
          } catch {
            problems.push({ message: "Node selection lookup failed" });
          }
          t.diagnostic(JSON.stringify({ originalProperties: problems }));
          if (problems.length)
            await reject((error) => {
              assert.ok(
                problems.some(({ message, code, item }) =>
                  message
                    ? error.message.includes(message)
                    : error.code === code && error.path === item,
                ),
                "independently observed original cause",
              );
              return true;
            });
          else await success();
        } finally {
          assert.deepEqual(await snapshot(path.parse(process.execPath).root, { boundary }), before);
        }
      },
    ));
if (role === "unit")
  await test("UNIT process, configuration and consistency seams", async (t) => {
    await t.test("UNIT wrong observed pin, not native wrong-version proof", async () => {
      projectedProcess.version = "v24.15.0";
      try {
        await reject(/Node pin/u);
        assert.equal(process.version, "v24.16.0");
      } finally {
        projectedProcess.version = process.version;
      }
    });
    await t.test(
      "UNIT configured inspector delegates with admitted Node and closed base",
      async () => {
        await success();
        const tmp = path.join(work, "private/tmp");
        assert.ok(
          isDeepStrictEqual(configured, {
            temporaryRoot: path.join(work, "private"),
            nodeBin: process.execPath,
            baseEnvironment: {
              PATH: "/usr/bin:/bin",
              LANG: "C.UTF-8",
              TMPDIR: tmp,
              TMP: tmp,
              TEMP: tmp,
            },
          }),
          "closed configuration",
        );
      },
    );
    for (const kind of ["receipt", "identity"])
      await t.test(`UNIT ${kind} consistency, not a concurrent-attacker proof`, () =>
        preserved(async () => {
          const read = fs.readFile;
          let reads = 0;
          fs.readFile = async (file, ...args) => {
            const value = await read(file, ...args);
            if (file !== receipt || ++reads === 1) return value;
            return Buffer.from(
              kind === "receipt"
                ? `${value} `
                : JSON.stringify({
                    ...JSON.parse(value),
                    git: { ...identity.git, sha256: "unit" },
                  }),
            );
          };
          syncBuiltinESMExports();
          try {
            await assert.rejects(
              owner.inspectPrivateRuntime(work),
              new RegExp(`runtime ${kind} changed`, "u"),
            );
            assert.equal(reads, kind === "receipt" ? 3 : 2);
          } finally {
            fs.readFile = read;
            syncBuiltinESMExports();
          }
        }),
      );
  });
if (role === "verify")
  await test("complete fresh Corepack admission", async (t) => {
    await t.test("complete lexical result twice without writes", async () => {
      await success();
      await success();
    });
    await t.test("fresh source bytes despite valid runtime records", () =>
      withBytes(path.join(work, "candidate/package.json"), "{}", () => reject(/source blob/u)),
    );
    await t.test("legitimate raw formatting and restored source succeed", () =>
      withBytes(receipt, JSON.stringify(identity, null, 4), success),
    );
  });
if (role === "source")
  await test("owned receipt and fresh source bridges", async (t) => {
    for (const record of ["trees", "sources"])
      for (const field of Object.keys(identity[record]))
        await t.test(`missing ${record}.${field}`, () =>
          rejectReceipt(
            { ...identity, [record]: { ...identity[record], [field]: undefined } },
            /recorded (?:trees|source hashes)/u,
          ),
        );
    await t.test("wrong candidate tree", () =>
      rejectReceipt(
        { ...identity, trees: { ...identity.trees, candidate: "wrong" } },
        /recorded trees/u,
      ),
    );
    await t.test("stale input", () =>
      rejectReceipt({ ...identity, inputRevision: "stale" }, /stale preparation/u),
    );
    await t.test("missing receipt", () =>
      withPathFault(receipt, "missing", () => reject({ code: "ENOENT" })),
    );
    await t.test("malformed receipt", () => withBytes(receipt, "{", () => reject(SyntaxError)));
    await t.test("unsafe receipt precedes malformed JSON", () =>
      withBytes(receipt, "{", () =>
        withPathFault(receipt, "group", () => reject(/unsafe prepared path/u)),
      ),
    );
    await t.test("unsafe work", () =>
      withPathFault(work, "group", () => reject(/unsafe prepared path/u)),
    );
    await t.test("preparation marker", async () => {
      const marker = path.join(work, ".preparing");
      try {
        await fs.writeFile(marker, "");
        await reject(/preparation in progress/u);
      } finally {
        await fs.rm(marker);
      }
    });
    await t.test("work alias", async () => {
      const alias = path.join(outside, "alias");
      try {
        await fs.symlink(work, alias);
        await preserved(() =>
          assert.rejects(owner.inspectPrivateRuntime(alias), /unsafe prepared path/u),
        );
      } finally {
        await fs.rm(alias);
      }
    });
    await t.test("cache links and ignored outputs survive repeated admission", async () => {
      for (const cache of ["corepack", "pnpm", "xdg-cache", "npm-cache"])
        await fs.symlink(
          outside,
          path.join(work, "private/package-manager", cache, "admission-link"),
        );
      for (const variant of ["baseline", "candidate"]) {
        const output = path.join(work, variant, "node_modules");
        await fs.mkdir(output);
        await fs.writeFile(path.join(output, "sentinel"), "ignored, not authenticated");
      }
      await success();
      await success();
    });
  });
if (role === "metadata") {
  await test("runtime profile admission", async (t) => {
    await t.test("exports the runtime admission operation", () => {
      assert.equal(typeof owner.inspectPrivateRuntime, "function");
    });
    for (const profile of ["verified-archive-launcher", "unknown"])
      await t.test(`rejects unsupported ${profile}`, () =>
        rejectReceipt(
          { ...identity, pnpm: { ...identity.pnpm, source: profile } },
          { code: "ERR_UNSUPPORTED_PNPM_PROFILE" },
        ),
      );
    await t.test("unsupported profile precedes stale source", () =>
      rejectReceipt(
        { ...identity, inputRevision: "stale", pnpm: { ...identity.pnpm, source: "unknown" } },
        { code: "ERR_UNSUPPORTED_PNPM_PROFILE" },
      ),
    );
  });
  await test("pnpm metadata is untrusted", async (t) => {
    for (const pnpm of [
      undefined,
      null,
      [],
      "corepack",
      {},
      ...["version", "descriptor", "sha512"].flatMap((field) =>
        [undefined, "wrong"].map((value) => ({ ...identity.pnpm, [field]: value })),
      ),
      ...[undefined, "", 1].map((source) => ({ ...identity.pnpm, source })),
    ])
      await t.test(`rejects pnpm metadata ${JSON.stringify(pnpm)}`, () =>
        rejectReceipt({ ...identity, pnpm }, /pnpm metadata/u),
      );
  });
}
if (["roots", "caches", "homes"].includes(role))
  await test(`fixed helper targets: ${role}`, async (t) => {
    const targets =
      role === "roots"
        ? ["private", "private/tmp", "private/package-manager", "private/package-manager/bin"]
        : (role === "caches"
            ? ["corepack", "pnpm", "xdg-cache", "npm-cache"]
            : ["home", "xdg-config", "xdg-data", "xdg-state", "npmrc"]
          ).map((name) => `private/package-manager/${name}`);
    for (const relative of targets)
      for (const kind of ["missing", "type", "link", "group", "world"])
        await t.test(`${relative}: ${kind}`, () => {
          const file = path.join(work, relative);
          return withPathFault(file, kind, () =>
            reject((error) => {
              assert.ok(
                error.path?.startsWith(file) || error.message.includes(file),
                "target-specific rejection",
              );
              assert.match(error.message, /unsafe (?:environment|prepared) path|ENOENT|ENOTDIR/u);
              return true;
            }),
          );
        });
  });
if (role === "bindings")
  await test("every installed record field binds actual observations", async (t) => {
    for (const [record, fields] of [
      ["node", ["path", "version", "sha256"]],
      ["git", ["binary", "realpath", "sha256"]],
      ["launcher", ["path", "sha256"]],
    ]) {
      const expected = new RegExp(`recorded ${record}`, "u");
      for (const value of [undefined, null, [], "wrong", {}])
        await t.test(`${record} shape ${JSON.stringify(value)}`, () =>
          rejectReceipt({ ...identity, [record]: value }, expected),
        );
      for (const field of fields)
        for (const value of [undefined, "wrong"])
          await t.test(`${record}.${field} ${value ?? "missing"}`, () =>
            rejectReceipt(
              { ...identity, [record]: { ...identity[record], [field]: value } },
              expected,
            ),
          );
    }
  });
if (role === "layout")
  await test("native executable selection and private layout", async (t) => {
    const bin = path.join(work, "private/package-manager/bin");
    const launcher = path.join(bin, "pnpm");
    const npmrc = path.join(work, "private/package-manager/npmrc");
    await t.test("recorded Git pathname cannot execute a sentinel", async () => {
      const fake = path.join(outside, "git");
      try {
        await fs.writeFile(fake, `#!/bin/sh\necho executed > ${outside}/sentinel\n`, {
          mode: 0o700,
        });
        await rejectReceipt(
          { ...identity, git: { ...identity.git, binary: fake } },
          /recorded git.binary/u,
        );
      } finally {
        await fs.rm(fake);
      }
    });
    await t.test("nonempty npmrc", () =>
      withBytes(npmrc, "unsafe", () => reject(/unsafe environment path/u)),
    );
    await t.test("hardlinked npmrc", async () => {
      const link = path.join(outside, "npmrc");
      try {
        await fs.link(npmrc, link);
        await reject(/unsafe environment path/u);
      } finally {
        await fs.rm(link);
      }
    });
    for (const kind of ["executable", "plain", "dangling", "real-node", "directory"])
      await t.test(`private Node shadow ${kind}`, async () => {
        const file = path.join(bin, "node");
        try {
          if (kind === "directory") await fs.mkdir(file);
          else if (["dangling", "real-node"].includes(kind))
            await fs.symlink(kind === "dangling" ? "absent" : process.execPath, file);
          else
            await fs.writeFile(file, `#!/bin/sh\necho executed > ${outside}/sentinel\n`, {
              mode: kind === "executable" ? 0o700 : 0o600,
            });
          await reject(/shadows caller configuration/u);
        } finally {
          await fs.rm(file, { recursive: true });
        }
      });
    for (const [file, kind, expected] of [
      [process.execPath, "group", /unsafe installed file/u],
      [prefix, "group", /unsafe installed ancestry/u],
      [process.execPath, "link", /unsafe installed file/u],
      [identity.launcher.path, "group", /unsafe installed file/u],
      [path.dirname(identity.launcher.path), "group", /unsafe installed ancestry/u],
      [identity.launcher.path, "noexec", /EACCES/u],
    ])
      await t.test(`installed ${file}: ${kind}`, () =>
        withPathFault(file, kind, () => reject(expected)),
      );
    await t.test("changed Node path bytes are not the loaded image", () =>
      withBytes(process.execPath, "not executed", () => reject(/recorded node.sha256/u)),
    );
    await t.test("fake Corepack entry is never executed", () =>
      withBytes(identity.launcher.path, `#!/bin/sh\necho executed > ${outside}/sentinel\n`, () =>
        reject(/recorded launcher.sha256/u),
      ),
    );
    for (const kind of ["missing", "type", "link"])
      await t.test(`private launcher ${kind}`, () =>
        withPathFault(launcher, kind, () =>
          reject(kind === "missing" ? /ENOENT/u : /private Corepack launcher/u),
        ),
      );
    await t.test("regular same-byte launcher", async () =>
      withBytes(launcher, await fs.readFile(identity.launcher.path), () =>
        reject(/private Corepack launcher/u),
      ),
    );
    for (const kind of ["dangling", "indirection", "same-byte"])
      await t.test(`private launcher ${kind}`, async () => {
        const alternative = path.join(outside, "entry");
        try {
          if (kind === "indirection") await fs.symlink(identity.launcher.path, alternative);
          if (kind === "same-byte") {
            await fs.copyFile(identity.launcher.path, alternative);
            assert.equal(await digest(alternative), identity.launcher.sha256);
          }
          await withPathFault(launcher, "missing", async () => {
            await fs.symlink(alternative, launcher);
            if (kind === "same-byte")
              await rejectReceipt(
                { ...identity, launcher: { path: alternative, sha256: identity.launcher.sha256 } },
                /recorded launcher.path/u,
              );
            else await reject(/private Corepack launcher/u);
          });
        } finally {
          await fs.rm(alternative, { force: true });
        }
      });
  });
