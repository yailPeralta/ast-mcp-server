import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateMatrixProject, writeMatrixProject } from "./angular-matrix-fixture.js";

const templateFiles = (files: Record<string, string>) =>
  Object.keys(files).filter((file) => file.endsWith(".html"));

describe("Angular matrix fixture generator", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("generates N widget components and 2N consuming hosts: 3N components and 3N templates", () => {
    const small = generateMatrixProject({ components: 4 });
    expect(small.componentCount).toBe(12);
    expect(small.templateCount).toBe(12);
    expect(templateFiles(small.files)).toHaveLength(12);
    expect(Object.keys(small.files).filter((file) => file.endsWith(".component.ts"))).toHaveLength(
      12,
    );

    const large = generateMatrixProject({ components: 100 });
    expect(large.componentCount).toBe(300);
    expect(templateFiles(large.files)).toHaveLength(300);
  });

  it("is deterministic and uses only relative templateUrls", () => {
    const first = generateMatrixProject({ components: 3 });
    const second = generateMatrixProject({ components: 3 });
    expect(second).toEqual(first);

    const urls = Object.entries(first.files)
      .filter(([file]) => file.endsWith(".component.ts"))
      .map(([, text]) => /templateUrl: "([^"]+)"/u.exec(text)?.[1]);
    expect(urls).toHaveLength(9);
    for (const url of urls) {
      expect(url).toMatch(/^\.\/[a-z0-9-]+\.component\.html$/u);
    }
    const tsconfig = JSON.parse(first.files["tsconfig.json"]!) as {
      angularCompilerOptions?: { strictTemplates?: boolean };
    };
    expect(tsconfig.angularCompilerOptions?.strictTemplates).toBe(true);
  });

  it("renames the first widget input everywhere in the overlay when nothing is seeded", () => {
    const project = generateMatrixProject({ components: 3 });
    const { rename } = project;
    expect(rename).toMatchObject({ from: "label", to: "heading" });
    expect(rename.overlay.map((entry) => entry.path).sort()).toEqual([
      "src/host-0-0.component.html",
      "src/host-0-1.component.html",
      "src/widget-0.component.html",
      "src/widget-0.component.ts",
    ]);
    for (const entry of rename.overlay) {
      expect(entry.text).not.toContain("label");
      expect(entry.text).toContain("heading");
      expect(project.files[entry.path]).toContain("label");
    }
    expect(rename.seeded).toEqual({});
  });

  it("seeds one broken consumer by mis-renaming the binding of a single edited host", () => {
    const project = generateMatrixProject({ components: 3, seedBrokenConsumer: true });
    const broken = project.rename.seeded.brokenConsumer;
    expect(broken).toBe("src/host-0-1.component.html");
    expect(project.rename.overlay).toHaveLength(4);
    const edited = project.rename.overlay.find((entry) => entry.path === broken)!;
    expect(edited.text).toContain("[headng]");
    expect(edited.text).not.toContain("[heading]");
    const clean = generateMatrixProject({ components: 3 });
    expect(clean.rename.seeded.brokenConsumer).toBeUndefined();
    expect(JSON.stringify(clean.rename.overlay)).not.toContain("headng");
  });

  it("seeds a pre-existing error that is present before and after and shifts with the rename", () => {
    const project = generateMatrixProject({ components: 3, seedPreexistingError: true });
    const preexisting = project.rename.seeded.preexistingError;
    expect(preexisting).toBe("src/host-0-0.component.html");
    const before = project.files[preexisting!]!;
    const after = project.rename.overlay.find((entry) => entry.path === preexisting)!.text;
    expect(before).toContain("[nonexistent]");
    expect(after).toContain("[nonexistent]");
    expect(after.indexOf("[nonexistent]")).toBe(before.indexOf("[nonexistent]") + 2);

    const clean = generateMatrixProject({ components: 3 });
    expect(Object.values(clean.files).join("\n")).not.toContain("[nonexistent]");
  });

  it("writes the project, including tsconfig.json, to a directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "matrix-fixture-"));
    roots.push(root);
    const project = generateMatrixProject({ components: 2 });
    await writeMatrixProject(root, project);

    const tsconfig = JSON.parse(await readFile(path.join(root, "tsconfig.json"), "utf8")) as {
      include?: string[];
    };
    expect(tsconfig.include).toEqual(["src/**/*.ts"]);
    expect(await readFile(path.join(root, "src", "widget-1.component.html"), "utf8")).toBe(
      project.files["src/widget-1.component.html"],
    );
  });
});
