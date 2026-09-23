import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as defaultSleep } from "node:timers/promises";

const defaultStaleAfterMs = 10 * 60 * 1000;
const defaultRetryDelayMs = 250;
const defaultAcquireTimeoutMs = 5 * 60 * 1000;
const ownerFileName = "owner.json";
const ownerHelper = "ast103-official-preparation-lock";
const ownerVersion = 1;

function positiveMilliseconds(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative millisecond value`);
  }
  return value;
}

function createToken(now, createNonce) {
  return {
    helper: ownerHelper,
    version: ownerVersion,
    pid: process.pid,
    createdAt: now(),
    nonce: createNonce(),
  };
}

function isRecognizedToken(token) {
  return (
    token &&
    typeof token === "object" &&
    token.helper === ownerHelper &&
    token.version === ownerVersion &&
    Number.isSafeInteger(token.pid) &&
    token.pid > 0 &&
    Number.isFinite(token.createdAt) &&
    token.createdAt >= 0 &&
    typeof token.nonce === "string" &&
    token.nonce.length > 0 &&
    token.nonce.length <= 128
  );
}

async function readOwner(lock) {
  const file = path.join(lock, ownerFileName);
  let text;
  let stat;
  try {
    [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return undefined;
    throw error;
  }
  let token;
  try {
    token = JSON.parse(text);
  } catch {
    return { recognized: false, text, stat };
  }
  return { recognized: isRecognizedToken(token), token, text, stat };
}

function ownerIsStale(owner, now, staleAfterMs) {
  if (!owner?.recognized) return false;
  const ageMs = now() - owner.token.createdAt;
  const fileAgeMs = now() - owner.stat.mtimeMs;
  return ageMs > staleAfterMs && fileAgeMs > staleAfterMs;
}

async function removeRecognizedStaleLock(lock, expectedOwnerText, now, staleAfterMs) {
  const owner = await readOwner(lock);
  if (
    !owner?.recognized ||
    owner.text !== expectedOwnerText ||
    !ownerIsStale(owner, now, staleAfterMs)
  ) {
    return false;
  }
  await fs.rm(lock, { recursive: true, force: true });
  return true;
}

async function releaseOwnedLock(lock, ownerText) {
  const owner = await readOwner(lock);
  if (owner?.recognized && owner.text === ownerText) {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

/** Serialize official Harness source preparation across node:test worker processes. */
export async function withOfficialPreparationLock(action, options = {}) {
  const lock = options.lockPath ?? path.join(os.tmpdir(), "ast103-official-prepare.lock");
  const staleAfterMs = positiveMilliseconds(
    options.staleAfterMs,
    defaultStaleAfterMs,
    "staleAfterMs",
  );
  const retryDelayMs = positiveMilliseconds(
    options.retryDelayMs,
    defaultRetryDelayMs,
    "retryDelayMs",
  );
  const acquireTimeoutMs = positiveMilliseconds(
    options.acquireTimeoutMs,
    defaultAcquireTimeoutMs,
    "acquireTimeoutMs",
  );
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const createNonce = options.createNonce ?? crypto.randomUUID;
  const deadline = now() + acquireTimeoutMs;
  let ownerText;

  while (!ownerText) {
    try {
      await fs.mkdir(lock, { mode: 0o700 });
      ownerText = JSON.stringify(createToken(now, createNonce));
      await fs.writeFile(path.join(lock, ownerFileName), ownerText, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (ownerText) {
        await releaseOwnedLock(lock, ownerText);
        throw error;
      }
      if (error?.code !== "EEXIST") throw error;
      const owner = await readOwner(lock);
      if (ownerIsStale(owner, now, staleAfterMs)) {
        if (await removeRecognizedStaleLock(lock, owner.text, now, staleAfterMs)) continue;
      }
      if (now() >= deadline) {
        throw new Error(
          `Timed out acquiring official Harness preparation lock after ${acquireTimeoutMs}ms: ${lock}`,
          { cause: error },
        );
      }
      await sleep(Math.min(retryDelayMs, Math.max(0, deadline - now())));
    }
  }

  try {
    return await action();
  } finally {
    await releaseOwnedLock(lock, ownerText);
  }
}
