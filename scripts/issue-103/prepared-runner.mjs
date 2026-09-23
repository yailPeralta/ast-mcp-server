import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { inspectPreparedSource, privateEnvironment, sha256 } from "./prepare-harness.mjs";
import { runBoundedCommand } from "../runtime-process.mjs";

function contained(root, file) {
  return file === root || file.startsWith(`${root}/`);
}

async function inspectPrivatePath(file, root) {
  const stat = await lstat(file);
  if (stat.isSymbolicLink()) {
    assert.ok(stat.uid === process.getuid(), `private environment path unsafe: ${file}`);
    assert.ok(
      [process.platform === "win32" ? "pnpm.cmd" : "pnpm", "pnpx"].includes(path.basename(file)) &&
        path.basename(path.dirname(file)) === "bin",
      `private environment path unsupported: ${file}`,
    );
    return;
  }
  assert.ok(
    stat.uid === process.getuid() && !(stat.mode & 0o022),
    `private environment path unsafe: ${file}`,
  );
  const canonical = await realpath(file);
  assert.ok(contained(root, canonical), `private environment path escaped: ${file}`);
  if (stat.isDirectory()) {
    for (const entry of await readdir(file)) await inspectPrivatePath(path.join(file, entry), root);
    return;
  }
  assert.ok(stat.isFile() && stat.nlink === 1, `private environment path unsupported: ${file}`);
}

async function inspectExistingPrivateRoot(work) {
  const privateRoot = path.join(work, "private");
  assert.equal(privateRoot, path.resolve(privateRoot), "private root must be absolute");
  assert.ok(contained(work, privateRoot), "private root must stay under work");
  await inspectPrivatePath(privateRoot, privateRoot);
  return privateRoot;
}

async function inspectManagedPath(name, file, privateRoot) {
  assert.equal(file, path.resolve(file), `${name} path must be absolute`);
  assert.ok(contained(privateRoot, file), `${name} path must stay under private root`);
  await inspectPrivatePath(file, privateRoot);
}

async function validatePrivateEnvironment(manager, privateRoot) {
  await inspectManagedPath("private bin", manager.binDirectory, privateRoot);
  for (const [name, file] of Object.entries(manager.environment)) {
    if (
      [
        "COREPACK_HOME",
        "PNPM_HOME",
        "HOME",
        "XDG_CACHE_HOME",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME",
        "npm_config_cache",
        "npm_config_userconfig",
        "TMPDIR",
        "TMP",
        "TEMP",
      ].includes(name)
    ) {
      await inspectManagedPath(name, file, privateRoot);
    }
  }
}

async function validateLauncher(manager, identity) {
  const launcher = path.join(
    manager.binDirectory,
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  );
  const launcherPath = await realpath(launcher);
  assert.equal(launcherPath, identity.launcher?.path, "pnpm launcher path changed");
  assert.equal(
    sha256(await readFile(launcherPath)),
    identity.launcher?.sha256,
    "pnpm launcher digest changed",
  );
  assert.equal(identity.pnpm?.version, "11.7.0", "pnpm version observation changed");
  return launcher;
}

export async function runPreparedPnpm(work, args, { cwd = work, timeout = 30_000 } = {}) {
  assert.ok(Array.isArray(args) && args.every((arg) => typeof arg === "string"), "pnpm args");
  assert.ok(Number.isFinite(timeout) && timeout > 0 && timeout <= 300_000, "bounded timeout");
  const admitted = await inspectPreparedSource(work);
  const privateRoot = await inspectExistingPrivateRoot(admitted.work);
  const manager = await privateEnvironment(admitted.work);
  await validatePrivateEnvironment(manager, privateRoot);
  const launcher = await validateLauncher(manager, admitted.identity);
  const cwdPath = path.resolve(cwd);
  assert.ok(contained(admitted.work, cwdPath), "cwd must stay under admitted work");
  return runBoundedCommand(launcher, args, {
    cwd: cwdPath,
    env: manager.environment,
    timeout,
    maxBuffer: 1024 * 1024,
  });
}
