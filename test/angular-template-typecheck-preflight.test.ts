import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkTemplateTypes,
  preflightTemplateTypeCheck,
} from "../src/services/angular-template-typecheck.js";
import { ANGULAR_FIXTURE_ROOT } from "./helpers/angular-fixture.js";
import { createProjectFixture, type ProjectFixture } from "./helpers/project-fixture.js";

const matrixRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "angular-matrix");

interface FakeToolchain {
  cli?: string | null;
  compiler?: string | null;
  core?: string | null;
  /** Project-root TypeScript (found from the tsconfig) versus one nested under the compiler-cli (found by ngtsc). */
  rootTypescript?: string;
  cliTypescript?: string | null;
  peer?: string;
  cliLocation?: "inside" | "outside";
}

const fixtures: ProjectFixture[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

async function writePackage(
  dir: string,
  manifest: Record<string, unknown>,
  withEntry = true,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      ...manifest,
      exports: { ".": { default: "./index.js" }, "./package.json": "./package.json" },
    }),
  );
  if (withEntry) await writeFile(path.join(dir, "index.js"), "module.exports = {};\n");
}

async function setup(toolchain: FakeToolchain = {}): Promise<{ root: string; tsconfig: string }> {
  const fixture = await createProjectFixture({}, { parentDir: ANGULAR_FIXTURE_ROOT });
  fixtures.push(fixture);
  const root = await realpath(fixture.root);
  const modules = path.join(root, "node_modules");
  const {
    cli = "21.0.0",
    compiler = "21.0.0",
    core = "21.0.0",
    rootTypescript = "5.9.3",
    cliTypescript = null,
    peer = ">=5.9 <6.1",
  } = toolchain;
  const packages: [string, string | null, object?][] = [
    ["@angular/compiler", compiler],
    ["@angular/core", core],
    ["typescript", rootTypescript],
  ];
  for (const [name, version, extra] of packages) {
    if (version !== null) {
      await writePackage(
        path.join(modules, name),
        { name, version, ...extra },
        name !== "typescript",
      );
    }
  }
  if (cli !== null) {
    const cliDir = path.join(modules, "@angular", "compiler-cli");
    const manifest = {
      name: "@angular/compiler-cli",
      version: cli,
      peerDependencies: { typescript: peer },
    };
    if (toolchain.cliLocation === "outside") {
      const outside = await createProjectFixture({}, {});
      fixtures.push(outside);
      const real = path.join(await realpath(outside.root), "compiler-cli");
      await writePackage(real, manifest);
      await mkdir(path.dirname(cliDir), { recursive: true });
      await symlink(real, cliDir, "dir");
    } else {
      await writePackage(cliDir, manifest);
    }
    if (cliTypescript !== null) {
      const nested = path.join(cliDir, "node_modules", "typescript");
      await writePackage(nested, { name: "typescript", version: cliTypescript }, false);
    }
  }
  return { root, tsconfig: path.join(root, "tsconfig.json") };
}

const reasonOf = (tsconfig: string) => {
  const result = preflightTemplateTypeCheck(tsconfig);
  return result.ok ? "ok" : result.reason;
};

describe("preflightTemplateTypeCheck", () => {
  it("accepts a consistent toolchain and returns the validated cli entry", async () => {
    const { root, tsconfig } = await setup();
    const result = preflightTemplateTypeCheck(tsconfig);
    expect(result).toEqual({
      ok: true,
      cliDir: path.join(root, "node_modules", "@angular", "compiler-cli"),
      cliEntry: path.join(root, "node_modules", "@angular", "compiler-cli", "index.js"),
    });
  });

  it("reports compiler_cli_missing when @angular/compiler-cli is not installed", async () => {
    const { tsconfig } = await setup({ cli: null });
    expect(reasonOf(tsconfig)).toBe("compiler_cli_missing");
  });

  it.each(["17.3.12", "23.0.0", "18.0.0-next.1"])(
    "reports compiler_unsupported for compiler-cli %s",
    async (version) => {
      const { tsconfig } = await setup({ cli: version, compiler: version, core: version });
      expect(reasonOf(tsconfig)).toBe("compiler_unsupported");
    },
  );

  it("reports compiler_unsupported when compiler-cli and @angular/compiler versions differ", async () => {
    const { tsconfig } = await setup({ cli: "21.0.0", compiler: "21.0.1" });
    expect(reasonOf(tsconfig)).toBe("compiler_unsupported");
  });

  it("reports compiler_unsupported when the @angular/core major differs", async () => {
    const { tsconfig } = await setup({ core: "20.3.0" });
    expect(reasonOf(tsconfig)).toBe("compiler_unsupported");
  });

  it.each([{ compiler: null }, { core: null }])(
    "reports compiler_unsupported when a sibling package is absent (%j)",
    async (missing) => {
      const { tsconfig } = await setup(missing);
      expect(reasonOf(tsconfig)).toBe("compiler_unsupported");
    },
  );

  it("reports typescript_incompatible when the TypeScript ngtsc loads is outside the peer range", async () => {
    const { tsconfig } = await setup({ rootTypescript: "5.2.2" });
    expect(reasonOf(tsconfig)).toBe("typescript_incompatible");
  });

  it("resolves TypeScript from the compiler-cli package, not from the tsconfig directory", async () => {
    const outOfRangeNested = await setup({ rootTypescript: "5.9.3", cliTypescript: "5.2.2" });
    expect(reasonOf(outOfRangeNested.tsconfig)).toBe("typescript_incompatible");
    const inRangeNested = await setup({ rootTypescript: "5.2.2", cliTypescript: "5.9.3" });
    expect(preflightTemplateTypeCheck(inRangeNested.tsconfig).ok).toBe(true);
  });

  it("rejects a compiler-cli symlinked outside the project as compiler_unsupported", async () => {
    const { tsconfig } = await setup({ cliLocation: "outside" });
    expect(reasonOf(tsconfig)).toBe("compiler_unsupported");
  });

  it.each([18, 19, 20, 21, 22])("resolves the real v%i matrix workspace independently", (major) => {
    const result = preflightTemplateTypeCheck(path.join(matrixRoot, `v${major}`, "tsconfig.json"));
    expect(result.ok && result.cliDir.includes(`${path.sep}v${major}${path.sep}`)).toBe(true);
  });
});

describe("checkTemplateTypes limits and preflight", () => {
  it("returns the preflight reason as an unavailable delta with empty arrays", async () => {
    const { tsconfig } = await setup({ cli: null });
    expect(
      await checkTemplateTypes({ tsConfigFilePath: tsconfig, templates: [], overlay: [] }),
    ).toEqual({
      status: "unavailable",
      reason: "compiler_cli_missing",
      added: [],
      removed: [],
      addedErrors: [],
    });
  });

  it("reports work_exhausted for more than 2000 templates", async () => {
    const { root, tsconfig } = await setup();
    const templates = Array.from({ length: 2001 }, (_, i) => path.join(root, `t${i}.html`));
    expect(
      await checkTemplateTypes({ tsConfigFilePath: tsconfig, templates, overlay: [] }),
    ).toEqual({
      status: "unfinished",
      reason: "work_exhausted",
      added: [],
      removed: [],
      addedErrors: [],
    });
  });

  it("reports work_exhausted for an overlay above 32 MiB", async () => {
    const { root, tsconfig } = await setup();
    const overlay = [
      { absolutePath: path.join(root, "big.ts"), text: "a".repeat(32 * 1024 * 1024 + 1) },
    ];
    expect(
      await checkTemplateTypes({ tsConfigFilePath: tsconfig, templates: [], overlay }),
    ).toMatchObject({
      status: "unfinished",
      reason: "work_exhausted",
    });
  });
});
