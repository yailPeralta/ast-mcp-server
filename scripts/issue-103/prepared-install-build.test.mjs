import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { createNodeFixture } from "./node-fixture.mjs";
import { claimWork, privateEnvironment } from "./prepare-harness.mjs";
import { runPreparedCandidateInstall } from "./prepared-runner.mjs";
import { withOfficialPreparationLock } from "./test-lock.mjs";

async function prepareOfficialWork(t) {
  const fixture = await createNodeFixture();
  const work = await claimWork();
  t.after(async () => {
    await fixture.dispose();
    await fs.rm(work, { recursive: true, force: true });
  });
  const source = path.join(import.meta.dirname, "prepare-harness.mjs");
  await withOfficialPreparationLock(() => fixture.run([source, "--work", work]));
  return work;
}

test.beforeEach((t) => {
  const umask = process.umask(0o077);
  t.after(() => process.umask(umask));
});

test("prepared candidate install uses fixed private pnpm install and readmits source", async (t) => {
  const work = await prepareOfficialWork(t);

  const result = await runPreparedCandidateInstall(work);

  assert.equal(result.stderr, "");
});

test("prepared candidate install rejects source drift after command success", async (t) => {
  const work = await prepareOfficialWork(t);
  const source = path.join(work, "candidate", "packages/core/tools/src/index.ts");

  await assert.rejects(
    runPreparedCandidateInstall(work, {
      afterInstallCommandForTest: async () => {
        await fs.appendFile(source, "\n// post-install drift\n");
      },
    }),
    /source blob|recorded source hashes|untracked source/,
  );
});

test("private pnpm store path stays under the owned private root", async (t) => {
  const work = await prepareOfficialWork(t);
  const manager = await privateEnvironment(work);
  const privateRoot = path.join(work, "private");

  assert.equal(
    manager.environment.pnpm_config_store_dir,
    path.join(privateRoot, "package-manager", "pnpm-store"),
  );
  assert.ok(manager.environment.pnpm_config_store_dir.startsWith(`${privateRoot}/`));
});
