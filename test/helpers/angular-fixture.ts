import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectFixture, type ProjectFixture } from "./project-fixture.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Repo-local (gitignored) parent for Angular fixtures so the compiler alias realpath stays under an ancestor node_modules. */
export const ANGULAR_FIXTURE_ROOT = path.join(repositoryRoot, ".tmp", "angular-fixtures");

export type AngularCompilerAlias = "v20" | "v21" | "v22";

export interface AngularFixtureOptions {
  /** Aliased compiler major to expose as `@angular/compiler`, or `null` for none. */
  compiler: AngularCompilerAlias | null;
  /** `repo` (default) is under `.tmp/angular-fixtures`; `os-tmp` proves containment rejection. */
  location?: "repo" | "os-tmp";
  /** Version written to the stub `@angular/core` package. */
  coreVersion?: string;
}

export interface AngularFixture extends ProjectFixture {
  /** Fixture root resolved through realpath. */
  root: string;
}

const CORE_DECLARATIONS = `export interface ComponentMetadata {
  selector?: string;
  template?: string;
  templateUrl?: string;
  standalone?: boolean;
}
export declare function Component(metadata: ComponentMetadata): ClassDecorator;
`;

export async function createAngularFixture(
  files: Record<string, string>,
  options: AngularFixtureOptions,
): Promise<AngularFixture> {
  const parentDir =
    options.location === "os-tmp" ? await realpath(os.tmpdir()) : ANGULAR_FIXTURE_ROOT;
  const base = await createProjectFixture(files, { parentDir });
  const root = await realpath(base.root);

  const coreDir = path.join(root, "node_modules", "@angular", "core");
  await mkdir(coreDir, { recursive: true });
  await writeFile(
    path.join(coreDir, "package.json"),
    JSON.stringify({
      name: "@angular/core",
      version: options.coreVersion ?? "21.0.0",
      types: "./index.d.ts",
    }),
  );
  await writeFile(path.join(coreDir, "index.d.ts"), CORE_DECLARATIONS);

  if (options.compiler !== null) {
    const alias = path.join(repositoryRoot, "node_modules", `angular-compiler-${options.compiler}`);
    await symlink(alias, path.join(root, "node_modules", "@angular", "compiler"), "dir");
  }

  return { ...base, root };
}

/** Node engines floors for `@angular/compiler` majors that are stricter than this repository's own. */
export function compilerMajorSupportedByNode(
  major: 20 | 21 | 22,
  nodeVersion: string = process.versions.node,
): boolean {
  const [nodeMajor = 0, nodeMinor = 0, nodePatch = 0] = nodeVersion.split(".").map(Number);
  if (major !== 22) return nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12);
  if (nodeMajor >= 26) return true;
  if (nodeMajor === 24) return nodeMinor >= 15;
  if (nodeMajor === 22) return nodeMinor > 22 || (nodeMinor === 22 && nodePatch >= 3);
  return false;
}
