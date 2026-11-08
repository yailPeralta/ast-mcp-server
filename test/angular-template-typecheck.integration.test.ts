import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkTemplateTypes } from "../src/services/angular-template-typecheck.js";
import { generateMatrixProject, writeMatrixProject } from "./helpers/angular-matrix-fixture.js";

// Runs against the built entry, so it belongs to the post-build phase of `yarn test`.
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "angular-template-typecheck-entry.js");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const name of (await readdir(root, { recursive: true })).sort()) {
    hash.update(name);
    const full = path.join(root, name);
    if ((await stat(full)).isFile()) hash.update(await readFile(full));
  }
  return hash.digest("hex");
}

/** A seeded rename on the given Angular major: the plan input plus the root to hash. */
async function seededRename(major: number) {
  const tmp = path.join(here, "angular-matrix", `v${major}`, ".tmp");
  await mkdir(tmp, { recursive: true });
  const root = await mkdtemp(path.join(tmp, "integration-"));
  roots.push(root);
  const project = generateMatrixProject({
    components: 3,
    seedBrokenConsumer: true,
    seedPreexistingError: true,
  });
  await writeMatrixProject(root, project);
  const overlay = project.rename.overlay.map((file) => ({
    absolutePath: path.join(root, ...file.path.split("/")),
    text: file.text,
  }));
  const changes = await Promise.all(
    project.rename.overlay.map(async (file, index) => ({
      file: file.path.split("/").join(path.sep),
      beforeText: await readFile(overlay[index].absolutePath, "utf8"),
      afterText: file.text,
    })),
  );
  return {
    root,
    input: {
      tsConfigFilePath: path.join(root, "tsconfig.json"),
      templates: overlay.map((file) => file.absolutePath).filter((file) => file.endsWith(".html")),
      overlay,
      changes,
    },
  };
}

describe("template type check against the built child", () => {
  it("reports the seeded break as added and keeps the pre-existing error out of the delta", async () => {
    const { root, input } = await seededRename(21);
    const digest = await treeDigest(root);
    const result = await checkTemplateTypes(input, undefined, { entry });

    expect(result.status).toBe("completed");
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({ file: path.join("src", "host-0-1.component.html") });
    expect(result.added[0].message).toContain("headng");
    expect(result.addedErrors).toEqual(result.added);
    expect(result.removed).toEqual([]);
    expect(await treeDigest(root)).toBe(digest);
  }, 60_000);

  it("gives each project the compiler-cli of its own major", async () => {
    const requests: { cliEntry: string }[] = [];
    const spawn = (script: string, args: string[], options: Parameters<typeof fork>[2]) => {
      const child = fork(script, args, options);
      const send = child.send.bind(child) as ChildProcess["send"];
      child.send = ((message: { cliEntry: string }, callback?: (error: Error | null) => void) => {
        requests.push(message);
        return send(message, callback);
      }) as ChildProcess["send"];
      return child;
    };
    for (const major of [18, 22]) {
      const { input } = await seededRename(major);
      const result = await checkTemplateTypes(input, undefined, { entry, spawn });
      expect(result.status).toBe("completed");
      expect(result.addedErrors).toHaveLength(1);
    }
    expect(requests.map((request) => request.cliEntry)).toEqual([
      expect.stringContaining(`${path.sep}v18${path.sep}node_modules`),
      expect.stringContaining(`${path.sep}v22${path.sep}node_modules`),
    ]);
  }, 120_000);

  it("exits when the parent disconnects", async () => {
    const child = fork(entry, [], { env: {}, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    child.disconnect();
    // The contract is that the child never lingers. A disconnect that lands before the entry
    // registers its handler leaves nothing pending, so Node exits with 0 instead of 1.
    expect([0, 1]).toContain(await exited);
  });
});
