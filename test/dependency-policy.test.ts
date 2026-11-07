import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import yaml from "yaml";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

it("locks patched transitives within every admitted parent range", async () => {
  const [packageBytes, lockBytes] = await Promise.all([
    readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    readFile(path.join(repositoryRoot, "yarn.lock"), "utf8"),
  ]);
  const manifest = JSON.parse(packageBytes) as {
    packageManager?: string;
    resolutions?: Record<string, string>;
  };
  const lock = yaml.parse(lockBytes, { prettyErrors: true }) as Record<
    string,
    { version?: string; resolution?: string; dependencies?: Record<string, string> }
  >;

  expect.soft(manifest.packageManager).toBe("yarn@4.15.0");
  expect.soft(manifest.resolutions?.["fast-uri"]).toBe("3.1.9");
  expect.soft(manifest.resolutions?.qs).toBe("6.16.1");
  expect.soft(manifest.resolutions?.["@hono/node-server"]).toBe("2.1.5");

  expect.soft(lock["fast-uri@npm:3.1.9"]).toMatchObject({
    version: "3.1.9",
    resolution: "fast-uri@npm:3.1.9",
  });
  expect.soft(lock["qs@npm:6.16.1"]).toMatchObject({
    version: "6.16.1",
    resolution: "qs@npm:6.16.1",
  });
  expect.soft(lock["@hono/node-server@npm:2.1.5"]).toMatchObject({
    version: "2.1.5",
    resolution: "@hono/node-server@npm:2.1.5",
  });
  expect
    .soft(lockBytes)
    .not.toMatch(/fast-uri@npm:3\.1\.5|qs@npm:6\.(?:15\.3|16\.0)|@hono\/node-server@npm:2\.0\./u);

  expect
    .soft(lock["ajv@npm:^8.0.0, ajv@npm:^8.17.1"]?.dependencies?.["fast-uri"])
    .toBe("npm:^3.0.1");
  expect.soft(lock["express@npm:^5.2.1"]?.dependencies?.qs).toBe("npm:^6.14.0");
  expect.soft(lock["body-parser@npm:^2.2.1"]?.dependencies?.qs).toBe("npm:^6.16.1");
});

it("pins minimatch above every admitted parent range as a documented advisory exception", async () => {
  // GHSA-g3hv-75wg-m249 is only fixed in minimatch >=11.0.1, and no parent admits a
  // 11.x range yet. The pin is admitted because every parent only calls
  // `minimatch(path, pattern)` or `new Minimatch(pattern, { dot: true }).match()`,
  // none of the API removed in 11 (makeRe, Minimatch#regexp, AST, maxExtglobRecursion).
  // Drop the exception once the parents below declare a range that admits 11.
  const [manifestBytes, lockBytes] = await Promise.all(
    ["package.json", "yarn.lock"].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
  );
  const manifest = JSON.parse(manifestBytes!) as { resolutions?: Record<string, string> };
  const lock = yaml.parse(lockBytes!) as Record<
    string,
    { version?: string; resolution?: string; dependencies?: Record<string, string> }
  >;

  expect.soft(manifest.resolutions?.minimatch).toBe("11.0.3");
  expect.soft(lock["minimatch@npm:11.0.3"]).toMatchObject({
    version: "11.0.3",
    resolution: "minimatch@npm:11.0.3",
  });
  const minimatchEntries = Object.keys(lock).filter((key) =>
    key.split(", ").some((selector) => selector.startsWith("minimatch@npm:")),
  );
  expect.soft(minimatchEntries).toEqual(["minimatch@npm:11.0.3"]);

  const parents = {
    "@eslint/config-array": "npm:^10.2.4",
    "@ts-morph/common": "npm:^10.0.1",
    "@typescript-eslint/typescript-estree": "npm:^10.2.2",
    eslint: "npm:^10.2.5",
  };
  for (const [name, range] of Object.entries(parents)) {
    const entry = Object.entries(lock).find(([key]) =>
      key.split(", ").some((selector) => selector.startsWith(`${name}@npm:`)),
    );
    expect.soft(entry?.[1]?.dependencies?.minimatch, name).toBe(range);
  }
});

it("admits the patched Hono and Vitest family without installation-policy exceptions", async () => {
  const [manifestBytes, lockBytes, configBytes] = await Promise.all(
    ["package.json", "yarn.lock", ".yarnrc.yml"].map((file) =>
      readFile(path.join(repositoryRoot, file), "utf8"),
    ),
  );
  const manifest = JSON.parse(manifestBytes!);
  const lock = yaml.parse(lockBytes!) as Record<string, { version: string; resolution: string }>;
  const config = yaml.parse(configBytes!);
  expect.soft(manifest.resolutions.hono).toBe("4.13.13");
  expect.soft(manifest.devDependencies.vitest).toBe("^5.0.5");
  expect.soft(config.enableScripts).toBe(false);
  expect.soft(config.npmPreapprovedPackages ?? []).toEqual([]);
  expect.soft(config.npmMinimalAgeGate).toBeUndefined();

  const packages = ["hono", "vitest", ...["mocker", "spy"].map((name) => `@vitest/${name}`)];
  for (const name of packages) {
    const entries = Object.entries(lock).filter(([key]) =>
      key.split(", ").some((selector) => selector.startsWith(`${name}@npm:`)),
    );
    const version = name === "hono" ? "4.13.13" : "5.0.5";
    expect.soft(entries, name).toHaveLength(1);
    expect
      .soft(entries[0]?.[1], name)
      .toMatchObject({ version, resolution: `${name}@npm:${version}` });
  }
});

it("excludes only the dev-only Angular 18 and 19 packages from the audit", async () => {
  // Every 18.x and 19.x @angular/compiler and @angular/core release carries open runtime XSS
  // advisories (sanitizer and i18n code that only runs in a browser), and no later patch exists
  // on either branch. The aliases and the test/angular-matrix workspaces are dev-only and never
  // reach the published package (yarn test:package asserts that). The audit reports aliases under
  // the real package name, so the exclusion names `@angular/compiler` and `@angular/core`,
  // which no runtime dependency uses. Drop the exclusion with the aliases and the 18/19 matrix.
  const [manifestBytes, configBytes] = await Promise.all(
    ["package.json", ".yarnrc.yml"].map((file) =>
      readFile(path.join(repositoryRoot, file), "utf8"),
    ),
  );
  const manifest = JSON.parse(manifestBytes!) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const config = yaml.parse(configBytes!) as { npmAuditExcludePackages?: string[] };
  expect.soft(config.npmAuditExcludePackages).toEqual(["@angular/compiler", "@angular/core"]);
  for (const alias of ["angular-compiler-v18", "angular-compiler-v19"]) {
    expect.soft(manifest.devDependencies?.[alias], alias).toBeDefined();
    expect.soft(manifest.dependencies?.[alias], alias).toBeUndefined();
  }
  expect.soft(manifest.dependencies?.["@angular/compiler"]).toBeUndefined();
});

it("declares @angular/compiler as an optional peer and not a dependency", async () => {
  const [manifestBytes, lockBytes] = await Promise.all(
    ["package.json", "yarn.lock"].map((file) => readFile(path.join(repositoryRoot, file), "utf8")),
  );
  const manifest = JSON.parse(manifestBytes!) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    engines?: Record<string, string>;
  };

  expect.soft(manifest.peerDependencies?.["@angular/compiler"]).toBe(">=18.0.0 <23.0.0");
  expect.soft(manifest.peerDependenciesMeta?.["@angular/compiler"]).toEqual({ optional: true });
  expect.soft(manifest.dependencies?.["@angular/compiler"]).toBeUndefined();
  expect.soft(manifest.devDependencies?.["@angular/compiler"]).toBeUndefined();
  expect.soft(manifest.engines?.node).toBe(">=22.13.0");

  for (const major of ["18", "19", "20", "21", "22"]) {
    const alias = `angular-compiler-v${major}`;
    const range = manifest.devDependencies?.[alias];
    expect.soft(range, alias).toMatch(new RegExp(`^npm:@angular/compiler@${major}\\.\\d+\\.\\d+$`));
    // The matrix workspaces pin the same release, so Yarn merges the alias selector into the
    // shared `@angular/compiler` lock entry instead of giving it a key of its own.
    expect
      .soft(lockBytes, alias)
      .toContain(`${alias}@npm:@angular/compiler@${range?.split("@").pop()}`);
  }
});

// Real per-major Angular toolchains for template type checking (#421). They live in private
// workspaces under test/ so `@angular/compiler-cli` resolves its own `@angular/compiler` and
// `typescript` from a nested node_modules, and never from the repository root.
const MATRIX_TYPESCRIPT_RANGES: Record<string, { min: [number, number]; max: [number, number] }> = {
  "18": { min: [5, 4], max: [5, 6] },
  "19": { min: [5, 5], max: [5, 9] },
  "20": { min: [5, 8], max: [6, 0] },
  "21": { min: [5, 9], max: [6, 1] },
  "22": { min: [6, 0], max: [6, 1] },
};

function exactVersion(spec: string | undefined): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(spec ?? "");
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function atLeast(version: number[], bound: number[]): boolean {
  for (let index = 0; index < bound.length; index += 1) {
    if (version[index]! !== bound[index]!) return version[index]! > bound[index]!;
  }
  return true;
}

describe("Angular template type-check matrix workspaces", () => {
  const majors = ["18", "19", "20", "21", "22"];

  it.each(majors)("pins an exact, in-range toolchain for Angular %s", async (major) => {
    const manifest = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "test", "angular-matrix", `v${major}`, "package.json"),
        "utf8",
      ),
    ) as {
      name?: string;
      private?: boolean;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      installConfig?: { hoistingLimits?: string };
    };
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };

    expect(manifest.private).toBe(true);
    expect(manifest.name).toBe(`ast-mcp-angular-matrix-v${major}`);
    expect(manifest.installConfig?.hoistingLimits).toBe("workspaces");

    const core = declared["@angular/core"];
    expect(core).toMatch(new RegExp(`^${major}\\.\\d+\\.\\d+$`, "u"));
    expect(declared["@angular/compiler"]).toBe(core);
    expect(declared["@angular/compiler-cli"]).toBe(core);

    const typescript = exactVersion(declared.typescript);
    expect(typescript, "typescript must be an exact version").not.toBeNull();
    const range = MATRIX_TYPESCRIPT_RANGES[major]!;
    expect(atLeast(typescript!, range.min)).toBe(true);
    expect(atLeast(typescript!, range.max)).toBe(false);

    expect(exactVersion(declared.rxjs)).not.toBeNull();
    expect(exactVersion(declared.tslib)).not.toBeNull();
  });

  it("registers the workspaces and keeps Angular out of the root runtime dependencies", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
      workspaces?: string[];
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(manifest.workspaces).toEqual(["test/angular-matrix/*"]);
    for (const name of ["@angular/core", "@angular/compiler-cli"]) {
      expect(manifest.dependencies?.[name], name).toBeUndefined();
      expect(manifest.devDependencies?.[name], name).toBeUndefined();
      expect(manifest.peerDependencies?.[name], name).toBeUndefined();
    }
  });

  it("passes the audit through exact descriptor pins, not new advisory exclusions", async () => {
    // Angular 18 and 19 compiler-cli pin @babel/core 7.25.2 and 7.26.9, which carry
    // GHSA-4x5r-pxfx-6jf8 (<=7.29.0). Only those exact descriptors are lifted to the version
    // Angular 20 and 21 already use. @angular/core 18.x and 19.x carry open i18n/sanitizer
    // advisories with no patch on those branches, so core joins the compiler exclusion;
    // @angular/compiler-cli has no advisory and gets none.
    const [manifestBytes, configBytes] = await Promise.all(
      ["package.json", ".yarnrc.yml"].map((file) =>
        readFile(path.join(repositoryRoot, file), "utf8"),
      ),
    );
    const manifest = JSON.parse(manifestBytes) as { resolutions?: Record<string, string> };
    const config = yaml.parse(configBytes) as { npmAuditExcludePackages?: string[] };

    expect(manifest.resolutions?.["@babel/core@npm:7.25.2"]).toBe("npm:7.29.7");
    expect(manifest.resolutions?.["@babel/core@npm:7.26.9"]).toBe("npm:7.29.7");
    expect(config.npmAuditExcludePackages).toEqual(["@angular/compiler", "@angular/core"]);
    for (const major of majors) {
      const manifest = JSON.parse(
        await readFile(
          path.join(repositoryRoot, "test", "angular-matrix", `v${major}`, "package.json"),
          "utf8",
        ),
      ) as { dependencies?: Record<string, string> };
      for (const spec of Object.values(manifest.dependencies ?? {})) {
        expect(spec, `v${major}`).not.toMatch(/^npm:/u);
      }
    }
  });
});
