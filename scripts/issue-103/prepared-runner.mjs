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
        "pnpm_config_store_dir",
        "TMPDIR",
        "TMP",
        "TEMP",
      ].includes(name)
    ) {
      await inspectManagedPath(name, file, privateRoot);
    }
  }
}

async function validateRecordedNode(identity) {
  const node = identity.node;
  assert.equal(typeof node?.path, "string", "Node path");
  assert.equal(node.path, path.resolve(node.path), "Node path must be absolute");
  assert.equal(await realpath(node.path), node.path, "Node path changed");
  const stat = await lstat(node.path);
  assert.ok(
    stat.isFile() && stat.uid === process.getuid() && !(stat.mode & 0o022),
    "Node path unsafe",
  );
  assert.equal(sha256(await readFile(node.path)), node.sha256, "Node digest changed");
  assert.equal(node.version, "v24.16.0", "Node version observation changed");
  const observed = await runBoundedCommand(node.path, ["--version"], {
    cwd: path.dirname(node.path),
    env: { PATH: "/usr/bin:/bin", NODE_OPTIONS: "" },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(observed.stdout.trim(), node.version, "Node version changed");
  assert.equal(observed.stderr, "", "Node version stderr");
  return node.path;
}

function bindRecordedNodeEnvironment(manager, nodePath) {
  const nodeDirectory = path.dirname(nodePath);
  const rest = (manager.environment.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => entry && entry !== nodeDirectory && entry !== manager.binDirectory);
  return {
    ...manager.environment,
    PATH: [nodeDirectory, manager.binDirectory, ...rest].join(path.delimiter),
  };
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

async function resolveCwd(root, cwd, containmentMessage) {
  const requested = path.resolve(root, cwd);
  const canonical = await realpath(requested);
  assert.ok(contained(root, canonical), containmentMessage);
  assert.ok((await lstat(canonical)).isDirectory(), "cwd must be directory");
  return canonical;
}

async function runAdmittedPnpm(admitted, args, cwdPath, timeout) {
  assert.ok(Array.isArray(args) && args.every((arg) => typeof arg === "string"), "pnpm args");
  assert.ok(Number.isFinite(timeout) && timeout > 0 && timeout <= 300_000, "bounded timeout");
  const nodePath = await validateRecordedNode(admitted.identity);
  const privateRoot = await inspectExistingPrivateRoot(admitted.work);
  const manager = await privateEnvironment(admitted.work);
  await validatePrivateEnvironment(manager, privateRoot);
  const launcher = await validateLauncher(manager, admitted.identity);
  return runBoundedCommand(launcher, args, {
    cwd: cwdPath,
    env: bindRecordedNodeEnvironment(manager, nodePath),
    timeout,
    maxBuffer: 1024 * 1024,
  });
}

export async function runPreparedPnpm(work, args, { cwd = work, timeout = 30_000 } = {}) {
  const admitted = await inspectPreparedSource(work);
  const cwdPath = await resolveCwd(admitted.work, cwd, "cwd must stay under admitted work");
  return runAdmittedPnpm(admitted, args, cwdPath, timeout);
}

export async function runPreparedVariantPnpm(
  work,
  variant,
  args,
  { cwd = ".", timeout = 30_000 } = {},
) {
  assert.ok(["baseline", "candidate"].includes(variant), "prepared source variant");
  const admitted = await inspectPreparedSource(work);
  const variantRoot = path.join(admitted.work, variant);
  const cwdPath = await resolveCwd(variantRoot, cwd, "cwd must stay under prepared source variant");
  return runAdmittedPnpm(admitted, args, cwdPath, timeout);
}

export async function runPreparedCandidateInstall(
  work,
  { timeout = 300_000, afterInstallCommandForTest } = {},
) {
  await inspectPreparedSource(work);
  const result = await runPreparedVariantPnpm(work, "candidate", ["install", "--frozen-lockfile"], {
    cwd: ".",
    timeout,
  });
  if (afterInstallCommandForTest !== undefined) {
    assert.equal(typeof afterInstallCommandForTest, "function", "post-install test hook");
    await afterInstallCommandForTest();
  }
  await inspectPreparedSource(work);
  return result;
}
