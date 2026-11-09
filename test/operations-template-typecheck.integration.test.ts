import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as typecheck from "../src/services/angular-template-typecheck.js";
import {
  clearOperationsForTests,
  createPlan,
  type AuxiliaryEdit,
  type PreparedOperation,
} from "../src/services/operations.js";
import {
  clearProjectSessions,
  findDeclarationByName,
  getSourceFileOrThrow,
} from "../src/services/project.js";
import { createRequestContext } from "../src/services/request-context.js";
import { hashBytes } from "../src/services/workspace.js";
import { compilerMajorSupportedByNode } from "./helpers/angular-fixture.js";
import {
  generateMatrixProject,
  writeMatrixProject,
  type MatrixProject,
  type MatrixProjectOptions,
} from "./helpers/angular-matrix-fixture.js";

// Runs against the built child entry, so it belongs to the post-build phase of `yarn test`.
const here = path.dirname(fileURLToPath(import.meta.url));
const builtEntry = path.join(here, "..", "dist", "angular-template-typecheck-entry.js");
const hangingChild = path.join(here, "helpers", "fake-typecheck-child.mjs");
const MAJORS = [18, 19, 20, 21, 22] as const;
const PRIMARY = 21;
const originalCheck = typecheck.checkTemplateTypes;

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  clearOperationsForTests();
  clearProjectSessions();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Runs the real checker through the built entry instead of the unbuilt `src/` location. */
function useBuiltChild(spawn?: typecheck.TemplateTypeCheckDeps["spawn"]) {
  return vi
    .spyOn(typecheck, "checkTemplateTypes")
    .mockImplementation((input, ctx, deps) =>
      originalCheck(input, ctx, { entry: builtEntry, spawn, ...deps }),
    );
}

async function project(
  major: number,
  options: MatrixProjectOptions,
  adjust: (matrix: MatrixProject) => void = () => undefined,
): Promise<{ root: string; matrix: MatrixProject }> {
  const tmp = path.join(here, "angular-matrix", `v${major}`, ".tmp");
  await mkdir(tmp, { recursive: true });
  const root = await mkdtemp(path.join(tmp, "operations-"));
  roots.push(root);
  const matrix = generateMatrixProject(options);
  adjust(matrix);
  await writeMatrixProject(root, matrix);
  return { root, matrix };
}

/** Renames the widget input in TypeScript and rewrites the templates the generator lists. */
async function templateRename(
  root: string,
  matrix: MatrixProject,
  options: { signal?: AbortSignal; blockOnTemplateErrors?: boolean } = {},
): Promise<PreparedOperation> {
  const edits: AuxiliaryEdit[] = [];
  for (const entry of matrix.rename.overlay.filter((file) => file.path.endsWith(".html"))) {
    const absolutePath = path.join(root, ...entry.path.split("/"));
    const bytes = await readFile(absolutePath);
    edits.push({
      absolutePath,
      start: 0,
      end: bytes.toString("utf8").length,
      newText: entry.text,
      expectedHash: hashBytes(bytes),
    });
  }
  return createPlan(
    root,
    "rename_symbol",
    false,
    async (context) => {
      const node = findDeclarationByName(
        getSourceFileOrThrow(context.project, "src/widget-0.component.ts"),
        "Widget0Component.label",
      );
      (node as unknown as { rename(name: string): void }).rename("heading");
      return { referenceCount: 1 + edits.length, auxiliaryEdits: edits };
    },
    createRequestContext(options.signal),
    { blockOnTemplateErrors: options.blockOnTemplateErrors },
  );
}

async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const name of (await readdir(root, { recursive: true })).sort()) {
    hash.update(name);
    const full = path.join(root, name);
    if ((await stat(full)).isFile()) hash.update(await readFile(full));
  }
  return hash.digest("hex");
}

/** Path, size and mtime of every Angular package file: any write to node_modules changes it. */
async function angularPackagesDigest(major: number): Promise<string> {
  const base = path.join(here, "angular-matrix", `v${major}`, "node_modules", "@angular");
  const hash = createHash("sha256");
  for (const name of (await readdir(base, { recursive: true })).sort()) {
    const info = await stat(path.join(base, name));
    hash.update(`${name}:${info.size}:${info.mtimeMs}`);
  }
  return hash.digest("hex");
}

describe.each(MAJORS)("rename plans on Angular %i", (major) => {
  const supported = compilerMajorSupportedByNode(major);

  it.skipIf(!supported)(
    "reports a seeded consumer break as added and keeps the pre-existing error out of the delta",
    async () => {
      useBuiltChild();
      const { root, matrix } = await project(major, {
        components: 3,
        seedBrokenConsumer: true,
        seedPreexistingError: true,
      });
      const digest = await treeDigest(root);

      const prepared = await templateRename(root, matrix);

      expect(prepared.template_diagnostics?.status).toBe("completed");
      const delta = prepared.template_diagnostics!;
      expect(delta.added).toHaveLength(1);
      expect(delta.added[0]).toMatchObject({ file: path.join("src", "host-0-1.component.html") });
      expect(delta.added[0]!.message).toContain("headng");
      expect(delta.addedErrors).toEqual(delta.added);
      expect(delta.removed).toEqual([]);
      expect(prepared.blocked).toBe(false);
      expect(await treeDigest(root)).toBe(digest);
    },
    120_000,
  );

  it.skipIf(!supported)(
    "reports an empty delta for a clean rename even with a shifted pre-existing error",
    async () => {
      useBuiltChild();
      const { root, matrix } = await project(major, {
        components: 3,
        seedPreexistingError: true,
      });

      const prepared = await templateRename(root, matrix);

      expect(prepared.template_diagnostics).toEqual({
        status: "completed",
        added: [],
        removed: [],
        addedErrors: [],
      });
    },
    120_000,
  );
});

describe.skipIf(!compilerMajorSupportedByNode(PRIMARY))("delta semantics", () => {
  it("lists a removed error and a new one when the error count stays the same", async () => {
    useBuiltChild();
    // host-0-1 already binds the renamed input by its future name, so the rename fixes that error
    // while the misspelled edit of its other binding introduces a different one.
    const second = '  <app-widget-0 [heading]="title"></app-widget-0>\n</section>';
    const { root, matrix } = await project(
      PRIMARY,
      { components: 1, seedBrokenConsumer: true },
      ({ files, rename }) => {
        const host = "src/host-0-1.component.html";
        files[host] = files[host]!.replace("</section>", second);
        for (const entry of rename.overlay) {
          if (entry.path === host) entry.text = entry.text.replace("</section>", second);
        }
      },
    );

    const prepared = await templateRename(root, matrix);
    const delta = prepared.template_diagnostics!;

    expect(delta.status).toBe("completed");
    expect(delta.addedErrors).toHaveLength(1);
    expect(delta.addedErrors[0]!.message).toContain("'headng'");
    expect(delta.removed).toHaveLength(1);
    expect(delta.removed[0]!.message).toContain("'heading'");
    expect(delta.removed[0]).toMatchObject({ file: path.join("src", "host-0-1.component.html") });
  }, 120_000);

  it("blocks the plan on a completed worsened delta only when asked to", async () => {
    useBuiltChild();
    const { root, matrix } = await project(PRIMARY, { components: 1, seedBrokenConsumer: true });

    const blocking = await templateRename(root, matrix, { blockOnTemplateErrors: true });

    expect(blocking.blocked).toBe(true);
    expect(blocking.block_reason).toMatch(/^1 new template error\(s\) would be introduced\./u);
  }, 120_000);

  it("reports a new warning in added but not in addedErrors", async () => {
    useBuiltChild();
    // The nullish coalescing on a non-nullable string is an extended diagnostic (a warning).
    const { root, matrix } = await project(PRIMARY, { components: 1 }, ({ rename }) => {
      for (const entry of rename.overlay) {
        if (entry.path === "src/host-0-1.component.html") {
          entry.text = entry.text.replace("</section>", '  {{ title ?? "none" }}\n</section>');
        }
      }
    });

    const prepared = await templateRename(root, matrix);
    const delta = prepared.template_diagnostics!;

    expect(delta.status).toBe("completed");
    expect(delta.added).toHaveLength(1);
    expect(delta.added[0]).toMatchObject({ category: "Warning" });
    expect(delta.addedErrors).toEqual([]);
    expect(prepared.blocked).toBe(false);
  }, 120_000);

  it("treats a pre-existing error that touches an edited binding as added", async () => {
    useBuiltChild();
    // The binding assigns a number to the string input, before and after the rename.
    const { root, matrix } = await project(PRIMARY, { components: 1 }, ({ files }) => {
      files["src/host-0-1.component.ts"] = files["src/host-0-1.component.ts"]!.replace(
        'title = "title-0-1";',
        "title = 42;",
      );
    });

    const prepared = await templateRename(root, matrix);
    const delta = prepared.template_diagnostics!;

    expect(delta.status).toBe("completed");
    expect(delta.addedErrors.map((error) => error.file)).toEqual([
      path.join("src", "host-0-1.component.html"),
    ]);
    expect(delta.removed.map((error) => error.file)).toEqual([
      path.join("src", "host-0-1.component.html"),
    ]);
  }, 120_000);
});

describe.skipIf(!compilerMajorSupportedByNode(PRIMARY))("child lifecycle", () => {
  it("returns deadline within the budget plus one second and leaves no live child", async () => {
    const pids: number[] = [];
    const spawn: typecheck.TemplateTypeCheckDeps["spawn"] = (_script, _args, options) => {
      const child = fork(hangingChild, ["hang"], options);
      pids.push(child.pid!);
      return child;
    };
    const { root } = await project(PRIMARY, { components: 1 });
    const started = Date.now();

    const result = await originalCheck(
      {
        tsConfigFilePath: path.join(root, "tsconfig.json"),
        templates: [path.join(root, "src", "widget-0.component.html")],
        overlay: [],
        changes: [],
      },
      {
        signal: new AbortController().signal,
        checkpoint: () => undefined,
        remainingMs: () => 12_000,
      },
      { entry: builtEntry, spawn },
    );

    expect(result).toMatchObject({ status: "unfinished", reason: "deadline" });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(pids).toHaveLength(1);
    expect(() => process.kill(pids[0]!, 0)).toThrow();
  }, 30_000);

  it("kills the child and rejects with REQUEST_CANCELLED when the request is aborted", async () => {
    const pids: number[] = [];
    useBuiltChild((_script, _args, options): ChildProcess => {
      const child = fork(hangingChild, ["hang"], options);
      pids.push(child.pid!);
      return child;
    });
    const { root, matrix } = await project(PRIMARY, { components: 1 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1_500);

    await expect(templateRename(root, matrix, { signal: controller.signal })).rejects.toMatchObject(
      {
        code: "REQUEST_CANCELLED",
      },
    );

    expect(pids).toHaveLength(1);
    expect(() => process.kill(pids[0]!, 0)).toThrow();
  }, 60_000);

  it("serves another project during a long check while a same-project operation queues", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inCheck = new Promise<void>((resolve) => (entered = resolve));
    vi.spyOn(typecheck, "checkTemplateTypes").mockImplementation(async () => {
      entered();
      await held;
      return { status: "completed", added: [], removed: [], addedErrors: [] };
    });
    const first = await project(PRIMARY, { components: 1 });
    const second = await project(PRIMARY, { components: 1 });

    const long = templateRename(first.root, first.matrix);
    await inCheck;
    // A different project is not queued behind the running check.
    const other = await createPlan(
      second.root,
      "replace_symbol_body",
      false,
      async (context) => {
        const node = findDeclarationByName(
          getSourceFileOrThrow(context.project, "src/widget-0.component.ts"),
          "Widget0Component",
        );
        (node as unknown as { addProperty(p: { name: string }): void }).addProperty({
          name: "extra",
        });
        return { referenceCount: 0 };
      },
      createRequestContext(),
    );
    expect(other.kind).toBe("replace_symbol_body");

    // The same project is serialized behind it.
    let sameProjectDone = false;
    const queued = createPlan(
      first.root,
      "replace_symbol_body",
      false,
      async () => ({ referenceCount: 0 }),
      createRequestContext(),
    ).catch(() => undefined);
    void queued.then(() => (sameProjectDone = true));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sameProjectDone).toBe(false);

    release();
    await long;
    await queued;
    expect(sameProjectDone).toBe(true);
  }, 120_000);

  it("writes nothing to the workspace or to node_modules for any status", async () => {
    useBuiltChild();
    const before = await angularPackagesDigest(PRIMARY);
    const { root, matrix } = await project(PRIMARY, { components: 2, seedBrokenConsumer: true });
    const digest = await treeDigest(root);

    const prepared = await templateRename(root, matrix);

    expect(prepared.template_diagnostics?.status).toBe("completed");
    expect(await treeDigest(root)).toBe(digest);
    expect(await angularPackagesDigest(PRIMARY)).toBe(before);
  }, 120_000);
});
