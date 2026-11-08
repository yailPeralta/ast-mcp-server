import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  isInScope,
  loadToolchain,
  probeCompilerApi,
  runTemplateTypeCheck,
  toWireDiagnostic,
  withNoEmit,
  type Toolchain,
} from "../src/services/angular-template-typecheck-core.js";
import {
  MAX_MESSAGE_CHARS,
  type Request,
} from "../src/services/angular-template-typecheck-protocol.js";
import { preflightTemplateTypeCheck } from "../src/services/angular-template-typecheck.js";
import {
  generateMatrixProject,
  writeMatrixProject,
  type MatrixProjectOptions,
} from "./helpers/angular-matrix-fixture.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const matrixRoot = path.join(here, "angular-matrix");
const MAJORS = [18, 19, 20, 21, 22];
const PRIMARY = 21;
const nodeSupported = Number(process.versions.node.split(".")[0]) >= 22;

interface Harness {
  root: string;
  request: Request;
  overlayText: (file: string) => string;
  files: Record<string, string>;
}
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createHarness(
  major: number,
  options: MatrixProjectOptions,
  templateFilter: (file: string) => boolean = () => true,
  tsconfigPatch?: (text: string) => string,
): Promise<Harness> {
  const tmp = path.join(matrixRoot, `v${major}`, ".tmp");
  await mkdir(tmp, { recursive: true });
  const root = await mkdtemp(path.join(tmp, "core-"));
  roots.push(root);
  const project = generateMatrixProject(options);
  if (tsconfigPatch) project.files["tsconfig.json"] = tsconfigPatch(project.files["tsconfig.json"]);
  await writeMatrixProject(root, project);
  const tsconfig = path.join(root, "tsconfig.json");
  const preflight = preflightTemplateTypeCheck(tsconfig);
  if (!preflight.ok) throw new Error(`preflight failed: ${preflight.reason}`);
  const overlay = project.rename.overlay.map((entry) => ({
    absolutePath: path.join(root, ...entry.path.split("/")),
    text: entry.text,
  }));
  const templates = overlay
    .map((entry) => entry.absolutePath)
    .filter((file) => file.endsWith(".html") && templateFilter(path.basename(file)));
  return {
    root,
    files: project.files,
    request: {
      v: 1,
      tsconfig,
      cliEntry: preflight.cliEntry,
      templates,
      overlay,
      maxDiagnostics: 5000,
    },
    overlayText: (file) =>
      overlay.find((entry) => entry.absolutePath === path.join(root, file))!.text,
  };
}

async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const entry of (await readdir(root, { recursive: true })).sort()) {
    const full = path.join(root, entry);
    hash.update(entry);
    if ((await stat(full)).isFile()) hash.update(await readFile(full));
  }
  return hash.digest("hex");
}

const okOf = async (request: Request, load?: (entry: string) => Promise<Toolchain>) => {
  const response = await runTemplateTypeCheck(request, load);
  if (!response.ok) throw new Error(`check replied ${response.reason}`);
  return response;
};

describe.each(MAJORS)("template type-check core on Angular %i", (major) => {
  it.skipIf(!nodeSupported)(
    "reports a seeded consumer break only after the rename and maps offsets onto the html",
    async () => {
      const h = await createHarness(major, {
        components: 3,
        seedBrokenConsumer: true,
        seedPreexistingError: true,
      });
      const digest = await treeDigest(h.root);
      const { before, after } = await okOf(h.request);

      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ category: "Error", file: "src/host-0-0.component.html" });
      expect(before[0].message).toContain("nonexistent");
      expect(after).toHaveLength(2);
      const broken = after.find((d) => d.message.includes("headng"))!;
      expect(broken).toMatchObject({ category: "Error", file: "src/host-0-1.component.html" });
      expect(
        h
          .overlayText("src/host-0-1.component.html")
          .slice(broken.start!, broken.start! + broken.length!),
      ).toMatch(/headng/);
      const shifted = after.find((d) => d.message.includes("nonexistent"))!;
      expect(shifted.start! - before[0].start!).toBe(2);
      expect(await treeDigest(h.root)).toBe(digest);
    },
  );

  describe.skipIf(!nodeSupported)("template-only edits", () => {
    const host = "src/host-0-1.component.html";
    const edit = async (mutate: (text: string) => string) => {
      const h = await createHarness(major, { components: 3 });
      const absolutePath = path.join(h.root, host);
      const request = {
        ...h.request,
        templates: [absolutePath],
        overlay: [{ absolutePath, text: mutate(h.files[host]) }],
      };
      return okOf(request);
    };

    it("reports a template binding that no longer type-checks, with no directive change", async () => {
      const { before, after } = await edit((text) =>
        text.replace("</section>", "  <i>{{ missingMember }}</i>\n</section>"),
      );
      expect(before).toHaveLength(0);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ category: "Error", file: host });
      expect(after[0].message).toContain("missingMember");
    });

    it("reports nothing for a clean template-only edit", async () => {
      const { after } = await edit((text) =>
        text.replace("</section>", "  <i>{{ title }}</i>\n</section>"),
      );
      expect(after).toEqual([]);
    });
  });

  it.skipIf(!nodeSupported)(
    "yields the same diagnostics on both sides for a clean rename",
    async () => {
      const h = await createHarness(major, { components: 3, seedPreexistingError: true });
      const { before, after } = await okOf(h.request);
      expect(before).toHaveLength(1);
      expect(after.map(({ code, file, message }) => ({ code, file, message }))).toEqual(
        before.map(({ code, file, message }) => ({ code, file, message })),
      );
    },
  );
});

describe.skipIf(!nodeSupported)("template type-check core scope and contracts", () => {
  it("excludes the diagnostics of components whose templates the plan does not edit", async () => {
    const h = await createHarness(
      PRIMARY,
      { components: 3, seedBrokenConsumer: true, seedPreexistingError: true },
      (file) => file.startsWith("widget-"),
    );
    expect(h.request.templates).toHaveLength(1);
    const { before, after } = await okOf(h.request);
    expect({ before, after }).toEqual({ before: [], after: [] });
  });

  it("applies scope to files, never reporting node_modules templates", () => {
    const scope = new Set(["/p/src/a.component.html", "/p/node_modules/lib/b.component.html"]);
    expect(isInScope("/p/src/a.component.html", scope)).toBe(true);
    expect(isInScope("/p/node_modules/lib/b.component.html", scope)).toBe(false);
    expect(isInScope("/p/src/other.component.html", scope)).toBe(false);
  });

  it("normalizes category, message and project-relative file, truncating long messages", async () => {
    const { ts } = await loadToolchain(
      (await createHarness(PRIMARY, { components: 1 })).request.cliEntry,
    );
    const file = ts.createSourceFile(
      "/p/src/a.html",
      "<a>\n  <b></b>\n</a>",
      ts.ScriptTarget.ES2022,
    );
    const make = (category: number, messageText: string) => ({
      code: 8107,
      category,
      file,
      start: 6,
      length: 3,
      messageText,
    });
    expect(toWireDiagnostic(ts, "/p", make(ts.DiagnosticCategory.Warning, "careful"))).toEqual({
      code: 8107,
      category: "Warning",
      file: "src/a.html",
      line: 2,
      column: 3,
      message: "careful",
      start: 6,
      length: 3,
    });
    const long = toWireDiagnostic(ts, "/p", make(ts.DiagnosticCategory.Error, "x".repeat(20_000)));
    expect(long.message).toHaveLength(MAX_MESSAGE_CHARS);
  });

  it("forces no-emit options over the project configuration and never writes", async () => {
    const h = await createHarness(PRIMARY, { components: 1 }, undefined, (text) =>
      text.replace(
        '"noEmit": true',
        '"noEmit": false, "outDir": "out", "incremental": true, "composite": true',
      ),
    );
    const toolchain = await loadToolchain(h.request.cliEntry);
    const seen: { options: Record<string, unknown>; host: { writeFile(): void } }[] = [];
    const Base = toolchain.cli.NgtscProgram;
    class Spy extends Base {
      constructor(
        rootNames: readonly string[],
        options: Record<string, unknown>,
        host: unknown,
        old?: ConstructorParameters<typeof Base>[3],
      ) {
        seen.push({ options, host: host as (typeof seen)[number]["host"] });
        super(rootNames, options, host, old);
      }
    }
    await okOf(h.request, async () => ({
      ...toolchain,
      cli: { ...toolchain.cli, NgtscProgram: Spy },
    }));
    expect(seen).toHaveLength(2);
    for (const { options, host } of seen) {
      expect(options).toMatchObject({ noEmit: true, incremental: false, composite: false });
      expect(options.tsBuildInfoFile).toBeUndefined();
      expect(() => host.writeFile()).toThrow(/must not write/);
    }
    expect(withNoEmit({ outDir: "x", noEmit: false })).toMatchObject({ outDir: "x", noEmit: true });
  });

  it("reuses identical SourceFile objects for unchanged files and parses overlay files fresh", async () => {
    const h = await createHarness(PRIMARY, { components: 2 });
    const toolchain = await loadToolchain(h.request.cliEntry);
    const hosts: { getSourceFile(name: string, target: number): { text: string } | undefined }[] =
      [];
    const Base = toolchain.cli.NgtscProgram;
    class Spy extends Base {
      constructor(
        rootNames: readonly string[],
        options: Record<string, unknown>,
        host: unknown,
        old?: ConstructorParameters<typeof Base>[3],
      ) {
        hosts.push(host as (typeof hosts)[number]);
        super(rootNames, options, host, old);
      }
    }
    await okOf(h.request, async () => ({
      ...toolchain,
      cli: { ...toolchain.cli, NgtscProgram: Spy },
    }));
    const target = toolchain.ts.ScriptTarget.ES2022;
    const unchanged = path.join(h.root, "src", "widget-1.component.ts");
    const edited = path.join(h.root, "src", "widget-0.component.ts");
    expect(hosts[1].getSourceFile(unchanged, target)).toBe(
      hosts[0].getSourceFile(unchanged, target),
    );
    const fresh = hosts[1].getSourceFile(edited, target)!;
    expect(fresh).not.toBe(hosts[0].getSourceFile(edited, target));
    expect(fresh.text).toBe(h.overlayText("src/widget-0.component.ts"));
  });

  describe("public API probe and failure mapping", () => {
    let workspaceUnchanged = false;
    const withCli = async (patch: (cli: Toolchain["cli"]) => Record<string, unknown>) => {
      const h = await createHarness(PRIMARY, { components: 1 });
      const digest = await treeDigest(h.root);
      const toolchain = await loadToolchain(h.request.cliEntry);
      const patched = { ...toolchain, cli: { ...toolchain.cli, ...patch(toolchain.cli) } };
      const response = await runTemplateTypeCheck(
        h.request,
        async () => patched as unknown as Toolchain,
      );
      workspaceUnchanged = (await treeDigest(h.root)) === digest;
      return response;
    };

    it.each(["NgtscProgram", "readConfiguration", "createCompilerHost"])(
      "reports compiler_unsupported when %s is not exported",
      async (name) => {
        expect(await withCli(() => ({ [name]: undefined }))).toEqual({
          v: 1,
          ok: false,
          reason: "compiler_unsupported",
        });
      },
    );

    it("reports compiler_unsupported when getNgSemanticDiagnostics is not a method", async () => {
      const response = await withCli(() => ({ NgtscProgram: class {} }));
      expect(response).toMatchObject({ ok: false, reason: "compiler_unsupported" });
    });

    it("reports compiler_unsupported before diagnostics when getComponentsWithTemplateFile is gone", async () => {
      let requested = 0;
      const response = await withCli((cli) => ({
        NgtscProgram: class extends cli.NgtscProgram {
          override async loadNgStructureAsync() {
            await super.loadNgStructureAsync();
            Object.defineProperty(this, "compiler", { value: {} });
          }
          override getNgSemanticDiagnostics() {
            requested += 1;
            return [];
          }
        },
      }));
      expect(response).toMatchObject({ ok: false, reason: "compiler_unsupported" });
      expect(requested).toBe(0);
    });

    it.each([
      [
        "The Angular Compiler requires TypeScript >=5.8.0 and <6.0.0 but 5.2.2 was found.",
        "typescript_incompatible",
      ],
      ["boom", "check_failed"],
    ])("maps the ngtsc throw %j to %s", async (message, reason) => {
      const response = await withCli((cli) => ({
        NgtscProgram: class extends cli.NgtscProgram {
          constructor(...args: ConstructorParameters<typeof cli.NgtscProgram>) {
            super(...args);
            throw new Error(message);
          }
        },
      }));
      expect(response).toEqual({ v: 1, ok: false, reason });
      expect(workspaceUnchanged).toBe(true);
    });
  });

  it("reports work_exhausted only when a side exceeds the requested diagnostic cap", async () => {
    const h = await createHarness(PRIMARY, { components: 3, seedPreexistingError: true });
    const fits = await okOf({ ...h.request, maxDiagnostics: 1 });
    expect(fits.before).toHaveLength(1);
    const crowded = await createHarness(PRIMARY, {
      components: 3,
      seedBrokenConsumer: true,
      seedPreexistingError: true,
    });
    expect(await runTemplateTypeCheck({ ...crowded.request, maxDiagnostics: 1 })).toEqual({
      v: 1,
      ok: false,
      reason: "work_exhausted",
    });
  });

  it("imports only the public compiler-cli entry", async () => {
    const source = await readFile(
      path.join(here, "..", "src", "services", "angular-template-typecheck-core.ts"),
      "utf8",
    );
    expect(source).toMatch(/import\(pathToFileURL\(/u);
    expect(source).not.toMatch(/compiler-cli\/private|\/private\//u);
    expect(source).not.toMatch(/getTemplateTypeChecker|_enableTemplateTypeChecker|OptimizeFor/u);
    expect(probeCompilerApi({})).toBe(false);
  });
});
