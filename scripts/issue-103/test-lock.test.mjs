import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withOfficialPreparationLock } from "./test-lock.mjs";

async function temporaryLockPath(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ast103-lock-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, "prepare.lock");
}

function deterministicTiming(start = 0) {
  let time = start;
  return {
    now: () => time,
    sleep: async (delay) => {
      time += delay;
    },
    advance: (delay) => {
      time += delay;
    },
  };
}

test("existing lock without owner token is preserved until bounded acquisition timeout", async (t) => {
  const lockPath = await temporaryLockPath(t);
  await fs.mkdir(lockPath, { recursive: true });
  await fs.writeFile(path.join(lockPath, "foreign"), "preserve");
  const timing = deterministicTiming();

  await assert.rejects(
    withOfficialPreparationLock(
      async () => {
        throw new Error("action must not run");
      },
      {
        lockPath,
        acquireTimeoutMs: 3,
        retryDelayMs: 1,
        staleAfterMs: 1,
        now: timing.now,
        sleep: timing.sleep,
      },
    ),
    /Timed out acquiring official Harness preparation lock/,
  );
  assert.equal(await fs.readFile(path.join(lockPath, "foreign"), "utf8"), "preserve");
});

test("stale recognized owner token is removed before running action", async (t) => {
  const lockPath = await temporaryLockPath(t);
  await fs.mkdir(lockPath, { recursive: true });
  const timing = deterministicTiming(Date.now());
  await fs.writeFile(
    path.join(lockPath, "owner.json"),
    JSON.stringify({
      helper: "ast103-official-preparation-lock",
      version: 1,
      pid: 123,
      createdAt: timing.now() - 10_000,
      nonce: "old",
    }),
  );
  const oldDate = new Date(timing.now() - 10_000);
  await fs.utimes(path.join(lockPath, "owner.json"), oldDate, oldDate);
  let ran = false;

  await withOfficialPreparationLock(
    async () => {
      ran = true;
      assert.match(await fs.readFile(path.join(lockPath, "owner.json"), "utf8"), /"nonce":"new"/);
    },
    {
      lockPath,
      acquireTimeoutMs: 10,
      staleAfterMs: 5,
      now: timing.now,
      sleep: timing.sleep,
      createNonce: () => "new",
    },
  );

  assert.equal(ran, true);
  await assert.rejects(fs.lstat(lockPath), { code: "ENOENT" });
});

test("release preserves a lock whose owner token changed", async (t) => {
  const lockPath = await temporaryLockPath(t);

  await withOfficialPreparationLock(
    async () => {
      await fs.writeFile(
        path.join(lockPath, "owner.json"),
        JSON.stringify({
          helper: "ast103-official-preparation-lock",
          version: 1,
          pid: 456,
          createdAt: 1,
          nonce: "other",
        }),
      );
    },
    { lockPath, createNonce: () => "owned" },
  );

  assert.match(await fs.readFile(path.join(lockPath, "owner.json"), "utf8"), /"other"/);
});

test("action failure still releases the owned lock", async (t) => {
  const lockPath = await temporaryLockPath(t);

  await assert.rejects(
    withOfficialPreparationLock(
      async () => {
        throw new Error("boom");
      },
      { lockPath, createNonce: () => "owned" },
    ),
    /boom/,
  );
  await assert.rejects(fs.lstat(lockPath), { code: "ENOENT" });
});
