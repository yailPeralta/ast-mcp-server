import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
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
  expect.soft(manifest.resolutions?.["fast-uri"]).toBe("3.1.6");
  expect.soft(manifest.resolutions?.qs).toBe("6.16.0");

  expect.soft(lock["fast-uri@npm:3.1.6"]).toMatchObject({
    version: "3.1.6",
    resolution: "fast-uri@npm:3.1.6",
  });
  expect.soft(lock["qs@npm:6.16.0"]).toMatchObject({
    version: "6.16.0",
    resolution: "qs@npm:6.16.0",
  });
  expect.soft(lockBytes).not.toMatch(/fast-uri@npm:3\.1\.5|qs@npm:6\.15\.3/u);

  expect
    .soft(lock["ajv@npm:^8.0.0, ajv@npm:^8.17.1"]?.dependencies?.["fast-uri"])
    .toBe("npm:^3.0.1");
  expect.soft(lock["express@npm:^5.2.1"]?.dependencies?.qs).toBe("npm:^6.14.0");
  expect.soft(lock["body-parser@npm:^2.2.1"]?.dependencies?.qs).toBe("npm:^6.15.2");
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
  expect.soft(manifest.resolutions.hono).toBe("4.13.5");
  expect.soft(manifest.devDependencies.vitest).toBe("^4.1.11");
  expect.soft(config.enableScripts).toBe(false);
  expect.soft(config.npmPreapprovedPackages ?? []).toEqual([]);
  expect.soft(config.npmMinimalAgeGate).toBeUndefined();

  const packages = [
    "hono",
    "vitest",
    ...["expect", "mocker", "pretty-format", "runner", "snapshot", "spy", "utils"].map(
      (name) => `@vitest/${name}`,
    ),
  ];
  for (const name of packages) {
    const entries = Object.entries(lock).filter(([key]) =>
      key.split(", ").some((selector) => selector.startsWith(`${name}@npm:`)),
    );
    const version = name === "hono" ? "4.13.5" : "4.1.11";
    expect.soft(entries, name).toHaveLength(1);
    expect
      .soft(entries[0]?.[1], name)
      .toMatchObject({ version, resolution: `${name}@npm:${version}` });
  }
});
