import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const TRUSTED_GIT_BINARY = "/usr/bin/git";
export const TRUSTED_SYSTEM_PATH = "/usr/bin:/bin";
const EMPTY_GIT_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const trustedGitCommandConfiguration = Object.freeze([
  ["core.hooksPath", "/dev/null"],
  ["core.fsmonitor", "false"],
  ["core.untrackedCache", "false"],
  ["core.attributesFile", "/dev/null"],
  ["core.excludesFile", "/dev/null"],
  ["core.autocrlf", "false"],
  ["core.safecrlf", "false"],
  ["core.symlinks", "true"],
  ["core.filemode", "true"],
  ["core.ignorecase", "false"],
  ["core.bare", "false"],
]);

const trustedGitIdentityKeys = Object.freeze(
  new Set([
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_AUTHOR_DATE",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_COMMITTER_DATE",
  ]),
);

const trustedGitRepositoryControlKeys = Object.freeze(
  new Set(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OPTIONAL_LOCKS"]),
);

function fail(message) {
  throw new Error(message);
}

export function assertNoAmbientGitControls(ambientEnvironment = process.env) {
  const controls = Object.keys(ambientEnvironment)
    .filter((key) => key.startsWith("GIT_"))
    .sort();
  if (controls.length > 0) {
    fail(`ambient Git controls must be unset: ${controls.join(", ")}.`);
  }
}

function validateIdentity(identity) {
  for (const [key, value] of Object.entries(identity)) {
    if (!trustedGitIdentityKeys.has(key) || typeof value !== "string" || value === "") {
      fail(`unapproved Git identity control: ${key}.`);
    }
  }
}

function validateRepositoryControls(repositoryControls) {
  for (const [key, value] of Object.entries(repositoryControls)) {
    if (!trustedGitRepositoryControlKeys.has(key) || typeof value !== "string" || value === "") {
      fail(`unapproved Git repository control: ${key}.`);
    }
    if (key === "GIT_OPTIONAL_LOCKS") {
      if (value !== "0") fail("GIT_OPTIONAL_LOCKS must be exactly 0.");
    } else if (!path.isAbsolute(value)) {
      fail(`${key} must be an absolute path.`);
    }
  }
}

/**
 * @param {{
 *   identity?: Readonly<Record<string, string>>;
 *   repositoryControls?: Readonly<Record<string, string>>;
 *   workTree?: string;
 * }} [options]
 */
export function createGitEnvironment({ identity = {}, repositoryControls = {}, workTree } = {}) {
  validateIdentity(identity);
  validateRepositoryControls(repositoryControls);
  if (
    workTree !== undefined &&
    (!path.isAbsolute(workTree) || path.normalize(workTree) !== workTree)
  ) {
    fail("Git work tree must be an absolute normalized path.");
  }
  if (
    workTree !== undefined &&
    repositoryControls.GIT_WORK_TREE !== undefined &&
    repositoryControls.GIT_WORK_TREE !== workTree
  ) {
    fail("GIT_WORK_TREE must match the validated Git work tree.");
  }
  const configuration =
    workTree === undefined
      ? trustedGitCommandConfiguration
      : [...trustedGitCommandConfiguration, ["core.worktree", workTree]];
  const commandConfiguration = Object.fromEntries(
    configuration.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ]),
  );
  return Object.freeze({
    GIT_ATTR_SOURCE: EMPTY_GIT_TREE,
    GIT_CONFIG: "/dev/null",
    GIT_CONFIG_COUNT: String(configuration.length),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    ...commandConfiguration,
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    HOME: "/nonexistent",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: TRUSTED_SYSTEM_PATH,
    PAGER: "cat",
    XDG_CONFIG_HOME: "/nonexistent",
    ...(workTree === undefined ? {} : { GIT_WORK_TREE: workTree }),
    ...repositoryControls,
    ...identity,
  });
}

export function assertTrustedGitVersion(versionOutput) {
  const version = versionOutput.trim();
  if (!/^git version \d+\.\d+(?:\.\d+)?(?:\s|$)/u.test(version)) {
    fail("trusted Git binary could not report a valid version.");
  }
  return version;
}

export async function inspectTrustedGitFile() {
  const resolved = await realpath(TRUSTED_GIT_BINARY).catch(() => undefined);
  if (resolved !== TRUSTED_GIT_BINARY) {
    fail(`trusted Git binary must resolve exactly to ${TRUSTED_GIT_BINARY}.`);
  }
  const stats = await lstat(TRUSTED_GIT_BINARY).catch(() => undefined);
  if (stats === undefined || !stats.isFile()) fail("trusted Git binary must be a regular file.");
  if (stats.uid !== 0 || (stats.mode & 0o022) !== 0) {
    fail("trusted Git binary must be root-owned and not group/world-writable.");
  }
  await access(TRUSTED_GIT_BINARY, fsConstants.X_OK).catch(() =>
    fail("trusted Git binary is not executable."),
  );
  return Object.freeze({
    binary: TRUSTED_GIT_BINARY,
    realpath: resolved,
    sha256: createHash("sha256")
      .update(await readFile(TRUSTED_GIT_BINARY))
      .digest("hex"),
  });
}
