import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertSafeOperationFile } from "../src/services/safe-file.js";

describe("assertSafeOperationFile", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "safe-file-root-")));
    outside = await realpath(await mkdtemp(path.join(os.tmpdir(), "safe-file-outside-")));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "export {};\n");
  });

  afterEach(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });

  function check(relative: string): void {
    assertSafeOperationFile(root, path.join(root, relative), relative);
  }

  it("accepts a regular, single-link, owned file inside the root", () => {
    expect(() => check("src/a.ts")).not.toThrow();
  });

  it("rejects symlink, multi-link, foreign owner and out-of-root files", async () => {
    await writeFile(path.join(outside, "target.ts"), "export {};\n");
    await symlink(path.join(outside, "target.ts"), path.join(root, "src", "link.ts"));
    expect(() => check("src/link.ts")).toThrow(
      "Operation target must not be a symbolic link: src/link.ts",
    );

    await link(path.join(root, "src", "a.ts"), path.join(root, "src", "b.ts"));
    expect(() => check("src/b.ts")).toThrow(
      "Operation target must have exactly one hard link: src/b.ts",
    );

    await mkdir(path.join(root, "dir"));
    expect(() => check("dir")).toThrow("Operation target is not a regular file: dir");

    await symlink(outside, path.join(root, "linked-dir"));
    await writeFile(path.join(outside, "inner.ts"), "export {};\n");
    expect(() => check("linked-dir/inner.ts")).toThrow(
      "Operation target traverses a symbolic link: linked-dir/inner.ts",
    );

    if (process.getuid !== undefined) {
      const uid = process.getuid();
      await writeFile(path.join(root, "src", "owned.ts"), "export {};\n");
      const getuid = vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
      expect(() => check("src/owned.ts")).toThrow(
        "Operation target is not owned by the current user: src/owned.ts",
      );
      getuid.mockRestore();
    }

    const outsideFile = path.join(outside, "plain.ts");
    await writeFile(outsideFile, "export {};\n");
    expect(() => assertSafeOperationFile(root, outsideFile, "plain.ts")).toThrow(
      "Operation target escapes the project root: plain.ts",
    );
  });
});
