import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { createNodeFixture } from "./node-fixture.mjs";
import { claimWork, sha256 } from "./prepare-harness.mjs";
import { runPreparedPnpm, runPreparedVariantPnpm } from "./prepared-runner.mjs";
import { withOfficialPreparationLock } from "./test-lock.mjs";

async function changed(file, bytes, action) {
  const original = await fs.readFile(file);
  try {
    await fs.writeFile(file, bytes);
    await action();
  } finally {
    await fs.writeFile(file, original);
  }
}

test.beforeEach((t) => {
  const umask = process.umask(0o077);
  t.after(() => process.umask(umask));
});

test("readmitted prepared work runs only the recorded private pnpm launcher", async (t) => {
  const fixture = await createNodeFixture();
  const work = await claimWork();
  t.after(async () => {
    await fixture.dispose();
    await fs.rm(work, { recursive: true, force: true });
  });
  const source = path.join(import.meta.dirname, "prepare-harness.mjs");
  const identity = JSON.parse(
    (await withOfficialPreparationLock(() => fixture.run([source, "--work", work]))).stdout,
  );

  const version = await runPreparedPnpm(work, ["--version"]);
  assert.equal(version.stdout.trim(), "11.7.0");
  assert.equal(version.stderr, "");
  assert.equal(sha256(await fs.readFile(identity.launcher.path)), identity.launcher.sha256);

  const candidateRoot = await runPreparedVariantPnpm(work, "candidate", ["root"]);
  assert.equal(candidateRoot.stdout.trim(), path.join(work, "candidate", "node_modules"));
  assert.equal(candidateRoot.stderr, "");

  const nestedCwd = path.join(work, "candidate", "node_modules", ".runner-cwd");
  await fs.mkdir(nestedCwd, { recursive: true });
  const nestedRoot = await runPreparedVariantPnpm(work, "candidate", ["--dir", "../..", "root"], {
    cwd: "node_modules/.runner-cwd",
  });
  assert.equal(nestedRoot.stdout.trim(), path.join(work, "candidate", "node_modules"));
  assert.equal(nestedRoot.stderr, "");
  await assert.rejects(
    runPreparedVariantPnpm(work, "published", ["--version"]),
    /prepared source variant/,
  );
  await assert.rejects(
    runPreparedVariantPnpm(work, "candidate", ["--version"], { cwd: ".." }),
    /cwd must stay under prepared source variant/,
  );

  const outsideCwd = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "ast103-runner-cwd-")),
  );
  t.after(() => fs.rm(outsideCwd, { recursive: true, force: true }));
  await fs.appendFile(path.join(work, "candidate", ".git", "info", "exclude"), "\nnode_modules\n");
  await fs.rm(path.join(work, "candidate", "node_modules"), { recursive: true, force: true });
  await fs.symlink(outsideCwd, path.join(work, "candidate", "node_modules"));
  await assert.rejects(
    runPreparedVariantPnpm(work, "candidate", ["root"], { cwd: "node_modules" }),
    /cwd must stay under prepared source variant/,
  );
  await fs.rm(path.join(work, "candidate", "node_modules"));
  await fs.mkdir(path.join(work, "candidate", "node_modules"), { recursive: true });
  await fs.writeFile(path.join(work, "candidate", "node_modules", "not-a-directory"), "file");
  await assert.rejects(
    runPreparedVariantPnpm(work, "candidate", ["root"], {
      cwd: "node_modules/not-a-directory",
    }),
    /cwd must be directory/,
  );

  const receiptFile = path.join(work, "identity.json");
  await changed(
    receiptFile,
    JSON.stringify({
      ...identity,
      launcher: { ...identity.launcher, sha256: "0".repeat(64) },
    }),
    async () => {
      await assert.rejects(runPreparedPnpm(work, ["--version"]), /launcher digest/);
    },
  );

  const outside = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "ast103-runner-escape-")),
  );
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const home = path.join(work, "private/package-manager/home");
  await fs.rm(home, { recursive: true, force: true });
  await fs.symlink(outside, home);
  await assert.rejects(runPreparedPnpm(work, ["--version"]), /private environment path/);
});
