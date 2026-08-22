import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyManagedBundle,
  ManagedBundleConflictError,
  planManagedBundle,
  type ManagedBundleSourceFile,
} from "../src/services/managed-bundle.js";

const temporaryDirectories: string[] = [];

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function source(path: string, content: string): ManagedBundleSourceFile {
  return { path, content: Buffer.from(content), sha256: sha256(content) };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "managed-bundle-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("managed bundle", () => {
  it("installs and updates a complete manifested bundle", async () => {
    const parent = await temporaryDirectory();
    const physicalRoot = path.join(parent, "physical");
    const root = path.join(parent, "skill");
    const current = [source("SKILL.md", "current\n"), source("references/runtime.md", "runtime\n")];
    const predecessors = [{ files: [{ path: "SKILL.md", sha256: sha256("old\n") }] }];
    await mkdir(physicalRoot, { recursive: true });
    await symlink(physicalRoot, root, process.platform === "win32" ? "junction" : "dir");
    await writeFile(path.join(root, "SKILL.md"), "old\n");

    const plan = await planManagedBundle({
      destinationRoot: root,
      current: { files: current },
      predecessors,
    });
    expect(plan.status).toBe("updated");
    await applyManagedBundle(plan);
    await expect(readFile(path.join(root, "SKILL.md"), "utf8")).resolves.toBe("current\n");
    await expect(readFile(path.join(root, "references/runtime.md"), "utf8")).resolves.toBe(
      "runtime\n",
    );

    const replay = await planManagedBundle({
      destinationRoot: root,
      current: { files: current },
      predecessors,
    });
    expect(replay.status).toBe("unchanged");
    await applyManagedBundle(replay);
  });

  it("rejects a nested-directory symlink escape without outside or partial writes", async () => {
    const parent = await temporaryDirectory();
    const root = path.join(parent, "skill");
    const outside = path.join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await symlink(
      outside,
      path.join(root, "references"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(path.join(root, "SKILL.md"), "old\n");
    await expect(
      planManagedBundle({
        destinationRoot: root,
        current: {
          files: [source("SKILL.md", "current\n"), source("references/runtime.md", "runtime\n")],
        },
        predecessors: [{ files: [{ path: "SKILL.md", sha256: sha256("old\n") }] }],
      }),
    ).rejects.toThrow(/outside.*bundle root/i);
    await expect(access(path.join(outside, "runtime.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(path.join(root, "SKILL.md"), "utf8")).resolves.toBe("old\n");
  });

  it("preserves conflicts and rolls back an explicit-force replacement", async () => {
    const root = await temporaryDirectory();
    const current = [source("SKILL.md", "current\n"), source("references/runtime.md", "runtime\n")];
    await mkdir(path.join(root, "references"), { recursive: true });
    await writeFile(path.join(root, "SKILL.md"), "user skill\n");
    await writeFile(path.join(root, "references/runtime.md"), "user reference\n");
    const options = { destinationRoot: root, current: { files: current }, predecessors: [] };

    await expect(planManagedBundle(options)).rejects.toBeInstanceOf(ManagedBundleConflictError);
    const forced = await planManagedBundle({ ...options, force: true });
    await expect(
      applyManagedBundle(forced, (file) => {
        if (file.path.endsWith("SKILL.md")) throw new Error("injected failure");
      }),
    ).rejects.toThrow(/injected failure/);
    await expect(readFile(path.join(root, "SKILL.md"), "utf8")).resolves.toBe("user skill\n");
    await expect(readFile(path.join(root, "references/runtime.md"), "utf8")).resolves.toBe(
      "user reference\n",
    );

    await applyManagedBundle(await planManagedBundle({ ...options, force: true }));
    await expect(readFile(path.join(root, "SKILL.md"), "utf8")).resolves.toBe("current\n");
  });

  it.each(["../escape.md", "/absolute.md", "references\\escape.md"])(
    "rejects unsafe path %s before writes",
    async (unsafePath) => {
      const root = await temporaryDirectory();
      await expect(
        planManagedBundle({
          destinationRoot: root,
          current: { files: [source(unsafePath, "unsafe\n")] },
          predecessors: [],
        }),
      ).rejects.toThrow(/unsafe path/i);
    },
  );

  it("rejects duplicate canonical destinations before writes", async () => {
    const root = await temporaryDirectory();
    await expect(
      planManagedBundle({
        destinationRoot: root,
        current: { files: [source("SKILL.md", "one\n"), source("SKILL.md", "two\n")] },
        predecessors: [],
      }),
    ).rejects.toThrow(/duplicate path/i);
  });
});
