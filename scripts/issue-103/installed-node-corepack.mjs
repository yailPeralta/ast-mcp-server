import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export async function inspectInstalledNodeCorepack() {
  const node = process.execPath;
  const corepack = path.join(
    path.dirname(path.dirname(node)),
    "lib/node_modules/corepack/dist/pnpm.js",
  );
  const hash = async (file) => {
    for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
      const stat = await fs.lstat(directory);
      assert.ok(
        stat.isDirectory() && [0, process.getuid()].includes(stat.uid) && !(stat.mode & 0o022),
        `unsafe installed ancestry: ${directory}`,
      );
      if (directory === path.dirname(directory)) break;
    }
    const stat = await fs.lstat(file);
    assert.ok(
      stat.isFile() &&
        stat.nlink === 1 &&
        [0, process.getuid()].includes(stat.uid) &&
        !(stat.mode & 0o022),
      `unsafe installed file: ${file}`,
    );
    await fs.access(file, fs.constants.X_OK);
    return createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  };
  const nodeHash = await hash(node);
  assert.equal(path.basename(path.dirname(node)), "bin", "standard bin directory required");
  assert.equal(await fs.realpath(node), node, "canonical current executable required");
  let selected;
  try {
    selected = await fs.realpath(path.join(path.dirname(node), "node"));
  } catch (cause) {
    throw new Error("Node selection lookup failed", { cause });
  }
  assert.equal(selected, node, "Node selection must resolve to current executable");
  return {
    node: { path: node, version: process.version, sha256: nodeHash },
    corepack: { path: corepack, sha256: await hash(corepack) },
  };
}
