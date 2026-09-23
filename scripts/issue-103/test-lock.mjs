import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const staleAfterMs = 10 * 60 * 1000;
const retryDelayMs = 250;

/** Serialize official Harness source preparation across node:test worker processes. */
export async function withOfficialPreparationLock(action) {
  const lock = path.join(os.tmpdir(), "ast103-official-prepare.lock");
  let acquired = false;
  while (!acquired) {
    try {
      await fs.mkdir(lock, { mode: 0o700 });
      acquired = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const stat = await fs.stat(lock).catch((statError) => {
        if (statError?.code === "ENOENT") return undefined;
        throw statError;
      });
      if (stat && Date.now() - stat.mtimeMs > staleAfterMs) {
        await fs.rm(lock, { recursive: true, force: true });
        continue;
      }
      await sleep(retryDelayMs);
    }
  }
  try {
    return await action();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}
