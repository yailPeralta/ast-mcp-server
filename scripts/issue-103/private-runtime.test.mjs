import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test, { before, after, afterEach } from "node:test";
import { claimWork, sha256 } from "./prepare-harness.mjs";
import { createNodeFixture } from "./node-fixture.mjs";
import { runOrderedCleanup, runBoundedCommand } from "../runtime-process.mjs";

let fixture, work, outside, umask;
let active = Promise.resolve();
const transaction = (action) => (active = active.then(action));
// Cancellation of node:test never releases a fixture while its transaction still runs.
afterEach(
  async () => {
    await active.catch(() => {});
  },
  { timeout: 300_000 },
);
after(
  async () => {
    await active.catch(() => {});
    await runOrderedCleanup("runtime fixtures", [
      [
        "copied installation",
        async () => {
          if (fixture) {
            await fixture.dispose();
            await assert.rejects(fs.lstat(fixture.prefix), { code: "ENOENT" });
          }
        },
      ],
      ...[() => work, () => outside].map((get) => [
        "owned work",
        async () => {
          if (get()) {
            await fs.rm(get(), { recursive: true });
            await assert.rejects(fs.lstat(get()), { code: "ENOENT" });
          }
        },
      ]),
      [
        "umask",
        () => {
          if (umask !== undefined) process.umask(umask);
        },
      ],
    ]);
  },
  { timeout: 300_000 },
);
before(
  () =>
    transaction(async () => {
      umask = process.umask(0o077);
      fixture = await createNodeFixture();
      work = await claimWork();
      outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ast103-sentinel-")));
      await fs.writeFile(path.join(outside, "sentinel"), "preserve");
      const source = path.join(import.meta.dirname, "prepare-harness.mjs");
      const identity = JSON.parse((await fixture.run([source, "--work", work])).stdout);
      assert.equal(identity.work, work);
      assert.equal(identity.node.path, fixture.nodeBin);
      assert.equal(identity.node.sha256, sha256(await fs.readFile(fixture.nodeBin)));
      assert.equal(identity.pnpm.source, "corepack");
    }),
  { timeout: 300_000 },
);

async function runCases(t, role, leaves, run = fixture.run) {
  let result;
  try {
    result = await run([
      "--test-reporter=tap",
      ...(role === "unit" ? ["--experimental-test-module-mocks"] : []),
      path.join(import.meta.dirname, "private-runtime-cases.mjs"),
      role,
      work,
      fixture.prefix,
      outside,
      process.execPath,
    ]);
  } catch (error) {
    t.diagnostic(error.stdout ?? "");
    t.diagnostic(error.stderr ?? "");
    throw error;
  }
  t.diagnostic(result.stdout);
  const total = leaves.reduce((sum, count) => sum + count, leaves.length);
  for (const key of ["tests", "pass"])
    assert.match(result.stdout, new RegExp(`^# ${key} ${total}$`, "mu"));
  for (const key of ["fail", "cancelled", "skipped", "todo"])
    assert.match(result.stdout, new RegExp(`^# ${key} 0$`, "mu"));
  assert.match(result.stdout, new RegExp(`^1\\.\\.${leaves.length}$`, "mu"));
  assert.deepEqual(
    [...result.stdout.matchAll(/^ {4}1\.\.(\d+)$/gmu)].map((match) => Number(match[1])),
    leaves,
  );
}
for (const [role, leaves] of [
  ["metadata", [4, 14]],
  ["roots", [20]],
  ["caches", [20]],
  ["homes", [25]],
  ["bindings", [31]],
  ["layout", [23]],
  ["verify", [3]],
  ["source", [14]],
  ["unit", [4]],
])
  test(`read-only runtime ${role}`, { timeout: 300_000 }, (t) =>
    transaction(() => runCases(t, role, leaves)),
  );
test("read-only runtime original", { timeout: 300_000 }, (t) =>
  transaction(async () => {
    await runCases(t, "verify", [3]);
    const receipt = path.join(work, "identity.json");
    const raw = await fs.readFile(receipt);
    const identity = JSON.parse(raw);
    const launcher = path.join(work, "private/package-manager/bin/pnpm");
    const entry = path.join(
      path.dirname(path.dirname(process.execPath)),
      "lib/node_modules/corepack/dist/pnpm.js",
    );
    const observe = async (file) => {
      try {
        return (await fs.lstat(file)).isFile() && (await fs.realpath(file)) === file
          ? sha256(await fs.readFile(file))
          : undefined;
      } catch (error) {
        assert.ok(["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(error.code));
      }
    };
    // Only these two records change; source/pnpm/Git provenance remains genuine copied preparation.
    const reconciled = {
      ...identity,
      node: {
        path: process.execPath,
        version: process.version,
        sha256: await observe(process.execPath),
      },
      launcher: { path: entry, sha256: await observe(entry) },
    };
    const parked = `${launcher}.reconciliation`;
    await fs.rename(launcher, parked);
    try {
      await fs.symlink(entry, launcher);
      await fs.writeFile(receipt, JSON.stringify(reconciled));
      await runCases(t, "original", [1], (args) =>
        runBoundedCommand(process.execPath, args, {
          cwd: work,
          timeout: 300_000,
          maxBuffer: 1024 * 1024,
          env: {
            PATH: "/usr/bin:/bin",
            HOME: fixture.prefix,
            LANG: "C.UTF-8",
            NODE_OPTIONS: "",
            NODE_DISABLE_COMPILE_CACHE: "1",
            TMPDIR: path.join(work, "private/tmp"),
          },
        }),
      );
    } finally {
      await runOrderedCleanup("original fixture reconciliation", [
        ["receipt", () => fs.writeFile(receipt, raw)],
        [
          "private link",
          async () => {
            await fs.rm(launcher, { force: true });
            await fs.rename(parked, launcher);
          },
        ],
      ]);
      assert.deepEqual(await fs.readFile(receipt), raw);
      await runCases(t, "verify", [3]);
    }
  }),
);
test("failed transaction prevents fixture reuse", { timeout: 300_000 }, async () => {
  const failure = new Error("intentional transaction failure");
  let called = false;
  await assert.rejects(
    transaction(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  await assert.rejects(
    transaction(async () => {
      called = true;
    }),
    (error) => error === failure,
  );
  assert.equal(called, false);
});
