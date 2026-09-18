import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const digest = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");

// Selected original paths never admit links; absent boundary means exhaustive owned tree.
export async function snapshot(file, { boundary, opened } = {}) {
  const unavailable = (error) => {
    if (!boundary || !["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) throw error;
    return { unobserved: error.code };
  };
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    return unavailable(error);
  }
  const metadata = ["ino", "size", "uid", "nlink", "mode", "mtimeMs", "ctimeMs"].map(
    (key) => stat[key],
  );
  const contents = async () => {
    if (stat.isSymbolicLink()) return fs.readlink(file);
    if (stat.isFile()) {
      let bytes;
      if (file === opened?.file) {
        const read = await opened.handle.read({ buffer: Buffer.alloc(stat.size), position: 0 });
        assert.equal(read.bytesRead, stat.size);
        bytes = read.buffer;
      } else bytes = await fs.readFile(file);
      return createHash("sha256").update(bytes).digest("hex");
    }
    if (!stat.isDirectory()) return null;
    const entries = [];
    for (const name of (await fs.readdir(file)).sort()) {
      const child = path.join(file, name);
      const selected =
        !boundary || boundary.some((target) => target === child || target.startsWith(`${child}/`));
      entries.push([name, selected ? await snapshot(child, { boundary, opened }) : null]);
    }
    return entries;
  };
  try {
    return [metadata, await contents()];
  } catch (error) {
    return [metadata, unavailable(error)];
  }
}
