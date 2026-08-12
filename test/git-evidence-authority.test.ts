import { execFileSync } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TRUSTED_GIT_BINARY,
  TRUSTED_SYSTEM_PATH,
  assertNoAmbientGitControls,
  assertTrustedGitVersion,
  createGitEnvironment,
  inspectTrustedGitFile,
} from "../scripts/git-evidence-authority.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Git evidence authority", () => {
  it("rejects every ambient Git control without echoing values", () => {
    expect(() =>
      assertNoAmbientGitControls({
        PATH: "/tmp/forged",
        GIT_DIR: "/private/repository",
        GIT_CONFIG_KEY_9: "core.fsmonitor",
      }),
    ).toThrow(/GIT_CONFIG_KEY_9, GIT_DIR/u);
    expect(() => assertNoAmbientGitControls({ PATH: "/tmp/forged" })).not.toThrow();
  });

  it("constructs only closed Git environments and allowlisted internal controls", () => {
    expect(createGitEnvironment()).toEqual({
      GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      GIT_CONFIG: "/dev/null",
      GIT_CONFIG_COUNT: "11",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_KEY_1: "core.fsmonitor",
      GIT_CONFIG_KEY_2: "core.untrackedCache",
      GIT_CONFIG_KEY_3: "core.attributesFile",
      GIT_CONFIG_KEY_4: "core.excludesFile",
      GIT_CONFIG_KEY_5: "core.autocrlf",
      GIT_CONFIG_KEY_6: "core.safecrlf",
      GIT_CONFIG_KEY_7: "core.symlinks",
      GIT_CONFIG_KEY_8: "core.filemode",
      GIT_CONFIG_KEY_9: "core.ignorecase",
      GIT_CONFIG_KEY_10: "core.bare",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_VALUE_0: "/dev/null",
      GIT_CONFIG_VALUE_1: "false",
      GIT_CONFIG_VALUE_2: "false",
      GIT_CONFIG_VALUE_3: "/dev/null",
      GIT_CONFIG_VALUE_4: "/dev/null",
      GIT_CONFIG_VALUE_5: "false",
      GIT_CONFIG_VALUE_6: "false",
      GIT_CONFIG_VALUE_7: "true",
      GIT_CONFIG_VALUE_8: "true",
      GIT_CONFIG_VALUE_9: "false",
      GIT_CONFIG_VALUE_10: "false",
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
      HOME: "/nonexistent",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: TRUSTED_SYSTEM_PATH,
      PAGER: "cat",
      XDG_CONFIG_HOME: "/nonexistent",
    });
    expect(() => createGitEnvironment({ repositoryControls: { GIT_DIR: "relative" } })).toThrow(
      /absolute/u,
    );
    expect(() =>
      createGitEnvironment({ repositoryControls: { GIT_OBJECT_DIRECTORY: "/tmp/objects" } }),
    ).toThrow(/unapproved/u);
    expect(() => createGitEnvironment({ repositoryControls: { GIT_OPTIONAL_LOCKS: "1" } })).toThrow(
      /exactly 0/u,
    );
    expect(createGitEnvironment({ workTree: "/tmp/repository" })).toMatchObject({
      GIT_CONFIG_COUNT: "12",
      GIT_CONFIG_KEY_11: "core.worktree",
      GIT_CONFIG_VALUE_11: "/tmp/repository",
      GIT_WORK_TREE: "/tmp/repository",
    });
    expect(() => createGitEnvironment({ workTree: "relative" })).toThrow(/absolute normalized/u);
    expect(() =>
      createGitEnvironment({
        repositoryControls: { GIT_WORK_TREE: "/tmp/forged" },
        workTree: "/tmp/repository",
      }),
    ).toThrow(/must match/u);
  });

  it("authenticates the fixed root-owned Git binary and version shape", async () => {
    const authority = await inspectTrustedGitFile();
    expect(authority).toMatchObject({
      binary: TRUSTED_GIT_BINARY,
      realpath: TRUSTED_GIT_BINARY,
    });
    expect(authority.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(assertTrustedGitVersion("git version 2.53.0\n")).toBe("git version 2.53.0");
    expect(() => assertTrustedGitVersion("forged git\n")).toThrow(/valid version/u);
  });

  it("ignores executable local Git configuration during status and index materialization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "git-evidence-authority-"));
    const forgedRoot = await mkdtemp(path.join(os.tmpdir(), "git-evidence-forged-worktree-"));
    temporaryDirectories.push(root, forgedRoot);
    const sentinel = path.join(root, "sentinel");
    const hostileCommand = path.join(root, "hostile-filter");
    const initializationEnvironment = createGitEnvironment();

    execFileSync(TRUSTED_GIT_BINARY, ["init", "--quiet", root], {
      env: initializationEnvironment,
      stdio: "pipe",
    });
    const closedEnvironment = createGitEnvironment({ workTree: root });
    await writeFile(
      hostileCommand,
      `#!/bin/sh\nprintf executed > ${JSON.stringify(sentinel)}\ncat\n`,
      "utf8",
    );
    await chmod(hostileCommand, 0o700);
    await writeFile(
      path.join(root, ".git", "config"),
      [
        "[core]",
        "\trepositoryformatversion = 0",
        "\tbare = false",
        `\tworktree = ${forgedRoot}`,
        `\tfsmonitor = ${hostileCommand}`,
        "[diff]",
        `\texternal = ${hostileCommand}`,
        '[filter "hostile"]',
        `\tclean = ${hostileCommand}`,
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(root, ".gitattributes"), "*.txt filter=hostile\n", "utf8");
    await writeFile(path.join(root, "tracked.txt"), "trusted bytes\n", "utf8");
    await writeFile(path.join(forgedRoot, "tracked.txt"), "forged bytes\n", "utf8");

    execFileSync(
      TRUSTED_GIT_BINARY,
      ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"],
      { env: closedEnvironment, stdio: "pipe" },
    );
    execFileSync(TRUSTED_GIT_BINARY, ["-C", root, "add", "-A", "--", ":/"], {
      env: closedEnvironment,
      stdio: "pipe",
    });
    execFileSync(TRUSTED_GIT_BINARY, ["-C", root, "diff", "--no-ext-diff", "--check"], {
      env: closedEnvironment,
      stdio: "pipe",
    });

    await expect(access(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
    const blob = execFileSync(TRUSTED_GIT_BINARY, ["-C", root, "show", ":tracked.txt"], {
      env: closedEnvironment,
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(blob).toBe(await readFile(path.join(root, "tracked.txt"), "utf8"));
  });
});
